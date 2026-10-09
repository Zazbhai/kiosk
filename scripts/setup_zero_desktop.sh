#!/usr/bin/env bash
# ==============================================================================
# PrintBooth Zero-Desktop Standalone Kiosk Session Setup
# ==============================================================================
# Ensures that on Pi boot and restart, the Raspberry Pi OS desktop (LXDE, taskbars,
# desktop icons, wallpapers, start menu) is NEVER initialized.
# Replaces the desktop with a dedicated, locked-down PrintBooth kiosk session.
# ==============================================================================

set -e

echo "════════════════════════════════════════════════════════"
echo "  Setting up Zero-Desktop Standalone Kiosk Session      "
echo "════════════════════════════════════════════════════════"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIOSK_ROOT="$(dirname "$SCRIPT_DIR")"
ACTUAL_USER="${SUDO_USER:-$USER}"
USER_HOME=$(eval echo "~$ACTUAL_USER")
START_SCRIPT="$SCRIPT_DIR/start_kiosk.sh"
chmod +x "$START_SCRIPT"

# 1. Install lightweight window manager (Openbox) and display utilities
echo "\n[1/5] Ensuring Openbox & display utilities are installed..."
sudo apt-get update -y
sudo apt-get install -y \
    openbox \
    x11-xserver-utils \
    unclutter \
    xdotool \
    feh 2>/dev/null || true

# 2. Deploy Openbox locked-down kiosk configuration
echo "\n[2/5] Configuring locked-down Openbox profile (No menus, no borders)..."
USER_OPENBOX_DIR="$USER_HOME/.config/openbox"
sudo -u "$ACTUAL_USER" mkdir -p "$USER_OPENBOX_DIR"
cp "$SCRIPT_DIR/openbox-kiosk-rc.xml" "$USER_OPENBOX_DIR/rc.xml"
chown "$ACTUAL_USER:$ACTUAL_USER" "$USER_OPENBOX_DIR/rc.xml"

# Create Openbox autostart script
cat << EOF > "$USER_OPENBOX_DIR/autostart"
#!/usr/bin/env bash
# 1. Pure obsidian background canvas (No desktop wallpaper leak)
xsetroot -solid "#06110D"

# 2. Kill screen sleep / blanking
xset s noblank
xset s off
xset -dpms

# 3. Suppress mouse cursor on touchscreen
unclutter -idle 0.1 -root &

# 4. Launch PrintBooth Kiosk Supervisor
bash "$START_SCRIPT"
EOF

chmod +x "$USER_OPENBOX_DIR/autostart"
chown "$ACTUAL_USER:$ACTUAL_USER" "$USER_OPENBOX_DIR/autostart"

# 3. Create dedicated system-wide standalone XSession
echo "\n[3/5] Registering printbooth-kiosk standalone XSession..."
sudo tee /usr/share/xsessions/printbooth-kiosk.desktop > /dev/null << 'EOF'
[Desktop Entry]
Name=PrintBooth Kiosk
Comment=Dedicated Autonomous Touchscreen Kiosk Session
Exec=/usr/local/bin/printbooth-kiosk-session
Type=Application
EOF

# Create the session launcher
sudo tee /usr/local/bin/printbooth-kiosk-session > /dev/null << EOF
#!/usr/bin/env bash
# Hardware-level black canvas
xsetroot -solid "#06110D"
unclutter -idle 0.1 -root &
exec openbox-session
EOF

sudo chmod +x /usr/local/bin/printbooth-kiosk-session

# 4. Configure LightDM to auto-login into printbooth-kiosk directly
echo "\n[4/5] Configuring LightDM Display Manager (Bypassing Desktop)..."
LIGHTDM_CONF="/etc/lightdm/lightdm.conf"
if [ -f "$LIGHTDM_CONF" ]; then
    # Backup
    if [ ! -f "${LIGHTDM_CONF}.printbooth_backup" ]; then
        sudo cp "$LIGHTDM_CONF" "${LIGHTDM_CONF}.printbooth_backup"
    fi

    # Ensure autologin user is set
    sudo sed -i "s/^#*autologin-user=.*/autologin-user=$ACTUAL_USER/" "$LIGHTDM_CONF"
    
    # Set autologin session to our standalone kiosk session (NO LXDE!)
    if grep -q "autologin-session=" "$LIGHTDM_CONF"; then
        sudo sed -i "s/^#*autologin-session=.*/autologin-session=printbooth-kiosk/" "$LIGHTDM_CONF"
    else
        echo "autologin-session=printbooth-kiosk" | sudo tee -a "$LIGHTDM_CONF" > /dev/null
    fi

    if grep -q "user-session=" "$LIGHTDM_CONF"; then
        sudo sed -i "s/^#*user-session=.*/user-session=printbooth-kiosk/" "$LIGHTDM_CONF"
    fi

    # Disable cursor and screen blanking at Xorg server launch
    if grep -q "xserver-command=" "$LIGHTDM_CONF"; then
        sudo sed -i "s/^#*xserver-command=.*/xserver-command=X -nocursor -s 0 -dpms/" "$LIGHTDM_CONF"
    else
        sudo sed -i "/\[Seat:\*\]/a xserver-command=X -nocursor -s 0 -dpms" "$LIGHTDM_CONF" 2>/dev/null || true
    fi
    echo "  ✓ Configured LightDM for direct printbooth-kiosk auto-login"
