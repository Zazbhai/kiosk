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

# Try loading CUPS controller for local zero-latency hardware status
try:
    brain_dir = Path(__file__).resolve().parent.parent / "brain"
    if str(brain_dir) not in sys.path:
        sys.path.insert(0, str(brain_dir))
    from cups_controller import CupsController
    local_cups = CupsController()
except Exception:
    local_cups = None

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
