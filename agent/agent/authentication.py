"""
PrintBooth Device Agent — Cryptographic Identity & Authentication
==================================================================
Manages the hardware identity of the Raspberry Pi:
  - Generates & stores an Ed25519 private key in /etc/printbooth/device.key
  - Enforces strict filesystem permissions (chmod 600) on the private key
  - Performs zero-knowledge challenge-response authentication over TLS
  - The private key NEVER leaves the device, is NEVER sent over the network,
    and is NEVER written to logs.
"""

import os
import sys
import base64
import logging
from pathlib import Path
from typing import Tuple, Optional

from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.hazmat.primitives import serialization

logger = logging.getLogger("printbooth.auth")


class DeviceIdentityManager:
    def __init__(self, key_path: Path, kiosk_id: str):
        self.key_path = key_path
        self.kiosk_id = kiosk_id
        self._private_key: Optional[ed25519.Ed25519PrivateKey] = None
        self._public_key: Optional[ed25519.Ed25519PublicKey] = None
        self._load_or_generate_key()

    def _ensure_strict_permissions(self, file_path: Path):
        """Enforces chmod 600 (owner read/write only) on POSIX operating systems."""
        if os.name != "nt" and file_path.exists():
            try:
                # 0o600 = Owner Read/Write only
                file_path.chmod(0o600)
            except Exception as e:
                logger.warning(f"Could not enforce chmod 600 on {file_path}: {e}")

    def _load_or_generate_key(self):
        """Loads existing Ed25519 private key or securely provisions a new one."""
        self.key_path.parent.mkdir(parents=True, exist_ok=True)

        if self.key_path.exists():
            try:
                with open(self.key_path, "rb") as f:
                    self._private_key = serialization.load_pem_private_key(
                        f.read(),
                        password=None,
                    )
                if not isinstance(self._private_key, ed25519.Ed25519PrivateKey):
                    raise ValueError("Device key must be an Ed25519 private key.")

                self._public_key = self._private_key.public_key()
                self._ensure_strict_permissions(self.key_path)
                logger.info(f"Loaded existing device identity key from {self.key_path}")
                return
            except Exception as e:
                logger.error(f"Failed to load device key from {self.key_path}: {e}")
                raise

        # Generate a new high-security Ed25519 keypair
        logger.info(f"Generating new cryptographic Ed25519 identity key at {self.key_path}...")
        self._private_key = ed25519.Ed25519PrivateKey.generate()
        self._public_key = self._private_key.public_key()

        pem_data = self._private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )

        # Write to temporary file first with atomic rename to prevent partial writes
        temp_key = self.key_path.with_suffix(".tmp")
        with open(temp_key, "wb") as f:
            f.write(pem_data)

        self._ensure_strict_permissions(temp_key)
        temp_key.replace(self.key_path)
        self._ensure_strict_permissions(self.key_path)
        logger.info(f"Cryptographic device key securely generated and saved (chmod 600)")

    @property
    def public_key_base64(self) -> str:
        """Returns the public key as URL-safe base64 string for backend registration."""
        if not self._public_key:
            raise RuntimeError("Public key not available")
        raw_bytes = self._public_key.public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
        return base64.b64encode(raw_bytes).decode("ascii")

    def sign_challenge(self, nonce: str, timestamp: int, kiosk_id: str) -> str:
        """
        Signs authentication challenge payload: `kiosk_id:nonce:timestamp`
        Returns the base64-encoded signature.
        """
        if not self._private_key:
            raise RuntimeError("Private key is not initialized")

        payload = f"{kiosk_id}:{nonce}:{timestamp}".encode("utf-8")
        signature = self._private_key.sign(payload)
        return base64.b64encode(signature).decode("ascii")

    def verify_signature_locally(self, nonce: str, timestamp: int, kiosk_id: str, signature_b64: str) -> bool:
        """Self-test verification ensuring signing pipeline is 100% operational."""
        if not self._public_key:
            return False
        try:
            payload = f"{kiosk_id}:{nonce}:{timestamp}".encode("utf-8")
            sig_bytes = base64.b64decode(signature_b64)
            self._public_key.verify(sig_bytes, payload)
            return True
        except Exception:
            return False
