"""
PrintBooth CUPS Controller for Raspberry Pi
===========================================
Handles hardware printing over CUPS (Common Unix Printing System).
Controls:
  - Color vs. Black & White (Monochrome / Grayscale)
  - Number of copies
  - Duplex (Two-sided) vs. Single-sided
  - Paper sizes (A4, Letter, etc.)
  - Queue management, job status, and printer availability telemetry
"""

import subprocess
import json
import os
import sys
import shutil
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    import cups  # type: ignore
    CUPS_AVAILABLE = True
except ImportError:
    cups = None
    CUPS_AVAILABLE = False

try:
    from config import DATA_DIR, TEMP_JOBS_DIR
except Exception:
    DATA_DIR = Path("./data")
    TEMP_JOBS_DIR = Path("/tmp/printbooth_jobs" if os.name != "nt" else "./temp_jobs")
DATA_DIR.mkdir(parents=True, exist_ok=True)
TEMP_JOBS_DIR.mkdir(parents=True, exist_ok=True)


def claim_order_for_spooling(order_id: str, aliases: Optional[List[str]] = None) -> bool:
    """
    Atomically claims an order ID (and aliases like orderNumber, releasePin)
    across all processes (ws_kiosk_client, daemon, retry handlers).
    Returns True if successfully claimed (first time), False if already claimed (duplicate).
    Stores claims in persistent DATA_DIR to survive reboots.
    """
    if not order_id:
        return True

    all_keys = [str(order_id).strip()]
    if aliases:
        for a in aliases:
            if a and str(a).strip():
                all_keys.append(str(a).strip())

    lock_file = DATA_DIR / ".spool_claims.lock"
    claims_file = DATA_DIR / ".spool_claims.json"

    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        with open(lock_file, "a+", encoding="utf-8") as lf:
            if sys.platform != "win32":
                try:
                    import fcntl
                    fcntl.flock(lf.fileno(), fcntl.LOCK_EX)
                except Exception:
                    pass

            claims = {}
            if claims_file.exists():
                try:
                    with open(claims_file, "r", encoding="utf-8") as cf:
                        claims = json.load(cf)
                except Exception:
                    claims = {}

            # Check if ANY key is already claimed
            for k in all_keys:
                if k in claims:
                    claimed_info = claims[k]
                    print(
                        f"[CUPS Spooler] [BLOCKED] Prevented duplicate print! Order '{order_id}' was already spooled "
                        f"by PID {claimed_info.get('pid')} at {claimed_info.get('time')}."
                    )
                    if sys.platform != "win32":
                        try:
                            import fcntl
                            fcntl.flock(lf.fileno(), fcntl.LOCK_UN)
                        except Exception:
                            pass
                    return False

            # First time claim: Register all keys
            now_iso = time.strftime("%Y-%m-%d %H:%M:%S")
            now_ts = time.time()
            entry = {"pid": os.getpid(), "time": now_iso, "ts": now_ts, "primary": order_id}
            for k in all_keys:
                claims[k] = entry

            # Prune claims older than 48 hours
            claims = {k: v for k, v in claims.items() if (now_ts - v.get("ts", 0)) < 172800}

            with open(claims_file, "w", encoding="utf-8") as cf:
                json.dump(claims, cf, indent=2)

            if sys.platform != "win32":
                try:
                    import fcntl
                    fcntl.flock(lf.fileno(), fcntl.LOCK_UN)
                except Exception:
                    pass

            return True
    except Exception as e:
        print(f"[CUPS Spooler] Claim check notice ({e})")
        return True


