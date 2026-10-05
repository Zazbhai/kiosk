#!/usr/bin/env bash
# ==============================================================================
# PrintBooth Kiosk — Production UFW Firewall Configuration
# ==============================================================================
# Principle: The Raspberry Pi is a CLIENT, NOT a public server.
# INBOUND INTERNET: DENY ALL
# OUTBOUND: ALLOW TCP 443 (HTTPS/WSS) & DNS (53)
# All inbound ports (631, 8080, 8000, 3000, 5000) are BLOCKED.
# ==============================================================================
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "[!] Must run as root (sudo bash firewall.sh)." >&2
    exit 1
fi

echo "=========================================================="
echo "  Applying Hardened Kiosk UFW Firewall Rules"
echo "=========================================================="

# Reset UFW
ufw --force reset

# Default policies
ufw default deny incoming
ufw default allow outgoing

# Inbound loopback is allowed for internal IPC
ufw allow in on lo to any

# Outbound rules (explicit documentation)
# Outbound HTTPS / WSS on standard port 443
ufw allow out 443/tcp comment 'PrintBooth Outbound WSS / HTTPS'

# Outbound DNS (UDP and TCP on port 53)
ufw allow out 53/udp comment 'DNS resolution'
ufw allow out 53/tcp comment 'DNS resolution'

# Outbound NTP for clock synchronization (required for TLS cert expiry validation)
ufw allow out 123/udp comment 'Network Time Protocol'

# Outbound DHCP
ufw allow out 67:68/udp comment 'DHCP'

# EXPLICITLY BLOCK CUPS (Port 631) from external networks
ufw deny in 631 comment 'Deny external CUPS access'

# Optional: If SSH is needed for temporary on-site technician development on local LAN only
if [ "${ALLOW_LAN_SSH:-false}" = "true" ]; then
    echo "[+] Allowing SSH on local subnet only (192.168.0.0/16)..."
    ufw allow from 192.168.0.0/16 to any port 22 proto tcp comment 'Restricted LAN SSH'
else
    echo "[-] Public & inbound SSH is disabled."
fi

# Enable UFW
ufw --force enable
ufw status verbose

echo "=========================================================="
echo "  [SUCCESS] Firewall configured: Zero public inbound ports"
echo "=========================================================="
