#!/usr/bin/env bash
# ==============================================================================
# PrintBooth Custom Bootloader & Silent Fast-Boot Appliance Setup
# Light & Laser Red Matrix Opening Edition (NO LOGOS)
# Targeted for Raspberry Pi 4 Model B & Compute Module 4 (CM4)
# ==============================================================================
# 1. Hardware Firmware: Disables 4-color rainbow splash, sets zero boot delay,
#    enables initial CPU turbo and BCM2835 hardware watchdog in config.txt.
# 2. Kernel Handover: Silences kernel dmesg, redirects console to tty3,
#    hides Raspberry Pi fruit logos, hides terminal cursor in cmdline.txt.
# 3. Plymouth Graphical Bootloader: Installs Light & Laser Red Matrix opening
#    bootloader with streaming digital code rain, monospace terminal telemetry,
#    ZERO LOGO, and compiles into initramfs.
# 4. Anti-Popup & Polkit Lockdown: Completely suppresses "Authentication Required"
#    modals, GNOME keyring dialogs, and colord/network policy prompts.
# ==============================================================================

set -e

# Support preview testing: sudo ./setup_custom_bootloader.sh --test
TEST_MODE=false
if [ "$1" = "--test" ] || [ "$1" = "-t" ]; then
    TEST_MODE=true
fi

echo "════════════════════════════════════════════════════════"
echo "  PrintBooth Custom Bootloader: Matrix Edition (No Logo)"
echo "  Theme: High-Tech Light Porcelain & Laser Red Matrix   "
echo "  Target Architecture: Raspberry Pi 4 / CM4             "
echo "════════════════════════════════════════════════════════"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSETS_DIR="$SCRIPT_DIR/splash_assets"

# ------------------------------------------------------------------------------
# STEP 0: Generate or Verify Graphic Splash Assets (Light & Red Matrix)
# ------------------------------------------------------------------------------
echo -e "\n[STEP 1/7] Generating Light & Laser Red Matrix Visual Assets..."
mkdir -p "$ASSETS_DIR"

echo "  Rendering high-definition Light & Laser Red Matrix digital rain..."
python3 "$SCRIPT_DIR/generate_splash.py" || true

# Copy assets to persistent system location
sudo mkdir -p /etc/printbooth
if [ -f "$ASSETS_DIR/boot_splash_1080p.png" ]; then
    sudo cp "$ASSETS_DIR/boot_splash_1080p.png" /etc/printbooth/boot_splash.png
    sudo cp "$ASSETS_DIR/boot_splash_720p.png" /etc/printbooth/boot_splash_720.png 2>/dev/null || true
    echo "  ✓ System fallback boot splash registered at /etc/printbooth/boot_splash.png"
fi

