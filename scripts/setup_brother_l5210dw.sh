#!/usr/bin/env bash
# ==============================================================================
# PrintBooth — Brother HL-L5210DW Automated Setup & Driver Switcher
# ==============================================================================
# Reconfigures CUPS queue 'PrintBooth_Printer' for the Brother HL-L5210DW
# high-speed monochrome laser printer on Raspberry Pi OS (ARM64 / ARMv7).
#
# Supported driver models (tested for ARM64):
#   1. Driverless IPP Everywhere (Direct USB / IPP-over-USB)
#   2. Native brlaser driver (printer-driver-brlaser)
#   3. Generic PCL 6 / PCL XL (Brother HL-L native hardware emulation)
#   4. Generic PostScript Level 3 (BR-Script3)
# ==============================================================================

set -e

PRINTER_NAME="PrintBooth_Printer"

echo "════════════════════════════════════════════════════════"
echo "  PrintBooth Brother HL-L5210DW Laser Setup"
echo "════════════════════════════════════════════════════════"

# 1. Install prerequisites
echo ""
echo "[1/6] Installing Brother laser driver packages..."
sudo apt-get update -y
sudo apt-get install -y cups cups-filters printer-driver-brlaser printer-driver-all ghostscript poppler-utils || true

# 2. Clear old stuck jobs from CUPS queue
echo ""
echo "[2/6] Cancelling stuck jobs from previous printer..."
sudo cancel -a -x "$PRINTER_NAME" 2>/dev/null || true
sudo cancel -a 2>/dev/null || true

# 3. Detect connected Brother HL-L5210DW USB URI
echo ""
echo "[3/6] Detecting Brother HL-L5210DW USB URI..."
lpinfo_out=$(sudo lpinfo -v 2>/dev/null || true)
echo "Discovered USB devices:"
echo "$lpinfo_out" | grep -i "brother" || true

# Match Brother HL-L5210DW or generic Brother USB URI
DEVICE_URI=$(echo "$lpinfo_out" | grep -i -E "usb://brother/hl-l5210|usb://brother/hl" | head -n 1 | awk '{print $2}' || true)
if [ -z "$DEVICE_URI" ]; then
    DEVICE_URI=$(echo "$lpinfo_out" | grep -i "usb://brother" | head -n 1 | awk '{print $2}' || true)
fi
if [ -z "$DEVICE_URI" ]; then
    DEVICE_URI=$(echo "$lpinfo_out" | grep -E "^direct usb://" | head -n 1 | awk '{print $2}' || true)
fi
if [ -z "$DEVICE_URI" ] && [ -e "/dev/usb/lp0" ]; then
    DEVICE_URI="usb:/dev/usb/lp0"
fi

if [ -z "$DEVICE_URI" ]; then
    echo "  ❌ No Brother USB printer detected!"
    echo "  Verify:"
    echo "    1. Printer power is ON."
    echo "    2. USB cable is firmly connected to the Raspberry Pi."
    echo "    3. Run 'lsusb' to confirm '04f9' (Brother) appears."
    exit 1
fi

echo "  ✓ Target USB Device URI: $DEVICE_URI"

# 4. Determine best driver for HL-L5210DW
echo ""
echo "[4/6] Selecting driver model for HL-L5210DW..."
SELECTED_MODEL=""

# Option A: Check for brlaser PPD for HL-L5200 / HL-L5000 / HL-L series
BRLASER_PPD=$(sudo lpinfo -m 2>/dev/null | grep -i -E "brlaser.*hl-l5|brlaser.*l5200|brlaser.*l5000|brlaser.*hl-l" | head -n 1 | awk '{print $1}' || true)
if [ -n "$BRLASER_PPD" ]; then
    SELECTED_MODEL="$BRLASER_PPD"
    echo "  ✓ Using native brlaser driver: $SELECTED_MODEL"
fi

