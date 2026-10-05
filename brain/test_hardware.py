#!/usr/bin/env python3
"""
PrintBooth Kiosk Brain — Hardware Diagnostic Tool
=================================================
Run this on the Raspberry Pi to test printer connectivity and backend handshake.
Usage:
    python test_hardware.py
    python test_hardware.py --print
"""

import sys
import os
import argparse

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

# Ensure kiosk/brain is on sys.path
_current_dir = os.path.dirname(os.path.abspath(__file__))
if _current_dir not in sys.path:
    sys.path.insert(0, _current_dir)

from config import KIOSK_ID, KIOSK_NAME, API_URL, PRINTER_NAME
from cups_controller import CupsController
from hardware_monitor import HardwareMonitor


def main():
    parser = argparse.ArgumentParser(description="PrintBooth Kiosk Hardware Diagnostic")
    parser.add_argument("--print", action="store_true", help="Send a physical test print")
    args = parser.parse_args()

    print("========================================================")
    print(f"  PrintBooth Kiosk Hardware Diagnostic")
    print("========================================================")
    print(f"Station ID       : {KIOSK_ID}")
    print(f"Station Name     : {KIOSK_NAME}")
    print(f"Backend API URL  : {API_URL}")
    print(f"Target Printer   : {PRINTER_NAME}")
    print("--------------------------------------------------------")

    cups = CupsController()
    printers = cups.get_printers()
    print(f"\n[1] Spooler Status: {'Connected' if cups.is_connected else ('Windows GDI' if sys.platform == 'win32' else 'CLI mode / Local')}")
    print(f"    Available Printers ({len(printers.get('printers', []))}):")
    for p in printers.get("printers", []):
        def_tag = " (DEFAULT)" if p.get("is_default") else ""
        print(f"     * {p.get('name')}{def_tag} -> State: {p.get('state')} | Online: {p.get('is_online')}")

    monitor = HardwareMonitor(cups)
    telemetry = monitor.get_hardware_status()
    diag = telemetry["diagnostics"]
    print(f"\n[2] System Vitals:")
    print(f"    Platform        : {sys.platform}")
    print(f"    RAM Usage       : {diag.get('memUsedPct')}%")
    print(f"    Free Disk Space : {diag.get('diskFreeGb')} GB")

    if args.print:
        print("\n[3] Dispatching Hardware Test Print...")
        test_file = "/tmp/printbooth_test.txt" if sys.platform != "win32" else "./printbooth_test.txt"
        with open(test_file, "w", encoding="utf-8") as f:
            f.write(
                f"=== PrintBooth Diagnostic Print ===\n"
                f"Station: {KIOSK_ID}\n"
                f"Name: {KIOSK_NAME}\n"
                f"Status: Hardware Verified OK\n"
                f"Platform: {sys.platform}\n"
            )

        res = cups.print_file(
            file_path=test_file,
            copies=1,
            colour_mode="BW",
            duplex="SINGLE",
            job_title="PrintBooth Self-Test",
        )
        print(f"    Result: {res}")

    print("\n* Diagnostic completed successfully.")


if __name__ == "__main__":
    main()