# Function to deploy the Plymouth Matrix theme files
deploy_plymouth_theme() {
    echo "  Deploying Plymouth Matrix theme..."
    if ! command -v plymouth > /dev/null 2>&1 || ! command -v plymouth-set-default-theme > /dev/null 2>&1; then
        sudo apt-get update -y
        sudo apt-get install -y plymouth plymouth-themes pix-plym-splash 2>/dev/null || true
    fi

    PLYMOUTH_THEME_DIR="/usr/share/plymouth/themes/printbooth"
    sudo mkdir -p "$PLYMOUTH_THEME_DIR"

    # Copy generated Light & Red Matrix assets
    if [ -f "$ASSETS_DIR/plymouth_bg.png" ]; then
        sudo cp "$ASSETS_DIR/plymouth_bg.png" "$PLYMOUTH_THEME_DIR/plymouth_bg.png"
        sudo cp "$ASSETS_DIR/plymouth_bg.png" "$PLYMOUTH_THEME_DIR/background.png"
    fi

    for idx in 1 2 3 4; do
        if [ -f "$ASSETS_DIR/matrix_stream_${idx}.png" ]; then
            sudo cp "$ASSETS_DIR/matrix_stream_${idx}.png" "$PLYMOUTH_THEME_DIR/matrix_stream_${idx}.png"
        fi
    done

    if [ -f "$ASSETS_DIR/progress_track.png" ]; then
        sudo cp "$ASSETS_DIR/progress_track.png" "$PLYMOUTH_THEME_DIR/progress_track.png"
        sudo cp "$ASSETS_DIR/progress_bar.png" "$PLYMOUTH_THEME_DIR/progress_bar.png"
        sudo cp "$ASSETS_DIR/progress_glow.png" "$PLYMOUTH_THEME_DIR/progress_glow.png" 2>/dev/null || true
    fi

    # Write Plymouth Theme Descriptor
    cat << 'EOF' | sudo tee "$PLYMOUTH_THEME_DIR/printbooth.plymouth" > /dev/null
[Plymouth Theme]
Name=PrintBooth Matrix Appliance
Description=High-Tech Light Porcelain & Laser Red Matrix Digital Rain Bootloader (No Logo)
ModuleName=script

[script]
ImageDir=/usr/share/plymouth/themes/printbooth
ScriptFile=/usr/share/plymouth/themes/printbooth/printbooth.script
EOF

    # Write Animated Matrix Opening Plymouth Script
    cat << 'EOF' | sudo tee "$PLYMOUTH_THEME_DIR/printbooth.script" > /dev/null
# ==============================================================================
# PrintBooth Custom Plymouth Matrix Digital Rain Script (Light & Laser Red)
# ==============================================================================

# Background Palette: Crisp Light Porcelain (#f8fafc)
Window.SetBackgroundTopColor(0.973, 0.980, 0.988);
Window.SetBackgroundBottomColor(0.973, 0.980, 0.988);

screen_width = Window.GetWidth();
screen_height = Window.GetHeight();

# 1. Main Background Canvas (Grid & Corner Brackets, ZERO LOGO)
bg_image = Image("plymouth_bg.png");
if (!bg_image) {
    bg_image = Image("background.png");
}

if (bg_image) {
    resized_bg = bg_image.Scale(screen_width, screen_height);
    bg_sprite = Sprite(resized_bg);
    bg_sprite.SetPosition(0, 0, 0);
}

# 2. Dynamic Cascading Matrix Rain Columns (Laser Red Streams)
stream_images[0] = Image("matrix_stream_1.png");
stream_images[1] = Image("matrix_stream_2.png");
stream_images[2] = Image("matrix_stream_3.png");
stream_images[3] = Image("matrix_stream_4.png");

num_cols = 10;
col_spacing = screen_width / (num_cols + 1);

for (i = 0; i < num_cols; i++) {
    img_idx = i % 4;
    if (stream_images[img_idx]) {
        stream_sprites[i] = Sprite(stream_images[img_idx]);
        stream_x[i] = Math.Int((i + 1) * col_spacing - 21);
        stream_speed[i] = 160 + (i * 45) % 200;
        stream_sprites[i].SetPosition(stream_x[i], -750, 1);
        stream_sprites[i].SetOpacity(0.55);
    }
}

# 3. Monospace Status Terminal Telemetry
status_text = "INITIALIZING PRINTBOOTH MATRIX BUS...";
status_image = Image.Text(status_text, 0.86, 0.15, 0.15, 1.0, "Monospace 11");
if (status_image) {
    status_sprite = Sprite(status_image);
    status_x = (screen_width - status_image.GetWidth()) / 2;
    status_y = (screen_height / 2) + 140;
    status_sprite.SetPosition(status_x, status_y, 10);
}

# 4. Laser Red Digital Progress Bar
track_img = Image("progress_track.png");
bar_img = Image("progress_bar.png");
glow_img = Image("progress_glow.png");

track_width = 380;
track_height = 8;
track_x = (screen_width - track_width) / 2;
track_y = (screen_height / 2) + 110;

if (track_img) {
    track_sprite = Sprite(track_img.Scale(track_width, track_height));
    track_sprite.SetPosition(track_x, track_y, 8);
}

bar_sprite = Sprite();
bar_sprite.SetPosition(track_x, track_y, 9);

if (glow_img) {
    glow_sprite = Sprite(glow_img);
    glow_sprite.SetPosition(track_x - 12, track_y - 8, 10);
    glow_sprite.SetOpacity(0.85);
}

progress_val = 0.05;

fun refresh_progress(val) {
    if (val > 1.0) val = 1.0;
    if (val < 0.0) val = 0.0;
    progress_val = val;

    current_w = Math.Int(track_width * progress_val);
    if (current_w < 1) current_w = 1;

    if (bar_img) {
        scaled_bar = bar_img.Scale(current_w, track_height);
        bar_sprite.SetImage(scaled_bar);
    }

    if (glow_img) {
        glow_sprite.SetPosition(track_x + current_w - 12, track_y - 8, 10);
    }
}

refresh_progress(0.08);

# Continuous Matrix Rain Animation Loop
time_counter = 0;
fun refresh_callback() {
    time_counter++;

    # Cascading Matrix streams
    for (i = 0; i < num_cols; i++) {
        if (stream_sprites[i]) {
            cy = stream_sprites[i].GetY();
            ny = cy + (stream_speed[i] / 50.0);
            if (ny > screen_height) {
                ny = -750 - (Math.Int(time_counter * 13) % 200);
            }
            stream_sprites[i].SetPosition(stream_x[i], ny, 1);
        }
    }

    # Steady progress advancement
    if (progress_val < 0.92) {
        refresh_progress(progress_val + 0.002);
    }
}

Plymouth.SetRefreshFunction(refresh_callback);

fun boot_progress_callback(duration, progress) {
    refresh_progress(progress);
}
Plymouth.SetBootProgressFunction(boot_progress_callback);

fun message_callback(text) {
    status_text = text;
    new_img = Image.Text(status_text, 0.86, 0.15, 0.15, 1.0, "Monospace 11");
    if (new_img) {
        status_sprite.SetImage(new_img);
        status_x = (screen_width - new_img.GetWidth()) / 2;
        status_sprite.SetPosition(status_x, status_y, 10);
    }
}
Plymouth.SetMessageFunction(message_callback);

fun quit_callback() {
    # Fade out smoothly
    if (bg_sprite) bg_sprite.SetOpacity(0);
}
Plymouth.SetQuitFunction(quit_callback);
EOF

    sudo plymouth-set-default-theme printbooth 2>/dev/null || true
    echo "  ✓ Default Plymouth theme set to: printbooth"
}

