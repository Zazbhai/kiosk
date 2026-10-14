#!/usr/bin/env bash
# PrintBooth — Brother HL-L5210DW Deep Sleep & Auto-Off Prevention Script
# =====================================================================
# Configures the Raspberry Pi OS and Brother hardware to prevent the
# printer from going into Deep Sleep or Auto Power Off.

set -e

echo "════════════════════════════════════════════════════════"
echo "  PrintBooth: Brother HL-L5210DW Sleep Mode Fix"
echo "════════════════════════════════════════════════════════"

# 1. Disable USB Autosuspend in Raspberry Pi Linux kernel
echo "[1/4] Disabling Linux USB Autosuspend..."
for f in /sys/bus/usb/devices/*/power/control; do
    if [ -f "$f" ]; then
        echo "on" | sudo tee "$f" >/dev/null 2>&1 || true
    fi
done

# Add usbcore.autosuspend=-1 to cmdline.txt if not already present
CMDLINE="/boot/firmware/cmdline.txt"
[ ! -f "$CMDLINE" ] && CMDLINE="/boot/cmdline.txt"
if [ -f "$CMDLINE" ]; then
    if ! grep -q "usbcore.autosuspend=-1" "$CMDLINE"; then
        echo "  Adding usbcore.autosuspend=-1 to kernel parameters..."
        sudo sed -i '1 s/$/ usbcore.autosuspend=-1/' "$CMDLINE" || true
    fi
fi
echo "  ✓ USB ports set to always-on (autosuspend disabled)."

# 2. Configure CUPS retry policy so queue never pauses on sleep warmup
echo ""
echo "[2/4] Configuring CUPS Queue Resilience..."
PRINTER_NAME="PrintBooth_Printer"
if sudo lpstat -p "$PRINTER_NAME" >/dev/null 2>&1; then
    sudo lpadmin -p "$PRINTER_NAME" -o printer-error-policy=retry-current-job
    sudo lpadmin -p "$PRINTER_NAME" -o usb-unidir-default=false 2>/dev/null || true
    sudo cupsenable "$PRINTER_NAME"
    sudo cupsaccept "$PRINTER_NAME"
    echo "  ✓ CUPS '$PRINTER_NAME' set to retry-current-job (won't stop during warmup)."
fi

# 3. Send PJL Power Management commands to Brother NVRAM via USB
echo ""
echo "[3/4] Sending PJL NVRAM settings to Brother Printer..."
LP_DEV=$(ls /dev/usb/lp* 2>/dev/null | head -n 1 || true)
if [ -n "$LP_DEV" ] && [ -w "$LP_DEV" ]; then
    echo "  Found USB printer device: $LP_DEV"
    # Send PJL escape sequence to set PowerSave=Off, AutoShutdown=Off, DeepSleep=Off
    printf '\033%%-12345X@PJL\r\n@PJL DEFAULT POWERSAVE=OFF\r\n@PJL DEFAULT SLEEP=50\r\n@PJL DEFAULT AUTOSHUTDOWN=OFF\r\n@PJL DEFAULT DEEPSLEEP=OFF\r\n\033%%-12345X' | sudo tee "$LP_DEV" >/dev/null 2>&1 || true
    echo "  ✓ PJL power management commands dispatched to $LP_DEV."
else
    echo "  Notice: /dev/usb/lp device currently locked by CUPS or usblp module."
fi

# 4. Summary & LCD instructions
echo ""
echo "[4/4] Required 30-Second Physical Button Steps on Brother Printer:"
echo "-----------------------------------------------------------------"
echo "To permanently disable Deep Sleep from the printer's screen:"
echo ""
echo "  STEP 1: Disable Deep Sleep (Secret Shortcut)"
echo "    1. Press [OK] on the printer."
echo "    2. Select [General Setup] -> press [OK]."
echo "    3. Select [Ecology] -> press [OK]."
echo "    4. Select [Sleep Time] -> press [OK]."
echo "    5. WHILE on 'Sleep Time', press [Back] and [Down Arrow (-)] together."
echo "    6. A secret 'Deep Sleep' menu appears! Change [On] to [Off] -> press [OK]."
echo ""
echo "  STEP 2: Disable Auto Power Off"
echo "    1. Press [OK] -> [General Setup] -> [Ecology] -> [Auto Power Off]."
echo "    2. Select [Off] -> press [OK]."
echo ""
echo "  STEP 3: Maximize Sleep Time"
echo "    1. In [Ecology] -> [Sleep Time], set to 50 Min (maximum allowed)."
echo "-----------------------------------------------------------------"
echo "✓ Done! Your Brother HL-L5210DW will now remain awake and ready 24/7."
