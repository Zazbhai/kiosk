#!/usr/bin/env python3
"""
PrintBooth Kiosk — Advanced Hardware & Format Verification Suite
================================================================
Tests physical printer hardware across various print job configurations:
  1. Duplex / Double-Sided (Long-Edge Book vs Short-Edge Flip)
  2. Resolution & DPI (300 DPI Draft, 600 DPI Standard, 1200 DPI High-Res)
  3. Scaling & Margins (Fit-to-Page, Fill/Borderless, 1:1 Actual Size)
  4. Multi-Page N-Up Layouts (2-Up, 4-Up per sheet)
  5. Color Profiles (True KGray Monochrome vs RGB Full-Color)
  6. Paper Media Formats (A4, Letter, Legal)

Usage:
  # Interactive Menu:
  python3 test_printer_formats.py

  # Direct CLI Execution:
  python3 test_printer_formats.py --test duplex-long
  python3 test_printer_formats.py --test duplex-short
  python3 test_printer_formats.py --test dpi-1200
  python3 test_printer_formats.py --test fit-page
  python3 test_printer_formats.py --test fill-borderless
  python3 test_printer_formats.py --test nup-2
  python3 test_printer_formats.py --test color
  python3 test_printer_formats.py --test bw
  python3 test_printer_formats.py --list-options
"""

import sys
import os
import argparse
import subprocess
from pathlib import Path
from typing import Dict, Any, Optional

# Ensure kiosk/brain is on python path
_current_dir = Path(__file__).resolve().parent
if str(_current_dir) not in sys.path:
    sys.path.insert(0, str(_current_dir))

from config import PRINTER_NAME, KIOSK_ID
from cups_controller import CupsController

try:
    import fitz  # PyMuPDF
    HAS_MUPDF = True
except ImportError:
    HAS_MUPDF = False


