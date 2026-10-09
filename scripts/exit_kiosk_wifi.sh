#!/usr/bin/env bash
# ==============================================================================
# PrintBooth Kiosk — Technician Wi-Fi Management & Kiosk Release Utility
# ==============================================================================
# 1. Gracefully pauses Chromium Kiosk Mode & watchdog supervisor
# 2. Restores cursor and terminal access
# 3. Provides guided Wi-Fi network selection, scanning, and password entry
# 4. Validates IP address & internet connectivity to the Spooler API
# 5. Seamlessly resumes Kiosk Mode upon completion
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIOSK_ROOT="$(dirname "$SCRIPT_DIR")"
START_SCRIPT="$SCRIPT_DIR/start_kiosk.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Ensure root privileges for network configuration commands
if [ "$EUID" -ne 0 ]; then
    echo -e "${YELLOW}[!] Root permissions required to configure network interfaces.${NC}"
    echo -e "    Re-running with sudo..."
    exec sudo bash "$0" "$@"
fi

show_banner() {
    clear
    echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}${CYAN}   🖨️  PrintBooth Kiosk — Technician Wi-Fi Setup Utility${NC}"
    echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
    echo ""
}

show_banner

# ── 1. Stop Kiosk Mode ────────────────────────────────────────────────────────
echo -e "${YELLOW}[1/4] Pausing Kiosk Display & Supervisor...${NC}"

# Mark pause flag so start_kiosk.sh sleeps in background
touch /tmp/printbooth_kiosk_paused 2>/dev/null || true

WAS_SERVICE_ACTIVE=0
if systemctl is-active --quiet printbooth-display.service 2>/dev/null; then
    WAS_SERVICE_ACTIVE=1
    echo "  • Stopping printbooth-display.service..."
    systemctl stop printbooth-display.service 2>/dev/null || true
fi

# Terminate running Chromium processes to release X11 screen
pkill -f "chromium" 2>/dev/null || true
pkill -f "chromium-browser" 2>/dev/null || true
pkill -f "unclutter" 2>/dev/null || true

# Restore mouse cursor on X display if available
if [ -n "$DISPLAY" ]; then
    xsetroot -cursor_name left_ptr 2>/dev/null || true
fi

echo -e "${GREEN}  ✓ Kiosk mode paused. Terminal released.${NC}\n"

# ── 2. Helper Functions ───────────────────────────────────────────────────────
check_connection() {
    echo -e "${BOLD}[Network Diagnostics]${NC}"
    
    # Check IP
    CURRENT_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
    if [ -n "$CURRENT_IP" ]; then
        echo -e "  • Local IP Address : ${GREEN}${CURRENT_IP}${NC}"
    else
        echo -e "  • Local IP Address : ${RED}Not connected${NC}"
    fi

    # Check Active Wi-Fi SSID
    ACTIVE_SSID=""
    if command -v nmcli >/dev/null 2>&1; then
        ACTIVE_SSID=$(nmcli -t -f active,ssid dev wifi 2>/dev/null | grep '^yes:' | cut -d':' -f2)
    elif command -v iwgetid >/dev/null 2>&1; then
        ACTIVE_SSID=$(iwgetid -r 2>/dev/null)
    fi

    if [ -n "$ACTIVE_SSID" ]; then
        echo -e "  • Connected SSID   : ${GREEN}${ACTIVE_SSID}${NC}"
    else
        echo -e "  • Connected SSID   : ${YELLOW}None${NC}"
    fi

    # Ping Test (Gateway & Google DNS)
    echo -n "  • Internet Access  : "
    if ping -c 1 -W 2 8.8.8.8 >/dev/null 2>&1 || curl -s --connect-timeout 2 http://connectivitycheck.gstatic.com/generate_204 >/dev/null 2>&1; then
        echo -e "${GREEN}ONLINE ✓${NC}"
    else
        echo -e "${RED}OFFLINE (No Internet) ✗${NC}"
    fi

    # Target Backend Spooler Check
    TARGET_API="http://localhost:5000"
    if [ -f "$KIOSK_ROOT/brain/.env" ]; then
        ENV_API=$(grep -E "^PRINTBOOTH_API_URL=" "$KIOSK_ROOT/brain/.env" | cut -d '=' -f2- | tr -d '"' | tr -d "'")
        if [ -n "$ENV_API" ]; then
            TARGET_API="$ENV_API"
        fi
    fi
    echo -n "  • Spooler Backend  : ($TARGET_API) "
    if curl -s --connect-timeout 2 "$TARGET_API/api/health" >/dev/null 2>&1 || curl -s --connect-timeout 2 "$TARGET_API/health" >/dev/null 2>&1 || curl -s --connect-timeout 2 "$TARGET_API" >/dev/null 2>&1; then
        echo -e "${GREEN}REACHABLE ✓${NC}"
    else
        echo -e "${YELLOW}UNREACHABLE / STANDALONE${NC}"
    fi
    echo ""
}

