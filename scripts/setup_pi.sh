#!/usr/bin/env bash
# ==============================================================================
# PrintBooth Raspberry Pi Kiosk Brain — Automated Master Setup Script
# ==============================================================================
# Sets up Raspberry Pi OS (Debian / DietPi / Ubuntu ARM) for unattended self-service
# walk-up printing kiosks with CUPS, USB drivers, hardware monitor, and touchscreen UI.
# Run with: bash setup_pi.sh
# ==============================================================================

set -e

echo "════════════════════════════════════════════════════════"
echo "  Setting up PrintBooth Kiosk Brain on Raspberry Pi     "
echo "════════════════════════════════════════════════════════"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIOSK_ROOT="$(dirname "$SCRIPT_DIR")"
BRAIN_DIR="$KIOSK_ROOT/brain"
ACTUAL_USER="${SUDO_USER:-$USER}"

# Ensure scripts are executable
chmod +x "$SCRIPT_DIR"/*.sh 2>/dev/null || true

# 1. Update APT repositories
echo -e "\n[1/7] Updating system packages..."
sudo apt-get update -y

# 2. Install CUPS, printer drivers, Python, and kiosk tools
echo -e "\n[2/7] Installing CUPS, hardware drivers, Chromium, and tools..."
sudo apt-get install -y \
    cups \
    cups-client \
    cups-bsd \
    libcups2-dev \
    printer-driver-all \
    printer-driver-gutenprint \
    hplip \
    python3 \
    python3-pip \
    python3-venv \
    chromium-browser \
    unclutter \
    xdotool \
    x11-xserver-utils \
    openbox \
    plymouth \
    feh \
    curl \
    git \
    poppler-utils \
    libreoffice-writer \
    libreoffice-impress \
    libreoffice-calc \
    --no-install-recommends

# 3. Configure CUPS permissions & remote admin
echo -e "\n[3/7] Configuring CUPS permissions..."
sudo usermod -a -G lpadmin,lp "$ACTUAL_USER"
sudo systemctl enable cups
sudo systemctl restart cups

# Allow remote administration over LAN if needed
sudo cupsctl --remote-admin --remote-any --share-printers || true

# Setup udev rules for plug-and-play USB printer access
echo "Configuring USB printer udev rules..."
sudo tee /etc/udev/rules.d/99-printbooth-printers.rules > /dev/null << 'EOF'
# Grant full read/write access to USB printers for lp and console users
SUBSYSTEM=="usb", ATTR{bInterfaceClass}=="07", MODE="0666", GROUP="lpadmin"
KERNEL=="lp[0-9]*", MODE="0666", GROUP="lpadmin"
EOF
sudo udevadm control --reload-rules 2>/dev/null || true
sudo udevadm trigger 2>/dev/null || true

# Grant passwordless sudo for CUPS commands and hardware recovery
sudo tee /etc/sudoers.d/printbooth-cups > /dev/null << 'EOF'
ALL ALL=(ALL) NOPASSWD: /usr/sbin/cupsenable, /usr/sbin/cupsaccept, /usr/sbin/lpadmin, /usr/sbin/cupsctl, /usr/sbin/cupsfilter, /sbin/modprobe, /bin/systemctl restart cups, /bin/systemctl status cups
EOF
sudo chmod 0440 /etc/sudoers.d/printbooth-cups

# Grant passwordless sudo for autonomous updater to restart services
sudo tee /etc/sudoers.d/printbooth-autoupdate > /dev/null << 'EOF'
ALL ALL=(ALL) NOPASSWD: /bin/systemctl restart printbooth-brain, /bin/systemctl restart printbooth-display, /bin/systemctl daemon-reload, /bin/systemctl restart printbooth-autoupdate.timer, /bin/systemctl status printbooth-autoupdate
EOF
sudo chmod 0440 /etc/sudoers.d/printbooth-autoupdate

# 4. Setup Python Virtual Environment
echo -e "\n[4/7] Setting up Python virtual environment for Kiosk Brain..."
cd "$BRAIN_DIR"
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# 5. Create default environment config if missing
if [ ! -f "$KIOSK_ROOT/.env" ]; then
    echo -e "\n[5/7] Creating default .env configuration..."
    cp "$KIOSK_ROOT/.env.example" "$KIOSK_ROOT/.env"
    echo "Created $KIOSK_ROOT/.env — Please verify KIOSK_ID and PRINTBOOTH_API_URL."
fi

# 6. Install systemd services with dynamic paths and user
echo -e "\n[6/7] Installing and registering PrintBooth systemd services & auto-updater..."
if [ -f "$SCRIPT_DIR/printbooth-brain.service" ]; then
    sed -e "s|User=pi|User=$ACTUAL_USER|g" \
        -e "s|/home/pi/printer_automation/kiosk|$KIOSK_ROOT|g" \
        "$SCRIPT_DIR/printbooth-brain.service" | sudo tee /etc/systemd/system/printbooth-brain.service > /dev/null
    sudo systemctl daemon-reload
    sudo systemctl enable printbooth-brain.service
    echo "✓ Enabled printbooth-brain.service"
fi

# Install autonomous GitHub Auto-Updater service and 5-minute timer
if [ -f "$SCRIPT_DIR/printbooth-autoupdate.service" ] && [ -f "$SCRIPT_DIR/printbooth-autoupdate.timer" ]; then
    sed -e "s|User=pi|User=$ACTUAL_USER|g" \
        -e "s|/home/pi/printer_automation/kiosk|$KIOSK_ROOT|g" \
        "$SCRIPT_DIR/printbooth-autoupdate.service" | sudo tee /etc/systemd/system/printbooth-autoupdate.service > /dev/null
    sudo cp "$SCRIPT_DIR/printbooth-autoupdate.timer" /etc/systemd/system/printbooth-autoupdate.timer
    sudo systemctl daemon-reload
    sudo systemctl enable printbooth-autoupdate.timer
    sudo systemctl start printbooth-autoupdate.timer
    echo "✓ Enabled and started printbooth-autoupdate.timer (Autonomous GitHub updates every 5 min)"
fi

# Create convenient command: kiosk-update
if [ -f "$SCRIPT_DIR/kiosk_autoupdate.sh" ]; then
    sudo ln -sf "$SCRIPT_DIR/kiosk_autoupdate.sh" /usr/local/bin/kiosk-update
    sudo chmod +x /usr/local/bin/kiosk-update
    echo "✓ Registered 'kiosk-update' CLI command"
fi

# 7. Configure printer queue, drivers & self-healing watchdog
echo -e "\n[7/7] Checking printer hardware & configuring CUPS queue..."
if [ -f "$SCRIPT_DIR/setup_autorecover.sh" ]; then
    bash "$SCRIPT_DIR/setup_autorecover.sh" || echo "Note: Auto-recover can be re-run after connecting USB."
fi
if [ -f "$SCRIPT_DIR/install_printer_drivers.sh" ]; then
    bash "$SCRIPT_DIR/install_printer_drivers.sh" || echo "Note: Printer configuration can be re-run after connecting USB."
fi

echo -e "\n════════════════════════════════════════════════════════"
echo "  Setup Complete! 🎉"
echo "  1. Connect printer via USB and power it on."
echo "  2. Test printer connection: bash $SCRIPT_DIR/test_printer_connection.sh --print"
echo "  3. Start brain daemon: sudo systemctl start printbooth-brain"
echo "  4. Setup Zero-Desktop Kiosk & Custom Bootloader:"
echo "     bash $SCRIPT_DIR/setup_kiosk_appliance.sh"
echo "  5. Start display now: bash $SCRIPT_DIR/start_kiosk.sh"
echo "════════════════════════════════════════════════════════"