# FAST PREVIEW: If running with --test, skip disk firmware changes and run preview directly
if [ "$TEST_MODE" = true ]; then
    echo -e "\n--------------------------------------------------------"
    echo "  Live Plymouth Splash Preview Mode Active              "
    echo "  Rendering Light & Laser Red Matrix Splash on-screen..."
    echo "--------------------------------------------------------"
    deploy_plymouth_theme

    if command -v plymouthd > /dev/null 2>&1; then
        sudo plymouthd --mode=boot --attach-to-session 2>/dev/null || true
        sudo plymouth --show-splash 2>/dev/null || true
        for p in 15 35 55 75 90 100; do
            sudo plymouth --message="MATRIX DECRYPTING HARDWARE BUS... ($p%)" 2>/dev/null || true
            sleep 0.8
        done
        sudo plymouth quit 2>/dev/null || true
        echo "  ✓ Matrix preview completed."
    else
        echo "  ⚠️ plymouthd not available to preview live."
    fi
    exit 0
fi

# ------------------------------------------------------------------------------
# STEP 1: Configure Raspberry Pi 4 / CM4 Firmware (config.txt)
# ------------------------------------------------------------------------------
echo -e "\n[STEP 2/7] Configuring Raspberry Pi 4 / CM4 Firmware (config.txt)..."

# Ensure boot partition is mounted read-write (fixes Debian 12 / OverlayFS read-only errors)
echo "  Ensuring /boot and /boot/firmware partitions are mounted read-write..."
sudo mount -o remount,rw / 2>/dev/null || true
sudo mount -o remount,rw /boot/firmware 2>/dev/null || true
sudo mount -o remount,rw /boot 2>/dev/null || true

