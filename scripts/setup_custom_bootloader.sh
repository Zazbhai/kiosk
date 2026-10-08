#!/usr/bin/env bash
# ==============================================================================
# PrintBooth Custom Bootloader & Silent Boot Setup
# ==============================================================================
# Replaces Raspberry Pi OS boot sequence with a custom branded PrintBooth splash:
#   1. Silences Linux kernel & dmesg text
#   2. Disables the 4-color rainbow square (disable_splash=1)
#   3. Hides the Raspberry Pi fruit logos (logo.nologo)
#   4. Hides terminal cursor (vt.global_cursor_default=0)
#   5. Installs custom PrintBooth Plymouth bootloader theme
#   6. Installs early systemd framebuffer splash service
# ==============================================================================

set -e

echo "════════════════════════════════════════════════════════"
echo "  Configuring Custom PrintBooth Bootloader & Splash     "
echo "════════════════════════════════════════════════════════"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSETS_DIR="$SCRIPT_DIR/splash_assets"

# 0. Generate splash graphics if missing
if [ ! -f "$ASSETS_DIR/boot_splash_1080p.png" ]; then
    echo "[1/5] Generating PrintBooth high-res splash graphics..."
    python3 "$SCRIPT_DIR/generate_splash.py" || true
fi

# Copy assets to persistent system location
sudo mkdir -p /etc/printbooth
if [ -f "$ASSETS_DIR/boot_splash_1080p.png" ]; then
    sudo cp "$ASSETS_DIR/boot_splash_1080p.png" /etc/printbooth/boot_splash.png
    sudo cp "$ASSETS_DIR/boot_splash_720p.png" /etc/printbooth/boot_splash_720.png 2>/dev/null || true
fi

# 1. Configure Firmware config.txt (remove rainbow square, fast boot)
echo "\n[2/5] Configuring firmware (config.txt)..."
CONFIG_FILE=""
if [ -f "/boot/firmware/config.txt" ]; then
    CONFIG_FILE="/boot/firmware/config.txt"
elif [ -f "/boot/config.txt" ]; then
    CONFIG_FILE="/boot/config.txt"
fi

if [ -n "$CONFIG_FILE" ]; then
    echo "Updating $CONFIG_FILE..."
    # Ensure disable_splash=1
    if ! grep -q "^disable_splash=1" "$CONFIG_FILE"; then
        sudo sed -i '/disable_splash/d' "$CONFIG_FILE"
        echo "disable_splash=1" | sudo tee -a "$CONFIG_FILE" > /dev/null
    fi
    # Ensure boot_delay=0
    if ! grep -q "^boot_delay=0" "$CONFIG_FILE"; then
        sudo sed -i '/boot_delay/d' "$CONFIG_FILE"
        echo "boot_delay=0" | sudo tee -a "$CONFIG_FILE" > /dev/null
    fi
    # Ensure avoid_warnings=1
    if ! grep -q "^avoid_warnings=1" "$CONFIG_FILE"; then
        sudo sed -i '/avoid_warnings/d' "$CONFIG_FILE"
        echo "avoid_warnings=1" | sudo tee -a "$CONFIG_FILE" > /dev/null
    fi
    echo "  ✓ Firmware configured (disable_splash=1, boot_delay=0, avoid_warnings=1)"
fi

# 2. Configure Kernel cmdline.txt (silent boot, console to tty3, cursor off)
echo "\n[3/5] Configuring silent kernel bootloader (cmdline.txt)..."
CMDLINE_FILE=""
if [ -f "/boot/firmware/cmdline.txt" ]; then
    CMDLINE_FILE="/boot/firmware/cmdline.txt"
elif [ -f "/boot/cmdline.txt" ]; then
    CMDLINE_FILE="/boot/cmdline.txt"
fi

if [ -n "$CMDLINE_FILE" ]; then
    # Backup original cmdline
    if [ ! -f "${CMDLINE_FILE}.printbooth_backup" ]; then
        sudo cp "$CMDLINE_FILE" "${CMDLINE_FILE}.printbooth_backup"
    fi

    # Read current line
    CURRENT_CMDLINE=$(cat "$CMDLINE_FILE" | tr -d '\n')

    # Remove conflicting console=tty1 or loud loglevels
    NEW_CMDLINE=$(echo "$CURRENT_CMDLINE" | sed 's/console=tty1/console=tty3/g')

    # Add required silent flags if missing
    REQUIRED_FLAGS="console=tty3 quiet loglevel=3 logo.nologo vt.global_cursor_default=0 splash fbcon=map:10 plymouth.ignore-serial-consoles"
    for flag in $REQUIRED_FLAGS; do
        if [[ ! "$NEW_CMDLINE" =~ $flag ]]; then
            NEW_CMDLINE="$NEW_CMDLINE $flag"
        fi
    done

    # Remove multiple consecutive spaces and write as single line
    echo "$NEW_CMDLINE" | tr -s ' ' | sudo tee "$CMDLINE_FILE" > /dev/null
    echo "  ✓ Kernel cmdline updated with silent boot flags"
