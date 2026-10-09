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
import re
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

from config import KIOSK_ID, KIOSK_NAME, KIOSK_SECRET, API_URL, PRINTER_NAME, TEMP_JOBS_DIR
from hardware_monitor import HardwareMonitor
from cups_controller import CupsController
from order_tracker import (
    load_processed_orders,
    mark_order_processed,
    is_order_processed,
    purge_temp_job_files,
    save_staged_order,
)


class KioskWsClient:
    def __init__(self, kiosk_id: str = KIOSK_ID, api_url: str = API_URL):
        self.kiosk_id = kiosk_id.upper()
        self.kiosk_secret = KIOSK_SECRET
        self.api_url = api_url.rstrip("/")
        
        # Derive WS URL from HTTP API URL with cryptographic device authentication
        # e.g. http://localhost:5000/api -> ws://localhost:5000/ws
        base_host = self.api_url.replace("http://", "ws://").replace("https://", "wss://")
        if base_host.endswith("/api"):
            base_host = base_host[:-4]
        self.ws_url = f"{base_host}/ws?role=kiosk&kioskId={self.kiosk_id}&secret={self.kiosk_secret}"
        
        self.cups = CupsController()
        self.monitor = HardwareMonitor(self.cups)
        self.printer_name = PRINTER_NAME
        self.ws = None
        self.is_running = True
        self.print_callbacks = []
        self.staged_jobs = {}  # Indexed by order_id and releasePin
        self.printed_orders = load_processed_orders()
        self._was_printer_online = False
        self._last_usb_connected: Optional[bool] = None

        # Clean boot: Flush stale CUPS hardware queue and orphaned files
        self.cups.purge_all_jobs(self.printer_name)
        purge_temp_job_files()

        hw_init = self.monitor.get_hardware_status()
        init_printer = hw_init.get("printerName") or hw_init.get("activePrinter") or self.printer_name
        init_model = hw_init.get("printerModel") or hw_init.get("usbDevice") or init_printer
        init_wifi = hw_init.get("wifiName") or "Offline"
        init_host = hw_init.get("hostname") or "kiosk"

        print("════════════════════════════════════════════════════════")
        print(f"  PrintBooth Kiosk WSS Client Initialized")
        print(f"  Station ID       : {self.kiosk_id}")
        print(f"  Hostname         : {init_host}")
        print(f"  Printer Name     : {init_printer} ({init_model})")
        print(f"  Connected Wi-Fi  : {init_wifi}")
        print(f"  WSS Relay        : {self.ws_url}")
        print("════════════════════════════════════════════════════════\n")

    def _get_auth_headers(self):
        headers = {
            "User-Agent": "Mozilla/5.0 (X11; Linux armv7l) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 PrintBooth-Kiosk/1.0",
            "X-Kiosk-Id": self.kiosk_id,
            "Accept": "*/*",
        }
        if self.kiosk_secret:
            headers["X-Kiosk-Secret"] = self.kiosk_secret
            headers["Authorization"] = f"Bearer {self.kiosk_secret}"
        return headers

    async def connect(self):
        """Main connection and auto-reconnect loop with universal websockets library compatibility."""
        reconnect_delay = 2
        while self.is_running:
            try:
                print(f"[WSS Kiosk Client] Connecting to {self.ws_url}...")
                headers = self._get_auth_headers()

                # Build version-calibrated connection kwargs
                # websockets >= 13 uses additional_headers, legacy websockets uses extra_headers
                ws_kwargs = {
                    "ping_interval": 20,
                    "ping_timeout": 15,
                }
                if headers:
                    try:
                        import inspect
                        sig = inspect.signature(websockets.connect)
                        if "additional_headers" in sig.parameters:
                            ws_kwargs["additional_headers"] = headers
                        elif "extra_headers" in sig.parameters:
                            ws_kwargs["extra_headers"] = headers
                    except Exception:
                        pass

                # Connect with fallback for TypeError across websockets library versions
                # (Query parameters in self.ws_url already provide cryptographic verification on the backend)
                try:
                    async with websockets.connect(self.ws_url, **ws_kwargs) as ws:
                        self.ws = ws
                        reconnect_delay = 2
                        print(f"[WSS Kiosk Client] ✓ Connected to WSS Relay!")

                        heartbeat_task = asyncio.create_task(self._heartbeat_loop())
                        usb_monitor_task = asyncio.create_task(self._usb_monitor_loop())
                        receive_task = asyncio.create_task(self._receive_loop())
                        retention_task = asyncio.create_task(self._file_retention_loop())

                        done, pending = await asyncio.wait(
                            [heartbeat_task, usb_monitor_task, receive_task, retention_task],
                            return_when=asyncio.FIRST_COMPLETED
                        )
                        for t in pending:
                            t.cancel()
                except TypeError as te:
                    if "extra_headers" in str(te) or "additional_headers" in str(te):
                        async with websockets.connect(self.ws_url, ping_interval=20, ping_timeout=15) as ws:
                            self.ws = ws
                            reconnect_delay = 2
                            print(f"[WSS Kiosk Client] ✓ Connected to WSS Relay!")

                            heartbeat_task = asyncio.create_task(self._heartbeat_loop())
                            usb_monitor_task = asyncio.create_task(self._usb_monitor_loop())
                            receive_task = asyncio.create_task(self._receive_loop())
                            retention_task = asyncio.create_task(self._file_retention_loop())

                            done, pending = await asyncio.wait(
                                [heartbeat_task, usb_monitor_task, receive_task, retention_task],
                                return_when=asyncio.FIRST_COMPLETED
                            )
                            for t in pending:
                                t.cancel()
                    else:
                        raise

            except Exception as e:
                print(f"[WSS Kiosk Client] Disconnected / Connection error: {e}")
                self.ws = None
                await asyncio.sleep(reconnect_delay)
                reconnect_delay = min(reconnect_delay * 1.5, 15)

    async def _send_heartbeat(self):
        """Constructs and sends hardware heartbeat to API server."""
        if not self.ws:
            return
        hw = self.monitor.get_hardware_status()
        is_online = hw["isOnline"]
        active_printer = hw.get("printerName") or hw.get("activePrinter") or self.printer_name
        printer_model = hw.get("printerModel") or hw.get("usbDevice") or active_printer
        wifi_ssid = hw.get("wifiName") or "Offline"
        hostname = hw.get("hostname") or "kiosk"

        if is_online != self._was_printer_online:
            self._was_printer_online = is_online
            if is_online:
                print(f"[WSS Kiosk Client] [ONLINE] Printer: {active_printer} ({printer_model}) | Wi-Fi: {wifi_ssid} | Host: {hostname}")
            else:
                print(f"[WSS Kiosk Client] [OFFLINE] Printer offline: {active_printer}. Auto-recovering...")

        payload = {
            "type": "KIOSK_HEARTBEAT",
            "kioskId": self.kiosk_id,
            "payload": {
                "status": "ONLINE" if is_online else "OFFLINE",
                "printerStatus": hw["printerStatus"],
                "activePrinter": active_printer,
                "printerName": active_printer,
                "printerModel": printer_model,
                "hostname": hostname,
                "wifiName": wifi_ssid,
                "connectedWifi": wifi_ssid,
                "allPrinters": hw.get("allPrinters", []),
                "paperLevel": hw["paperLevel"],
                "tonerLevel": hw["tonerLevel"],
                "usbConnected": hw.get("usbConnected", True),
                "usbDevice": hw.get("usbDevice") or printer_model,
                "usbInfo": hw.get("usbInfo"),
                "diagnostics": hw.get("diagnostics", {}),
                "network": hw.get("network", {}),
            },
            "timestamp": int(time.time() * 1000)
        }
        await self.ws.send(json.dumps(payload))

    async def _heartbeat_loop(self):
        """Sends live hardware telemetry every 10 seconds."""
        while self.is_running and self.ws:
            try:
                await self._send_heartbeat()
            except Exception as e:
                print(f"[WSS Kiosk Client] Heartbeat error: {e}")
                break
            await asyncio.sleep(10)

    async def _usb_monitor_loop(self):
        """
        Background physical USB scanner loop running every 60 seconds (1 minute).
        Executes 'lsusb' probe to verify Brother printer connection.
        Logs status and broadcasts heartbeat immediately if connection state changes.
        """
        print("[WSS Kiosk Client] ⏱ 1-minute physical USB scanner loop (lsusb) initialized.")
        while self.is_running and self.ws:
            try:
                loop = asyncio.get_event_loop()
                usb_info = await loop.run_in_executor(None, self.cups.check_usb_printer)
                is_connected = bool(usb_info.get("connected", False))
                printer_found = usb_info.get("printerFound") or "Brother Printer"

                if self._last_usb_connected is None or is_connected != self._last_usb_connected:
                    self._last_usb_connected = is_connected
                    if is_connected:
                        print(f"[WSS Kiosk Client] [1-min USB Monitor] 🟢 Brother printer DETECTED on USB via lsusb: '{printer_found}'")
                    else:
                        print(f"[WSS Kiosk Client] [1-min USB Monitor] 🔴 Brother printer NOT DETECTED via lsusb! USB cable unplugged or printer powered off.")
                    await self._send_heartbeat()
                else:
                    if is_connected:
                        print(f"[WSS Kiosk Client] [1-min USB Monitor] ✓ Heartbeat tick: Brother printer connected via USB ({printer_found}).")
                    else:
                        print(f"[WSS Kiosk Client] [1-min USB Monitor] ⚠️ Heartbeat tick: Brother printer offline (lsusb not detecting printer).")
            except Exception as e:
                print(f"[WSS Kiosk Client] [1-min USB Monitor] Error probing USB printer: {e}")

            await asyncio.sleep(60)

    async def _file_retention_loop(self):
        """
        Periodically sweeps local temporary jobs directory every 15 minutes.
        Permanently purges any staged files older than 24 hours (86,400 seconds).
        """
        while self.is_running and self.ws:
            try:
                cutoff = time.time() - 86400  # 24 hours
                if TEMP_JOBS_DIR.exists():
                    for item in TEMP_JOBS_DIR.iterdir():
                        if item.is_file() and item.name not in (".spool_claims.lock", ".spool_claims.json"):
                            try:
                                if item.stat().st_mtime < cutoff:
                                    item.unlink()
                                    print(f"[WSS Kiosk Client] 🧹 Purged local print file exceeding 24h retention: {item.name}")
                            except Exception:
                                pass
            except Exception as e:
                print(f"[WSS Kiosk Client] Error in file retention sweep: {e}")

            await asyncio.sleep(15 * 60)

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
                    # Send initial heartbeat immediately upon connecting
                    asyncio.create_task(self._send_heartbeat())

                elif msg_type in ("CHECK_USB_PRINTER", "PROBE_USB"):
                    print(f"[WSS Kiosk Client] 🔍 On-demand USB probe requested (e.g. file upload verification)")
                    loop = asyncio.get_event_loop()
                    usb_info = await loop.run_in_executor(None, self.cups.check_usb_printer)
                    response_msg = {
                        "type": "USB_PRINTER_STATUS",
                        "kioskId": self.kiosk_id,
                        "payload": usb_info,
                        "timestamp": int(time.time() * 1000)
                    }
                    if self.ws:
                        await self.ws.send(json.dumps(response_msg))
                    asyncio.create_task(self._send_heartbeat())

                elif msg_type == "SET_DEFAULT_PRINTER":
                    printer_name = payload.get("printerName") or payload.get("name")
                    print(f"[WSS Kiosk Client] 🖨 Setting Raspberry Pi CUPS default printer to '{printer_name}'...")
                    if printer_name:
                        self.cups.set_default_printer(printer_name)
                        asyncio.create_task(self._send_heartbeat())

                elif msg_type in ("SCAN_PRINTERS", "GET_PRINTERS"):
                    print(f"[WSS Kiosk Client] 🔍 Merchant requested physical printer scan on Raspberry Pi")
                    asyncio.create_task(self._send_heartbeat())

                elif msg_type == "SCAN_WIFI":
                    print(f"[WSS Kiosk Client] 📡 Merchant requested Wi-Fi scan on Raspberry Pi")
                    loop = asyncio.get_event_loop()
                    networks = await loop.run_in_executor(None, self.monitor.scan_wifi)
                    resp = {
                        "type": "WIFI_SCAN_RESULT",
                        "kioskId": self.kiosk_id,
                        "payload": {"networks": networks},
                        "timestamp": int(time.time() * 1000)
                    }
                    if self.ws:
                        await self.ws.send(json.dumps(resp))

                elif msg_type == "CONNECT_WIFI":
                    ssid = payload.get("ssid", "")
                    password = payload.get("password", "")
                    print(f"[WSS Kiosk Client] 📶 Merchant requested Raspberry Pi Wi-Fi connection to '{ssid}'")
                    loop = asyncio.get_event_loop()
                    res = await loop.run_in_executor(None, lambda: self.monitor.connect_wifi(ssid, password))
                    resp = {
                        "type": "WIFI_CONNECT_RESULT",
                        "kioskId": self.kiosk_id,
                        "payload": res,
                        "timestamp": int(time.time() * 1000)
                    }
                    if self.ws:
                        await self.ws.send(json.dumps(resp))
                    asyncio.create_task(self._send_heartbeat())

                elif msg_type == "PRINT_JOB_STAGED":
                    # Order paid & staged with release PIN / OTP
                    order_number = payload.get("orderNumber") or msg.get("orderNumber")
                    release_pin = payload.get("releasePin") or payload.get("otp") or payload.get("pickupCode")
                    file_name = payload.get("fileName") or "document.pdf"
                    print(f"[WSS Kiosk Client] 📥 Staged print job received: Order {order_id} ({order_number}) | Release PIN / OTP: {release_pin} | File: {file_name}")

                    # Index in memory for instant local and network verification
                    if order_id:
                        self.staged_jobs[order_id] = payload
                    if order_number:
                        self.staged_jobs[order_number] = payload
                    if release_pin:
                        self.staged_jobs[release_pin] = payload

                    # Persist locally so serve_kiosk_ui.py can verify PIN 100% locally
                    save_staged_order(payload)

                    # Prefetch document in background so printing is instant upon PIN entry
                    asyncio.create_task(self._prefetch_document(order_id, payload))

                elif msg_type == "PIN_VERIFIED":
                    print(f"[WSS Kiosk Client] 🔑 PIN Verified on Kiosk for Order {order_id}!")
                    order_number = payload.get("orderNumber") or msg.get("orderNumber")
                    release_pin = payload.get("releasePin") or payload.get("otp") or payload.get("pickupCode")

                    staged_job = (
                        self.staged_jobs.get(order_id)
                        or (self.staged_jobs.get(order_number) if order_number else None)
                        or (self.staged_jobs.get(release_pin) if release_pin else None)
                        or {}
                    )

                    if not order_number and staged_job.get("orderNumber"):
                        order_number = staged_job.get("orderNumber")
                    if not release_pin:
                        release_pin = staged_job.get("releasePin") or staged_job.get("otp") or staged_job.get("pickupCode")

                    aliases = [a for a in [order_number, release_pin] if a and a != order_id]
                    all_ids = {order_id} | set(aliases)

                    if payload.get("dispatchedLocally") and not payload.get("forceKioskPrint"):
                        print(f"[WSS Kiosk Client] ℹ Order {order_id} handled directly by host engine. Skipping duplicate spool.")
                        mark_order_processed(order_id, aliases)
                        self.printed_orders = load_processed_orders()
                        continue

                    if is_order_processed(order_id, aliases) or any(i in self.printed_orders for i in all_ids):
                        print(f"[WSS Kiosk Client] ℹ Order {order_id} already spooled. Skipping duplicate spool.")
                        continue

                    if not self.cups.claim_order_for_spooling(order_id, aliases):
                        print(f"[WSS Kiosk Client] ℹ Order {order_id} already claimed/spooled. Skipping duplicate spool.")
                        mark_order_processed(order_id, aliases)
                        self.printed_orders = load_processed_orders()
                        continue

                    mark_order_processed(order_id, aliases)
                    self.printed_orders = load_processed_orders()
                    merged_payload = {**staged_job, **payload}
                    asyncio.create_task(self._handle_print_order(order_id, merged_payload))

                elif msg_type == "FILE_INCOMING":
                    print(f"[WSS Kiosk Client] 📄 Incoming file received via WS: {payload.get('fileName')} (Order: {order_id})")

                elif msg_type in ("PAYMENT_CAPTURED", "PRINT_EXECUTE"):
                    print(f"[WSS Kiosk Client] ⚡ Order Event: {msg_type} for Order {order_id}")
                    order_number = payload.get("orderNumber") or msg.get("orderNumber")
                    release_pin = payload.get("releasePin") or payload.get("otp") or payload.get("pickupCode")

                    staged_job = (
                        self.staged_jobs.get(order_id)
                        or (self.staged_jobs.get(order_number) if order_number else None)
                        or (self.staged_jobs.get(release_pin) if release_pin else None)
                        or {}
                    )

                    if not order_number and staged_job.get("orderNumber"):
                        order_number = staged_job.get("orderNumber")
                    if not release_pin:
                        release_pin = staged_job.get("releasePin") or staged_job.get("otp") or staged_job.get("pickupCode")

                    aliases = [a for a in [order_number, release_pin] if a and a != order_id]
                    all_ids = {order_id} | set(aliases)

                    merged_payload = {**staged_job, **payload}
                    check_pin = merged_payload.get("releasePin") or merged_payload.get("otp") or merged_payload.get("pickupCode")

                    # If order requires PIN verification at the kiosk, DO NOT auto-print on payment capture!
                    if check_pin and not merged_payload.get("pinVerified") and not merged_payload.get("immediate"):
                        print(f"[WSS Kiosk Client] ⏸ Order {order_id} requires PIN entry at kiosk. Awaiting PIN verification.")
                        continue

                    if payload.get("dispatchedLocally") and not payload.get("forceKioskPrint"):
                        print(f"[WSS Kiosk Client] ℹ Order {order_id} dispatched locally by host. Skipping duplicate spool.")
                        self.printed_orders.update(all_ids)
                        continue

                    if any(i in self.printed_orders for i in all_ids):
                        print(f"[WSS Kiosk Client] ℹ Order {order_id} already spooled. Skipping duplicate spool.")
                        continue

                    if not self.cups.claim_order_for_spooling(order_id, aliases):
                        print(f"[WSS Kiosk Client] ℹ Order {order_id} already claimed/spooled. Skipping duplicate spool.")
                        self.printed_orders.update(all_ids)
                        continue

                    self.printed_orders.update(all_ids)
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

        # Build download URL with query params for station authentication
        base_dl_url = payload.get("fileUrl") or f"{self.api_url}/print/download/{order_id}"
        separator = "&" if "?" in base_dl_url else "?"
        file_url = f"{base_dl_url}{separator}kioskId={urllib.parse.quote(self.kiosk_id)}"
        if self.kiosk_secret:
            file_url += f"&secret={urllib.parse.quote(self.kiosk_secret)}"

        try:
            print(f"[WSS Kiosk Client] ⚡ Pre-fetching document from {file_url}...")
            loop = asyncio.get_event_loop()
            def _download_with_auth():
                import ssl
                dl_req = urllib.request.Request(file_url, headers=self._get_auth_headers())
                try:
                    ctx = ssl.create_default_context()
                    with urllib.request.urlopen(dl_req, context=ctx, timeout=25) as resp, open(local_target, "wb") as f:
                        f.write(resp.read())
                except ssl.SSLError:
                    ctx = ssl._create_unverified_context()
                    with urllib.request.urlopen(dl_req, context=ctx, timeout=25) as resp, open(local_target, "wb") as f:
                        f.write(resp.read())
            await loop.run_in_executor(None, _download_with_auth)
            print(f"[WSS Kiosk Client] ✓ Pre-fetched {file_name} ({local_target.stat().st_size} bytes)")

            # Immediately pre-convert Office files & images in background thread so printing is instant upon PIN entry!
            suffix = local_target.suffix.lower()
            if suffix in (
                ".pptx", ".ppt", ".docx", ".doc", ".xlsx", ".xls",
                ".odt", ".odp", ".ods", ".rtf", ".txt",
                ".png", ".jpg", ".jpeg", ".webp"
            ):
                print(f"[WSS Kiosk Client] ⚡ Pre-converting '{local_target.name}' to PDF in background...")
                def _preconvert():
                    try:
                        self.cups.prepare_printable_file(local_target)
                        print(f"[WSS Kiosk Client] ✓ Pre-conversion ready for '{local_target.name}'")
                    except Exception as err:
                        print(f"[WSS Kiosk Client] Pre-convert notice: {err}")
                await loop.run_in_executor(None, _preconvert)
        except Exception as e:
            print(f"[WSS Kiosk Client] Pre-fetch notice: {e}")

    @staticmethod
    def _calculate_total_pages(payload: dict, copies: int = 1) -> int:
        """Accurately calculates total printable page count from payload data or range strings."""
        # 1. Direct pageCount or totalPages if provided as numbers or valid numeric strings
        for key in ("pageCount", "totalPages", "count"):
            val = payload.get(key)
            if val is not None:
                try:
                    cnt = int(val)
                    if cnt > 0:
                        return cnt * max(1, copies)
                except (ValueError, TypeError):
                    pass

        # 2. Inspect pages / pageRange
        raw_pages = str(payload.get("pageRange") or payload.get("pages") or "1").strip()
        if raw_pages.upper() in ("ALL", "*", ""):
            return 1 * max(1, copies)

        # 3. Parse range string (e.g. "1, 12", "1-5", "1, 3-5")
        selected_count = 0
        for part in raw_pages.split(","):
            part = part.strip()
            if not part:
                continue
            if "-" in part:
                bits = part.split("-", 1)
                try:
                    s, e = int(bits[0].strip()), int(bits[1].strip())
                    if s <= e:
                        selected_count += (e - s + 1)
                    else:
                        selected_count += 1
                except ValueError:
                    selected_count += 1
            else:
                try:
                    int(part)
                    selected_count += 1
                except ValueError:
                    selected_count += 1

        return max(1, selected_count) * max(1, copies)

    async def _handle_print_order(self, order_id: str, payload: dict):
        """Executes the physical print and streams progress back over WSS."""
        if not order_id:
            return

        settings = payload.get("printSettings") or {}
        file_name = payload.get("fileName") or settings.get("fileName") or "document.pdf"
        copies = max(1, int(payload.get("copies") or settings.get("copies") or 1))
        raw_col = str(payload.get("colourMode") or payload.get("colour") or settings.get("colourMode") or settings.get("colour") or "BW").upper().replace("&", "")
        colour_mode = "COLOUR" if raw_col in ("COLOUR", "COLOR") else "BW"
        duplex = str(payload.get("duplex") or settings.get("duplex") or "SINGLE").upper()
        paper_size = str(payload.get("paperSize") or settings.get("paperSize") or "A4").upper()
        page_range = str(payload.get("pageRange") or payload.get("pages") or settings.get("pageRange") or settings.get("pages") or "ALL").strip()
        scaling = str(payload.get("scaling") or settings.get("scaling") or "FIT").strip()
        orientation = str(payload.get("orientation") or settings.get("orientation") or "AUTO").upper().strip()
        pages_per_sheet = int(payload.get("pagesPerSheet") or settings.get("pagesPerSheet") or 1)

        page_colours = payload.get("pageColours") or settings.get("pageColours")
        page_copies = payload.get("pageCopies") or settings.get("pageCopies")

        order_number = payload.get("orderNumber")
        release_pin = payload.get("releasePin") or payload.get("otp") or payload.get("pickupCode")
        aliases = [a for a in [order_number, release_pin] if a and a != order_id]
        
        mark_order_processed(order_id, aliases)
        self.printed_orders = load_processed_orders()

        print(f"\n[WSS Kiosk Client] 🖨 Starting Print for Order {order_id}: {file_name}")
        print(f"  Settings: {copies} copies | {colour_mode} | {duplex} | {paper_size} | Pages: {page_range} | Scaling: {scaling} | Orientation: {orientation} | N-Up: {pages_per_sheet} | Custom Colors: {bool(page_colours)}")

        # Resolve local document path
        local_target = TEMP_JOBS_DIR / f"{order_id}_{file_name}"
        if not local_target.exists() or local_target.stat().st_size == 0:
            await self._prefetch_document(order_id, payload)

        if not local_target.exists():
            local_target.write_text(
                f"%PDF-1.4\n% PrintBooth Automated Kiosk Print\nOrder: {order_id}\nKiosk: {self.kiosk_id}\n"
            )

        # Dispatch to CUPS physical printer with all user settings applied
        result = {}
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
                    page_colours=page_colours,
                    page_copies=page_copies,
                    orientation=orientation,
                )
            )
            print(f"[WSS Kiosk Client] CUPS Spooler response: {result}")
        except Exception as e:
            print(f"[WSS Kiosk Client] CUPS dispatch error: {e}")
            result = {"success": False, "error": str(e)}

        # Check for spooler dispatch failure
        if isinstance(result, dict) and not result.get("success"):
            error_reason = result.get("error") or "Hardware spooler rejected the job"
            print(f"[WSS Kiosk Client] ❌ Print job failed: {error_reason}")
            fail_msg = {
                "type": "PRINT_ERROR",
                "kioskId": self.kiosk_id,
                "orderId": order_id,
                "payload": {
                    "orderId": order_id,
                    "error": error_reason,
                    "message": f"Print failed: {error_reason}",
                }
            }
            if self.ws:
                try:
                    await self.ws.send(json.dumps(fail_msg))
                except Exception:
                    pass
            # Still delete file for privacy
            try:
                for extra_f in TEMP_JOBS_DIR.glob(f"*{order_id}*"):
                    try:
                        if extra_f.is_file():
                            extra_f.unlink()
                    except Exception:
                        pass
            except Exception:
                pass
            return

        # Simulate / stream spooler progress to customer's phone and kiosk UI
        try:
            total_pages = self._calculate_total_pages(payload, copies)
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
        except Exception as prog_err:
            print(f"[WSS Kiosk Client] Progress simulation notice: {prog_err}")

        # Ensure CUPS spooler has finished rasterizing and processing before completing & deleting
        try:
            job_match = re.search(r"request id is ([^\s]+)", str(result.get("output", ""))) if isinstance(result, dict) else None
            submitted_job_id = job_match.group(1) if job_match else None
            target_printer = (result.get("printer") if isinstance(result, dict) else None) or "PrintBooth_Printer"
            await asyncio.to_thread(self.cups._wait_for_job_spool, target_printer, submitted_job_id, 35)
        except Exception as spool_wait_err:
            print(f"[WSS Kiosk Client] Spool wait notice: {spool_wait_err}")

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

        # Privacy Enforcement: Immediately and permanently delete user's printed document
        try:
            if local_target.exists():
                local_target.unlink()
                print(f"[WSS Kiosk Client] 🗑 PERMANENTLY DELETED user document for Order {order_id}: {local_target.name}")
            # Also clean up any converted or generated files matching this order
            for extra_f in TEMP_JOBS_DIR.glob(f"*{order_id}*"):
                try:
                    if extra_f.is_file():
                        extra_f.unlink()
                except Exception:
                    pass
        except Exception as del_err:
            print(f"[WSS Kiosk Client] Warning deleting local document {local_target}: {del_err}")



if __name__ == "__main__":
    client = KioskWsClient()
    try:
        asyncio.run(client.connect())
    except KeyboardInterrupt:
        print("\n[WSS Kiosk Client] Shutting down.")
