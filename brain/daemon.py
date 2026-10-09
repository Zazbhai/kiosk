#!/usr/bin/env python3
"""
PrintBooth Kiosk Brain IoT Daemon
=================================
Runs continuously as a systemd service on the Raspberry Pi.

Responsibilities:
1. Periodically sends hardware heartbeat to central backend (/api/kiosks/<id>/heartbeat).
2. Polls for newly paid orders routed to this specific kiosk station.
3. Securely downloads isolated customer documents.
4. Executes physical hardware print via CUPS with user parameters (copies, color, duplex).
5. Updates live telemetry and notifies backend upon completion.
"""

import json
import os
import sys
import time
import urllib.request
import urllib.parse
from pathlib import Path
from typing import List, Dict, Any

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

# Ensure kiosk/brain is on sys.path
_current_dir = str(Path(__file__).resolve().parent)
if _current_dir not in sys.path:
    sys.path.insert(0, _current_dir)

from config import (
    KIOSK_ID,
    KIOSK_NAME,
    KIOSK_SECRET,
    API_URL,
    PRINTER_NAME,
    POLL_INTERVAL_SECONDS,
    HEARTBEAT_INTERVAL_SECONDS,
    TEMP_JOBS_DIR,
)
from cups_controller import CupsController
from hardware_monitor import HardwareMonitor
from order_tracker import (
    load_processed_orders,
    mark_order_processed,
    is_order_processed,
    purge_temp_job_files,
    save_staged_order,
)


