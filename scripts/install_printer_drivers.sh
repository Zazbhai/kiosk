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

# 2. Check and start ipp-usb (Modern driverless IPP-over-USB for DCP-T420W)
echo "\n[1/4] Ensuring IPP-over-USB and CUPS services are ready..."
if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get install -y ipp-usb cups-ipp-utils >/dev/null 2>&1 || true
fi

# Ensure ipp-usb is enabled
sudo systemctl unmask ipp-usb 2>/dev/null || true
sudo systemctl restart ipp-usb 2>/dev/null || true
sleep 2

# 3. Check for USB printers connected
echo "\n[2/4] Scanning for connected USB printing devices..."
USB_PRINTERS=$(lsusb | grep -i -E "printer|brother|hewlett|canon|epson|xerox|samsung" || true)

if [ -n "$USB_PRINTERS" ]; then
    echo "Found USB hardware device:"
    echo "$USB_PRINTERS"
else
    echo "Warning: No USB printer detected in 'lsusb'. Ensure USB cable is firmly plugged in and printer is powered ON."
fi

# 4. Discover driverless URI via IPP-over-USB or local network
echo "\n[3/4] Discovering active device URI..."
DRIVERLESS_URI=$(driverless 2>/dev/null | grep -i "brother" | head -n 1 || driverless 2>/dev/null | head -n 1 || true)
DEVICE_URI=""
USE_DRIVERLESS=false

if [ -n "$DRIVERLESS_URI" ]; then
    DEVICE_URI="$DRIVERLESS_URI"
    USE_DRIVERLESS=true
    echo "✓ Detected IPP Driverless URI: $DEVICE_URI"
else
    # Check CUPS usb backend
    CUPS_USB_URI=$(sudo lpinfo -v 2>/dev/null | grep -i -E "direct usb://|usb://brother" | head -n 1 | awk '{print $2}' || true)
    if [ -n "$CUPS_USB_URI" ]; then
        DEVICE_URI="$CUPS_USB_URI"
        echo "Detected native USB URI: $DEVICE_URI"
    elif [ -e "/dev/usb/lp0" ]; then
        DEVICE_URI="usb:/dev/usb/lp0"
        echo "Using kernel USB node URI: $DEVICE_URI"
    else
        DEVICE_URI="usb://Brother/DCP-T420W"
        echo "Falling back to default URI: $DEVICE_URI"
    fi
fi

PRINTER_NAME="PrintBooth_Printer"

# 5. Add printer to CUPS
echo "\n[4/4] Configuring CUPS spooler for $PRINTER_NAME..."
# Cancel any existing stuck jobs and remove old queue
sudo cancel -a "$PRINTER_NAME" 2>/dev/null || true
sudo lpadmin -x "$PRINTER_NAME" 2>/dev/null || true

if [ "$USE_DRIVERLESS" = true ]; then
    echo "Configuring printer with IPP Everywhere driverless standard..."
    sudo lpadmin -p "$PRINTER_NAME" -E -v "$DEVICE_URI" -m everywhere
    echo "✓ Added $PRINTER_NAME using IPP Everywhere!"
else
    # Attempt everywhere on device URI first, then fallback
    if sudo lpadmin -p "$PRINTER_NAME" -E -v "$DEVICE_URI" -m everywhere 2>/dev/null; then
        echo "✓ Added $PRINTER_NAME using IPP Everywhere."
    else
        # NEVER use old laser PPDs like dcp-1200. Check for generic raster or raw
        GENERIC_PPD=$(sudo lpinfo -m 2>/dev/null | grep -i "drv:///sample.drv/generic.ppd" | head -n 1 | awk '{print $1}' || true)
        if [ -n "$GENERIC_PPD" ]; then
            sudo lpadmin -p "$PRINTER_NAME" -E -v "$DEVICE_URI" -m "$GENERIC_PPD"
            echo "✓ Added $PRINTER_NAME using driver: $GENERIC_PPD"
        else
            sudo lpadmin -p "$PRINTER_NAME" -E -v "$DEVICE_URI" -m raw
            echo "✓ Added $PRINTER_NAME in direct spooling mode."
        fi
    fi
fi

# 6. Set as default printer and configure optimal kiosk options
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
