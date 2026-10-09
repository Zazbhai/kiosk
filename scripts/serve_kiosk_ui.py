#!/usr/bin/env python3
"""
PrintBooth Kiosk UI Server & Lifecycle Manager
===============================================
Serves the prebuilt Touchscreen UI on port 5175 with zero latency.
Supports /api/exit endpoint to immediately terminate Chromium kiosk mode upon Ctrl+C.
"""

import sys
import os
import signal
import subprocess
from http.server import SimpleHTTPRequestHandler, HTTPServer
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5175
SERVE_DIR = sys.argv[2] if len(sys.argv) > 2 else "."

def terminate_kiosk():
    print("\n[Kiosk Server] 🛑 Exit signal received! Terminating Chromium Kiosk...")
    try:
        subprocess.run(["pkill", "-f", "chromium"], check=False)
        subprocess.run(["pkill", "-f", "chromium-browser"], check=False)
    except Exception:
        pass
    os._exit(0)

# Try loading CUPS controller for local zero-latency hardware status
try:
    brain_dir = Path(__file__).resolve().parent.parent / "brain"
    if str(brain_dir) not in sys.path:
        sys.path.insert(0, str(brain_dir))
    from cups_controller import CupsController
    local_cups = CupsController()
except Exception:
    local_cups = None

def get_local_printer_status():
    if local_cups:
        try:
            info = local_cups.get_printers()
            printers = info.get("printers", [])
            if printers:
                active = next((p for p in printers if p.get("is_default")), printers[0])
                return {
                    "success": True,
                    "isOnline": bool(active.get("is_online", False)),
                    "printerStatus": active.get("state", "OFFLINE"),
                    "activePrinter": active.get("name", "Unknown"),
                }
        except Exception:
            pass
    # Linux CLI fallback
    if sys.platform != "win32":
        try:
            out = subprocess.check_output(["lpstat", "-p"], text=True, stderr=subprocess.DEVNULL)
            is_disabled = "disabled" in out.lower()
            return {
                "success": True,
                "isOnline": not is_disabled and len(out.strip()) > 0,
                "printerStatus": "OFFLINE" if is_disabled else "READY",
                "activePrinter": "PrintBooth_Printer",
            }
        except Exception:
            return {"success": True, "isOnline": False, "printerStatus": "OFFLINE", "activePrinter": "None"}
    return {"success": True, "isOnline": True, "printerStatus": "READY", "activePrinter": "Simulated"}

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

    server = HTTPServer(("0.0.0.0", PORT), KioskHTTPHandler)
    print(f"[Kiosk Server] Serving UI from {SERVE_DIR} on port {PORT}...")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        terminate_kiosk()

if __name__ == "__main__":
    main()
