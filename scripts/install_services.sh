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

# 4. Create printbooth-ui.service (Port 5175 Web Server)
echo -e "\n[3/5] Installing /etc/systemd/system/printbooth-ui.service..."
sudo tee /etc/systemd/system/printbooth-ui.service > /dev/null << EOF
[Unit]
Description=PrintBooth Touchscreen Kiosk UI Server (Port 5175)
After=network.target
Wants=network.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$SCRIPT_DIR
ExecStart=$PYTHON_BIN $SCRIPT_DIR/serve_kiosk_ui.py 5175 $UI_DIR/dist
Restart=always
RestartSec=2
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# 5. Create printbooth-display.service
echo -e "\n[4/5] Installing /etc/systemd/system/printbooth-display.service..."
sudo tee /etc/systemd/system/printbooth-display.service > /dev/null << EOF
[Unit]
Description=PrintBooth Touchscreen Kiosk Display
After=graphical.target printbooth-brain.service printbooth-ui.service
Wants=printbooth-brain.service printbooth-ui.service

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

# 6. Reload systemd, clean stale processes, and enable services
echo -e "\n[5/5] Terminating any stale background Python client instances..."
sudo pkill -f "ws_kiosk_client.py" 2>/dev/null || true
sudo pkill -f "daemon.py" 2>/dev/null || true
rm -f /tmp/printbooth_ws_client.pid 2>/dev/null || true

echo "Ensuring file permissions on brain data directory..."
mkdir -p "$BRAIN_DIR/data"
sudo chown -R "$CURRENT_USER:$CURRENT_USER" "$BRAIN_DIR/data" 2>/dev/null || true
sudo chmod -R 775 "$BRAIN_DIR/data" 2>/dev/null || true

sudo systemctl daemon-reload
sudo systemctl enable printbooth-cups-setup.service
sudo systemctl enable printbooth-ui.service
sudo systemctl enable printbooth-brain.service
sudo systemctl enable printbooth-display.service

echo -e "\n✓ printbooth-cups-setup.service, printbooth-ui.service, printbooth-brain.service and printbooth-display.service installed and enabled!"
echo "To start services now, run:"
echo "  sudo systemctl restart printbooth-ui"
echo "  sudo systemctl restart printbooth-brain"
echo "  sudo systemctl restart printbooth-display"
echo "════════════════════════════════════════════════════════"
