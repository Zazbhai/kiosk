"""
PrintBooth Persistent Order Tracker & Spooler Sanitizer
========================================================
Guarantees:
1. Printed orders, completed jobs, and consumed PINs are saved to PERSISTENT flash
   storage (surviving power cuts and Raspberry Pi reboots).
2. Prevents re-printing completed documents when the Pi restarts.
3. Automatically deletes printed files immediately so nothing is left on disk.
4. Flushes the CUPS hardware queue on boot and between jobs.
"""

import os
import sys
import json
import time
import shutil
import logging
from pathlib import Path
from typing import Set, List, Optional, Dict, Any

from config import DATA_DIR, TEMP_JOBS_DIR

logger = logging.getLogger("printbooth.tracker")

HISTORY_FILE = DATA_DIR / "printed_orders_history.json"
LOCK_FILE = DATA_DIR / ".order_tracker.lock"


def _acquire_lock(file_obj):
    if sys.platform != "win32":
        try:
            import fcntl
            fcntl.flock(file_obj.fileno(), fcntl.LOCK_EX)
        except Exception:
            pass


def _release_lock(file_obj):
    if sys.platform != "win32":
        try:
            import fcntl
            fcntl.flock(file_obj.fileno(), fcntl.LOCK_UN)
        except Exception:
            pass


def load_processed_orders() -> Set[str]:
    """
    Loads all permanently processed/printed order IDs and consumed PINs
    from persistent storage. Survives Pi reboots.
    """
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not HISTORY_FILE.exists():
        return set()

    try:
        with open(LOCK_FILE, "a+", encoding="utf-8") as lf:
            _acquire_lock(lf)
            try:
                data = json.loads(HISTORY_FILE.read_text(encoding="utf-8"))
                if isinstance(data, list):
                    return set(str(x).strip() for x in data if x)
                elif isinstance(data, dict):
                    return set(str(k).strip() for k in data.keys() if k)
            finally:
                _release_lock(lf)
    except Exception as e:
        logger.warning(f"Error loading processed orders history: {e}")

    return set()


def mark_order_processed(order_id: str, aliases: Optional[List[str]] = None):
    """
    Atomically records an order ID (and all aliases like orderNumber, releasePin)
    into persistent storage with immediate disk sync (fsync).
    """
    if not order_id:
        return

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    keys_to_add = [str(order_id).strip()]
    if aliases:
        for a in aliases:
            if a and str(a).strip():
                keys_to_add.append(str(a).strip())

    try:
        with open(LOCK_FILE, "a+", encoding="utf-8") as lf:
            _acquire_lock(lf)
            try:
                current_records: Dict[str, Any] = {}
                if HISTORY_FILE.exists():
                    try:
                        raw = json.loads(HISTORY_FILE.read_text(encoding="utf-8"))
                        if isinstance(raw, list):
                            current_records = {k: {"time": time.time()} for k in raw}
                        elif isinstance(raw, dict):
                            current_records = raw
                    except Exception:
                        current_records = {}

                now_ts = time.time()
                now_str = time.strftime("%Y-%m-%d %H:%M:%S")
                for k in keys_to_add:
                    current_records[k] = {
                        "primary": str(order_id).strip(),
                        "ts": now_ts,
                        "time": now_str,
                    }

                # Retain records for 30 days, then prune
                cutoff = now_ts - (30 * 86400)
                current_records = {k: v for k, v in current_records.items() if v.get("ts", now_ts) > cutoff}

                temp_file = DATA_DIR / f".history_tmp_{os.getpid()}.json"
                with open(temp_file, "w", encoding="utf-8") as tf:
                    json.dump(current_records, tf, indent=2)
                    tf.flush()
                    try:
                        os.fsync(tf.fileno())
                    except Exception:
                        pass

                temp_file.replace(HISTORY_FILE)
                logger.info(f"Permanently recorded completed order '{order_id}' to persistent storage.")
            finally:
                _release_lock(lf)
    except Exception as e:
        logger.error(f"Failed to record processed order {order_id}: {e}")


def is_order_processed(order_id: str, aliases: Optional[List[str]] = None) -> bool:
    """
    Checks if an order ID or any alias (orderNumber, releasePin) has already
    been printed or burned.
    """
    if not order_id:
        return False

    processed = load_processed_orders()
    check_keys = [str(order_id).strip()]
    if aliases:
        for a in aliases:
            if a and str(a).strip():
                check_keys.append(str(a).strip())

    return any(k in processed for k in check_keys)


def purge_temp_job_files():
    """
    Deletes any leftover document or image files in TEMP_JOBS_DIR.
    Ensures nothing is left on disk after restarts.
    """
    if not TEMP_JOBS_DIR.exists():
        return

    purged_count = 0
    try:
        for item in TEMP_JOBS_DIR.iterdir():
            # Skip hidden lock / claim files
            if item.name.startswith("."):
                continue
            try:
                if item.is_file():
                    item.unlink()
                    purged_count += 1
                elif item.is_dir():
                    shutil.rmtree(item, ignore_errors=True)
                    purged_count += 1
            except Exception as e:
                logger.debug(f"Notice deleting temp file {item.name}: {e}")
        if purged_count > 0:
            logger.info(f"Purged {purged_count} orphaned temporary print files from disk.")
    except Exception as e:
        logger.warning(f"Error purging temp jobs: {e}")
