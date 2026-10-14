#!/usr/bin/env python3
"""
PrintBooth Kiosk — All-In-One Printer Format Test Runner
======================================================
Executes all printer format tests in one go with a single command.
Tests:
  1. Standard A4 Monochrome (600 DPI, Fit-to-Page)
  2. Duplex Long-Edge (Book Orientation, 2 pages)
  3. Duplex Short-Edge (Flip Orientation, 2 pages)
  4. Fit to Page (Margin scaling)
  5. Fill / Edge-to-Edge
  6. 300 DPI (Draft speed mode)
  7. 600 DPI (Standard crisp mode)
  8. 1200 DPI (High-definition fine mode)
  9. 2-Up (2 Pages on 1 Sheet)
  10. Full Color Mode (RGB)

Usage:
  python3 test_all_formats_single_code.py
  python3 test_all_formats_single_code.py --printer "PrintBooth_Printer" --delay 5
"""

import sys
import os
import time
import argparse
import subprocess
from pathlib import Path

DEFAULT_PRINTER = "PrintBooth_Printer"

# Format test definitions
TEST_SUITE = [
    {
        "name": "1. Standard A4 (600 DPI, Single-Sided, Fit-to-Page)",
        "pages": "1-2",
        "options": {
            "media": "A4",
            "sides": "one-sided",
            "fit-to-page": "true",
            "print-color-mode": "monochrome",
            "ColorModel": "KGray",
            "BRMonoColor": "Mono",
            "Resolution": "600dpi",
            "BRResolution": "600x600dpi",
        },
    },
    {
        "name": "2. Duplex Long-Edge (Book Binding / Front & Back)",
        "pages": "1-2",
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
    {
        "name": "3. Duplex Short-Edge (Flip Binding / Calendar Style)",
        "pages": "1-2",
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
    {
        "name": "4. Fit to Paper Margins (fit-to-page + fitplot)",
        "pages": "1",
        "options": {
            "media": "A4",
            "fit-to-page": "true",
            "fitplot": "true",
        },
    },
    {
        "name": "5. Fill Paper (fill / edge-to-edge crop)",
        "pages": "1",
        "options": {
            "media": "A4",
            "fit-to-page": "true",
            "fill": "true",
        },
    },
    {
        "name": "6. DPI Test: 300 DPI (Draft / Fast)",
        "pages": "1",
        "options": {
            "media": "A4",
            "Resolution": "300dpi",
            "BRResolution": "300x300dpi",
            "fit-to-page": "true",
        },
    },
    {
        "name": "7. DPI Test: 600 DPI (Standard Text)",
        "pages": "1",
        "options": {
            "media": "A4",
            "Resolution": "600dpi",
            "BRResolution": "600x600dpi",
            "fit-to-page": "true",
        },
    },
    {
        "name": "8. DPI Test: 1200 DPI (High-Res Photo / Vector)",
        "pages": "1",
        "options": {
            "media": "A4",
            "Resolution": "1200dpi",
            "BRResolution": "1200x1200dpi",
            "fit-to-page": "true",
        },
    },
    {
        "name": "9. Multi-Page: 2-Up (2 Pages on 1 Sheet)",
        "pages": "1-2",
        "options": {
            "media": "A4",
            "number-up": "2",
            "fit-to-page": "true",
        },
    },
    {
        "name": "10. Full Color Mode (RGB / Color Print)",
        "pages": "1",
        "options": {
            "media": "A4",
            "print-color-mode": "color",
            "ColorModel": "RGB",
            "BRMonoColor": "FullColor",
            "fit-to-page": "true",
        },
    },
]


def detect_printer(preferred_name: str) -> str:
    """Detects available CUPS printers, falling back to lpstat."""
    try:
        proc = subprocess.run(["lpstat", "-p"], capture_output=True, text=True, check=False)
        printers = []
        for line in proc.stdout.splitlines():
            # Line format: "printer PrintBooth_Printer is idle..."
            parts = line.strip().split()
            if len(parts) >= 2 and parts[0] == "printer":
                printers.append(parts[1])
        if preferred_name in printers:
            return preferred_name
        if printers:
            print(f"Preferred printer '{preferred_name}' not found. Using detected: '{printers[0]}'")
            return printers[0]
    except Exception:
        pass
    return preferred_name


def generate_test_pdf(pdf_path: Path):
    """Generates a diagnostic 2-page test PDF with alignment markers."""
    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        import fitz  # PyMuPDF
        doc = fitz.open()
        width, height = 595.28, 841.89  # A4
        for p in [1, 2]:
            page = doc.new_page(width=width, height=height)
            
            # Outer boundary (0.5 inch / 36 pt)
            page.draw_rect(fitz.Rect(36, 36, width - 36, height - 36), color=(0.8, 0.1, 0.1) if p == 1 else (0.1, 0.4, 0.8), width=2)
            
            # Page Badge
            page.draw_rect(fitz.Rect(width - 130, 42, width - 42, 82), fill=(0.92, 0.92, 0.92), color=(0.2, 0.2, 0.2), width=1)
            page.insert_text(fitz.Point(width - 120, 68), f"PAGE {p}", fontsize=14, fontname="helv", color=(0.1, 0.1, 0.1))

            # Header
            page.insert_text(fitz.Point(45, 75), f"PrintBooth All-In-One Format Test Sheet (Page {p}/2)", fontsize=16, fontname="helv", color=(0.8, 0.1, 0.1))
            page.insert_text(fitz.Point(45, 95), "Standard A4 Test Grid • Duplex / DPI / Scaling / N-Up Validation", fontsize=10, fontname="helv", color=(0.4, 0.4, 0.4))

            # Crosshairs
            cx, cy = width / 2, height / 2
            page.draw_line(fitz.Point(cx - 50, cy), fitz.Point(cx + 50, cy), color=(0.3, 0.3, 0.3), width=1)
            page.draw_line(fitz.Point(cx, cy - 50), fitz.Point(cx, cy + 50), color=(0.3, 0.3, 0.3), width=1)
            page.draw_circle(fitz.Point(cx, cy), 35, color=(0.3, 0.3, 0.3), width=1)
            page.insert_text(fitz.Point(cx - 25, cy + 4), "[CENTER]", fontsize=9, fontname="helv", color=(0.3, 0.3, 0.3))

            # Text scale test
            y = 140
            page.insert_text(fitz.Point(45, y), "Resolution & Sharpness Legibility Test:", fontsize=11, fontname="helv", color=(0.1, 0.1, 0.1))
            y += 18
            for sz in [14, 11, 9, 7, 5]:
                page.insert_text(fitz.Point(45, y), f"AaBbCc 1234567890 - Sample text at {sz}pt font size", fontsize=sz, fontname="helv", color=(0.1, 0.1, 0.1))
                y += sz + 6

            # Duplex notice
            y += 20
            if p == 1:
                page.insert_text(fitz.Point(45, y), "FRONT SIDE (Odd) — Flip along long-edge: Page 2 on reverse should stay right-side-up.", fontsize=10, fontname="helv", color=(0.1, 0.5, 0.1))
            else:
                page.insert_text(fitz.Point(45, y), "REVERSE SIDE (Even) — Check top/bottom alignment against Front Side.", fontsize=10, fontname="helv", color=(0.1, 0.3, 0.8))

            # Color bar test
            y = height - 100
            page.insert_text(fitz.Point(45, y - 10), "Color Swatches (Cyan, Magenta, Yellow, Black):", fontsize=10, fontname="helv", color=(0.1, 0.1, 0.1))
            swatches = [
                ((0, 0.7, 0.9), "Cyan"),
                ((0.9, 0, 0.6), "Magenta"),
                ((0.95, 0.85, 0), "Yellow"),
                ((0.1, 0.1, 0.1), "Black"),
            ]
            for idx, (col, label) in enumerate(swatches):
                bx = 45 + idx * 110
                page.draw_rect(fitz.Rect(bx, y, bx + 95, y + 25), fill=col, color=(0.2, 0.2, 0.2), width=1)
                page.insert_text(fitz.Point(bx + 10, y + 17), label, fontsize=9, fontname="helv", color=(1, 1, 1) if label != "Yellow" else (0, 0, 0))

        doc.save(str(pdf_path))
        doc.close()
        return
    except ImportError:
        pass

    # Fallback to minimal PDF if PyMuPDF not installed
    minimal_pdf = (
        b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/MediaBox[0 0 595 842]/Parent 2 0 R/Resources<<>>>>endobj\n"
        b"xref\n0 4\n0000000000 65535 f \n0000000010 00000 n \n0000000060 00000 n \n0000000115 00000 n \n"
        b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n200\n%%EOF\n"
    )
    with open(pdf_path, "wb") as f:
        f.write(minimal_pdf)


def submit_job(printer: str, test_file: Path, name: str, options: dict, pages: str) -> bool:
    """Dispatches a print job directly via Linux CUPS lp command."""
    cmd = ["lp", "-d", printer]
    for k, v in options.items():
        cmd.extend(["-o", f"{k}={v}"])
    if pages:
        cmd.extend(["-o", f"page-ranges={pages}"])
    cmd.append(str(test_file))

    print(f"\n" + "─" * 70)
    print(f"▶ DISPATCHING: {name}")
    print(f"  Command: {' '.join(cmd)}")
    
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if proc.returncode == 0:
            out = proc.stdout.strip() or "Job accepted"
            print(f"  ✓ {out}")
            return True
        else:
            print(f"  ❌ Error (exit {proc.returncode}): {proc.stderr.strip()}")
            return False
    except Exception as e:
        print(f"  ❌ Failed to execute lp: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Run all printer format tests in one go")
    parser.add_argument("--printer", default=DEFAULT_PRINTER, help="Printer name (default: PrintBooth_Printer)")
    parser.add_argument("--delay", type=int, default=3, help="Seconds to wait between job submissions (default: 3)")
    args = parser.parse_args()

    printer = detect_printer(args.printer)
    test_file = Path("/tmp/printbooth_format_test.pdf")
    print(f"Generating diagnostic test sheet at: {test_file}...")
    generate_test_pdf(test_file)

    print("\n" + "═" * 70)
    print("  PrintBooth Kiosk — ALL-IN-ONE PRINTER FORMAT TEST RUNNER")
    print(f"  Target Printer : {printer}")
    print(f"  Total Tests    : {len(TEST_SUITE)}")
    print(f"  Delay Between  : {args.delay} seconds")
    print("═" * 70)

    success_count = 0
    for idx, test in enumerate(TEST_SUITE, 1):
        print(f"\n[{idx}/{len(TEST_SUITE)}] Testing: {test['name']}")
        ok = submit_job(printer, test_file, test["name"], test["options"], test.get("pages", ""))
        if ok:
            success_count += 1
        if idx < len(TEST_SUITE) and args.delay > 0:
            print(f"  Pausing {args.delay}s to let CUPS queue process...")
            time.sleep(args.delay)

    print("\n" + "═" * 70)
    print(f"  🏁 ALL TESTS SUBMITTED: {success_count}/{len(TEST_SUITE)} jobs sent to {printer}")
    print("  Use 'lpstat -o' to view current CUPS queue status.")
    print("═" * 70 + "\n")


if __name__ == "__main__":
    main()
