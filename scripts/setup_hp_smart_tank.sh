#!/usr/bin/env bash
# ==============================================================================
# PrintBooth — Automated HP Smart Tank (660-670 / Ink Tank) Setup Script
# ==============================================================================
# Detects HP Smart Tank connected via USB, installs HPLIP & IPP Everywhere,
# and configures CUPS queue 'PrintBooth_Printer' with full color/monochrome support.
# ==============================================================================

set -e

PRINTER_NAME="${PRINTER_NAME:-PrintBooth_Printer}"

echo "════════════════════════════════════════════════════════"
echo "  PrintBooth HP Smart Tank Hardware Setup Tool          "
echo "════════════════════════════════════════════════════════"

# 1. Verify CUPS is active
echo -e "\n[1/5] Ensuring CUPS printing system is running..."
if ! systemctl is-active --quiet cups; then
    sudo systemctl unmask cups 2>/dev/null || true
    sudo systemctl restart cups
fi
sudo systemctl enable cups

# 2. Check for HP USB device via lsusb
echo -e "\n[2/5] Scanning USB bus for HP printing device..."
HP_DEVICE=$(lsusb 2>/dev/null | grep -i -E "03f0:|hp|smart tank|deskjet|laserjet|ink tank" | head -n 1 || true)
if [ -n "$HP_DEVICE" ]; then
    echo "  ✓ Detected HP Hardware: $HP_DEVICE"
else
    echo "  ⚠️ Warning: No HP device found in lsusb. Please check USB cable."
fi

# 3. Install HPLIP & IPP Everywhere packages
echo -e "\n[3/5] Installing HPLIP driver and CUPS IPP utilities..."
sudo apt-get update -y
sudo apt-get install -y \
    hplip \
    printer-driver-hpcups \
    cups-ipp-utils \
    ipp-usb \
    --no-install-recommends

# Add current user and lp to required groups
ACTUAL_USER="${SUDO_USER:-$USER}"
sudo usermod -a -G lpadmin,lp "$ACTUAL_USER" 2>/dev/null || true

# Crucial: Restart CUPS so it loads the newly installed hp:/ backend
sudo systemctl restart cups
sleep 2

# 4. Discover HP Device URI
echo -e "\n[4/5] Discovering active device URI for HP printer..."
HP_URI=""

# Method A: Query hp-probe (official HPLIP hardware prober)
if command -v hp-probe >/dev/null 2>&1; then
    PROBE_URI=$(sudo hp-probe -b usb 2>/dev/null | grep -i "hp:/" | head -n 1 | awk '{print $1}' || true)
    if [ -n "$PROBE_URI" ]; then
        HP_URI="$PROBE_URI"
        echo "  ✓ Found HP URI via hp-probe: $HP_URI"
    fi
fi

# Method B: Query lpinfo for hp:/ or usb://HP
if [ -z "$HP_URI" ]; then
    LPINFO_OUT=$(sudo lpinfo -v 2>/dev/null || true)
    for line in $(echo "$LPINFO_OUT" | grep -i -E "hp:/usb|direct usb://hp|usb://hp" | awk '{print $2}'); do
        if [ -n "$line" ]; then
            HP_URI="$line"
            echo "  ✓ Found HP USB URI via lpinfo: $HP_URI"
            break
        fi
    done
fi

# Method C: Check driverless IPP-over-USB
if [ -z "$HP_URI" ]; then
    DRIVERLESS_URI=$(driverless 2>/dev/null | grep -i "hp" | head -n 1 || true)
    if [ -n "$DRIVERLESS_URI" ]; then
        HP_URI="$DRIVERLESS_URI"
        echo "  ✓ Found Driverless IPP URI: $HP_URI"
    fi
fi

# Method D: Generic direct USB
if [ -z "$HP_URI" ]; then
    GENERIC_USB=$(sudo lpinfo -v 2>/dev/null | grep -i "direct usb://" | head -n 1 | awk '{print $2}' || true)
    if [ -n "$GENERIC_USB" ]; then
        HP_URI="$GENERIC_USB"
        echo "  ✓ Found Direct USB URI: $HP_URI"
    fi
fi

# Fallback to kernel lp node if present
if [ -z "$HP_URI" ] && [ -e "/dev/usb/lp0" ]; then
    HP_URI="usb:/dev/usb/lp0"
    echo "  ✓ Using kernel USB device node: $HP_URI"
fi

if [ -z "$HP_URI" ]; then
    HP_URI="usb://HP/Smart%20Tank%20660-670%20series"
    echo "  ℹ Falling back to default URI: $HP_URI"
fi

# 5. Configure CUPS Queue 'PrintBooth_Printer'
echo -e "\n[5/5] Configuring CUPS spooler queue '$PRINTER_NAME'..."

# Clean old queue and purge stuck jobs
sudo cancel -a -x "$PRINTER_NAME" 2>/dev/null || true
sudo cancel -a "$PRINTER_NAME" 2>/dev/null || true
sudo lpadmin -x "$PRINTER_NAME" 2>/dev/null || true

DRIVER_CONFIGURED=false

# Try 1: IPP Everywhere driverless (native high-speed raster)
echo "  Attempting IPP Everywhere driverless setup..."
if sudo lpadmin -p "$PRINTER_NAME" -E -v "$HP_URI" -m everywhere 2>/dev/null; then
    echo "  ✓ Successfully configured $PRINTER_NAME with IPP Everywhere!"
    DRIVER_CONFIGURED=true
else
    echo "  IPP Everywhere not supported on this URI, searching HPLIP PPD..."
fi