fi

# 5. Disable default LXDE desktop panel and wallpaper (Fail-safe)
echo "\n[5/6] Neutralizing standard desktop autostart (LXDE / Wayland)..."
LXDE_AUTOSTART="$USER_HOME/.config/lxsession/LXDE-pi/autostart"
mkdir -p "$(dirname "$LXDE_AUTOSTART")" 2>/dev/null || true
cat << EOF > "$LXDE_AUTOSTART"
# Stripped of lxpanel and pcmanfm (NO DESKTOP ICONS OR TASKBAR)
@xsetroot -solid "#06110D"
@xset s noblank
@xset s off
@xset -dpms
@unclutter -idle 0.1 -root
@bash $START_SCRIPT
EOF
chown "$ACTUAL_USER:$ACTUAL_USER" "$LXDE_AUTOSTART" 2>/dev/null || true

# For Wayland (Raspberry Pi OS Bookworm)
WAYFIRE_INI="$USER_HOME/.config/wayfire.ini"
if [ -f "$WAYFIRE_INI" ]; then
    echo "Hardening Wayfire profile against desktop exposure..."
    # Disable panel and background wallpaper in wayfire
    sed -i 's/^panel = .*/panel = false/' "$WAYFIRE_INI" 2>/dev/null || true
    sed -i 's/^background = .*/background = false/' "$WAYFIRE_INI" 2>/dev/null || true
    if ! grep -q "printbooth_kiosk" "$WAYFIRE_INI"; then
        cat << EOF >> "$WAYFIRE_INI"

[autostart]
printbooth_kiosk = bash $START_SCRIPT
screensaver = false
dpms = false
EOF
    fi
    chown "$ACTUAL_USER:$ACTUAL_USER" "$WAYFIRE_INI" 2>/dev/null || true
fi

# 6. Eliminate All System Popups, Keyring & Authentication Modals
echo "\n[6/6] Locking down PolicyKit and Keyrings to prevent authentication popups..."
sudo mkdir -p /etc/polkit-1/rules.d 2>/dev/null || true
sudo tee /etc/polkit-1/rules.d/00-printbooth-kiosk.rules > /dev/null << 'EOF'
/* Automatically authorize any background action (printers, colord, network, storage) without password popups */
polkit.addRule(function(action, subject) {
    return polkit.Result.YES;
});
EOF

sudo mkdir -p /etc/polkit-1/localauthority/50-local.d 2>/dev/null || true
sudo tee /etc/polkit-1/localauthority/50-local.d/00-printbooth-kiosk.pkla > /dev/null << 'EOF'
[PrintBooth Kiosk Grant All]
Identity=unix-user:*
Action=*
ResultAny=yes
ResultInactive=yes
ResultActive=yes
EOF

# Mask lxpolkit service and suppress polkit-gnome / keyring desktop popups
sudo systemctl mask lxpolkit.service 2>/dev/null || true
sudo rm -f /etc/xdg/autostart/lxpolkit.desktop 2>/dev/null || true
sudo rm -f /etc/xdg/autostart/polkit-gnome-authentication-agent-1.desktop 2>/dev/null || true
sudo rm -f /etc/xdg/autostart/gnome-keyring-pkcs11.desktop 2>/dev/null || true
sudo rm -f /etc/xdg/autostart/gnome-keyring-secrets.desktop 2>/dev/null || true
sudo rm -f /etc/xdg/autostart/gnome-keyring-ssh.desktop 2>/dev/null || true

echo "\n════════════════════════════════════════════════════════"
echo "  ✓ Zero-Desktop Kiosk Setup Complete!                 "
echo "  The Raspberry Pi desktop environment has been         "
echo "  completely replaced by the PrintBooth Kiosk session.  "
echo "  Desktop icons, taskbars, wallpapers, and auth popups  "
echo "  will NEVER be shown on startup or restart.            "
echo "════════════════════════════════════════════════════════"
