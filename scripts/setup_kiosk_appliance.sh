#!/usr/bin/env bash
# ==============================================================================
# PrintBooth Kiosk Appliance Master Installer
# ==============================================================================
# Transforms a standard Raspberry Pi into an autonomous, commercial-grade
# self-service print kiosk appliance with:
#   1. Custom silent bootloader & branded PrintBooth Plymouth splash
#   2. Zero-desktop standalone session (LXDE/taskbars completely bypassed)
#   3. Crash-proof self-healing kiosk supervisor with watchdog
#   4. Clean auto-recovery on restart (no old print queues, no file leftovers)
# ==============================================================================

set -e

echo "════════════════════════════════════════════════════════"
echo "  PrintBooth Autonomous Kiosk Appliance Setup          "
echo "════════════════════════════════════════════════════════"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIOSK_ROOT="$(dirname "$SCRIPT_DIR")"

# Ensure all scripts are executable
chmod +x "$SCRIPT_DIR"/*.sh 2>/dev/null || true

# 1. Step 1: Configure Custom Bootloader & Splash
echo -e "\n[STEP 1/3] Configuring Silent Bootloader & Custom Splash..."
bash "$SCRIPT_DIR/setup_custom_bootloader.sh"

# 2. Step 2: Configure Zero-Desktop Dedicated Kiosk Session
echo -e "\n[STEP 2/3] Configuring Zero-Desktop Kiosk Environment..."
bash "$SCRIPT_DIR/setup_zero_desktop.sh"

# 3. Step 3: Register Systemd Services & Ensure CUPS Zero-Queue Permissions
echo -e "\n[STEP 3/3] Finalizing Systemd Services & Zero-Leftover Policies..."
ACTUAL_USER="${SUDO_USER:-$USER}"

if [ -f "$SCRIPT_DIR/printbooth-display.service" ]; then
    sudo sed -e "s|User=pi|User=$ACTUAL_USER|g" \
             -e "s|/home/pi/printer_automation/kiosk|$KIOSK_ROOT|g" \
             -e "s|/home/pi|$HOME|g" \
             "$SCRIPT_DIR/printbooth-display.service" | sudo tee /etc/systemd/system/printbooth-display.service > /dev/null
    sudo systemctl daemon-reload
    sudo systemctl enable printbooth-display.service
    echo "  ✓ Registered printbooth-display.service"
fi

# Ensure CUPS preserves zero jobs on reboot
if command -v cupsctl > /dev/null 2>&1; then
    sudo cupsctl PreserveJobHistory=No PreserveJobFiles=No 2>/dev/null || true
    echo "  ✓ Configured CUPS zero-queue retention policy"
fi

echo -e "\n════════════════════════════════════════════════════════"
echo "  🎉 PrintBooth Kiosk Appliance Configuration Complete! "
echo "════════════════════════════════════════════════════════"
echo "  What happens on reboot:"
echo "  1. Silent Bootloader: No rainbow box, no Linux console dmesg."
echo "  2. Custom Splash: Branded PrintBooth Obsidian splash appears."
echo "  3. Zero Desktop: Desktop, taskbars, and icons are completely bypassed."
echo "  4. Fullscreen Kiosk: Displays touchscreen terminal with zero mouse cursor."
echo "  5. Crash Shield: If closed, it relaunches within 1 second."
echo "  6. Zero Leftovers: Hardware queue is automatically cleared on startup."
echo ""
echo "  To test now: bash $SCRIPT_DIR/start_kiosk.sh"
echo "  To reboot and test full bootloader: sudo reboot"
echo "════════════════════════════════════════════════════════"
