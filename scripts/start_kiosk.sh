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

# 4. Ensure Touchscreen UI is running locally
DISPLAY_URL="${KIOSK_DISPLAY_URL:-http://localhost:5175}"
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

if [ -d "$UI_DIR/dist" ] && ! curl -s --connect-timeout 1 "$DISPLAY_URL" > /dev/null 2>&1; then
    echo "[Start Kiosk] Serving pre-built Kiosk UI from $UI_DIR/dist on port 5175..."
    python3 -m http.server 5175 --bind 0.0.0.0 --directory "$UI_DIR/dist" >> /tmp/printbooth_ui.log 2>&1 &
    sleep 1
fi

echo "════════════════════════════════════════════════════════"
echo "  PrintBooth Kiosk UI is LIVE! 🚀"
echo "  • Local (on Pi HDMI) : http://localhost:5175"
echo "  • On your PC Monitor : http://${LOCAL_IP}:5175"
echo "════════════════════════════════════════════════════════"

# 5. Launch Chromium in strict fullscreen Kiosk Mode if display exists
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
    echo "[Start Kiosk] Launching Touchscreen Display at $DISPLAY_URL..."
    exec "$CHROMIUM_CMD" \
        --kiosk \
        --noerrdialogs \
        --disable-infobars \
        --check-for-update-interval=31536000 \
        --disable-pinch \
        --disable-translate \
        --overscroll-history-navigation=0 \
        --disable-session-crashed-bubble \
        --incognito \
        "$DISPLAY_URL"
else
    echo "[!] Chromium not installed. You can interact with the UI directly from your PC at: http://${LOCAL_IP}:5175"
fi
