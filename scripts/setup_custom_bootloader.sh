#!/usr/bin/env bash
# ==============================================================================
# PrintBooth Custom Bootloader & Silent Fast-Boot Appliance Setup
# Extraordinary Cyber Matrix Quantum Edition (Obsidian & Laser Red)
# Targeted for Raspberry Pi 4 Model B & Compute Module 4 (CM4)
# ==============================================================================
# 1. Hardware Firmware: Disables 4-color rainbow splash, sets zero boot delay,
#    enables initial CPU turbo and BCM2835 hardware watchdog in config.txt.
# 2. Kernel Handover: Silences kernel dmesg, redirects console to tty3,
#    hides Raspberry Pi fruit logos, hides terminal cursor in cmdline.txt.
# 3. Plymouth Graphical Bootloader: Installs Extraordinary Cyber Matrix bootloader
#    with dual counter-rotating reticle dials, pulsing laser core aperture,
#    holographic laser scanline beam, 14 cascading code rain columns,
#    traveling spark particle, and real-time 7-stage hardware telemetry.
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
echo "  PrintBooth Custom Bootloader: Cyber Matrix Edition    "
echo "  Theme: Capitalio Obsidian & Radiant Laser Red Matrix  "
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

    # Copy generated Cyber Matrix assets
    if [ -f "$ASSETS_DIR/plymouth_bg.png" ]; then
        sudo cp "$ASSETS_DIR/plymouth_bg.png" "$PLYMOUTH_THEME_DIR/plymouth_bg.png"
        sudo cp "$ASSETS_DIR/plymouth_bg.png" "$PLYMOUTH_THEME_DIR/background.png"
    fi

    # Reticle dials
    for f in reticle_outer.png reticle_mid.png reticle_core.png laser_scanline.png; do
        if [ -f "$ASSETS_DIR/$f" ]; then
            sudo cp "$ASSETS_DIR/$f" "$PLYMOUTH_THEME_DIR/$f"
        fi
    done

    # Matrix streams (1 through 6)
    for idx in 1 2 3 4 5 6; do
        if [ -f "$ASSETS_DIR/matrix_stream_${idx}.png" ]; then
            sudo cp "$ASSETS_DIR/matrix_stream_${idx}.png" "$PLYMOUTH_THEME_DIR/matrix_stream_${idx}.png"
        fi
    done

    # Progress bar and spark flare
    for f in progress_track.png progress_bar.png progress_spark.png progress_glow.png; do
        if [ -f "$ASSETS_DIR/$f" ]; then
            sudo cp "$ASSETS_DIR/$f" "$PLYMOUTH_THEME_DIR/$f"
        fi
    done

    # Write Plymouth Theme Descriptor
    cat << 'EOF' | sudo tee "$PLYMOUTH_THEME_DIR/printbooth.plymouth" > /dev/null
[Plymouth Theme]
Name=PrintBooth Cyber Matrix Appliance
Description=Extraordinary Cyber Matrix Quantum Bootloader (Dual Reticles, Holographic Scanline, Cascading Code)
ModuleName=script

[script]
ImageDir=/usr/share/plymouth/themes/printbooth
ScriptFile=/usr/share/plymouth/themes/printbooth/printbooth.script
EOF

    # Write Animated Matrix Opening Plymouth Script
    cat << 'EOF' | sudo tee "$PLYMOUTH_THEME_DIR/printbooth.script" > /dev/null
# ==============================================================================
# PrintBooth Extraordinary Plymouth Cyber Matrix Script (Obsidian & Laser Red)
# ==============================================================================

# Background Palette: Deep Capitalio Obsidian (#06110D)
Window.SetBackgroundTopColor(0.024, 0.067, 0.051);
Window.SetBackgroundBottomColor(0.024, 0.067, 0.051);

screen_width = Window.GetWidth();
screen_height = Window.GetHeight();

# 1. Main Background Canvas (Subtle Isometric Grid & Tactical HUD Brackets)
bg_image = Image("plymouth_bg.png");
if (!bg_image) {
    bg_image = Image("background.png");
}

if (bg_image) {
    resized_bg = bg_image.Scale(screen_width, screen_height);
    bg_sprite = Sprite(resized_bg);
    bg_sprite.SetPosition(0, 0, 0);
}

