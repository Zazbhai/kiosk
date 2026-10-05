#!/usr/bin/env bash
# ==============================================================================
# PrintBooth — Raspberry Pi OS Kiosk Mode & Auto-Login Configuration
# ==============================================================================
# Configures Raspberry Pi to boot directly into fullscreen kiosk mode.
# Disables screen sleep, screensaver, low-voltage warnings overlay, and cursor.
# ==============================================================================

set -e

echo "════════════════════════════════════════════════════════"
echo "  Configuring Raspberry Pi OS Touchscreen Kiosk Mode   "
echo "════════════════════════════════════════════════════════"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIOSK_ROOT="$(dirname "$SCRIPT_DIR")"
START_SCRIPT="$SCRIPT_DIR/start_kiosk.sh"
chmod +x "$START_SCRIPT"

# 1. Disable screen blanking in console & X11
echo "\n[1/4] Disabling screen blanking and power management..."
# For X11 (Raspberry Pi OS Bullseye / Legacy / Openbox)
AUTOSTART_DIR="$HOME/.config/lxsession/LXDE-pi"
mkdir -p "$AUTOSTART_DIR"

cat << EOF > "$AUTOSTART_DIR/autostart"
@xset s noblank
@xset s off
@xset -dpms
@unclutter -idle 0.5 -root
@bash $START_SCRIPT
EOF

# For Wayland / Wayfire (Raspberry Pi OS Bookworm)
WAYFIRE_INI="$HOME/.config/wayfire.ini"
if [ -f "$WAYFIRE_INI" ]; then
    echo "Detected Wayfire configuration. Adding PrintBooth kiosk autostart..."
    if ! grep -q "printbooth_kiosk" "$WAYFIRE_INI"; then
        cat << EOF >> "$WAYFIRE_INI"

[autostart]
printbooth_kiosk = bash $START_SCRIPT
screensaver = false
dpms = false
EOF
    fi
fi

# 2. Configure bootloader display options (disable boot logo/cursor)
echo "\n[2/4] Optimizing boot configuration..."
if [ -f "/boot/firmware/cmdline.txt" ]; then
    CMDLINE_FILE="/boot/firmware/cmdline.txt"
elif [ -f "/boot/cmdline.txt" ]; then
    CMDLINE_FILE="/boot/cmdline.txt"
fi

if [ -n "$CMDLINE_FILE" ]; then
    if ! grep -q "quiet splash logo.nologo" "$CMDLINE_FILE"; then
        echo "Adding quiet splash flags to $CMDLINE_FILE..."
        sudo sed -i 's/$/ quiet splash logo.nologo vt.global_cursor_default=0/' "$CMDLINE_FILE"
    fi
fi

# 3. Setup systemd user auto-login if raspi-config is present
echo "\n[3/4] Ensuring GUI Desktop Auto-login..."
if command -v raspi-config > /dev/null; then
    # B4 = Desktop Autologin
    sudo raspi-config nonint do_boot_behaviour B4 || true
fi

# 4. Enable display systemd service as alternative backup
echo "\n[4/4] Registering printbooth-display systemd service..."
ACTUAL_USER="${SUDO_USER:-$USER}"
sudo sed -e "s|User=pi|User=$ACTUAL_USER|g" \
         -e "s|/home/pi/printer_automation/kiosk|$KIOSK_ROOT|g" \
         -e "s|/home/pi|$HOME|g" \
         "$SCRIPT_DIR/printbooth-display.service" | sudo tee /etc/systemd/system/printbooth-display.service > /dev/null

sudo systemctl daemon-reload
sudo systemctl enable printbooth-display.service

echo "\n════════════════════════════════════════════════════════"
echo "  Kiosk Mode Configuration Complete! 🎉"
echo "  On next reboot, Raspberry Pi will automatically boot"
echo "  into the PrintBooth fullscreen touchscreen kiosk."
echo "════════════════════════════════════════════════════════"
