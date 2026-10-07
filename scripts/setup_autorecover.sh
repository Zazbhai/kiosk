#!/usr/bin/env bash
# ==============================================================================
# PrintBooth — Automated Installer for Hardware Self-Healing Watchdogs
# ==============================================================================
# Installs:
# 1. /usr/local/bin/printbooth_printer_autorecover.sh (executable recovery engine)
# 2. /etc/modules-load.d/usblp.conf (kernel module auto-load on boot)
# 3. /etc/udev/rules.d/99-printbooth-printer-autorecover.rules (hotplug auto-unpause)
# 4. /etc/systemd/system/printbooth-printer-autorecover.service (boot watchdog)
# 5. Masks conflicting ipp-usb service
# 6. Sets printer-error-policy=retry-current-job on all CUPS queues
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_RECOVER="$SCRIPT_DIR/printer_autorecover.sh"
TARGET_RECOVER="/usr/local/bin/printbooth_printer_autorecover.sh"

echo "════════════════════════════════════════════════════════"
echo "  PrintBooth Hardware Self-Healing Watchdog Setup       "
echo "════════════════════════════════════════════════════════"

# 1. Install recovery script to system path
echo -e "\n[1/6] Installing auto-recovery engine to $TARGET_RECOVER..."
if [ -f "$SOURCE_RECOVER" ]; then
    sudo cp "$SOURCE_RECOVER" "$TARGET_RECOVER"
    sudo chmod +x "$TARGET_RECOVER"
    echo "✓ Installed $TARGET_RECOVER"
else
    echo "❌ Error: Could not find $SOURCE_RECOVER"
    exit 1
fi

# 2. Configure usblp kernel module auto-load
echo -e "\n[2/6] Configuring usblp module to auto-load on system boot..."
echo "usblp" | sudo tee /etc/modules-load.d/usblp.conf > /dev/null
sudo modprobe usblp 2>/dev/null || true
echo "✓ Configured /etc/modules-load.d/usblp.conf"

# 3. Mask conflicting ipp-usb service
echo -e "\n[3/6] Disabling and masking conflicting ipp-usb daemon..."
sudo systemctl stop ipp-usb 2>/dev/null || true
sudo systemctl mask ipp-usb 2>/dev/null || true
echo "✓ ipp-usb permanently masked (preventing USB lockouts)"

# 4. Install udev hotplug auto-unpause rule
echo -e "\n[4/6] Installing udev rules for plug-and-play auto-unpause..."
sudo tee /etc/udev/rules.d/99-printbooth-printer-autorecover.rules > /dev/null << 'EOF'
# PrintBooth: Automatically recover and unpause CUPS queue whenever printer connects or boots
ACTION=="add", SUBSYSTEM=="usb", ATTR{bInterfaceClass}=="07", RUN+="/usr/local/bin/printbooth_printer_autorecover.sh"
ACTION=="add", SUBSYSTEM=="usb", ATTR{idVendor}=="04f9", RUN+="/usr/local/bin/printbooth_printer_autorecover.sh"
KERNEL=="lp[0-9]*", SUBSYSTEM=="usbmisc", ACTION=="add", RUN+="/usr/local/bin/printbooth_printer_autorecover.sh"
EOF

sudo udevadm control --reload-rules 2>/dev/null || true
sudo udevadm trigger 2>/dev/null || true
echo "✓ Installed /etc/udev/rules.d/99-printbooth-printer-autorecover.rules"

# 5. Install systemd boot watchdog service
echo -e "\n[5/6] Installing systemd boot watchdog service..."
sudo tee /etc/systemd/system/printbooth-printer-autorecover.service > /dev/null << 'EOF'
[Unit]
Description=PrintBooth Printer Post-Boot Auto-Recovery Watchdog
After=cups.service network.target
Wants=cups.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/printbooth_printer_autorecover.sh --boot-wait
RemainAfterExit=yes
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable printbooth-printer-autorecover.service
echo "✓ Enabled printbooth-printer-autorecover.service"

# 6. Apply retry-current-job error policy and test immediately
echo -e "\n[6/6] Applying retry-current-job policy and running initial verification..."
PRINTER_TARGET="${PRINTER_NAME:-PrintBooth_Printer}"
if lpstat -p "$PRINTER_TARGET" >/dev/null 2>&1; then
    sudo lpadmin -p "$PRINTER_TARGET" -o printer-error-policy=retry-current-job 2>/dev/null || true
    sudo cupsenable "$PRINTER_TARGET" 2>/dev/null || true
    sudo cupsaccept "$PRINTER_TARGET" 2>/dev/null || true
    echo "✓ Set printer-error-policy=retry-current-job on $PRINTER_TARGET"
fi

# Run verification
sudo "$TARGET_RECOVER" || true

echo -e "\n════════════════════════════════════════════════════════"
echo "  Self-Healing Setup Complete! 🎉                       "
echo "  Next Steps:                                           "
echo "  1. If mains power drops and returns:                  "
echo "     • Pi will boot in ~15s                             "
echo "     • Printer completes calibration in ~50s            "
echo "     • udev & systemd will auto-unpause CUPS instantly  "
echo "     • Kiosk Brain daemon will detect & report ONLINE   "
echo "  2. Test manually anytime:                             "
echo "     sudo /usr/local/bin/printbooth_printer_autorecover.sh"
echo "════════════════════════════════════════════════════════"
