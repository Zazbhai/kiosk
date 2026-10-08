#!/usr/bin/env python3
"""
PrintBooth Kiosk Station Setup & Provisioning Utility
=====================================================
Pairs and configures a Raspberry Pi station to the central PrintBooth cloud,
secures the device with its unique device secret, and links to the merchant partner.

Usage:
  python3 setup_station.py --id PB-002 --secret pb_sec_xxxx --api http://192.168.1.4:5000/api

Or interactive mode:
  python3 setup_station.py
"""

import sys
import os
import json
import argparse
import urllib.request
import urllib.parse
from pathlib import Path
import subprocess

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass


def test_cups_printer():
    """Detects available CUPS printers on the Raspberry Pi."""
    try:
        out = subprocess.check_output(["lpstat", "-p", "-d"], stderr=subprocess.STDOUT, text=True)
        lines = [l.strip() for l in out.splitlines() if l.strip()]
        return lines
    except Exception:
        return []


def load_existing_env():
    """Reads existing .env configuration from the kiosk brain directory if present."""
    brain_dir = Path(__file__).resolve().parent
    env_file = brain_dir / ".env"
    env_data = {}
    if env_file.exists():
        try:
            for line in env_file.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env_data[k.strip()] = v.strip().strip("'\"")
        except Exception:
            pass
    return env_data


