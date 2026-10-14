#!/usr/bin/env bash
# ==============================================================================
# PrintBooth Kiosk — Master Raspberry Pi Disk Space Recovery & Auto-Maintenance
# ==============================================================================
# Safely purges accumulated disk waste on Raspberry Pi:
#   1. APT cache and orphaned package archives (/var/cache/apt/archives)
#   2. Systemd journal bloat (vacuums down to 50MB and caps future size)
#   3. Old rotated and compressed system logs (/var/log/*.gz, *.1)
#   4. CUPS spooler leftover job files (/var/spool/cups/)
#   5. NPM cache (~/.npm/_cacache) and Pip cache (~/.cache/pip)
#   6. Chromium disk cache and GPU shader bloat (~/.cache/chromium)
#   7. Temporary document conversion files (/tmp/printbooth_jobs, /tmp/lu*)
#   8. Installs an automated daily maintenance cron so space never runs out again
# ==============================================================================

set -u

echo "══════════════════════════════════════════════════════════════════"
echo "  PrintBooth Kiosk — Raspberry Pi Disk Space Recovery           "
echo "══════════════════════════════════════════════════════════════════"

# Show initial disk usage
echo -e "\n📊 Initial Disk Space:"
df -h /

# 1. Clean APT package cache and remove orphaned packages
echo -e "\n[1/8] Cleaning APT cache and orphaned packages..."
if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get clean -y 2>/dev/null || true
    sudo apt-get autoclean -y 2>/dev/null || true
    sudo apt-get autoremove --purge -y 2>/dev/null || true
    sudo rm -rf /var/cache/apt/archives/*.deb 2>/dev/null || true
    echo "✓ APT package cache purged."
fi

# 2. Vacuum systemd journal logs and enforce 50MB ceiling
echo -e "\n[2/8] Vacuuming systemd journal logs..."
if command -v journalctl >/dev/null 2>&1; then
    sudo journalctl --vacuum-size=50M 2>/dev/null || true
    sudo journalctl --vacuum-time=2d 2>/dev/null || true

    # Permanently cap journald disk usage in /etc/systemd/journald.conf
    JOURNALD_CONF="/etc/systemd/journald.conf"
    if [ -f "$JOURNALD_CONF" ]; then
        sudo sed -i 's/^#\?SystemMaxUse=.*/SystemMaxUse=50M/' "$JOURNALD_CONF" 2>/dev/null || true
        sudo sed -i 's/^#\?SystemMaxFileSize=.*/SystemMaxFileSize=10M/' "$JOURNALD_CONF" 2>/dev/null || true
        if ! grep -q "^SystemMaxUse=50M" "$JOURNALD_CONF" 2>/dev/null; then
            echo "SystemMaxUse=50M" | sudo tee -a "$JOURNALD_CONF" >/dev/null 2>&1 || true
        fi
        if ! grep -q "^SystemMaxFileSize=10M" "$JOURNALD_CONF" 2>/dev/null; then
            echo "SystemMaxFileSize=10M" | sudo tee -a "$JOURNALD_CONF" >/dev/null 2>&1 || true
        fi
        sudo systemctl restart systemd-journald 2>/dev/null || true
        echo "✓ Journald capped at 50MB max disk usage."
    fi
fi

# 3. Purge rotated and compressed logs in /var/log
echo -e "\n[3/8] Removing archived/compressed system logs..."
sudo find /var/log -type f \( -name "*.gz" -o -name "*.1" -o -name "*.old" -o -name "*.xz" \) -delete 2>/dev/null || true
# Truncate large active log files if exceeding 50MB
for log_file in /var/log/syslog /var/log/messages /var/log/daemon.log /var/log/cups/error_log /var/log/cups/access_log /var/log/cups/page_log; do
    if [ -f "$log_file" ]; then
        size=$(stat -c%s "$log_file" 2>/dev/null || echo 0)
        if [ "$size" -gt 52428800 ]; then # > 50MB
            echo "" | sudo tee "$log_file" >/dev/null 2>&1 || true
            echo "✓ Truncated oversized log: $log_file"
        fi
    fi
done
echo "✓ Old rotated logs purged."

