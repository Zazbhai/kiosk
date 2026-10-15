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
from typing import Optional, Callable, List, Dict, Any, Set

import websockets

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(line_buffering=True)
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(line_buffering=True)

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

_SINGLETON_LOCK_FILE = None


def acquire_singleton_lock():
    """
    Guarantees that only ONE instance of ws_kiosk_client runs on this kiosk station.
    Blocks duplicate instances from systemd, start_kiosk.sh, or manual terminal execution.
    """
    global _SINGLETON_LOCK_FILE
    lock_file = Path("/tmp/printbooth_ws_client.pid")
    try:
        _SINGLETON_LOCK_FILE = open(lock_file, "a+", encoding="utf-8")
        if sys.platform != "win32":
            import fcntl
            try:
                fcntl.flock(_SINGLETON_LOCK_FILE.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except (BlockingIOError, IOError):
                _SINGLETON_LOCK_FILE.seek(0)
                existing_pid = _SINGLETON_LOCK_FILE.read().strip()
                print(f"\n[WSS Kiosk Client] ⚠️ ANOTHER INSTANCE IS ALREADY RUNNING (PID {existing_pid or 'unknown'}).")
                print(f"[WSS Kiosk Client] Exiting duplicate process immediately to prevent duplicate prints.")
                sys.exit(0)

        _SINGLETON_LOCK_FILE.seek(0)
        _SINGLETON_LOCK_FILE.truncate()
        _SINGLETON_LOCK_FILE.write(str(os.getpid()))
        _SINGLETON_LOCK_FILE.flush()
    except Exception as e:
        print(f"[WSS Kiosk Client] Singleton lock notice: {e}")


def resolve_effective_page_range(*candidates) -> str:
    """
    Bulletproof page range resolver:
    1. If any candidate specifies an explicit custom subset (e.g. '2-4', '1,3', [2,3]), use that.
    2. If any candidate explicitly specifies 'ALL' or '*', return 'ALL' (never let fallback [1] override it).
    3. If only a single-element [1] candidate exists alongside 'ALL', 'ALL' takes precedence.
    4. Defaults to 'ALL'.
    """
    has_explicit_all = False
    # Pre-scan for explicit 'ALL' or '*'
    for c in candidates:
        if not c:
            continue
        if isinstance(c, str):
            val = c.strip().upper()
            if val in ("ALL", "*"):
                has_explicit_all = True
                break

    for c in candidates:
        if not c:
            continue
        if isinstance(c, (list, tuple, set)):
            clean = [int(p) for p in c if str(p).isdigit() and int(p) > 0]
            if clean:
                if len(clean) > 1 or clean != [1]:
                    return ",".join(str(p) for p in sorted(set(clean)))
                if not has_explicit_all:
                    return "1"
            continue

        val = str(c).strip()
        if not val:
            continue
        if val.upper() in ("ALL", "*"):
            continue

        if val.startswith("[") and val.endswith("]"):
            try:
                parsed = json.loads(val)
                if isinstance(parsed, list):
                    clean = [int(p) for p in parsed if str(p).isdigit() and int(p) > 0]
                    if clean:
                        if len(clean) > 1 or clean != [1]:
                            return ",".join(str(p) for p in sorted(set(clean)))
                        if not has_explicit_all:
                            return "1"
            except Exception:
                pass
            continue

        # Check for explicit range or numbers
        if any(char.isdigit() for char in val):
            if val != "1" or not has_explicit_all:
                return val

    return "ALL"


class KioskWsClient:
    def __init__(self, kiosk_id: str = KIOSK_ID, api_url: str = API_URL):
        acquire_singleton_lock()
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
        self.active_printing_orders = set()  # Currently executing print orders to prevent concurrent multi-dispatch
        self.print_queue = asyncio.Queue()  # Serialized synchronous print queue (no multithread overlapping)
        self._was_printer_online = False
        self._heartbeat_lock = asyncio.Lock()  # Synchronize heartbeats to prevent concurrent CUPS/lsusb telemetry stampede
        self._active_prefetches = set()  # Prevent concurrent duplicate file downloads / conversions
        self._last_usb_connected: Optional[bool] = None

        # Clean boot: Purge orphaned temporary files from disk without cancelling active print spooler jobs
        purge_temp_job_files()

        hw_init = self.monitor.get_hardware_status()
        self._last_usb_connected = bool(hw_init.get("usbConnected", False))
        init_printer = hw_init.get("printerName") or hw_init.get("activePrinter") or self.printer_name
        if self.printer_name in ("auto", "None", "", None) and init_printer and init_printer not in ("auto", "None", "CUPS Printer"):
            self.printer_name = init_printer
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

    def _extract_clean_aliases(self, order_id: str, order_number: Optional[str]) -> List[str]:
        if not order_id:
            return []
        # For sub-orders (e.g. ORD-123_sub_1), the master order number ORD-123 must NEVER be treated as an alias!
        # Otherwise, sub_1 printing will cause sub_2, sub_3... to be rejected as duplicate orders!
        if "_sub_" in str(order_id):
            return []
        if not order_number or str(order_number).strip() == str(order_id).strip():
            return []
        s = str(order_number).strip()
        if s.isdigit() and len(s) <= 6:
            return []
        return [s]

    def _is_order_busy_or_printed(self, order_id: str, aliases: Optional[List[str]] = None) -> bool:
        """Atomically checks if an order is currently printing, already spooled, or marked processed."""
        if not order_id:
            return False
        if "_sub_" in str(order_id):
            clean_aliases = []
        else:
            clean_aliases = [
                str(a).strip() for a in (aliases or [])
                if a and str(a).strip() and not (str(a).strip().isdigit() and len(str(a).strip()) <= 6)
            ]
        all_ids = {str(order_id).strip()} | set(clean_aliases)
        if any(i in self.printed_orders for i in all_ids):
            return True
        if any(i in self.active_printing_orders for i in all_ids):
            return True
        if is_order_processed(order_id, clean_aliases):
            return True
        return False

    async def _run_ws_session(self, ws):
        """Runs the active WebSocket connection session. Only receive_task closure ends session."""
        self.ws = ws
        print(f"[WSS Kiosk Client] ✓ Connected to WSS Relay!")

        heartbeat_task = asyncio.create_task(self._heartbeat_loop())
        usb_monitor_task = asyncio.create_task(self._usb_monitor_loop())
        retention_task = asyncio.create_task(self._file_retention_loop())

        try:
            # receive_task drives the lifetime of the socket connection
            await self._receive_loop()
        finally:
            self.ws = None
            for t in (heartbeat_task, usb_monitor_task, retention_task):
                t.cancel()
            await asyncio.gather(heartbeat_task, usb_monitor_task, retention_task, return_exceptions=True)

    async def connect(self):
        """Main connection and auto-reconnect loop with universal websockets library compatibility."""
        # Lifecycle workers persist across WebSocket reconnects
        queue_worker_task = asyncio.create_task(self._process_print_queue())
        http_poll_task = asyncio.create_task(self._http_poll_loop())

        reconnect_delay = 2
        try:
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
                    try:
                        async with websockets.connect(self.ws_url, **ws_kwargs) as ws:
                            reconnect_delay = 2
                            await self._run_ws_session(ws)
                    except TypeError as te:
                        if "extra_headers" in str(te) or "additional_headers" in str(te):
                            async with websockets.connect(self.ws_url, ping_interval=20, ping_timeout=15) as ws:
                                reconnect_delay = 2
                                await self._run_ws_session(ws)
                        else:
                            raise

                except Exception as e:
                    print(f"[WSS Kiosk Client] Disconnected / Connection error: {e}")
                    self.ws = None
                    await asyncio.sleep(reconnect_delay)
                    reconnect_delay = min(reconnect_delay * 1.5, 15)
        finally:
            queue_worker_task.cancel()
            http_poll_task.cancel()
            await asyncio.gather(queue_worker_task, http_poll_task, return_exceptions=True)

    async def _send_heartbeat(self):
        """Constructs and sends hardware heartbeat to API server."""
        if not self.ws or self._heartbeat_lock.locked():
            return
        async with self._heartbeat_lock:
            try:
                loop = asyncio.get_event_loop()
                hw = await loop.run_in_executor(None, self.monitor.get_hardware_status)
                is_online = hw["isOnline"]
                active_printer = hw.get("printerName") or hw.get("activePrinter") or self.printer_name
                if active_printer and active_printer not in ("None", "auto", "CUPS Printer"):
                    if self.printer_name in ("auto", "None", "", None) or not self.printer_name:
                        self.printer_name = active_printer
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
                if self.ws:
                    await self.ws.send(json.dumps(payload))
            except Exception as e:
                print(f"[WSS Kiosk Client] Send heartbeat notice: {e}")

    async def _heartbeat_loop(self):
        """Sends live hardware telemetry every 10 seconds."""
        while self.is_running and self.ws:
            try:
                await self._send_heartbeat()
            except Exception as e:
                print(f"[WSS Kiosk Client] Heartbeat error: {e}")
            await asyncio.sleep(10)

    async def _usb_monitor_loop(self):
        """
        Background physical USB scanner loop running every 60 seconds (1 minute).
        Executes 'lsusb' probe to verify physical USB printer connection.
        Logs status and broadcasts heartbeat immediately if connection state changes.
        """
        print("[WSS Kiosk Client] ⏱ 1-minute physical USB scanner loop (lsusb) initialized.")
        while self.is_running and self.ws:
            try:
                loop = asyncio.get_event_loop()
                usb_info = await loop.run_in_executor(None, self.cups.check_usb_printer)
                is_connected = bool(usb_info.get("connected", False))
                vendor = usb_info.get("vendor") or "USB"
                printer_found = usb_info.get("printerFound") or f"{vendor} Printer"

                if self._last_usb_connected is None or is_connected != self._last_usb_connected:
                    self._last_usb_connected = is_connected
                    if is_connected:
                        print(f"[WSS Kiosk Client] [1-min USB Monitor] 🟢 {vendor} printer DETECTED on USB via lsusb: '{printer_found}'")
                    else:
                        print(f"[WSS Kiosk Client] [1-min USB Monitor] 🔴 USB printer NOT DETECTED via lsusb! USB cable unplugged or printer powered off.")
                    await self._send_heartbeat()
                else:
                    if is_connected:
                        print(f"[WSS Kiosk Client] [1-min USB Monitor] ✓ Heartbeat tick: {vendor} printer connected via USB ({printer_found}).")
                        # Anti-sleep guard: Keep CUPS queues unpaused and prevent deep sleep lock
                        await loop.run_in_executor(None, lambda: self.cups.wake_brother_printer(self.printer_name))
                    else:
                        print(f"[WSS Kiosk Client] [1-min USB Monitor] ⚠️ Heartbeat tick: USB printer offline (lsusb not detecting printer).")
            except Exception as e:
                print(f"[WSS Kiosk Client] [1-min USB Monitor] Error probing USB printer: {e}")

            await asyncio.sleep(60)

    async def _delayed_order_cleanup(self, order_id: str, delay_seconds: int = 600):
        """
        Delayed Privacy Enforcement:
        Waits 10 minutes (600 seconds) before safely purging local temporary print files,
        ensuring all CUPS rasterizers, filter pipelines, and hardware paper feeds finish 100%.
        """
        try:
            await asyncio.sleep(delay_seconds)
            purged = 0
            if TEMP_JOBS_DIR.exists():
                for f in TEMP_JOBS_DIR.glob(f"*{order_id}*"):
                    try:
                        if f.is_file() and f.name not in (".spool_claims.lock", ".spool_claims.json", ".gitignore"):
                            f.unlink()
                            purged += 1
                    except Exception:
                        pass
            if purged > 0:
                print(f"[WSS Kiosk Client] 🧹 10-Minute retention expired: Safely purged {purged} file(s) for Order {order_id}.")
        except Exception as e:
            print(f"[WSS Kiosk Client] Delayed cleanup notice for Order {order_id}: {e}")

    async def _file_retention_loop(self):
        """
        Periodically sweeps local temporary jobs directory every 60 seconds.
        Permanently purges any staged files older than 10 minutes (600 seconds).
        """
        while self.is_running and self.ws:
            try:
                cutoff = time.time() - 600  # 10 minutes retention
                if TEMP_JOBS_DIR.exists():
                    for item in TEMP_JOBS_DIR.iterdir():
                        if item.is_file() and item.name not in (".spool_claims.lock", ".spool_claims.json", ".gitignore"):
                            try:
                                if item.stat().st_mtime < cutoff:
                                    item.unlink()
                                    print(f"[WSS Kiosk Client] 🧹 Purged local print file exceeding 10m retention: {item.name}")
                            except Exception:
                                pass
            except Exception as e:
                print(f"[WSS Kiosk Client] Error in file retention sweep: {e}")

            await asyncio.sleep(60)

    async def _http_poll_loop(self):
        """
        Resilient background HTTP polling loop (modeled on LePrint's pollForJobs).
        Runs every 5 seconds to guarantee that paid print jobs are NEVER missed,
        even if WebSocket connection momentarily dropped or reconnected.
        """
        print("[WSS Kiosk Client] 🔄 Resilient HTTP job polling loop (5s) initialized.")
        while self.is_running:
            try:
                loop = asyncio.get_event_loop()
                def _do_poll():
                    poll_url = f"{self.api_url}/jobs/poll?kiosk_id={urllib.parse.quote(self.kiosk_id)}"
                    req = urllib.request.Request(poll_url, headers=self._get_auth_headers())
                    with urllib.request.urlopen(req, timeout=5) as resp:
                        return json.loads(resp.read().decode("utf-8"))
                data = await loop.run_in_executor(None, _do_poll)

                if data and isinstance(data, dict) and data.get("jobs"):
                    jobs = data.get("jobs", [])
                    for job in jobs:
                        order_id = job.get("orderId") or job.get("job_id")
                        order_number = job.get("orderNumber")
                        release_pin = job.get("releasePin") or job.get("otp") or job.get("pickupCode")
                        aliases = self._extract_clean_aliases(order_id, order_number)
                        all_ids = {order_id} | set(aliases)

                        def _notify_server_completed(oid=order_id):
                            try:
                                post_url = f"{self.api_url}/orders/{urllib.parse.quote(oid)}/status"
                                req = urllib.request.Request(
                                    post_url,
                                    data=json.dumps({"status": "COMPLETED"}).encode("utf-8"),
                                    headers={**self._get_auth_headers(), "Content-Type": "application/json"},
                                    method="POST",
                                )
                                with urllib.request.urlopen(req, timeout=5):
                                    pass
                            except Exception:
                                pass

                        # If this is a master order with multiple files, do NOT queue it monolithically!
                        # Multi-file orders are dispatched as individual sub-jobs.
                        job_files = job.get("files") or (job.get("printSettings") or {}).get("files") or []
                        if isinstance(job_files, list) and len(job_files) > 1:
                            print(f"[WSS Kiosk Client] ℹ Skipping monolithic poll enqueue for multi-file order {order_id} ({len(job_files)} files). Sub-jobs are dispatched individually.")
                            loop.run_in_executor(None, _notify_server_completed)
                            continue

                        if self._is_order_busy_or_printed(order_id, aliases):
                            loop.run_in_executor(None, _notify_server_completed)
                            continue

                        if not self.cups.claim_order_for_spooling(order_id, aliases, force=False):
                            loop.run_in_executor(None, _notify_server_completed)
                            continue

                        print(f"[WSS Kiosk Client] 📥 Picked up pending paid job via HTTP poll: {order_id} ({job.get('filename')})")
                        self.printed_orders.update(all_ids)
                        await self.print_queue.put((order_id, job))

            except Exception:
                # Non-blocking; network or backend might be temporarily unreachable
                pass

            await asyncio.sleep(5)

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
                elif msg_type in ("TRIGGER_UPDATE", "CHECK_UPDATE", "AUTO_UPDATE"):
                    print(f"[WSS Kiosk Client] 🚀 Immediate GitHub auto-update requested over WebSocket")
                    asyncio.create_task(self._run_auto_update(payload))

                elif msg_type == "PRINT_JOB_STAGED":
                    # Order paid & staged with release PIN / OTP
                    order_number = payload.get("orderNumber") or msg.get("orderNumber")
                    release_pin = payload.get("releasePin") or payload.get("otp") or payload.get("pickupCode")
                    file_name = payload.get("fileName") or "document.pdf"
                    print(f"[WSS Kiosk Client] 📥 Staged print job received: Order {order_id} ({order_number}) | Release PIN / OTP: {release_pin} | File: {file_name}")

                    # Ensure user specified prints are explicitly resolved
                    first_file = (payload.get("files") or [{}])[0] if isinstance(payload.get("files"), list) and len(payload.get("files")) > 0 else {}
                    ff_settings = first_file.get("settings") or {}
                    p_settings = payload.get("printSettings") or payload.get("settings") or {}

                    p_range = resolve_effective_page_range(
                        payload.get("pageRange"),
                        payload.get("pages"),
                        p_settings.get("pageRange"),
                        p_settings.get("pages"),
                        first_file.get("pageRange"),
                        first_file.get("pages"),
                        ff_settings.get("pageRange"),
                        ff_settings.get("pages"),
                        payload.get("selectedPages"),
                        payload.get("selected_pages"),
                        p_settings.get("selectedPages"),
                        p_settings.get("selected_pages"),
                        first_file.get("selectedPages"),
                        ff_settings.get("selectedPages"),
                    )
                    doc_pages = int(payload.get("totalDocPages") or payload.get("docPageCount") or payload.get("pageCount") or first_file.get("pageCount") or 1)
                    try:
                        from cups_controller import CupsController
                        selected_list = CupsController._parse_page_range(p_range, doc_pages)
                    except Exception:
                        selected_list = list(range(1, doc_pages + 1))

                    payload["selectedPages"] = selected_list
                    payload["pageCount"] = len(selected_list)
                    payload["totalDocPages"] = doc_pages
                    payload["docPageCount"] = doc_pages
                    payload["pageRange"] = p_range
                    payload["pages"] = p_range

                    # Index in memory for instant local and network verification
                    if order_id:
                        self.staged_jobs[order_id] = payload
                    if order_number:
                        self.staged_jobs[order_number] = payload
                    if release_pin:
                        existing = self.staged_jobs.get(release_pin)
                        if existing and isinstance(existing, dict) and (existing.get("orderId") != order_id or existing.get("fileName") != payload.get("fileName")):
                            if not existing.get("subJobs"):
                                # If existing was an individual sub-job, wrap it.
                                # If existing was a master order with files array, do NOT wrap master order as a sub-job!
                                if not existing.get("files") and "_sub_" in str(existing.get("orderId", "")):
                                    existing["subJobs"] = [existing.copy()]
                                else:
                                    existing["subJobs"] = []
                            if not any(sj.get("orderId") == order_id for sj in existing["subJobs"]):
                                existing["subJobs"].append(payload)
                            self.staged_jobs[release_pin] = existing
                        else:
                            self.staged_jobs[release_pin] = payload

                    # Persist locally so serve_kiosk_ui.py can verify PIN 100% locally
                    save_staged_order(payload)

                    # Prefetch document in background so printing is instant upon PIN entry
                    asyncio.create_task(self._prefetch_document(order_id, payload))
                    if payload.get("files") and isinstance(payload.get("files"), list):
                        for idx, f_item in enumerate(payload["files"]):
                            f_order_id = f_item.get("orderId") or f"{order_id}_sub_{idx + 1}"
                            asyncio.create_task(self._prefetch_document(f_order_id, {**f_item, "orderId": f_order_id}))

                    # If order is flagged for immediate/autonomous printing, dispatch directly to CUPS without blocking on PIN
                    if payload.get("immediate") or payload.get("forceKioskPrint") or payload.get("isImmediate"):
                        aliases = self._extract_clean_aliases(order_id, order_number)
                        all_ids = {order_id} | set(aliases)
                        if self._is_order_busy_or_printed(order_id, aliases):
                            print(f"[WSS Kiosk Client] ℹ Order {order_id} already printing or spooled. Skipping duplicate PRINT_JOB_STAGED trigger.")
                        else:
                            if not self.cups.claim_order_for_spooling(order_id, aliases, force=False):
                                print(f"[WSS Kiosk Client] ℹ Order {order_id} already claimed/spooled. Skipping duplicate PRINT_JOB_STAGED trigger.")
                            else:
                                print(f"[WSS Kiosk Client] ⚡ Immediate print requested for Order {order_id}. Executing print job directly...")
                                self.printed_orders.update(all_ids)
                                asyncio.create_task(self._handle_print_order(order_id, payload))

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

                    aliases = self._extract_clean_aliases(order_id, order_number)
                    all_ids = {order_id} | set(aliases)

                    if payload.get("dispatchedLocally") and not payload.get("forceKioskPrint"):
                        print(f"[WSS Kiosk Client] ℹ Order {order_id} handled directly by host engine. Skipping duplicate spool.")
                        mark_order_processed(order_id, aliases)
                        self.printed_orders = load_processed_orders()
                        continue

                    if self._is_order_busy_or_printed(order_id, aliases):
                        print(f"[WSS Kiosk Client] ℹ Order {order_id} already printing or spooled. Skipping duplicate spool.")
                        continue

                    if not self.cups.claim_order_for_spooling(order_id, aliases, force=False):
                        print(f"[WSS Kiosk Client] ℹ Order {order_id} already claimed/spooled. Skipping duplicate spool.")
                        continue

                    mark_order_processed(order_id, aliases)
                    self.printed_orders.update(all_ids)
                    merged_payload = {**staged_job, **payload}
                    # Sub-jobs must NEVER inherit files or subJobs arrays from master staged_job
                    if "_sub_" in str(order_id) or payload.get("fileIndex") or (payload.get("masterOrderId") and payload.get("masterOrderId") != order_id):
                        merged_payload.pop("files", None)
                        merged_payload.pop("subJobs", None)

                    merged_range = resolve_effective_page_range(
                        payload.get("pageRange"),
                        payload.get("pages"),
                        staged_job.get("pageRange"),
                        staged_job.get("pages"),
                        payload.get("selectedPages"),
                        payload.get("selected_pages"),
                        staged_job.get("selectedPages"),
                        staged_job.get("selected_pages"),
                    )
                    merged_payload["pageRange"] = merged_range
                    merged_payload["pages"] = merged_range
                    if merged_range.upper() in ("ALL", "*"):
                        merged_payload.pop("selectedPages", None)
                        merged_payload.pop("selected_pages", None)
                    elif staged_job.get("selectedPages") and not payload.get("selectedPages"):
                        merged_payload["selectedPages"] = staged_job["selectedPages"]
                    asyncio.create_task(self._handle_print_order(order_id, merged_payload))

                elif msg_type == "FILE_INCOMING":
                    print(f"[WSS Kiosk Client] 📄 Incoming file received via WS: {payload.get('fileName')} (Order: {order_id})")

                elif msg_type == "PAYMENT_CAPTURED":
                    print(f"[WSS Kiosk Client] ⚡ Order Event: PAYMENT_CAPTURED for Order {order_id}")
                    order_number = payload.get("orderNumber") or msg.get("orderNumber")
                    release_pin = payload.get("releasePin") or payload.get("otp") or payload.get("pickupCode")

                    staged_job = (
                        self.staged_jobs.get(order_id)
                        or (self.staged_jobs.get(order_number) if order_number else None)
                        or (self.staged_jobs.get(release_pin) if release_pin else None)
                        or {}
                    )

                    # For kiosk sessions (direct payment), PAYMENT_CAPTURED is an informative event.
                    # The central API will dispatch PRINT_EXECUTE containing the full document and settings.
                    # Only proceed here if we have a staged job already waiting with document payload.
                    if not staged_job and not payload.get("fileUrl") and not payload.get("filePath"):
                        print(f"[WSS Kiosk Client] ℹ Payment confirmed for Order {order_id}. Awaiting PRINT_EXECUTE dispatch...")
                        continue

                    # Multi-file orders are dispatched as individual sub-jobs via PRINT_EXECUTE with their exact documents & settings.
                    # Never auto-dispatch the master order batch on PAYMENT_CAPTURED when multiple files are present!
                    p_files = payload.get("files") or (payload.get("printSettings") or {}).get("files") or []
                    s_files = staged_job.get("files") or (staged_job.get("printSettings") or {}).get("files") or []
                    has_multi_files = (
                        (isinstance(p_files, list) and len(p_files) > 1)
                        or (isinstance(s_files, list) and len(s_files) > 1)
                        or bool(staged_job.get("subJobs") and len(staged_job["subJobs"]) > 1)
                        or bool(payload.get("subJobs") and len(payload["subJobs"]) > 1)
                    )
                    if has_multi_files:
                        print(f"[WSS Kiosk Client] ℹ Multi-file order {order_id} confirmed paid. Awaiting individual sub-job PRINT_EXECUTE dispatches...")
                        continue

                    # When payment is confirmed at kiosk (UPI QR or companion), execute print immediately!
                    # The PIN remains available as an order receipt / pickup reference, but does not block printing.
                    print(f"[WSS Kiosk Client] 💰 Payment confirmed for Order {order_id}. Auto-dispatching physical print...")

                    aliases = self._extract_clean_aliases(order_id, order_number)
                    all_ids = {order_id} | set(aliases)
                    if self._is_order_busy_or_printed(order_id, aliases):
                        print(f"[WSS Kiosk Client] ℹ Order {order_id} already printing or spooled. Skipping duplicate PAYMENT_CAPTURED.")
                        continue

                    if not self.cups.claim_order_for_spooling(order_id, aliases, force=False):
                        print(f"[WSS Kiosk Client] ℹ Order {order_id} already claimed/spooled. Skipping duplicate PAYMENT_CAPTURED.")
                        self.printed_orders.update(all_ids)
                        continue

                    self.printed_orders.update(all_ids)
                    merged_payload = {**staged_job, **payload}
                    merged_range = resolve_effective_page_range(
                        payload.get("pageRange"),
                        payload.get("pages"),
                        staged_job.get("pageRange"),
                        staged_job.get("pages"),
                        payload.get("selectedPages"),
                        payload.get("selected_pages"),
                        staged_job.get("selectedPages"),
                        staged_job.get("selected_pages"),
                    )
                    merged_payload["pageRange"] = merged_range
                    merged_payload["pages"] = merged_range
                    if merged_range.upper() in ("ALL", "*"):
                        merged_payload.pop("selectedPages", None)
                        merged_payload.pop("selected_pages", None)
                    elif staged_job.get("selectedPages") and not payload.get("selectedPages"):
                        merged_payload["selectedPages"] = staged_job["selectedPages"]
                    await self.print_queue.put((order_id, merged_payload))
                    print(f"[WSS Kiosk Client] 📋 Enqueued Order {order_id} into synchronous queue (Pending: {self.print_queue.qsize()})")

                elif msg_type == "PRINT_EXECUTE":
                    print(f"[WSS Kiosk Client] 🖨 Order Event: PRINT_EXECUTE for Order {order_id}")
                    order_number = payload.get("orderNumber") or msg.get("orderNumber")
                    release_pin = payload.get("releasePin") or payload.get("otp") or payload.get("pickupCode")
                    aliases = self._extract_clean_aliases(order_id, order_number)
                    all_ids = {order_id} | set(aliases)

                    force_reprint = bool(payload.get("forceReprint") or payload.get("adminForce"))
                    # Skip only if this exact order is currently actively running on hardware right this second
                    if not force_reprint and any(i in self.active_printing_orders for i in all_ids):
                        print(f"[WSS Kiosk Client] ℹ Order {order_id} currently printing on hardware. Skipping concurrent duplicate PRINT_EXECUTE.")
                        continue

                    # Deduplication: respect earlier claims unless explicit force reprint is requested
                    if not force_reprint:
                        if self._is_order_busy_or_printed(order_id, aliases):
                            print(f"[WSS Kiosk Client] ℹ Order {order_id} already spooled/printed. Skipping duplicate PRINT_EXECUTE.")
                            continue
                        if not self.cups.claim_order_for_spooling(order_id, aliases, force=False):
                            print(f"[WSS Kiosk Client] ℹ Order {order_id} already claimed for spooling. Skipping duplicate PRINT_EXECUTE.")
                            self.printed_orders.update(all_ids)
                            continue
                    else:
                        self.cups.claim_order_for_spooling(order_id, aliases, force=True)

                    self.printed_orders.update(all_ids)
                    staged_job = (
                        self.staged_jobs.get(order_id)
                        or (self.staged_jobs.get(order_number) if order_number else None)
                        or (self.staged_jobs.get(release_pin) if release_pin else None)
                        or {}
                    )
                    merged_payload = {**staged_job, **payload}
                    # Sub-jobs must NEVER inherit files or subJobs arrays from master staged_job
                    if "_sub_" in str(order_id) or payload.get("fileIndex") or (payload.get("masterOrderId") and payload.get("masterOrderId") != order_id):
                        merged_payload.pop("files", None)
                        merged_payload.pop("subJobs", None)

                    merged_range = resolve_effective_page_range(
                        payload.get("pageRange"),
                        payload.get("pages"),
                        staged_job.get("pageRange"),
                        staged_job.get("pages"),
                        payload.get("selectedPages"),
                        payload.get("selected_pages"),
                        staged_job.get("selectedPages"),
                        staged_job.get("selected_pages"),
                    )
                    merged_payload["pageRange"] = merged_range
                    merged_payload["pages"] = merged_range
                    if merged_range.upper() in ("ALL", "*"):
                        merged_payload.pop("selectedPages", None)
                        merged_payload.pop("selected_pages", None)
                    elif staged_job.get("selectedPages") and not payload.get("selectedPages"):
                        merged_payload["selectedPages"] = staged_job["selectedPages"]
                    await self.print_queue.put((order_id, merged_payload))
                    print(f"[WSS Kiosk Client] 📋 Enqueued Order {order_id} into synchronous queue (Pending: {self.print_queue.qsize()})")

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

        prefetch_key = f"{order_id}_{file_name}"
        if prefetch_key in self._active_prefetches:
            # An active download is already in progress for this document!
            # Wait up to 35 seconds for the download stream to finish writing to disk.
            for _ in range(70):
                await asyncio.sleep(0.5)
                if local_target.exists() and local_target.stat().st_size > 0:
                    return
            return
        self._active_prefetches.add(prefetch_key)

        try:
            if local_target.exists() and local_target.stat().st_size > 0:
                print(f"[WSS Kiosk Client] ✓ Document '{file_name}' already cached for {order_id} ({local_target.stat().st_size} bytes)")
                return

            # Build download URL with query params for station authentication
            raw_url = payload.get("fileUrl") or f"{self.api_url}/print/download/{order_id}"
            if raw_url.startswith("http://") or raw_url.startswith("https://"):
                base_dl_url = raw_url
            elif raw_url.startswith("/"):
                server_origin = re.sub(r"/api/?$", "", self.api_url)
                base_dl_url = f"{server_origin}{raw_url}"
            else:
                base_dl_url = f"{self.api_url}/{raw_url}"

            separator = "&" if "?" in base_dl_url else "?"
            file_url = f"{base_dl_url}{separator}kioskId={urllib.parse.quote(self.kiosk_id)}"
            if self.kiosk_secret:
                file_url += f"&secret={urllib.parse.quote(self.kiosk_secret)}"

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
            if local_target.exists() and local_target.stat().st_size > 0:
                print(f"[WSS Kiosk Client] ✓ Pre-fetched {file_name} ({local_target.stat().st_size} bytes)")

                # Immediately pre-convert Office files & images in background thread so printing is instant upon PIN entry!
                suffix = local_target.suffix.lower()
                if suffix in (
                    ".pptx", ".ppt", ".docx", ".doc", ".xlsx", ".xls",
                    ".odt", ".odp", ".ods", ".rtf", ".txt",
                    ".png", ".jpg", ".jpeg", ".webp"
                ):
                    conv_target = TEMP_JOBS_DIR / f"mono_{local_target.name}.pdf"
                    if not (conv_target.exists() and conv_target.stat().st_size > 500):
                        print(f"[WSS Kiosk Client] ⚡ Pre-converting '{local_target.name}' to PDF in background...")
                        def _preconvert():
                            try:
                                self.cups.prepare_printable_file(local_target)
                                print(f"[WSS Kiosk Client] ✓ Pre-conversion ready for '{local_target.name}'")
                            except Exception as err:
                                print(f"[WSS Kiosk Client] Pre-convert notice: {err}")
                        await loop.run_in_executor(None, _preconvert)
        except Exception as e:
            if local_target.exists() and local_target.stat().st_size == 0:
                try:
                    local_target.unlink()
                except Exception:
                    pass
            print(f"[WSS Kiosk Client] Pre-fetch notice: {e}")
        finally:
            self._active_prefetches.discard(prefetch_key)

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
        raw_pages = resolve_effective_page_range(
            payload.get("selectedPages"),
            payload.get("selected_pages"),
            payload.get("pageRange"),
            payload.get("pages"),
            "1"
        )
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

    async def _process_print_queue(self):
        """Worker that serializes all physical print jobs into a strictly synchronous pipeline (no multithreading)."""
        print("[WSS Kiosk Client] 🛡 Synchronous Print Queue Worker active.")
        while self.is_running:
            try:
                order_id, payload = await self.print_queue.get()
                try:
                    print(f"\n[WSS Kiosk Client] 🚀 Synchronous Worker processing Order {order_id} (Queue remaining: {self.print_queue.qsize()})...")
                    await self._handle_print_order(order_id, payload)
                except Exception as ex:
                    print(f"[WSS Kiosk Client] Error processing queued order {order_id}: {ex}")
                finally:
                    self.print_queue.task_done()
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"[WSS Kiosk Client] Queue worker loop notice: {e}")
                await asyncio.sleep(0.5)

    async def _handle_print_order(self, order_id: str, payload: dict):
        """Executes the physical print and streams progress back over WSS."""
        if not order_id:
            return

        order_number = payload.get("orderNumber")
        release_pin = payload.get("releasePin") or payload.get("otp") or payload.get("pickupCode")
        aliases = self._extract_clean_aliases(order_id, order_number)
        all_ids = {str(order_id).strip()} | {str(a).strip() for a in aliases if a}

        # Concurrency Lock: Prevent simultaneous parallel executions for the same order
        if any(i in self.active_printing_orders for i in all_ids):
            print(f"[WSS Kiosk Client] ⚠️ Prevented concurrent duplicate execution: Order {order_id} is already actively printing!")
            return

        self.active_printing_orders.update(all_ids)

        try:
            await self._execute_print_order_internal(order_id, payload, aliases, all_ids)
        finally:
            for i in all_ids:
                self.active_printing_orders.discard(i)

    async def _execute_print_order_internal(self, order_id: str, payload: dict, aliases: list, all_ids: set):
        # Check if this order is a sub-job:
        # A sub-job MUST strictly print only itself and NEVER re-expand payload["files"] or payload["subJobs"]!
        is_sub_job = ("_sub_" in str(order_id)) or bool(payload.get("fileIndex")) or bool(
            payload.get("masterOrderId") and str(payload.get("masterOrderId")).strip() != str(order_id).strip()
        )

        # Build the list of jobs to print (handles multi-file orders with distinct settings)
        jobs_to_print = []
        if is_sub_job:
            # Individual sub-job: print ONLY this document
            jobs_to_print = [payload]
        elif payload.get("subJobs") and isinstance(payload["subJobs"], list) and len(payload["subJobs"]) > 0:
            # Filter out any accidental master orders that have files arrays
            jobs_to_print = [sj for sj in payload["subJobs"] if not (sj.get("files") and len(sj.get("files", [])) > 1)]
            if not jobs_to_print:
                jobs_to_print = payload["subJobs"]
        elif payload.get("files") and isinstance(payload["files"], list) and len(payload["files"]) > 0:
            is_single = (len(payload["files"]) == 1)
            for idx, f in enumerate(payload["files"]):
                f_id = f.get("orderId") or (order_id if is_single else f"{order_id}_sub_{idx + 1}")
                f_settings = f.get("settings") or {}
                # Strict copy count: use the file's explicit copies if set, otherwise fallback to payload copies or 1.
                f_copies = 1
                if f_settings.get("copies") is not None:
                    try:
                        f_copies = max(1, int(f_settings["copies"]))
                    except (ValueError, TypeError):
                        f_copies = 1
                elif f.get("copies") is not None:
                    try:
                        f_copies = max(1, int(f["copies"]))
                    except (ValueError, TypeError):
                        f_copies = 1
                elif payload.get("copies") is not None:
                    try:
                        f_copies = max(1, int(payload.get("copies") or 1))
                    except (ValueError, TypeError):
                        f_copies = 1

                jobs_to_print.append({
                    **payload,
                    **f,
                    "orderId": f_id,
                    "fileName": f.get("fileName") or payload.get("fileName") or f"Document_{idx + 1}.pdf",
                    "copies": f_copies,
                    "colourMode": f_settings.get("colour") or f.get("colour") or (payload.get("colourMode") if is_single else "BW"),
                    "duplex": f_settings.get("duplex") or f.get("duplex") or payload.get("duplex") or "SINGLE",
                    "paperSize": f_settings.get("paperSize") or f.get("paperSize") or payload.get("paperSize") or "A4",
                    "pageRange": resolve_effective_page_range(
                        f_settings.get("selectedPages"),
                        f_settings.get("selected_pages"),
                        f.get("selectedPages"),
                        f.get("selected_pages"),
                        f_settings.get("pages"),
                        f_settings.get("pageRange"),
                        f.get("pageRange"),
                        f.get("pages"),
                        (payload.get("selectedPages") if is_single else None),
                        (payload.get("selected_pages") if is_single else None),
                        (payload.get("pageRange") if is_single else None),
                        (payload.get("pages") if is_single else None),
                    ),
                    "selectedPages": (
                        f_settings.get("selectedPages")
                        or f.get("selectedPages")
                        or (payload.get("selectedPages") if is_single else None)
                        or f_settings.get("selected_pages")
                        or f.get("selected_pages")
                        or (payload.get("selected_pages") if is_single else None)
                    ),
                    "scaling": f_settings.get("scaling") or f.get("scaling") or payload.get("scaling") or "FIT",
                    "orientation": f_settings.get("orientation") or f.get("orientation") or payload.get("orientation") or "AUTO",
                    "pagesPerSheet": f_settings.get("pagesPerSheet") or f.get("pagesPerSheet") or payload.get("pagesPerSheet") or 1,
                    "pageColours": f_settings.get("pageColours") or f.get("pageColours") or (payload.get("pageColours") if is_single else None),
                    "pageCopies": f_settings.get("pageCopies") or f.get("pageCopies") or (payload.get("pageCopies") if is_single else None),
                    "fileUrl": f.get("fileUrl") or (payload.get("fileUrl") if is_single else f"{self.api_url}/print/download/{f_id}"),
                })
        else:
            jobs_to_print = [payload]

        for j_idx, job_payload in enumerate(jobs_to_print):
            job_order_id = job_payload.get("orderId") or f"{order_id}_sub_{j_idx + 1}"
            # Deduplication guard: if this sub-item was already spooled, skip it!
            if not is_sub_job and len(jobs_to_print) > 1:
                if self._is_order_busy_or_printed(job_order_id) or not self.cups.claim_order_for_spooling(job_order_id, force=False):
                    print(f"[WSS Kiosk Client] ℹ Sub-item {job_order_id} already spooled/printed. Skipping duplicate.")
                    continue
            settings = job_payload.get("printSettings") or job_payload.get("settings") or {}
            file_name = job_payload.get("fileName") or settings.get("fileName") or f"document_{j_idx + 1}.pdf"
            raw_copies = job_payload.get("copies") if job_payload.get("copies") is not None else settings.get("copies")
            copies = max(1, int(raw_copies or 1))
            raw_col = str(job_payload.get("colourMode") or job_payload.get("colour") or settings.get("colourMode") or settings.get("colour") or "BW").upper().replace("&", "")
            colour_mode = "COLOUR" if ("COLOUR" in raw_col or "COLOR" in raw_col) else "BW"
            paper_size = str(job_payload.get("paperSize") or settings.get("paperSize") or "A4").upper().strip()

            raw_dup = job_payload.get("duplex") if job_payload.get("duplex") is not None else settings.get("duplex")
            if isinstance(raw_dup, bool):
                duplex = "DOUBLE" if raw_dup else "SINGLE"
            else:
                dup_norm = str(raw_dup or "SINGLE").upper().strip()
                if dup_norm in ("DOUBLE", "DUPLEX", "TWO-SIDED", "2-SIDED", "TWO_SIDED", "2_SIDED", "TRUE", "1"):
                    duplex = "DOUBLE"
                elif dup_norm in ("TWO_SIDED_SHORT", "TWO-SIDED-SHORT-EDGE", "SHORT_EDGE"):
                    duplex = "TWO_SIDED_SHORT"
                else:
                    duplex = "SINGLE"

            first_f = (job_payload.get("files") or [{}])[0] if isinstance(job_payload.get("files"), list) and len(job_payload.get("files")) > 0 else {}
            ff_set = first_f.get("settings") or {}

            page_range = resolve_effective_page_range(
                job_payload.get("pageRange"),
                job_payload.get("pages"),
                settings.get("pageRange"),
                settings.get("pages"),
                first_f.get("pageRange"),
                first_f.get("pages"),
                ff_set.get("pageRange"),
                ff_set.get("pages"),
                job_payload.get("selectedPages"),
                job_payload.get("selected_pages"),
                settings.get("selectedPages"),
                settings.get("selected_pages"),
                first_f.get("selectedPages"),
                first_f.get("selected_pages"),
                ff_set.get("selectedPages"),
                ff_set.get("selected_pages"),
            )

            # Extract selected_pages_list to pass directly to CUPS controller
            selected_pages_list = None
            if not page_range or page_range.upper() in ("ALL", "*"):
                selected_pages_list = None  # None signals all pages to CUPS!
            else:
                raw_sel = (
                    job_payload.get("selectedPages")
                    or job_payload.get("selected_pages")
                    or settings.get("selectedPages")
                    or settings.get("selected_pages")
                    or first_f.get("selectedPages")
                    or ff_set.get("selectedPages")
                )
                if raw_sel:
                    if isinstance(raw_sel, (list, tuple, set)):
                        clean = [int(p) for p in raw_sel if str(p).isdigit() and int(p) > 0]
                        if clean and (len(clean) > 1 or clean != [1] or page_range == "1"):
                            selected_pages_list = clean
                    elif isinstance(raw_sel, str) and raw_sel.strip().startswith("[") and raw_sel.strip().endswith("]"):
                        try:
                            arr = json.loads(raw_sel)
                            if isinstance(arr, list):
                                clean = [int(p) for p in arr if str(p).isdigit() and int(p) > 0]
                                if clean and (len(clean) > 1 or clean != [1] or page_range == "1"):
                                    selected_pages_list = clean
                        except Exception:
                            pass
                if not selected_pages_list and page_range and page_range.upper() not in ("ALL", "*"):
                    try:
                        from cups_controller import CupsController
                        selected_pages_list = CupsController._parse_page_range(page_range, 9999)
                    except Exception:
                        pass

            scaling = str(job_payload.get("scaling") or settings.get("scaling") or "FIT").strip()
            orientation = str(job_payload.get("orientation") or settings.get("orientation") or "AUTO").upper().strip()
            pages_per_sheet = int(job_payload.get("pagesPerSheet") or settings.get("pagesPerSheet") or 1)

            page_colours = job_payload.get("pageColours") or settings.get("pageColours")
            page_copies = job_payload.get("pageCopies") or settings.get("pageCopies")

            print(f"\n[WSS Kiosk Client] 🖨 Starting Print [{j_idx + 1}/{len(jobs_to_print)}] for Order {job_order_id}: {file_name}")
            print(f"  Exact Settings: {copies} copies | {colour_mode} | {duplex} | {paper_size} | Pages: {page_range} | Scaling: {scaling} | Orientation: {orientation} | N-Up: {pages_per_sheet} | Custom Colors: {bool(page_colours)}")

            # Resolve local document path
            local_target = TEMP_JOBS_DIR / f"{job_order_id}_{file_name}"
            if not local_target.exists() or local_target.stat().st_size == 0:
                await self._prefetch_document(job_order_id, job_payload)

            if not local_target.exists() or local_target.stat().st_size == 0:
                is_sub = "_sub_" in job_order_id
                if not is_sub:
                    master_target = TEMP_JOBS_DIR / f"{order_id}_{file_name}"
                    if master_target.exists() and master_target.stat().st_size > 0:
                        local_target = master_target
                else:
                    for cand in TEMP_JOBS_DIR.glob(f"{job_order_id}_*"):
                        if cand.exists() and cand.stat().st_size > 0:
                            local_target = cand
                            print(f"[WSS Kiosk Client] ✓ Fallback matched sub-job cached document: '{cand.name}'")
                            break

            if not local_target.exists() or local_target.stat().st_size == 0:
                print(f"[WSS Kiosk Client] ❌ Download failed or file empty for Order {job_order_id}. Cannot print missing document.")
                self.cups.unclaim_order(order_id, aliases)
                for i in all_ids:
                    self.printed_orders.discard(i)
                fail_msg = {
                    "type": "PRINT_ERROR",
                    "kioskId": self.kiosk_id,
                    "orderId": order_id,
                    "payload": {
                        "error": f"Failed to download printable document for Order {job_order_id}",
                        "timestamp": int(time.time() * 1000),
                    },
                }
                if self.ws:
                    try:
                        await self.ws.send(json.dumps(fail_msg))
                    except Exception:
                        pass
                return

            # Office conversion for PPT and DOCX with live phase feedback
            is_ppt = local_target.suffix.lower() in (".pptx", ".ppt", ".ppsx") or bool(re.search(r"\.(pptx?|ppsx?)$", file_name, re.I))
            is_docx = local_target.suffix.lower() in (".docx", ".doc") or bool(re.search(r"\.(docx?|doc)$", file_name, re.I))
            if is_ppt or is_docx:
                phase_msg = "Processing PPT into print PDF…" if is_ppt else "Processing DOCX into print PDF…"
                print(f"[WSS Kiosk Client] 📄 {phase_msg} for Order {job_order_id} ({file_name})")
                if self.ws:
                    try:
                        await self.ws.send(json.dumps({
                            "type": "PRINT_PROGRESS",
                            "kioskId": self.kiosk_id,
                            "orderId": job_order_id,
                            "progress": 5,
                            "phase": phase_msg,
                            "status": "PROCESSING",
                            "timestamp": int(time.time() * 1000),
                        }))
                    except Exception:
                        pass

                try:
                    loop = asyncio.get_event_loop()
                    conv_path = await loop.run_in_executor(
                        None,
                        lambda: self.cups._convert_office_to_pdf(local_target)
                    )
                    if conv_path and Path(conv_path).exists() and Path(conv_path).suffix.lower() == ".pdf":
                        local_target = Path(conv_path)
                        print(f"[WSS Kiosk Client] ✓ Office doc successfully converted to PDF: {local_target}")
                except Exception as conv_err:
                    print(f"[WSS Kiosk Client] Office conversion notice: {conv_err}")

            # Dispatch to CUPS physical printer with all specified settings applied
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
                        selected_pages=selected_pages_list,
                        scaling=scaling,
                        pages_per_sheet=pages_per_sheet,
                        printer_name=(self.printer_name if self.printer_name and self.printer_name != "auto" else None),
                        job_title=f"Order {job_order_id} - {file_name}",
                        page_colours=page_colours,
                        page_copies=page_copies,
                        orientation=orientation,
                    )
                )
                print(f"[WSS Kiosk Client] CUPS Spooler response for [{j_idx + 1}/{len(jobs_to_print)}]: {result}")
                if isinstance(result, dict) and result.get("success"):
                    self.cups.claim_order_for_spooling(job_order_id, force=True)
                    self.printed_orders.add(str(job_order_id).strip())
            except Exception as e:
                print(f"[WSS Kiosk Client] CUPS dispatch error: {e}")
                result = {"success": False, "error": str(e)}

        # Check for spooler dispatch failure
        if isinstance(result, dict) and not result.get("success"):
            error_reason = result.get("error") or "Hardware spooler rejected the job"
            print(f"[WSS Kiosk Client] ❌ Print job failed: {error_reason}")
            self.cups.unclaim_order(order_id, aliases)
            for i in all_ids:
                self.printed_orders.discard(i)
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
            # Preserve local documents on failure for 10 minutes so admin/user diagnostics or retries succeed
            asyncio.create_task(self._delayed_order_cleanup(order_id, delay_seconds=600))
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

        # Mark processed persistently only when print was successfully executed
        mark_order_processed(order_id, aliases)
        self.printed_orders.update(all_ids)

        # Delayed Privacy Enforcement: Retain local document & converted slices intact on disk for 10 minutes (600s)
        # to ensure CUPS rasterizers, filter pipelines, and hardware paper feeds finish printing completely.
        print(f"[WSS Kiosk Client] ⏱ Preserving local print job files on disk for 10 minutes before automated purge.")
        asyncio.create_task(self._delayed_order_cleanup(order_id, delay_seconds=600))

    async def _run_auto_update(self, payload: Optional[dict] = None):
        """Executes the kiosk_autoupdate.sh script asynchronously and streams real-time telemetry."""
        try:
            script_path = Path(__file__).resolve().parent.parent / "scripts" / "kiosk_autoupdate.sh"
            if not script_path.exists():
                print(f"[WSS Kiosk Client] ⚠️ Auto-update script not found at {script_path}")
                return

            print(f"[WSS Kiosk Client] 🚀 Initiating autonomous GitHub pull via {script_path}...")
            if self.ws:
                try:
                    await self.ws.send(json.dumps({
                        "type": "UPDATE_STATUS",
                        "kioskId": self.kiosk_id,
                        "payload": {
                            "status": "RUNNING",
                            "message": "GitHub auto-update started on Raspberry Pi...",
                            "startedAt": int(time.time() * 1000),
                        },
                        "timestamp": int(time.time() * 1000)
                    }))
                except Exception:
                    pass

            loop = asyncio.get_event_loop()
            import subprocess

            force = bool((payload or {}).get("force", False))
            branch = str((payload or {}).get("branch") or "").strip()

            def _execute():
                cmd = ["bash", str(script_path), "--restart"]
                if force:
                    cmd.append("--force")
                if branch:
                    cmd.extend(["--branch", branch])
                res = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
                return res.returncode, res.stdout, res.stderr

            code, stdout, stderr = await loop.run_in_executor(None, _execute)

            git_ver = self.monitor.get_git_version()
            success = (code == 0)

            print(f"[WSS Kiosk Client] ✓ Auto-update finished (exit code {code}). Active Git Hash: {git_ver.get('shortHash')}")

            if self.ws:
                try:
                    await self.ws.send(json.dumps({
                        "type": "UPDATE_STATUS",
                        "kioskId": self.kiosk_id,
                        "payload": {
                            "status": "SUCCESS" if success else "FAILED",
                            "returnCode": code,
                            "gitVersion": git_ver,
                            "stdoutTail": stdout.strip().splitlines()[-10:] if stdout else [],
                            "stderr": stderr.strip() if not success else None,
                            "completedAt": int(time.time() * 1000),
                        },
                        "timestamp": int(time.time() * 1000)
                    }))
                except Exception:
                    pass

            # Broadcast updated hardware & version heartbeat immediately
            await self._send_heartbeat()
        except Exception as e:
            print(f"[WSS Kiosk Client] Error executing auto-update: {e}")



if __name__ == "__main__":
    client = KioskWsClient()
    try:
        asyncio.run(client.connect())
    except KeyboardInterrupt:
        print("\n[WSS Kiosk Client] Shutting down.")
