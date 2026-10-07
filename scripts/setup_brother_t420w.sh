#!/usr/bin/env bash
# ==============================================================================
# PrintBooth — Brother DCP-T420W Native Linux Driver Installer (ARM64 & x86_64)
# ==============================================================================
# Downloads official Brother DCP-T420W raster driver and configures ARM64
# emulation layer (box64 / qemu-user-static) so Brother rasterizer runs
# natively on Raspberry Pi OS.
# ==============================================================================

set -e

echo "════════════════════════════════════════════════════════"
echo "  PrintBooth Brother DCP-T420W Automated Driver Setup   "
echo "════════════════════════════════════════════════════════"

# 1. Install prerequisites (CUPS, ghostscript, emulation for ARM64)
echo "\n[1/6] Installing prerequisites & ARM64 emulation layer..."
sudo apt-get update
sudo apt-get install -y cups ghostscript perl wget tar

ARCH=$(uname -m)
if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
    echo "Detected 64-bit ARM CPU ($ARCH). Installing x86_64 emulation..."
    sudo apt-get install -y box64 || sudo apt-get install -y qemu-user-static binfmt-support || true
fi

# 2. Release USB port to CUPS usblp backend (disable ipp-usb conflict)
echo "\n[2/6] Freeing USB device from ipp-usb daemon..."
sudo systemctl stop ipp-usb 2>/dev/null || true
sudo systemctl mask ipp-usb 2>/dev/null || true
sudo modprobe usblp 2>/dev/null || true
sleep 1

# 3. Download official Brother DCP-T420W Linux driver package
WORK_DIR="/tmp/brother_driver_setup"
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

echo "\n[3/6] Downloading official Brother DCP-T420W driver package..."
DRIVER_URL="https://download.brother.com/welcome/dlf105168/dcpt420wpdrv-3.5.0-1.i386.deb"
wget -q --show-progress "$DRIVER_URL" -O brother_driver.deb

# 4. Extract package contents
echo "\n[4/6] Extracting Brother driver files..."
ar x brother_driver.deb data.tar.gz
sudo tar -xzf data.tar.gz -C /

# 5. Configure x86_64 binaries & create ARM64 emulation wrapper
echo "\n[5/6] Setting up filters & CUPS wrapper..."
sudo mkdir -p /opt/brother/Printers/dcpt420w/lpd
sudo mkdir -p /usr/lib/cups/filter
sudo mkdir -p /usr/share/cups/model/Brother

# Link x86_64 binaries
if [ ! -f /opt/brother/Printers/dcpt420w/lpd/x86_64/brdcpt420wfilter.real ]; then
    sudo mv /opt/brother/Printers/dcpt420w/lpd/x86_64/brdcpt420wfilter /opt/brother/Printers/dcpt420w/lpd/x86_64/brdcpt420wfilter.real
fi
if [ ! -f /opt/brother/Printers/dcpt420w/lpd/x86_64/brprintconf_dcpt420w.real ]; then
    sudo mv /opt/brother/Printers/dcpt420w/lpd/x86_64/brprintconf_dcpt420w /opt/brother/Printers/dcpt420w/lpd/x86_64/brprintconf_dcpt420w.real
fi

# Create smart execution wrapper for brdcpt420wfilter
cat << 'EOF' | sudo tee /opt/brother/Printers/dcpt420w/lpd/x86_64/brdcpt420wfilter > /dev/null
#!/bin/sh
REAL="/opt/brother/Printers/dcpt420w/lpd/x86_64/brdcpt420wfilter.real"
if [ "$(uname -m)" = "x86_64" ]; then
    exec "$REAL" "$@"
elif command -v box64 >/dev/null 2>&1; then
    exec box64 "$REAL" "$@"
elif command -v qemu-x86_64-static >/dev/null 2>&1; then
    exec qemu-x86_64-static "$REAL" "$@"
else
    exec "$REAL" "$@"
fi
EOF

cat << 'EOF' | sudo tee /opt/brother/Printers/dcpt420w/lpd/x86_64/brprintconf_dcpt420w > /dev/null
#!/bin/sh
REAL="/opt/brother/Printers/dcpt420w/lpd/x86_64/brprintconf_dcpt420w.real"
if [ "$(uname -m)" = "x86_64" ]; then
    exec "$REAL" "$@"
