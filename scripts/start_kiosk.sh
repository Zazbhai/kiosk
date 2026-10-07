#!/usr/bin/env bash
# ==============================================================================
# PrintBooth Kiosk — Start Touchscreen Terminal & Brain
# ==============================================================================
# Launches background brain daemon and opens Chromium in fullscreen kiosk mode.
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIOSK_ROOT="$(dirname "$SCRIPT_DIR")"
BRAIN_DIR="$KIOSK_ROOT/brain"
UI_DIR="$KIOSK_ROOT/ui"

echo "[Start Kiosk] Initializing PrintBooth Station..."

# 1. Hide mouse cursor on touchscreen after 1 second of inactivity
unclutter -idle 1 -root &

# 2. Disable screen blanking / screensaver
xset s noblank || true
xset s off || true
xset -dpms || true

# 3. Start Python Brain Daemon in background (if not already running via systemd)
if ! pgrep -f "daemon.py" > /dev/null; then
    echo "[Start Kiosk] Launching Kiosk Brain Daemon..."
    cd "$BRAIN_DIR"
    if [ -d "venv" ]; then
        source venv/bin/activate
    fi
    python3 daemon.py >> /tmp/printbooth_daemon.log 2>&1 &
fi

# 3b. Start WSS Kiosk Client in background (if not already running)
if ! pgrep -f "ws_kiosk_client.py" > /dev/null; then
    echo "[Start Kiosk] Launching WSS Kiosk Client..."
    cd "$BRAIN_DIR"
    if [ -d "venv" ]; then
        source venv/bin/activate
    fi
    python3 ws_kiosk_client.py >> /tmp/printbooth_ws.log 2>&1 &
fi

# 4. Extract Backend Spooler API URL from brain/.env or environment
TARGET_API="http://localhost:5000"
STATION_ID="PB-001"
if [ -f "$BRAIN_DIR/.env" ]; then
    ENV_API=$(grep -E "^PRINTBOOTH_API_URL=" "$BRAIN_DIR/.env" | cut -d '=' -f2- | tr -d '"' | tr -d "'" | sed 's|/api$||')
    if [ -n "$ENV_API" ]; then
        TARGET_API="$ENV_API"
    fi
    ENV_ID=$(grep -E "^KIOSK_ID=" "$BRAIN_DIR/.env" | cut -d '=' -f2- | tr -d '"' | tr -d "'")
    if [ -n "$ENV_ID" ]; then
        STATION_ID="$ENV_ID"
    fi
fi
if [ -n "$PRINTBOOTH_API_URL" ]; then
    TARGET_API="$PRINTBOOTH_API_URL"
fi
if [ -n "$KIOSK_ID" ]; then
    STATION_ID="$KIOSK_ID"
fi

# Ensure pre-built dist has up-to-date runtime config.json
if [ -d "$UI_DIR/dist" ]; then
    cat << EOF > "$UI_DIR/dist/config.json"
{
  "apiUrl": "$TARGET_API",
  "kioskId": "$STATION_ID"
}
EOF
fi

# 5. Ensure Touchscreen UI is running locally
DISPLAY_URL="${KIOSK_DISPLAY_URL:-http://localhost:5175/?api=${TARGET_API}&kioskId=${STATION_ID}}"
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

# Trap Ctrl+C (SIGINT) and SIGTERM to immediately terminate Chromium and kiosk mode
cleanup_and_exit() {
    echo ""
    echo "[Start Kiosk] 🛑 Ctrl+C detected! Terminating Kiosk Mode..."
    pkill -f chromium 2>/dev/null || true
    pkill -f chromium-browser 2>/dev/null || true
    pkill -f serve_kiosk_ui.py 2>/dev/null || true
    pkill -f unclutter 2>/dev/null || true
    exit 0
}
trap cleanup_and_exit SIGINT SIGTERM

if [ -d "$UI_DIR/dist" ] && ! curl -s --connect-timeout 1 "$DISPLAY_URL" > /dev/null 2>&1; then
    echo "[Start Kiosk] Serving pre-built Kiosk UI on port 5175 with instant exit listener..."
    python3 "$SCRIPT_DIR/serve_kiosk_ui.py" 5175 "$UI_DIR/dist" >> /tmp/printbooth_ui.log 2>&1 &
    sleep 1
fi

echo "════════════════════════════════════════════════════════"
echo "  PrintBooth Kiosk UI is LIVE! 🚀"
echo "  • Local (on Pi HDMI) : http://localhost:5175"
echo "  • On your PC Monitor : http://${LOCAL_IP}:5175"
echo "  • Spooler Backend    : ${TARGET_API}"
echo "  • Press Ctrl+C anytime to exit Kiosk Mode"
echo "════════════════════════════════════════════════════════"

# 6. Launch Chromium in strict fullscreen Kiosk Mode with GPU hardware acceleration
CHROMIUM_CMD=""
if command -v chromium >/dev/null 2>&1; then
    CHROMIUM_CMD="chromium"
elif command -v chromium-browser >/dev/null 2>&1; then
    CHROMIUM_CMD="chromium-browser"
fi

if [ -n "$CHROMIUM_CMD" ]; then
    if [ -z "$DISPLAY" ]; then
        export DISPLAY=:0
    fi
    echo "[Start Kiosk] Launching Hardware-Accelerated Touchscreen Display..."
    "$CHROMIUM_CMD" \
        --kiosk \
        --noerrdialogs \
        --disable-infobars \
        --check-for-update-interval=31536000 \
        --disable-pinch \
        --disable-translate \
        --overscroll-history-navigation=0 \
        --disable-session-crashed-bubble \
        --incognito \
        --enable-gpu-rasterization \
        --enable-oop-rasterization \
        --ignore-gpu-blocklist \
        --enable-zero-copy \
        --disable-smooth-scrolling \
        --canvas-msaa-sample-count=0 \
        --disable-background-timer-throttling \
        --disable-renderer-backgrounding \
        --disable-backgrounding-occluded-windows \
        --num-raster-threads=2 \
        "$DISPLAY_URL"
    
    # When Chromium closes (via Ctrl+C or window.close), clean up everything
    cleanup_and_exit
else
    echo "[!] Chromium not installed. You can interact with the UI directly from your PC at: http://${LOCAL_IP}:5175"
fi

