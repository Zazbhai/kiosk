#!/usr/bin/env python3
"""
PrintBooth Kiosk UI Server & Lifecycle Manager
===============================================
Serves the prebuilt Touchscreen UI on port 5175 with zero latency.
Supports /api/exit endpoint to immediately terminate Chromium kiosk mode upon Ctrl+C.
Provides cached hardware status with thread pooling for high-performance Raspberry Pi runtime.
"""

import sys
import os
import time
import signal
import subprocess
from pathlib import Path
from http.server import SimpleHTTPRequestHandler

try:
    from http.server import ThreadingHTTPServer as ServerClass
except ImportError:
    from http.server import HTTPServer as ServerClass

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5175
SERVE_DIR = sys.argv[2] if len(sys.argv) > 2 else "."

def terminate_kiosk():
    print("\n[Kiosk Server] 🛑 Exit signal received! Terminating Chromium Kiosk...")
    try:
        Path("/tmp/printbooth_exit_requested").touch()
    except Exception:
        pass
    try:
        subprocess.run(["pkill", "-f", "chromium"], check=False)
        subprocess.run(["pkill", "-f", "chromium-browser"], check=False)
    except Exception:
        pass
    os._exit(0)

def launch_wifi_changer():
    print("\n[Kiosk Server] 📶 Wi-Fi changer triggered! Launching terminal utility on DISPLAY...")
    try:
        Path("/tmp/printbooth_kiosk_paused").touch()
    except Exception:
        pass

    script_dir = Path(__file__).resolve().parent
    candidates = [
        script_dir / "launch_wifi_terminal.sh",
        Path("/usr/local/bin/printbooth-wifi"),
        Path.home() / "printer_automation" / "kiosk" / "scripts" / "launch_wifi_terminal.sh",
        Path.home() / "kiosk" / "scripts" / "launch_wifi_terminal.sh",
        Path("/home/kiosk/printer_automation/kiosk/scripts/launch_wifi_terminal.sh"),
        Path("/home/kiosk/kiosk/scripts/launch_wifi_terminal.sh"),
        Path("/home/pi/printer_automation/kiosk/scripts/launch_wifi_terminal.sh"),
    ]
    launcher = None
    for c in candidates:
        if c.is_file():
            launcher = str(c)
            break

    if not launcher:
        launcher = str(script_dir / "launch_wifi_terminal.sh")

    env = os.environ.copy()
    env["DISPLAY"] = env.get("DISPLAY", ":0")
    try:
        subprocess.Popen(["bash", launcher], env=env)
    except Exception as e:
        print(f"[Kiosk Server] Error spawning wifi launcher: {e}")

# Try loading CUPS controller & staged orders for local zero-latency PIN verification
try:
    brain_dir = Path(__file__).resolve().parent.parent / "brain"
    if str(brain_dir) not in sys.path:
        sys.path.insert(0, str(brain_dir))
    from cups_controller import CupsController
    from order_tracker import get_staged_order_by_pin, remove_staged_order, mark_order_processed, is_order_processed
    from config import TEMP_JOBS_DIR, PRINTER_NAME, API_URL, KIOSK_ID, KIOSK_SECRET
    local_cups = CupsController()
except Exception as _import_err:
    print(f"[Kiosk Server] Notice loading brain components: {_import_err}")
    local_cups = None
    get_staged_order_by_pin = None
    remove_staged_order = None
    mark_order_processed = None
    is_order_processed = None
    TEMP_JOBS_DIR = Path("/tmp/printbooth_jobs")
    PRINTER_NAME = "auto"
    API_URL = "http://localhost:5000/api"
    KIOSK_ID = "PB-001"
    KIOSK_SECRET = ""

import urllib.request
import urllib.parse
import json
import threading

