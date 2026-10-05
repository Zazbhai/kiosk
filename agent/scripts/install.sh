#!/usr/bin/env bash
# ==============================================================================
# PrintBooth Raspberry Pi Device Agent — Production Installer Script
# Target OS: Raspberry Pi OS 64-bit (Debian Bookworm)
# ==============================================================================
set -euo pipefail

echo "=========================================================="
echo "  PrintBooth Kiosk Device Agent — Automated Installer"
echo "=========================================================="

if [ "$(id -u)" -ne 0 ]; then
    echo "[!] This script must be executed as root (e.g. sudo bash install.sh)." >&2
    exit 1
fi

AGENT_INSTALL_DIR="/opt/printbooth-agent"
KEY_DIR="/etc/printbooth"
JOBS_DIR="/var/lib/printbooth/jobs"
SERVICE_NAME="printbooth-agent"

# 1. Update package lists and install system requirements
echo "[1/7] Installing system packages (CUPS, Python3, libcups2-dev)..."
apt-get update -y
apt-get install -y --no-install-recommends \
    cups \
    libcups2-dev \
    python3 \
    python3-venv \
    python3-pip \
    python3-dev \
    gcc \
    libffi-dev \
    libssl-dev \
    ufw \
    curl \
    ca-certificates

# Ensure CUPS service is running and enabled
systemctl enable cups
systemctl restart cups

# 2. Create dedicated unprivileged service account
echo "[2/7] Creating unprivileged 'printbooth' user..."
if ! id "printbooth" &>/dev/null; then
    useradd -r -s /usr/sbin/nologin -d /opt/printbooth-agent -m printbooth
fi

# Add printbooth user to lp & lpadmin groups for CUPS printing rights
usermod -aG lp,lpadmin printbooth

# 3. Create target directory structure
echo "[3/7] Setting up directory hierarchy..."
mkdir -p "${AGENT_INSTALL_DIR}/agent"
mkdir -p "${AGENT_INSTALL_DIR}/data"
mkdir -p "${AGENT_INSTALL_DIR}/certs"
mkdir -p "${AGENT_INSTALL_DIR}/config"
mkdir -p "${KEY_DIR}"
mkdir -p "${JOBS_DIR}"

# Copy codebase
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cp -r "${SCRIPT_DIR}/agent/"* "${AGENT_INSTALL_DIR}/agent/"
cp "${SCRIPT_DIR}/requirements.txt" "${AGENT_INSTALL_DIR}/"

if [ -f "${SCRIPT_DIR}/config/device.json" ]; then
    cp "${SCRIPT_DIR}/config/device.json" "${AGENT_INSTALL_DIR}/config/"
else
    cp "${SCRIPT_DIR}/config/device.json.example" "${AGENT_INSTALL_DIR}/config/device.json"
fi

# 4. Create isolated Python virtual environment
echo "[4/7] Creating Python 3 virtual environment..."
python3 -m venv "${AGENT_INSTALL_DIR}/venv"
"${AGENT_INSTALL_DIR}/venv/bin/pip" install --upgrade pip setuptools wheel
"${AGENT_INSTALL_DIR}/venv/bin/pip" install -r "${AGENT_INSTALL_DIR}/requirements.txt"

# Optional: compile pycups in venv if available
"${AGENT_INSTALL_DIR}/venv/bin/pip" install pycups || true

# 5. Generate device cryptographic key if missing
echo "[5/7] Provisioning cryptographic identity key (Ed25519)..."
"${AGENT_INSTALL_DIR}/venv/bin/python" -c "
import sys
from pathlib import Path
sys.path.insert(0, '${AGENT_INSTALL_DIR}/agent')
from authentication import DeviceIdentityManager
identity = DeviceIdentityManager(key_path=Path('${KEY_DIR}/device.key'), kiosk_id='PROVISION')
print(f'Device Public Key: {identity.public_key_base64}')
"

# Set strict permissions
chmod 700 "${KEY_DIR}"
chmod 600 "${KEY_DIR}/device.key" || true
chown -R printbooth:printbooth "${KEY_DIR}"
chown -R printbooth:printbooth "${AGENT_INSTALL_DIR}"
chown -R printbooth:printbooth "${JOBS_DIR}"
chmod 750 "${JOBS_DIR}"

# 6. Install systemd service
echo "[6/7] Installing systemd service unit..."
cp "${SCRIPT_DIR}/systemd/printbooth-agent.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable printbooth-agent

# 7. Complete
echo "=========================================================="
echo "  [SUCCESS] PrintBooth Device Agent installation complete!"
echo "=========================================================="
echo "Next steps:"
echo "  1. Edit kiosk configuration:  nano ${AGENT_INSTALL_DIR}/config/device.json"
echo "  2. Start the service:         systemctl start printbooth-agent"
echo "  3. View live journal logs:    journalctl -u printbooth-agent -f"
echo "=========================================================="
