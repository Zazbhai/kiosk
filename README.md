# 🖨️ PrintBooth Kiosk — Raspberry Pi Hardware Brain & Touchscreen Terminal

The complete autonomous self-service **Raspberry Pi Kiosk** operating system for PrintBooth stations. This repository contains everything required to turn any Raspberry Pi into an enterprise-grade walk-up printing terminal.

[![Platform](https://img.shields.io/badge/Platform-Raspberry%20Pi%20OS%20%7C%20DietPi%20%7C%20Linux%20ARM64-red.svg)](#hardware-requirements)
[![Spooler](https://img.shields.io/badge/Printer%20Subsystem-Linux%20CUPS%20%2B%20IPP%20Everywhere-blue.svg)](#cups-printer-subsystem)
[![Status](https://img.shields.io/badge/Kiosk%20Mode-Fullscreen%20Chromium%20%2B%20Wayland%2FX11-success.svg)](#touchscreen-kiosk-mode)

---

## 📁 Repository Structure

```text
kiosk/
├── README.md                   # Master hardware wiring, deployment & operation guide
├── .env.example                # Station credentials, central backend API, printer target
│
├── brain/                      # 🧠 Python IoT Background Daemon (Raspberry Pi Brain)
│   ├── daemon.py               # Main background worker (heartbeat, order polling, staging & printing)
│   ├── cups_controller.py      # Linux CUPS integration (auto-discovery, A4/Color/Duplex spooling)
│   ├── hardware_monitor.py     # System telemetry (paper/ink level estimation, SoC temp, health flags)
│   ├── ws_kiosk_client.py      # Real-time WebSocket listener (<50ms instant print dispatch)
│   ├── test_hardware.py        # CLI diagnostic tool to verify printer connection & send test prints
│   ├── config.py               # Environment configuration loader with fallback defaults
│   └── requirements.txt        # Python package dependencies (pycups, requests, python-dotenv, psutil)
│
├── ui/                         # 🖥️ Touchscreen Kiosk Display Application (React + Vite)
│   ├── package.json            # Node dependencies
│   ├── vite.config.ts          # Vite configuration (port 5175)
│   ├── index.html              # Fullscreen entry point with virtual keyboard / touch guards
│   ├── dist/                   # Pre-compiled production bundle (zero-build-time deployment)
│   └── src/
│       ├── screens/
│       │   ├── WelcomeScreen.tsx       # Welcome screen with "Start Printing" & "Enter Pickup PIN"
│       │   ├── PinReleaseScreen.tsx    # 6-Digit Walk-up Pickup PIN keypad for instant mobile release
│       │   ├── UploadMethodScreen.tsx  # Choice between Mobile QR and USB Flash Drive
│       │   ├── QRUploadScreen.tsx      # High-contrast dynamic QR for phone camera upload
│       │   ├── USBSelectScreen.tsx     # USB drive browser & document selector
│       │   ├── PrintSettingsScreen.tsx # Touch settings (Copies, B&W vs Colour, 1-Sided vs 2-Sided)
│       │   ├── ReviewScreen.tsx        # Order summary & pricing review
│       │   ├── PaymentScreen.tsx       # Station direct payment & QR
│       │   ├── PrintingScreen.tsx      # Real-time spooler progress indicator
│       │   ├── CollectionScreen.tsx    # Document tray collection guidance with auto-reset countdown
│       │   ├── NetworkOfflineScreen.tsx# Graceful offline alert banner
│       │   └── ErrorScreen.tsx         # User-friendly hardware error recovery
│       ├── App.tsx                     # Screen router & state management
│       └── index.css                   # Hardware kiosk surface styling & animations
│
└── scripts/                    # ⚙️ Raspberry Pi Deployment, Driver & Autostart Scripts
    ├── setup_pi.sh             # 1-Click master bootstrap script for Raspberry Pi OS
    ├── install_printer_drivers.sh # Automated CUPS printer detection & queue creation
    ├── test_printer_connection.sh # Hardware diagnostic tool (USB, CUPS, test page print)
    ├── configure_kiosk_mode.sh # Configures auto-login, boot splash, disables screen blanking
    ├── start_kiosk.sh          # Starts daemon, local UI server, and Chromium in fullscreen kiosk mode
    ├── printbooth-brain.service# Systemd service for continuous IoT Python daemon
    └── printbooth-display.service # Systemd service for fullscreen Chromium kiosk display
```

---

## 🛠️ Hardware Requirements

| Component | Recommended Specification |
| :--- | :--- |
| **Compute Board** | **Raspberry Pi 4 Model B** (2GB, 4GB, or 8GB) or **Raspberry Pi 5**. (Also compatible with Raspberry Pi 3B+, Orange Pi 5, or x86 Intel N100 mini PCs). |
| **Storage** | 16GB+ High Endurance MicroSD card (SanDisk Max Endurance or Samsung PRO Endurance, Class 10 / A2). |
| **Power Supply** | Official Raspberry Pi 5.1V / 3A USB-C Power Supply (prevents under-voltage printer resets). |
| **Touchscreen Display** | Official 7" Raspberry Pi Touchscreen (DSI) or any 10.1" / 15.6" HDMI capacitive touchscreen (1080x1920 portrait or 1920x1080 landscape). |
| **Physical Printer** | Any USB Linux CUPS-compatible printer: <br>• **Brother DCP-T420W / DCP-T220 / DCP-T520W / HL-L2321D** <br>• **HP Smart Tank 580 / 515 / 500 series / LaserJet Pro** <br>• **Epson EcoTank L3210 / L3250 series** <br>• **Canon PIXMA G-series** |
| **Cabling** | Shielded USB-A to USB-B Printer Cable with ferrite core (prevents static ground noise). |

---

## 🚀 1-Command Automated Installation

On a fresh install of **Raspberry Pi OS with Desktop (64-bit)**:

```bash
# 1. Clone repository directly onto Raspberry Pi
git clone https://github.com/Zazbhai/kiosk.git /home/pi/kiosk
cd /home/pi/kiosk

# 2. Run the automated bootstrap setup script
bash scripts/setup_pi.sh
```

The script automatically:
1. Updates APT package lists.
2. Installs `cups`, `libcups2-dev`, `printer-driver-all`, `printer-driver-gutenprint`, `hplip`, `python3-venv`, `chromium-browser`, `unclutter`.
3. Adds the local user to the `lpadmin` and `lp` printer groups.
4. Creates USB udev rules (`/etc/udev/rules.d/99-printbooth-printers.rules`) for non-root USB printer access.
5. Sets up the Python virtual environment and installs `requirements.txt`.
6. Generates and registers `printbooth-brain.service` and `printbooth-display.service`.
7. Auto-detects connected USB printers and configures the default CUPS queue.

---

## ⚙️ Configuration (`.env`)

Create your `.env` configuration file from the template:

```bash
cp .env.example .env
nano .env
```

```ini
# ==============================================================================
# PrintBooth Kiosk Hardware Configuration
# ==============================================================================
# Unique station identifier assigned in Admin Portal (e.g., PB-001, PB-002)
KIOSK_ID=PB-001

# Station display title
KIOSK_NAME=PrintBooth — Ground Floor Hub

# Central Backend API URL
PRINTBOOTH_API_URL=http://your-backend-ip:5000/api

# Target CUPS Printer name ("auto" automatically selects connected default printer)
PRINTER_NAME=auto

# Polling intervals in seconds
POLL_INTERVAL_SECONDS=3
HEARTBEAT_INTERVAL_SECONDS=10

# Local Touchscreen display URL
KIOSK_DISPLAY_URL=http://localhost:5175
```

---

## 🖨️ Printer Connection & Diagnostics

### Connecting Your Printer
1. Plug the printer into any Raspberry Pi USB 3.0 / USB 2.0 port.
2. Power on the printer and load A4 paper.
3. Run the automated printer driver installer:
   ```bash
   bash scripts/install_printer_drivers.sh
   ```

### Hardware Verification & Test Page
To verify the complete printer pipeline:
```bash
# Diagnostic inspection only
bash scripts/test_printer_connection.sh

# Or send an immediate physical test print
bash scripts/test_printer_connection.sh --print
```

Python diagnostic tool:
```bash
cd brain
source venv/bin/activate
python test_hardware.py --print
```

---

## 🔑 Operational Flows

### 1. Direct Touchscreen Walk-Up Flow
1. User approaches kiosk and taps **START PRINTING**.
2. Selects **QR Upload** (scans with camera) or **USB Drive** (selects file from plugged drive).
3. Configures copies, color mode (Color vs B&W), and duplex.
4. Pays directly at the kiosk.
5. Document spools to CUPS and prints immediately.

### 2. Mobile Pre-Pay & Pickup PIN Flow (OTP Release)
1. Customer visits the mobile web app (`http://<domain>/print?id=PB-001`), uploads files, and completes payment via the station's assigned gateway.
2. Customer receives an authentic **6-Digit Release PIN** on their phone screen.
3. Central backend securely caches the document and routes it to station `PB-001`.
4. Customer walks up to the kiosk, taps **ENTER PICKUP PIN**, and types their 6-digit code on the touchscreen keypad.
5. Station verifies PIN via `/api/kiosks/PB-001/verify-pin` and releases the document immediately!

---

## 🖥️ Autonomous Kiosk Appliance (Zero-Desktop & Custom Bootloader)

To configure the Raspberry Pi as a commercial-grade kiosk appliance where **the desktop is never shown** and boots with a custom PrintBooth bootloader splash:

### 1-Click Master Appliance Setup:
```bash
sudo bash scripts/setup_kiosk_appliance.sh
```

This single command configures:
1. **Silent Custom Bootloader & Animated Matrix Plymouth Splash (`setup_custom_bootloader.sh`)**:
   - Disables the 4-color rainbow splash square (`disable_splash=1`).
   - Removes artificial boot delay (`boot_delay=0`) and activates 30s CPU turbo (`arm_boost=1`, `initial_turbo=30`).
   - Silences all Linux kernel and dmesg scrolling text (`console=tty3 quiet loglevel=1 logo.nologo`).
   - Suppresses blinking cursor (`vt.global_cursor_default=0`) and disables verbose systemd banners.
   - Installs branded **Light Porcelain (`#f8fafc`) & Laser Red (`#dc2626` / `#ef4444`) Matrix Rain** bootloader opening (clean typographic code streams, strictly **zero logos or emblems**).
   - Features dynamic progress bar animation and real-time boot status callback.
   - Updates initramfs so the custom theme boots at the earliest kernel stage.
   - **Test Plymouth splash live on-screen without rebooting**:
     ```bash
     sudo bash scripts/setup_custom_bootloader.sh --test
     ```
2. **Zero-Desktop Dedicated Kiosk Session (`setup_zero_desktop.sh`)**:
   - Replaces the default desktop environment with a dedicated standalone Openbox session.
   - Completely removes taskbars (`lxpanel`, `wf-panel-pi`), desktop icons, wallpapers, and right-click menus.
   - Forces Chromium on top layer (`<layer>above</layer>`) while burying any system dialogs below.
   - Paints an instant solid backdrop so the desktop is **never exposed** even for 1 frame.
3. **Anti-Popup & PolicyKit Lockdown (Zero Authentication Dialogs)**:
   - Configures `/etc/polkit-1/rules.d/00-printbooth-kiosk.rules` and legacy pkla to auto-authorize all internal system actions without authentication dialogs (eliminating "Authentication required" popups for `colord`, `udisks2`, `NetworkManager`).
   - Masks `lxpolkit.service` and disables autostarts for `polkit-gnome` and `gnome-keyring`.
   - Chromium starts with `--password-store=basic --use-mock-keychain --disable-features=LockProfileCookieDatabase` to bypass GNOME Keyring unlock dialogs.
   - Runs an active background `xdotool` popup-killer watchdog in `start_kiosk.sh` that terminates any rogue system dialog immediately.
4. **Read-Only Filesystem & OverlayFS Power-Cut Protection (`setup_readonly_fs.sh`)**:
   - Redirects all runtime writes (browser cache, CUPS spool, logs) to a RAM-backed OverlayFS (`tmpfs`).
   - Prevents SD card / eMMC corruption when merchants turn off power directly at the wall switch.
   - Provides global appliance maintenance CLI commands:
     - `kiosk-status` — Check whether storage is currently locked in Read-Only mode or in Maintenance mode.
     - `kiosk-unlock` — Temporarily switch to Read-Write mode to install updates or edit `.env`.
     - `kiosk-lock` — Re-lock system into Read-Only Appliance mode.
5. **Dynamic Self-Healing Kiosk Watchdog (`start_kiosk.sh`)**:
   - Automatically cleans Chromium crash flags (`SingletonLock`, `--disable-session-crashed-bubble`).
   - Supervises Chromium in GPU-accelerated kiosk mode and restarts it in <1s if closed or interrupted.
   - Flushes CUPS hardware queues on startup (`cancel -a -x`) to ensure zero lingering print jobs.

To start the display manually at any time:
```bash
bash scripts/start_kiosk.sh
```

---

## ⚡ Power Outage & Hardware Auto-Recovery (Self-Healing)

When kiosk power is cut and restored, the Raspberry Pi boots in ~15s while the Brother DCP-T420W takes ~50s to perform mechanical printhead calibration. PrintBooth incorporates an automated self-healing layer so the printer is **automatically detected and recovered with zero manual intervention**:

1. **CUPS Error Policy (`retry-current-job`)**: Prevents CUPS from disabling the printer queue when cold-booting before the printer.
2. **`ipp-usb` Auto-Masking**: Prevents user-space IPP daemons from locking the USB interface and detaching kernel `usblp`.
3. **Udev Hotplug Watchdog (`/etc/udev/rules.d/99-printbooth-printer-autorecover.rules`)**: The instant the Brother printer completes calibration and announces on USB, udev triggers `/usr/local/bin/printbooth_printer_autorecover.sh` to unpause CUPS and re-bind URIs.
4. **Boot Grace Period & Daemon Self-Healing**: The Python Kiosk Brain provides a 60s boot warmup grace period and active heartbeat self-healing.

### Install / Verify Auto-Recovery on Pi:
```bash
sudo bash scripts/setup_autorecover.sh
```

---

## 💡 Troubleshooting & FAQ

| Issue | Solution |
| :--- | :--- |
| **"Authentication required" popup covers screen** | Run `sudo bash scripts/setup_zero_desktop.sh` or `sudo bash scripts/setup_custom_bootloader.sh`. This deploys Polkit auto-authorization (`00-printbooth-kiosk.rules`), masks `lxpolkit`, sets Chromium `--password-store=basic --use-mock-keychain`, and enables the active popup killer watchdog. |
| **Power outage / restart: printer OFFLINE** | Install auto-recovery watchdog: `sudo bash scripts/setup_autorecover.sh`. Or run manual heal: `sudo bash scripts/printer_autorecover.sh`. |
| **Printer shows OFFLINE** | Verify USB cable. Run `lsusb` to confirm vendor ID. Run `sudo cupsenable PrintBooth_Printer`. |
| **Permission denied on CUPS** | Ensure user is in `lpadmin` and `lp`: `sudo usermod -a -G lpadmin,lp $USER`. |
| **Cursor visible on touchscreen** | Ensure unclutter is installed: `sudo apt install unclutter`. Run `unclutter -idle 0.5 -root &`. |
| **Touchscreen inverted / rotated** | Edit `/boot/firmware/cmdline.txt` or display settings: add `video=DSI-1:800x480@60,rotate=180` or use `wlr-randr --output DSI-1 --transform 180`. |
| **Clear stuck print job** | Run `cancel -a` to wipe the queue. |
| **View live daemon logs** | Run `journalctl -u printbooth-brain -f` or `tail -f /tmp/printbooth_daemon.log`. |

---

## 📜 License
Proprietary & Confidential — PrintBooth Hardware Automation Subsystem.
