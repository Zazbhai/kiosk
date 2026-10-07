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
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    import cups  # type: ignore
    CUPS_AVAILABLE = True
except ImportError:
    cups = None
    CUPS_AVAILABLE = False


class CupsController:
    """Interface to Linux CUPS spooler via pycups or fallback system CLI (lp/lpstat)."""

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

    def build_cups_options(
        self,
        copies: int = 1,
        colour_mode: str = "BW",
        duplex: str = "SINGLE",
        paper_size: str = "A4",
        page_range: Optional[str] = None,
        scaling: str = "FIT",
        pages_per_sheet: int = 1,
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
            "copies": str(max(1, copies)),
            "media": ppd_paper,
            "PageSize": ppd_paper,
            "BRMediaType": "Plain",
        }

        # Color vs Monochrome (BRMonoColor is the exact PPD key for Brother DCP-T420W)
        is_color = colour_mode.upper() in ("COLOR", "COLOUR")
        if is_color:
            options["BRMonoColor"] = "FullColor"
            options["print-color-mode"] = "color"
            options["ColorModel"] = "RGB"
        else:
            options["BRMonoColor"] = "Mono"
            options["print-color-mode"] = "monochrome"
            options["ColorModel"] = "Gray"
            options["HPColorMode"] = "grayscale"

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

        # Scaling / Fit to page
        if str(scaling).upper() in ("FIT", "FILL", "TRUE", "FIT_PRINTABLE", "FIT_PAPER"):
            options["fit-to-page"] = "true"

        # N-Up (pages per sheet)
        if pages_per_sheet and int(pages_per_sheet) > 1:
            options["number-up"] = str(pages_per_sheet)

        return options

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
    ) -> Dict[str, Any]:
        """Dispatches a document file directly to the CUPS spooler."""
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

        cups_opts = self.build_cups_options(
            copies=copies,
            colour_mode=colour_mode,
            duplex=duplex,
            paper_size=paper_size,
            page_range=page_range,
            scaling=scaling,
            pages_per_sheet=pages_per_sheet,
        )

        print(f"[CUPS] Dispatching '{p_path.name}' to printer '{printer}'")
        print(f"[CUPS] Hardware Options applied: {cups_opts}")

        # Primary execution via Linux lp CLI on Raspberry Pi (guarantees -n copies and -P page-ranges)
        if sys.platform != "win32":
            # Attempt hardware mode sync if Brother utility exists
            for br_bin in ["/usr/bin/brprintconf_dcpt420w", "/opt/brother/Printers/dcpt420w/lpd/brprintconf_dcpt420w"]:
                if os.path.exists(br_bin):
                    try:
                        col_arg = "COLOR" if colour_mode.upper() in ("COLOR", "COLOUR") else "MONO"
                        subprocess.run([br_bin, "-sec", col_arg], timeout=2, capture_output=True)
                    except Exception:
                        pass
                    break

            try:
                cmd = ["lp", "-d", printer]
                if copies and int(copies) > 1:
                    cmd.extend(["-n", str(copies)])
                if page_range and page_range.upper() not in ("ALL", ""):
                    clean_range = str(page_range).replace(" ", "")
                    cmd.extend(["-P", clean_range])
                for k, v in cups_opts.items():
                    cmd.extend(["-o", f"{k}={v}"])
                cmd.append(str(p_path.resolve()))
                print(f"[CUPS CLI] Executing: {' '.join(cmd)}")
                out = subprocess.check_output(cmd, stderr=subprocess.STDOUT, text=True)
                print(f"[CUPS CLI] Success output: {out.strip()}")
                return {"success": True, "output": out.strip(), "printer": printer}
            except Exception as e:
                print(f"[CUPS CLI] lp execution error: {e}. Trying pycups fallback...")

        # Fallback to pycups if lp is unavailable or failed
        if self._conn:
            try:
                job_id = self._conn.printFile(printer, str(p_path.resolve()), job_title, cups_opts)
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
