#!/usr/bin/env bash
# ==============================================================================
# PrintBooth — Clear Stuck Spool Claims & Reset Kiosk Spooler
# ==============================================================================
# Run this on the Raspberry Pi when an order gets stuck with:
# "[CUPS Spooler] [BLOCKED] Prevented duplicate print!"
# ==============================================================================

set -e

echo "════════════════════════════════════════════════════════"
echo "  PrintBooth Reset Spool Claims & Queues"
echo "════════════════════════════════════════════════════════"

# 1. Clear persistent claim files that block re-printing
echo "\n[1/4] Clearing lock files and spool claim caches..."
for d in "$HOME/kiosk/brain/data" "/var/lib/printbooth" "/tmp/printbooth_jobs" "$(pwd)/kiosk/brain/data"; do
    if [ -d "$d" ]; then
        rm -f "$d/.spool_claims.json" "$d/.spool_claims.lock" "$d/.order_tracker.lock" 2>/dev/null || true
        echo "✓ Cleared claim files in $d"
    fi
done

# 2. Clear corrupted temporary dummy PDF files in /tmp/printbooth_jobs
echo "\n[2/4] Purging temporary job spool files..."
if [ -d "/tmp/printbooth_jobs" ]; then
    rm -rf /tmp/printbooth_jobs/* 2>/dev/null || true
    echo "✓ Purged /tmp/printbooth_jobs"
fi

# 3. Cancel any stuck/hung CUPS spool jobs
echo "\n[3/4] Flushing CUPS queue..."
cancel -a -x 2>/dev/null || true
sudo cancel -a -x 2>/dev/null || true
cupsenable PrintBooth_Printer 2>/dev/null || true
cupsaccept PrintBooth_Printer 2>/dev/null || true
echo "✓ CUPS queue cleared and unpaused"

# 4. Prompt to restart ws_kiosk_client
echo "\n[4/4] Done!"
echo "If ws_kiosk_client.py is running in a terminal, press Ctrl+C and restart it:"
echo "  cd ~/kiosk/brain && python3 ws_kiosk_client.py"
echo "Or if it runs as a systemd service:"
echo "  sudo systemctl restart printbooth-kiosk.service 2>/dev/null || true"
echo "════════════════════════════════════════════════════════"
