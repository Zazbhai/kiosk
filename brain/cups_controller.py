"""
PrintBooth CUPS Controller for Raspberry Pi
===========================================
Handles hardware printing over CUPS (Common Unix Printing System).
Controls:
  - Color vs. Black & White (Monochrome / Grayscale)
  - Number of copies
  - Duplex (Two-sided) vs. Single-sided
  - Paper sizes (A4, Letter, etc.)
  - Queue management, job status, and printer availability telemetry
"""

import subprocess
import json
import os
import sys
import shutil
import time
import re
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

# In Python 3.13+, pycups C extension contains a known fatal PyEval_RestoreThread GIL bug
# where the Python thread state is NULL during C calls/callbacks, terminating the process with SIGSEGV.
# On Linux, standard CUPS CLI tools (lp, lpstat, lpadmin, cancel) are 100% stable, fast, thread-isolated,
# and completely immune to C-extension GIL issues.
# Therefore, we bypass pycups C bindings on Python >= 3.13 or when DISABLE_PYCUPS=1.
if sys.version_info >= (3, 13) or os.environ.get("DISABLE_PYCUPS", "").lower() in ("1", "true", "yes"):
    cups = None
    CUPS_AVAILABLE = False
else:
    try:
        import cups  # type: ignore
        CUPS_AVAILABLE = True
    except ImportError:
        cups = None
        CUPS_AVAILABLE = False

try:
    from config import DATA_DIR, TEMP_JOBS_DIR
except Exception:
    DATA_DIR = Path("./data")
    TEMP_JOBS_DIR = DATA_DIR / "temp_jobs"
DATA_DIR.mkdir(parents=True, exist_ok=True)
TEMP_JOBS_DIR.mkdir(parents=True, exist_ok=True)

# Global lock to serialize PyMuPDF C-level operations across Python threads (Python 3.13 thread-safety)
_MUPDF_LOCK = threading.Lock()
# Hardware lock to strictly synchronize all physical printing operations across threads (no multithreading)
_HARDWARE_PRINT_LOCK = threading.Lock()
# CUPS / pycups C-library lock to prevent PyEval_RestoreThread GIL crash and SIGSEGV across threads (Python 3.13)
_CUPS_LOCK = threading.RLock()


def claim_order_for_spooling(order_id: str, aliases: Optional[List[str]] = None, force: bool = False) -> bool:
    """
    Atomically claims an order ID (and legitimate aliases like orderNumber)
    across all processes (ws_kiosk_client, daemon, retry handlers).
    Returns True if successfully claimed (first time), False if already claimed (duplicate).
    Stores claims in persistent DATA_DIR to survive reboots.
    Strictly excludes 4-6 digit numeric PINs.
    """
    if not order_id:
        return True

    def _is_pin(s: str) -> bool:
        t = str(s).strip()
        return t.isdigit() and len(t) <= 6

    if _is_pin(order_id):
        return True

    all_keys = [str(order_id).strip()]
    # Sub-orders (e.g. ORD-123_sub_1) must never claim or check the master order ID as an alias
    if aliases and "_sub_" not in str(order_id):
        for a in aliases:
            if a and str(a).strip() and not _is_pin(str(a)):
                all_keys.append(str(a).strip())

    lock_file = DATA_DIR / ".spool_claims.lock"
    claims_file = DATA_DIR / ".spool_claims.json"

    try:
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass
        lock_file = DATA_DIR / ".spool_claims.lock"
        claims_file = DATA_DIR / ".spool_claims.json"
        if not os.access(DATA_DIR, os.W_OK):
            fallback_dir = Path("/tmp/printbooth_claims")
            try:
                fallback_dir.mkdir(parents=True, exist_ok=True)
                lock_file = fallback_dir / ".spool_claims.lock"
                claims_file = fallback_dir / ".spool_claims.json"
            except Exception:
                pass

        with open(lock_file, "a+", encoding="utf-8") as lf:
            if sys.platform != "win32":
                try:
                    import fcntl
                    fcntl.flock(lf.fileno(), fcntl.LOCK_EX)
                except Exception:
                    pass

            claims = {}
            if claims_file.exists():
                try:
                    with open(claims_file, "r", encoding="utf-8") as cf:
                        claims = json.load(cf)
                except Exception:
                    claims = {}

            # Check if ANY key is already claimed (unless force=True)
            if not force:
                for k in all_keys:
                    if k in claims:
                        claimed_info = claims[k]
                        print(
                            f"[CUPS Spooler] [BLOCKED] Prevented duplicate print! Order '{order_id}' was already spooled "
                            f"by PID {claimed_info.get('pid')} at {claimed_info.get('time')}."
                        )
                        if sys.platform != "win32":
                            try:
                                import fcntl
                                fcntl.flock(lf.fileno(), fcntl.LOCK_UN)
                            except Exception:
                                pass
                        return False

            # Register/overwrite claim with current PID & timestamp
            now_iso = time.strftime("%Y-%m-%d %H:%M:%S")
            now_ts = time.time()
            entry = {"pid": os.getpid(), "time": now_iso, "ts": now_ts, "primary": order_id}
            for k in all_keys:
                claims[k] = entry

            # Prune claims older than 48 hours
            claims = {k: v for k, v in claims.items() if (now_ts - v.get("ts", 0)) < 172800}

            with open(claims_file, "w", encoding="utf-8") as cf:
                json.dump(claims, cf, indent=2)

            if sys.platform != "win32":
                try:
                    import fcntl
                    fcntl.flock(lf.fileno(), fcntl.LOCK_UN)
                except Exception:
                    pass

            return True
    except Exception as e:
        print(f"[CUPS Spooler] Claim check notice ({e})")
        return True


def unclaim_order(order_id: str, aliases: Optional[List[str]] = None) -> bool:
    """
    Atomically removes an order ID and all its aliases from the claims file.
    Used when a print job fails so that retries or subsequent commands are not blocked.
    """
    if not order_id:
        return True

    def _is_pin(s: str) -> bool:
        t = str(s).strip()
        return t.isdigit() and len(t) <= 6

    if _is_pin(order_id):
        return True

    all_keys = [str(order_id).strip()]
    if aliases:
        for a in aliases:
            if a and str(a).strip() and not _is_pin(str(a)):
                all_keys.append(str(a).strip())

    lock_file = DATA_DIR / ".spool_claims.lock"
    claims_file = DATA_DIR / ".spool_claims.json"
    if not os.access(DATA_DIR, os.W_OK):
        fallback_dir = Path("/tmp/printbooth_claims")
        try:
            fallback_dir.mkdir(parents=True, exist_ok=True)
            lock_file = fallback_dir / ".spool_claims.lock"
            claims_file = fallback_dir / ".spool_claims.json"
        except Exception:
            pass

    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        with open(lock_file, "a+", encoding="utf-8") as lf:
            if sys.platform != "win32":
                try:
                    import fcntl
                    fcntl.flock(lf.fileno(), fcntl.LOCK_EX)
                except Exception:
                    pass

            if claims_file.exists():
                try:
                    with open(claims_file, "r", encoding="utf-8") as cf:
                        claims = json.load(cf)
                    for k in all_keys:
                        claims.pop(k, None)
                    with open(claims_file, "w", encoding="utf-8") as cf:
                        json.dump(claims, cf, indent=2)
                except Exception:
                    pass

            if sys.platform != "win32":
                try:
                    import fcntl
                    fcntl.flock(lf.fileno(), fcntl.LOCK_UN)
                except Exception:
                    pass
        return True
    except Exception as e:
        print(f"[CUPS Spooler] Unclaim notice ({e})")
        return False


