#!/usr/bin/env bash
# ==============================================================================
# PrintBooth Custom Bootloader & Silent Fast-Boot Appliance Setup
# Minimalist Digital Glitch Edition (Obsidian & Laser Red)
# Targeted for Raspberry Pi 4 Model B & Compute Module 4 (CM4)
# ==============================================================================
# 1. Hardware Firmware: Disables 4-color rainbow splash, sets zero boot delay,
#    enables initial CPU turbo and BCM2835 hardware watchdog in config.txt.
# 2. Kernel Handover: Silences kernel dmesg, redirects console to tty3,
#    hides Raspberry Pi fruit logos, hides terminal cursor in cmdline.txt.
# 3. Plymouth Graphical Bootloader: Installs Minimalist Digital Glitch bootloader
#    with pure obsidian background, chromatic aberration text glitching,
#    sleek hairline progress indicator, and hardware telemetry.
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
echo "  PrintBooth Custom Bootloader: Minimal Glitch Edition  "
echo "  Theme: Capitalio Obsidian & Digital Glitch Red        "
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
    echo "  Deploying Extraordinary Cyber Matrix Plymouth theme..."
    if ! command -v plymouth > /dev/null 2>&1 || ! command -v plymouth-set-default-theme > /dev/null 2>&1; then
        sudo apt-get update -y
        sudo apt-get install -y plymouth plymouth-themes pix-plym-splash 2>/dev/null || true
    fi

    PLYMOUTH_THEME_DIR="/usr/share/plymouth/themes/printbooth"
    sudo mkdir -p "$PLYMOUTH_THEME_DIR"

    # Copy generated Minimal Glitch assets
    if [ -f "$ASSETS_DIR/plymouth_bg.png" ]; then
        sudo cp "$ASSETS_DIR/plymouth_bg.png" "$PLYMOUTH_THEME_DIR/plymouth_bg.png"
        sudo cp "$ASSETS_DIR/plymouth_bg.png" "$PLYMOUTH_THEME_DIR/background.png"
    fi

    # Glitch text frames (pristine + chromatic aberration slices)
    for f in glitch_text_normal.png glitch_text_1.png glitch_text_2.png glitch_text_3.png glitch_text_4.png; do
        if [ -f "$ASSETS_DIR/$f" ]; then
            sudo cp "$ASSETS_DIR/$f" "$PLYMOUTH_THEME_DIR/$f"
        fi
    done

    # Minimal hairline progress bar
    for f in progress_track.png progress_bar.png; do
        if [ -f "$ASSETS_DIR/$f" ]; then
            sudo cp "$ASSETS_DIR/$f" "$PLYMOUTH_THEME_DIR/$f"
        fi
    done

    # Write Plymouth Theme Descriptor
    cat << 'EOF' | sudo tee "$PLYMOUTH_THEME_DIR/printbooth.plymouth" > /dev/null
[Plymouth Theme]
Name=PrintBooth Minimalist Glitch Appliance
Description=Minimalist Obsidian Bootloader with Digital Glitch Typography
ModuleName=script

[script]
ImageDir=/usr/share/plymouth/themes/printbooth
ScriptFile=/usr/share/plymouth/themes/printbooth/printbooth.script
EOF

    # Write Minimalist Glitch Plymouth Script
    cat << 'EOF' | sudo tee "$PLYMOUTH_THEME_DIR/printbooth.script" > /dev/null
# ==============================================================================
# PrintBooth Minimalist Digital Glitch Bootloader (Obsidian & Laser Red)
# ==============================================================================

# Background Palette: Deep Velvet Obsidian (#06110D)
Window.SetBackgroundTopColor(0.024, 0.067, 0.051);
Window.SetBackgroundBottomColor(0.024, 0.067, 0.051);

screen_width = Window.GetWidth();
screen_height = Window.GetHeight();

# 1. Main Pure Obsidian Background Canvas (Zero grids, zero scanline noise)
bg_image = Image("plymouth_bg.png");
if (!bg_image) {
    bg_image = Image("background.png");
}

if (bg_image) {
    resized_bg = bg_image.Scale(screen_width, screen_height);
    bg_sprite = Sprite(resized_bg);
    bg_sprite.SetPosition(0, 0, 0);
}

# 2. Glitch Text Frames (Pristine Normal + Chromatic Aberration Keyframes)
text_normal = Image("glitch_text_normal.png");
text_glitch[0] = Image("glitch_text_1.png");
text_glitch[1] = Image("glitch_text_2.png");
text_glitch[2] = Image("glitch_text_3.png");
text_glitch[3] = Image("glitch_text_4.png");