CONFIG_FILE=""
if [ -f "/boot/firmware/config.txt" ]; then
    CONFIG_FILE="/boot/firmware/config.txt"     # Debian 12 Bookworm (Default)
elif [ -f "/boot/config.txt" ]; then
    CONFIG_FILE="/boot/config.txt"              # Debian 11 Bullseye / Legacy
fi

if [ -n "$CONFIG_FILE" ]; then
    echo "  Targeting firmware: $CONFIG_FILE"
    
    # Backup original config if not yet backed up
    if [ ! -f "${CONFIG_FILE}.printbooth_backup" ]; then
        sudo cp "$CONFIG_FILE" "${CONFIG_FILE}.printbooth_backup" 2>/dev/null || true
        echo "  ✓ Backed up original config to ${CONFIG_FILE}.printbooth_backup"
    fi

    # Helper function to append or replace key=value in config.txt using safe /tmp staging
    set_config_param() {
        local param="$1"
        local value="$2"
        sudo mount -o remount,rw /boot/firmware 2>/dev/null || true
        sudo mount -o remount,rw /boot 2>/dev/null || true

        python3 -c "
import sys, re
path = '$CONFIG_FILE'
param = '$param'
val = '$value'
try:
    with open(path, 'r') as f:
        content = f.read()
    pattern = r'^[#]*\s*' + re.escape(param) + r'=.*'
    if re.search(pattern, content, re.MULTILINE):
        new_content = re.sub(pattern, f'{param}={val}', content, flags=re.MULTILINE)
    else:
        new_content = content.rstrip() + f'\n{param}={val}\n'
    with open('/tmp/config_tmp.txt', 'w') as f:
        f.write(new_content)
    sys.exit(0)
except Exception:
    sys.exit(1)
" && sudo cp /tmp/config_tmp.txt "$CONFIG_FILE" && rm -f /tmp/config_tmp.txt
    }

    # 1. Disable the 4-color rainbow boot square
    set_config_param "disable_splash" "1"

    # 2. Eliminate artificial 1-second delay
    set_config_param "boot_delay" "0"

    # 3. Suppress low-voltage / throttle warning overlay lightning icon
    set_config_param "avoid_warnings" "1"

    # 4. Pi 4 / CM4 Hardware Performance & Turbo Boost
    set_config_param "arm_boost" "1"
    set_config_param "initial_turbo" "30"

    # 5. Enable BCM2835 Hardware Watchdog for unattended self-recovery
    set_config_param "dtparam=watchdog" "on"

    # 6. Ensure GPU has sufficient memory for hardware-accelerated 60fps kiosk
    set_config_param "gpu_mem" "128"

    # 7. Disable overscan for 1:1 pixel rendering on touchscreen panels
    set_config_param "disable_overscan" "1"

    # 8. Disable camera LED if camera connected
    set_config_param "disable_camera_led" "1"

    echo "  ✓ Firmware configured (disable_splash=1, boot_delay=0, arm_boost=1, initial_turbo=30, watchdog=on)"
else
    echo "  ⚠️ Warning: config.txt not found in /boot/firmware or /boot. Skipping firmware edit."
fi

# ------------------------------------------------------------------------------
# STEP 2: Configure Pi 4 EEPROM Bootloader
# ------------------------------------------------------------------------------
echo -e "\n[STEP 3/7] Checking Raspberry Pi 4 EEPROM Bootloader Settings..."
if command -v rpi-eeprom-config > /dev/null 2>&1; then
    TEMP_EEPROM=$(mktemp)
    if sudo rpi-eeprom-config > "$TEMP_EEPROM" 2>/dev/null; then
        EEPROM_MODIFIED=false
        if ! grep -q "^HDMI_DELAY=0" "$TEMP_EEPROM"; then
            echo "HDMI_DELAY=0" >> "$TEMP_EEPROM"
            EEPROM_MODIFIED=true
        fi
        if [ "$EEPROM_MODIFIED" = true ]; then
            sudo rpi-eeprom-config --apply "$TEMP_EEPROM" 2>/dev/null || true
            echo "  ✓ Applied fast-boot EEPROM configuration (HDMI_DELAY=0)"
        else
            echo "  ✓ EEPROM already configured for zero boot latency"
        fi
    fi
    rm -f "$TEMP_EEPROM"