def generate_diagnostic_pdf(output_path: Path, num_pages: int = 4) -> Path:
    """Generates a clean multi-page diagnostic PDF with alignment grids and duplex corner markers."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if HAS_MUPDF:
        doc = fitz.open()
        # Standard A4: 595.28 x 841.89 points
        width, height = 595.28, 841.89

        for i in range(1, num_pages + 1):
            page = doc.new_page(width=width, height=height)
            rect = fitz.Rect(36, 36, width - 36, height - 36)

            # Draw outer margin border (0.5 inch / 36pt margin test)
            page.draw_rect(rect, color=(0.8, 0.1, 0.1) if i % 2 == 1 else (0.1, 0.3, 0.8), width=2)
            
            # Duplex corner orientation notch
            corner_rect = fitz.Rect(width - 120, 40, width - 40, 80)
            page.draw_rect(corner_rect, fill=(0.9, 0.9, 0.9), color=(0.2, 0.2, 0.2), width=1)
            page.insert_text(fitz.Point(width - 110, 65), f"PAGE {i}", fontsize=14, fontname="helv", color=(0.1, 0.1, 0.1))

            # Header Banner
            page.insert_text(fitz.Point(50, 80), f"PrintBooth Station {KIOSK_ID} Diagnostic Sheet", fontsize=20, fontname="helv", color=(0.85, 0.15, 0.15))
            page.insert_text(fitz.Point(50, 105), f"Page {i} of {num_pages} — Paper: A4 75GSM | Test Pattern", fontsize=11, fontname="helv", color=(0.4, 0.4, 0.4))

            # Center Alignment Crosshair & Measurement box
            center_x, center_y = width / 2, height / 2
            page.draw_line(fitz.Point(center_x - 60, center_y), fitz.Point(center_x + 60, center_y), color=(0.3, 0.3, 0.3), width=1)
            page.draw_line(fitz.Point(center_x, center_y - 60), fitz.Point(center_x, center_y + 60), color=(0.3, 0.3, 0.3), width=1)
            page.draw_circle(fitz.Point(center_x, center_y), 40, color=(0.3, 0.3, 0.3), width=1)
            page.insert_text(fitz.Point(center_x - 30, center_y + 4), f"[CENTER]", fontsize=9, fontname="helv", color=(0.3, 0.3, 0.3))

            # Resolution & Typography Legibility Test
            y = 150
            page.insert_text(fitz.Point(50, y), "1. Typography & Resolution Readability Scale:", fontsize=12, fontname="helv", color=(0.1, 0.1, 0.1))
            y += 20
            for sz in [18, 14, 11, 9, 7, 5]:
                sample = f"ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 1234567890 ({sz}pt)"
                page.insert_text(fitz.Point(50, y), sample, fontsize=sz, fontname="helv", color=(0.1, 0.1, 0.1))
                y += sz + 6

            # Duplex verification text
            y += 20
            page.insert_text(fitz.Point(50, y), "2. Duplex Binding Check:", fontsize=12, fontname="helv", color=(0.1, 0.1, 0.1))
            y += 18
            if i % 2 == 1:
                dup_msg = "ODD PAGE (Front Side) — If printing Long-Edge Duplex, Page 2 on reverse should have right-side-up orientation."
            else:
                dup_msg = "EVEN PAGE (Reverse Side) — Check that top margin matches front side when flipped like a book."
            page.insert_text(fitz.Point(50, y), dup_msg, fontsize=10, fontname="helv", color=(0.2, 0.5, 0.2))

            # Footer
            page.insert_text(fitz.Point(50, height - 50), "PrintBooth Autonomous Hardware Controller • Brother DCP Series & CUPS Verified", fontsize=9, fontname="helv", color=(0.6, 0.6, 0.6))

        doc.save(str(output_path))
        doc.close()
        return output_path
    else:
        # Fallback minimal plain text file if PyMuPDF is not installed
        txt_path = output_path.with_suffix(".txt")
        with open(txt_path, "w", encoding="utf-8") as f:
            f.write(f"PrintBooth Hardware Test\nStation: {KIOSK_ID}\nPages: {num_pages}\n")
        return txt_path


def list_cups_ppd_options(printer_name: str):
    """Executes 'lpoptions -p <printer> -l' to show exact supported PPD attributes of the active printer."""
    print(f"\n[CUPS PPD Options] Querying supported options for '{printer_name}'...")
    try:
        proc = subprocess.run(["lpoptions", "-p", printer_name, "-l"], capture_output=True, text=True, check=False)
        if proc.returncode == 0 and proc.stdout.strip():
            print("--------------------------------------------------------------------------------")
            for line in proc.stdout.splitlines():
                # Filter for key interest options
                if any(k in line.lower() for k in ["duplex", "resolution", "colormodel", "mediatype", "pagesize", "color"]):
                    print(f"  • {line}")
            print("--------------------------------------------------------------------------------")
        else:
            print("  (lpoptions command returned empty or printer is not registered in CUPS yet)")
    except Exception as e:
        print(f"  Notice querying lpoptions: {e}")


def execute_print_job(
    cups: CupsController,
    printer_name: str,
    file_path: Path,
    title: str,
    cups_options: Dict[str, str],
    copies: int = 1,
):
    """Submits the print job via CUPS controller and prints the exact Linux CLI equivalent command."""
    print("\n" + "═" * 70)
    print(f"  🚀 DISPATCHING: {title}")
    print("═" * 70)
    print(f"Target Printer : {printer_name}")
    print(f"Test File      : {file_path}")
    print(f"Copies         : {copies}")
    print("Applied CUPS Options:")
    for k, v in cups_options.items():
        print(f"  -o {k}={v}")

    # Display exact Linux shell one-liner
    lp_cmd = ["lp", "-d", printer_name]
    for k, v in cups_options.items():
        lp_cmd.extend(["-o", f"{k}={v}"])
    if copies > 1:
        lp_cmd.extend(["-#", str(copies)])
    lp_cmd.append(str(file_path))
    print(f"\nEquivalent Linux CLI command:\n  {' '.join(lp_cmd)}\n")

    # Dispatch using CupsController
    res = cups.print_file(
        file_path=str(file_path),
        printer_name=printer_name,
        copies=copies,
        options=cups_options,
        job_title=title,
    )
    if res.get("success"):
        print(f"  ✓ Print Job Submitted Successfully! CUPS Job ID: {res.get('job_id', 'N/A')}")
    else:
        print(f"  ❌ Submission Failed: {res.get('error')}")
    print("═" * 70)


def main():
    parser = argparse.ArgumentParser(description="PrintBooth Printer Hardware Format Tester")
    parser.add_argument(
        "--test",
        choices=[
            "duplex-long",
            "duplex-short",
            "single",
            "fit-page",
            "fill-borderless",
            "actual-size",
            "dpi-300",
            "dpi-600",
            "dpi-1200",
            "nup-2",
            "nup-4",
            "color",
            "bw",
            "all-tests",
        ],
        help="Run a specific test directly from the command line",
    )
    parser.add_argument("--printer", default=PRINTER_NAME, help="Target CUPS printer name")
    parser.add_argument("--list-options", action="store_true", help="List all PPD attributes supported by the printer")
    args = parser.parse_args()

    cups = CupsController()
    printer_name = args.printer or PRINTER_NAME

    if args.list_options:
        list_cups_ppd_options(printer_name)
        return

    # Generate 4-page test PDF
    test_pdf = _current_dir / "data" / "diagnostic_test_sheet.pdf"
    print(f"Preparing diagnostic 4-page test PDF at: {test_pdf}...")
    generate_diagnostic_pdf(test_pdf, num_pages=4)

    test_map = {
        "1": {
            "id": "single",
            "name": "Standard A4 B&W (Single-Sided, Fit-to-Page, 600 DPI)",
            "options": {
                "media": "A4",
                "fit-to-page": "true",
                "print-color-mode": "monochrome",
                "ColorModel": "KGray",
                "BRMonoColor": "Mono",
                "Resolution": "600dpi",
            },
        },
        "2": {
            "id": "duplex-long",
            "name": "Duplex Double-Sided (Long-Edge Binding / Book Style)",
            "options": {
                "media": "A4",
                "sides": "two-sided-long-edge",
                "Duplex": "DuplexNoTumble",
                "fit-to-page": "true",
                "print-color-mode": "monochrome",
                "ColorModel": "KGray",
                "BRMonoColor": "Mono",
            },
        },
        "3": {
            "id": "duplex-short",
            "name": "Duplex Double-Sided (Short-Edge Binding / Flip / Calendar Style)",
            "options": {
                "media": "A4",
                "sides": "two-sided-short-edge",
                "Duplex": "DuplexTumble",
                "fit-to-page": "true",
                "print-color-mode": "monochrome",
                "ColorModel": "KGray",
                "BRMonoColor": "Mono",
            },
        },
        "4": {
            "id": "fit-page",
            "name": "Scaling: Fit to Page (Shrinks/Expands document to printable margins)",
            "options": {
                "media": "A4",
                "fit-to-page": "true",
                "fitplot": "true",
            },
        },
        "5": {
            "id": "fill-borderless",
            "name": "Scaling: Fill to Edge (Crops/Expands to edge-to-edge)",
            "options": {
                "media": "A4",
                "fit-to-page": "true",
                "fill": "true",
            },
        },
        "6": {
            "id": "actual-size",
            "name": "Scaling: 100% 1:1 Actual Size (Natural Scaling, No Shrink)",
            "options": {
                "media": "A4",
                "scaling": "100",
                "natural-scaling": "100",
            },
        },
        "7": {
            "id": "dpi-300",
            "name": "Resolution: 300 DPI (High-Speed Draft)",
            "options": {
                "media": "A4",
                "Resolution": "300dpi",
                "BRResolution": "300x300dpi",
                "fit-to-page": "true",
            },
        },
        "8": {
            "id": "dpi-600",
            "name": "Resolution: 600 DPI (Standard Document Crisp Text)",
            "options": {
                "media": "A4",
                "Resolution": "600dpi",
                "BRResolution": "600x600dpi",
                "fit-to-page": "true",
            },
        },
        "9": {
            "id": "dpi-1200",
            "name": "Resolution: 1200 DPI (High-Definition Fine Graphics)",
            "options": {
                "media": "A4",
                "Resolution": "1200dpi",
                "BRResolution": "1200x1200dpi",
                "fit-to-page": "true",
            },
        },
        "10": {
            "id": "nup-2",
            "name": "Multi-Page: 2-Up (2 Pages per Sheet)",
            "options": {
                "media": "A4",
                "number-up": "2",
                "fit-to-page": "true",
            },
        },
        "11": {
            "id": "nup-4",
            "name": "Multi-Page: 4-Up (4 Pages per Sheet)",
            "options": {
                "media": "A4",
                "number-up": "4",
                "fit-to-page": "true",
            },
        },
        "12": {
            "id": "color",
            "name": "Color Mode: Full Color (RGB / FullColor PPD)",
            "options": {
                "media": "A4",
                "print-color-mode": "color",
                "ColorModel": "RGB",
                "BRMonoColor": "FullColor",
                "fit-to-page": "true",
            },
        },
    }

    # If test passed via CLI flag
    if args.test:
        selected_key = None
        for k, item in test_map.items():
            if item["id"] == args.test:
                selected_key = k
                break
        if selected_key:
            item = test_map[selected_key]
            execute_print_job(cups, printer_name, test_pdf, item["name"], item["options"])
            return
        elif args.test == "all-tests":
            print("\nExecuting all tests sequentially...")
            for k, item in test_map.items():
                execute_print_job(cups, printer_name, test_pdf, item["name"], item["options"])
            return

    # Interactive Menu
    while True:
        print("\n" + "═" * 70)
        print(f"  PrintBooth Hardware Format & Quality Testing Suite")
        print(f"  Active Printer : {printer_name}")
        print("═" * 70)
        for k, item in sorted(test_map.items(), key=lambda x: int(x[0])):
            print(f"  [{k:>2}] {item['name']}")
        print("  [ P] View Printer's Native Supported PPD Options (lpoptions)")
        print("  [ Q] Quit")
        print("═" * 70)

        choice = input("Select a test number (1-12, P, Q): ").strip().upper()
        if choice in ("Q", "QUIT", "EXIT"):
            print("Exiting test suite.")
            break
        elif choice == "P":
            list_cups_ppd_options(printer_name)
        elif choice in test_map:
            item = test_map[choice]
            execute_print_job(cups, printer_name, test_pdf, item["name"], item["options"])
        else:
            print("Invalid selection. Please choose a number between 1 and 12.")


if __name__ == "__main__":
    main()
