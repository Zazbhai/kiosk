#!/usr/bin/env python3
"""
PrintBooth Kiosk — Device Provisioning Utility
==============================================
Runs on the Raspberry Pi during initial kiosk assembly:
  1. Generates cryptographic Ed25519 device keypair in /etc/printbooth/device.key (chmod 600)
  2. Generates an expiring, single-use 8-character provisioning code
  3. Displays registration instructions for the PrintBooth Admin Dashboard
"""

import os
import sys
import json
import secrets
import argparse
from pathlib import Path
from datetime import datetime, timezone, timedelta

_AGENT_DIR = Path(__file__).resolve().parent.parent / "agent"
if str(_AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(_AGENT_DIR))

from authentication import DeviceIdentityManager
from config import AgentConfig


def generate_provisioning_code() -> str:
    """Generates an 8-character human-friendly uppercase code (excluding ambiguous chars)."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(8))


def main():
    parser = argparse.ArgumentParser(description="PrintBooth Kiosk Device Provisioning")
    parser.add_argument("--kiosk-id", default=None, help="Target Kiosk ID (e.g. PB-PUNE-001)")
    parser.add_argument("--config", default=None, help="Custom device.json path")
    args = parser.parse_args()

    config = AgentConfig(config_file=args.config)
    kiosk_id = args.kiosk_id or config.kiosk_id or f"PB-NEW-{secrets.token_hex(2).upper()}"

    print("==========================================================")
    print("  PrintBooth Kiosk Cryptographic Device Provisioning")
    print("==========================================================")

    identity = DeviceIdentityManager(key_path=config.key_path, kiosk_id=kiosk_id)
    public_key = identity.public_key_base64
    code = generate_provisioning_code()
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=15)).strftime("%H:%M:%S UTC")

    print(f"\n[1] Hardware Cryptographic Identity:")
    print(f"    Station ID : {kiosk_id}")
    print(f"    Key Path   : {config.key_path}")
    print(f"    Public Key : {public_key}")

    print(f"\n[2] One-Time Provisioning Code (Single-Use):")
    print(f"    ========================")
    print(f"      CODE:  {code[:4]}-{code[4:]}")
    print(f"    ========================")
    print(f"    Expires at: {expires_at} (15 minutes validity)")

    print(f"\n[3] Admin Registration Instructions:")
    print(f"    1. Open PrintBooth Admin Console: https://admin.printbooth.in/kiosks/provision")
    print(f"    2. Enter Station ID: '{kiosk_id}'")
    print(f"    3. Enter Code: '{code[:4]}-{code[4:]}'")
    print(f"    4. Enter Device Public Key: '{public_key}'")
    print(f"    5. Click 'Authorize & Pair Device'")

    # Save to device config if kioskId updated
    target_cfg = config.db_path.parent.parent / "config" / "device.json"
    if target_cfg.exists():
        try:
            with open(target_cfg, "r") as f:
                data = json.load(f)
            data["kioskId"] = kiosk_id
            with open(target_cfg, "w") as f:
                json.dump(data, f, indent=2)
            print(f"\n[4] Updated local config at {target_cfg} with kioskId: {kiosk_id}")
        except Exception as e:
            print(f"[!] Could not update device.json: {e}")

    print("\n* Provisioning identity ready. Start agent with: systemctl start printbooth-agent\n")


if __name__ == "__main__":
    main()