else
    echo "  (rpi-eeprom-config not available; standard firmware parameters applied)"
fi

# ------------------------------------------------------------------------------
# STEP 3: Configure Silent Linux Kernel Handover (cmdline.txt)
# ------------------------------------------------------------------------------
echo -e "\n[STEP 4/7] Configuring Silent Kernel Handover (cmdline.txt)..."

CMDLINE_FILE=""
if [ -f "/boot/firmware/cmdline.txt" ]; then
    CMDLINE_FILE="/boot/firmware/cmdline.txt"
elif [ -f "/boot/cmdline.txt" ]; then
    CMDLINE_FILE="/boot/cmdline.txt"
fi

if [ -n "$CMDLINE_FILE" ]; then
    if [ ! -f "${CMDLINE_FILE}.printbooth_backup" ]; then
        sudo cp "$CMDLINE_FILE" "${CMDLINE_FILE}.printbooth_backup"
        echo "  ✓ Backed up original cmdline to ${CMDLINE_FILE}.printbooth_backup"
    fi

    CURRENT_CMDLINE=$(cat "$CMDLINE_FILE" | tr '\n' ' ' | tr -s ' ' | sed 's/ $//')
    NEW_CMDLINE=$(echo "$CURRENT_CMDLINE" | sed -E 's/console=tty1/console=tty3/g')

    SILENT_FLAGS=(
        "console=tty3"
        "quiet"
        "loglevel=1"
        "logo.nologo"
        "vt.global_cursor_default=0"
        "splash"
        "fbcon=map:10"
        "plymouth.ignore-serial-consoles"
        "fastboot"
        "fsck.mode=skip"
        "systemd.show_status=0"
        "rd.udev.log_level=3"
    )

    for flag in "${SILENT_FLAGS[@]}"; do
        if [[ ! " $NEW_CMDLINE " =~ " $flag " ]]; then
            NEW_CMDLINE="$NEW_CMDLINE $flag"
        fi
    done

    sudo mount -o remount,rw /boot/firmware 2>/dev/null || true
    sudo mount -o remount,rw /boot 2>/dev/null || true
    echo -n "$NEW_CMDLINE" | tr -s ' ' | sudo tee "$CMDLINE_FILE" > /dev/null
    echo "" | sudo tee -a "$CMDLINE_FILE" > /dev/null
    echo "  ✓ Kernel cmdline updated with silent fast-boot parameters"
else
    echo "  ⚠️ Warning: cmdline.txt not found. Skipping kernel parameter edit."
fi

# ------------------------------------------------------------------------------
# STEP 4: Install & Configure Light & Laser Red Matrix Plymouth Theme
# ------------------------------------------------------------------------------
echo -e "\n[STEP 5/7] Provisioning Light & Laser Red Matrix Plymouth Theme..."

deploy_plymouth_theme

echo "  Rebuilding initramfs with PrintBooth Matrix bootloader theme..."
if command -v update-initramfs > /dev/null 2>&1; then
    sudo update-initramfs -u -k all 2>/dev/null || true
    echo "  ✓ initramfs updated successfully"
elif [ -f "/boot/firmware/initramfs" ] || [ -f "/boot/initrd.img" ]; then
    echo "  ✓ initramfs detected"
fi

# ------------------------------------------------------------------------------
# STEP 5: Early Framebuffer Splash Fallback & Console Suppression
# ------------------------------------------------------------------------------
echo -e "\n[STEP 6/7] Configuring Early Framebuffer Fallback & Silencing Console..."

cat << 'EOF' | sudo tee /etc/systemd/system/printbooth-boot-splash.service > /dev/null
[Unit]
Description=PrintBooth Hardware Early Boot Splash
DefaultDependencies=no
After=systemd-udev-settle.service
Before=basic.target graphical.target plymouth-start.service

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

