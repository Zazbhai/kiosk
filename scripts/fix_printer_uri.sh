#!/usr/bin/env bash
# ==============================================================================
# PrintBooth — Quick CUPS Printer URI Fix
# ==============================================================================
# Run this on the Raspberry Pi when the printer is physically connected but
# jobs are stuck / not coming out. Fixes the CUPS device URI to match the
# actual connected Brother printer detected via lpinfo.
# Usage: sudo bash fix_printer_uri.sh
# ==============================================================================

set -e

PRINTER_NAME="PrintBooth_Printer"

echo "════════════════════════════════════════════════════"
echo "  PrintBooth CUPS Printer URI Quick-Fix"
echo "════════════════════════════════════════════════════"

# Show current state
echo ""
echo "[1] Current CUPS queue status:"
sudo lpstat -v "$PRINTER_NAME" 2>/dev/null || echo "  (not registered)"
sudo lpstat -p "$PRINTER_NAME" 2>/dev/null || echo "  (not enabled)"

# Discover the correct device URI from CUPS USB backend
echo ""
echo "[2] Scanning USB bus for Brother printers..."
lpinfo_out=$(sudo lpinfo -v 2>/dev/null || true)

# Try to find any Brother USB device first
DEVICE_URI=$(echo "$lpinfo_out" | grep -i "usb://brother" | head -n 1 | awk '{print $2}' || true)

# Fallback: any direct USB printer
if [ -z "$DEVICE_URI" ]; then
    DEVICE_URI=$(echo "$lpinfo_out" | grep -E "^direct usb://" | head -n 1 | awk '{print $2}' || true)
fi

# Fallback: use /dev/usb/lp0 directly (most reliable on Pi)
if [ -z "$DEVICE_URI" ] && [ -e "/dev/usb/lp0" ]; then
    DEVICE_URI="usb:/dev/usb/lp0"
    echo "  Using /dev/usb/lp0 device node directly"
fi

if [ -z "$DEVICE_URI" ]; then
    echo "  ❌ No USB printer device found. Check USB cable and printer power."
    echo "  Tip: run 'lsusb' to verify printer is detected on USB bus."
    exit 1
fi

echo "  ✓ Found device URI: $DEVICE_URI"

# Cancel any stuck jobs and update the URI without removing the printer
echo ""
echo "[3] Clearing stuck CUPS jobs..."
sudo cancel -a "$PRINTER_NAME" 2>/dev/null || true

echo ""
echo "[4] Updating printer URI to: $DEVICE_URI"
sudo lpadmin -p "$PRINTER_NAME" -v "$DEVICE_URI" -o printer-error-policy=retry-current-job
sudo cupsenable "$PRINTER_NAME"
sudo cupsaccept "$PRINTER_NAME"

# Also fix default media
sudo lpoptions -p "$PRINTER_NAME" -o media=A4 2>/dev/null || true

echo ""
echo "[5] Restarting CUPS..."
sudo systemctl restart cups
sleep 2

echo ""
echo "[6] Final status:"
sudo lpstat -v "$PRINTER_NAME"
sudo lpstat -p "$PRINTER_NAME"

echo ""
echo "[7] Sending test print job..."
echo "PrintBooth Printer Test - $(date)" | sudo lp -d "$PRINTER_NAME" -o media=A4 -o fit-to-page && \
    echo "  ✓ Test job sent to spooler" || \
    echo "  ⚠  Test job failed — check CUPS error log: sudo journalctl -u cups -n 30"

echo ""
echo "════════════════════════════════════════════════════"
echo "  Done! Check printer for test page."
echo "  If nothing prints after 30s, run:"
echo "    sudo journalctl -u cups -n 50"
echo "    sudo lpstat -W completed -l"
echo "════════════════════════════════════════════════════"
