#!/usr/bin/env bash
# ==============================================================================
# PrintBooth Kiosk — Robust Wi-Fi Terminal Launcher Wrapper
# ==============================================================================
# 1. Finds dynamic path to exit_kiosk_wifi.sh
# 2. Sets pause flag so start_kiosk.sh does not auto-restart Chromium
# 3. Kills Chromium to release display & hardware acceleration
# 4. Spawns visible terminal (lxterminal, xterm, x-terminal-emulator) on DISPLAY
# 5. Restores kiosk supervisor when done
# ==============================================================================

export DISPLAY="${DISPLAY:-:0}"
if [ -z "$XAUTHORITY" ]; then
    for auth in "$HOME/.Xauthority" "/home/kiosk/.Xauthority" "/home/pi/.Xauthority" "/tmp/.Xauthority"; do
        if [ -f "$auth" ]; then
            export XAUTHORITY="$auth"
            break
        fi
    done
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIOSK_ROOT="$(dirname "$SCRIPT_DIR")"

# 1. Locate exit_kiosk_wifi.sh dynamically
WIFI_SCRIPT=""
for cand in \
    "$SCRIPT_DIR/exit_kiosk_wifi.sh" \
    "$HOME/printer_automation/kiosk/scripts/exit_kiosk_wifi.sh" \
    "$HOME/kiosk/scripts/exit_kiosk_wifi.sh" \
    "/home/kiosk/printer_automation/kiosk/scripts/exit_kiosk_wifi.sh" \
    "/home/kiosk/kiosk/scripts/exit_kiosk_wifi.sh" \
    "/home/pi/printer_automation/kiosk/scripts/exit_kiosk_wifi.sh" \
    "/home/pi/kiosk/scripts/exit_kiosk_wifi.sh"; do
    if [ -f "$cand" ]; then
        WIFI_SCRIPT="$cand"
        break
    fi
done

if [ -z "$WIFI_SCRIPT" ]; then
    WIFI_SCRIPT=$(find /home -maxdepth 4 -name "exit_kiosk_wifi.sh" 2>/dev/null | head -n 1)
fi

if [ -z "$WIFI_SCRIPT" ] || [ ! -f "$WIFI_SCRIPT" ]; then
    echo "[!] exit_kiosk_wifi.sh not found!"
    exit 1
fi

chmod +x "$WIFI_SCRIPT"

# 2. Signal supervisor to pause
touch /tmp/printbooth_kiosk_paused

# 3. Release mouse cursor if unclutter was running
if command -v xsetroot >/dev/null 2>&1; then
    xsetroot -cursor_name left_ptr 2>/dev/null || true
fi

# 4. Find available terminal emulator
TERMINAL_EXEC=""
if command -v lxterminal >/dev/null 2>&1; then
    TERMINAL_EXEC="lxterminal --geometry=90x28 --title=PrintBooth-WiFi-Setup -e"
elif command -v x-terminal-emulator >/dev/null 2>&1; then
    TERMINAL_EXEC="x-terminal-emulator -e"
elif command -v xterm >/dev/null 2>&1; then
    TERMINAL_EXEC="xterm -fullscreen -title 'PrintBooth WiFi Setup' -fa Monospace -fs 14 -e"
elif command -v alacritty >/dev/null 2>&1; then
    TERMINAL_EXEC="alacritty -e"
elif command -v foot >/dev/null 2>&1; then
    TERMINAL_EXEC="foot"
elif command -v gnome-terminal >/dev/null 2>&1; then
    TERMINAL_EXEC="gnome-terminal --"
elif command -v xfce4-terminal >/dev/null 2>&1; then
    TERMINAL_EXEC="xfce4-terminal -e"
fi

RUNNER="/tmp/run_pb_wifi_worker.sh"
cat << EOF > "$RUNNER"
#!/bin/bash
export DISPLAY="${DISPLAY:-:0}"
export TERM=xterm-256color
# Restore cursor for technician
xsetroot -cursor_name left_ptr 2>/dev/null || true
# Execute Wi-Fi utility with sudo
sudo bash "$WIFI_SCRIPT"
# Clean up pause flag when finished
rm -f /tmp/printbooth_kiosk_paused 2>/dev/null || true
EOF
chmod +x "$RUNNER"

# 5. Terminate Chromium to give full screen focus to terminal
pkill -f "chromium" 2>/dev/null || true
pkill -f "chromium-browser" 2>/dev/null || true
sleep 0.2

# 6. Launch terminal or run directly in current tty
if [ -n "$TERMINAL_EXEC" ]; then
    $TERMINAL_EXEC "$RUNNER"
else
    # Terminal emulator missing: Try chvt or direct execution
    if [ -t 0 ]; then
        bash "$RUNNER"
    else
        # Try to install lxterminal if apt is available, else try xterm
        sudo apt-get install -y --no-install-recommends lxterminal xterm 2>/dev/null || true
        if command -v lxterminal >/dev/null 2>&1; then
            lxterminal --geometry=90x28 -e "$RUNNER"
        else
            bash "$RUNNER"
        fi
    fi
fi

# Clean up pause flag
rm -f /tmp/printbooth_kiosk_paused 2>/dev/null || true