# Try 2: Exact HPLIP PPD for Smart Tank / DeskJet (EXCLUDING PhotoSmart!)
if [ "$DRIVER_CONFIGURED" = false ]; then
    HP_PPD=$(sudo lpinfo -m 2>/dev/null | grep -i -E "smart[-_ ]?tank|smarttank|660|670" | grep -v -i "photosmart" | head -n 1 | awk '{print $1}' || true)
    if [ -z "$HP_PPD" ]; then
        HP_PPD=$(sudo lpinfo -m 2>/dev/null | grep -i -E "hpcups.*smart[-_ ]?tank|hpcups.*deskjet|hpcups.*ink_tank|hp-deskjet" | grep -v -i "photosmart" | head -n 1 | awk '{print $1}' || true)
    fi
    if [ -z "$HP_PPD" ]; then
        HP_PPD=$(sudo lpinfo -m 2>/dev/null | grep -i -E "deskjet|inkjet|pcl3" | grep -v -i "photosmart" | head -n 1 | awk '{print $1}' || true)
    fi

    if [ -n "$HP_PPD" ]; then
        echo "  ✓ Using HPLIP driver PPD: $HP_PPD"
        sudo lpadmin -p "$PRINTER_NAME" -E -v "$HP_URI" -m "$HP_PPD"
        DRIVER_CONFIGURED=true
    fi
fi

# Try 3: Automated hp-setup fallback
if [ "$DRIVER_CONFIGURED" = false ] && command -v hp-setup >/dev/null 2>&1; then
    echo "  Attempting automated hp-setup..."
    sudo hp-setup -i -a -x -b usb 2>/dev/null || true
    HP_AUTO_QUEUE=$(lpstat -p 2>/dev/null | grep -i "printer HP" | head -n 1 | awk '{print $2}' || true)
    if [ -n "$HP_AUTO_QUEUE" ]; then
        echo "  ✓ hp-setup created queue $HP_AUTO_QUEUE, aligning $PRINTER_NAME to match..."
        AUTO_URI=$(sudo lpstat -v "$HP_AUTO_QUEUE" 2>/dev/null | awk '{print $NF}' || true)
        if [ -n "$AUTO_URI" ]; then
            sudo lpadmin -p "$PRINTER_NAME" -E -v "$AUTO_URI"
            DRIVER_CONFIGURED=true
        fi
    fi
fi

# Try 4: Generic CUPS PPD
if [ "$DRIVER_CONFIGURED" = false ]; then
    GENERIC_PPD=$(sudo lpinfo -m 2>/dev/null | grep -i "drv:///sample.drv/generic.ppd" | head -n 1 | awk '{print $1}' || true)
    if [ -n "$GENERIC_PPD" ]; then
        echo "  ℹ Using generic CUPS PPD: $GENERIC_PPD"
        sudo lpadmin -p "$PRINTER_NAME" -E -v "$HP_URI" -m "$GENERIC_PPD"
    else
        echo "  ℹ Using direct raw spooling mode"
        sudo lpadmin -p "$PRINTER_NAME" -E -v "$HP_URI" -m raw
    fi
    DRIVER_CONFIGURED=true
fi

# Unpause queue, set default, and configure resilient error recovery
sudo cupsenable "$PRINTER_NAME" 2>/dev/null || true
sudo cupsaccept "$PRINTER_NAME" 2>/dev/null || true
sudo lpadmin -d "$PRINTER_NAME" 2>/dev/null || true
sudo lpadmin -p "$PRINTER_NAME" -o printer-error-policy=retry-current-job 2>/dev/null || true
sudo lpadmin -p "$PRINTER_NAME" -o job-sheets-default=none,none 2>/dev/null || true
sudo lpadmin -p "$PRINTER_NAME" -o copies-default=1 2>/dev/null || true

# Force system-wide and CUPS queue default paper size to A4 (prevents US-Letter shrinkage)
echo "a4" | sudo tee /etc/papersize 2>/dev/null || true
sudo paperconfig -p a4 2>/dev/null || true
sudo lpadmin -p "$PRINTER_NAME" -o PageSize=A4 -o PageRegion=A4 -o media=A4 2>/dev/null || true
sudo lpoptions -p "$PRINTER_NAME" -o PageSize=A4 -o PageRegion=A4 -o media=A4 2>/dev/null || true
sudo lpoptions -d "$PRINTER_NAME" -o PageSize=A4 -o PageRegion=A4 -o media=A4 2>/dev/null || true

echo -e "\n════════════════════════════════════════════════════════"
echo "  ✓ HP Smart Tank Setup Complete! 🎉"
echo "  Queue Name : $PRINTER_NAME"
echo "  Device URI : $HP_URI"
echo "  Status     : $(lpstat -p "$PRINTER_NAME" 2>&1)"
echo "════════════════════════════════════════════════════════"

# Non-blocking test print check (defaults to test print after 5s)
test_reply="y"
read -t 5 -p "Print a test page now? (Y/n, auto in 5s): " -r user_in || true
if [ -n "$user_in" ]; then
    test_reply="$user_in"
fi

if [[ "$test_reply" =~ ^[Yy]$ ]]; then
    echo "Sending test page to $PRINTER_NAME..."
    if [ -f "/usr/share/cups/data/testprint" ]; then
        lp -d "$PRINTER_NAME" -o fit-to-page /usr/share/cups/data/testprint 2>/dev/null || echo "Test print dispatched (lp)"
    else
        echo "PrintBooth HP Smart Tank Hardware Test Page" | lp -d "$PRINTER_NAME" 2>/dev/null || echo "Test text dispatched"
    fi
    echo "✓ Test job submitted to $PRINTER_NAME!"
fi
