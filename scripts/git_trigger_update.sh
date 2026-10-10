#!/usr/bin/env bash
# ==============================================================================
# PrintBooth Kiosk — Git Auto-Update & Autonomous Restart Trigger
# ==============================================================================
# Triggers immediate pull of latest GitHub changes and restarts the kiosk.
#
# USAGE:
#   bash git_trigger_update.sh             # Pulls latest GitHub commits & restarts kiosk
#   bash git_trigger_update.sh --force     # Forces re-pull, full rebuild & restart
#   bash git_trigger_update.sh --install   # Installs as git post-merge hook
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIOSK_ROOT="$(dirname "$SCRIPT_DIR")"
REPO_DIR=""

if git -C "$KIOSK_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    REPO_DIR="$(git -C "$KIOSK_ROOT" rev-parse --show-toplevel)"
elif git -C "$SCRIPT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    REPO_DIR="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
fi

# Optional flag: install as .git/hooks/post-merge hook
if [ "${1:-}" = "--install" ] || [ "${1:-}" = "-i" ]; then
    if [ -n "$REPO_DIR" ] && [ -d "$REPO_DIR/.git" ]; then
        HOOK_PATH="$REPO_DIR/.git/hooks/post-merge"
        cat << 'EOF' > "$HOOK_PATH"
#!/usr/bin/env bash
echo "[Git Hook] Post-merge detected. Triggering kiosk auto-update & restart..."
SCRIPT_DIR="$(git rev-parse --show-toplevel)/kiosk/scripts"
if [ -f "$SCRIPT_DIR/kiosk_autoupdate.sh" ]; then
    bash "$SCRIPT_DIR/kiosk_autoupdate.sh" --restart > /tmp/printbooth_git_hook.log 2>&1 &
fi
EOF
        chmod +x "$HOOK_PATH"
        echo "✓ Git post-merge auto-update hook installed successfully at $HOOK_PATH"
        exit 0
    else
        echo "❌ Could not find .git directory to install hook."
        exit 1
    fi
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 Triggering PrintBooth Git Auto-Update & Kiosk Restart..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

AUTOUPDATE_SCRIPT="$SCRIPT_DIR/kiosk_autoupdate.sh"
if [ ! -f "$AUTOUPDATE_SCRIPT" ]; then
    echo "❌ Error: Could not locate $AUTOUPDATE_SCRIPT"
    exit 1
fi

chmod +x "$AUTOUPDATE_SCRIPT" 2>/dev/null || true

# Forward flags to kiosk_autoupdate.sh with --restart enforced
bash "$AUTOUPDATE_SCRIPT" --restart "$@"
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo "✓ Git auto-update and kiosk restart triggered successfully!"
else
    echo "⚠️ Auto-update returned status code: $EXIT_CODE"
fi

exit $EXIT_CODE
