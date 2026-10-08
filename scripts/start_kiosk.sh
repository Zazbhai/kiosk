#!/usr/bin/env bash
# ==============================================================================
# PrintBooth Kiosk — Supervised Autonomous Touchscreen Terminal & Brain
# ==============================================================================
# 1. Purges ghost print jobs from previous sessions on boot
# 2. Enforces pure Obsidian black canvas (#06110D) — ZERO desktop leak
# 3. Starts Brain Daemon and WSS Client
# 4. Cleans Chromium crash flags and SingletonLock
# 5. Supervises Chromium in high-performance GPU kiosk mode with auto-restart watchdog
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIOSK_ROOT="$(dirname "$SCRIPT_DIR")"
BRAIN_DIR="$KIOSK_ROOT/brain"
UI_DIR="$KIOSK_ROOT/ui"

echo "[Start Kiosk] Initializing PrintBooth Autonomous Appliance..."

# 0. Flush any stale/lingering print queue left from previous sessions
if command -v cancel > /dev/null 2>&1; then
    echo "[Start Kiosk] Purging any stale CUPS hardware print queue on boot..."
    cancel -a -x 2>/dev/null || true
    cancel -a 2>/dev/null || true
fi

# 1. Enforce Obsidian black background immediately (Zero desktop exposure)
if command -v xsetroot > /dev/null 2>&1; then
    xsetroot -solid "#06110D" 2>/dev/null || true
fi

# 1b. Display instant pre-Chromium hardware splash if available
SPLASH_PNG="/etc/printbooth/boot_splash.png"
if [ ! -f "$SPLASH_PNG" ] && [ -f "$SCRIPT_DIR/splash_assets/boot_splash_1080p.png" ]; then
    SPLASH_PNG="$SCRIPT_DIR/splash_assets/boot_splash_1080p.png"
fi
if command -v feh > /dev/null 2>&1 && [ -f "$SPLASH_PNG" ]; then
    feh --bg-fill "$SPLASH_PNG" 2>/dev/null || true
fi

# 2. Suppress mouse cursor on touchscreen
unclutter -idle 0.1 -root &

# 3. Disable screen blanking / screensaver
xset s noblank 2>/dev/null || true
xset s off 2>/dev/null || true
xset -dpms 2>/dev/null || true

# 4. Start Python Brain Daemon in background (if not already running via systemd)
if ! pgrep -f "daemon.py" > /dev/null; then
    echo "[Start Kiosk] Launching Kiosk Brain Daemon..."
    cd "$BRAIN_DIR"
    if [ -d "venv" ]; then
        source venv/bin/activate
    fi
    python3 daemon.py >> /tmp/printbooth_daemon.log 2>&1 &
fi

# 4b. Start WSS Kiosk Client in background (if not already running)
if ! pgrep -f "ws_kiosk_client.py" > /dev/null; then
    echo "[Start Kiosk] Launching WSS Kiosk Client..."
    cd "$BRAIN_DIR"
    if [ -d "venv" ]; then
        source venv/bin/activate
    fi
    python3 ws_kiosk_client.py >> /tmp/printbooth_ws.log 2>&1 &
fi

# 5. Extract Backend Spooler API URL from brain/.env or environment
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

# 6. Ensure Touchscreen UI HTTP server is running locally on port 5175
DISPLAY_URL="${KIOSK_DISPLAY_URL:-http://localhost:5175/?api=${TARGET_API}&kioskId=${STATION_ID}}"
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

if [ -d "$UI_DIR/dist" ] && ! curl -s --connect-timeout 1 "$DISPLAY_URL" > /dev/null 2>&1; then
    echo "[Start Kiosk] Serving pre-built Kiosk UI on port 5175 with instant exit listener..."
    python3 "$SCRIPT_DIR/serve_kiosk_ui.py" 5175 "$UI_DIR/dist" >> /tmp/printbooth_ui.log 2>&1 &
    sleep 1
fi

echo "════════════════════════════════════════════════════════"
echo "  PrintBooth Kiosk Appliance is LIVE! 🚀"
echo "  • Local (on Pi HDMI) : http://localhost:5175"
echo "  • LAN IP             : http://${LOCAL_IP}:5175"
echo "  • Spooler Backend    : ${TARGET_API}"
echo "  • Press Ctrl+C anytime to exit Supervisor"
echo "════════════════════════════════════════════════════════"

# Identify Chromium command
CHROMIUM_CMD=""
if command -v chromium >/dev/null 2>&1; then
    CHROMIUM_CMD="chromium"
elif command -v chromium-browser >/dev/null 2>&1; then
    CHROMIUM_CMD="chromium-browser"
fi

if [ -z "$CHROMIUM_CMD" ]; then
    echo "[!] Chromium not installed. UI accessible remotely at http://${LOCAL_IP}:5175"
    exit 1
fi

if [ -z "$DISPLAY" ]; then
    export DISPLAY=:0
fi

# Function to clean Chromium crash locks & bubbles
clean_chromium_crash_state() {
    # Remove process Singleton lock files
    rm -rf ~/.config/chromium/Singleton* 2>/dev/null || true
    rm -rf ~/.config/chromium-browser/Singleton* 2>/dev/null || true

    # Strip crash flag from Preferences so the "Restore pages" bubble never appears
    for pref in ~/.config/chromium/Default/Preferences ~/.config/chromium-browser/Default/Preferences; do
        if [ -f "$pref" ]; then
            python3 -c "
import json, sys
try:
    p = '$pref'
    with open(p, 'r') as f: data = json.load(f)
    if 'profile' in data:
        data['profile']['exit_type'] = 'Normal'
        data['profile']['exited_cleanly'] = True
    with open(p, 'w') as f: json.dump(data, f)
except Exception: pass
" 2>/dev/null || true
        fi
    done
}

# Trap Ctrl+C (SIGINT) and SIGTERM for technician clean exit
EXIT_REQUESTED=0
cleanup_and_exit() {
    EXIT_REQUESTED=1
    echo ""
    echo "[Start Kiosk] 🛑 Termination signal received. Stopping Kiosk processes..."
    pkill -f "$CHROMIUM_CMD" 2>/dev/null || true
    pkill -f serve_kiosk_ui.py 2>/dev/null || true
    pkill -f unclutter 2>/dev/null || true
    exit 0
}
trap cleanup_and_exit SIGINT SIGTERM

# 7. Dynamic Kiosk Supervisor Loop (Self-Healing Crash Watchdog)
CRASH_COUNT=0
while [ "$EXIT_REQUESTED" -eq 0 ]; do
    clean_chromium_crash_state

    echo "[Start Kiosk] Spawning Hardware-Accelerated Kiosk Display (Instance #$((CRASH_COUNT + 1)))..."
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
        --autoplay-policy=no-user-gesture-required \
        --hide-scrollbars \
        --num-raster-threads=2 \
        "$DISPLAY_URL"
    
    EXIT_CODE=$?
    echo "[Start Kiosk] Chromium exited with status $EXIT_CODE"

    if [ "$EXIT_REQUESTED" -eq 1 ]; then
        break
    fi

    CRASH_COUNT=$((CRASH_COUNT + 1))
    echo "[Start Kiosk] ⚠️ Kiosk window closed unexpectedly. Relaunching in 1s (crash protection active)..."
    
    # Keep screen solid obsidian during quick reload
    if command -v xsetroot > /dev/null 2>&1; then
        xsetroot -solid "#06110D" 2>/dev/null || true
    fi
    sleep 1
done

cleanup_and_exit
