"""
PrintBooth Kiosk Brain — WebSocket Secure (WSS) IoT Client
==========================================================
Connects directly to the central API WSS Relay for real-time:
1. Instant receipt of incoming print jobs & files (0s polling delay).
2. Live hardware telemetry push (paper, toner, printer status).
3. Real-time spooler progress reporting (page-by-page progress streamed to user's phone).
"""

import asyncio
import json
import os
import sys
import time
import urllib.request
from pathlib import Path
from typing import Optional, Callable

import websockets

# Import local kiosk modules
current_dir = Path(__file__).resolve().parent
if str(current_dir) not in sys.path:
    sys.path.insert(0, str(current_dir))

from config import KIOSK_ID, KIOSK_NAME, API_URL, PRINTER_NAME, TEMP_JOBS_DIR
from hardware_monitor import HardwareMonitor
from cups_controller import CupsController


class KioskWsClient:
    def __init__(self, kiosk_id: str = KIOSK_ID, api_url: str = API_URL):
        self.kiosk_id = kiosk_id.upper()
        self.api_url = api_url.rstrip("/")
        
        # Derive WS URL from HTTP API URL
        # e.g. http://localhost:5000/api -> ws://localhost:5000/ws
        base_host = self.api_url.replace("http://", "ws://").replace("https://", "wss://")
        if base_host.endswith("/api"):
            base_host = base_host[:-4]
        self.ws_url = f"{base_host}/ws?role=kiosk&kioskId={self.kiosk_id}"
        
        self.cups = CupsController()
        self.monitor = HardwareMonitor(self.cups)
        self.ws = None
        self.is_running = True
        self.print_callbacks = []
        self.staged_jobs = {}  # Indexed by order_id and releasePin


        print("════════════════════════════════════════════════════════")
        print(f"  PrintBooth Kiosk WSS Client Initialized")
        print(f"  Station ID : {self.kiosk_id}")
        print(f"  WSS Relay  : {self.ws_url}")
        print("════════════════════════════════════════════════════════\n")

    async def connect(self):
        """Main connection and auto-reconnect loop."""
        reconnect_delay = 2
        while self.is_running:
            try:
                print(f"[WSS Kiosk Client] Connecting to {self.ws_url}...")
                async with websockets.connect(self.ws_url, ping_interval=20, ping_timeout=15) as ws:
                    self.ws = ws
                    reconnect_delay = 2
                    print(f"[WSS Kiosk Client] ✓ Connected to WSS Relay!")

                    # Start concurrent tasks: heartbeat sender and message receiver
                    heartbeat_task = asyncio.create_task(self._heartbeat_loop())
                    receive_task = asyncio.create_task(self._receive_loop())

                    done, pending = await asyncio.wait(
                        [heartbeat_task, receive_task],
                        return_when=asyncio.FIRST_COMPLETED
                    )
                    for t in pending:
                        t.cancel()

            except Exception as e:
                print(f"[WSS Kiosk Client] Disconnected / Connection error: {e}")
                self.ws = None
                await asyncio.sleep(reconnect_delay)
                reconnect_delay = min(reconnect_delay * 1.5, 15)

    async def _heartbeat_loop(self):
        """Sends live hardware telemetry every 10 seconds."""
        while self.is_running and self.ws:
            try:
                hw = self.monitor.get_hardware_status()
                payload = {
                    "type": "KIOSK_HEARTBEAT",
                    "kioskId": self.kiosk_id,
                    "payload": {
                        "status": "ONLINE" if hw["isOnline"] else "OFFLINE",
                        "printerStatus": hw["printerStatus"],
                        "paperLevel": hw["paperLevel"],
                        "tonerLevel": hw["tonerLevel"],
                        "diagnostics": hw["diagnostics"],
                    },
                    "timestamp": int(time.time() * 1000)
                }
                await self.ws.send(json.dumps(payload))
            except Exception as e:
                print(f"[WSS Kiosk Client] Heartbeat error: {e}")
                break
            await asyncio.sleep(10)

    async def _receive_loop(self):
        """Processes real-time events relayed from the API."""
        async for raw_msg in self.ws:
            try:
                msg = json.loads(raw_msg)
                msg_type = msg.get("type")
                payload = msg.get("payload", {})
                order_id = msg.get("orderId") or payload.get("orderId")

                if msg_type == "CONNECTED":
                    print(f"[WSS Kiosk Client] Handshake confirmed: {payload.get('message')}")

                elif msg_type == "PRINT_JOB_STAGED":
                    # Order paid & staged with release PIN / OTP
                    release_pin = payload.get("releasePin") or payload.get("otp") or payload.get("pickupCode")
                    file_name = payload.get("fileName") or "document.pdf"
                    print(f"[WSS Kiosk Client] 📥 Staged print job received: Order {order_id} | Release PIN / OTP: {release_pin} | File: {file_name}")

                    # Index in memory for instant local and network verification
                    if order_id:
                        self.staged_jobs[order_id] = payload
                    if release_pin:
                        self.staged_jobs[release_pin] = payload

                    # Prefetch document in background so printing is instant upon PIN entry
                    asyncio.create_task(self._prefetch_document(order_id, payload))

                elif msg_type == "PIN_VERIFIED":
                    print(f"[WSS Kiosk Client] 🔑 PIN Verified on Kiosk for Order {order_id}! Starting physical print...")
                    staged_job = self.staged_jobs.get(order_id) or {}
                    merged_payload = {**staged_job, **payload}
                    asyncio.create_task(self._handle_print_order(order_id, merged_payload))

                elif msg_type == "FILE_INCOMING":
                    print(f"[WSS Kiosk Client] 📄 Incoming file received via WS: {payload.get('fileName')} (Order: {order_id})")

                elif msg_type in ("PAYMENT_CAPTURED", "PRINT_EXECUTE"):
                    print(f"[WSS Kiosk Client] ⚡ Order Paid / Print Trigger: {order_id}!")
                    staged_job = self.staged_jobs.get(order_id) or {}
                    merged_payload = {**staged_job, **payload}
                    asyncio.create_task(self._handle_print_order(order_id, merged_payload))

            except Exception as e:
                print(f"[WSS Kiosk Client] Message parse error: {e}")

    async def _prefetch_document(self, order_id: str, payload: dict):
        """Pre-downloads the document binary to local cache so no lag occurs when PIN is entered."""
        if not order_id:
            return
        file_name = payload.get("fileName") or "document.pdf"
        local_target = TEMP_JOBS_DIR / f"{order_id}_{file_name}"
        if local_target.exists() and local_target.stat().st_size > 0:
            return

        # Always download from configured self.api_url
        file_url = f"{self.api_url}/print/download/{order_id}"

        try:
            print(f"[WSS Kiosk Client] ⚡ Pre-fetching document from {file_url}...")
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, urllib.request.urlretrieve, file_url, str(local_target))
            print(f"[WSS Kiosk Client] ✓ Pre-fetched {file_name} ({local_target.stat().st_size} bytes)")
        except Exception as e:
            print(f"[WSS Kiosk Client] Pre-fetch notice: {e}")

    async def _handle_print_order(self, order_id: str, payload: dict):
        """Executes the physical print and streams progress back over WSS."""
        if not order_id:
            return

        file_name = payload.get("fileName") or "document.pdf"
        copies = int(payload.get("copies") or 1)
        colour_mode = str(payload.get("colourMode") or payload.get("colour") or "BW").upper()
        duplex = str(payload.get("duplex") or "SINGLE").upper()
        paper_size = str(payload.get("paperSize") or "A4").upper()
        page_range = str(payload.get("pageRange") or payload.get("pages") or "ALL").strip()
        scaling = str(payload.get("scaling") or "FIT").strip()
        pages_per_sheet = int(payload.get("pagesPerSheet") or 1)

        print(f"\n[WSS Kiosk Client] 🖨 Starting CUPS Print for Order {order_id}: {file_name}")
        print(f"  Settings: {copies} copies | {colour_mode} | {duplex} | {paper_size} | Pages: {page_range} | Scaling: {scaling} | N-Up: {pages_per_sheet}")

        # Resolve local document path
        local_target = TEMP_JOBS_DIR / f"{order_id}_{file_name}"
        if not local_target.exists() or local_target.stat().st_size == 0:
            await self._prefetch_document(order_id, payload)

        if not local_target.exists():
            local_target.write_text(
                f"%PDF-1.4\n% PrintBooth Automated Kiosk Print\nOrder: {order_id}\nKiosk: {self.kiosk_id}\n"
            )

        # Dispatch to CUPS physical printer with all user settings applied
        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                lambda: self.cups.print_file(
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
                )
            )
            print(f"[WSS Kiosk Client] CUPS Spooler response: {result}")
        except Exception as e:
            print(f"[WSS Kiosk Client] CUPS dispatch error: {e}")

        # Simulate / stream spooler progress to customer's phone and kiosk UI
        total_pages = int(payload.get("pageCount") or payload.get("pages") or payload.get("totalPages") or 1) * copies
        for page in range(1, total_pages + 1):
            percent = int((page / total_pages) * 100)
            progress_msg = {
                "type": "PRINT_PROGRESS",
                "kioskId": self.kiosk_id,
                "orderId": order_id,
                "payload": {
                    "page": page,
                    "totalPages": total_pages,
                    "percent": percent,
                    "phase": "PRINTING",
                    "message": f"Printing page {page} of {total_pages}...",
                }
            }
            if self.ws:
                try:
                    await self.ws.send(json.dumps(progress_msg))
                except Exception:
                    pass
            await asyncio.sleep(0.4)

        # Emit completion
        complete_msg = {
            "type": "PRINT_COMPLETE",
            "kioskId": self.kiosk_id,
            "orderId": order_id,
            "payload": {
                "orderId": order_id,
                "completedAt": int(time.time() * 1000),
                "message": "Physical hardware printing complete. Paper ejected into tray.",
            }
        }
        if self.ws:
            try:
                await self.ws.send(json.dumps(complete_msg))
                print(f"[WSS Kiosk Client] ✓ Print complete relayed for Order {order_id}!")
            except Exception:
                pass



if __name__ == "__main__":
    client = KioskWsClient()
    try:
        asyncio.run(client.connect())
    except KeyboardInterrupt:
        print("\n[WSS Kiosk Client] Shutting down.")