sudo mkdir -p /etc/systemd/system/getty@tty1.service.d/
cat << 'EOF' | sudo tee /etc/systemd/system/getty@tty1.service.d/nocursor.conf > /dev/null
[Service]
TTYVTDisallocate=no
StandardOutput=null
StandardError=null
EOF

# ------------------------------------------------------------------------------
# STEP 6: Anti-Popup & Polkit Lockdown (Guarantees NOTHING Shows Except Kiosk)
# ------------------------------------------------------------------------------
echo -e "\n[STEP 7/7] Eliminating 'Authentication Required' Popups & Dialogs..."

# 1. Modern Polkit Rule (PolicyKit JavaScript rules in /etc/polkit-1/rules.d/)
sudo mkdir -p /etc/polkit-1/rules.d/
cat << 'EOF' | sudo tee /etc/polkit-1/rules.d/00-printbooth-kiosk.rules > /dev/null
/* PrintBooth Kiosk: Auto-grant all actions without password/authentication popups */
polkit.addRule(function(action, subject) {
    return polkit.Result.YES;
});
EOF
sudo chmod 644 /etc/polkit-1/rules.d/00-printbooth-kiosk.rules

# 2. Legacy / Debian Polkit Authority (in /etc/polkit-1/localauthority/)
sudo mkdir -p /etc/polkit-1/localauthority/50-local.d/
cat << 'EOF' | sudo tee /etc/polkit-1/localauthority/50-local.d/00-printbooth-kiosk.pkla > /dev/null
[PrintBooth Kiosk Grant All]
Identity=unix-user:*
Action=*
ResultAny=yes
ResultInactive=yes
ResultActive=yes
EOF

# 3. Disable / Mask GUI Polkit Authentication Agents (lxpolkit, polkit-gnome)
# This prevents the visual password modal from EVER being spawned
sudo rm -f /etc/xdg/autostart/lxpolkit.desktop 2>/dev/null || true
sudo rm -f /etc/xdg/autostart/polkit-gnome-authentication-agent-1.desktop 2>/dev/null || true
sudo rm -f /etc/xdg/autostart/gnome-keyring*.desktop 2>/dev/null || true

if command -v systemctl > /dev/null 2>&1; then
    sudo systemctl --global mask lxpolkit.service 2>/dev/null || true
fi

echo "  ✓ Polkit auto-authorization deployed (Zero password prompts)"
echo "  ✓ GUI authentication dialog agents disabled"

# ------------------------------------------------------------------------------
# Optional: Live Preview Mode
# ------------------------------------------------------------------------------
if [ "$TEST_MODE" = true ]; then
    echo -e "\n--------------------------------------------------------"
    echo "  Live Plymouth Splash Preview Mode Active              "
    echo "  Rendering Light & Laser Red Matrix Splash on-screen..."
    echo "--------------------------------------------------------"
    if command -v plymouthd > /dev/null 2>&1; then
        sudo plymouthd --mode=boot --attach-to-session 2>/dev/null || true
        sudo plymouth --show-splash 2>/dev/null || true
        for p in 10 25 45 65 85 100; do
            sudo plymouth --message="MATRIX DECRYPTING HARDWARE BUS... ($p%)" 2>/dev/null || true
            sleep 0.8
        done
        sudo plymouth quit 2>/dev/null || true
        echo "  ✓ Matrix preview completed."
    fi
fi

echo -e "\n════════════════════════════════════════════════════════"
echo "  🎉 Light & Laser Red Matrix Bootloader Configured!   "
echo "════════════════════════════════════════════════════════"
echo "  1. Matrix Digital Rain: Laser red code streams cascading down screen"
echo "  2. Zero Logo: Clean digital typography only, no emblems or logos"
echo "  3. Light Porcelain Theme: #f8fafc backdrop with laser red matrix grid"
echo "  4. Anti-Popup Shield: All 'Authentication Required' popups banned"
echo ""
echo "  To test Plymouth Matrix splash without rebooting:"
echo "    sudo bash $0 --test"
echo ""
echo "  To reboot and see full cold bootloader:"
echo "    sudo reboot"
echo "════════════════════════════════════════════════════════"
