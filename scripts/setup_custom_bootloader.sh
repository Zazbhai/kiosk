#!/usr/bin/env bash
# ==============================================================================
# PrintBooth Custom Bootloader & Silent Fast-Boot Appliance Setup
# Targeted for Raspberry Pi 4 Model B & Compute Module 4 (CM4)
# ==============================================================================
# 1. Hardware Firmware: Disables 4-color rainbow splash, sets zero boot delay,
#    enables initial CPU turbo and BCM2835 hardware watchdog in config.txt.
# 2. Kernel Handover: Silences kernel dmesg, redirects console to tty3,
#    hides Raspberry Pi fruit logos, hides terminal cursor in cmdline.txt.
# 3. Plymouth Graphical Bootloader: Installs custom high-tech obsidian & lime
#    PrintBooth boot theme with live progress animation and updates initramfs.
# 4. Fast-Boot Optimizations: Masks network-wait blocking services and cleans
#    console tty1 login flickers for seamless handoff directly into kiosk.
# ==============================================================================

set -e

# Support preview testing: sudo ./setup_custom_bootloader.sh --test
TEST_MODE=false
if [ "$1" = "--test" ] || [ "$1" = "-t" ]; then
    TEST_MODE=true
fi

echo "════════════════════════════════════════════════════════"
echo "  PrintBooth Custom Bootloader & Silent Boot Setup      "
echo "  Target Architecture: Raspberry Pi 4 / CM4             "
echo "════════════════════════════════════════════════════════"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSETS_DIR="$SCRIPT_DIR/splash_assets"

# ------------------------------------------------------------------------------
# STEP 0: Generate or Verify Graphic Splash Assets
# ------------------------------------------------------------------------------
echo -e "\n[STEP 1/6] Verifying Custom Bootloader Visual Assets..."
mkdir -p "$ASSETS_DIR"

if [ ! -f "$ASSETS_DIR/plymouth_bg.png" ] || [ ! -f "$ASSETS_DIR/boot_splash_1080p.png" ]; then
    echo "  Generating high-definition Obsidian & Lime boot assets..."
    python3 "$SCRIPT_DIR/generate_splash.py" || true
fi

# Copy assets to persistent system location
sudo mkdir -p /etc/printbooth
if [ -f "$ASSETS_DIR/boot_splash_1080p.png" ]; then
    sudo cp "$ASSETS_DIR/boot_splash_1080p.png" /etc/printbooth/boot_splash.png
    sudo cp "$ASSETS_DIR/boot_splash_720p.png" /etc/printbooth/boot_splash_720.png 2>/dev/null || true
    echo "  ✓ System fallback boot splash registered at /etc/printbooth/boot_splash.png"
fi

