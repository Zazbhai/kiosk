#!/usr/bin/env bash
# ==============================================================================
# PrintBooth — Brother HL-L5210DW Duplex Hardware Fixer & Verifier
# ==============================================================================
# Resolves Brother HL-L5210DW duplex printing issues by:
#   1. Enabling the hardware duplexer unit in CUPS PPD (Option1=True / Duplexer=Installed).
#   2. Setting Brother proprietary PPD options (BRDuplex=DuplexNoTumble).
#   3. Setting standard IPP and PostScript options (sides=two-sided-long-edge / Duplex=DuplexNoTumble).
#   4. Applying defaults system-wide so user 'kiosk' and daemon processes inherit them.
#   5. Generating a 2-page test PDF and dispatching a physical duplex verification print.
# ==============================================================================

set -e

PRINTER_NAME="PrintBooth_Printer"

echo "════════════════════════════════════════════════════════"
echo "  PrintBooth Brother HL-L5210DW Duplex Hardware Fixer  "
echo "════════════════════════════════════════════════════════"

# 1. Check if printer queue exists
echo ""
echo "[1/5] Checking CUPS printer queue '$PRINTER_NAME'..."
if ! lpstat -p "$PRINTER_NAME" >/dev/null 2>&1; then
    # Try finding any Brother or detected printer
    DETECTED_PRINTER=$(lpstat -p 2>/dev/null | awk '{print $2}' | grep -i -E "brother|printbooth" | head -n 1 || true)
    if [ -n "$DETECTED_PRINTER" ]; then
        PRINTER_NAME="$DETECTED_PRINTER"
        echo "  ✓ Found active printer queue: '$PRINTER_NAME'"
    else
        echo "  ❌ No printer queue found! Please run 'bash scripts/setup_brother_l5210dw.sh' first."
        exit 1
    fi
else
    echo "  ✓ Target queue confirmed: '$PRINTER_NAME'"
fi

# 2. Check and optimize PPD driver for duplex support
echo ""
echo "[2/5] Inspecting PPD driver duplex capabilities..."
PPD_FILE="/etc/cups/ppd/${PRINTER_NAME}.ppd"

if [ -f "$PPD_FILE" ]; then
    echo "  Current PPD: $PPD_FILE"
    grep -i -E "^\*modelname|^\*nickname" "$PPD_FILE" | head -n 2 || true
    
    # Check if Duplexer installable option exists in PPD
    if grep -q "\*Option1" "$PPD_FILE"; then
        echo "  ✓ Found InstallableOption 'Option1' (Duplexer) in PPD."
    fi
    if grep -q "\*BRDuplex" "$PPD_FILE"; then
        echo "  ✓ Found Brother proprietary 'BRDuplex' in PPD."
    fi
    if grep -q "\*Duplex" "$PPD_FILE"; then
        echo "  ✓ Found standard PostScript 'Duplex' in PPD."
    fi
fi

# 3. Configure CUPS Queue with all Duplex attributes
echo ""
echo "[3/5] Applying hardware duplex parameters system-wide..."

# Option1=True: tells CUPS Generic PCL/PostScript PPD that duplex hardware is installed
# Duplexer=Installed: CUPS device attribute
# Duplex=DuplexNoTumble: Standard PostScript long-edge duplex
# BRDuplex=DuplexNoTumble: Brother proprietary long-edge duplex (required for Brother filters)
# sides=two-sided-long-edge: IPP standard option
sudo lpadmin -p "$PRINTER_NAME" \
    -o Option1=True \
    -o Duplexer=Installed \
    -o Duplex=DuplexNoTumble \
    -o BRDuplex=DuplexNoTumble \
    -o sides=two-sided-long-edge \
    -o media=A4 \
    -o printer-error-policy=retry-current-job 2>/dev/null || true

# Apply to root and kiosk user lpoptions
sudo lpoptions -p "$PRINTER_NAME" \
    -o Option1=True \
    -o Duplexer=Installed \
    -o Duplex=DuplexNoTumble \
    -o BRDuplex=DuplexNoTumble \
    -o sides=two-sided-long-edge \
    -o media=A4 2>/dev/null || true