# 4. Clean CUPS spooler leftover files
echo -e "\n[4/8] Purging CUPS print spooler files..."
if [ -d "/var/spool/cups" ]; then
    sudo rm -rf /var/spool/cups/c* /var/spool/cups/d* /var/spool/cups/tmp/* 2>/dev/null || true
    # Restart CUPS so it releases held file descriptors for deleted spool files
    sudo systemctl restart cups 2>/dev/null || true
    echo "✓ CUPS spooler cache purged and daemon refreshed."
fi

# 5. Clean NPM & Pip development caches
echo -e "\n[5/8] Cleaning NPM and Pip package caches..."
npm cache clean --force 2>/dev/null || true
rm -rf "$HOME/.npm" "$HOME/.cache/pip" "$HOME/.cache/pip-tools" 2>/dev/null || true
sudo rm -rf /root/.npm /root/.cache/pip 2>/dev/null || true
for user_home in /home/*; do
    if [ -d "$user_home" ]; then
        rm -rf "$user_home/.npm" "$user_home/.cache/pip" 2>/dev/null || true
    fi
done
echo "✓ Package manager caches purged."

# 6. Clean Chromium browser and GPU caches
echo -e "\n[6/8] Purging Chromium browser disk caches..."
rm -rf "$HOME/.cache/chromium" "$HOME/.cache/chromium-browser" "$HOME/.cache/google-chrome" 2>/dev/null || true
for user_home in /home/*; do
    if [ -d "$user_home" ]; then
        rm -rf "$user_home/.cache/chromium" "$user_home/.cache/chromium-browser" "$user_home/.cache/google-chrome" 2>/dev/null || true
        rm -rf "$user_home/.config/chromium/Default/GPUCache" "$user_home/.config/chromium/Default/Cache" 2>/dev/null || true
    fi
done
echo "✓ Chromium disk cache purged."

# 7. Clean temporary files and stale print documents
echo -e "\n[7/8] Cleaning temporary print and document conversion directories..."
rm -rf /tmp/printbooth_jobs/* 2>/dev/null || true
rm -rf /tmp/printbooth_* 2>/dev/null || true
rm -rf /tmp/lu* /tmp/.com.sun.star* 2>/dev/null || true # LibreOffice temp conversions
rm -rf /var/tmp/* 2>/dev/null || true

# Purge persistent temp jobs and old UI build backups in kiosk repository
KIOSK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rm -rf "$KIOSK_ROOT/brain/data/temp_jobs"/* 2>/dev/null || true
rm -rf "$KIOSK_ROOT/ui/dist.bak" 2>/dev/null || true
echo "✓ Temporary files and conversion caches purged."

# 8. Install automated daily cron maintenance
echo -e "\n[8/8] Installing autonomous daily maintenance cron..."
CRON_DAILY="/etc/cron.daily/printbooth-disk-cleanup"
cat << 'EOF' | sudo tee "$CRON_DAILY" >/dev/null
#!/bin/sh
# PrintBooth autonomous daily disk space guard
set -e

# Clean APT archives
command -v apt-get >/dev/null 2>&1 && apt-get clean -y >/dev/null 2>&1 || true
rm -f /var/cache/apt/archives/*.deb >/dev/null 2>&1 || true

# Vacuum journal logs down to 50MB
command -v journalctl >/dev/null 2>&1 && journalctl --vacuum-size=50M --vacuum-time=2d >/dev/null 2>&1 || true

# Clean old compressed logs
find /var/log -type f \( -name "*.gz" -o -name "*.1" -o -name "*.old" \) -delete >/dev/null 2>&1 || true

# Purge stale temp jobs older than 1 hour
find /tmp/printbooth_jobs -type f -mmin +60 -delete >/dev/null 2>&1 || true
find /tmp -maxdepth 1 -name "lu*" -mmin +60 -delete >/dev/null 2>&1 || true

# Purge CUPS spool leftovers older than 1 day
find /var/spool/cups -type f -mtime +1 -delete >/dev/null 2>&1 || true

# Clean browser caches
rm -rf /home/*/.cache/chromium/Default/Cache/* >/dev/null 2>&1 || true

exit 0
EOF

sudo chmod +x "$CRON_DAILY" 2>/dev/null || true
echo "✓ Automated daily maintenance installed in /etc/cron.daily/printbooth-disk-cleanup."

# Show final recovered disk space
echo -e "\n══════════════════════════════════════════════════════════════════"
echo "  🎉 Cleanup Complete! Current Disk Space:                      "
echo "══════════════════════════════════════════════════════════════════"
df -h /
echo ""