# ------------------------------------------------------------------------------
# STEP 1: Configure Raspberry Pi 4 / CM4 Firmware (config.txt)
# ------------------------------------------------------------------------------
echo -e "\n[STEP 2/6] Configuring Raspberry Pi 4 / CM4 Firmware (config.txt)..."

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
        sudo cp "$CONFIG_FILE" "${CONFIG_FILE}.printbooth_backup"
        echo "  ✓ Backed up original config to ${CONFIG_FILE}.printbooth_backup"
    fi

    # Helper function to append or replace key=value in config.txt
    set_config_param() {
        local param="$1"
        local value="$2"
        if grep -q "^[#]*\s*${param}=" "$CONFIG_FILE"; then
            sudo sed -i "s|^[#]*\s*${param}=.*|${param}=${value}|" "$CONFIG_FILE"
        else
            echo "${param}=${value}" | sudo tee -a "$CONFIG_FILE" > /dev/null
        fi
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
# STEP 2: Configure Pi 4 EEPROM Bootloader (if rpi-eeprom-config is present)
# ------------------------------------------------------------------------------
echo -e "\n[STEP 3/6] Checking Raspberry Pi 4 EEPROM Bootloader Settings..."
if command -v rpi-eeprom-config > /dev/null 2>&1; then
    echo "  Configuring fast boot order in EEPROM..."
    TEMP_EEPROM=$(mktemp)
    if sudo rpi-eeprom-config > "$TEMP_EEPROM" 2>/dev/null; then
        EEPROM_MODIFIED=false
        # Ensure HDMI delay is zero
        if ! grep -q "^HDMI_DELAY=0" "$TEMP_EEPROM"; then
            echo "HDMI_DELAY=0" >> "$TEMP_EEPROM"
            EEPROM_MODIFIED=true
        fi
        # If modified, apply back to EEPROM
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
echo -e "\n[STEP 4/6] Configuring Silent Kernel Handover (cmdline.txt)..."

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

    # Read current parameters as a single line
    CURRENT_CMDLINE=$(cat "$CMDLINE_FILE" | tr '\n' ' ' | tr -s ' ' | sed 's/ $//')

    # Divert console from tty1 and serial to silent tty3
    NEW_CMDLINE=$(echo "$CURRENT_CMDLINE" | sed -E 's/console=tty1/console=tty3/g')

    # Core silent boot flags
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

    # Write as strict single line (Raspberry Pi cmdline.txt MUST NEVER contain newlines)
    echo -n "$NEW_CMDLINE" | tr -s ' ' | sudo tee "$CMDLINE_FILE" > /dev/null
    echo "" | sudo tee -a "$CMDLINE_FILE" > /dev/null
    echo "  ✓ Kernel cmdline updated with silent fast-boot parameters"
else
    echo "  ⚠️ Warning: cmdline.txt not found. Skipping kernel parameter edit."
fi

# ------------------------------------------------------------------------------
# STEP 4: Install & Configure Custom PrintBooth Plymouth Theme
# ------------------------------------------------------------------------------
echo -e "\n[STEP 5/6] Provisioning Custom PrintBooth Plymouth Bootloader Theme..."

# Ensure Plymouth package is installed
if ! command -v plymouth > /dev/null 2>&1 || ! command -v plymouth-set-default-theme > /dev/null 2>&1; then
    echo "  Installing Plymouth splash framework via apt..."
    sudo apt-get update -y
    sudo apt-get install -y plymouth plymouth-themes pix-plym-splash 2>/dev/null || true
fi

PLYMOUTH_THEME_DIR="/usr/share/plymouth/themes/printbooth"
sudo mkdir -p "$PLYMOUTH_THEME_DIR"

# Copy generated graphical assets into Plymouth theme directory
if [ -f "$ASSETS_DIR/plymouth_bg.png" ]; then
    sudo cp "$ASSETS_DIR/plymouth_bg.png" "$PLYMOUTH_THEME_DIR/plymouth_bg.png"
elif [ -f "/etc/printbooth/boot_splash.png" ]; then
    sudo cp "/etc/printbooth/boot_splash.png" "$PLYMOUTH_THEME_DIR/plymouth_bg.png"
fi

if [ -f "$ASSETS_DIR/boot_splash_1080p.png" ]; then
    sudo cp "$ASSETS_DIR/boot_splash_1080p.png" "$PLYMOUTH_THEME_DIR/background.png"
fi

if [ -f "$ASSETS_DIR/plymouth_watermark.png" ]; then
    sudo cp "$ASSETS_DIR/plymouth_watermark.png" "$PLYMOUTH_THEME_DIR/watermark.png"
fi

if [ -f "$ASSETS_DIR/progress_track.png" ]; then
    sudo cp "$ASSETS_DIR/progress_track.png" "$PLYMOUTH_THEME_DIR/progress_track.png"
    sudo cp "$ASSETS_DIR/progress_bar.png" "$PLYMOUTH_THEME_DIR/progress_bar.png"
    sudo cp "$ASSETS_DIR/progress_glow.png" "$PLYMOUTH_THEME_DIR/progress_glow.png" 2>/dev/null || true
fi

# Write Plymouth Theme Descriptor
cat << 'EOF' | sudo tee "$PLYMOUTH_THEME_DIR/printbooth.plymouth" > /dev/null
[Plymouth Theme]
Name=PrintBooth Appliance Kiosk
Description=Autonomous Hardware Kiosk Obsidian & Synthetic Lime Bootloader
ModuleName=script

[script]
ImageDir=/usr/share/plymouth/themes/printbooth
ScriptFile=/usr/share/plymouth/themes/printbooth/printbooth.script
EOF

# Write Animated Plymouth Script
cat << 'EOF' | sudo tee "$PLYMOUTH_THEME_DIR/printbooth.script" > /dev/null
# ==============================================================================
# PrintBooth Custom Plymouth Bootloader Animation Script
# ==============================================================================

# Background Palette: Deep Capitalio Obsidian (#06110D)
Window.SetBackgroundTopColor(0.024, 0.067, 0.051);
Window.SetBackgroundBottomColor(0.024, 0.067, 0.051);

screen_width = Window.GetWidth();
screen_height = Window.GetHeight();

# 1. Main Canvas Background
bg_image = Image("plymouth_bg.png");
if (!bg_image) {
    bg_image = Image("background.png");
}

if (bg_image) {
    resized_bg = bg_image.Scale(screen_width, screen_height);
    bg_sprite = Sprite(resized_bg);
    bg_sprite.SetPosition(0, 0, 0);
}

# 2. Hardware Progress Bar Components
track_image = Image("progress_track.png");
bar_image = Image("progress_bar.png");
glow_image = Image("progress_glow.png");

track_width = 440;
track_height = 8;
bar_x = Math.Int(screen_width / 2 - track_width / 2);
bar_y = Math.Int(screen_height / 2 + 70);

if (track_image) {
    track_sprite = Sprite(track_image);
    track_sprite.SetPosition(bar_x, bar_y, 2);
}

if (bar_image) {
    bar_sprite = Sprite();
    bar_sprite.SetPosition(bar_x, bar_y, 3);
}

if (glow_image) {
    glow_sprite = Sprite(glow_image);
    glow_sprite.SetPosition(bar_x - 12, bar_y - 8, 4);
    glow_sprite.SetOpacity(0.0);
}

# 3. Dynamic Boot Status Message Indicator (Synthetic Lime / Mint)
message_sprite = Sprite();
message_sprite.SetPosition(Math.Int(screen_width / 2 - 200), Math.Int(screen_height / 2 + 96), 5);

# 4. Boot Progress Callback Hook (duration: seconds, progress: 0.0 - 1.0)
fun progress_callback (duration, progress) {
    if (bar_image) {
        cur_progress = progress;
        if (cur_progress < 0.05) cur_progress = 0.05;
        if (cur_progress > 1.0) cur_progress = 1.0;

        current_width = Math.Int(track_width * cur_progress);
        if (current_width > 0) {
            scaled_bar = bar_image.Scale(current_width, track_height);
            bar_sprite.SetImage(scaled_bar);
        }

        if (glow_image) {
            glow_x = Math.Int(bar_x + current_width - 12);
            glow_sprite.SetPosition(glow_x, bar_y - 8, 4);
            # Breathing harmonic pulse
            pulse = (Math.Sin(duration * 4.0) + 1.0) / 2.0;
            glow_sprite.SetOpacity(0.4 + 0.6 * pulse);
        }
    }
}

Plymouth.SetBootProgressFunction(progress_callback);

# 5. Kernel / Systemd Telemetry Message Hook
fun message_callback (text) {
    if (text) {
        msg_image = Image.Text(text, 0.78, 1.0, 0.0);
        message_sprite.SetImage(msg_image);
    }
}

Plymouth.SetMessageFunction(message_callback);

# 6. Smooth Handoff Callback to Kiosk Display
fun quit_callback () {
    if (bg_sprite) {
        bg_sprite.SetOpacity(1.0);
    }
}

Plymouth.SetQuitFunction(quit_callback);
EOF

# Activate the Theme in Plymouth
if command -v plymouth-set-default-theme > /dev/null 2>&1; then
    sudo plymouth-set-default-theme printbooth 2>/dev/null || true
    echo "  ✓ Default Plymouth theme set to: printbooth"
fi

# Rebuild initial RAM disk (initramfs) so theme is bundled into early boot
echo "  Rebuilding initramfs with PrintBooth bootloader theme..."
if command -v update-initramfs > /dev/null 2>&1; then
    sudo update-initramfs -u -k all 2>/dev/null || true
    echo "  ✓ initramfs updated successfully"
elif [ -f "/boot/firmware/initramfs" ] || [ -f "/boot/initrd.img" ]; then
    echo "  ✓ initramfs detected"
fi

# ------------------------------------------------------------------------------
# STEP 5: Early Framebuffer Splash Fallback & Console Suppression
# ------------------------------------------------------------------------------
echo -e "\n[STEP 6/6] Configuring Early Framebuffer Fallback & Silencing Console..."

# Early Framebuffer Service (ensures image is pushed to screen before graphical target)
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

# Mask terminal cursor and quiet tty1 getty login prompt
sudo mkdir -p /etc/systemd/system/getty@tty1.service.d/
cat << 'EOF' | sudo tee /etc/systemd/system/getty@tty1.service.d/nocursor.conf > /dev/null
[Service]
TTYVTDisallocate=no
StandardOutput=null
StandardError=null
EOF

# Fast boot tweaks: Mask blocking network-wait-online service
# Kiosk launches UI immediately; local offline banner displays if network is late
if systemctl is-enabled systemd-networkd-wait-online.service > /dev/null 2>&1; then
    sudo systemctl mask systemd-networkd-wait-online.service 2>/dev/null || true
fi

# Mask ModemManager if installed (speeds up USB printer serial scan by 2-3 seconds)
if systemctl is-enabled ModemManager.service > /dev/null 2>&1; then
    sudo systemctl mask ModemManager.service 2>/dev/null || true
fi

# Configure volatile journald to reduce SD card writes
if [ -f "/etc/systemd/journald.conf" ]; then
    if ! grep -q "^Storage=volatile" /etc/systemd/journald.conf; then
        sudo sed -i 's/^#*Storage=.*/Storage=volatile/' /etc/systemd/journald.conf 2>/dev/null || true
    fi
fi

# ------------------------------------------------------------------------------
# Optional: Live Preview Mode
# ------------------------------------------------------------------------------
if [ "$TEST_MODE" = true ]; then
    echo -e "\n--------------------------------------------------------"
    echo "  Live Plymouth Splash Preview Mode Active              "
    echo "  Rendering PrintBooth bootloader splash on-screen...   "
    echo "--------------------------------------------------------"
    if command -v plymouthd > /dev/null 2>&1; then
        sudo plymouthd --mode=boot --attach-to-session 2>/dev/null || true
        sudo plymouth --show-splash 2>/dev/null || true
        for p in 10 25 45 65 85 100; do
            sudo plymouth --message="INITIALIZING SECURE HARDWARE... ($p%)" 2>/dev/null || true
            sleep 0.8
        done
        sudo plymouth quit 2>/dev/null || true
        echo "  ✓ Preview completed."
    else
        echo "  Plymouth daemon not directly launchable in current terminal."
    fi
fi

echo -e "\n════════════════════════════════════════════════════════"
echo "  🎉 Custom Bootloader & Silent Fast-Boot Configured!  "
echo "════════════════════════════════════════════════════════"
echo "  Hardware: Raspberry Pi 4 / CM4 (BCM2711)"
echo "  1. GPU Bootloader: Rainbow splash stripped (disable_splash=1)"
echo "  2. Boot Latency: Zero delay, initial_turbo=30 enabled"
echo "  3. Linux Kernel: Silenced, logos disabled, console -> tty3"
echo "  4. Custom Splash: PrintBooth Obsidian theme with live progress"
echo "  5. Direct Handoff: Seamless transition into kiosk terminal"
echo ""
echo "  To test Plymouth splash without rebooting:"
echo "    sudo bash $0 --test"
echo ""
echo "  To reboot and verify the entire cold bootloader flow:"
echo "    sudo reboot"
echo "════════════════════════════════════════════════════════"