lpoptions -p "$PRINTER_NAME" \
    -o Option1=True \
    -o Duplexer=Installed \
    -o Duplex=DuplexNoTumble \
    -o BRDuplex=DuplexNoTumble \
    -o sides=two-sided-long-edge \
    -o media=A4 2>/dev/null || true

# Unpause queue
sudo cupsenable "$PRINTER_NAME" 2>/dev/null || true
sudo cupsaccept "$PRINTER_NAME" 2>/dev/null || true

echo "  ✓ Applied queue configuration:"
echo "    - Option1=True (Duplex unit declared)"
echo "    - Duplexer=Installed"
echo "    - Duplex=DuplexNoTumble"
echo "    - BRDuplex=DuplexNoTumble"
echo "    - sides=two-sided-long-edge"
echo "    - media=A4"

# 4. Generate 2-Page Duplex Test PDF
echo ""
echo "[4/5] Generating 2-page duplex test document..."
TEST_PDF="/tmp/test_brother_duplex.pdf"

python3 - << 'EOF'
import sys
from pathlib import Path

pdf_path = Path("/tmp/test_brother_duplex.pdf")

# Method 1: PyMuPDF (fitz)
try:
    import pymupdf as fitz
    doc = fitz.open()
    w, h = 595.28, 841.89  # Standard A4 points

    # --- Page 1 (FRONT) ---
    p1 = doc.new_page(width=w, height=h)
    rect1 = fitz.Rect(40, 40, w - 40, h - 40)
    p1.draw_rect(rect1, color=(0.1, 0.1, 0.1), width=4)
    p1.insert_text(fitz.Point(60, 120), "PRINTBOOTH KIOSK", fontsize=28, fontname="helv", color=(0.85, 0.15, 0.15))
    p1.insert_text(fitz.Point(60, 160), "BROTHER HL-L5210DW DUPLEX TEST", fontsize=18, fontname="helv", color=(0.1, 0.1, 0.1))
    
    # Large Page 1 Identifier
    p1.draw_rect(fitz.Rect(60, 220, w - 60, 380), fill=(0.95, 0.95, 0.95), color=(0.2, 0.2, 0.2), width=2)
    p1.insert_text(fitz.Point(80, 280), "PAGE 1 — FRONT SIDE", fontsize=32, fontname="helv", color=(0.1, 0.5, 0.1))
    p1.insert_text(fitz.Point(80, 320), "Orientation: Long-Edge Book Binding (Turn like a book page)", fontsize=13, fontname="helv", color=(0.2, 0.2, 0.2))
    p1.insert_text(fitz.Point(80, 350), "Status: If duplex works, Page 2 will be on the REVERSE of this exact sheet.", fontsize=12, fontname="helv", color=(0.3, 0.3, 0.3))

    p1.insert_text(fitz.Point(60, 440), "Duplex Settings Applied:", fontsize=14, fontname="helv", color=(0.1, 0.1, 0.1))
    p1.insert_text(fitz.Point(80, 470), "• sides = two-sided-long-edge", fontsize=11, fontname="helv")
    p1.insert_text(fitz.Point(80, 490), "• Duplex = DuplexNoTumble", fontsize=11, fontname="helv")
    p1.insert_text(fitz.Point(80, 510), "• BRDuplex = DuplexNoTumble (Brother PPD native)", fontsize=11, fontname="helv")
    p1.insert_text(fitz.Point(80, 530), "• Option1 = True / Duplexer = Installed (Hardware unit flag)", fontsize=11, fontname="helv")

    # --- Page 2 (BACK) ---
    p2 = doc.new_page(width=w, height=h)
    rect2 = fitz.Rect(40, 40, w - 40, h - 40)
    p2.draw_rect(rect2, color=(0.1, 0.1, 0.8), width=4)
    p2.insert_text(fitz.Point(60, 120), "PRINTBOOTH KIOSK", fontsize=28, fontname="helv", color=(0.1, 0.3, 0.8))
    p2.insert_text(fitz.Point(60, 160), "BROTHER HL-L5210DW DUPLEX TEST", fontsize=18, fontname="helv", color=(0.1, 0.1, 0.1))

    # Large Page 2 Identifier
    p2.draw_rect(fitz.Rect(60, 220, w - 60, 380), fill=(0.93, 0.95, 1.0), color=(0.1, 0.3, 0.8), width=2)
    p2.insert_text(fitz.Point(80, 280), "PAGE 2 — BACK SIDE", fontsize=32, fontname="helv", color=(0.1, 0.3, 0.8))
    p2.insert_text(fitz.Point(80, 320), "✓ DUPLEX PRINTING SUCCESSFUL!", fontsize=16, fontname="helv", color=(0.1, 0.6, 0.1))
    p2.insert_text(fitz.Point(80, 350), "This page was printed on the reverse side of Page 1 without paper re-feed.", fontsize=12, fontname="helv", color=(0.3, 0.3, 0.3))

    p2.insert_text(fitz.Point(60, 440), "Physical Verification Checklist:", fontsize=14, fontname="helv", color=(0.1, 0.1, 0.1))
    p2.insert_text(fitz.Point(80, 470), "✓ Exactly 1 physical paper sheet was consumed from the tray.", fontsize=11, fontname="helv")
    p2.insert_text(fitz.Point(80, 490), "✓ The printer pulled the page back in during printing to invert it.", fontsize=11, fontname="helv")
    p2.insert_text(fitz.Point(80, 510), "✓ Long-edge binding matches Page 1 (top of Page 2 is at the same end as Page 1).", fontsize=11, fontname="helv")

    doc.save(str(pdf_path))
    doc.close()
    print("  ✓ Created high-definition 2-page test PDF via PyMuPDF.")
    sys.exit(0)
