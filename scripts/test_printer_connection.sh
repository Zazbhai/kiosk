#!/usr/bin/env bash
# ==============================================================================
# PrintBooth — Hardware Printer Connection Diagnostic Script
# ==============================================================================
# Verifies USB hardware connectivity, CUPS daemon, queue status, and prints a test page.
# ==============================================================================

echo "========================================================"
echo "  PrintBooth Raspberry Pi Printer Connectivity Test"
echo "========================================================"

# 1. USB Bus
echo "\n[1] Checking USB Bus for Printers (lsusb):"
USB_OUT=$(lsusb | grep -i -E "printer|brother|hewlett|canon|epson" || true)
if [ -n "$USB_OUT" ]; then
    echo "✓ Found USB Printer:"
    echo "  $USB_OUT"
else
    echo "✗ No USB printer found in lsusb! Check USB cable connection."
fi

# 2. Kernel device nodes
echo "\n[2] Checking Linux USB Printer Device Nodes (/dev/usb/lp*):"
if ls /dev/usb/lp* 1> /dev/null 2>&1; then
    echo "✓ Detected printer device node(s):"
    ls -la /dev/usb/lp*
else
    echo "✗ /dev/usb/lp* not found. Kernel usblp driver may be unattached or printer powered off."
fi

# 3. CUPS Service Status
echo "\n[3] CUPS Service Status:"
if systemctl is-active --quiet cups; then
    echo "✓ CUPS daemon is active (running)."
else
    echo "✗ CUPS daemon is NOT running! Run: sudo systemctl start cups"
fi

# 4. Configured CUPS Printers
echo "\n[4] Configured CUPS Printers (lpstat -p -d):"
lpstat -p -d || echo "✗ No CUPS printers found."

# 5. Device URI mapping
echo "\n[5] CUPS Device URIs (lpstat -v):"
lpstat -v || true

# 6. Test Print Prompt
if [ "$1" == "--print" ] || [ "$1" == "-p" ]; then
    echo "\n[6] Sending Diagnostic Test Page to Default Printer..."
    TEST_FILE="/tmp/printbooth_diag_test.txt"
    cat << 'EOF' > "$TEST_FILE"
========================================================
     PRINTBOOTH RASPBERRY PI KIOSK HARDWARE SELF-TEST
========================================================
Status       : Hardware Connection Verified
Timestamp    : $(date)
CUPS Spooler : Active & Responding
Paper Size   : A4
Resolution   : 600 DPI
Platform     : Raspberry Pi OS
========================================================
EOF
    if lp -o media=A4 "$TEST_FILE"; then
        echo "✓ Test job submitted to CUPS queue!"
    else
        echo "✗ Failed to submit test job. Check CUPS errors above."
    fi
else
    echo "\nTip: Run 'bash test_printer_connection.sh --print' to dispatch a test print."
fi

echo "\n========================================================"
echo "  Diagnostic Complete."
echo "========================================================"
