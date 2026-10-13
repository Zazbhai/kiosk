#!/usr/bin/env bash
# ==============================================================================
# PrintBooth Kiosk — Supervised Autonomous Touchscreen Terminal & Brain
# ==============================================================================
# 1. Single-instance flock guard (prevents concurrent systemd + autostart races)
# 2. Waits for display server (:0 / Wayland) to become active on cold boot
# 3. Purges ghost print jobs from previous sessions on boot & unpauses queues
# 4. Enforces pure Obsidian canvas (#06110D) — ZERO desktop leak
# 5. Starts Brain Daemon and WSS Client (with isolated user log files)
# 6. Cleans Chromium crash flags, locks, and GPU caches
# 7. Supervises Chromium in high-performance kiosk mode with auto-restart watchdog
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIOSK_ROOT="$(dirname "$SCRIPT_DIR")"
BRAIN_DIR="$KIOSK_ROOT/brain"
UI_DIR="$KIOSK_ROOT/ui"
CURRENT_USER="$(id -un 2>/dev/null || echo "kiosk")"

# ── 1. Single Instance Guard (Mutex) ─────────────────────────────────────────
# Prevents concurrent execution races (e.g. systemd service + desktop autostart)
LOCK_FILE="/tmp/start_kiosk_${CURRENT_USER}.lock"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
    echo "[Start Kiosk] ℹ Another instance of start_kiosk.sh is already running for '$CURRENT_USER'. Exiting duplicate."
    exit 0
fi

# ── 2. Display Environment & Readiness Check ─────────────────────────────────
export DISPLAY="${DISPLAY:-:0}"
if [ -z "$XAUTHORITY" ]; then
    for auth in "$HOME/.Xauthority" "/home/$CURRENT_USER/.Xauthority" "/home/kiosk/.Xauthority" "/home/pi/.Xauthority" "/tmp/.Xauthority"; do
        if [ -f "$auth" ]; then
            export XAUTHORITY="$auth"
            break
        fi
    done
fi

# On cold boot, wait up to 35 seconds for the display server (X11 / Wayland) to accept connections
echo "[Start Kiosk] Waiting for display server ($DISPLAY) to become active on boot..."
DISPLAY_READY=0
for _i in {1..35}; do
    if xset q >/dev/null 2>&1 || xdpyinfo >/dev/null 2>&1 || [ -n "$WAYLAND_DISPLAY" ]; then
        DISPLAY_READY=1
        echo "[Start Kiosk] Display server ($DISPLAY) is ready ✓"
        break
    fi
    sleep 1
done

if [ "$DISPLAY_READY" -eq 0 ]; then
    echo "[Start Kiosk] ⚠ Warning: Display server ($DISPLAY) not responding after 35s. Proceeding with launch attempt..."
fi

# ── 3. Isolated User Logs & State Cleanup ────────────────────────────────────
LOG_DIR="/tmp/printbooth_${CURRENT_USER}"
mkdir -p "$LOG_DIR" 2>/dev/null || LOG_DIR="/tmp"
chmod 777 "$LOG_DIR" 2>/dev/null || true

UI_LOG="$LOG_DIR/printbooth_ui.log"
WS_LOG="$LOG_DIR/printbooth_ws.log"
DAEMON_LOG="$LOG_DIR/printbooth_daemon.log"
BOOT_UPDATE_LOG="$LOG_DIR/printbooth_boot_update.log"

# Clean up any lingering maintenance or exit flags from prior sessions
rm -f /tmp/printbooth_kiosk_paused /tmp/printbooth_exit_requested 2>/dev/null || true

echo "[Start Kiosk] Initializing PrintBooth Autonomous Appliance for '$CURRENT_USER'..."

# ── 4. Flush Stale Hardware Print Queue & Unpause CUPS ────────────────────────
if command -v cancel > /dev/null 2>&1; then
    echo "[Start Kiosk] Purging any stale CUPS hardware print queue on boot..."
    cancel -a -x 2>/dev/null || true
    cancel -a 2>/dev/null || true
fi
if command -v cupsenable > /dev/null 2>&1; then
    cupsenable -a 2>/dev/null || true
    cupsaccept -a 2>/dev/null || true
fi

