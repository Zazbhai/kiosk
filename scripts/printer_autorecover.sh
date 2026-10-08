#!/usr/bin/env bash
# ==============================================================================
# PrintBooth — Self-Healing Hardware Printer Auto-Recovery Engine
# ==============================================================================
# Resolves the common post-power-outage printer disappearance:
# 1. Accommodates Brother DCP-T420W ~50s mechanical boot time vs Pi's ~15s boot.
# 2. Sets CUPS error-policy=retry-current-job (prevents CUPS 'stop-printer' pause).
# 3. Unmasks & disables ipp-usb (prevents user-space daemon from locking USB).
# 4. Loads kernel usblp module (/dev/usb/lp0).
# 5. Automatically runs cupsenable & cupsaccept to unpause stopped queues.
# 6. Dynamically re-binds device-uri via lpinfo if USB port changed.
# ==============================================================================

set -e

PRINTER_NAME="${PRINTER_NAME:-PrintBooth_Printer}"
LOG_FILE="/tmp/printbooth_printer_recovery.log"

log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo "$msg"
    if [ -w "/var/log" ] 2>/dev/null; then
        echo "$msg" >> "/var/log/printbooth_printer_recovery.log" 2>/dev/null || true
    fi
    echo "$msg" >> "$LOG_FILE" 2>/dev/null || true
}

log "========================================================"
log "PrintBooth Hardware Auto-Recovery Started ($PRINTER_NAME)"
log "========================================================"

# Check if --boot-wait flag is passed (used by systemd on cold boot)
if [ "$1" = "--boot-wait" ]; then
    log "Cold boot mode: waiting up to 75s for printer mechanical self-test..."
    WAIT_SECS=0
    MAX_WAIT=75
    FOUND=0

    while [ $WAIT_SECS -lt $MAX_WAIT ]; do
        # Check USB bus for Brother (04f9) or generic printer
        if lsusb 2>/dev/null | grep -i -E "04f9|brother|printer" > /dev/null; then
            log "✓ Hardware detected on USB bus after ${WAIT_SECS}s!"
            FOUND=1
            # Give printer 3 seconds to complete USB enumeration
            sleep 3
            break
        fi
        sleep 5
        WAIT_SECS=$((WAIT_SECS + 5))
        log "Waiting for printer to power on & initialize... (${WAIT_SECS}s / ${MAX_WAIT}s)"
    done

    if [ $FOUND -eq 0 ]; then
        log "⚠ Printer not seen on USB after ${MAX_WAIT}s. Will still verify CUPS queue."
    fi
fi

# 1. Disable & mask ipp-usb conflict (Debian/Pi OS)
if command -v systemctl >/dev/null 2>&1; then
    if systemctl is-active --quiet ipp-usb 2>/dev/null; then
        log "Stopping conflicting ipp-usb service..."
        sudo systemctl stop ipp-usb 2>/dev/null || true
    fi
    sudo systemctl mask ipp-usb 2>/dev/null || true
fi

# 2. Ensure kernel usblp module is loaded
if ! lsmod | grep -q usblp; then
    log "Loading kernel usblp module..."
    sudo modprobe usblp 2>/dev/null || true
fi

# 3. Ensure CUPS daemon is active
if command -v systemctl >/dev/null 2>&1; then
    if ! systemctl is-active --quiet cups; then
        log "CUPS is stopped. Starting cups.service..."
        sudo systemctl start cups
        sleep 2
    fi
fi

# 4. Check physical USB presence
USB_DEV=$(lsusb 2>/dev/null | grep -i -E "04f9|brother|printer" | head -n 1 || true)
if [ -n "$USB_DEV" ]; then
    log "✓ USB Device confirmed: $USB_DEV"
else
    log "⚠ Warning: No USB printer listed in lsusb."
fi