class KioskBrainDaemon:
    def __init__(self):
        self.kiosk_id = KIOSK_ID
        self.kiosk_name = KIOSK_NAME
        self.kiosk_secret = KIOSK_SECRET
        self.api_url = API_URL
        self.printer_name = PRINTER_NAME
        self.cups = CupsController()
        self.monitor = HardwareMonitor(self.cups)
        self.last_heartbeat = 0
        self.processed_orders = load_processed_orders()
        self._was_printer_online = False

        # BOOT PURGE 1: Clear any lingering ghost jobs in the CUPS hardware spooler from previous boot/sessions
        print("[Kiosk Brain] 🧹 Sanitizing CUPS hardware queue on startup (cancelling all ghost jobs)...")
        self.cups.purge_all_jobs(self.printer_name)

        # BOOT PURGE 2: Securely purge any orphaned temporary document files from disk
        purge_temp_job_files()

        print("========================================================")
        print(f"  PrintBooth Kiosk Brain Daemon -- Initialized")
        print(f"  Station ID : {self.kiosk_id}")
        print(f"  Station Name: {self.kiosk_name}")
        print(f"  Backend API : {self.api_url}")
        print(f"  Printer Target: {self.printer_name}")
        print(f"  Auth Status : {'Secured (Token Loaded)' if self.kiosk_secret else 'Warning (No KIOSK_SECRET configured)'}")
        print(f"  Printed History: {len(self.processed_orders)} order(s) already completed (persistent)")
        print("========================================================\n")

        self._ensure_ws_client()
        self._wait_for_printer_startup(warmup_seconds=60)

    def _ensure_ws_client(self):
        """Ensures the real-time WebSocket client (ws_kiosk_client.py) runs alongside the daemon."""
        try:
            ws_script = Path(__file__).resolve().parent / "ws_kiosk_client.py"
            if not ws_script.exists():
                return
            import subprocess
            if sys.platform != "win32":
                check = subprocess.run(["pgrep", "-f", "ws_kiosk_client.py"], stdout=subprocess.PIPE)
                if check.returncode == 0:
                    return
            python_bin = sys.executable
            subprocess.Popen(
                [python_bin, str(ws_script)],
                cwd=str(Path(__file__).resolve().parent),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True if sys.platform != "win32" else False,
            )
            print("[Kiosk Brain] 🚀 Spawned real-time WebSocket client (ws_kiosk_client.py).")
        except Exception as e:
            print(f"[Kiosk Brain] Notice starting ws client: {e}")

    def _wait_for_printer_startup(self, warmup_seconds: int = 60):
        """
        Grace period on cold boot:
        When Raspberry Pi and printer turn on simultaneously after a power outage,
        the Pi boots in ~15-20s while Brother DCP-T420W takes 40-70s to complete its
        mechanical self-calibration and USB PHY start.
        We poll every 5s during warmup so the printer is caught the moment it appears.
        """
        if sys.platform == "win32":
            return
        print(f"[Kiosk Brain] 🔄 Checking printer readiness (up to {warmup_seconds}s boot grace period)...")
        start = time.time()
        while time.time() - start < warmup_seconds:
            hw = self.monitor.get_hardware_status()
            if hw["isOnline"]:
                self._was_printer_online = True
                elapsed = int(time.time() - start)
                print(f"[Kiosk Brain] ✓ Printer detected and READY ({hw['activePrinter']}) after {elapsed}s!\n")
                return
            elapsed = int(time.time() - start)
            print(f"[Kiosk Brain] ⏳ Waiting for printer to finish power-on self-test... ({elapsed}s / {warmup_seconds}s)")
            time.sleep(5)
        print(f"[Kiosk Brain] ℹ Boot grace period completed. Background watchdog will continue auto-recovery.\n")

    def _get_auth_headers(self) -> Dict[str, str]:
        headers = {
            "User-Agent": "Mozilla/5.0 (X11; Linux armv7l) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 PrintBooth-Kiosk/1.0",
            "X-Kiosk-Id": self.kiosk_id,
            "Accept": "*/*",
        }
        if self.kiosk_secret:
            headers["X-Kiosk-Secret"] = self.kiosk_secret
            headers["Authorization"] = f"Bearer {self.kiosk_secret}"
        return headers

    def _load_processed_history(self) -> set:
        return load_processed_orders()

    def _mark_order_processed(self, order_id: str, aliases: Optional[List[str]] = None):
        mark_order_processed(order_id, aliases)
        self.processed_orders = load_processed_orders()

    def send_heartbeat(self):
        """Sends live hardware telemetry to the PrintBooth backend."""
        now = time.time()
        if now - self.last_heartbeat < HEARTBEAT_INTERVAL_SECONDS:
            return

        hw = self.monitor.get_hardware_status()
        is_online = hw["isOnline"]
        if is_online != self._was_printer_online:
            self._was_printer_online = is_online
            if is_online:
                print(f"[Kiosk Brain] 🟢 Printer status restored: ONLINE ({hw['activePrinter']})")
            else:
                print(f"[Kiosk Brain] 🔴 Printer status: OFFLINE. Background auto-recovery engaged.")

        payload = {
            "kioskId": self.kiosk_id,
            "status": "ONLINE" if is_online else "OFFLINE",
            "printerStatus": hw["printerStatus"],
            "paperLevel": hw["paperLevel"],
            "tonerLevel": hw["tonerLevel"],
            "diagnostics": hw["diagnostics"],
        }

        try:
            req_url = f"{self.api_url}/kiosks/{self.kiosk_id}/heartbeat"
            req_data = json.dumps(payload).encode("utf-8")
            headers = {**self._get_auth_headers(), "Content-Type": "application/json"}
            req = urllib.request.Request(
                req_url,
                data=req_data,
                headers=headers,
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=4) as resp:
                if resp.status in (200, 201):
                    self.last_heartbeat = now
        except Exception as e:
            # Non-blocking; server might be temporarily unreachable
            pass

    def fetch_pending_orders(self) -> List[Dict[str, Any]]:
        """Queries central API for orders ready to stage or print for this station."""
        try:
            query = urllib.parse.urlencode({"kioskId": self.kiosk_id})
            req_url = f"{self.api_url}/orders?{query}"
            req = urllib.request.Request(
                req_url,
                headers=self._get_auth_headers(),
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if isinstance(data, dict) and data.get("success"):
                    return data.get("data", [])
                elif isinstance(data, list):
                    return data
                return []
        except Exception:
            return []

    def execute_order(self, order: Dict[str, Any]):
        """Executes a customer print job via CUPS only when PIN is verified."""
        order_id = order.get("orderId") or order.get("orderNumber") or order.get("_id")
        order_number = order.get("orderNumber")
        release_pin = order.get("releasePin") or order.get("otp") or order.get("pickupCode")
        aliases = [a for a in [order_number, release_pin] if a and a != order_id]
        all_ids = {order_id} | set(aliases)
        order_status = (order.get("status") or "").upper()

        if not order_id or is_order_processed(order_id, aliases):
            return

        # Skip already completed or already printed jobs or burned PINs
        if (
            order_status in ("PRINTED", "COMPLETED", "READY_FOR_COLLECTION")
            or order.get("isPinUsed")
            or order.get("pinUsedAt")
        ):
            self._mark_order_processed(order_id, aliases)
            return

        # MANDATORY CORRESPONDING PIN ENFORCEMENT:
        # Every document must have a corresponding PIN to be eligible to print.
        # If an order has NO PIN or PIN was already unset/used, DO NOT print!
        if not release_pin:
            self._mark_order_processed(order_id, aliases)
            return

        settings = order.get("printSettings") or {}
        file_name = order.get("fileName") or settings.get("fileName") or "document.pdf"
        copies = int(order.get("copies") or settings.get("copies") or 1)
        raw_c = str(order.get("colourMode") or settings.get("colourMode") or "BW").upper().replace("&", "")
        colour_mode = "COLOUR" if raw_c in ("COLOR", "COLOUR") else "BW"
        duplex = str(order.get("duplex") or settings.get("duplex") or "SINGLE").upper()
        paper_size = str(order.get("paperSize") or settings.get("paperSize") or "A4").upper()
        page_range = str(order.get("pageRange") or settings.get("pageRange") or "ALL").strip()
        scaling = str(order.get("scaling") or settings.get("scaling") or "FIT").strip()
        orientation = str(order.get("orientation") or settings.get("orientation") or "AUTO").upper().strip()
        pages_per_sheet = int(order.get("pagesPerSheet") or settings.get("pagesPerSheet") or 1)

        download_url = f"{self.api_url}/print/download/{order_id}?kioskId={urllib.parse.quote(self.kiosk_id)}"
        if self.kiosk_secret:
            download_url += f"&secret={urllib.parse.quote(self.kiosk_secret)}"
        local_target = TEMP_JOBS_DIR / f"{order_id}_{file_name}"

        # If user has NOT entered their corresponding PIN on the touchscreen yet:
        # Save order & PIN locally and pre-fetch document for instant local verification!
        if order_status != "VERIFIED":
            save_staged_order(order)
            if not local_target.exists():
                print(f"[Kiosk Brain] 📥 Staged Order {order_id} (Awaiting customer to enter PIN {release_pin} on kiosk)")
                try:
                    dl_req = urllib.request.Request(download_url, headers=self._get_auth_headers())
                    with urllib.request.urlopen(dl_req, timeout=20) as resp, open(local_target, "wb") as f:
                        f.write(resp.read())
                    print(f"[Kiosk Brain] ✓ Pre-fetched {file_name} ({local_target.stat().st_size} bytes)")
                except Exception as e:
                    print(f"[Kiosk Brain] Staging prefetch error: {e}")
            return

        # Atomic cross-process spool claiming: prevents duplicate prints if WSS client is running!
        if not self.cups.claim_order_for_spooling(order_id, aliases):
            print(f"[Kiosk Brain] ℹ Order {order_id} already claimed/spooled by WSS client. Skipping duplicate print.")
            self._mark_order_processed(order_id, aliases)
            return

        # PIN is verified (status is VERIFIED) -> Proceed with physical print
        print(f"\n[Kiosk Brain] 🖨 PIN Verified on Kiosk! Starting Print for Order {order_id} ({file_name})")

        if not local_target.exists() or local_target.stat().st_size == 0:
            try:
                print(f"[Kiosk Brain] 📥 Downloading document from {download_url}...")
                dl_req = urllib.request.Request(download_url, headers=self._get_auth_headers())
                with urllib.request.urlopen(dl_req, timeout=25) as resp, open(local_target, "wb") as f:
                    f.write(resp.read())
                print(f"[Kiosk Brain] ✓ Downloaded {file_name} ({local_target.stat().st_size} bytes)")
            except Exception as e:
                print(f"[Kiosk Brain] [ERROR] Download failed: {e}")
                return

        print(f"[Kiosk Brain] Sending to spooler with user-selected configuration:")
        print(f"  • Copies     : {copies}")
        print(f"  • Colour Mode: {colour_mode}")
        print(f"  • Duplex     : {duplex}")
        print(f"  • Paper Size : {paper_size}")
        print(f"  • Page Range : {page_range}")
        print(f"  • Scaling    : {scaling}")
        print(f"  • Orientation: {orientation}")
        print(f"  • N-Up       : {pages_per_sheet}")

        result = self.cups.print_file(
            file_path=str(local_target),
            copies=copies,
            colour_mode=colour_mode,
            duplex=duplex,
            paper_size=paper_size,
            page_range=page_range,
            scaling=scaling,
            pages_per_sheet=pages_per_sheet,
            printer_name=self.printer_name,
            job_title=f"Order {order_id} - {file_name}",
            orientation=orientation,
        )

        if result.get("success"):
            print(f"[Kiosk Brain] [OK] Print dispatched successfully via {result.get('printer')}!")
            self._mark_order_processed(order_id, aliases)
            self.monitor.estimated_paper = max(0, self.monitor.estimated_paper - copies)
            self.notify_order_completed(order_id)
            # PRIVACY & ZERO-LEFTOVER ENFORCEMENT: Immediately purge customer file from disk
            if local_target.exists():
                try:
                    local_target.unlink()
                    print(f"[Kiosk Brain] 🛡 Securely deleted printed document from disk: {local_target.name}")
                except Exception as e:
                    print(f"[Kiosk Brain] Notice deleting printed file: {e}")
        else:
            print(f"[Kiosk Brain] [ERROR] Print error: {result.get('error')}")

    def notify_order_completed(self, order_id: str):
        """Notifies the backend that the physical print is complete and ready for pickup."""
        try:
            req_url = f"{self.api_url}/orders/{order_id}/status"
            req_data = json.dumps({"status": "READY_FOR_COLLECTION", "kioskId": self.kiosk_id}).encode("utf-8")
            headers = {**self._get_auth_headers(), "Content-Type": "application/json"}
            req = urllib.request.Request(
                req_url,
                data=req_data,
                headers=headers,
                method="POST",
            )
            urllib.request.urlopen(req, timeout=3)
        except Exception:
            pass

    def run_forever(self):
        """Main daemon loop."""
        print(f"[Kiosk Brain] Loop active. Polling orders every {POLL_INTERVAL_SECONDS}s. Press Ctrl+C to stop.\n")
        while True:
            try:
                self.send_heartbeat()
                orders = self.fetch_pending_orders()
                for order in orders:
                    self.execute_order(order)
            except KeyboardInterrupt:
                print("\n[Kiosk Brain] Stopping daemon gracefully.")
                break
            except Exception as e:
                print(f"[Kiosk Brain] Error in poll loop: {e}")

            time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    daemon = KioskBrainDaemon()
    daemon.run_forever()
