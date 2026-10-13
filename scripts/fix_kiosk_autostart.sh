#!/usr/bin/env bash
# ==============================================================================
# PrintBooth — Kiosk Autostart Diagnostic & Healing Script
# ==============================================================================
# Ensures start_kiosk.sh launches cleanly on every Pi boot without desktop exposure.
# Works across Raspberry Pi OS Bookworm (Wayland/Wayfire/Openbox) and Bullseye (X11).
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIOSK_ROOT="$(dirname "$SCRIPT_DIR")"
START_SCRIPT="$SCRIPT_DIR/start_kiosk.sh"
CURRENT_USER="${SUDO_USER:-$USER}"
USER_HOME=$(eval echo "~$CURRENT_USER")

echo "════════════════════════════════════════════════════════"
echo "  PrintBooth Kiosk Boot Autostart Configuration & Repair"
echo "════════════════════════════════════════════════════════"
echo "  Target User       : $CURRENT_USER"
echo "  Home Directory    : $USER_HOME"
echo "  Kiosk Root        : $KIOSK_ROOT"
echo "  Start Script      : $START_SCRIPT"
echo "════════════════════════════════════════════════════════"

chmod +x "$START_SCRIPT"
chmod +x "$SCRIPT_DIR"/*.sh 2>/dev/null || true

# 1. Clean any stale locks or paused flags
rm -f /tmp/start_kiosk*.lock /tmp/printbooth_kiosk_paused /tmp/printbooth_exit_requested 2>/dev/null || true

# 2. Deploy XDG Standard Desktop Autostart entry (~/.config/autostart/)
echo "\n[1/4] Configuring XDG Autostart entry..."
AUTOSTART_DIR="$USER_HOME/.config/autostart"
mkdir -p "$AUTOSTART_DIR"

cat << EOF > "$AUTOSTART_DIR/printbooth-kiosk.desktop"
[Desktop Entry]
Type=Application
Name=PrintBooth Kiosk
Comment=Autonomous Touchscreen Kiosk
Exec=/bin/bash $START_SCRIPT
Terminal=false
X-GNOME-Autostart-enabled=true
EOF

chown -R "$CURRENT_USER:$CURRENT_USER" "$AUTOSTART_DIR" 2>/dev/null || true
echo "  ✓ Installed $AUTOSTART_DIR/printbooth-kiosk.desktop"

# 3. Configure Openbox Autostart (Standalone Session)
echo "\n[2/4] Configuring Openbox standalone session autostart..."
OPENBOX_DIR="$USER_HOME/.config/openbox"
mkdir -p "$OPENBOX_DIR"

cat << EOF > "$OPENBOX_DIR/autostart"
#!/usr/bin/env bash
xsetroot -solid "#ffffff" 2>/dev/null || true
xset s noblank 2>/dev/null || true
xset s off 2>/dev/null || true
xset -dpms 2>/dev/null || true
unclutter -idle 0.1 -root &
bash "$START_SCRIPT"
EOF

chmod +x "$OPENBOX_DIR/autostart"
chown -R "$CURRENT_USER:$CURRENT_USER" "$OPENBOX_DIR" 2>/dev/null || true
echo "  ✓ Configured $OPENBOX_DIR/autostart"

# 4. Configure LXDE Legacy Autostart
LXDE_DIR="$USER_HOME/.config/lxsession/LXDE-pi"
if [ -d "$USER_HOME/.config/lxsession" ] || [ -f "$USER_HOME/.config/lxsession/LXDE-pi/autostart" ]; then
    echo "\n[3/4] Updating LXDE session autostart..."
    mkdir -p "$LXDE_DIR"
    cat << EOF > "$LXDE_DIR/autostart"
@xset s noblank
@xset s off
@xset -dpms
@unclutter -idle 0.1 -root
@bash $START_SCRIPT
EOF
    chown -R "$CURRENT_USER:$CURRENT_USER" "$LXDE_DIR" 2>/dev/null || true
    echo "  ✓ Configured $LXDE_DIR/autostart"
fi

# 5. Wayfire / Wayland configuration (Raspberry Pi OS Bookworm)
WAYFIRE_INI="$USER_HOME/.config/wayfire.ini"
if [ -f "$WAYFIRE_INI" ]; then
    echo "\n[4/4] Configuring Wayfire (Wayland) profile..."
    if ! grep -q "printbooth_kiosk" "$WAYFIRE_INI"; then
        cat << EOF >> "$WAYFIRE_INI"

[autostart]
printbooth_kiosk = bash $START_SCRIPT
screensaver = false
dpms = false
EOF
        chown "$CURRENT_USER:$CURRENT_USER" "$WAYFIRE_INI" 2>/dev/null || true
        echo "  ✓ Registered in $WAYFIRE_INI"
    else
        echo "  ✓ Already present in $WAYFIRE_INI"
    fi
fi

# 6. Install and synchronize systemd services with real user and paths
echo -e "\n[5/5] Installing and updating systemd services (brain & display)..."
if [ -f "$SCRIPT_DIR/install_services.sh" ]; then
    bash "$SCRIPT_DIR/install_services.sh" || true
else
    sudo sed -i -e "s|^User=.*|User=$CURRENT_USER|g" \
                -e "s|/home/pi/printer_automation/kiosk|$KIOSK_ROOT|g" \
                -e "s|/home/pi|$USER_HOME|g" \
                /etc/systemd/system/printbooth-display.service /etc/systemd/system/printbooth-brain.service 2>/dev/null || true
    sudo systemctl daemon-reload 2>/dev/null || true
fi

echo "\n════════════════════════════════════════════════════════"
echo "  ✓ Autostart Repair Complete!"
echo "  PrintBooth Kiosk will now reliably boot directly into"
echo "  the fullscreen touchscreen interface on restart."
echo "════════════════════════════════════════════════════════"
