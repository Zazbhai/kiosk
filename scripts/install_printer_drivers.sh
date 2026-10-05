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

# 2. Prevent ipp-usb from locking the USB interface away from CUPS/usblp
echo "\n[1/4] Ensuring Linux USB printer kernel module is attached..."
if systemctl is-active --quiet ipp-usb 2>/dev/null; then
    echo "[!] Stopping conflicting 'ipp-usb' daemon so native CUPS USB driver can claim printer..."
    sudo systemctl stop ipp-usb || true
    sudo systemctl mask ipp-usb || true
fi
sudo modprobe usblp 2>/dev/null || true
sleep 1

# 3. Check for USB printers connected
echo "\n[2/4] Scanning for connected USB printing devices..."
USB_PRINTERS=$(lsusb | grep -i -E "printer|brother|hewlett|canon|epson|xerox|samsung" || true)

if [ -n "$USB_PRINTERS" ]; then
    echo "Found USB hardware device:"
    echo "$USB_PRINTERS"
else
    echo "Warning: No USB printer detected in 'lsusb'. Ensure USB cable is firmly plugged in and printer is powered ON."
fi

# 4. Discover real printer URI via CUPS or kernel device node
echo "\n[3/4] Discovering active device URI..."
DEVICE_URI=$(sudo lpinfo -v 2>/dev/null | grep -i -E "direct usb://|usb://brother" | head -n 1 | awk '{print $2}' || true)

if [ -z "$DEVICE_URI" ]; then
    # Check if kernel device node /dev/usb/lp0 exists
    if [ -e "/dev/usb/lp0" ]; then
        DEVICE_URI="usb:/dev/usb/lp0"
        echo "Using kernel USB node URI: $DEVICE_URI"
    else
        # Try raw USB scanning via lpinfo
        FALLBACK_URI=$(sudo lpinfo -v 2>/dev/null | grep -E "usb://" | head -n 1 | awk '{print $2}' || true)
        if [ -n "$FALLBACK_URI" ]; then
            DEVICE_URI="$FALLBACK_URI"
            echo "Found active USB URI: $DEVICE_URI"
        else
            echo "[!] Could not detect active USB URI. Checking if printer is available over Wi-Fi/network..."
            NET_URI=$(ippfind 2>/dev/null | head -n 1 || true)
            if [ -n "$NET_URI" ]; then
                DEVICE_URI="$NET_URI"
                echo "✓ Detected network printer URI: $DEVICE_URI"
            else
                DEVICE_URI="usb:/dev/usb/lp0"
                echo "Falling back to standard direct node: $DEVICE_URI"
            fi
        fi
    fi
else
    echo "Detected hardware device URI: $DEVICE_URI"
fi

PRINTER_NAME="PrintBooth_Printer"

# 5. Add printer to CUPS
echo "\n[4/4] Configuring CUPS spooler for $PRINTER_NAME..."
# Cancel any existing stuck jobs and remove old queue
sudo cancel -a "$PRINTER_NAME" 2>/dev/null || true
sudo lpadmin -x "$PRINTER_NAME" 2>/dev/null || true

# Try generic / gutenprint PPD or raw mode
GUTEN_PPD=$(sudo lpinfo -m 2>/dev/null | grep -i -E "brother.*dcp|gutenprint.*generic|generic.*pcl" | head -n 1 | awk '{print $1}' || true)
if [ -n "$GUTEN_PPD" ]; then
    sudo lpadmin -p "$PRINTER_NAME" -E -v "$DEVICE_URI" -m "$GUTEN_PPD"
    echo "✓ Added $PRINTER_NAME using driver: $GUTEN_PPD"
elif sudo lpadmin -p "$PRINTER_NAME" -E -v "$DEVICE_URI" -m everywhere 2>/dev/null; then
    echo "✓ Added $PRINTER_NAME using IPP Everywhere."
else
    # Raw spooling mode fallback
    sudo lpadmin -p "$PRINTER_NAME" -E -v "$DEVICE_URI" -m raw
    echo "✓ Added $PRINTER_NAME in direct spooling mode."
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