class CupsController:
    """Interface to Linux CUPS spooler via pycups or fallback system CLI (lp/lpstat)."""

    def claim_order_for_spooling(self, order_id: str, aliases: Optional[List[str]] = None) -> bool:
        return claim_order_for_spooling(order_id, aliases)

    def __init__(self, host: str = "localhost", port: int = 631):
        self.host = host
        self.port = port
        self._conn = None
        if CUPS_AVAILABLE:
            try:
                cups.setServer(self.host)
                cups.setPort(self.port)
                # Suppress interactive password prompts on stdin/terminal
                try:
                    cups.setPasswordCB(lambda prompt: "")
                except Exception:
                    pass
                self._conn = cups.Connection()
            except Exception as e:
                self._conn = None
                self._init_error = str(e)
        else:
            self._init_error = "pycups not installed; using system CLI fallback (lp / lpstat)"

    @property
    def is_connected(self) -> bool:
        return self._conn is not None

    def purge_all_jobs(self, printer_name: Optional[str] = None) -> Dict[str, Any]:
        """
        Purges and cancels all pending, held, or queued jobs from CUPS.
        Guarantees that on Pi boot and between jobs, no leftover jobs or ghost queue exists.
        """
        actions = []
        # 1. pycups cancelJob for all existing jobs
        if self._conn:
            try:
                jobs = self._conn.getJobs(which_jobs="all", my_jobs=False)
                for jid in list(jobs.keys()):
                    try:
                        self._conn.cancelJob(jid, purge_job=True)
                        actions.append(f"Cancelled CUPS job #{jid}")
                    except Exception:
                        try:
                            self._conn.cancelJob(jid)
                            actions.append(f"Cancelled CUPS job #{jid}")
                        except Exception:
                            pass
            except Exception as e:
                actions.append(f"pycups jobs query notice: {e}")

        # 2. Linux CLI cancel -a -x / cancel -a / lprm -
        if sys.platform != "win32":
            target = printer_name or (self.get_printers().get("default") if hasattr(self, "get_printers") else None)
            cmd_lists = [
                ["cancel", "-a", "-x"],
                ["cancel", "-a"],
                ["lprm", "-"],
            ]
            if target and target != "auto":
                cmd_lists.insert(0, ["cancel", "-a", "-x", target])
                cmd_lists.insert(1, ["cancel", "-a", target])

            for cmd in cmd_lists:
                try:
                    subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, timeout=5)
                except Exception:
                    pass
                try:
                    subprocess.run(["sudo", "-n"] + cmd, stdin=subprocess.DEVNULL, capture_output=True, timeout=5)
                except Exception:
                    pass

        return {"success": True, "actions": actions}

    def check_usb_printer(self) -> Dict[str, Any]:
        """
        Runs 'lsusb' to verify whether physical printer (e.g. Brother) is connected to the USB bus.
        Checks for Brother vendor ID (04f9), 'brother', 'brothers', 'dcp-t420w', 'dcp-', 'mfc-', 'hl-',
        or printer class, and checks /dev/usb/lp* device nodes and /sys/bus/usb/devices.
        """
        if sys.platform == "win32":
            try:
                import win32print
                raw_printers = win32print.EnumPrinters(
                    win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
                )
                brother_match = next(
                    (p[2] for p in raw_printers if any(k in p[2].lower() for k in ["brother", "brothers", "dcp", "mfc", "hl-"])),
                    None
                )
                if brother_match:
                    return {
                        "connected": True,
                        "printerFound": brother_match,
                        "vendor": "Brother",
                        "busInfo": "USB/Spooler (Win32)",
                        "method": "win32_enum",
                    }
            except Exception:
                pass

            return {
                "connected": True,
                "printerFound": "Brother DCP-T420W (Windows Host)",
                "vendor": "Brother",
                "busInfo": "USB Host (Win32)",
                "method": "win32_simulated",
            }

        try:
            res = subprocess.run(["lsusb"], capture_output=True, text=True, timeout=3)
            raw_output = res.stdout if res.returncode == 0 else ""
            lines = raw_output.splitlines()

            matched_lines = []
            found_name = None
            is_brother = False

            brother_keywords = ["04f9:", "brother", "brothers", "dcp-t420w", "dcp-", "mfc-", "hl-"]

            for line in lines:
                lower = line.lower()
                # Check for Brother vendor ID (04f9), brother name, dcp, mfc, or general printer
                if any(k in lower for k in brother_keywords):
                    matched_lines.append(line.strip())
                    is_brother = True
                    found_name = line.strip()
                    break
                elif "printer" in lower:
                    matched_lines.append(line.strip())
                    found_name = line.strip()

            # Also check sysfs USB descriptors if lsusb didn't match
            if not matched_lines:
                try:
                    sys_usb = "/sys/bus/usb/devices"
                    if os.path.exists(sys_usb):
                        for dev in os.listdir(sys_usb):
                            dev_path = os.path.join(sys_usb, dev)
                            mfg_path = os.path.join(dev_path, "manufacturer")
                            prod_path = os.path.join(dev_path, "product")
                            vendor_path = os.path.join(dev_path, "idVendor")
                            
                            mfg = open(mfg_path).read().strip().lower() if os.path.exists(mfg_path) else ""
                            prod = open(prod_path).read().strip().lower() if os.path.exists(prod_path) else ""
                            vendor = open(vendor_path).read().strip().lower() if os.path.exists(vendor_path) else ""

                            if vendor == "04f9" or any(k in mfg for k in ["brother", "brothers"]) or any(k in prod for k in ["brother", "brothers", "dcp"]):
                                matched_lines.append(f"Sysfs USB device {dev}: {mfg} {prod} (04f9)")
                                is_brother = True
                                found_name = f"Brother {prod.upper() if prod else 'Printer'} ({dev})"
                                break
                except Exception:
                    pass

            # Also verify if /dev/usb/lp0 or similar kernel character device exists
            has_lp_node = os.path.exists("/dev/usb/lp0") or os.path.exists("/dev/usb/lp1")

            is_connected = bool(matched_lines or has_lp_node)
            return {
                "connected": is_connected,
                "printerFound": found_name or ("Brother Printer (/dev/usb/lp0)" if has_lp_node else None),
                "isBrother": is_brother,
                "hasLpDeviceNode": has_lp_node,
                "matchedLines": matched_lines,
                "rawLsusb": raw_output.strip(),
                "method": "lsusb",
            }
        except Exception as e:
            has_lp = os.path.exists("/dev/usb/lp0")
            return {
                "connected": has_lp,
                "error": str(e),
                "hasLpDeviceNode": has_lp,
                "method": "lsusb_fallback",
            }

    def _is_usb_printer_present(self) -> bool:
        """Helper checking if physical USB printer is enumerated on the Linux USB bus."""
        return self.check_usb_printer().get("connected", False)

    def auto_recover_printer(self, printer_name: Optional[str] = None) -> Dict[str, Any]:
        """
        Self-healing routine for Raspberry Pi CUPS printer:
        1. Checks if queue is STOPPED (state 5) or disabled. If so, enables and accepts jobs.
        2. Sets printer-error-policy=retry-current-job so CUPS does not disable queue when printer boots slowly.
        3. Scans lsusb for physical USB printer presence.
        4. If device is on USB but missing/broken in CUPS, detects current URI via lpinfo and re-binds.
        """
        if sys.platform == "win32":
            return {"success": True, "message": "Windows platform; CUPS auto-recover skipped"}

        target = printer_name or "PrintBooth_Printer"
        actions = []

        try:
            # 1. Ensure kernel usblp module is loaded
            if not os.path.exists("/dev/usb/lp0") and self._is_usb_printer_present():
                subprocess.run(["sudo", "-n", "modprobe", "usblp"], capture_output=True, stdin=subprocess.DEVNULL, timeout=2)
                actions.append("modprobe usblp")

            # 2. Re-enable CUPS queue and accept incoming jobs
            # Using stdin=subprocess.DEVNULL and sudo -n completely prevents interactive password prompts
            subprocess.run(["cupsenable", target], capture_output=True, stdin=subprocess.DEVNULL, timeout=2)
            subprocess.run(["cupsaccept", target], capture_output=True, stdin=subprocess.DEVNULL, timeout=2)
            subprocess.run(["sudo", "-n", "cupsenable", target], capture_output=True, stdin=subprocess.DEVNULL, timeout=2)
            subprocess.run(["sudo", "-n", "cupsaccept", target], capture_output=True, stdin=subprocess.DEVNULL, timeout=2)
            actions.append(f"unpaused {target}")

            # 3. Ensure error policy is retry-current-job (prevents CUPS from disabling queue on power restart)
            subprocess.run(
                ["sudo", "-n", "lpadmin", "-p", target, "-o", "printer-error-policy=retry-current-job"],
                capture_output=True,
                stdin=subprocess.DEVNULL,
                timeout=2,
            )
            actions.append("set retry-current-job error policy")

            # 4. If connection is alive in pycups, enable through API
            if self._conn:
                try:
                    self._conn.enablePrinter(target)
                    self._conn.acceptJobs(target)
                except Exception:
                    pass

            # 5. Check if URI needs re-binding if printer is on USB
            if self._is_usb_printer_present():
                try:
                    lpinfo_out = subprocess.run(
                        ["lpinfo", "-v"],
                        capture_output=True,
                        stdin=subprocess.DEVNULL,
                        text=True,
                        timeout=3,
                    ).stdout
                    active_uri = None
                    for line in lpinfo_out.splitlines():
                        if any(k in line.lower() for k in ["brother", "dcp-t420w", "direct usb://brother"]):
                            parts = line.split()
                            if len(parts) >= 2:
                                active_uri = parts[1]
                                break
                    if not active_uri and os.path.exists("/dev/usb/lp0"):
                        active_uri = "usb:/dev/usb/lp0"

                    if active_uri:
                        subprocess.run(
                            ["sudo", "-n", "lpadmin", "-p", target, "-v", active_uri],
                            capture_output=True,
                            stdin=subprocess.DEVNULL,
                            timeout=2,
                        )
                        actions.append(f"re-bound URI to {active_uri}")
                except Exception:
                    pass

            # 6. Ensure default options for queue (copies=1, job-sheets=none,none)
            subprocess.run(
                ["lpoptions", "-p", target, "-o", "copies=1", "-o", "job-sheets=none,none"],
                capture_output=True, stdin=subprocess.DEVNULL, timeout=2,
            )
            subprocess.run(
                ["sudo", "-n", "lpadmin", "-p", target, "-o", "job-sheets-default=none,none", "-o", "copies-default=1"],
                capture_output=True, stdin=subprocess.DEVNULL, timeout=2,
            )
            actions.append("set queue default copies=1 & job-sheets=none,none")

            print(f"[CUPS Auto-Recover] Actions executed for '{target}': {', '.join(actions)}")
            return {"success": True, "actions": actions}
        except Exception as e:
            return {"success": False, "error": str(e), "actions": actions}

    def get_printers(self) -> Dict[str, Any]:
        """Discovers and returns all configured CUPS printers and their states with self-healing."""
        if self._conn:
            try:
                raw_printers = self._conn.getPrinters()
                default_p = self._conn.getDefault()
                printers = []
                for name, d in raw_printers.items():
                    state_code = d.get("printer-state", 3)
                    state_map = {3: "IDLE", 4: "PRINTING", 5: "STOPPED"}

                    # SELF-HEALING: If printer is STOPPED (5) on Linux, auto-recover immediately!
                    if state_code == 5 and sys.platform != "win32":
                        print(f"[CUPS Controller] Detected STOPPED state (code 5) for '{name}'. Auto-recovering...")
                        self.auto_recover_printer(name)
                        try:
                            # Re-fetch state after recovery
                            raw_printers = self._conn.getPrinters()
                            d = raw_printers.get(name, d)
                            state_code = d.get("printer-state", 3)
                        except Exception:
                            pass

                    is_online = state_code in (3, 4)
                    uri = d.get("device-uri", "")
                    is_usb = "usb:" in uri.lower() or "lp0" in uri.lower() or "direct" in uri.lower()
                    is_net = any(k in uri.lower() for k in ["ipp:", "socket:", "http:", "lpd:", "wsd"])

                    # If printer connects over USB, verify physical USB bus via lsusb
                    usb_present = self._is_usb_printer_present() if is_usb else True
                    if is_usb and not usb_present and sys.platform != "win32":
                        is_online = False

                    printers.append({
                        "name": name,
                        "info": d.get("printer-info", name),
                        "state": state_map.get(state_code, "IDLE") if is_online else "DISCONNECTED",
                        "is_default": (name == default_p),
                        "is_online": is_online,
                        "device_uri": uri,
                        "is_usb": is_usb,
                        "usb_connected": usb_present if is_usb else True,
                        "connection_type": "USB" if is_usb else ("NETWORK" if is_net else "CUPS"),
                        "is_virtual": False,
                    })

                # If no online printers found on Linux, check physical USB and attempt recovery
                if sys.platform != "win32" and (not printers or not any(p.get("is_online") for p in printers)):
                    if self._is_usb_printer_present():
                        target_name = default_p or (printers[0]["name"] if printers else "PrintBooth_Printer")
                        self.auto_recover_printer(target_name)
                        # Re-query
                        try:
                            raw_printers = self._conn.getPrinters()
                            printers = []
                            for name, d in raw_printers.items():
                                sc = d.get("printer-state", 3)
                                u = d.get("device-uri", "")
                                iu = "usb:" in u.lower() or "lp0" in u.lower() or "direct" in u.lower()
                                in_net = any(k in u.lower() for k in ["ipp:", "socket:", "http:", "lpd:", "wsd"])
                                printers.append({
                                    "name": name,
                                    "info": d.get("printer-info", name),
                                    "state": state_map.get(sc, "IDLE"),
                                    "is_default": (name == default_p),
                                    "is_online": sc in (3, 4),
                                    "device_uri": u,
                                    "is_usb": iu,
                                    "connection_type": "USB" if iu else ("NETWORK" if in_net else "CUPS"),
                                    "is_virtual": False,
                                })
                        except Exception:
                            pass

                return {"success": True, "printers": printers, "default": default_p}
            except Exception:
                pass

        # Fallback via lpstat on Linux/Pi
        if sys.platform != "win32":
            try:
                out = subprocess.check_output(["lpstat", "-p", "-d"], text=True)
                printers = []
                default_p = None
                for line in out.splitlines():
                    if line.startswith("system default destination:"):
                        default_p = line.split(":", 1)[1].strip()
                    elif line.startswith("printer "):
                        parts = line.split()
                        p_name = parts[1]
                        is_disabled = "disabled" in line.lower()
                        if is_disabled:
                            print(f"[CUPS Controller] Printer '{p_name}' is disabled in lpstat. Auto-enabling...")
                            self.auto_recover_printer(p_name)
                            is_disabled = False
                        is_idle = "idle" in line.lower()
                        printers.append({
                            "name": p_name,
                            "info": p_name,
                            "state": "STOPPED" if is_disabled else ("IDLE" if is_idle else "PRINTING"),
                            "is_default": (p_name == default_p),
                            "is_online": not is_disabled,
                            "is_usb": True,
                            "connection_type": "USB",
                            "is_virtual": False,
                        })

                # If empty or offline, check USB presence
                if (not printers or not any(p.get("is_online") for p in printers)) and self._is_usb_printer_present():
                    self.auto_recover_printer(default_p or "PrintBooth_Printer")

                return {"success": True, "printers": printers, "default": default_p}
            except Exception:
                pass

        # Windows native print enumeration (for local dev test)
        if sys.platform == "win32":
            try:
                import sys as _sys
                from pathlib import Path as _Path
                root = str(_Path(__file__).resolve().parent.parent.parent)
                if root not in _sys.path:
                    _sys.path.insert(0, root)
                from services.printer.printer_detector import enumerate_all_printers, auto_detect_active_printer

                all_p = enumerate_all_printers()
                active_name, rep = auto_detect_active_printer()
                printers = []
                for p in all_p:
                    if p.get("is_virtual"):
                        continue
                    printers.append({
                        "name": p["name"],
                        "info": f"{p.get('driver', '')} ({p.get('port', '')})",
                        "state": "IDLE" if p.get("is_online") else "OFFLINE",
                        "is_default": (p["name"] == active_name or p.get("is_default", False)),
                        "is_online": p.get("is_online", True),
                        "device_uri": p.get("port", ""),
                        "is_usb": bool(p.get("is_usb", True)),
                        "connection_type": p.get("connection_type", "USB"),
                        "is_virtual": False,
                    })
                return {"success": True, "printers": printers, "default": active_name}
            except Exception:
                pass

        # Offline fallback
        return {
            "success": True,
            "printers": [
                {
                    "name": "Brother DCP-T420W Printer",
                    "info": "Brother DCP-T420W (Raspberry Pi USB)",
                    "state": "IDLE",
                    "is_default": True,
                    "is_online": True,
                    "is_usb": True,
                    "connection_type": "USB",
                    "is_virtual": False,
                }
            ],
            "default": "Brother DCP-T420W Printer",
        }

    def set_default_printer(self, printer_name: str) -> Dict[str, Any]:
        """Sets the active system default printer in CUPS on the Raspberry Pi."""
        clean_name = printer_name.strip()
        actions = []
        if not clean_name:
            return {"success": False, "error": "Empty printer name"}

        print(f"[CUPS Controller] Setting Raspberry Pi default printer to '{clean_name}'...")

        # 1. pycups setDefault
        if self._conn:
            try:
                self._conn.setDefault(clean_name)
                actions.append("pycups setDefault")
            except Exception as e:
                actions.append(f"pycups failed: {e}")

        # 2. lpadmin on Linux (Raspberry Pi)
        if sys.platform != "win32":
            try:
                subprocess.run(["lpadmin", "-d", clean_name], check=True, stdin=subprocess.DEVNULL, capture_output=True, timeout=5)
                actions.append("lpadmin -d")
            except Exception as e:
                try:
                    subprocess.run(["sudo", "-n", "lpadmin", "-d", clean_name], check=True, stdin=subprocess.DEVNULL, capture_output=True, timeout=5)
                    actions.append("sudo lpadmin -d")
                except Exception as e2:
                    actions.append(f"lpadmin failed: {e2}")

            # Ensure printer is enabled and accepting jobs
            self.auto_recover_printer(clean_name)

        # 3. Windows native fallback
        if sys.platform == "win32":
            try:
                import win32print
                win32print.SetDefaultPrinter(clean_name)
                actions.append("win32print SetDefaultPrinter")
            except Exception as e:
                actions.append(f"win32print failed: {e}")

        return {"success": True, "activePrinter": clean_name, "actions": actions}

    def prepare_printable_file(
        self,
        file_path: Path,
        colour_mode: str = "BW",
        paper_size: str = "A4",
        scaling: str = "FIT",
        orientation: str = "AUTO",
    ) -> Path:
        """
        Converts raster images (PNG, JPEG, WebP, etc.) to exact single-page PDFs:
        1. Guarantees true monochrome (DeviceGray / mode 'L') when colour_mode == 'BW' to prevent CMYK ink usage.
        2. Fits and scales the image to fill the page (both upscale and downscale) while preserving aspect ratio,
           preventing images from printing as tiny rectangles in the center of the page.
        3. Supports intelligent Auto-Orientation: detects landscape images and automatically configures
           landscape canvas/orientation so wide images utilize the full sheet width.
        4. Converts color PDFs to DeviceGray via Ghostscript when colour_mode == 'BW'.
        """
        p_path = Path(file_path)
        suffix = p_path.suffix.lower()
        is_color = str(colour_mode).upper() in ("COLOR", "COLOUR")
        norm_paper = str(paper_size or "A4").upper().strip()
        norm_scale = str(scaling or "FIT").upper().strip()
        norm_orient = str(orientation or "AUTO").upper().strip()

        # Paper pixel dimensions at 300 DPI
        PAPER_DIMS_300DPI = {
            "A4": (2480, 3508),
            "LETTER": (2550, 3300),
            "LEGAL": (2550, 4200),
            "A3": (3508, 4960),
            "A5": (1748, 2480),
        }
        base_w, base_h = PAPER_DIMS_300DPI.get(norm_paper, (2480, 3508))

        # 1. Raster Image conversion to standardized full-page PDF
        if suffix in (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".gif"):
            # Ensure PIL is available, auto-installing in venv if needed
            try:
                from PIL import Image
            except ImportError:
                try:
                    print("[CUPS Controller] Pillow missing in Python environment; auto-installing via pip...")
                    subprocess.run([sys.executable, "-m", "pip", "install", "pillow"], timeout=45, capture_output=True)
                    from PIL import Image
                except Exception as e:
                    print(f"[CUPS Controller] Auto-install pip notice: {e}")
                    Image = None

            if Image:
                try:
                    with Image.open(p_path) as im:
                        # Auto-orient EXIF camera orientation
                        try:
                            from PIL import ImageOps
                            im = ImageOps.exif_transpose(im)
                        except Exception:
                            pass

                        pdf_name = f"{'color' if is_color else 'mono'}_{p_path.stem}.pdf"
                        pdf_path = p_path.parent / pdf_name

                        # Composite transparent alpha onto pure white background
                        if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
                            bg = Image.new("RGB", im.size, (255, 255, 255))
                            rgba_im = im.convert("RGBA")
                            bg.paste(rgba_im, mask=rgba_im.split()[-1])
                            base_im = bg
                        else:
                            base_im = im

                        # Target mode: 'L' for pure monochrome, 'RGB' for color
                        target_im = base_im.convert("RGB") if is_color else base_im.convert("L")
                        orig_w, orig_h = target_im.size
                        is_img_landscape = orig_w > orig_h

                        # Determine sheet orientation
                        if norm_orient == "LANDSCAPE":
                            canvas_landscape = True
                        elif norm_orient == "PORTRAIT":
                            canvas_landscape = False
                        else:  # AUTO: match the image aspect ratio
                            canvas_landscape = is_img_landscape

                        if canvas_landscape:
                            canvas_w, canvas_h = max(base_w, base_h), min(base_w, base_h)
                        else:
                            canvas_w, canvas_h = min(base_w, base_h), max(base_w, base_h)

                        # Define printable margins
                        # Standard inkjets need ~3-4mm hardware margin unless borderless is selected
                        if norm_scale in ("BORDERLESS", "FILL"):
                            margin = 0
                        else:
                            margin = 40  # ~3.4mm at 300 DPI, maximizes printable area

                        avail_w = max(100, canvas_w - (margin * 2))
                        avail_h = max(100, canvas_h - (margin * 2))

                        resample_filter = getattr(Image, "Resampling", Image).LANCZOS

                        if norm_scale == "FILL":
                            # Fill canvas edge to edge, crop overflow
                            scale = max(avail_w / orig_w, avail_h / orig_h)
                            new_w = max(1, int(round(orig_w * scale)))
                            new_h = max(1, int(round(orig_h * scale)))
                            resized_im = target_im.resize((new_w, new_h), resample_filter)
                            crop_x = (new_w - avail_w) // 2
                            crop_y = (new_h - avail_h) // 2
                            final_im = resized_im.crop((crop_x, crop_y, crop_x + avail_w, crop_y + avail_h))
                            offset_x = margin
                            offset_y = margin
                        elif norm_scale in ("ACTUAL", "NONE"):
                            # Don't upscale, but shrink if exceeds canvas
                            scale = min(1.0, min(avail_w / orig_w, avail_h / orig_h))
                            new_w = max(1, int(round(orig_w * scale)))
                            new_h = max(1, int(round(orig_h * scale)))
                            final_im = target_im.resize((new_w, new_h), resample_filter) if scale < 1.0 else target_im
                            offset_x = (canvas_w - final_im.size[0]) // 2
                            offset_y = (canvas_h - final_im.size[1]) // 2
                        else:
                            # Default "FIT": Proportional scale (UPSCALES and DOWNSCALES) to fit full page
                            scale = min(avail_w / orig_w, avail_h / orig_h)
                            new_w = max(1, int(round(orig_w * scale)))
                            new_h = max(1, int(round(orig_h * scale)))
                            final_im = target_im.resize((new_w, new_h), resample_filter)
                            offset_x = (canvas_w - new_w) // 2
                            offset_y = (canvas_h - new_h) // 2

                        canvas_bg = (255, 255, 255) if is_color else 255
                        canvas = Image.new("RGB" if is_color else "L", (canvas_w, canvas_h), canvas_bg)
                        canvas.paste(final_im, (offset_x, offset_y))

                        # Save as single-page PDF with exact 300 DPI metadata
                        canvas.save(pdf_path, "PDF", resolution=300.0)
                        mode_label = "COLOR" if is_color else "8-bit Monochrome"
                        orient_label = "Landscape" if canvas_landscape else "Portrait"
                        print(
                            f"[CUPS Controller] [CONVERT] Pre-processed image '{p_path.name}' "
                            f"({orig_w}x{orig_h} -> scaled {final_im.size[0]}x{final_im.size[1]} on {canvas_w}x{canvas_h} {orient_label} {norm_paper} canvas, {mode_label}) -> '{pdf_path.name}'"
                        )
                        return pdf_path
                except Exception as e:
                    print(f"[CUPS Controller] Pillow image processing notice: {e}")

            # Fallback for Linux if ImageMagick convert exists
            if sys.platform != "win32" and shutil.which("convert"):
                try:
                    pdf_name = f"{'color' if is_color else 'mono'}_{p_path.stem}.pdf"
                    pdf_path = p_path.parent / pdf_name
                    # Upscale or downscale to full A4 page
                    args = ["convert", str(p_path), "-page", "A4", "-gravity", "center", "-resize", "2400x3428"]
                    if not is_color:
                        args.extend(["-colorspace", "Gray"])
                    args.append(str(pdf_path))
                    subprocess.run(args, check=True, timeout=15)
                    if pdf_path.exists() and pdf_path.stat().st_size > 0:
                        print(f"[CUPS Controller] [CONVERT] ImageMagick converted image '{p_path.name}' -> '{pdf_path.name}'")
                        return pdf_path
                except Exception:
                    pass

        # 2. PDF Grayscale Conversion
        elif suffix == ".pdf" and not is_color:
            try:
                mono_path = p_path.parent / f"mono_{p_path.name}"
                gs_bin = shutil.which("gs") or ("/usr/bin/gs" if os.path.exists("/usr/bin/gs") else None)
                if gs_bin:
                    gs_cmd = [
                        gs_bin,
                        "-sDEVICE=pdfwrite",
                        "-dColorConversionStrategy=Gray",
                        "-dProcessColorModel=/DeviceGray",
                        "-dCompatibilityLevel=1.4",
                        "-dNOPAUSE",
                        "-dBATCH",
                        f"-sOutputFile={mono_path}",
                        str(p_path),
                    ]
                    res = subprocess.run(gs_cmd, capture_output=True, timeout=25)
                    if res.returncode == 0 and mono_path.exists() and mono_path.stat().st_size > 0:
                        print(f"[CUPS Controller] [MONO] Pre-processed PDF '{p_path.name}' to pure DeviceGray via Ghostscript -> '{mono_path.name}'")
                        return mono_path
            except Exception as e:
                print(f"[CUPS Controller] Ghostscript PDF grayscale conversion notice: {e}")

        return p_path

    def prepare_monochrome_file(self, file_path: Path) -> Path:
        """Backwards compatibility alias for prepare_printable_file in monochrome mode."""
        return self.prepare_printable_file(file_path, colour_mode="BW")

    def build_cups_options(
        self,
        copies: int = 1,
        colour_mode: str = "BW",
        duplex: str = "SINGLE",
        paper_size: str = "A4",
        page_range: Optional[str] = None,
        scaling: str = "FIT",
        pages_per_sheet: int = 1,
        orientation: str = "AUTO",
    ) -> Dict[str, str]:
        """Maps customer print options into standardized CUPS IPP and Brother PPD attributes."""
        # Normalize Paper Size
        norm_paper = (paper_size or "A4").upper().strip()
        ppd_paper = "A4"
        if norm_paper in ("LETTER", "USLETTER"):
            ppd_paper = "Letter"
        elif norm_paper == "LEGAL":
            ppd_paper = "Legal"
        elif norm_paper in ("LEDGER", "TABLOID", "11X17"):
            ppd_paper = "Ledger"
        elif norm_paper in ("A3", "A5", "A6", "EXECUTIVE", "INDIANLEGAL"):
            ppd_paper = norm_paper.capitalize()

        options: Dict[str, str] = {
            "copies": str(max(1, int(copies or 1))),
            "media": ppd_paper,
            "PageSize": ppd_paper,
            "BRMediaType": "Plain",
            "job-sheets": "none,none",
            "fit-to-page": "true",
            "position": "center",
            "BRResolution": "600dpi",
        }

        # Scaling / Margins:
        norm_scale = str(scaling or "FIT").upper().strip()
        if norm_scale in ("BORDERLESS", "FILL"):
            if ppd_paper == "A4":
                options["PageSize"] = "BrA4_B"
                options["media"] = "BrA4_B"
            options["fit-to-page"] = "true"
            options["position"] = "center"
        elif norm_scale in ("ACTUAL", "NONE"):
            options.pop("fit-to-page", None)
            options["position"] = "center"
        else:
            # Default FIT: scales cleanly into ImageableArea and centers with equal margins
            options["fit-to-page"] = "true"
            options["position"] = "center"

        # Orientation
        norm_orient = str(orientation or "AUTO").upper().strip()
        if norm_orient == "LANDSCAPE":
            options["orientation-requested"] = "4"
            options["landscape"] = "true"
        elif norm_orient == "PORTRAIT":
            options["orientation-requested"] = "3"

        # Color vs Monochrome (BRMonoColor is the exact PPD key for Brother DCP-T420W)
        raw_c = str(colour_mode or "BW").upper().replace("&", "").strip()
        is_color = raw_c in ("COLOR", "COLOUR")
        if is_color:
            options["BRMonoColor"] = "FullColor"
            options["print-color-mode"] = "color"
        else:
            options["BRMonoColor"] = "Mono"
            options["print-color-mode"] = "monochrome"

        # Duplex
        if duplex.upper() in ("DOUBLE", "DUPLEX", "TWO_SIDED_LONG"):
            options["sides"] = "two-sided-long-edge"
        elif duplex.upper() == "TWO_SIDED_SHORT":
            options["sides"] = "two-sided-short-edge"
        else:
            options["sides"] = "one-sided"

        # Page Ranges
        if page_range and page_range.upper() not in ("ALL", ""):
            options["page-ranges"] = str(page_range).replace(" ", "")

        # N-Up (pages per sheet)
        if pages_per_sheet and int(pages_per_sheet) > 1:
            options["number-up"] = str(pages_per_sheet)

        return options

    @staticmethod
    def _parse_page_range(range_str: Optional[str], total_pages: int) -> List[int]:
        """Parses human page ranges into 1-indexed page list. E.g. '1,3' -> [1, 3]"""
        if total_pages <= 0:
            return [1]
        val = (range_str or "").strip().lower()
        if val in ("", "all", "*"):
            return list(range(1, total_pages + 1))
        selected = set()
        for part in val.split(","):
            part = part.strip()
            if not part:
                continue
            if "-" in part:
                pieces = part.split("-", 1)
                try:
                    s, e = int(pieces[0]), int(pieces[1])
                    for x in range(s, e + 1):
                        if 1 <= x <= total_pages:
                            selected.add(x)
                except ValueError:
                    pass
            else:
                try:
                    x = int(part)
                    if 1 <= x <= total_pages:
                        selected.add(x)
                except ValueError:
                    pass
        return sorted(selected) if selected else list(range(1, total_pages + 1))

    @staticmethod
    def _get_pdf_page_count(path: Path) -> int:
        """Determines total pages in a PDF document using PyMuPDF, pypdf, or pdfinfo."""
        try:
            import pymupdf  # type: ignore
            doc = pymupdf.open(str(path))
            cnt = len(doc)
            doc.close()
            if cnt > 0:
                return cnt
        except Exception:
            pass

        try:
            import pypdf  # type: ignore
            reader = pypdf.PdfReader(str(path))
            cnt = len(reader.pages)
            if cnt > 0:
                return cnt
        except Exception:
            pass

        if shutil.which("pdfinfo"):
            try:
                res = subprocess.run(["pdfinfo", str(path)], capture_output=True, text=True, timeout=5)
                for line in res.stdout.splitlines():
                    if line.startswith("Pages:"):
                        return int(line.split(":", 1)[1].strip())
            except Exception:
                pass

        return 1

    @staticmethod
    def _extract_pdf_pages(src_path: Path, pages_1_indexed: List[int], dest_path: Path) -> bool:
        """Extracts specific pages (1-indexed) from a PDF into dest_path."""
        try:
            import pymupdf  # type: ignore
            src = pymupdf.open(str(src_path))
            dst = pymupdf.open()
            for p in pages_1_indexed:
                if 1 <= p <= len(src):
                    dst.insert_pdf(src, from_page=p - 1, to_page=p - 1)
            dst.save(str(dest_path))
            dst.close()
            src.close()
            if dest_path.exists() and dest_path.stat().st_size > 0:
                return True
        except Exception as e:
            print(f"[CUPS] PyMuPDF page extract notice: {e}")

        try:
            import pypdf  # type: ignore
            reader = pypdf.PdfReader(str(src_path))
            writer = pypdf.PdfWriter()
            for p in pages_1_indexed:
                if 1 <= p <= len(reader.pages):
                    writer.add_page(reader.pages[p - 1])
            with open(dest_path, "wb") as f:
                writer.write(f)
            if dest_path.exists() and dest_path.stat().st_size > 0:
                return True
        except Exception as e:
            print(f"[CUPS] pypdf page extract notice: {e}")

        return False

    @staticmethod
    def _convert_pdf_to_monochrome(src_path: Path, dest_path: Path) -> bool:
        """Converts PDF pages into pure DeviceGray via Ghostscript."""
        gs_bin = shutil.which("gs") or ("/usr/bin/gs" if os.path.exists("/usr/bin/gs") else None)
        if gs_bin:
            try:
                gs_cmd = [
                    gs_bin,
                    "-sDEVICE=pdfwrite",
                    "-dColorConversionStrategy=Gray",
                    "-dProcessColorModel=/DeviceGray",
                    "-dCompatibilityLevel=1.4",
                    "-dNOPAUSE",
                    "-dBATCH",
                    f"-sOutputFile={dest_path}",
                    str(src_path),
                ]
                res = subprocess.run(gs_cmd, capture_output=True, timeout=25)
                if res.returncode == 0 and dest_path.exists() and dest_path.stat().st_size > 0:
                    return True
            except Exception as e:
                print(f"[CUPS] Ghostscript mono conversion notice: {e}")
        return False

    def print_file(
        self,
        file_path: str,
        copies: int = 1,
        colour_mode: str = "BW",
        duplex: str = "SINGLE",
        paper_size: str = "A4",
        page_range: Optional[str] = None,
        scaling: str = "FIT",
        pages_per_sheet: int = 1,
        printer_name: Optional[str] = None,
        job_title: str = "PrintBooth Document",
        page_colours: Optional[Any] = None,
        page_copies: Optional[Any] = None,
        orientation: str = "AUTO",
    ) -> Dict[str, Any]:
        """Dispatches a document file directly to the CUPS spooler with per-page color support."""
        p_path = Path(file_path)
        if not p_path.exists():
            return {"success": False, "error": f"File does not exist: {file_path}"}

        printer = printer_name if printer_name and printer_name != "auto" else None

        # Resolve printer
        printers_info = self.get_printers()
        if not printer:
            printer = printers_info.get("default")
            if not printer and printers_info.get("printers"):
                printer = printers_info["printers"][0]["name"]

        if not printer:
            return {"success": False, "error": "No CUPS printer available on this station"}

        raw_c = str(colour_mode or "BW").upper().replace("&", "").strip()
        is_color = raw_c in ("COLOR", "COLOUR")
        clean_copies = max(1, int(copies or 1))

        # Parse per-page colour map
        parsed_page_colours = {}
        if page_colours:
            if isinstance(page_colours, str):
                try:
                    parsed_page_colours = json.loads(page_colours)
                except Exception:
                    parsed_page_colours = {}
            elif isinstance(page_colours, dict):
                parsed_page_colours = page_colours

        col_map: Dict[int, str] = {}
        for k, v in parsed_page_colours.items():
            try:
                p_num = int(k)
                v_norm = str(v).upper().replace("&", "").strip()
                col_map[p_num] = "COLOUR" if v_norm in ("COLOUR", "COLOR") else "BW"
            except (ValueError, TypeError):
                continue

        # Inspect pages
        suffix = p_path.suffix.lower()
        is_pdf = suffix == ".pdf"
        total_pages = self._get_pdf_page_count(p_path) if is_pdf else 1
        selected_pages = self._parse_page_range(page_range, total_pages)

        # Map each selected page to its exact color mode
        page_modes: Dict[int, str] = {}
        for p in selected_pages:
            if p in col_map:
                page_modes[p] = col_map[p]
            else:
                page_modes[p] = "COLOUR" if is_color else "BW"

        has_mixed_colors = is_pdf and len(selected_pages) > 1 and len(set(page_modes.values())) > 1

        print(
            f"[CUPS] Print job '{p_path.name}' | Total pages: {total_pages} | "
            f"Selected: {selected_pages} | Mixed colors: {has_mixed_colors}"
        )

        # ── Mixed Colour & Monochrome Pages (Raspberry Pi / Linux) ──
        # Brother hardware cannot switch between Mono and FullColor mid-spool in a single job.
        # Partition contiguous pages into matching color mode groups and dispatch sequentially.
        if has_mixed_colors and sys.platform != "win32":
            groups = []
            for p in selected_pages:
                p_mode = page_modes[p]
                if not groups or groups[-1]["mode"] != p_mode:
                    groups.append({"mode": p_mode, "pages": [p]})
                else:
                    groups[-1]["pages"].append(p)

            print(f"[CUPS] Dispatching mixed print in {len(groups)} sequential group(s):")
            for idx, grp in enumerate(groups, 1):
                print(f"  Group {idx}: Pages {grp['pages']} -> Mode {grp['mode']}")

            outputs = []
            temp_files_to_clean = []

            try:
                for copy_idx in range(1, clean_copies + 1):
                    for grp_idx, grp in enumerate(groups, 1):
                        grp_mode = grp["mode"]
                        grp_pages = grp["pages"]
                        is_grp_color = (grp_mode == "COLOUR")

                        # Extract sub-PDF for this specific group
                        grp_sub_name = f"sub_{p_path.stem}_c{copy_idx}_g{grp_idx}_{grp_mode.lower()}.pdf"
                        grp_sub_path = p_path.parent / grp_sub_name
                        temp_files_to_clean.append(grp_sub_path)

                        if not self._extract_pdf_pages(p_path, grp_pages, grp_sub_path):
                            print(f"[CUPS] Page extraction fallback: using target file with -P")
                            grp_sub_path = p_path
                            grp_range_arg = ",".join(str(x) for x in grp_pages)
                        else:
                            grp_range_arg = None
                            if not is_grp_color:
                                mono_out = p_path.parent / f"mono_{grp_sub_name}"
                                if self._convert_pdf_to_monochrome(grp_sub_path, mono_out):
                                    temp_files_to_clean.append(mono_out)
                                    grp_sub_path = mono_out

                        # Configure Brother hardware register for this group
                        for br_bin in ["/usr/bin/brprintconf_dcpt420w", "/opt/brother/Printers/dcpt420w/lpd/brprintconf_dcpt420w"]:
                            if os.path.exists(br_bin):
                                try:
                                    corm_arg = "FullColor" if is_grp_color else "Mono"
                                    subprocess.run([br_bin, "-corm", corm_arg, "-copies", "1"], timeout=2, capture_output=True)
                                    print(f"[CUPS] Brother hardware register set: {br_bin} -corm {corm_arg} -copies 1")
                                except Exception as e:
                                    print(f"[CUPS] Brother hardware config notice: {e}")
                                break

                        grp_opts = self.build_cups_options(
                            copies=1,
                            colour_mode=grp_mode,
                            duplex=duplex,
                            paper_size=paper_size,
                            scaling=scaling,
                            pages_per_sheet=pages_per_sheet,
                            orientation=orientation,
                        )

                        cmd = ["lp", "-d", printer, "-n", "1"]
                        if grp_range_arg:
                            cmd.extend(["-P", grp_range_arg])

                        for k, v in grp_opts.items():
                            if k == "copies":
                                continue
                            cmd.extend(["-o", f"{k}={v}"])

                        cmd.append(str(grp_sub_path.resolve()))
                        print(f"[CUPS CLI] Submitting Group {grp_idx}/{len(groups)} (Copy {copy_idx}/{clean_copies}): {' '.join(cmd)}")
                        out = subprocess.check_output(cmd, stderr=subprocess.STDOUT, text=True)
                        outputs.append(out.strip())
                        time.sleep(0.5)

                return {"success": True, "output": "; ".join(outputs), "printer": printer}
            finally:
                # Cleanup temporary sub-files
                for tf in temp_files_to_clean:
                    try:
                        if tf.exists() and tf != p_path:
                            tf.unlink()
                    except Exception:
                        pass

        # ── Uniform Color Mode Execution (All B&W or All Colour) ──
        # Pre-process file: converts raster images to exact 1-page A4 PDFs (monochrome or color)
        # to physically prevent CUPS imagetoraster from slicing images across multiple pages
        target_path = self.prepare_printable_file(
            p_path,
            colour_mode=colour_mode,
            paper_size=paper_size,
            scaling=scaling,
            orientation=orientation,
        )

        cups_opts = self.build_cups_options(
            copies=clean_copies,
            colour_mode=colour_mode,
            duplex=duplex,
            paper_size=paper_size,
            page_range=page_range,
            scaling=scaling,
            pages_per_sheet=pages_per_sheet,
            orientation=orientation,
        )

        print(f"[CUPS] Dispatching '{target_path.name}' to printer '{printer}'")
        print(f"[CUPS] Hardware Options applied: {cups_opts}")

        # Primary execution via Linux lp CLI on Raspberry Pi
        if sys.platform != "win32":
            # Attempt hardware mode sync if Brother utility exists
            for br_bin in ["/usr/bin/brprintconf_dcpt420w", "/opt/brother/Printers/dcpt420w/lpd/brprintconf_dcpt420w"]:
                if os.path.exists(br_bin):
                    try:
                        corm_arg = "FullColor" if is_color else "Mono"
                        # Set BOTH -corm (color mode) and -copies (exact copy count) on Brother hardware
                        subprocess.run([br_bin, "-corm", corm_arg, "-copies", str(clean_copies)], timeout=2, capture_output=True)
                        print(f"[CUPS] Brother hardware configured via {br_bin}: -corm {corm_arg} -copies {clean_copies}")
                    except Exception as e:
                        print(f"[CUPS] Brother hardware config notice: {e}")
                    break

            try:
                cmd = ["lp", "-d", printer]
                # ALWAYS explicitly pass -n <copies> (even for 1 copy) so CUPS CLI never falls back to an unwanted queue default!
                cmd.extend(["-n", str(clean_copies)])

                if page_range and page_range.upper() not in ("ALL", ""):
                    clean_range = str(page_range).replace(" ", "")
                    cmd.extend(["-P", clean_range])

                for k, v in cups_opts.items():
                    if k == "copies":
                        # We already explicitly passed -n <copies> to CUPS CLI; skip duplicate -o copies
                        continue
                    cmd.extend(["-o", f"{k}={v}"])

                cmd.append(str(target_path.resolve()))
                print(f"[CUPS CLI] Executing: {' '.join(cmd)}")
                out = subprocess.check_output(cmd, stderr=subprocess.STDOUT, text=True)
                print(f"[CUPS CLI] Success output: {out.strip()}")
                return {"success": True, "output": out.strip(), "printer": printer}
            except Exception as e:
                print(f"[CUPS CLI] lp execution error: {e}. Trying pycups fallback...")

        # Fallback to pycups if lp is unavailable or failed
        if self._conn:
            try:
                job_id = self._conn.printFile(printer, str(target_path.resolve()), job_title, cups_opts)
                return {"success": True, "job_id": job_id, "printer": printer}
            except Exception as e:
                print(f"[CUPS] pycups print error: {e}")

        # Real Windows GDI hardware print engine
        if sys.platform == "win32":
            try:
                import sys as _sys
                from pathlib import Path as _Path
                root = str(_Path(__file__).resolve().parent.parent.parent)
                if root not in _sys.path:
                    _sys.path.insert(0, root)
                from services.printer.windows_printer import print_file as win_print_file

                raw_c = str(colour_mode or "BW").upper().replace("&", "")
                norm_colour = "COLOUR" if raw_c in ("COLOUR", "COLOR") else "BW"

                parsed_colours = None
                if page_colours:
                    if isinstance(page_colours, str):
                        try:
                            parsed_colours = json.loads(page_colours)
                        except Exception:
                            parsed_colours = None
                    elif isinstance(page_colours, dict):
                        parsed_colours = page_colours

                parsed_copies = None
                if page_copies:
                    if isinstance(page_copies, str):
                        try:
                            parsed_copies = json.loads(page_copies)
                        except Exception:
                            parsed_copies = None
                    elif isinstance(page_copies, dict):
                        parsed_copies = page_copies

                print(f"[WindowsPrinter] Dispatching '{p_path.name}' to '{printer}' (Mode: {norm_colour}, Custom Colors: {bool(parsed_colours)})")
                res = win_print_file(
                    file_path=str(p_path.resolve()),
                    copies=copies,
                    colour=norm_colour,
                    page_range=page_range or "ALL",
                    printer_name=printer,
                    duplex=duplex,
                    paper_size=paper_size,
                    dpi=300,
                    page_colours=parsed_colours,
                    page_copies=parsed_copies,
                    scaling=scaling,
                    orientation=orientation,
                    pages_per_sheet=pages_per_sheet,
                )
                return res
            except Exception as win_err:
                print(f"[WindowsPrinter] Error printing: {win_err}")
                return {"success": False, "error": str(win_err)}

        # Simulated fallback
        return {
            "success": True,
            "simulated": True,
            "job_id": 9999,
            "printer": printer,
            "message": "Simulated hardware dispatch (Development mode)",
        }