class CupsController:
    """Interface to Linux CUPS spooler via pycups or fallback system CLI (lp/lpstat)."""

    def claim_order_for_spooling(self, order_id: str, aliases: Optional[List[str]] = None, force: bool = False) -> bool:
        return claim_order_for_spooling(order_id, aliases, force=force)

    def unclaim_order(self, order_id: str, aliases: Optional[List[str]] = None) -> bool:
        return unclaim_order(order_id, aliases)

    def __init__(self, host: str = "localhost", port: int = 631):
        self.host = host
        self.port = port
        self._conn = None
        self._last_state5_recovery: Dict[str, float] = {}
        if CUPS_AVAILABLE:
            with _CUPS_LOCK:
                try:
                    cups.setServer(self.host)
                    cups.setPort(self.port)
                    # Suppress interactive password prompts on stdin/terminal
                    try:
                        cups.setPasswordCB(lambda prompt: "")
                    except Exception:
                        pass
                    self._conn = cups.Connection()
                except Exception as e:
                    self._conn = None
                    self._init_error = str(e)
        else:
            self._init_error = "pycups not installed; using system CLI fallback (lp / lpstat)"

    def _get_connection(self):
        """Thread-safe acquisition or re-connection of pycups connection."""
        if not CUPS_AVAILABLE:
            return None
        with _CUPS_LOCK:
            if self._conn is None:
                try:
                    cups.setServer(self.host)
                    cups.setPort(self.port)
                    try:
                        cups.setPasswordCB(lambda prompt: "")
                    except Exception:
                        pass
                    self._conn = cups.Connection()
                except Exception as e:
                    self._conn = None
                    self._init_error = str(e)
            return self._conn

    @property
    def is_connected(self) -> bool:
        if self._conn is not None:
            return True
        if sys.platform != "win32":
            return shutil.which("lpstat") is not None
        return False

    def purge_all_jobs(self, printer_name: Optional[str] = None) -> Dict[str, Any]:
        """
        Purges and cancels all pending, held, or queued jobs from CUPS.
        Guarantees that on Pi boot and between jobs, no leftover jobs or ghost queue exists.
        """
        actions = []
        # 1. pycups cancelJob for all existing jobs
        conn = self._get_connection()
        if conn:
            try:
                with _CUPS_LOCK:
                    jobs = conn.getJobs(which_jobs="all", my_jobs=False)
                    for jid in list(jobs.keys()):
                        try:
                            conn.cancelJob(jid, purge_job=True)
                            actions.append(f"Cancelled CUPS job #{jid}")
                        except Exception:
                            try:
                                conn.cancelJob(jid)
                                actions.append(f"Cancelled CUPS job #{jid}")
                            except Exception:
                                pass
            except Exception as e:
                actions.append(f"pycups jobs query notice: {e}")
                with _CUPS_LOCK:
                    self._conn = None

        # 2. Linux CLI cancel -a -x / cancel -a / lprm -
        if sys.platform != "win32":
            target = printer_name or (self.get_printers().get("default") if hasattr(self, "get_printers") else None)
            cmd_lists = [
                ["cancel", "-a", "-x"],
                ["cancel", "-a"],
                ["lprm", "-"],
            ]
            if target and target != "auto":
                cmd_lists.insert(0, ["cancel", "-a", "-x", target])
                cmd_lists.insert(1, ["cancel", "-a", target])

            for cmd in cmd_lists:
                try:
                    subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, timeout=5)
                except Exception:
                    pass
                try:
                    subprocess.run(["sudo", "-n"] + cmd, stdin=subprocess.DEVNULL, capture_output=True, timeout=5)
                except Exception:
                    pass

        return {"success": True, "actions": actions}

    def check_usb_printer(self) -> Dict[str, Any]:
        """
        Runs 'lsusb' to verify whether physical printer (e.g. Brother) is connected to the USB bus.
        Checks for Brother vendor ID (04f9), 'brother', 'brothers', 'dcp-t420w', 'dcp-', 'mfc-', 'hl-',
        or printer class, and checks /dev/usb/lp* device nodes and /sys/bus/usb/devices.
        """
        if sys.platform == "win32":
            try:
                import win32print
                raw_printers = win32print.EnumPrinters(
                    win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
                )
                brother_match = next(
                    (p[2] for p in raw_printers if any(k in p[2].lower() for k in ["brother", "brothers", "dcp", "mfc", "hl-"])),
                    None
                )
                if brother_match:
                    return {
                        "connected": True,
                        "printerFound": brother_match,
                        "vendor": "Brother",
                        "busInfo": "USB/Spooler (Win32)",
                        "method": "win32_enum",
                    }
            except Exception:
                pass

            return {
                "connected": True,
                "printerFound": "Brother DCP-T420W (Windows Host)",
                "vendor": "Brother",
                "busInfo": "USB Host (Win32)",
                "method": "win32_simulated",
            }

        # Cache USB check result for 10 seconds to avoid hammering lsusb subprocess
        now = time.time()
        if hasattr(self, "_cached_usb_info") and hasattr(self, "_cached_usb_time"):
            if now - getattr(self, "_cached_usb_time", 0) < 10 and self._cached_usb_info:
                return self._cached_usb_info

        try:
            res = subprocess.run(["lsusb"], capture_output=True, text=True, timeout=3)
            raw_output = res.stdout if res.returncode == 0 else ""
            lines = raw_output.splitlines()

            matched_lines = []
            found_name = None
            found_vendor = None

            # Multi-vendor printer recognition:
            VENDOR_MAP = {
                "HP": ["03f0:", "hp", "hewlett", "smart tank", "deskjet", "laserjet", "ink tank", "officejet", "envy", "photosmart"],
                "Brother": ["04f9:", "brother", "brothers", "dcp", "mfc", "hl-"],
                "Epson": ["04b8:", "epson", "ecotank", "l3150", "l3250", "l4150", "workforce", "stylus"],
                "Canon": ["04a9:", "canon", "pixma", "maxify", "imageclass", "selphy"],
                "Samsung": ["04e8:", "samsung"],
                "Pantum": ["232b:", "pantum"],
            }

            for line in lines:
                lower = line.lower()
                for v_name, keywords in VENDOR_MAP.items():
                    if any(k in lower for k in keywords):
                        matched_lines.append(line.strip())
                        found_vendor = v_name
                        parts = line.split("ID", 1)
                        if len(parts) > 1 and len(parts[1].split(None, 1)) > 1:
                            found_name = parts[1].split(None, 1)[1].strip()
                        else:
                            found_name = line.strip()
                        break
                if found_vendor:
                    break
                elif "printer" in lower:
                    matched_lines.append(line.strip())
                    found_vendor = "Generic"
                    found_name = line.strip()
                    break

            # Also check sysfs USB descriptors if lsusb didn't match
            if not matched_lines:
                try:
                    sys_usb = "/sys/bus/usb/devices"
                    if os.path.exists(sys_usb):
                        for dev in os.listdir(sys_usb):
                            dev_path = os.path.join(sys_usb, dev)
                            mfg_path = os.path.join(dev_path, "manufacturer")
                            prod_path = os.path.join(dev_path, "product")
                            vendor_path = os.path.join(dev_path, "idVendor")

                            mfg = open(mfg_path).read().strip().lower() if os.path.exists(mfg_path) else ""
                            prod = open(prod_path).read().strip().lower() if os.path.exists(prod_path) else ""
                            vendor_id = open(vendor_path).read().strip().lower() if os.path.exists(vendor_path) else ""

                            combo = f"{vendor_id} {mfg} {prod}"
                            for v_name, keywords in VENDOR_MAP.items():
                                if any(k in combo for k in keywords):
                                    matched_lines.append(f"Sysfs USB device {dev}: {mfg} {prod} ({vendor_id})")
                                    found_vendor = v_name
                                    found_name = f"{mfg.title()} {prod.title()} ({dev})".strip()
                                    break
                            if found_vendor:
                                break
                except Exception:
                    pass

            # Also verify if /dev/usb/lp0 or similar kernel character device exists
            has_lp_node = os.path.exists("/dev/usb/lp0") or os.path.exists("/dev/usb/lp1")

            is_connected = bool(matched_lines or has_lp_node)
            now = time.time()
            if is_connected:
                self._last_usb_success_time = now
            elif hasattr(self, "_last_usb_success_time") and (now - getattr(self, "_last_usb_success_time", 0) < 40):
                # Grace period: keep connected if it was detected within the last 40 seconds to prevent transient lsusb blips
                is_connected = True

            result = {
                "connected": is_connected,
                "printerFound": found_name or ("Printer (/dev/usb/lp0)" if has_lp_node else None),
                "vendor": found_vendor or ("Generic" if is_connected else "Unknown"),
                "isBrother": (found_vendor == "Brother"),
                "isHP": (found_vendor == "HP"),
                "isEpson": (found_vendor == "Epson"),
                "hasLpDeviceNode": has_lp_node,
                "matchedLines": matched_lines,
                "rawLsusb": raw_output.strip(),
                "method": "lsusb",
            }
            self._cached_usb_info = result
            self._cached_usb_time = now
            return result
        except Exception as e:
            has_lp = os.path.exists("/dev/usb/lp0")
            now = time.time()
            is_conn = has_lp or (hasattr(self, "_last_usb_success_time") and (now - getattr(self, "_last_usb_success_time", 0) < 40))
            fallback_res = {
                "connected": is_conn,
                "error": str(e),
                "hasLpDeviceNode": has_lp,
                "method": "lsusb_fallback",
            }
            self._cached_usb_info = fallback_res
            self._cached_usb_time = now
            return fallback_res

    def _is_usb_printer_present(self) -> bool:
        """Helper checking if physical USB printer is enumerated on the Linux USB bus."""
        return self.check_usb_printer().get("connected", False)

    def auto_recover_printer(self, printer_name: Optional[str] = None) -> Dict[str, Any]:
        """
        Self-healing routine for Raspberry Pi CUPS printer:
        1. Checks if queue is STOPPED (state 5) or disabled. If so, enables and accepts jobs.
        2. Sets printer-error-policy=retry-current-job so CUPS does not disable queue when printer boots slowly.
        3. Scans lsusb for physical USB printer presence.
        4. If device is on USB but missing/broken in CUPS, detects current URI via lpinfo and re-binds.
        """
        if sys.platform == "win32":
            return {"success": True, "message": "Windows platform; CUPS auto-recover skipped"}

        target = printer_name or "PrintBooth_Printer"
        actions = []

        try:
            # 1. Ensure kernel usblp module is UNLOADED so CUPS libusb backend has full access to the USB printer
            # Only attempt rmmod if usblp is actually active in the kernel (checking /proc/modules requires zero root permissions)
            is_usblp_loaded = False
            try:
                if os.path.exists("/proc/modules"):
                    with open("/proc/modules", "r") as f:
                        is_usblp_loaded = any(line.startswith("usblp ") for line in f)
            except Exception:
                pass

            if is_usblp_loaded:
                subprocess.run(["sudo", "-n", "rmmod", "usblp"], capture_output=True, stdin=subprocess.DEVNULL, timeout=2)

            # 2. Re-enable ALL CUPS queues and accept incoming jobs
            # Using stdin=subprocess.DEVNULL and sudo -n completely prevents interactive password prompts
            subprocess.run(["cupsenable", "-a"], capture_output=True, stdin=subprocess.DEVNULL, timeout=2)
            subprocess.run(["cupsaccept", "-a"], capture_output=True, stdin=subprocess.DEVNULL, timeout=2)
            subprocess.run(["cupsenable", target], capture_output=True, stdin=subprocess.DEVNULL, timeout=2)
            subprocess.run(["cupsaccept", target], capture_output=True, stdin=subprocess.DEVNULL, timeout=2)
            subprocess.run(["sudo", "-n", "cupsenable", "-a"], capture_output=True, stdin=subprocess.DEVNULL, timeout=2)
            subprocess.run(["sudo", "-n", "cupsaccept", "-a"], capture_output=True, stdin=subprocess.DEVNULL, timeout=2)
            subprocess.run(["sudo", "-n", "cupsenable", target], capture_output=True, stdin=subprocess.DEVNULL, timeout=2)
            subprocess.run(["sudo", "-n", "cupsaccept", target], capture_output=True, stdin=subprocess.DEVNULL, timeout=2)
            actions.append(f"unpaused {target} and all CUPS queues")

            # 3. Ensure error policy is retry-current-job (prevents CUPS from disabling queue on power restart)
            subprocess.run(
                ["sudo", "-n", "lpadmin", "-p", target, "-o", "printer-error-policy=retry-current-job"],
                capture_output=True,
                stdin=subprocess.DEVNULL,
                timeout=2,
            )
            actions.append("set retry-current-job error policy")

            # 4. If connection is alive in pycups, enable through API
            conn = self._get_connection()
            if conn:
                try:
                    with _CUPS_LOCK:
                        conn.enablePrinter(target)
                        conn.acceptJobs(target)
                except Exception:
                    pass

            # 5. Check if URI needs re-binding if printer is on USB
            if self._is_usb_printer_present():
                try:
                    usb_info = self.check_usb_printer()
                    vendor = (usb_info.get("vendor") or "").lower()
                    lpinfo_out = subprocess.run(
                        ["lpinfo", "-v"],
                        capture_output=True,
                        stdin=subprocess.DEVNULL,
                        text=True,
                        timeout=3,
                    ).stdout
                    active_uri = None
                    for line in lpinfo_out.splitlines():
                        lower = line.lower()
                        if vendor == "hp" and any(k in lower for k in ["hp:/usb", "direct usb://hp", "usb://hp", "smart tank", "deskjet", "laserjet"]):
                            parts = line.split()
                            if len(parts) >= 2:
                                active_uri = parts[1]
                                break
                        elif vendor == "brother" and any(k in lower for k in ["brother", "dcp-t420w", "direct usb://brother"]):
                            parts = line.split()
                            if len(parts) >= 2:
                                active_uri = parts[1]
                                break
                        elif vendor == "epson" and any(k in lower for k in ["epson", "direct usb://epson"]):
                            parts = line.split()
                            if len(parts) >= 2:
                                active_uri = parts[1]
                                break
                        elif any(k in lower for k in ["direct usb://", "hp:/usb", "ipp://"]):
                            parts = line.split()
                            if len(parts) >= 2:
                                active_uri = parts[1]
                                break

                    # NOTE: NEVER fallback to raw 'usb:/dev/usb/lp0' character device as it breaks CUPS raster drivers!
                    if active_uri and not active_uri.startswith("usb:/dev/"):
                        subprocess.run(
                            ["sudo", "-n", "lpadmin", "-p", target, "-v", active_uri],
                            capture_output=True,
                            stdin=subprocess.DEVNULL,
                            timeout=2,
                        )
                        actions.append(f"re-bound URI to {active_uri}")
                except Exception:
                    pass

            # 6. Ensure default options for queue (copies=1, job-sheets=none,none, media=A4, PageSize=A4)
            subprocess.run(
                [
                    "lpoptions", "-p", target,
                    "-o", "copies=1",
                    "-o", "job-sheets=none,none",
                    "-o", "media=A4",
                    "-o", "PageSize=A4",
                    "-o", "PageRegion=A4",
                ],
                capture_output=True, stdin=subprocess.DEVNULL, timeout=2,
            )
            subprocess.run(
                [
                    "sudo", "-n", "lpadmin", "-p", target,
                    "-o", "job-sheets-default=none,none",
                    "-o", "copies-default=1",
                    "-o", "media=A4",
                    "-o", "PageSize=A4",
                    "-o", "PageRegion=A4",
                ],
                capture_output=True, stdin=subprocess.DEVNULL, timeout=2,
            )
            actions.append("set queue default media=A4 & PageSize=A4")

            print(f"[CUPS Auto-Recover] Actions executed for '{target}': {', '.join(actions)}")
            return {"success": True, "actions": actions}
        except Exception as e:
            return {"success": False, "error": str(e), "actions": actions}

    def wake_brother_printer(self, printer_name: Optional[str] = None):
        """
        Actively wakes up Brother printers (e.g. HL-L5210DW, DCP series) from deep sleep:
        1. Sets CUPS printer-error-policy=retry-current-job so CUPS NEVER disables the queue when printer sleeps.
        2. Sets usb-no-reattach-default=true and usb-unidir-default=true to prevent USB bus resets.
        3. Unpauses/enables all CUPS queues (cupsenable -a, cupsaccept -a).
        4. Disables Linux USB autosuspend on all Brother USB hardware (vendor 04f9).
        5. Sends a harmless PJL wakeup packet directly to /dev/usb/lp* to wake the fuser and engine processor.
        """
        if sys.platform == "win32":
            return

        target = printer_name or "PrintBooth_Printer"
        try:
            # 1. Ensure queue is active and accepting jobs
            subprocess.run(["cupsenable", "-a"], capture_output=True, stdin=subprocess.DEVNULL, timeout=2)
            subprocess.run(["cupsaccept", "-a"], capture_output=True, stdin=subprocess.DEVNULL, timeout=2)
            subprocess.run(["cupsenable", target], capture_output=True, stdin=subprocess.DEVNULL, timeout=2)
            subprocess.run(["cupsaccept", target], capture_output=True, stdin=subprocess.DEVNULL, timeout=2)

            # 2. Prevent CUPS from ever stopping queue on sleep delay
            subprocess.run(
                ["lpadmin", "-p", target, "-o", "printer-error-policy=retry-current-job", "-o", "usb-unidir-default=true", "-o", "usb-no-reattach-default=true"],
                capture_output=True,
                stdin=subprocess.DEVNULL,
                timeout=2,
            )

            # 3. Disable Linux USB autosuspend for Brother devices (vendor 04f9)
            usb_dev_path = Path("/sys/bus/usb/devices")
            if usb_dev_path.exists():
                for dev in usb_dev_path.iterdir():
                    try:
                        v_file = dev / "idVendor"
                        if v_file.exists() and v_file.read_text().strip().lower() == "04f9":
                            ctrl = dev / "power" / "control"
                            if ctrl.exists():
                                try:
                                    ctrl.write_text("on")
                                except Exception:
                                    subprocess.run(["sudo", "-n", "sh", "-c", f"echo on > {ctrl}"], capture_output=True, timeout=2)
                            auto_s = dev / "power" / "autosuspend"
                            if auto_s.exists():
                                try:
                                    auto_s.write_text("-1")
                                except Exception:
                                    subprocess.run(["sudo", "-n", "sh", "-c", f"echo -1 > {auto_s}"], capture_output=True, timeout=2)
                    except Exception:
                        pass

            # 4. PJL Wakeup Ping to spin up printer engine from sleep mode
            pjl_wake = b"\x1b%-12345X@PJL \r\n@PJL ECHO WAKE\r\n\x1b%-12345X"
            for usb_lp in ("/dev/usb/lp0", "/dev/usb/lp1"):
                if os.path.exists(usb_lp):
                    try:
                        with open(usb_lp, "wb") as f:
                            f.write(pjl_wake)
                            f.flush()
                        print(f"[CUPS] ⚡ Sent PJL wake-up pulse to Brother printer via {usb_lp}")
                        break
                    except Exception:
                        pass
        except Exception as e:
            print(f"[CUPS] Brother wakeup notice: {e}")

    def get_printers(self) -> Dict[str, Any]:
        """Discovers and returns all configured CUPS printers and their states with self-healing."""
        conn = self._get_connection()
        if conn:
            try:
                with _CUPS_LOCK:
                    raw_printers = conn.getPrinters()
                    default_p = conn.getDefault()
                printers = []
                for name, d in raw_printers.items():
                    state_code = d.get("printer-state", 3)
                    state_map = {3: "IDLE", 4: "PRINTING", 5: "STOPPED"}

                    # SELF-HEALING: If printer is STOPPED (5) on Linux, auto-recover (throttled to once per 45s)
                    if state_code == 5 and sys.platform != "win32":
                        now_ts = time.time()
                        last_rec = self._last_state5_recovery.get(name, 0)
                        if now_ts - last_rec > 45:
                            self._last_state5_recovery[name] = now_ts
                            print(f"[CUPS Controller] Detected STOPPED state (code 5) for '{name}'. Auto-recovering...")
                            self.auto_recover_printer(name)
                            try:
                                # Re-fetch state after recovery
                                with _CUPS_LOCK:
                                    raw_printers = conn.getPrinters()
                                d = raw_printers.get(name, d)
                                state_code = d.get("printer-state", 3)
                            except Exception:
                                pass

                    is_online = state_code in (3, 4)
                    uri = d.get("device-uri", "")
                    is_usb = "usb:" in uri.lower() or "lp0" in uri.lower() or "direct" in uri.lower()
                    is_net = any(k in uri.lower() for k in ["ipp:", "socket:", "http:", "lpd:", "wsd"])

                    # If printer connects over USB, verify physical USB bus via lsusb
                    usb_present = self._is_usb_printer_present() if is_usb else True
                    if is_usb and not usb_present and sys.platform != "win32":
                        is_online = False
                    elif usb_present and sys.platform != "win32":
                        is_online = True

                    printers.append({
                        "name": name,
                        "info": d.get("printer-info", name),
                        "state": state_map.get(state_code, "IDLE") if is_online else "DISCONNECTED",
                        "is_default": (name == default_p),
                        "is_online": is_online,
                        "device_uri": uri,
                        "is_usb": is_usb,
                        "usb_connected": usb_present if is_usb else True,
                        "connection_type": "USB" if is_usb else ("NETWORK" if is_net else "CUPS"),
                        "is_virtual": False,
                    })

                # If physical USB printer is present, ensure at least one printer is marked online
                if sys.platform != "win32" and self._is_usb_printer_present():
                    if printers:
                        for p in printers:
                            if p.get("is_usb"):
                                p["is_online"] = True
                                p["state"] = "READY"
                    else:
                        usb_info = self.check_usb_printer()
                        p_name = usb_info.get("printerFound") or "PrintBooth_Printer"
                        printers = [{
                            "name": "PrintBooth_Printer",
                            "info": p_name,
                            "state": "READY",
                            "is_default": True,
                            "is_online": True,
                            "is_usb": True,
                            "usb_connected": True,
                            "connection_type": "USB",
                            "is_virtual": False,
                        }]
                        default_p = "PrintBooth_Printer"

                return {"success": True, "printers": printers, "default": default_p}
            except Exception:
                with _CUPS_LOCK:
                    self._conn = None

        # Native Linux CUPS CLI query via lpstat on Linux/Pi (100% thread-safe & Python 3.13 immune)
        if sys.platform != "win32":
            try:
                out = subprocess.check_output(["lpstat", "-p", "-d"], text=True)
                uris = {}
                try:
                    v_out = subprocess.check_output(["lpstat", "-v"], text=True, stderr=subprocess.DEVNULL)
                    for v_line in v_out.splitlines():
                        if "device for " in v_line:
                            p_part, u_part = v_line.split("device for ", 1)[1].split(":", 1)
                            uris[p_part.strip()] = u_part.strip()
                except Exception:
                    pass

                usb_info = self.check_usb_printer()
                usb_present = bool(usb_info.get("connected", False))
                usb_model = usb_info.get("printerFound") or "PrintBooth Printer"

                printers = []
                default_p = None
                for line in out.splitlines():
                    if line.startswith("system default destination:"):
                        default_p = line.split(":", 1)[1].strip()
                    elif line.startswith("printer "):
                        parts = line.split()
                        p_name = parts[1]
                        is_disabled = "disabled" in line.lower()
                        if is_disabled:
                            print(f"[CUPS Controller] Printer '{p_name}' is disabled in lpstat. Auto-enabling...")
                            self.auto_recover_printer(p_name)
                            is_disabled = False
                        is_idle = "idle" in line.lower()
                        uri = uris.get(p_name, "")
                        is_usb = "usb:" in uri.lower() or "lp0" in uri.lower() or "direct" in uri.lower() or not uri
                        is_net = any(k in uri.lower() for k in ["ipp:", "socket:", "http:", "lpd:", "wsd"])

                        printer_online = (not is_disabled)
                        if is_usb:
                            if not usb_present:
                                printer_online = False
                            else:
                                printer_online = True

                        display_info = p_name
                        if usb_model and p_name.lower() in ("printbooth_printer", "printer", "cups"):
                            display_info = f"{usb_model} ({p_name})"
                        elif usb_model:
                            display_info = f"{p_name} ({usb_model})"

                        printers.append({
                            "name": p_name,
                            "info": display_info,
                            "state": "READY" if printer_online else "OFFLINE",
                            "is_default": (p_name == default_p),
                            "is_online": printer_online,
                            "device_uri": uri,
                            "is_usb": is_usb,
                            "usb_connected": usb_present,
                            "connection_type": "USB" if is_usb else ("NETWORK" if is_net else "CUPS"),
                            "is_virtual": False,
                        })

                if not default_p and printers:
                    printers[0]["is_default"] = True
                    default_p = printers[0]["name"]

                # If empty or offline, check USB presence
                if (not printers or not any(p.get("is_online") for p in printers)) and usb_present:
                    self.auto_recover_printer(default_p or "PrintBooth_Printer")
                    if not printers:
                        printers = [{
                            "name": "PrintBooth_Printer",
                            "info": usb_model,
                            "state": "READY",
                            "is_default": True,
                            "is_online": True,
                            "is_usb": True,
                            "usb_connected": True,
                            "connection_type": "USB",
                            "is_virtual": False,
                        }]
                        default_p = "PrintBooth_Printer"

                if printers:
                    return {"success": True, "printers": printers, "default": default_p}
            except Exception as e:
                print(f"[CUPS Controller] lpstat error notice: {e}")

        # Windows native print enumeration (for local dev test)
        if sys.platform == "win32":
            try:
                import sys as _sys
                from pathlib import Path as _Path
                root = str(_Path(__file__).resolve().parent.parent.parent)
                if root not in _sys.path:
                    _sys.path.insert(0, root)
                from services.printer.printer_detector import enumerate_all_printers, auto_detect_active_printer

                all_p = enumerate_all_printers()
                active_name, rep = auto_detect_active_printer()
                printers = []
                for p in all_p:
                    if p.get("is_virtual"):
                        continue
                    printers.append({
                        "name": p["name"],
                        "info": f"{p.get('driver', '')} ({p.get('port', '')})",
                        "state": "IDLE" if p.get("is_online") else "OFFLINE",
                        "is_default": (p["name"] == active_name or p.get("is_default", False)),
                        "is_online": p.get("is_online", True),
                        "device_uri": p.get("port", ""),
                        "is_usb": bool(p.get("is_usb", True)),
                        "connection_type": p.get("connection_type", "USB"),
                        "is_virtual": False,
                    })
                return {"success": True, "printers": printers, "default": active_name}
            except Exception:
                pass

        # Offline fallback (checks if physical USB hardware is present)
        usb_info = self.check_usb_printer()
        usb_on = bool(usb_info.get("connected", False)) if sys.platform != "win32" else False
        usb_model = usb_info.get("printerFound") or "PrintBooth Printer"
        fallback_queue = "PrintBooth_Printer"
        return {
            "success": True,
            "printers": [
                {
                    "name": fallback_queue,
                    "info": f"{usb_model} (Raspberry Pi USB)",
                    "state": "READY" if usb_on else "OFFLINE",
                    "is_default": True,
                    "is_online": usb_on,
                    "is_usb": True,
                    "usb_connected": usb_on,
                    "connection_type": "USB",
                    "is_virtual": False,
                }
            ],
            "default": fallback_queue,
        }

    def set_default_printer(self, printer_name: str) -> Dict[str, Any]:
        """Sets the active system default printer in CUPS on the Raspberry Pi."""
        clean_name = printer_name.strip()
        actions = []
        if not clean_name:
            return {"success": False, "error": "Empty printer name"}

        print(f"[CUPS Controller] Setting Raspberry Pi default printer to '{clean_name}'...")

        # 1. pycups setDefault
        conn = self._get_connection()
        if conn:
            try:
                with _CUPS_LOCK:
                    conn.setDefault(clean_name)
                actions.append("pycups setDefault")
            except Exception as e:
                actions.append(f"pycups failed: {e}")
                with _CUPS_LOCK:
                    self._conn = None

        # 2. lpadmin on Linux (Raspberry Pi)
        if sys.platform != "win32":
            try:
                subprocess.run(["lpadmin", "-d", clean_name], check=True, stdin=subprocess.DEVNULL, capture_output=True, timeout=5)
                actions.append("lpadmin -d")
            except Exception as e:
                try:
                    subprocess.run(["sudo", "-n", "lpadmin", "-d", clean_name], check=True, stdin=subprocess.DEVNULL, capture_output=True, timeout=5)
                    actions.append("sudo lpadmin -d")
                except Exception as e2:
                    actions.append(f"lpadmin failed: {e2}")

            # Ensure printer is enabled and accepting jobs
            self.auto_recover_printer(clean_name)

        # 3. Windows native fallback
        if sys.platform == "win32":
            try:
                import win32print
                win32print.SetDefaultPrinter(clean_name)
                actions.append("win32print SetDefaultPrinter")
            except Exception as e:
                actions.append(f"win32print failed: {e}")

        return {"success": True, "activePrinter": clean_name, "actions": actions}

    _office_convert_lock = threading.Lock()

    @classmethod
    def _convert_office_to_pdf(cls, src_path: Path) -> Path:
        """
        Converts Microsoft Office (.pptx, .ppt, .docx, .doc, .xlsx, .xls) and
        OpenDocument (.odt, .odp, .ods, .rtf, .txt) files to high-fidelity PDF.
        Uses headless LibreOffice / soffice on Linux / Raspberry Pi, or COM on Windows.
        Optimized with warm persistent cache, format-specific exporters, and fast-start flags.
        """
        src = Path(src_path)
        if not src.exists():
            return src

        suffix = src.suffix.lower()
        if suffix not in (
            ".pptx", ".ppt", ".docx", ".doc", ".xlsx", ".xls",
            ".odt", ".odp", ".ods", ".rtf", ".txt"
        ):
            return src

        out_dir = src.parent
        pdf_path = out_dir / f"{src.stem}.pdf"
        if pdf_path.exists() and pdf_path.stat().st_size > 0:
            if pdf_path.stat().st_mtime >= src.stat().st_mtime:
                print(f"[CUPS Controller] Using cached converted PDF: '{pdf_path.name}'")
                return pdf_path

        # 1. On Windows: fallback to win32com if available
        if sys.platform == "win32":
            try:
                if suffix in (".docx", ".doc"):
                    from services.printer.windows_printer import convert_word_to_pdf
                    return Path(convert_word_to_pdf(str(src)))
                elif suffix in (".pptx", ".ppt"):
                    from services.printer.windows_printer import convert_powerpoint_to_pdf
                    return Path(convert_powerpoint_to_pdf(str(src)))
            except Exception as e:
                print(f"[CUPS Controller] Windows COM office convert notice: {e}")

        # 2. Linux / cross-platform: Headless LibreOffice / soffice
        office_bin = shutil.which("libreoffice") or shutil.which("soffice")
        for candidate in ["/usr/bin/libreoffice", "/usr/bin/soffice", "/usr/local/bin/libreoffice"]:
            if not office_bin and os.path.exists(candidate):
                office_bin = candidate
                break

        if office_bin:
            with cls._office_convert_lock:
                # Re-verify cache inside lock in case another worker just finished converting
                if pdf_path.exists() and pdf_path.stat().st_size > 0:
                    if pdf_path.stat().st_mtime >= src.stat().st_mtime:
                        print(f"[CUPS Controller] Using cached converted PDF: '{pdf_path.name}'")
                        return pdf_path

                try:
                    print(f"[CUPS Controller] [OFFICE-CONVERT] Converting '{src.name}' ({suffix}) -> PDF via {office_bin}...")
                    t0 = time.time()

                    # Persistent user profile directory: avoids rebuilding registry caches on every run
                    shared_profile = Path("/tmp/libo_printbooth_shared")
                    shared_profile.mkdir(parents=True, exist_ok=True)
                    env_inst = f"-env:UserInstallation=file://{shared_profile.resolve()}"

                    # Explicit export filters bypass format guessing in LibreOffice
                    filter_spec = "pdf"
                    if suffix in (".pptx", ".ppt", ".odp"):
                        filter_spec = "pdf:impress_pdf_Export"
                    elif suffix in (".docx", ".doc", ".odt", ".rtf", ".txt"):
                        filter_spec = "pdf:writer_pdf_Export"
                    elif suffix in (".xlsx", ".xls", ".ods"):
                        filter_spec = "pdf:calc_pdf_Export"

                    cmd = [
                        office_bin,
                        "--headless",
                        "--invisible",
                        "--nodefault",
                        "--nofirststartwizard",
                        "--nolockcheck",
                        "--nologo",
                        "--norestore",
                        env_inst,
                        "--convert-to", filter_spec,
                        "--outdir", str(out_dir),
                        str(src.resolve()),
                    ]
                    res = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
                    elapsed = round(time.time() - t0, 2)

                    if pdf_path.exists() and pdf_path.stat().st_size > 0:
                        print(f"[CUPS Controller] ✓ Converted '{src.name}' -> '{pdf_path.name}' ({pdf_path.stat().st_size} bytes in {elapsed}s)")
                        return pdf_path

                    # If specific filter failed, attempt generic --convert-to pdf fallback
                    if res.returncode != 0:
                        print(f"[CUPS Controller] Retrying with generic pdf filter...")
                        generic_cmd = [
                            office_bin,
                            "--headless",
                            "--invisible",
                            "--nodefault",
                            "--nofirststartwizard",
                            "--nolockcheck",
                            "--nologo",
                            "--norestore",
                            env_inst,
                            "--convert-to", "pdf",
                            "--outdir", str(out_dir),
                            str(src.resolve()),
                        ]
                        res = subprocess.run(generic_cmd, capture_output=True, text=True, timeout=60)

                    if pdf_path.exists() and pdf_path.stat().st_size > 0:
                        print(f"[CUPS Controller] ✓ Converted '{src.name}' -> '{pdf_path.name}' ({pdf_path.stat().st_size} bytes)")
                        return pdf_path

                    # Also search out_dir for any fresh .pdf generated in the last 45s matching stem
                    now = time.time()
                    for cand in out_dir.glob("*.pdf"):
                        if (now - cand.stat().st_mtime) <= 45 and (cand.stem.lower() in src.stem.lower() or src.stem.lower() in cand.stem.lower()):
                            print(f"[CUPS Controller] ✓ Located converted PDF '{cand.name}'")
                            return cand

                    print(f"[CUPS Controller] LibreOffice conversion warning: exit={res.returncode}, stderr={res.stderr.strip()}")
                except subprocess.TimeoutExpired:
                    print(f"[CUPS Controller] LibreOffice conversion timed out after 60s for '{src.name}'")
                except Exception as e:
                    print(f"[CUPS Controller] LibreOffice execution error: {e}")

        # 3. Fallback to unoconv if installed
        if shutil.which("unoconv"):
            try:
                print(f"[CUPS Controller] [OFFICE-CONVERT] Converting '{src.name}' -> PDF via unoconv...")
                subprocess.run(["unoconv", "-f", "pdf", "-o", str(pdf_path), str(src)], timeout=45, capture_output=True)
                if pdf_path.exists() and pdf_path.stat().st_size > 0:
                    print(f"[CUPS Controller] ✓ Converted '{src.name}' via unoconv -> '{pdf_path.name}'")
                    return pdf_path
            except Exception as e:
                print(f"[CUPS Controller] unoconv error: {e}")

        print(
            f"[CUPS Controller] ⚠️ WARNING: Cannot convert '{src.name}' ({suffix}) to PDF because LibreOffice is not installed! "
            f"Please run on the kiosk: sudo apt-get install -y libreoffice-writer libreoffice-impress --no-install-recommends"
        )
        return src

    def prepare_printable_file(
        self,
        file_path: Path,
        colour_mode: str = "BW",
        paper_size: str = "A4",
        scaling: str = "FIT",
        orientation: str = "AUTO",
        convert_grayscale: bool = True,
    ) -> Path:
        """
        Converts non-PDF documents and images to standard print-ready PDF:
        1. Converts Microsoft Office documents (.pptx, .docx, .xlsx, etc.) to PDF via headless LibreOffice.
        2. Converts raster images (PNG, JPEG, WebP, etc.) to exact single-page PDFs with margins & scaling.
        3. Converts color PDFs to DeviceGray via Ghostscript when colour_mode == 'BW' and convert_grayscale is True.
        """
        p_path = Path(file_path)
        suffix = p_path.suffix.lower()
        is_color = str(colour_mode).upper() in ("COLOR", "COLOUR")
        norm_paper = str(paper_size or "A4").upper().strip()
        norm_scale = str(scaling or "FIT").upper().strip()
        norm_orient = str(orientation or "AUTO").upper().strip()

        # 1. Office Document conversion to standardized PDF
        if suffix in (".pptx", ".ppt", ".docx", ".doc", ".xlsx", ".xls", ".odt", ".odp", ".ods", ".rtf", ".txt"):
            converted_pdf = self._convert_office_to_pdf(p_path)
            if converted_pdf and converted_pdf.exists() and converted_pdf.suffix.lower() == ".pdf":
                p_path = converted_pdf
                suffix = ".pdf"

        # Paper pixel dimensions at 300 DPI
        PAPER_DIMS_300DPI = {
            "A4": (2480, 3508),
            "LETTER": (2550, 3300),
            "LEGAL": (2550, 4200),
            "A3": (3508, 4960),
            "A5": (1748, 2480),
        }
        base_w, base_h = PAPER_DIMS_300DPI.get(norm_paper, (2480, 3508))

        # 2. Raster Image conversion to standardized full-page PDF
        if suffix in (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".gif"):
            # Ensure PIL is available, auto-installing in venv if needed
            try:
                from PIL import Image
            except ImportError:
                try:
                    print("[CUPS Controller] Pillow missing in Python environment; auto-installing via pip...")
                    subprocess.run([sys.executable, "-m", "pip", "install", "pillow"], timeout=45, capture_output=True)
                    from PIL import Image
                except Exception as e:
                    print(f"[CUPS Controller] Auto-install pip notice: {e}")
                    Image = None

            if Image:
                try:
                    with Image.open(p_path) as im:
                        # Auto-orient EXIF camera orientation
                        try:
                            from PIL import ImageOps
                            im = ImageOps.exif_transpose(im)
                        except Exception:
                            pass

                        pdf_name = f"{'color' if is_color else 'mono'}_{p_path.stem}.pdf"
                        pdf_path = p_path.parent / pdf_name

                        # If already converted and cached, reuse immediately
                        if pdf_path.exists() and pdf_path.stat().st_size > 0:
                            return pdf_path

                        # Composite transparent alpha onto pure white background
                        if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
                            bg = Image.new("RGB", im.size, (255, 255, 255))
                            rgba_im = im.convert("RGBA")
                            bg.paste(rgba_im, mask=rgba_im.split()[-1])
                            base_im = bg
                        else:
                            base_im = im

                        # Target mode: 'L' for pure monochrome, 'RGB' for color
                        target_im = base_im.convert("RGB") if is_color else base_im.convert("L")
                        orig_w, orig_h = target_im.size
                        is_img_landscape = orig_w > orig_h

                        # Determine sheet orientation
                        if norm_orient == "LANDSCAPE":
                            canvas_landscape = True
                        elif norm_orient == "PORTRAIT":
                            canvas_landscape = False
                        else:  # AUTO: match the image aspect ratio
                            canvas_landscape = is_img_landscape

                        if canvas_landscape:
                            canvas_w, canvas_h = max(base_w, base_h), min(base_w, base_h)
                        else:
                            canvas_w, canvas_h = min(base_w, base_h), max(base_w, base_h)

                        # Define printable margins
                        # Use margin=0 so image covers the full A4 canvas without artificial shrinkage
                        margin = 0

                        avail_w = max(100, canvas_w - (margin * 2))
                        avail_h = max(100, canvas_h - (margin * 2))

                        resample_filter = getattr(Image, "Resampling", Image).LANCZOS

                        if norm_scale == "FILL":
                            # Fill canvas edge to edge, crop overflow
                            scale = max(avail_w / orig_w, avail_h / orig_h)
                            new_w = max(1, int(round(orig_w * scale)))
                            new_h = max(1, int(round(orig_h * scale)))
                            resized_im = target_im.resize((new_w, new_h), resample_filter)
                            crop_x = (new_w - avail_w) // 2
                            crop_y = (new_h - avail_h) // 2
                            final_im = resized_im.crop((crop_x, crop_y, crop_x + avail_w, crop_y + avail_h))
                            offset_x = margin
                            offset_y = margin
                        elif norm_scale in ("ACTUAL", "NONE"):
                            # Don't upscale, but shrink if exceeds canvas
                            scale = min(1.0, min(avail_w / orig_w, avail_h / orig_h))
                            new_w = max(1, int(round(orig_w * scale)))
                            new_h = max(1, int(round(orig_h * scale)))
                            final_im = target_im.resize((new_w, new_h), resample_filter) if scale < 1.0 else target_im
                            offset_x = (canvas_w - final_im.size[0]) // 2
                            offset_y = (canvas_h - final_im.size[1]) // 2
                        else:
                            # Default "FIT": Proportional scale (UPSCALES and DOWNSCALES) to fit full page
                            scale = min(avail_w / orig_w, avail_h / orig_h)
                            new_w = max(1, int(round(orig_w * scale)))
                            new_h = max(1, int(round(orig_h * scale)))
                            final_im = target_im.resize((new_w, new_h), resample_filter)
                            offset_x = (canvas_w - new_w) // 2
                            offset_y = (canvas_h - new_h) // 2

                        canvas_bg = (255, 255, 255) if is_color else 255
                        canvas = Image.new("RGB" if is_color else "L", (canvas_w, canvas_h), canvas_bg)
                        canvas.paste(final_im, (offset_x, offset_y))

                        # Save as single-page PDF with exact 300 DPI metadata
                        canvas.save(pdf_path, "PDF", resolution=300.0)
                        mode_label = "COLOR" if is_color else "8-bit Monochrome"
                        orient_label = "Landscape" if canvas_landscape else "Portrait"
                        print(
                            f"[CUPS Controller] [CONVERT] Pre-processed image '{p_path.name}' "
                            f"({orig_w}x{orig_h} -> scaled {final_im.size[0]}x{final_im.size[1]} on {canvas_w}x{canvas_h} {orient_label} {norm_paper} canvas, {mode_label}) -> '{pdf_path.name}'"
                        )
                        return pdf_path
                except Exception as e:
                    print(f"[CUPS Controller] Pillow image processing notice: {e}")

            # Fallback for Linux if ImageMagick convert exists
            if sys.platform != "win32" and shutil.which("convert"):
                try:
                    pdf_name = f"{'color' if is_color else 'mono'}_{p_path.stem}.pdf"
                    pdf_path = p_path.parent / pdf_name
                    # Upscale or downscale to full A4 page PDF
                    args = ["convert", str(p_path), "-page", "A4", "-gravity", "center", "-resize", "2400x3428"]
                    if not is_color:
                        args.extend(["-colorspace", "Gray"])
                    args.append(str(pdf_path))
                    subprocess.run(args, check=True, timeout=15)
                    if pdf_path.exists() and pdf_path.stat().st_size > 0:
                        print(f"[CUPS Controller] [CONVERT] ImageMagick converted image '{p_path.name}' -> '{pdf_path.name}'")
                        return pdf_path
                except Exception:
                    pass

        # 3. PDF Normalization & Monochrome DeviceGray enforcement
        elif suffix == ".pdf" and not is_color and convert_grayscale:
            mono_out = p_path.parent / f"mono_{p_path.stem}.pdf"
            if self._convert_pdf_to_monochrome(p_path, mono_out):
                print(f"[CUPS Controller] [CONVERT] Pre-converted PDF to pure DeviceGray -> '{mono_out.name}'")
                return mono_out

        return p_path

    def prepare_monochrome_file(self, file_path: Path) -> Path:
        """Backwards compatibility alias for prepare_printable_file in monochrome mode."""
        return self.prepare_printable_file(file_path, colour_mode="BW")

    def build_cups_options(
        self,
        copies: int = 1,
        colour_mode: str = "BW",
        duplex: str = "SINGLE",
        paper_size: str = "A4",
        page_range: Optional[str] = None,
        scaling: str = "FIT",
        pages_per_sheet: int = 1,
        orientation: str = "AUTO",
    ) -> Dict[str, str]:
        """Maps customer print options into standardized CUPS IPP and Brother PPD attributes."""
        # Normalize Paper Size
        norm_paper = (paper_size or "A4").upper().strip()
        ppd_paper = "A4"
        if norm_paper in ("LETTER", "USLETTER"):
            ppd_paper = "Letter"
        elif norm_paper == "LEGAL":
            ppd_paper = "Legal"
        elif norm_paper in ("LEDGER", "TABLOID", "11X17"):
            ppd_paper = "Ledger"
        elif norm_paper in ("A3", "A5", "A6", "EXECUTIVE", "INDIANLEGAL"):
            ppd_paper = norm_paper.capitalize()

        options: Dict[str, str] = {
            "media": ppd_paper,
            "PageSize": ppd_paper,
            "PageRegion": ppd_paper,
        }

        # Scaling / Margins:
        norm_scale = str(scaling or "FIT").upper().strip()
        if norm_scale in ("FILL", "FULL", "BORDERLESS"):
            options["fit-to-page"] = "true"
            options["fill"] = "true"
        elif norm_scale in ("ACTUAL", "NONE", "100", "ORIGINAL"):
            options["scaling"] = "100"
            options["natural-scaling"] = "100"
        else:
            # Standard "FIT" or "AUTO": scale to full page
            options["fit-to-page"] = "true"

        # Orientation
        norm_orient = str(orientation or "AUTO").upper().strip()
        if norm_orient == "LANDSCAPE":
            options["orientation-requested"] = "4"
            options["landscape"] = "true"
        elif norm_orient == "PORTRAIT":
            options["orientation-requested"] = "3"

        # Color vs Monochrome (ColorModel & print-color-mode are standard CUPS / IPP attributes)
        raw_c = str(colour_mode or "BW").upper().replace("&", "").strip()
        is_color = raw_c in ("COLOR", "COLOUR")
        if is_color:
            options["ColorModel"] = "RGB"
            options["print-color-mode"] = "color"
        else:
            options["ColorModel"] = "KGray"
            options["print-color-mode"] = "monochrome"

        # Apply Brother-specific PPD keys ONLY if Brother hardware is active
        try:
            usb_status = self.check_usb_printer()
            if usb_status.get("isBrother"):
                options["BRMonoColor"] = "FullColor" if is_color else "Mono"
        except Exception:
            pass

        # Duplex / Double-Sided Configuration
        # Injects universal CUPS IPP, Brother PPD (BRDuplex, JCLDuplex), and hardware PCL (Option1, Duplexer) flags.
        is_double = False
        is_short_edge = False
        if isinstance(duplex, bool):
            is_double = duplex
        elif isinstance(duplex, str):
            dup_str = duplex.strip().upper()
            if dup_str in (
                "DOUBLE", "DUPLEX", "TWO_SIDED", "TWO-SIDED", "2-SIDED", "2_SIDED",
                "TWO_SIDED_LONG", "TWO-SIDED-LONG-EDGE", "LONG_EDGE", "VERTICAL", "TRUE", "1"
            ):
                is_double = True
            elif dup_str in (
                "TWO_SIDED_SHORT", "TWO-SIDED-SHORT-EDGE", "SHORT_EDGE", "HORIZONTAL"
            ):
                is_double = True
                is_short_edge = True

        if is_double:
            if is_short_edge:
                options["sides"] = "two-sided-short-edge"
                options["Duplex"] = "DuplexTumble"
                options["BRDuplex"] = "DuplexTumble"
                options["JCLDuplex"] = "DuplexTumble"
                options["DuplexType"] = "2"
                options["Option1"] = "True"
                options["Duplexer"] = "Installed"
            else:
                options["sides"] = "two-sided-long-edge"
                options["Duplex"] = "DuplexNoTumble"
                options["BRDuplex"] = "DuplexNoTumble"
                options["JCLDuplex"] = "DuplexNoTumble"
                options["DuplexType"] = "1"
                options["Option1"] = "True"
                options["Duplexer"] = "Installed"
        else:
            # For printers that have duplex capability (like Brother HL series), explicitly declare single-sided
            # so the printer does not retain an active duplex hardware mode from a previous job.
            # Avoid sending to known simplex-only ink tank printers (like DCP-T420W) where unknown keys trigger filter errors.
            try:
                usb_status = self.check_usb_printer()
                model_str = str(usb_status.get("printerFound", "") or "").upper()
                is_simplex_inktank = any(m in model_str for m in ["T420", "T220", "T310", "T510", "T520", "T720", "T820"])
                if not is_simplex_inktank:
                    options["sides"] = "one-sided"
                    options["Duplex"] = "None"
                    options["BRDuplex"] = "None"
                    options["JCLDuplex"] = "None"
            except Exception:
                options["sides"] = "one-sided"
                options["Duplex"] = "None"

        # Page Ranges
        if page_range and page_range.upper() not in ("ALL", ""):
            options["page-ranges"] = str(page_range).replace(" ", "")

        # N-Up (pages per sheet)
        if pages_per_sheet and int(pages_per_sheet) > 1:
            options["number-up"] = str(pages_per_sheet)

        return options

    @staticmethod
    def _parse_page_range(range_str: Any, total_pages: int) -> List[int]:
        """Parses human page ranges into 1-indexed page list. E.g. '1,3' -> [1, 3]"""
        if total_pages <= 0:
            return [1]
        if isinstance(range_str, (list, tuple, set)):
            clean = [int(p) for p in range_str if 1 <= int(p) <= total_pages]
            return sorted(set(clean)) if clean else list(range(1, total_pages + 1))
        val = (str(range_str) if range_str is not None else "").strip().lower()
        if val in ("", "all", "*"):
            return list(range(1, total_pages + 1))
        if val.startswith("[") and val.endswith("]"):
            try:
                import json
                arr = json.loads(val)
                if isinstance(arr, list):
                    clean = [int(p) for p in arr if 1 <= int(p) <= total_pages]
                    if clean:
                        return sorted(set(clean))
            except Exception:
                pass
        selected = set()
        for part in val.split(","):
            part = part.strip()
            if not part:
                continue
            if "-" in part:
                pieces = part.split("-", 1)
                try:
                    s, e = int(pieces[0]), int(pieces[1])
                    for x in range(s, e + 1):
                        if 1 <= x <= total_pages:
                            selected.add(x)
                except ValueError:
                    pass
            else:
                try:
                    x = int(part)
                    if 1 <= x <= total_pages:
                        selected.add(x)
                except ValueError:
                    pass
        return sorted(selected) if selected else list(range(1, total_pages + 1))

    @staticmethod
    def _get_pdf_page_count(path: Path) -> int:
        """Determines total pages in a PDF document using PyMuPDF, pypdf, or pdfinfo."""
        try:
            import pymupdf  # type: ignore
            doc = pymupdf.open(str(path))
            cnt = len(doc)
            doc.close()
            if cnt > 0:
                return cnt
        except Exception:
            pass

        try:
            import pypdf  # type: ignore
            reader = pypdf.PdfReader(str(path))
            cnt = len(reader.pages)
            if cnt > 0:
                return cnt
        except Exception:
            pass

        if shutil.which("pdfinfo"):
            try:
                res = subprocess.run(["pdfinfo", str(path)], capture_output=True, text=True, timeout=5)
                for line in res.stdout.splitlines():
                    if line.startswith("Pages:"):
                        return int(line.split(":", 1)[1].strip())
            except Exception:
                pass

        return 1

    @staticmethod
    def _wait_for_job_spool(printer: str, job_id: Optional[str] = None, timeout: int = 45) -> Dict[str, Any]:
        """
        Waits for a CUPS print job to clear the active raster queue, exactly like LePrint.
        Polls lpstat -o <job_id> until job completes or errors.
        """
        if sys.platform == "win32":
            return {"success": True}

        start_time = time.time()
        time.sleep(0.5)

        while time.time() - start_time < timeout:
            try:
                # 1. Poll specific CUPS job ID if known
                if job_id:
                    stat_res = subprocess.run(["lpstat", "-o", job_id], capture_output=True, text=True, timeout=5)
                    stat_out = (stat_res.stdout or "").strip().lower()

                    # If job is not in the queue, it has finished processing/spooling!
                    if not stat_out or job_id.lower() not in stat_out:
                        elapsed = round(time.time() - start_time, 1)
                        print(f"[CUPS] ✓ Job '{job_id}' completed and cleared CUPS filter queue ({elapsed}s)")
                        return {"success": True, "elapsed": elapsed}

                    # Check for failure states
                    if any(err_k in stat_out for err_k in ["aborted", "stopped", "error"]):
                        print(f"[CUPS] ❌ Job '{job_id}' encountered error in CUPS queue: {stat_out}")
                        return {"success": False, "error": f"CUPS job failed: {stat_out}"}

                # 2. General printer queue poll
                res = subprocess.run(["lpstat", "-o", printer], capture_output=True, text=True, timeout=5)
                if not job_id and not res.stdout.strip():
                    elapsed = round(time.time() - start_time, 1)
                    print(f"[CUPS] ✓ Spool queue cleared ({elapsed}s)")
                    return {"success": True, "elapsed": elapsed}

                # Check if printer became disabled/paused
                p_stat = subprocess.run(["lpstat", "-p", printer], capture_output=True, text=True, timeout=3)
                if "disabled" in p_stat.stdout.lower() or "paused" in p_stat.stdout.lower():
                    print(f"[CUPS] ⚠ WARNING: Printer '{printer}' queue was paused/disabled! Auto-unpausing...")
                    subprocess.run(["cupsenable", printer], timeout=3)
                    subprocess.run(["cupsaccept", printer], timeout=3)

            except Exception as e:
                print(f"[CUPS] Spool queue monitor notice: {e}")
                break
            time.sleep(1.2)

        print(f"[CUPS] Spool queue wait finished after {round(time.time() - start_time, 1)}s")
        return {"success": True}

    @staticmethod
    def _extract_pdf_pages(src_path: Path, pages_1_indexed: List[int], dest_path: Path) -> bool:
        """
        Extracts specific pages (1-indexed) from a PDF into dest_path.
        Features 5-layer fault-tolerant fallback:
          1. PyMuPDF (fitz)
          2. pypdf (with auto-install fallback)
          3. Ghostscript (-sPageList)
          4. Poppler utils (pdfseparate / pdfunite)
          5. pdftk
        """
        if not pages_1_indexed:
            return False

        # Method 1: PyMuPDF (fitz)
        try:
            with _MUPDF_LOCK:
                import pymupdf  # type: ignore
                src = pymupdf.open(str(src_path))
                dst = pymupdf.open()
                for p in pages_1_indexed:
                    if 1 <= p <= len(src):
                        dst.insert_pdf(src, from_page=p - 1, to_page=p - 1)
                dst.save(str(dest_path))
                dst.close()
                src.close()
            if dest_path.exists() and dest_path.stat().st_size > 0:
                return True
        except ImportError:
            pass
        except Exception as e:
            print(f"[CUPS] PyMuPDF page extract notice: {e}")

        # Method 2: pypdf (with auto-pip-install)
        pypdf_mod = None
        try:
            import pypdf as pypdf_mod  # type: ignore
        except ImportError:
            try:
                print("[CUPS] pypdf missing; auto-installing via pip...")
                subprocess.run([sys.executable, "-m", "pip", "install", "pypdf", "--quiet"], timeout=35, capture_output=True)
                import pypdf as pypdf_mod  # type: ignore
            except Exception as e:
                print(f"[CUPS] pypdf pip auto-install notice: {e}")

        if pypdf_mod is not None:
            try:
                reader = pypdf_mod.PdfReader(str(src_path))
                writer = pypdf_mod.PdfWriter()
                for p in pages_1_indexed:
                    if 1 <= p <= len(reader.pages):
                        writer.add_page(reader.pages[p - 1])
                with open(dest_path, "wb") as f:
                    writer.write(f)
                if dest_path.exists() and dest_path.stat().st_size > 0:
                    return True
            except Exception as e:
                print(f"[CUPS] pypdf page extract error: {e}")

        # Method 3: Ghostscript with -sPageList
        gs_bin = shutil.which("gs") or ("/usr/bin/gs" if os.path.exists("/usr/bin/gs") else None)
        if gs_bin:
            try:
                pages_str = ",".join(str(p) for p in pages_1_indexed)
                gs_cmd = [
                    gs_bin,
                    "-sDEVICE=pdfwrite",
                    "-dNOPAUSE",
                    "-dBATCH",
                    "-dSAFER",
                    f"-sPageList={pages_str}",
                    f"-sOutputFile={dest_path}",
                    str(src_path),
                ]
                res = subprocess.run(gs_cmd, capture_output=True, timeout=30)
                if res.returncode == 0 and dest_path.exists() and dest_path.stat().st_size > 0:
                    return True
            except Exception as e:
                print(f"[CUPS] Ghostscript page extract notice: {e}")

        # Method 4: pdfseparate & pdfunite (poppler-utils)
        pdfseparate_bin = shutil.which("pdfseparate") or ("/usr/bin/pdfseparate" if os.path.exists("/usr/bin/pdfseparate") else None)
        if pdfseparate_bin:
            try:
                temp_parts = []
                temp_dir = dest_path.parent
                for p in pages_1_indexed:
                    part_pattern = temp_dir / f"tmp_slice_{p}_%d.pdf"
                    part_out = temp_dir / f"tmp_slice_{p}_{p}.pdf"
                    res = subprocess.run([pdfseparate_bin, "-f", str(p), "-l", str(p), str(src_path), str(part_pattern)], capture_output=True, timeout=10)
                    if part_out.exists() and part_out.stat().st_size > 0:
                        temp_parts.append(part_out)

                if temp_parts:
                    if len(temp_parts) == 1:
                        shutil.copy2(str(temp_parts[0]), str(dest_path))
                        try: temp_parts[0].unlink()
                        except Exception: pass
                        if dest_path.exists() and dest_path.stat().st_size > 0:
                            return True
                    else:
                        pdfunite_bin = shutil.which("pdfunite") or ("/usr/bin/pdfunite" if os.path.exists("/usr/bin/pdfunite") else None)
                        if pdfunite_bin:
                            unite_cmd = [pdfunite_bin] + [str(t) for t in temp_parts] + [str(dest_path)]
                            subprocess.run(unite_cmd, capture_output=True, timeout=15)
                            for t in temp_parts:
                                try: t.unlink()
                                except Exception: pass
                            if dest_path.exists() and dest_path.stat().st_size > 0:
                                return True
            except Exception as e:
                print(f"[CUPS] poppler page extract notice: {e}")

        # Method 5: pdftk
        pdftk_bin = shutil.which("pdftk") or ("/usr/bin/pdftk" if os.path.exists("/usr/bin/pdftk") else None)
        if pdftk_bin:
            try:
                pages_strs = [str(p) for p in pages_1_indexed]
                cmd = [pdftk_bin, str(src_path), "cat"] + pages_strs + ["output", str(dest_path)]
                res = subprocess.run(cmd, capture_output=True, timeout=20)
                if res.returncode == 0 and dest_path.exists() and dest_path.stat().st_size > 0:
                    return True
            except Exception as e:
                print(f"[CUPS] pdftk page extract notice: {e}")

        return False

    @staticmethod
    def _convert_pdf_to_monochrome(src_path: Path, dest_path: Path) -> bool:
        """Converts PDF pages into pure DeviceGray via Ghostscript or PyMuPDF rasterization."""
        if not src_path.exists():
            return False

        # If already mono, avoid duplicate conversion
        if src_path.name.startswith("mono_") and src_path == dest_path:
            return True
        if dest_path.exists() and dest_path.stat().st_size > 0 and dest_path != src_path:
            return True

        # Method 1: Ghostscript DeviceGray
        gs_bin = shutil.which("gs") or ("/usr/bin/gs" if os.path.exists("/usr/bin/gs") else None)
        if gs_bin:
            try:
                gs_cmd = [
                    gs_bin,
                    "-sDEVICE=pdfwrite",
                    "-dColorConversionStrategy=Gray",
                    "-dProcessColorModel=/DeviceGray",
                    "-dCompatibilityLevel=1.4",
                    "-dNOPAUSE",
                    "-dBATCH",
                    "-dSAFER",
                    f"-sOutputFile={dest_path}",
                    str(src_path),
                ]
                res = subprocess.run(gs_cmd, capture_output=True, timeout=25)
                if res.returncode == 0 and dest_path.exists() and dest_path.stat().st_size > 0:
                    return True
            except Exception as e:
                print(f"[CUPS] Ghostscript mono conversion notice: {e}")

        # Method 2: PyMuPDF raster fallback (serialized with global lock for Python 3.13 thread-safety)
        try:
            with _MUPDF_LOCK:
                import pymupdf  # type: ignore
                doc = pymupdf.open(str(src_path))
                out_doc = pymupdf.open()
                for page in doc:
                    pix = page.get_pixmap(colorspace=pymupdf.csGRAY, dpi=300)
                    rect = page.rect
                    new_page = out_doc.new_page(width=rect.width, height=rect.height)
                    new_page.insert_image(rect, pixmap=pix)
                out_doc.save(str(dest_path))
                out_doc.close()
                doc.close()
            if dest_path.exists() and dest_path.stat().st_size > 0:
                return True
        except Exception as e:
            print(f"[CUPS] PyMuPDF mono conversion notice: {e}")

        return False

    def _wait_for_job_spool(self, printer_name: str, job_id: Optional[str] = None, timeout: int = 90, expected_pages: int = 1) -> bool:
        """
        Synchronously monitors CUPS until the job has completed and cleared from the queue,
        guaranteeing synchronous execution before the next job or page can start.
        Tracks physical page output if /var/log/cups/page_log is present.
        """
        start = time.time()
        clean_id = job_id.strip() if job_id else None
        job_numeric = clean_id.split("-")[-1] if clean_id and "-" in clean_id else clean_id

        # Allow initial CUPS rasterizer spinup (at least 2.5s for laser engines, scaled by page count)
        safe_pages = max(1, int(expected_pages or 1))
        min_hardware_wait = max(2.5, min(15.0, safe_pages * 1.2))
        print(f"[CUPS Spooler] Monitoring job '{clean_id}' ({safe_pages} pages expected, min wait: {min_hardware_wait:.1f}s)...")
        time.sleep(1.8)

        last_logged_pages = 0

        while time.time() - start < timeout:
            # 1. Check /var/log/cups/page_log for real hardware page ejections
            if os.path.exists("/var/log/cups/page_log") and job_numeric:
                try:
                    with open("/var/log/cups/page_log", "r") as pf:
                        lines = pf.readlines()[-40:]
                        matched_pages = 0
                        for pl in lines:
                            parts = pl.split()
                            if len(parts) >= 8 and parts[2] == job_numeric:
                                matched_pages += 1
                        if matched_pages > last_logged_pages:
                            last_logged_pages = matched_pages
                            print(f"[CUPS Spooler] 📄 Physical hardware printed page {matched_pages}/{safe_pages} for job '{clean_id}'")
                        if safe_pages > 0 and matched_pages >= safe_pages:
                            print(f"[CUPS Spooler] ✓ Confirmed physical page log: All {safe_pages} pages printed for '{clean_id}'.")
                            return True
                except Exception:
                    pass

            # 2. Check active spool queue via lpstat -o
            try:
                cmd = ["lpstat", "-o", printer_name] if printer_name else ["lpstat", "-o"]
                out = subprocess.check_output(cmd, text=True, stderr=subprocess.DEVNULL)
                has_active = bool(out.strip())

                elapsed = time.time() - start
                # Only declare complete if minimum hardware time elapsed and queue is clear of this job
                if elapsed >= min_hardware_wait:
                    if not has_active:
                        print(f"[CUPS Spooler] ✓ Active queue for '{printer_name}' is completely clear. Hardware completed {safe_pages} pages.")
                        return True
                    if clean_id and clean_id not in out:
                        print(f"[CUPS Spooler] ✓ Job '{clean_id}' has cleared from active queue. Hardware completed.")
                        return True
            except Exception:
                if time.time() - start >= min_hardware_wait:
                    return True

            time.sleep(0.8)

        print(f"[CUPS Spooler] Hardware sync wait timeout ({timeout}s) reached; proceeding.")
        return True

    def print_file(
        self,
        file_path: str,
        copies: int = 1,
        colour_mode: str = "BW",
        duplex: str = "SINGLE",
        paper_size: str = "A4",
        page_range: Optional[str] = None,
        selected_pages: Optional[Any] = None,
        scaling: str = "FIT",
        pages_per_sheet: int = 1,
        printer_name: Optional[str] = None,
        job_title: str = "PrintBooth Document",
        page_colours: Optional[Any] = None,
        page_copies: Optional[Any] = None,
        orientation: str = "AUTO",
    ) -> Dict[str, Any]:
        """Dispatches a document file directly to the CUPS spooler with per-page color support."""
        p_path = Path(file_path)
        if not p_path.exists():
            return {"success": False, "error": f"File does not exist: {file_path}"}

        printer = printer_name if printer_name and printer_name != "auto" else None

        # Resolve printer
        printers_info = self.get_printers()
        valid_printers = [p.get("name") for p in printers_info.get("printers", []) if p.get("name")]
        default_printer = printers_info.get("default")

        # If a specific printer name was requested but doesn't exist in active CUPS queues, fallback to default or first available
        if printer and valid_printers and printer not in valid_printers:
            print(f"[CUPS Spooler] ⚠️ Requested queue '{printer}' does NOT exist in active CUPS queues: {valid_printers}. Falling back to '{default_printer or valid_printers[0]}'.")
            printer = default_printer or valid_printers[0]

        if not printer:
            printer = default_printer or (valid_printers[0] if valid_printers else None)

        if not printer and printers_info.get("printers"):
            printer = printers_info["printers"][0]["name"]

        if not printer:
            return {"success": False, "error": "No CUPS printer available on this station"}

        raw_c = str(colour_mode or "BW").upper().replace("&", "").strip()
        is_color = raw_c in ("COLOR", "COLOUR")
        clean_copies = max(1, int(copies or 1))

        # Parse per-page colour map
        parsed_page_colours = {}
        if page_colours:
            if isinstance(page_colours, str):
                try:
                    parsed_page_colours = json.loads(page_colours)
                    if isinstance(parsed_page_colours, str):
                        parsed_page_colours = json.loads(parsed_page_colours)
                except Exception:
                    parsed_page_colours = {}
            elif isinstance(page_colours, dict):
                parsed_page_colours = page_colours

        col_map: Dict[int, str] = {}
        for k, v in parsed_page_colours.items():
            try:
                p_num = int(k)
                if isinstance(v, dict):
                    v_str = str(v.get("mode") or v.get("colour") or v.get("color") or "")
                elif isinstance(v, bool):
                    v_str = "COLOUR" if v else "BW"
                else:
                    v_str = str(v)
                v_norm = v_str.upper().replace("&", "").strip()
                col_map[p_num] = "COLOUR" if v_norm in ("COLOUR", "COLOR") else "BW"
            except (ValueError, TypeError):
                continue

        if col_map:
            print(f"[CUPS] 🎨 Parsed per-page colour overrides: {col_map}")

        # 1. Normalize document: Convert Office (.pptx, .docx, .xlsx, etc.) & images to standard PDF
        has_page_colours = bool(col_map)
        p_path = self.prepare_printable_file(
            p_path,
            colour_mode=colour_mode,
            paper_size=paper_size,
            scaling=scaling,
            orientation=orientation,
            convert_grayscale=(not has_page_colours and not is_color),
        )

        suffix = p_path.suffix.lower()
        if suffix in (".pptx", ".ppt", ".docx", ".doc", ".xlsx", ".xls", ".odt", ".odp"):
            err_msg = (
                f"Unsupported document format '{suffix}' for hardware printing. "
                "LibreOffice is required to convert Office files to PDF. "
                "Please run on the kiosk: sudo apt-get install -y libreoffice-writer libreoffice-impress --no-install-recommends"
            )
            print(f"[CUPS] ❌ {err_msg}")
            return {"success": False, "error": err_msg, "printer": printer}

        # Inspect pages
        is_pdf = suffix == ".pdf"
        total_pages = self._get_pdf_page_count(p_path) if is_pdf else 1
        if selected_pages is not None:
            if isinstance(selected_pages, (list, tuple, set)):
                clean_p = [int(p) for p in selected_pages if 1 <= int(p) <= total_pages]
                selected_pages = sorted(set(clean_p)) if clean_p else self._parse_page_range(page_range, total_pages)
            else:
                selected_pages = self._parse_page_range(selected_pages, total_pages)
        else:
            selected_pages = self._parse_page_range(page_range, total_pages)

        # Map each selected page to its exact color mode
        page_modes: Dict[int, str] = {}
        for p in selected_pages:
            if p in col_map:
                page_modes[p] = col_map[p]
            else:
                page_modes[p] = "COLOUR" if is_color else "BW"

        has_mixed_colors = is_pdf and len(selected_pages) > 1 and len(set(page_modes.values())) > 1

        # Check if duplex (two-sided) printing is requested
        is_duplex_job = False
        if isinstance(duplex, bool):
            is_duplex_job = duplex
        elif isinstance(duplex, str):
            is_duplex_job = duplex.strip().upper() in (
                "DOUBLE", "DUPLEX", "TWO_SIDED", "TWO-SIDED", "2-SIDED", "2_SIDED",
                "TWO_SIDED_LONG", "TWO-SIDED-LONG-EDGE", "TWO_SIDED_SHORT", "TWO-SIDED-SHORT-EDGE",
                "SHORT_EDGE", "LONG_EDGE", "VERTICAL", "HORIZONTAL", "TRUE", "1"
            )

        # CRITICAL DUPLEX RULE:
        # If double-sided printing is requested, we MUST NOT split pages into multiple sequential CUPS jobs!
        # Multiple jobs force CUPS to eject the sheet and pull a new sheet of paper, destroying two-sided printing.
        if is_duplex_job and has_mixed_colors:
            print("[CUPS] ⚡ Duplex print requested with mixed colors: keeping in single unified job to preserve 2-sided sheet feeding.")
            has_mixed_colors = False
            if any(m == "COLOUR" for m in page_modes.values()):
                colour_mode = "COLOUR"

        print(
            f"[CUPS] Print job '{p_path.name}' | Total pages: {total_pages} | "
            f"Selected: {selected_pages} | Mixed colors: {has_mixed_colors} | Duplex: {is_duplex_job}"
        )

        # ── Mixed Colour & Monochrome Pages (Raspberry Pi / Linux) ──
        # Brother hardware cannot switch between Mono and FullColor mid-spool in a single job.
        # Partition contiguous pages into matching color mode groups and dispatch sequentially (simplex only).
        if has_mixed_colors and sys.platform != "win32":
            groups = []
            for p in selected_pages:
                p_mode = page_modes[p]
                if not groups or groups[-1]["mode"] != p_mode:
                    groups.append({"mode": p_mode, "pages": [p]})
                else:
                    groups[-1]["pages"].append(p)

            print(f"[CUPS] Dispatching mixed print in {len(groups)} sequential group(s):")
            for idx, grp in enumerate(groups, 1):
                print(f"  Group {idx}: Pages {grp['pages']} -> Mode {grp['mode']}")

            outputs = []
            temp_files_to_clean = []

            try:
                for copy_idx in range(1, clean_copies + 1):
                    for grp_idx, grp in enumerate(groups, 1):
                        grp_mode = grp["mode"]
                        grp_pages = grp["pages"]
                        is_grp_color = (grp_mode == "COLOUR")

                        # Extract sub-PDF for this specific group
                        grp_sub_name = f"sub_{p_path.stem}_c{copy_idx}_g{grp_idx}_{grp_mode.lower()}.pdf"
                        grp_sub_path = p_path.parent / grp_sub_name
                        temp_files_to_clean.append(grp_sub_path)

                        if not self._extract_pdf_pages(p_path, grp_pages, grp_sub_path):
                            print(f"[CUPS] Page extraction fallback: using target file with -P")
                            grp_sub_path = p_path
                            grp_range_arg = ",".join(str(x) for x in grp_pages)
                            if not is_grp_color:
                                mono_fallback = p_path.parent / f"mono_fallback_c{copy_idx}_g{grp_idx}_{p_path.name}"
                                if self._convert_pdf_to_monochrome(p_path, mono_fallback):
                                    temp_files_to_clean.append(mono_fallback)
                                    grp_sub_path = mono_fallback
                        else:
                            grp_range_arg = None
                            if not is_grp_color:
                                mono_out = p_path.parent / f"mono_{grp_sub_name}"
                                if self._convert_pdf_to_monochrome(grp_sub_path, mono_out):
                                    temp_files_to_clean.append(mono_out)
                                    grp_sub_path = mono_out

                        # Configure Brother hardware register for this group
                        if self.check_usb_printer().get("isBrother"):
                            for br_bin in ["/usr/bin/brprintconf_dcpt420w", "/opt/brother/Printers/dcpt420w/lpd/brprintconf_dcpt420w"]:
                                if os.path.exists(br_bin):
                                    try:
                                        corm_arg = "FullColor" if is_grp_color else "Mono"
                                        subprocess.run([br_bin, "-corm", corm_arg, "-copies", "1"], timeout=2, capture_output=True)
                                        print(f"[CUPS] Brother hardware register set: {br_bin} -corm {corm_arg} -copies 1")
                                    except Exception as e:
                                        print(f"[CUPS] Brother hardware config notice: {e}")
                                    break

                        grp_opts = self.build_cups_options(
                            copies=1,
                            colour_mode=grp_mode,
                            duplex=duplex,
                            paper_size=paper_size,
                            scaling=scaling,
                            pages_per_sheet=pages_per_sheet,
                            orientation=orientation,
                        )

                        cmd = ["lp", "-c", "-d", printer, "-n", "1"]
                        if grp_range_arg:
                            cmd.extend(["-P", grp_range_arg])

                        for k, v in grp_opts.items():
                            if k == "copies":
                                continue
                            cmd.extend(["-o", f"{k}={v}"])

                        cmd.append(str(grp_sub_path.resolve()))
                        print(f"[CUPS CLI] Submitting Group {grp_idx}/{len(groups)} (Copy {copy_idx}/{clean_copies}): {' '.join(cmd)}")
                        out = subprocess.check_output(cmd, stderr=subprocess.STDOUT, text=True)
                        outputs.append(out.strip())

                        # Parse submitted job ID: e.g. "request id is PrintBooth_Printer-72 (1 file(s))"
                        job_match = re.search(r"request id is ([^\s]+)", out)
                        submitted_job_id = job_match.group(1) if job_match else None

                        # If there is another group or copy following this, wait for current job to clear
                        # the CUPS raster filter queue so Brother hardware register (Mono vs FullColor)
                        # does not get overwritten before the filter finishes processing!
                        is_last = (grp_idx == len(groups) and copy_idx == clean_copies)
                        if not is_last:
                            self._wait_for_job_spool(printer, job_id=submitted_job_id, timeout=45)

                return {"success": True, "output": "; ".join(outputs), "printer": printer}
            finally:
                # Cleanup temporary sub-files
                for tf in temp_files_to_clean:
                    try:
                        if tf.exists() and tf != p_path:
                            tf.unlink()
                    except Exception:
                        pass

        # ── Uniform Color Mode Execution (All B&W or All Colour) ──
        target_path = p_path
        temp_uniform_files = []

        # If user selected a subset of pages in a multi-page PDF, extract those exact pages
        # so CUPS and printer hardware receive ONLY the pages the user requested!
        effective_range = page_range
        if is_pdf and selected_pages and len(selected_pages) < total_pages:
            range_tag = "_".join(str(x) for x in selected_pages[:4])
            unique_suffix = f"{os.getpid()}_{int(time.time() * 1000) % 100000}"
            extracted_name = f"extracted_{p_path.stem}_p{range_tag}_{unique_suffix}.pdf"
            extracted_path = p_path.parent / extracted_name
            if self._extract_pdf_pages(p_path, selected_pages, extracted_path):
                print(f"[CUPS] Sliced PDF to {len(selected_pages)} selected page(s): {selected_pages} -> '{extracted_path.name}'")
                target_path = extracted_path
                temp_uniform_files.append(extracted_path)
                effective_range = None  # PDF already contains ONLY the selected pages!

        # Enforce pure DeviceGray for B&W uniform prints so printer hardware CANNOT use color ink
        if is_pdf and not is_color and not target_path.name.startswith("mono_"):
            unique_suffix = f"{os.getpid()}_{int(time.time() * 1000) % 100000}"
            mono_target = p_path.parent / f"mono_devgray_{target_path.stem}_{unique_suffix}.pdf"
            if self._convert_pdf_to_monochrome(target_path, mono_target):
                print(f"[CUPS] ✓ Enforced pure DeviceGray grayscale PDF: '{mono_target.name}'")
                target_path = mono_target
                temp_uniform_files.append(mono_target)

        cups_opts = self.build_cups_options(
            copies=clean_copies,
            colour_mode=colour_mode,
            duplex=duplex,
            paper_size=paper_size,
            page_range=effective_range,
            scaling=scaling,
            pages_per_sheet=pages_per_sheet,
            orientation=orientation,
        )

        print(f"[CUPS] Dispatching '{target_path.name}' to printer '{printer}'")
        print(f"[CUPS] Hardware Options applied: {cups_opts}")

        # Explicit target verification: Guarantee file exists and is readable before contacting CUPS
        if not target_path.exists() or target_path.stat().st_size == 0:
            err_msg = f"Print target file not found or empty on disk: '{target_path.name}'"
            print(f"[CUPS] ❌ Error: {err_msg}")
            return {"success": False, "error": err_msg, "printer": printer}

        try:
            # Primary execution via Linux lp CLI on Raspberry Pi
            if sys.platform != "win32":
                # Ensure printer queue is active (unpaused/enabled) and wake from deep sleep
                self.wake_brother_printer(printer)
                subprocess.run(["cupsenable", printer], timeout=5, capture_output=True)
                subprocess.run(["cupsaccept", printer], timeout=5, capture_output=True)

                # Attempt hardware mode sync ONLY if Brother printer hardware is active
                try:
                    usb_status = self.check_usb_printer()
                    if usb_status.get("isBrother"):
                        for br_bin in ["/usr/bin/brprintconf_dcpt420w", "/opt/brother/Printers/dcpt420w/lpd/brprintconf_dcpt420w"]:
                            if os.path.exists(br_bin):
                                try:
                                    corm_arg = "FullColor" if is_color else "Mono"
                                    # ALWAYS set brprintconf -copies 1: CUPS 'lp -n' controls job copies.
                                    # Passing copies > 1 to brprintconf modifies Brother driver config and causes multiplication!
                                    subprocess.run([br_bin, "-corm", corm_arg, "-copies", "1"], timeout=3, capture_output=True, stdin=subprocess.DEVNULL)
                                    subprocess.run(["sudo", "-n", br_bin, "-corm", corm_arg, "-copies", "1"], timeout=3, capture_output=True, stdin=subprocess.DEVNULL)
                                    print(f"[CUPS] Brother hardware configured via {br_bin}: -corm {corm_arg} -copies 1 (CUPS job -n {clean_copies})")
                                except Exception as e:
                                    print(f"[CUPS] Brother hardware config notice: {e}")
                                break
                except Exception:
                    pass

                try:
                    cmd = ["lp", "-c", "-d", printer]
                    # ALWAYS explicitly pass -n <copies> (even for 1 copy) so CUPS CLI never falls back to an unwanted queue default!
                    cmd.extend(["-n", str(clean_copies)])

                    if effective_range and effective_range.upper() not in ("ALL", ""):
                        clean_range = str(effective_range).replace(" ", "")
                        cmd.extend(["-P", clean_range])

                    for k, v in cups_opts.items():
                        if k == "copies":
                            continue
                        cmd.extend(["-o", f"{k}={v}"])

                    cmd.append(str(target_path.resolve()))
                    print(f"[CUPS CLI] Executing: {' '.join(cmd)}")
                    out = subprocess.check_output(cmd, stderr=subprocess.STDOUT, text=True)
                    print(f"[CUPS CLI] Success output: {out.strip()}")
                    job_match = re.search(r"request id is ([^\s]+)", out)
                    submitted_job_id = job_match.group(1) if job_match else None
                    # Synchronously wait for job to finish printing so pages and subsequent jobs do not overlap
                    self._wait_for_job_spool(printer, job_id=submitted_job_id, timeout=90, expected_pages=len(selected_pages))
                    return {"success": True, "output": out.strip(), "printer": printer, "cupsJobId": submitted_job_id}
                except subprocess.CalledProcessError as cpe:
                    cli_out = (cpe.output or "").strip()
                    print(f"[CUPS CLI] lp execution error: {cpe} (Output: '{cli_out}'). Trying pycups fallback...")
                except Exception as e:
                    print(f"[CUPS CLI] lp execution error: {e}. Trying pycups fallback...")

            # Fallback to pycups if lp is unavailable or failed
            conn = self._get_connection()
            if conn:
                try:
                    with _CUPS_LOCK:
                        job_id = conn.printFile(printer, str(target_path.resolve()), job_title, cups_opts)
                    self._wait_for_job_spool(printer, job_id=str(job_id), timeout=90, expected_pages=len(selected_pages))
                    return {"success": True, "job_id": job_id, "printer": printer}
                except Exception as e:
                    print(f"[CUPS] pycups print error: {e}")
                    with _CUPS_LOCK:
                        self._conn = None

            if sys.platform != "win32":
                return {
                    "success": False,
                    "error": f"CUPS spooler failed to dispatch job to '{printer}'. Check printer connection and queue status.",
                    "printer": printer,
                }
        finally:
            # Retain temporary files on disk until CUPS filter queue clears and ws_kiosk_client purges them
            pass

        # Real Windows GDI hardware print engine
        if sys.platform == "win32":
            try:
                import sys as _sys
                from pathlib import Path as _Path
                root = str(_Path(__file__).resolve().parent.parent.parent)
                if root not in _sys.path:
                    _sys.path.insert(0, root)
                from services.printer.windows_printer import print_file as win_print_file

                raw_c = str(colour_mode or "BW").upper().replace("&", "")
                norm_colour = "COLOUR" if raw_c in ("COLOUR", "COLOR") else "BW"

                parsed_colours = None
                if page_colours:
                    if isinstance(page_colours, str):
                        try:
                            parsed_colours = json.loads(page_colours)
                        except Exception:
                            parsed_colours = None
                    elif isinstance(page_colours, dict):
                        parsed_colours = page_colours

                parsed_copies = None
                if page_copies:
                    if isinstance(page_copies, str):
                        try:
                            parsed_copies = json.loads(page_copies)
                        except Exception:
                            parsed_copies = None
                    elif isinstance(page_copies, dict):
                        parsed_copies = page_copies

                print(f"[WindowsPrinter] Dispatching '{p_path.name}' to '{printer}' (Mode: {norm_colour}, Custom Colors: {bool(parsed_colours)})")
                res = win_print_file(
                    file_path=str(p_path.resolve()),
                    copies=copies,
                    colour=norm_colour,
                    page_range=page_range or "ALL",
                    printer_name=printer,
                    duplex=duplex,
                    paper_size=paper_size,
                    dpi=300,
                    page_colours=parsed_colours,
                    page_copies=parsed_copies,
                    scaling=scaling,
                    orientation=orientation,
                    pages_per_sheet=pages_per_sheet,
                )
                return res
            except Exception as win_err:
                print(f"[WindowsPrinter] Error printing: {win_err}")
                return {"success": False, "error": str(win_err)}

        # Simulated fallback
        return {
            "success": True,
            "simulated": True,
            "job_id": 9999,
            "printer": printer,
            "message": "Simulated hardware dispatch (Development mode)",
        }
