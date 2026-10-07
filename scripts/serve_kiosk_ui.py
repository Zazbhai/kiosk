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

class KioskHTTPHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=SERVE_DIR, **kwargs)

    def do_GET(self):
        if self.path == "/api/exit":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(b'{"status":"exiting"}\n')
            # Trigger termination in next event loop tick
            import threading
            threading.Timer(0.15, terminate_kiosk).start()
            return
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