connect_via_nmcli_wizard() {
    echo -e "${BOLD}${CYAN}--- Available Wi-Fi Networks ---${NC}"
    echo "Scanning for nearby Wi-Fi networks (please wait)..."
    nmcli dev wifi rescan 2>/dev/null || true
    sleep 1
    nmcli -f IN-USE,SSID,MODE,CHAN,RATE,SIGNAL,BARS,SECURITY dev wifi list
    echo ""

    read -rp "Enter Network SSID to connect (or press Enter to cancel): " TARGET_SSID
    if [ -z "$TARGET_SSID" ]; then
        echo "Cancelled."
        return
    fi

    read -rsp "Enter Wi-Fi Password for '$TARGET_SSID': " TARGET_PASS
    echo ""

    echo -e "\nConnecting to '${TARGET_SSID}'..."
    if [ -z "$TARGET_PASS" ]; then
        nmcli dev wifi connect "$TARGET_SSID"
    else
        nmcli dev wifi connect "$TARGET_SSID" password "$TARGET_PASS"
    fi

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Successfully connected to ${TARGET_SSID}!${NC}"
    else
        echo -e "${RED}✗ Connection failed. Please check SSID and password.${NC}"
    fi
    echo ""
}

connect_via_raspi_config() {
    if command -v raspi-config >/dev/null 2>&1; then
        echo "Launching native Raspberry Pi configuration..."
        raspi-config
    else
        echo -e "${RED}raspi-config not found on this system.${NC}"
    fi
}

# ── 3. Interactive Technician Menu ────────────────────────────────────────────
check_connection

while true; do
    echo -e "${BOLD}Select Network Configuration Action:${NC}"
    echo -e "  ${CYAN}1)${NC} Graphical Network Menu (nmtui — Recommended)"
    echo -e "  ${CYAN}2)${NC} Scan & Connect via Terminal Wizard"
    echo -e "  ${CYAN}3)${NC} Check Current Connection & Diagnostics"
    echo -e "  ${CYAN}4)${NC} Raspberry Pi Native Config (raspi-config)"
    echo -e "  ${CYAN}5)${NC} Manual Network Restart (Restart NetworkManager/wpa_supplicant)"
    echo -e "  ${GREEN}6) Resume Kiosk Mode Now 🚀${NC}"
    echo -e "  ${RED}7) Exit to Shell (Leave Kiosk Stopped)${NC}"
    echo ""
    read -rp "Option [1-7, default: 1]: " CHOICE
    CHOICE="${CHOICE:-1}"

    case "$CHOICE" in
        1)
            if command -v nmtui >/dev/null 2>&1; then
                nmtui
                show_banner
                check_connection
            else
                echo -e "${YELLOW}nmtui not found. Falling back to terminal wizard...${NC}"
                connect_via_nmcli_wizard
                check_connection
            fi
            ;;
        2)
            if command -v nmcli >/dev/null 2>&1; then
                connect_via_nmcli_wizard
                check_connection
            else
                echo -e "${RED}nmcli not found. Trying raspi-config...${NC}"
                connect_via_raspi_config
                check_connection
            fi
            ;;
        3)
            show_banner
            check_connection
            ;;
        4)
            connect_via_raspi_config
            show_banner
            check_connection
            ;;
        5)
            echo "Restarting network interfaces..."
            systemctl restart NetworkManager 2>/dev/null || true
            systemctl restart wpa_supplicant 2>/dev/null || true
            sleep 2
            echo -e "${GREEN}Network services refreshed.${NC}"
            check_connection
            ;;
        6)
            echo ""
            break
            ;;
        7)
            echo -e "\n${YELLOW}Kiosk mode remains stopped.${NC}"
            rm -f /tmp/printbooth_kiosk_paused 2>/dev/null || true
            pkill -f "start_kiosk.sh" 2>/dev/null || true
            echo -e "To return to kiosk mode later, run:"
            if [ "$WAS_SERVICE_ACTIVE" -eq 1 ]; then
                echo -e "  ${GREEN}sudo systemctl start printbooth-display.service${NC}"
            else
                echo -e "  ${GREEN}bash $START_SCRIPT${NC}"
            fi
            exit 0
            ;;
        *)
            echo "Invalid option. Please choose 1-7."
            ;;
    esac
done

# ── 4. Resume Kiosk Mode ──────────────────────────────────────────────────────
echo -e "${GREEN}══════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  Resuming PrintBooth Kiosk Display...${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════════════${NC}"

# Remove pause lock so waiting start_kiosk.sh immediately awakens
rm -f /tmp/printbooth_kiosk_paused 2>/dev/null || true

if [ "$WAS_SERVICE_ACTIVE" -eq 1 ]; then
    echo "Starting printbooth-display.service..."
    systemctl start printbooth-display.service
    echo -e "${GREEN}✓ Kiosk service restarted successfully!${NC}"
elif pgrep -f "start_kiosk.sh" >/dev/null; then
    echo -e "${GREEN}✓ Existing kiosk supervisor detected. Resuming display...${NC}"
else
    ACTUAL_USER="${SUDO_USER:-$USER}"
    echo "Spawning kiosk display as user '$ACTUAL_USER'..."
    export DISPLAY="${DISPLAY:-:0}"
    su - "$ACTUAL_USER" -c "DISPLAY=${DISPLAY:-:0} bash '$START_SCRIPT'" &
    echo -e "${GREEN}✓ Kiosk supervisor launched in background!${NC}"
fi

sleep 1
echo -e "\nDone! Kiosk display is now active."
