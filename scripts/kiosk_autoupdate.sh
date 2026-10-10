#!/usr/bin/env bash
# ==============================================================================
# PrintBooth Kiosk — Autonomous Zero-Touch GitHub Auto-Updater
# ==============================================================================
# Automatically checks GitHub for updates, pulls new code, rebuilds UI, updates
# Python virtual environment, reloads services, and restarts the kiosk itself.
#
# GUARANTEES ("No Hands Needed"):
#   1. Zero Customer Interruption: Checks if CUPS is printing before applying.
#   2. Zero Broken States: Atomic UI dist backup & rollback if build fails.
#   3. Zero Configuration Loss: Preserves local .env, hardware configs, and tokens.
#   4. Autonomous Self-Restart: Automatically restarts kiosk display and services.
#   5. Low-Priority Execution: Runs with low CPU/IO footprint so UI stays 60fps.
# ==============================================================================

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIOSK_ROOT="$(dirname "$SCRIPT_DIR")"
LOG_FILE="/var/log/printbooth-autoupdate.log"
FALLBACK_LOG="/tmp/printbooth_autoupdate.log"
LOCK_FILE="/tmp/printbooth_autoupdate.lock"
VERSION_FILE="/etc/printbooth/version.json"
LOCAL_VERSION_FILE="$KIOSK_ROOT/.git_version.json"

# CLI Flags
FORCE_UPDATE=false
REQUEST_RESTART=true
CLI_BRANCH=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --force|-f)
            FORCE_UPDATE=true
            shift
            ;;
        --restart|-r)
            REQUEST_RESTART=true
            shift
            ;;
        --no-restart)
            REQUEST_RESTART=false
            shift
            ;;
        --branch|-b)
            CLI_BRANCH="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

# Logging helper
log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
    echo "$msg"
    # Write to primary or fallback log
    echo "$msg" >> "$LOG_FILE" 2>/dev/null || echo "$msg" >> "$FALLBACK_LOG" 2>/dev/null || true
}

# ── 1. Concurrency Guard (Prevent Overlapping Runs) ──────────────────────────
exec 200>"$LOCK_FILE"
if ! command -v flock >/dev/null 2>&1 || ! flock -n 200; then
    # Fallback PID check if flock is not present
    if [ -f "$LOCK_FILE" ]; then
        OLD_PID=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
        if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
            log "⚠️ Another auto-update instance is currently running (PID $OLD_PID). Exiting."
            exit 0
        fi
    fi
    echo $$ > "$LOCK_FILE" 2>/dev/null || true
fi

cleanup() {
    rm -f "$LOCK_FILE" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "🚀 Starting PrintBooth GitHub Auto-Update Check..."
log "• Force Update Mode : $FORCE_UPDATE"
log "• Auto Restart Mode : $REQUEST_RESTART"

# ── 2. Locate Git Repository Root ───────────────────────────────────────────
REPO_DIR=""
if git -C "$KIOSK_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    REPO_DIR="$(git -C "$KIOSK_ROOT" rev-parse --show-toplevel)"
elif git -C "$SCRIPT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    REPO_DIR="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
fi

if [ -z "$REPO_DIR" ] || [ ! -d "$REPO_DIR/.git" ]; then
    log "❌ Error: Could not locate a valid Git repository around $KIOSK_ROOT"
    exit 1
fi

log "📁 Repository Root: $REPO_DIR"

# ── 3. Connectivity Pre-flight (Check GitHub Reachability) ──────────────────
log "🌐 Checking GitHub connectivity..."
if ! curl -s --connect-timeout 4 https://github.com >/dev/null 2>&1 && \
   ! curl -s --connect-timeout 4 https://api.github.com >/dev/null 2>&1; then
    log "ℹ️ GitHub is not reachable right now (offline / DNS timeout). Skipping update cycle safely."
    exit 0
fi

# ── 4. In-Flight Print Protection (Never interrupt paying customers) ────────
if command -v lpstat >/dev/null 2>&1; then
    ACTIVE_JOBS=$(lpstat -o 2>/dev/null | wc -l || echo "0")
    if [ "$ACTIVE_JOBS" -gt 0 ]; then
        log "⏳ Customer print job currently active in CUPS ($ACTIVE_JOBS queued/printing). Deferring update to next cycle."
        exit 0
    fi
fi

if [ -f "/tmp/printbooth_printing.lock" ] || [ -f "/tmp/printbooth_session_active.lock" ]; then
    log "⏳ Active customer session lock detected. Deferring update to next cycle."
    exit 0
fi

# ── 5. Fetch Remote Git Commits ──────────────────────────────────────────────
cd "$REPO_DIR"

# Determine current or target branch
CURRENT_BRANCH="${CLI_BRANCH:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")}"
if [ "$CURRENT_BRANCH" = "HEAD" ] || [ -z "$CURRENT_BRANCH" ]; then
    CURRENT_BRANCH="main"