# ── 5. Background GitHub Auto-Update Check (Non-blocking) ────────────────────
if [ -f "$SCRIPT_DIR/kiosk_autoupdate.sh" ]; then
    echo "[Start Kiosk] Triggering background GitHub auto-update check..."
    bash "$SCRIPT_DIR/kiosk_autoupdate.sh" >> "$BOOT_UPDATE_LOG" 2>&1 &
fi

# ── 6. Display Pre-Chromium Canvas & Suppress Mouse Cursor ───────────────────
if command -v xsetroot > /dev/null 2>&1; then
    xsetroot -solid "#ffffff" 2>/dev/null || true
fi

SPLASH_PNG="/etc/printbooth/boot_splash.png"
if [ ! -f "$SPLASH_PNG" ] && [ -f "$SCRIPT_DIR/splash_assets/boot_splash_1080p.png" ]; then
    SPLASH_PNG="$SCRIPT_DIR/splash_assets/boot_splash_1080p.png"
fi
if command -v feh > /dev/null 2>&1 && [ -f "$SPLASH_PNG" ]; then
    feh --bg-fill "$SPLASH_PNG" 2>/dev/null || true
fi

# Suppress mouse cursor on touchscreen
unclutter -idle 0.1 -root &

# Disable screen blanking / screensaver
xset s noblank 2>/dev/null || true
xset s off 2>/dev/null || true
xset -dpms 2>/dev/null || true

# ── 7. Start Python Brain Daemon in background ───────────────────────────────
if ! pgrep -f "daemon.py" > /dev/null; then
    echo "[Start Kiosk] Launching Kiosk Brain Daemon..."
    (
        cd "$BRAIN_DIR" || exit 1
        if [ -d "venv" ]; then
            source venv/bin/activate
        fi
        python3 daemon.py >> "$DAEMON_LOG" 2>&1
    ) &
fi

# ── 8. Start WSS Kiosk Client in background ──────────────────────────────────
if ! pgrep -f "ws_kiosk_client.py" > /dev/null; then
    echo "[Start Kiosk] Launching WSS Kiosk Client..."
    (
        cd "$BRAIN_DIR" || exit 1
        if [ -d "venv" ]; then
            source venv/bin/activate
        fi
        python3 ws_kiosk_client.py >> "$WS_LOG" 2>&1
    ) &
fi

# ── 9. Extract Backend Spooler API URL from .env ─────────────────────────────
TARGET_API="https://api.printbooth.co.in"
STATION_ID="PB-001"

for env_file in "$KIOSK_ROOT/.env" "$BRAIN_DIR/.env"; do
    if [ -f "$env_file" ]; then
        ENV_API=$(grep -E "^PRINTBOOTH_API_URL=" "$env_file" | cut -d '=' -f2- | tr -d '"' | tr -d "'" | sed 's|/api/?$||')
        if [ -n "$ENV_API" ]; then
            TARGET_API="$ENV_API"
        fi
        ENV_ID=$(grep -E "^KIOSK_ID=" "$env_file" | cut -d '=' -f2- | tr -d '"' | tr -d "'")
        if [ -n "$ENV_ID" ]; then
            STATION_ID="$ENV_ID"
        fi
    fi
done

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

# ── 10. Ensure Touchscreen UI HTTP server is running on port 5175 ────────────
DISPLAY_URL="${KIOSK_DISPLAY_URL:-http://localhost:5175/?api=${TARGET_API}&kioskId=${STATION_ID}}"
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

if [ -d "$UI_DIR/dist" ]; then
    if ! curl -s --connect-timeout 1 "http://localhost:5175" > /dev/null 2>&1; then
        echo "[Start Kiosk] Serving pre-built Kiosk UI on port 5175..."
        python3 "$SCRIPT_DIR/serve_kiosk_ui.py" 5175 "$UI_DIR/dist" >> "$UI_LOG" 2>&1 &
    fi

    # Server readiness poll (up to 12s) to prevent Chromium ERR_CONNECTION_REFUSED
    echo "[Start Kiosk] Verifying local UI server availability on port 5175..."
    for _i in {1..24}; do
        if curl -s --connect-timeout 1 "http://localhost:5175" > /dev/null 2>&1; then
            echo "[Start Kiosk] Local UI server verified healthy ✓"
            break
        fi
        sleep 0.5
    done
fi

