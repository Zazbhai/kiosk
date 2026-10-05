#!/usr/bin/env bash
# ==============================================================================
# PrintBooth — Automated Printer Driver & Queue Setup Script
# ==============================================================================
# Detects connected USB printers (Brother DCP-T420W, HP, Canon, Epson, Generic)
# and configures them in CUPS with optimal settings for self-service kiosks.
# ==============================================================================

set -e

echo "════════════════════════════════════════════════════════"
echo "  PrintBooth Hardware Printer Configuration Tool        "
echo "════════════════════════════════════════════════════════"

# 1. Verify CUPS is running
if ! systemctl is-active --quiet cups; then
    echo "[!] CUPS service is not running. Starting CUPS..."
    sudo systemctl start cups
    sudo systemctl enable cups
fi

# 2. Check for USB printers connected
echo "\n[1/4] Scanning for connected USB printing devices..."
USB_PRINTERS=$(lsusb | grep -i -E "printer|brother|hewlett|canon|epson|xerox|samsung" || true)

if [ -n "$USB_PRINTERS" ]; then
    echo "Found USB hardware device:"
    echo "$USB_PRINTERS"
else
    echo "Warning: No USB printer detected in 'lsusb'. Ensure USB cable is firmly plugged in and printer is powered ON."
fi

# 3. Discover printer URI via CUPS
echo "\n[2/4] Discovering device URI via CUPS subsystem..."
DEVICE_URI=$(sudo lpinfo -v 2>/dev/null | grep -E "usb://|direct usb" | head -n 1 | awk '{print $2}' || true)

if [ -z "$DEVICE_URI" ]; then
    # Try generic fallback
    DEVICE_URI="usb://Brother/DCP-T420W?serial=00000000"
    echo "Could not auto-detect active USB URI. Using default target URI: $DEVICE_URI"
else
    echo "Detected device URI: $DEVICE_URI"
fi

PRINTER_NAME="PrintBooth_Printer"

# 4. Add printer to CUPS
echo "\n[3/4] Configuring CUPS spooler for $PRINTER_NAME..."
# Remove existing queue if reconfiguring
sudo lpadmin -x "$PRINTER_NAME" 2>/dev/null || true

# Try IPP Everywhere driver first (standard on modern CUPS for Brother / HP / Canon)
if sudo lpadmin -p "$PRINTER_NAME" -E -v "$DEVICE_URI" -m everywhere 2>/dev/null; then
    echo "✓ Added $PRINTER_NAME using IPP Everywhere standard driver."
else
    # Fallback to generic postscript / gutenprint PPD
    echo "IPP Everywhere not directly available. Trying Generic / Gutenprint driver..."
    GUTEN_PPD=$(sudo lpinfo -m 2>/dev/null | grep -i -E "brother.*dcp|gutenprint.*generic|generic.*pcl" | head -n 1 | awk '{print $1}' || true)
    if [ -n "$GUTEN_PPD" ]; then
        sudo lpadmin -p "$PRINTER_NAME" -E -v "$DEVICE_URI" -m "$GUTEN_PPD"
        echo "✓ Added $PRINTER_NAME using driver: $GUTEN_PPD"
    else
        # Raw / generic CUPS fallback
        sudo lpadmin -p "$PRINTER_NAME" -E -v "$DEVICE_URI" -m raw
        echo "✓ Added $PRINTER_NAME in standard spooling mode."
    fi
fi

# 5. Set as default printer and configure optimal kiosk options
echo "\n[4/4] Setting default print queue and media options..."
sudo lpadmin -d "$PRINTER_NAME"
sudo cupsenable "$PRINTER_NAME" 2>/dev/null || true
sudo cupsaccept "$PRINTER_NAME" 2>/dev/null || true

# Configure A4 standard paper size
sudo lpoptions -p "$PRINTER_NAME" -o media=A4 2>/dev/null || true
sudo lpoptions -d "$PRINTER_NAME" -o media=A4 2>/dev/null || true

echo "\n════════════════════════════════════════════════════════"
echo "  Configuration Complete! 🎉"
echo "  Default Printer : $PRINTER_NAME"
echo "  Device URI      : $DEVICE_URI"
echo "  Queue Status    :"
lpstat -p "$PRINTER_NAME" || true
echo "════════════════════════════════════════════════════════"