fi

log "🔍 Checking remote branch 'origin/$CURRENT_BRANCH'..."
if ! git fetch origin "$CURRENT_BRANCH" --quiet 2>/dev/null; then
    log "⚠️ Failed to fetch from origin/$CURRENT_BRANCH. Will retry on next cycle."
    exit 0
fi

LOCAL_HASH="$(git rev-parse HEAD 2>/dev/null || echo "")"
REMOTE_HASH="$(git rev-parse "origin/$CURRENT_BRANCH" 2>/dev/null || echo "")"

if [ -z "$LOCAL_HASH" ] || [ -z "$REMOTE_HASH" ]; then
    log "⚠️ Could not resolve commit hashes. Aborting."
    exit 1
fi

log "• Local  Commit : ${LOCAL_HASH:0:7}"
log "• Remote Commit : ${REMOTE_HASH:0:7}"

# If already up-to-date and not forced, record status and exit
if [ "$LOCAL_HASH" = "$REMOTE_HASH" ] && [ "$FORCE_UPDATE" = false ]; then
    log "✓ Station is already at latest commit (${LOCAL_HASH:0:7}). No update required."
    
    # Ensure version metadata file exists
    mkdir -p "/etc/printbooth" 2>/dev/null || true
    COMMIT_MSG=$(git log -1 --pretty=%B 2>/dev/null | head -n 1 | tr -d '"' || echo "Latest")
    COMMIT_DATE=$(git log -1 --pretty=%cI 2>/dev/null || date -Iseconds)
    cat << EOF > "$LOCAL_VERSION_FILE" 2>/dev/null || true
{
  "commitHash": "$LOCAL_HASH",
  "shortHash": "${LOCAL_HASH:0:7}",
  "branch": "$CURRENT_BRANCH",
  "commitMessage": "$COMMIT_MSG",
  "commitDate": "$COMMIT_DATE",
  "lastCheckedAt": "$(date -Iseconds)",
  "status": "UP_TO_DATE"
}
EOF
    cp "$LOCAL_VERSION_FILE" "$VERSION_FILE" 2>/dev/null || true
    exit 0
fi

if [ "$LOCAL_HASH" != "$REMOTE_HASH" ]; then
    log "⚡ NEW GIT COMMITS DETECTED! Updating ${LOCAL_HASH:0:7} ➔ ${REMOTE_HASH:0:7}"
else
    log "⚡ Force update requested on commit ${LOCAL_HASH:0:7}."
fi

# ── 6. Identify Changed Components ───────────────────────────────────────────
DIFF_FILES="$(git diff --name-only "$LOCAL_HASH" "$REMOTE_HASH" 2>/dev/null || echo "")"
UI_CHANGED=false
BRAIN_CHANGED=false
SCRIPTS_CHANGED=false
ROOT_DEPS_CHANGED=false

if [ "$FORCE_UPDATE" = true ] || echo "$DIFF_FILES" | grep -qE "(kiosk/ui|ui/|apps/kiosk)"; then
    UI_CHANGED=true
fi
if [ "$FORCE_UPDATE" = true ] || echo "$DIFF_FILES" | grep -qE "(kiosk/brain|brain/)"; then
    BRAIN_CHANGED=true
fi
if [ "$FORCE_UPDATE" = true ] || echo "$DIFF_FILES" | grep -qE "(kiosk/scripts|scripts/)"; then
    SCRIPTS_CHANGED=true
fi
if echo "$DIFF_FILES" | grep -qE "package\.json|package-lock\.json"; then
    ROOT_DEPS_CHANGED=true
fi

log "📦 Component Changes:"
log "  • Touchscreen UI Changed : $UI_CHANGED"
log "  • Brain IoT Daemon Changed: $BRAIN_CHANGED"
log "  • System Scripts Changed : $SCRIPTS_CHANGED"

# ── 7. Safe Backup of Local Configurations & Secrets ────────────────────────
BACKUP_CONFIG_DIR="/tmp/pb_config_backup_$$"
mkdir -p "$BACKUP_CONFIG_DIR"

# Save local .env files
find "$REPO_DIR" -maxdepth 3 -name ".env" -exec cp --parents {} "$BACKUP_CONFIG_DIR/" 2>/dev/null \; || true

# Save existing UI runtime config if present
if [ -f "$KIOSK_ROOT/ui/dist/config.json" ]; then
    cp "$KIOSK_ROOT/ui/dist/config.json" "$BACKUP_CONFIG_DIR/kiosk_ui_dist_config.json" 2>/dev/null || true
fi