if [[ "$DISPLAY_URL" =~ ^https?:// ]] && [[ "$DISPLAY_URL" != *"localhost"* ]] && [[ "$DISPLAY_URL" != *"127.0.0.1"* ]]; then
    if ! curl -s --connect-timeout 2 "$DISPLAY_URL" > /dev/null 2>&1; then
        echo "[Start Kiosk] Remote site unreachable ($DISPLAY_URL). Falling back to local offline UI..."
        DISPLAY_URL="http://localhost:5175/?api=${TARGET_API}&kioskId=${STATION_ID}&offline=1"
    fi
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

# Define safe per-user kiosk profile directory (avoids permission collisions with root)
USER_PROFILE_DIR="${HOME:-/tmp}/.config/printbooth-kiosk-${CURRENT_USER}"
mkdir -p "$USER_PROFILE_DIR" 2>/dev/null || USER_PROFILE_DIR="/tmp/printbooth-kiosk-${CURRENT_USER}"
mkdir -p "$USER_PROFILE_DIR" 2>/dev/null || true

# Function to clean Chromium crash locks & bubbles
CRASH_COUNT=0
clean_chromium_crash_state() {
    pkill -9 -f "chromium.*type=utility" 2>/dev/null || true
    pkill -9 -f "chromium.*type=gpu-process" 2>/dev/null || true

    # If crashing repeatedly, wipe profile to clear corrupt databases/locks
    if [ "$CRASH_COUNT" -gt 0 ]; then
        rm -rf "$USER_PROFILE_DIR" 2>/dev/null || true
        mkdir -p "$USER_PROFILE_DIR" 2>/dev/null || true
    fi

    # Clean singleton locks, GPU cache and crash locks from profile
    rm -rf "$USER_PROFILE_DIR/Singleton"* 2>/dev/null || true
    rm -rf "$USER_PROFILE_DIR/Default/GPUCache"* 2>/dev/null || true
    rm -rf "$USER_PROFILE_DIR/Default/GCM Store"* 2>/dev/null || true
    rm -rf ~/.cache/chromium 2>/dev/null || true
    rm -rf ~/.cache/chromium-browser 2>/dev/null || true
    find "$USER_PROFILE_DIR" -name "*LOCK*" -o -name "*.lock" -o -name "*journal*" -delete 2>/dev/null || true

    # Remove process Singleton lock files in default user config
    rm -rf ~/.config/chromium/Singleton* 2>/dev/null || true
    rm -rf ~/.config/chromium-browser/Singleton* 2>/dev/null || true
    find ~/.config/chromium ~/.config/chromium-browser -name "*LOCK*" -o -name "*.lock" -delete 2>/dev/null || true

    # Strip crash flag from Preferences so the "Restore pages" bubble never appears
    for pref in "$USER_PROFILE_DIR/Default/Preferences" ~/.config/chromium/Default/Preferences ~/.config/chromium-browser/Default/Preferences; do
        if [ -f "$pref" ]; then
            python3 -c "
import json
try:
    with open('$pref', 'r') as f: data = json.load(f)
    if 'profile' in data:
        data['profile']['exit_type'] = 'Normal'
        data['profile']['exited_cleanly'] = True
    with open('$pref', 'w') as f: json.dump(data, f)
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
    if [ -n "$POPUP_WATCHDOG_PID" ]; then
        kill "$POPUP_WATCHDOG_PID" 2>/dev/null || true
    fi
    pkill -f "$CHROMIUM_CMD" 2>/dev/null || true
    pkill -f serve_kiosk_ui.py 2>/dev/null || true
    pkill -f unclutter 2>/dev/null || true
    exit 0
}
trap cleanup_and_exit SIGINT SIGTERM

# ── 11. Background Rogue Modal & Authentication Popup Killer Daemon ──────────
(
    while [ "$EXIT_REQUESTED" -eq 0 ]; do
        if command -v xdotool >/dev/null 2>&1; then
            for title in "Authentication" "Authentication Required" "Password" "Unlock Keyring" "Enter password to unlock" "PolicyKit" "Authentication is needed"; do
                xdotool search --onlyvisible --name "$title" windowclose 2>/dev/null || true
            done
            for cls in "polkit-gnome-authentication-agent-1" "lxpolkit" "gcr-prompter" "Pinentry"; do
                xdotool search --onlyvisible --class "$cls" windowclose 2>/dev/null || true
            done
        fi
        sleep 1
    done
) &
POPUP_WATCHDOG_PID=$!

# ── 12. Dynamic Kiosk Supervisor Loop (Watchdog) ─────────────────────────────
while [ "$EXIT_REQUESTED" -eq 0 ]; do
    clean_chromium_crash_state

    # Common rock-solid flags for Raspberry Pi touchscreen kiosk appliance
    COMMON_FLAGS=(
        --kiosk
        --noerrdialogs
        --disable-infobars
        --user-data-dir="$USER_PROFILE_DIR"
        --password-store=basic
        --use-mock-keychain
        --no-first-run
        --no-default-browser-check
        --no-sandbox
        --test-type
        --disable-gpu-sandbox
        --disable-dev-shm-usage
        --enable-gpu-rasterization
        --ignore-gpu-blocklist
        --disable-session-crashed-bubble
        --disable-crash-reporter
        --disable-crashpad
        --no-crash-upload
        --disable-breakpad
        --disable-hang-monitor
        --disable-notifications
        --disable-component-update
        --disable-translate
        --disable-pinch
        --overscroll-history-navigation=0
        --disable-background-networking
        --disable-sync
        --disable-metrics
        --disable-metrics-reporting
        --disable-background-timer-throttling
        --disable-renderer-backgrounding
        --disable-backgrounding-occluded-windows
        --autoplay-policy=no-user-gesture-required
        --enable-offline-auto-reload
        --enable-offline-auto-reload-visible-only
        --hide-scrollbars
        --check-for-update-interval=31536000
        --log-level=3
        --disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider
    )

    START_TIME=$(date +%s)

    if [ "$CRASH_COUNT" -eq 0 ]; then
        echo "[Start Kiosk] Spawning Kiosk Display with Hardware Acceleration (Instance #1)..."
        "$CHROMIUM_CMD" "${COMMON_FLAGS[@]}" \
            "$DISPLAY_URL"
    elif [ "$CRASH_COUNT" -eq 1 ]; then
        echo "[Start Kiosk] 🛡️ Fallback: Spawning Safe Software Rendering (Instance #2)..."
        "$CHROMIUM_CMD" "${COMMON_FLAGS[@]}" \
            --disable-gpu \
            "$DISPLAY_URL"
    else
        echo "[Start Kiosk] 🛡️ Fallback: Spawning Bulletproof Software Compositor (Instance #$((CRASH_COUNT + 1)))..."
        "$CHROMIUM_CMD" "${COMMON_FLAGS[@]}" \
            --disable-gpu \
            --disable-gpu-compositing \
            "$DISPLAY_URL"
    fi

    EXIT_CODE=$?
    END_TIME=$(date +%s)
    ELAPSED=$((END_TIME - START_TIME))
    echo "[Start Kiosk] Chromium exited with status $EXIT_CODE (Ran for ${ELAPSED}s)"

    # Clean exit requested by technician (via Ctrl+C, Ctrl+Q or /api/exit)
    if [ "$EXIT_REQUESTED" -eq 1 ] || [ -f "/tmp/printbooth_exit_requested" ]; then
        rm -f /tmp/printbooth_exit_requested 2>/dev/null || true
        echo "[Start Kiosk] 🛑 Kiosk exit requested. Terminating supervisor gracefully."
        break
    fi

    # Technician Maintenance / Wi-Fi Configuration Active
    if [ -f "/tmp/printbooth_kiosk_paused" ]; then
        echo "[Start Kiosk] ⏸️ Kiosk display paused for Wi-Fi management / technician maintenance."
        while [ -f "/tmp/printbooth_kiosk_paused" ]; do
            sleep 1
        done
        echo "[Start Kiosk] ▶️ Maintenance completed. Resuming autonomous kiosk display..."
        CRASH_COUNT=0
        continue
    fi

    # If it stayed running stably for at least 15s before closing, reset crash count
    if [ "$ELAPSED" -ge 15 ]; then
        CRASH_COUNT=0
    else
        CRASH_COUNT=$((CRASH_COUNT + 1))
    fi

    echo "[Start Kiosk] ⚠️ Kiosk window closed. Relaunching in 1s (crash protection active)..."

    # Keep screen solid obsidian during quick reload
    if command -v xsetroot > /dev/null 2>&1; then
        xsetroot -solid "#06110D" 2>/dev/null || true
    fi
    sleep 1
done

cleanup_and_exit