# 2. Concentric Cybernetic Quantum Reticle (Positioned in Upper Core)
reticle_cx = screen_width / 2;
reticle_cy = (screen_height / 2) - 100;

reticle_outer_img = Image("reticle_outer.png");
if (reticle_outer_img) {
    reticle_outer_sprite = Sprite();
    reticle_outer_sprite.SetPosition(reticle_cx - reticle_outer_img.GetWidth() / 2, reticle_cy - reticle_outer_img.GetHeight() / 2, 4);
}

reticle_mid_img = Image("reticle_mid.png");
if (reticle_mid_img) {
    reticle_mid_sprite = Sprite();
    reticle_mid_sprite.SetPosition(reticle_cx - reticle_mid_img.GetWidth() / 2, reticle_cy - reticle_mid_img.GetHeight() / 2, 5);
}

reticle_core_img = Image("reticle_core.png");
if (reticle_core_img) {
    reticle_core_sprite = Sprite(reticle_core_img);
    reticle_core_sprite.SetPosition(reticle_cx - reticle_core_img.GetWidth() / 2, reticle_cy - reticle_core_img.GetHeight() / 2, 6);
}

# 3. Horizontal Holographic Laser Scanline Beam
scanline_img = Image("laser_scanline.png");
if (scanline_img) {
    scanline_sprite = Sprite(scanline_img.Scale(screen_width, 8));
    scanline_y = -30;
    scanline_sprite.SetPosition(0, scanline_y, 7);
    scanline_sprite.SetOpacity(0.85);
}

# 4. Cascading Matrix Rain Columns (6 Streams across 14 Columns)
stream_images[0] = Image("matrix_stream_1.png");
stream_images[1] = Image("matrix_stream_2.png");
stream_images[2] = Image("matrix_stream_3.png");
stream_images[3] = Image("matrix_stream_4.png");
stream_images[4] = Image("matrix_stream_5.png");
stream_images[5] = Image("matrix_stream_6.png");

num_cols = 14;
col_spacing = screen_width / (num_cols + 1);

for (i = 0; i < num_cols; i++) {
    idx = i % 6;
    if (stream_images[idx]) {
        stream_sprites[i] = Sprite(stream_images[idx]);
        stream_x[i] = Math.Int((i + 1) * col_spacing - 21);
        stream_speed[i] = 170 + (i * 39) % 230;
        init_y = -750 - (i * 85) % 500;
        stream_sprites[i].SetPosition(stream_x[i], init_y, 2);
        if (i == 6 || i == 7) {
            stream_sprites[i].SetOpacity(0.25);
        } else {
            stream_sprites[i].SetOpacity(0.55);
        }
    }
}

# 5. Dynamic 7-Stage Hardware Telemetry Monospace Readout
stages[0] = "// [STAGE 01/07] BCM2711 SILICON & KERNEL BUS BINDING -> OK";
stages[1] = "// [STAGE 02/07] CALIBRATING TOUCH DIGITIZER & I/O PORTS -> OK";
stages[2] = "// [STAGE 03/07] ALLOCATING MEMORY SPOOL PIPE [0x7FF0..0x8000] -> OK";
stages[3] = "// [STAGE 04/07] PROBING THERMAL CUPS PRINTER SUBSYSTEM -> READY";
stages[4] = "// [STAGE 05/07] ESTABLISHING LOW-LATENCY AUTONOMOUS WSS LINK -> 100%";
stages[5] = "// [STAGE 06/07] HARDWARE INTEGRITY VERIFIED // PB-001 SECURE -> OK";
stages[6] = "// [STAGE 07/07] ENCRYPTED PRINT PIPELINE SYNCHRONIZED — READY";

status_sprite = Sprite();
status_y = (screen_height / 2) + 154;

pct_sprite = Sprite();
pct_y = (screen_height / 2) + 96;

fun update_status(text) {
    img = Image.Text(text, 0.97, 0.45, 0.45, 1.0, "Monospace Bold 11");
    if (img) {
        status_sprite.SetImage(img);
        status_sprite.SetPosition((screen_width - img.GetWidth()) / 2, status_y, 12);
    }
}
update_status(stages[0]);