def print_staged_order_in_background(order: dict):
    """Executes physical print via CUPS immediately on the Pi without needing remote API roundtrip."""
    try:
        order_id = str(order.get("orderId") or order.get("orderNumber") or "PB-UNKNOWN")
        order_number = str(order.get("orderNumber") or "")
        pin = str(order.get("releasePin") or order.get("otp") or order.get("pickupCode") or "")
        aliases = [a for a in [order_number, pin] if a and a != order_id]

        file_name = str(order.get("fileName") or "document.pdf")
        copies = max(1, int(order.get("copies") or 1))
        raw_c = str(order.get("colourMode") or order.get("colour") or "BW").upper().replace("&", "")
        colour_mode = "COLOUR" if raw_c in ("COLOR", "COLOUR") else "BW"
        duplex = str(order.get("duplex") or "SINGLE").upper()
        paper_size = str(order.get("paperSize") or "A4").upper()
        page_range = str(order.get("pageRange") or order.get("pages") or "ALL").strip()
        scaling = str(order.get("scaling") or "FIT").strip()
        orientation = str(order.get("orientation") or "AUTO").upper().strip()
        pages_per_sheet = int(order.get("pagesPerSheet") or 1)

        # Locate pre-fetched document file on disk
        local_target = TEMP_JOBS_DIR / f"{order_id}_{file_name}"
        if not local_target.exists():
            matches = list(TEMP_JOBS_DIR.glob(f"*{order_id}*"))
            if matches:
                local_target = matches[0]

        # If not already on disk, perform direct download from backend
        if not local_target.exists() or local_target.stat().st_size == 0:
            print(f"[Kiosk Server] 📥 Downloading '{file_name}' for Order {order_id}...")
            dl_url = f"{API_URL}/print/download/{order_id}?kioskId={urllib.parse.quote(KIOSK_ID)}"
            if KIOSK_SECRET:
                dl_url += f"&secret={urllib.parse.quote(KIOSK_SECRET)}"
            headers = {
                "User-Agent": "Mozilla/5.0 (X11; Linux armv7l) AppleWebKit/537.36 Chrome/120.0.0.0 PrintBooth-Kiosk/1.0",
                "X-Kiosk-Id": KIOSK_ID,
                "Accept": "*/*",
            }
            if KIOSK_SECRET:
                headers["X-Kiosk-Secret"] = KIOSK_SECRET
            req = urllib.request.Request(dl_url, headers=headers)
            with urllib.request.urlopen(req, timeout=20) as resp, open(local_target, "wb") as f:
                f.write(resp.read())
            print(f"[Kiosk Server] ✓ Downloaded {file_name} ({local_target.stat().st_size} bytes)")

        if local_target.exists() and local_cups:
            print(f"\n[Kiosk Server] 🖨 DISPATCHING PHYSICAL HARDWARE PRINT FOR ORDER {order_id} ({file_name})...")
            print(f"  Settings: {copies} copies | {colour_mode} | {duplex} | {paper_size} | Pages: {page_range}")
            res = local_cups.print_file(
                file_path=str(local_target),
                copies=copies,
                colour_mode=colour_mode,
                duplex=duplex,
                paper_size=paper_size,
                page_range=page_range,
                scaling=scaling,
                pages_per_sheet=pages_per_sheet,
                printer_name=PRINTER_NAME,
                job_title=f"Order {order_id} - {file_name}",
                orientation=orientation,
            )
            print(f"[Kiosk Server] CUPS print spool result: {res}")
            if mark_order_processed:
                mark_order_processed(order_id, aliases)

            # Notify remote API in background that print was released
            try:
                status_url = f"{API_URL}/orders/{order_id}/status"
                req_data = json.dumps({"status": "READY_FOR_COLLECTION", "kioskId": KIOSK_ID, "verifiedLocally": True}).encode("utf-8")
                req = urllib.request.Request(status_url, data=req_data, headers={"Content-Type": "application/json", "X-Kiosk-Id": KIOSK_ID}, method="POST")
                urllib.request.urlopen(req, timeout=4)
            except Exception:
                pass
    except Exception as e:
        print(f"[Kiosk Server] [ERROR] printing staged order: {e}")

_status_cache = None
_status_cache_time = 0.0

def get_local_printer_status():
    global _status_cache, _status_cache_time
    now = time.time()
    # Cache status for 2.0s to avoid excessive CUPS / lpstat subprocess thrashing on Pi
    if _status_cache is not None and (now - _status_cache_time) < 2.0:
        return _status_cache

    status = None
    if local_cups:
        try:
            # 1. Check physical USB connection via lsusb
            usb_info = local_cups.check_usb_printer()
            if usb_info.get("connected"):
                p_name = usb_info.get("printerFound") or "Brother DCP-T420W"
                # Unpause all CUPS queues immediately in background
                if sys.platform != "win32":
                    subprocess.run(["cupsenable", "-a"], capture_output=True, stdin=subprocess.DEVNULL, timeout=1)
                    subprocess.run(["cupsaccept", "-a"], capture_output=True, stdin=subprocess.DEVNULL, timeout=1)
                status = {
                    "success": True,
                    "isOnline": True,
                    "printerStatus": "READY",
                    "activePrinter": p_name,
                }
            else:
                info = local_cups.get_printers()
                printers = info.get("printers", [])
                if printers:
                    active = next((p for p in printers if p.get("is_default")), printers[0])
                    is_on = bool(active.get("is_online", False))
                    status = {
                        "success": True,
                        "isOnline": is_on,
                        "printerStatus": active.get("state", "READY" if is_on else "OFFLINE"),
                        "activePrinter": active.get("name", "Unknown"),
                    }
        except Exception:
            pass

    # Linux CLI fallback
    if status is None and sys.platform != "win32":
        try:
            out = subprocess.check_output(["lpstat", "-p"], text=True, stderr=subprocess.DEVNULL)
            is_disabled = "disabled" in out.lower()
            status = {
                "success": True,
                "isOnline": not is_disabled and len(out.strip()) > 0,
                "printerStatus": "OFFLINE" if is_disabled else "READY",
                "activePrinter": "PrintBooth_Printer",
            }
        except Exception:
            status = {"success": True, "isOnline": False, "printerStatus": "OFFLINE", "activePrinter": "None"}

    if status is None:
        status = {"success": True, "isOnline": False, "printerStatus": "OFFLINE", "activePrinter": "None"}

    _status_cache = status
    _status_cache_time = now
    return status

class KioskHTTPHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=SERVE_DIR, **kwargs)

    def end_headers(self):
        # Enforce zero-cache so kiosk updates are reflected immediately on reload
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_GET(self):
        if self.path == "/api/wifi":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(b'{"status":"launching_wifi"}\n')
            import threading
            threading.Timer(0.1, launch_wifi_changer).start()
            return

        if self.path == "/api/exit":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(b'{"status":"exiting"}\n')
            import threading
            threading.Timer(0.15, terminate_kiosk).start()
            return

        if self.path == "/api/printer/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            import json
            data = get_local_printer_status()
            self.wfile.write(json.dumps(data).encode("utf-8") + b"\n")
            return

        # SPA routing fallback: serve index.html for virtual routes
        clean_path = self.path.split("?")[0]
        full_path = os.path.join(SERVE_DIR, clean_path.lstrip("/"))
        if not os.path.exists(full_path) and not clean_path.startswith("/api/"):
            self.path = "/index.html"

        return super().do_GET()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Kiosk-Id, Authorization")
        self.end_headers()

    def do_POST(self):
        clean_path = self.path.split("?")[0]
        if clean_path in ("/api/verify-pin", "/api/print/verify-pin") or clean_path.endswith("/verify-pin"):
            content_len = int(self.headers.get("Content-Length", 0))
            post_body = self.rfile.read(content_len).decode("utf-8") if content_len > 0 else "{}"
            try:
                body = json.loads(post_body)
            except Exception:
                body = {}

            pin = str(body.get("pin") or "").strip()
            kiosk_param = str(body.get("kioskId") or KIOSK_ID).strip().upper()
            print(f"\n[Kiosk Server] 🔑 Local PIN verification received on Touchscreen: '{pin}' (Kiosk: {kiosk_param})")

            # 1. Primary path: verify locally on the Pi with zero network roundtrip
            matched = get_staged_order_by_pin(pin) if get_staged_order_by_pin else None
            if matched:
                order_id = str(matched.get("orderId") or matched.get("orderNumber") or "PB-ORDER")
                print(f"[Kiosk Server] 🟢 LOCAL MATCH CONFIRMED for PIN '{pin}' -> Order {order_id} ({matched.get('fileName')})")
                if remove_staged_order:
                    remove_staged_order(pin, order_id)

                # Immediately launch physical printing in background thread
                threading.Thread(target=print_staged_order_in_background, args=(matched,), daemon=True).start()

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                resp = {
                    "success": True,
                    "valid": True,
                    "local": True,
                    "order": matched,
                    "message": "PIN verified locally on station! Hardware printing started.",
                }
                self.wfile.write(json.dumps(resp).encode("utf-8") + b"\n")
                return

            # 2. Transparent fallback: If order was not yet cached locally, verify with remote central API
            try:
                api_target = f"{API_URL}/kiosks/{KIOSK_ID}/verify-pin"
                req_data = json.dumps({"pin": pin, "kioskId": KIOSK_ID}).encode("utf-8")
                req = urllib.request.Request(
                    api_target,
                    data=req_data,
                    headers={
                        "Content-Type": "application/json",
                        "X-Kiosk-Id": KIOSK_ID,
                        "User-Agent": "Mozilla/5.0 (X11; Linux armv7l) AppleWebKit/537.36 Chrome/120.0.0.0 PrintBooth-Kiosk/1.0",
                    },
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=5) as resp:
                    api_resp = json.loads(resp.read().decode("utf-8"))
                    if api_resp.get("success") or api_resp.get("valid"):
                        ord_data = api_resp.get("order") or api_resp.get("data") or api_resp
                        threading.Thread(target=print_staged_order_in_background, args=(ord_data,), daemon=True).start()
                    self.send_response(resp.status)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.end_headers()
                    self.wfile.write(json.dumps(api_resp).encode("utf-8") + b"\n")
                    return
            except Exception as e:
                print(f"[Kiosk Server] Remote fallback verification error: {e}")

            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"success": False, "valid": False, "error": "Invalid PIN. Code not recognized or already printed."}).encode("utf-8") + b"\n")
            return

    def log_message(self, format, *args):
        # Suppress noisy HTTP asset logs on Raspberry Pi to avoid SD card wear and CPU overhead
        pass

def main():
    signal.signal(signal.SIGINT, lambda s, f: terminate_kiosk())
    signal.signal(signal.SIGTERM, lambda s, f: terminate_kiosk())

    server = ServerClass(("0.0.0.0", PORT), KioskHTTPHandler)
    print(f"[Kiosk Server] Serving UI from {SERVE_DIR} on port {PORT} with Threading...")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        terminate_kiosk()

if __name__ == "__main__":
    main()