# 5. Query active CUPS USB URI
ACTIVE_URI=$(sudo lpinfo -v 2>/dev/null | grep -i -E "direct usb://brother|usb://brother/dcp-t420w" | head -n 1 | awk '{print $2}' || true)
if [ -z "$ACTIVE_URI" ]; then
    ACTIVE_URI=$(sudo lpinfo -v 2>/dev/null | grep -E "usb://" | head -n 1 | awk '{print $2}' || true)
fi
if [ -z "$ACTIVE_URI" ] && [ -e "/dev/usb/lp0" ]; then
    ACTIVE_URI="usb:/dev/usb/lp0"
fi

if [ -n "$ACTIVE_URI" ]; then
    log "✓ Detected active printer URI: $ACTIVE_URI"
else
    log "ℹ No dynamic USB URI returned by lpinfo; checking existing queue config."
fi

# 6. Check if queue exists in CUPS
QUEUE_EXISTS=0
if lpstat -p "$PRINTER_NAME" >/dev/null 2>&1; then
    QUEUE_EXISTS=1
fi

if [ $QUEUE_EXISTS -eq 1 ]; then
    log "Updating existing queue '$PRINTER_NAME'..."

    # Re-bind URI if dynamic URI found
    if [ -n "$ACTIVE_URI" ]; then
        sudo lpadmin -p "$PRINTER_NAME" -v "$ACTIVE_URI" 2>/dev/null || true
    fi

    # CRITICAL: Change printer-error-policy so CUPS NEVER disables queue on power drop
    sudo lpadmin -p "$PRINTER_NAME" -o printer-error-policy=retry-current-job 2>/dev/null || true
    sudo lpadmin -d "$PRINTER_NAME" 2>/dev/null || true

    # PURGE GHOST JOBS: Flush any lingering or unprinted queue residue from prior sessions
    log "Purging any stale jobs from CUPS queue..."
    sudo cancel -a -x "$PRINTER_NAME" 2>/dev/null || true
    sudo cancel -a 2>/dev/null || true
    sudo lprm - 2>/dev/null || true

    # Prevent CUPS from retaining printed files in /var/spool/cups
    sudo cupsctl PreserveJobHistory=No PreserveJobFiles=No 2>/dev/null || true

    # Unpause and enable queue
    sudo cupsenable "$PRINTER_NAME" 2>/dev/null || true
    sudo cupsaccept "$PRINTER_NAME" 2>/dev/null || true
    sudo lpoptions -p "$PRINTER_NAME" -o media=A4 2>/dev/null || true
    log "✓ Unpaused and enabled queue '$PRINTER_NAME' (policy: retry-current-job, queue purged)"
else
    # Queue doesn't exist yet; if Brother PPD exists, register it
    PPD_PATH="/usr/share/cups/model/Brother/brother_dcpt420w_printer_en.ppd"
    if [ -f "$PPD_PATH" ]; then
        TARGET_URI="${ACTIVE_URI:-usb://Brother/DCP-T420W}"
        log "Registering missing queue '$PRINTER_NAME' with PPD $PPD_PATH and URI $TARGET_URI..."
        sudo lpadmin -p "$PRINTER_NAME" -E -v "$TARGET_URI" -P "$PPD_PATH" -o printer-error-policy=retry-current-job
        sudo lpadmin -d "$PRINTER_NAME"
        sudo cupsenable "$PRINTER_NAME"
        sudo cupsaccept "$PRINTER_NAME"
        sudo lpoptions -p "$PRINTER_NAME" -o media=A4 2>/dev/null || true
        log "✓ Created and enabled '$PRINTER_NAME'!"
    else
        log "⚠ Queue '$PRINTER_NAME' not found and Brother PPD not present. Run setup_brother_t420w.sh first."
    fi
fi

# 7. Print current status
STATUS=$(lpstat -p "$PRINTER_NAME" 2>&1 || true)
log "Final Queue Status: $STATUS"
log "Auto-recovery completed successfully."
exit 0