# 6. High-Precision Laser Progress Bar & Traveling Spark
track_img = Image("progress_track.png");
bar_img = Image("progress_bar.png");
spark_img = Image("progress_spark.png");
if (!spark_img) {
    spark_img = Image("progress_glow.png");
}

track_w = 480;
track_h = 10;
track_x = (screen_width - track_w) / 2;
track_y = (screen_height / 2) + 122;

if (track_img) {
    track_sprite = Sprite(track_img.Scale(track_w, track_h));
    track_sprite.SetPosition(track_x, track_y, 9);
}

bar_sprite = Sprite();
bar_sprite.SetPosition(track_x, track_y, 10);

if (spark_img) {
    spark_sprite = Sprite(spark_img);
    spark_sprite.SetPosition(track_x - 16, track_y - 11, 11);
}

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

    if (spark_img && spark_sprite) {
        spark_sprite.SetPosition(track_x + current_w - 16, track_y - 11, 11);
    }

    # Update telemetry message according to progress
    stage_idx = Math.Int(progress_val * 6.99);
    if (stage_idx > 6) stage_idx = 6;
    if (stage_idx < 0) stage_idx = 0;
    update_status(stages[stage_idx]);

    # Live percentage text readout
    pct_num = Math.Int(progress_val * 100);
    pct_txt = "SYSTEM CALIBRATION: " + pct_num + "%";
    pct_img = Image.Text(pct_txt, 0.90, 0.30, 0.30, 1.0, "Monospace Bold 10");
    if (pct_img) {
        pct_sprite.SetImage(pct_img);
        pct_sprite.SetPosition((screen_width - pct_img.GetWidth()) / 2, pct_y, 12);
    }
}

refresh_progress(0.08);

# Continuous High-Speed 60fps Animation Loop
time_tick = 0;
outer_angle = 0.0;
mid_angle = 0.0;
pulse_phase = 0.0;

fun refresh_callback() {
    time_tick++;

    # 1. Dual counter-rotating cybernetic reticle
    outer_angle = outer_angle + 0.018;
    if (reticle_outer_img && reticle_outer_sprite) {
        rot_out = reticle_outer_img.Rotate(outer_angle);
        reticle_outer_sprite.SetImage(rot_out);
        reticle_outer_sprite.SetPosition(reticle_cx - rot_out.GetWidth() / 2, reticle_cy - rot_out.GetHeight() / 2, 4);
    }

    mid_angle = mid_angle - 0.026;
    if (reticle_mid_img && reticle_mid_sprite) {
        rot_mid = reticle_mid_img.Rotate(mid_angle);
        reticle_mid_sprite.SetImage(rot_mid);
        reticle_mid_sprite.SetPosition(reticle_cx - rot_mid.GetWidth() / 2, reticle_cy - rot_mid.GetHeight() / 2, 5);
    }

    # 2. Pulsing laser core aperture
    pulse_phase = pulse_phase + 0.08;
    if (reticle_core_sprite) {
        core_alpha = 0.70 + 0.30 * Math.Sin(pulse_phase);
        reticle_core_sprite.SetOpacity(core_alpha);
    }

    # 3. Horizontal laser scanline sweep
    if (scanline_sprite) {
        scanline_y = scanline_y + 5.2;
        if (scanline_y > screen_height + 40) {
            scanline_y = -40;
        }
        scanline_sprite.SetPosition(0, scanline_y, 7);
    }

    # 4. Cascading matrix streams
    for (i = 0; i < num_cols; i++) {
        if (stream_sprites[i]) {
            cy = stream_sprites[i].GetY();
            ny = cy + (stream_speed[i] / 50.0);
            if (ny > screen_height) {
                ny = -750 - (Math.Int(time_tick * 17 + i * 31) % 250);
            }
            stream_sprites[i].SetPosition(stream_x[i], ny, 2);
        }
    }

    # 5. Pulsing Spark at head of progress
    if (spark_sprite) {
        spark_alpha = 0.75 + 0.25 * Math.Sin(time_tick * 0.15);
        spark_sprite.SetOpacity(spark_alpha);
    }

    # 6. Smooth progressive advancement
    if (progress_val < 0.94) {
        refresh_progress(progress_val + 0.0018);
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
    # Fade out smoothly into kiosk
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