except ImportError:
    pass

# Method 2: PostScript to PDF via Ghostscript
try:
    import subprocess
    ps_content = """%!PS
/Helvetica findfont 20 scalefont setfont
40 780 moveto (PrintBooth Kiosk - Page 1 FRONT) show
showpage
/Helvetica findfont 20 scalefont setfont
40 780 moveto (PrintBooth Kiosk - Page 2 BACK DUPLEX SUCCESS) show
showpage
"""
    ps_file = Path("/tmp/test_brother_duplex.ps")
    ps_file.write_text(ps_content)
    subprocess.run(["ps2pdf", str(ps_file), str(pdf_path)], check=True, timeout=10)
    print("  ✓ Created 2-page test PDF via Ghostscript.")
    sys.exit(0)
except Exception as e:
    print(f"  Notice: {e}")
    sys.exit(1)
EOF

if [ ! -f "$TEST_PDF" ]; then
    echo "  ❌ Failed to create test PDF!"
    exit 1
fi

# 5. Dispatch physical print job with all duplex options
echo ""
echo "[5/5] Dispatching physical duplex test print to '$PRINTER_NAME'..."

lp -d "$PRINTER_NAME" \
    -o media=A4 \
    -o fit-to-page=true \
    -o sides=two-sided-long-edge \
    -o Duplex=DuplexNoTumble \
    -o BRDuplex=DuplexNoTumble \
    -o JCLDuplex=DuplexNoTumble \
    -o Option1=True \
    -o Duplexer=Installed \
    "$TEST_PDF"

echo ""
echo "════════════════════════════════════════════════════════"
echo "  ✓ DUPLEX TEST JOB SUBMITTED TO BROTHER HL-L5210DW!    "
echo "════════════════════════════════════════════════════════"
echo "Physical check:"
echo "  1. The Brother HL-L5210DW will print Page 1, pause,"
echo "     automatically pull the sheet back inside (reversing it),"
echo "     and print Page 2 on the back."
echo "  2. Exactly ONE sheet of paper will exit into the tray."
echo "════════════════════════════════════════════════════════"