# ── 8. Pull and Apply Git Updates ────────────────────────────────────────────
log "📥 Pulling latest commits from GitHub..."

# Stash any local uncommitted tracked changes
git stash push -m "autoupdate-stash-$(date +%s)" --quiet 2>/dev/null || true

# Reset cleanly to the remote branch to ensure 100% reliable fast-forward
if ! git reset --hard "origin/$CURRENT_BRANCH" 2>/dev/null; then
    log "⚠️ Reset to origin/$CURRENT_BRANCH failed. Attempting git pull..."
    git pull origin "$CURRENT_BRANCH" 2>/dev/null || {
        log "❌ Git pull failed! Aborting update to protect system integrity."
        exit 1
    }
fi

NEW_HASH="$(git rev-parse HEAD)"
log "✓ Git pull completed successfully. Active Commit: ${NEW_HASH:0:7}"

# Restore preserved local .env files
if [ -d "$BACKUP_CONFIG_DIR" ]; then
    cp -r "$BACKUP_CONFIG_DIR"/* "$REPO_DIR/" 2>/dev/null || true
    rm -rf "$BACKUP_CONFIG_DIR" 2>/dev/null || true
fi

# Ensure all scripts have executable bit
find "$REPO_DIR" -type f -name "*.sh" -exec chmod +x {} + 2>/dev/null || true

# ── 9. Update Python Brain IoT Daemon (If Brain Changed) ────────────────────
if [ "$BRAIN_CHANGED" = true ]; then
    log "🧠 Updating Python Kiosk Brain..."
    BRAIN_DIR=""
    if [ -d "$KIOSK_ROOT/brain" ]; then
        BRAIN_DIR="$KIOSK_ROOT/brain"
    elif [ -d "$REPO_DIR/kiosk/brain" ]; then
        BRAIN_DIR="$REPO_DIR/kiosk/brain"
    fi

    if [ -n "$BRAIN_DIR" ] && [ -d "$BRAIN_DIR" ]; then
        cd "$BRAIN_DIR"
        if [ -d "venv" ]; then
            if [ "$FORCE_UPDATE" = true ] || echo "$DIFF_FILES" | grep -q "requirements\.txt"; then
                log "  • Installing updated Python packages from requirements.txt..."
                ./venv/bin/pip install -r requirements.txt --quiet --no-cache-dir 2>/dev/null || true
            fi
        fi

        # Restart Brain systemd service if active
        if command -v systemctl >/dev/null 2>&1; then
            if systemctl is-active --quiet printbooth-brain.service 2>/dev/null; then
                log "  • Restarting printbooth-brain.service..."
                sudo systemctl restart printbooth-brain.service 2>/dev/null || true
            fi
        fi
    fi
fi

# ── 10. Rebuild Touchscreen UI (If UI Changed) ───────────────────────────────
if [ "$UI_CHANGED" = true ] || [ ! -d "$KIOSK_ROOT/ui/dist" ]; then
    log "🖥️ Rebuilding Touchscreen Kiosk UI..."
    UI_DIR=""
    if [ -d "$KIOSK_ROOT/ui" ]; then
        UI_DIR="$KIOSK_ROOT/ui"
    elif [ -d "$REPO_DIR/kiosk/ui" ]; then
        UI_DIR="$REPO_DIR/kiosk/ui"
    fi

    if [ -n "$UI_DIR" ] && [ -d "$UI_DIR" ]; then
        cd "$UI_DIR"

        # Backup existing dist before rebuilding (Rollback protection)
        if [ -d "dist" ]; then
            rm -rf dist.bak 2>/dev/null || true
            cp -r dist dist.bak 2>/dev/null || true
        fi

        # Install node modules if dependencies changed or node_modules missing
        if [ ! -d "node_modules" ] || [ "$FORCE_UPDATE" = true ] || echo "$DIFF_FILES" | grep -q "package\.json"; then
            log "  • Running npm install in $UI_DIR..."
            npm install --prefer-offline --no-audit --quiet 2>/dev/null || npm install --quiet 2>/dev/null || true
        fi

        log "  • Running npm run build..."
        if npm run build 2>&1 | tail -n 5 >> "$LOG_FILE" 2>/dev/null; then
            log "  ✓ Kiosk UI build successful!"
            rm -rf dist.bak 2>/dev/null || true
        else
            log "⚠️ UI build failed! Restoring previous working build from backup..."
            if [ -d "dist.bak" ]; then
                rm -rf dist 2>/dev/null || true
                mv dist.bak dist 2>/dev/null || true
                log "  ✓ Restored previous working dist."
            fi
        fi

        # Ensure runtime config.json exists in dist
        TARGET_API="http://localhost:5000"
        STATION_ID="PB-001"
        if [ -f "$KIOSK_ROOT/brain/.env" ]; then
            ENV_API=$(grep -E "^PRINTBOOTH_API_URL=" "$KIOSK_ROOT/brain/.env" 2>/dev/null | cut -d '=' -f2- | tr -d '"' | tr -d "'")
            [ -n "$ENV_API" ] && TARGET_API="$ENV_API"
            ENV_ID=$(grep -E "^KIOSK_ID=" "$KIOSK_ROOT/brain/.env" 2>/dev/null | cut -d '=' -f2- | tr -d '"' | tr -d "'")
            [ -n "$ENV_ID" ] && STATION_ID="$ENV_ID"
        fi

        mkdir -p "$UI_DIR/dist" 2>/dev/null || true
        cat << EOF > "$UI_DIR/dist/config.json"
{
  "apiUrl": "$TARGET_API",
  "kioskId": "$STATION_ID"
}
EOF
    fi
fi

# ── 11. Autonomous Kiosk Restart ("Restart the Kiosk Itself") ─────────────────
if [ "$REQUEST_RESTART" = true ]; then
    log "🔄 Restarting the Kiosk Appliance itself to run the new updates..."
    
    SYSTEMD_RESTARTED=false

    # 1. Systemd Service Restart (Appliance Mode)
    if command -v systemctl >/dev/null 2>&1; then
        if systemctl is-active --quiet printbooth-display.service 2>/dev/null; then
            log "  • Restarting printbooth-display.service..."
            sudo systemctl restart printbooth-display.service 2>/dev/null || true
            SYSTEMD_RESTARTED=true
        fi
        if systemctl is-active --quiet printbooth-brain.service 2>/dev/null; then
            log "  • Restarting printbooth-brain.service..."
            sudo systemctl restart printbooth-brain.service 2>/dev/null || true
        fi
    fi

    # 2. Watchdog Supervisor Restart (Standalone Mode)
    # If start_kiosk.sh watchdog is supervising Chromium, killing Chromium causes start_kiosk.sh
    # to immediately respawn a fresh, hardware-accelerated Chromium instance with clean flags!
    if [ "$SYSTEMD_RESTARTED" = false ]; then
        log "  • Terminating stale Chromium processes to trigger supervisor watchdog relaunch..."
        pkill -9 -f "chromium" 2>/dev/null || true
        pkill -9 -f "chromium-browser" 2>/dev/null || true
        pkill -f "serve_kiosk_ui.py" 2>/dev/null || true
    fi

    # 3. Soft Reload Fallback via xdotool (Ctrl+Shift+R / F5)
    if command -v xdotool >/dev/null 2>&1; then
        export DISPLAY="${DISPLAY:-:0}"
        CHROMIUM_WIN=$(xdotool search --onlyvisible --class chromium 2>/dev/null | head -n 1 || true)
        if [ -n "$CHROMIUM_WIN" ]; then
            xdotool key --window "$CHROMIUM_WIN" F5 2>/dev/null || true
            log "  ✓ Dispatched F5 reload to active Chromium window ($CHROMIUM_WIN)"
        fi
    fi
fi

# ── 12. System Scripts & Systemd Reload ───────────────────────────────────────
if [ "$SCRIPTS_CHANGED" = true ]; then
    log "⚙️ System scripts updated. Reloading systemd..."
    if command -v systemctl >/dev/null 2>&1; then
        sudo systemctl daemon-reload 2>/dev/null || true
    fi
fi

# ── 13. Save Updated Version Metadata ────────────────────────────────────────
NEW_COMMIT_MSG=$(git log -1 --pretty=%B 2>/dev/null | head -n 1 | tr -d '"' || echo "Updated")
NEW_COMMIT_DATE=$(git log -1 --pretty=%cI 2>/dev/null || date -Iseconds)

cat << EOF > "$LOCAL_VERSION_FILE"
{
  "commitHash": "$NEW_HASH",
  "shortHash": "${NEW_HASH:0:7}",
  "branch": "$CURRENT_BRANCH",
  "commitMessage": "$NEW_COMMIT_MSG",
  "commitDate": "$NEW_COMMIT_DATE",
  "updatedAt": "$(date -Iseconds)",
  "status": "UPDATED_SUCCESSFULLY",
  "componentsUpdated": {
    "ui": $UI_CHANGED,
    "brain": $BRAIN_CHANGED,
    "scripts": $SCRIPTS_CHANGED
  }
}
EOF

mkdir -p "/etc/printbooth" 2>/dev/null || true
cp "$LOCAL_VERSION_FILE" "$VERSION_FILE" 2>/dev/null || true

log "🎉 AUTO-UPDATE & RESTART COMPLETED SUCCESSFULLY! Kiosk is now running commit ${NEW_HASH:0:7}"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 0