# Option B: Generic PCL 6 (HL-L5210DW natively interprets PCL6 at full hardware speed)
if [ -z "$SELECTED_MODEL" ]; then
    PCL_PPD=$(sudo lpinfo -m 2>/dev/null | grep -i "drv:///sample.drv/generpcl.ppd" | head -n 1 | awk '{print $1}' || true)
    if [ -n "$PCL_PPD" ]; then
        SELECTED_MODEL="$PCL_PPD"
        echo "  ✓ Using Generic PCL 6 driver (Hardware PCL6): $SELECTED_MODEL"
    fi
fi

# Option C: Generic PostScript (BR-Script3 emulation)
if [ -z "$SELECTED_MODEL" ]; then
    PS_PPD=$(sudo lpinfo -m 2>/dev/null | grep -i "drv:///sample.drv/generic.ppd" | head -n 1 | awk '{print $1}' || true)
    if [ -n "$PS_PPD" ]; then
        SELECTED_MODEL="$PS_PPD"
        echo "  ✓ Using Generic PostScript driver (BR-Script3): $SELECTED_MODEL"
    fi
fi

# 5. Remove old queue & Re-create with clean HL-L5210DW settings
echo ""
echo "[5/6] Registering '$PRINTER_NAME' in CUPS..."
sudo lpadmin -x "$PRINTER_NAME" 2>/dev/null || true

if [ -n "$SELECTED_MODEL" ]; then
    sudo lpadmin -p "$PRINTER_NAME" -E -v "$DEVICE_URI" -m "$SELECTED_MODEL" -o printer-error-policy=retry-current-job
else
    # Fallback to driverless everywhere
    echo "  Attempting driverless IPP everywhere configuration..."
    sudo lpadmin -p "$PRINTER_NAME" -E -v "$DEVICE_URI" -m everywhere -o printer-error-policy=retry-current-job 2>/dev/null || \
    sudo lpadmin -p "$PRINTER_NAME" -E -v "$DEVICE_URI" -o printer-error-policy=retry-current-job
fi

# Set as system default printer
sudo lpadmin -d "$PRINTER_NAME"

# Enable hardware duplex & A4 default
sudo lpoptions -p "$PRINTER_NAME" -o media=A4 -o sides=two-sided-long-edge -o Duplex=DuplexNoTumble 2>/dev/null || true
sudo cupsenable "$PRINTER_NAME"
sudo cupsaccept "$PRINTER_NAME"

# Restart CUPS
sudo systemctl restart cups
sleep 2
sudo cupsenable "$PRINTER_NAME" 2>/dev/null || true
sudo cupsaccept "$PRINTER_NAME" 2>/dev/null || true

# 6. Verify and send test print
echo ""
echo "[6/6] Verifying printer state & sending test print..."
sudo lpstat -p "$PRINTER_NAME"
sudo lpstat -v "$PRINTER_NAME"

echo ""
echo "Sending test page to '$PRINTER_NAME'..."
TEST_PAGE="/tmp/test_hll5210dw.txt"
cat << 'EOF' > "$TEST_PAGE"
============================================================
           PrintBooth Kiosk — Brother HL-L5210DW
============================================================
✓ Printer Model    : Brother HL-L5210DW Laser
✓ Queue Name       : PrintBooth_Printer
✓ Duplex Support   : Hardware Auto-Duplex Enabled
✓ Media Standard   : A4 75-80 GSM
============================================================
Timestamp:
EOF
date >> "$TEST_PAGE"

sudo lp -d "$PRINTER_NAME" -o media=A4 -o fit-to-page "$TEST_PAGE" && \
    echo "  ✓ Test job successfully dispatched to Brother HL-L5210DW!" || \
    echo "  ❌ Failed to send test job. Check 'sudo journalctl -u cups -n 30'."

echo ""
echo "════════════════════════════════════════════════════════"
echo "  Setup complete! Brother HL-L5210DW is ready to print."
echo "════════════════════════════════════════════════════════"
