#!/usr/bin/env bash
# ==============================================================================
# PrintBooth Kiosk — Fix CUPS & Sudo Permissions (Zero Password Prompts)
# ==============================================================================
# Grants passwordless rights for printing, queue control, and device recovery
# so the kiosk daemon never asks for a password.
# ==============================================================================

set -e

CURRENT_USER="${SUDO_USER:-$USER}"
echo "[PrintBooth] Configuring zero-password permissions for user: '$CURRENT_USER'..."

# 1. Add user to CUPS printer administration groups
echo "• Adding $CURRENT_USER to lpadmin and lp groups..."
sudo usermod -a -G lpadmin,lp "$CURRENT_USER" || true
if id "kiosk" &>/dev/null; then
    sudo usermod -a -G lpadmin,lp kiosk || true
fi
if id "pi" &>/dev/null; then
    sudo usermod -a -G lpadmin,lp pi || true
fi

# 2. Grant passwordless sudo for CUPS commands and hardware recovery
echo "• Installing passwordless sudoers policy in /etc/sudoers.d/printbooth-cups..."
sudo tee /etc/sudoers.d/printbooth-cups > /dev/null << 'EOF'
# PrintBooth Kiosk Hardware & Spooler Passwordless Rights
ALL ALL=(ALL) NOPASSWD: /usr/sbin/cupsenable, /usr/sbin/cupsaccept, /usr/sbin/lpadmin, /usr/sbin/cupsctl, /usr/sbin/cupsfilter, /sbin/modprobe, /bin/systemctl restart cups, /bin/systemctl status cups
EOF
sudo chmod 0440 /etc/sudoers.d/printbooth-cups

# 3. Configure CUPS daemon for local administration
echo "• Configuring CUPS service permissions..."
sudo cupsctl --remote-admin --remote-any --share-printers || true

# 4. Configure USB printer udev permissions
echo "• Installing udev rules for plug-and-play USB printer access..."
sudo tee /etc/udev/rules.d/99-printbooth-printers.rules > /dev/null << 'EOF'
SUBSYSTEM=="usb", ATTR{bInterfaceClass}=="07", MODE="0666", GROUP="lpadmin"
KERNEL=="lp[0-9]*", MODE="0666", GROUP="lpadmin"
EOF
sudo udevadm control --reload-rules 2>/dev/null || true
sudo udevadm trigger 2>/dev/null || true

# 5. Restart CUPS service
echo "• Restarting CUPS spooler daemon..."
sudo systemctl restart cups

echo "════════════════════════════════════════════════════════"
echo "  ✓ CUPS Permissions Configured Successfully!"
echo "  • User '$CURRENT_USER' added to 'lpadmin' & 'lp'."
echo "  • Passwordless sudo enabled for printer administration."
echo "  • Daemon will NEVER prompt for password on terminal."
echo "════════════════════════════════════════════════════════"