fi

# 3. Setup Custom PrintBooth Plymouth Theme
echo "\n[4/5] Installing custom PrintBooth Plymouth splash theme..."
PLYMOUTH_THEME_DIR="/usr/share/plymouth/themes/printbooth"
if command -v plymouth > /dev/null 2>&1 || [ -d "/usr/share/plymouth" ]; then
    sudo mkdir -p "$PLYMOUTH_THEME_DIR"
    
    # Copy theme graphics
    if [ -f "/etc/printbooth/boot_splash.png" ]; then
        sudo cp "/etc/printbooth/boot_splash.png" "$PLYMOUTH_THEME_DIR/background.png"
    fi
    if [ -f "$ASSETS_DIR/plymouth_watermark.png" ]; then
        sudo cp "$ASSETS_DIR/plymouth_watermark.png" "$PLYMOUTH_THEME_DIR/watermark.png"
    fi
    if [ -f "$ASSETS_DIR/progress_track.png" ]; then
        sudo cp "$ASSETS_DIR/progress_track.png" "$PLYMOUTH_THEME_DIR/progress_track.png"
        sudo cp "$ASSETS_DIR/progress_bar.png" "$PLYMOUTH_THEME_DIR/progress_bar.png"
    fi

    # Create Plymouth Theme descriptor
    cat << 'EOF' | sudo tee "$PLYMOUTH_THEME_DIR/printbooth.plymouth" > /dev/null
[Plymouth Theme]
Name=PrintBooth Appliance Kiosk
Description=High-tech obsidian and synthetic lime hardware bootloader
ModuleName=script

[script]
ImageDir=/usr/share/plymouth/themes/printbooth
ScriptFile=/usr/share/plymouth/themes/printbooth/printbooth.script
EOF

    # Create Plymouth script logic
    cat << 'EOF' | sudo tee "$PLYMOUTH_THEME_DIR/printbooth.script" > /dev/null
# Window background (Obsidian #06110D)
Window.SetBackgroundTopColor(0.024, 0.067, 0.051);
Window.SetBackgroundBottomColor(0.024, 0.067, 0.051);

# Load 1080p background
bg_image = Image("background.png");
screen_width = Window.GetWidth();
screen_height = Window.GetHeight();

# Scale background to current screen size
resized_bg = bg_image.Scale(screen_width, screen_height);
bg_sprite = Sprite(resized_bg);
bg_sprite.SetPosition(0, 0, 0);

# Status string
message_sprite = Sprite();
message_sprite.SetPosition(screen_width / 2 - 120, screen_height / 2 + 130, 10);

fun message_callback (text) {
    my_image = Image.Text(text, 0.7, 0.9, 0.8);
    message_sprite.SetImage(my_image);
}

Plymouth.SetMessageFunction(message_callback);
EOF

    # Activate the theme
    if command -v plymouth-set-default-theme > /dev/null 2>&1; then
        sudo plymouth-set-default-theme printbooth -R 2>/dev/null || true
        echo "  ✓ Activated Plymouth theme: printbooth"
    fi
else
    echo "  (Plymouth not installed; installing fbi early framebuffer splash fallback)"
fi

# 4. Install Early Systemd Framebuffer Splash (Fail-safe for non-Plymouth setups)
echo "\n[5/5] Configuring early Framebuffer Splash service..."
cat << 'EOF' | sudo tee /etc/systemd/system/printbooth-boot-splash.service > /dev/null
[Unit]
Description=PrintBooth Hardware Early Boot Splash
DefaultDependencies=no
After=systemd-udev-settle.service
Before=basic.target graphical.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStartPre=-/bin/sh -c 'command -v fbi >/dev/null && fbi -d /dev/fb0 -T 1 --noverbose -a /etc/printbooth/boot_splash.png || true'
ExecStart=/bin/true

[Install]
WantedBy=basic.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable printbooth-boot-splash.service 2>/dev/null || true

# Mask console cursor and quiet tty1
sudo mkdir -p /etc/systemd/system/getty@tty1.service.d/
cat << 'EOF' | sudo tee /etc/systemd/system/getty@tty1.service.d/nocursor.conf > /dev/null
[Service]
TTYVTDisallocate=no
StandardOutput=null
StandardError=null
EOF

echo "\n════════════════════════════════════════════════════════"
echo "  ✓ Custom Bootloader & Silent Splash Configured!       "
echo "  Raspberry Pi will now power on silently with the      "
echo "  PrintBooth hardware splash and zero terminal output.  "
echo "════════════════════════════════════════════════════════"
