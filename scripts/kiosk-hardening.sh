# LePrint — Kiosk USB power management udev rule
# Installs a udev rule so the kernel never autosuspends the Brother printer.
# Also installs a sudoers entry and wrapper script for the wake_brother_printer fallback.
#
# Usage: sudo bash scripts/kiosk-hardening.sh

set -e

echo "════════════════════════════════════════════════════════"
echo "  PrintBooth: Kiosk USB Power Hardening"
echo "════════════════════════════════════════════════════════"

# --- 1. udev rule ---
UDEV_RULE="/etc/udev/rules.d/99-leprint-usb.rules"

echo ""
echo "[1/3] Installing udev rule to disable USB autosuspend for Brother printer…"

sudo tee "$UDEV_RULE" > /dev/null <<'EOF'
# LePrint: Keep Brother printer awake — disable USB autosuspend
# Match on Brother vendor ID (0x04f9) and set power control to "on", autosuspend to -1.
ACTION=="add", SUBSYSTEM=="usb", ATTR{idVendor}=="04f9", ATTR{power/control}="on", ATTR{power/autosuspend}="-1"

# Fallback: for any USB device at known Pi USB path 1-1.3
ACTION=="add", SUBSYSTEM=="usb", KERNEL=="1-1.3", ATTR{power/control}="on", ATTR{power/autosuspend}="-1"
EOF

sudo chmod 644 "$UDEV_RULE"
echo "  ✓ udev rule installed at $UDEV_RULE"

# Reload udev rules and re-trigger for currently connected devices
sudo udevadm control --reload-rules 2>/dev/null || true
sudo udevadm trigger 2>/dev/null || true
echo "  ✓ udev rules reloaded and triggered"

# --- 2. Sudoers entry for the kiosk user ---
SUDOERS_FILE="/etc/sudoers.d/99-leprint-kiosk"
KIOSK_USER="${USER}"

echo ""
echo "[2/3] Configuring passwordless sudo for USB power management (user: $KIOSK_USER)…"

sudo tee "$SUDOERS_FILE" > /dev/null <<EOF
# LePrint: Allow $KIOSK_USER to manage USB power without password
$KIOSK_USER ALL=(ALL) NOPASSWD: /usr/local/bin/leprint-usb-power-manage.sh
EOF

sudo chmod 0440 "$SUDOERS_FILE"
echo "  ✓ Sudoers rule installed at $SUDOERS_FILE"

# --- 3. USB power management wrapper script ---
USB_SCRIPT="/usr/local/bin/leprint-usb-power-manage.sh"

echo ""
echo "[3/3] Installing USB power management wrapper script…"

sudo tee "$USB_SCRIPT" > /dev/null <<'SCRIPT'
#!/bin/bash
# LePrint USB Power Management Wrapper
# Called by the kiosk agent's wake_brother_printer (sudo fallback)
# and by the 1-min USB monitor heartbeat.
# Disables autosuspend and sets power control to "on" for Brother printer USB devices.

USB_DEV="/sys/bus/usb/devices"

for dev in "$USB_DEV"/1-1.3 "$USB_DEV"/1-1.3* "$USB_DEV"/1-2* "$USB_DEV"/2-1* ; do
  if [ -d "$dev" ]; then
    echo on > "$dev/power/control" 2>/dev/null || true
    echo -1 > "$dev/power/autosuspend" 2>/dev/null || true
  fi
done
SCRIPT

sudo chmod +x "$USB_SCRIPT"
echo "  ✓ Wrapper script installed at $USB_SCRIPT"

# --- 4. Verify passwordless sudo works ---
echo ""
if sudo -n true 2>/dev/null; then
    echo "  ✓ Passwordless sudo verified for user '$KIOSK_USER'"
else
    echo "  ⚠ Passwordless sudo not yet active. Try logging out/in or rebooting."
fi

echo ""
echo "════════════════════════════════════════════════════════"
echo "  ✓ Kiosk USB hardening complete. Brother printer will stay awake."
echo "════════════════════════════════════════════════════════"
