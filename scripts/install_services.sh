#!/usr/bin/env bash
# ==============================================================================
# PrintBooth Kiosk — Systemd Service Installer (modeled on LePrint services.sh)
# ==============================================================================
# Configures and enables:
#   1. printbooth-brain.service   (IoT Daemon & Spooler)
#   2. printbooth-display.service (Touchscreen Kiosk Display)
# Uses dynamic current user and kiosk root directory (no hardcoded /home/pi paths).
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIOSK_ROOT="$(dirname "$SCRIPT_DIR")"
BRAIN_DIR="$KIOSK_ROOT/brain"
CURRENT_USER="${SUDO_USER:-$USER}"
USER_HOME=$(eval echo "~$CURRENT_USER")

echo "════════════════════════════════════════════════════════"
echo "  PrintBooth Systemd Service Setup                      "
echo "════════════════════════════════════════════════════════"
echo "  Target User       : $CURRENT_USER"
echo "  User Home         : $USER_HOME"
echo "  Kiosk Root        : $KIOSK_ROOT"
echo "════════════════════════════════════════════════════════"

# 1. Ensure user is in lpadmin and lp groups (CUPS permissions)
echo -e "\n[1/4] Ensuring $CURRENT_USER is in lpadmin and lp groups..."
sudo usermod -a -G lpadmin,lp "$CURRENT_USER" || true

# 2. Determine Python binary
PYTHON_BIN="$BRAIN_DIR/venv/bin/python"
if [ ! -f "$PYTHON_BIN" ]; then
    PYTHON_BIN="$(which python3)"
fi
echo "  ✓ Python binary: $PYTHON_BIN"

# 3. Create printbooth-brain.service
echo -e "\n[2/4] Installing /etc/systemd/system/printbooth-brain.service..."
sudo tee /etc/systemd/system/printbooth-brain.service > /dev/null << EOF
[Unit]
Description=PrintBooth Kiosk Brain IoT Daemon
After=network-online.target cups.service
Wants=network-online.target cups.service
Requires=cups.service

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$BRAIN_DIR
ExecStart=$PYTHON_BIN ws_kiosk_client.py
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal
EnvironmentFile=-$KIOSK_ROOT/.env

[Install]
WantedBy=multi-user.target
EOF

# 4. Create printbooth-display.service
echo -e "\n[3/4] Installing /etc/systemd/system/printbooth-display.service..."
sudo tee /etc/systemd/system/printbooth-display.service > /dev/null << EOF
[Unit]
Description=PrintBooth Touchscreen Kiosk Display
After=graphical.target printbooth-brain.service
Wants=printbooth-brain.service

[Service]
Type=simple
User=$CURRENT_USER
Environment=DISPLAY=:0
Environment=XAUTHORITY=$USER_HOME/.Xauthority
WorkingDirectory=$SCRIPT_DIR
ExecStart=/bin/bash $SCRIPT_DIR/start_kiosk.sh
Restart=on-failure
RestartSec=5

[Install]
WantedBy=graphical.target
EOF

# 5. Reload systemd and enable services
echo -e "\n[4/4] Reloading systemd and enabling services..."
sudo systemctl daemon-reload
sudo systemctl enable printbooth-brain.service
sudo systemctl enable printbooth-display.service

echo -e "\n✓ printbooth-brain.service and printbooth-display.service installed and enabled!"
echo "To start services now, run:"
echo "  sudo systemctl restart printbooth-brain"
echo "  sudo systemctl restart printbooth-display"
echo "════════════════════════════════════════════════════════"