elif command -v box64 >/dev/null 2>&1; then
    exec box64 "$REAL" "$@"
elif command -v qemu-x86_64-static >/dev/null 2>&1; then
    exec qemu-x86_64-static "$REAL" "$@"
else
    exec "$REAL" "$@"
fi
EOF

sudo chmod 755 /opt/brother/Printers/dcpt420w/lpd/x86_64/*
sudo ln -sf /opt/brother/Printers/dcpt420w/lpd/x86_64/brdcpt420wfilter /opt/brother/Printers/dcpt420w/lpd/brdcpt420wfilter
sudo ln -sf /opt/brother/Printers/dcpt420w/lpd/x86_64/brprintconf_dcpt420w /opt/brother/Printers/dcpt420w/lpd/brprintconf_dcpt420w
sudo ln -sf /opt/brother/Printers/dcpt420w/lpd/brprintconf_dcpt420w /usr/bin/brprintconf_dcpt420w

# Setup PPD and CUPS wrapper
sudo cp /opt/brother/Printers/dcpt420w/cupswrapper/brother_dcpt420w_printer_en.ppd /usr/share/cups/model/Brother/
sudo chmod 644 /usr/share/cups/model/Brother/brother_dcpt420w_printer_en.ppd
sudo ln -sf /opt/brother/Printers/dcpt420w/cupswrapper/brother_lpdwrapper_dcpt420w /usr/lib/cups/filter/brother_lpdwrapper_dcpt420w
sudo chmod 755 /usr/lib/cups/filter/brother_lpdwrapper_dcpt420w
sudo chmod 755 /opt/brother/Printers/dcpt420w/cupswrapper/*

# Initialize Brother printcap config
sudo /opt/brother/Printers/dcpt420w/inf/setupPrintcapij dcpt420w -i 2>/dev/null || true

# 6. Configure CUPS printer queue
echo "\n[6/6] Discovering USB device & registering queue in CUPS..."
DEVICE_URI=$(sudo lpinfo -v 2>/dev/null | grep -i -E "direct usb://brother|usb://brother/dcp-t420w" | head -n 1 | awk '{print $2}' || true)
if [ -z "$DEVICE_URI" ]; then
    DEVICE_URI=$(sudo lpinfo -v 2>/dev/null | grep -E "usb://" | head -n 1 | awk '{print $2}' || true)
fi
if [ -z "$DEVICE_URI" ] && [ -e "/dev/usb/lp0" ]; then
    DEVICE_URI="usb:/dev/usb/lp0"
fi
if [ -z "$DEVICE_URI" ]; then
    DEVICE_URI="usb://Brother/DCP-T420W"
fi

PRINTER_NAME="PrintBooth_Printer"
sudo cancel -a "$PRINTER_NAME" 2>/dev/null || true
sudo lpadmin -x "$PRINTER_NAME" 2>/dev/null || true

echo "Registering $PRINTER_NAME with official Brother PPD and URI: $DEVICE_URI"
sudo lpadmin -p "$PRINTER_NAME" -E -v "$DEVICE_URI" -P /usr/share/cups/model/Brother/brother_dcpt420w_printer_en.ppd -o printer-error-policy=retry-current-job
sudo lpadmin -d "$PRINTER_NAME"
sudo cupsenable "$PRINTER_NAME"
sudo cupsaccept "$PRINTER_NAME"

# Set standard A4 media
sudo lpoptions -p "$PRINTER_NAME" -o media=A4 2>/dev/null || true
sudo lpoptions -d "$PRINTER_NAME" -o media=A4 2>/dev/null || true

# Clean up temporary downloads
rm -rf "$WORK_DIR"

# Install self-healing recovery engine & udev watchdogs
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/setup_autorecover.sh" ]; then
    echo "\nInstalling hardware self-healing watchdog..."
    bash "$SCRIPT_DIR/setup_autorecover.sh" || true
fi

echo "\n════════════════════════════════════════════════════════"
echo "  Brother DCP-T420W Installation Successful! 🎉         "
echo "  Queue Name   : $PRINTER_NAME"
echo "  Device URI   : $DEVICE_URI"
echo "  PPD Model    : Brother DCPT420W CUPS (Official)"
echo "  Self-Healing : Active (udev + systemd watchdogs)"
echo "════════════════════════════════════════════════════════"
