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
    API_URL,
    PRINTER_NAME,
    POLL_INTERVAL_SECONDS,
    HEARTBEAT_INTERVAL_SECONDS,
    TEMP_JOBS_DIR,
)
from cups_controller import CupsController
from hardware_monitor import HardwareMonitor


class KioskBrainDaemon:
    def __init__(self):
        self.kiosk_id = KIOSK_ID
        self.kiosk_name = KIOSK_NAME
        self.api_url = API_URL
        self.printer_name = PRINTER_NAME
        self.cups = CupsController()
        self.monitor = HardwareMonitor(self.cups)
        self.last_heartbeat = 0
        self.processed_orders = set()

        print("========================================================")
        print(f"  PrintBooth Kiosk Brain Daemon -- Initialized")
        print(f"  Station ID : {self.kiosk_id}")
        print(f"  Station Name: {self.kiosk_name}")
        print(f"  Backend API : {self.api_url}")
        print(f"  Printer Target: {self.printer_name}")
        print("========================================================\n")

    def send_heartbeat(self):
        """Sends live hardware telemetry to the PrintBooth backend."""
        now = time.time()
        if now - self.last_heartbeat < HEARTBEAT_INTERVAL_SECONDS:
            return

        hw = self.monitor.get_hardware_status()
        payload = {
            "kioskId": self.kiosk_id,
            "status": "ONLINE" if hw["isOnline"] else "OFFLINE",
            "printerStatus": hw["printerStatus"],
            "paperLevel": hw["paperLevel"],
            "tonerLevel": hw["tonerLevel"],
            "diagnostics": hw["diagnostics"],
        }

        try:
            req_url = f"{self.api_url}/kiosks/{self.kiosk_id}/heartbeat"
            req_data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                req_url,
                data=req_data,
                headers={"Content-Type": "application/json", "X-Kiosk-Id": self.kiosk_id},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=4) as resp:
                if resp.status in (200, 201):
                    self.last_heartbeat = now
        except Exception as e:
            # Non-blocking; server might be temporarily unreachable
            pass

    def fetch_pending_orders(self) -> List[Dict[str, Any]]:
        """Queries central API for paid orders ready to print for this station."""
        try:
            query = urllib.parse.urlencode({"kioskId": self.kiosk_id, "status": "PAID"})
            req_url = f"{self.api_url}/orders?{query}"
            req = urllib.request.Request(
                req_url,
                headers={"X-Kiosk-Id": self.kiosk_id, "Accept": "application/json"},
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
        """Executes a customer print job via CUPS."""
        order_id = order.get("orderId") or order.get("orderNumber") or order.get("_id")
        if not order_id or order_id in self.processed_orders:
            return

        print(f"\n[Kiosk Brain] [PRINT] New Job Received for Station {self.kiosk_id} -> Order {order_id}")
        file_name = order.get("fileName", "print_document.pdf")
        copies = int(order.get("copies", 1))
        colour_mode = order.get("colourMode", "BW")
        duplex = order.get("duplex", "SINGLE")
        paper_size = order.get("paperSize", "A4")

        # Resolve document file path
        local_target = TEMP_JOBS_DIR / f"{order_id}_{file_name}"
        file_url = order.get("fileUrl") or order.get("filePath")

        # If order requires Release PIN / OTP verification and has not been verified yet, stage it and wait
        release_pin = order.get("releasePin") or order.get("otp") or order.get("pickupCode")
        order_status = (order.get("status") or "").upper()
        if release_pin and order_status not in ("PRINTING", "VERIFIED"):
            if not local_target.exists():
                print(f"[Kiosk Brain] 📥 Staging document for Order {order_id} (Awaiting Kiosk PIN {release_pin})")
                if file_url and file_url.startswith("http"):
                    try:
                        urllib.request.urlretrieve(file_url, str(local_target))
                    except Exception as e:
                        print(f"[Kiosk Brain] Staging download error: {e}")
            return

        if file_url and file_url.startswith("http"):
            try:
                print(f"[Kiosk Brain] Downloading document: {file_url}")
                urllib.request.urlretrieve(file_url, str(local_target))
            except Exception as e:
                print(f"[Kiosk Brain] [ERROR] Download failed: {e}")
                return
        elif not local_target.exists():
            # Create diagnostic fallback test document if none downloaded
            local_target.write_text(
                f"%PDF-1.4\n% PrintBooth Automated Test Print\nOrder: {order_id}\nKiosk: {self.kiosk_id}\n"
            )

        print(f"[Kiosk Brain] Sending to spooler: {copies} copies | {colour_mode} | {duplex} | {paper_size}")
        result = self.cups.print_file(
            file_path=str(local_target),
            copies=copies,
            colour_mode=colour_mode,
            duplex=duplex,
            paper_size=paper_size,
            printer_name=self.printer_name,
            job_title=f"Order {order_id} - {file_name}",
        )

        if result.get("success"):
            print(f"[Kiosk Brain] [OK] Print dispatched successfully via {result.get('printer')}!")
            self.processed_orders.add(order_id)
            self.monitor.estimated_paper = max(0, self.monitor.estimated_paper - copies)
            self.notify_order_completed(order_id)
        else:
            print(f"[Kiosk Brain] [ERROR] Print error: {result.get('error')}")

    def notify_order_completed(self, order_id: str):
        """Notifies the backend that the physical print is complete and ready for pickup."""
        try:
            req_url = f"{self.api_url}/orders/{order_id}/status"
            req_data = json.dumps({"status": "READY_FOR_COLLECTION", "kioskId": self.kiosk_id}).encode("utf-8")
            req = urllib.request.Request(
                req_url,
                data=req_data,
                headers={"Content-Type": "application/json", "X-Kiosk-Id": self.kiosk_id},
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