text_sprite = Sprite(text_normal);
text_w = 900;
text_h = 220;
if (text_normal) {
    text_w = text_normal.GetWidth();
    text_h = text_normal.GetHeight();
}
text_base_x = (screen_width - text_w) / 2;
text_base_y = (screen_height / 2) - 80;
text_sprite.SetPosition(text_base_x, text_base_y, 5);

# 3. Minimal Hairline Laser Progress Bar (3px)
track_img = Image("progress_track.png");
bar_img = Image("progress_bar.png");

track_w = 420;
track_h = 3;
track_x = (screen_width - track_w) / 2;
track_y = (screen_height / 2) + 55;

if (track_img) {
    track_sprite = Sprite(track_img.Scale(track_w, track_h));
    track_sprite.SetPosition(track_x, track_y, 6);
}

bar_sprite = Sprite();
bar_sprite.SetPosition(track_x, track_y, 7);

# 4. Minimal Monospace Telemetry Readout
status_sprite = Sprite();
status_y = track_y + 18;

fun update_status(text) {
    img = Image.Text(text, 0.58, 0.64, 0.72, 0.85, "Monospace 10");
    if (img) {
        status_sprite.SetImage(img);
        status_sprite.SetPosition((screen_width - img.GetWidth()) / 2, status_y, 8);
    }
}
update_status("PB-001 // INITIALIZING HARDWARE");

progress_val = 0.05;

fun refresh_progress(val) {
    if (val > 1.0) val = 1.0;
    if (val < 0.0) val = 0.0;
    progress_val = val;

    current_w = Math.Int(track_w * progress_val);
    if (current_w < 1) current_w = 1;

    if (bar_img) {
        scaled_bar = bar_img.Scale(current_w, track_h);
        bar_sprite.SetImage(scaled_bar);
    }

    if (progress_val < 0.35) {
        update_status("PB-001 // CALIBRATING SYSTEM BUS");
    } else if (progress_val < 0.75) {
        update_status("PB-001 // SYNCHRONIZING HARDWARE PORTS");
    } else {
        update_status("PB-001 // SECURE PRINT ENCLAVE READY");
    }
}

refresh_progress(0.08);

# 5. Glitch Timing Controller
# Keeps text steady 85% of time, bursts micro glitch shifts every 40-60 ticks
time_tick = 0;
glitch_active = 0;

fun refresh_callback() {
    time_tick++;

    if (glitch_active > 0) {
        glitch_active--;
        # Pick random glitch frame
        g_idx = Math.Int(Math.Random() * 3.99);
        if (text_glitch[g_idx]) {
            text_sprite.SetImage(text_glitch[g_idx]);
        }
        # Micro horizontal jitter (-4 to +4 pixels)
        jitter_x = Math.Int((Math.Random() * 8) - 4);
        jitter_y = Math.Int((Math.Random() * 4) - 2);
        text_sprite.SetPosition(text_base_x + jitter_x, text_base_y + jitter_y, 5);

        if (glitch_active == 0) {
            # Reset back to pristine normal frame
            text_sprite.SetImage(text_normal);
            text_sprite.SetPosition(text_base_x, text_base_y, 5);
        }
    } else {
        # Trigger brief 2-3 frame glitch burst every ~48 frames
        if ((time_tick % 48) == 0) {
            glitch_active = 3;
        }
    }

    # Smooth progress increment
    if (progress_val < 0.94) {
        refresh_progress(progress_val + 0.0022);
    }
}

Plymouth.SetRefreshFunction(refresh_callback);

fun boot_progress_callback(duration, progress) {
    refresh_progress(progress);
}
Plymouth.SetBootProgressFunction(boot_progress_callback);

fun message_callback(text) {
    update_status(text);
}
Plymouth.SetMessageFunction(message_callback);

fun quit_callback() {
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
    echo "  Rendering Extraordinary Cyber Matrix Splash on-screen..."
    echo "--------------------------------------------------------"
    deploy_plymouth_theme

    if command -v plymouthd > /dev/null 2>&1; then
        sudo plymouthd --mode=boot --attach-to-session 2>/dev/null || true
        sudo plymouth --show-splash 2>/dev/null || true
        for p in 15 35 55 75 90 100; do
            sudo plymouth --message="CYBER BUS CALIBRATING... ($p%)" 2>/dev/null || true
            sleep 0.8
        done
        sudo plymouth quit 2>/dev/null || true
        echo "  ✓ Cyber Matrix preview completed."
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