def main():
    parser = argparse.ArgumentParser(description="PrintBooth Kiosk Station Provisioning Tool")
    parser.add_argument("--id", dest="kiosk_id", help="Kiosk Station ID (e.g. PB-002)")
    parser.add_argument("--secret", dest="kiosk_secret", help="Unique Device Secret Key from Admin Dashboard")
    parser.add_argument("--api", dest="api_url", default=None, help="PrintBooth API Base URL (e.g. http://192.168.1.4:5000/api)")
    parser.add_argument("--name", dest="kiosk_name", default=None, help="Friendly Station Name")

    args = parser.parse_args()

    print("\n" + "=" * 60)
    print("  PrintBooth Kiosk Station Provisioning Utility")
    print("  Multi-Pi Secure Device Setup")
    print("=" * 60 + "\n")

    existing_env = load_existing_env()
    env_kiosk_id = existing_env.get("KIOSK_ID")
    env_secret = existing_env.get("KIOSK_SECRET")
    env_api_url = existing_env.get("PRINTBOOTH_API_URL") or existing_env.get("API_URL")

    kiosk_id = args.kiosk_id or env_kiosk_id
    if not kiosk_id:
        kiosk_id = input("Enter Kiosk Station ID (e.g. PB-002): ").strip().upper()

    if not kiosk_id.startswith("PB-"):
        print("❌ Error: Kiosk ID must follow PB-XXX format (e.g. PB-002).")
        sys.exit(1)

    kiosk_secret = args.kiosk_secret or env_secret
    if not kiosk_secret:
        kiosk_secret = input("Enter Device Secret Key (from Admin Console): ").strip()

    if not kiosk_secret:
        print("❌ Error: Device Secret Key is required to securely pair this station.")
        sys.exit(1)

    api_url = args.api_url
    if not api_url:
        default_url = env_api_url or "http://localhost:5000/api"
        if env_api_url and not sys.stdin.isatty():
            api_url = env_api_url
        else:
            prompt = input(f"Enter Central API URL [{default_url}]: ").strip()
            api_url = prompt if prompt else default_url

    def perform_handshake(target_url):
        clean_url = target_url.rstrip("/")
        if not clean_url.endswith("/api"):
            clean_url += "/api"
        verify_endpoint = f"{clean_url}/kiosks/{kiosk_id}/verify-auth"
        req = urllib.request.Request(
            verify_endpoint,
            headers={
                "X-Kiosk-Id": kiosk_id,
                "X-Kiosk-Secret": kiosk_secret,
                "Authorization": f"Bearer {kiosk_secret}",
                "Accept": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data, clean_url

    print(f"\n[1/3] 🌐 Verifying connection to PrintBooth server at {api_url}...")
    station_data = {}
    try:
        data, api_url = perform_handshake(api_url)
        if data.get("success"):
            station_data = data.get("data", {})
            print(f"  ✓ Handshake successful! Authenticated station: {kiosk_id}")
            print(f"  • Station Name: {station_data.get('name', 'N/A')}")
            print(f"  • Merchant ID : {station_data.get('merchantId', 'M-001')}")
            print(f"  • Location    : {station_data.get('location', 'N/A')}")
        else:
            print(f"❌ Server rejected credentials: {data.get('error')}")
            sys.exit(1)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")
        print(f"❌ Authentication failed (HTTP {e.code}): {body}")
        sys.exit(1)
    except Exception as e:
        is_local_target = "localhost" in api_url or "127.0.0.1" in api_url
        if is_local_target and env_api_url and "localhost" not in env_api_url and "127.0.0.1" not in env_api_url:
            print(f"⚠️  Note: Connection to {api_url} failed ({e}).")
            print(f"   'localhost' refers to this Raspberry Pi, not the host computer where the API is running.")
            print(f"   Detected LAN API URL in local .env: {env_api_url}")
            print(f"   Retrying verification against {env_api_url}...")
            try:
                data, api_url = perform_handshake(env_api_url)
                if data.get("success"):
                    station_data = data.get("data", {})
                    print(f"  ✓ Handshake successful against {api_url}! Authenticated station: {kiosk_id}")
                    print(f"  • Station Name: {station_data.get('name', 'N/A')}")
                    print(f"  • Merchant ID : {station_data.get('merchantId', 'M-001')}")
                    print(f"  • Location    : {station_data.get('location', 'N/A')}")
                else:
                    print(f"❌ Server rejected credentials: {data.get('error')}")
                    sys.exit(1)
            except Exception as e2:
                print(f"❌ Network connection failed to {env_api_url}: {e2}")
                sys.exit(1)
        else:
            print(f"❌ Network connection failed: {e}")
            if is_local_target:
                print("   💡 Note: 'localhost' refers to this Raspberry Pi itself.")
                print("      If your PrintBooth API runs on another machine on the LAN, specify:")
                print("      --api http://<YOUR_COMPUTER_LAN_IP>:5000/api  (e.g. http://192.168.1.4:5000/api)")
            else:
                print("   Please check your network and ensure the API server is reachable from this Pi.")
            sys.exit(1)

    print("\n[2/3] 🖨 Checking local hardware printers...")
    cups_info = test_cups_printer()
    if cups_info:
        for line in cups_info:
            print(f"  • {line}")
    else:
        print("  ℹ Note: No local CUPS printers found yet (or cups not installed). You can plug in your USB printer anytime.")

    print("\n[3/3] 💾 Writing local .env configuration...")
    brain_dir = Path(__file__).resolve().parent
    env_file = brain_dir / ".env"

    friendly_name = args.kiosk_name or station_data.get("name") or f"PrintBooth {kiosk_id}"

    env_content = f"""# ========================================================
# PrintBooth Kiosk Brain IoT Configuration
# Station ID : {kiosk_id}
# Station Name: {friendly_name}
# Merchant ID: {station_data.get('merchantId', 'M-001')}
# ========================================================

KIOSK_ID={kiosk_id}
KIOSK_NAME={friendly_name}
KIOSK_SECRET={kiosk_secret}
PRINTBOOTH_API_URL={api_url}
PRINTER_NAME=auto

POLL_INTERVAL_SECONDS=3
HEARTBEAT_INTERVAL_SECONDS=10
TEMP_JOBS_DIR=/tmp/printbooth_jobs
"""

    env_file.write_text(env_content, encoding="utf-8")
    try:
        # Set strict file permissions (read/write only by owner) on Unix/Linux
        if os.name != "nt":
            os.chmod(str(env_file), 0o600)
    except Exception:
        pass

    print(f"  ✓ Configuration saved to {env_file}")

    print("\n" + "=" * 60)
    print("  🎉 Setup Complete! This Raspberry Pi is now paired and secured.")
    print(f"  Station: {kiosk_id} | Merchant: {station_data.get('merchantId', 'M-001')}")
    print("  To launch the background agent:")
    print("    python3 daemon.py")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    main()
