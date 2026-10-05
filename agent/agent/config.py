"""
PrintBooth Device Agent — Configuration Manager
================================================
Handles secure loading of device identity, endpoints, thresholds, and operational limits.
Enforces that TLS verification can NEVER be disabled in production or staging environments.
"""

import os
import sys
import json
from pathlib import Path
from typing import Dict, Any, Optional


# Base directory for the device agent installation
BASE_DIR = Path(__file__).resolve().parent.parent

# Default directory locations
DEFAULT_CONFIG_PATH = Path("/opt/printbooth-agent/config/device.json")
LOCAL_CONFIG_PATH = BASE_DIR / "config" / "device.json"

DEFAULT_KEY_PATH = Path("/etc/printbooth/device.key")
LOCAL_KEY_PATH = BASE_DIR / "certs" / "device.key"

DEFAULT_DB_PATH = BASE_DIR / "data" / "agent.db"
DEFAULT_JOBS_DIR = Path("/var/lib/printbooth/jobs")
LOCAL_JOBS_DIR = BASE_DIR / "data" / "jobs"


class AgentConfig:
    def __init__(self, config_file: Optional[str] = None):
        self._raw_data: Dict[str, Any] = {}
        self._load_config(config_file)

        # ── Environment & Network ──
        # Environments: 'production' | 'staging' | 'development'
        self.environment: str = os.environ.get("PRINTBOOTH_ENV", self._raw_data.get("environment", "production")).lower()
        if self.environment not in ("production", "staging", "development"):
            raise ValueError(f"Invalid environment '{self.environment}'. Must be production, staging, or development.")

        # Backend URLs
        default_wss = "wss://api.printbooth.in/device" if self.environment == "production" else "ws://localhost:5000/device"
        self.wss_url: str = os.environ.get("PRINTBOOTH_WSS_URL", self._raw_data.get("wssUrl", default_wss)).strip()

        default_api = "https://api.printbooth.in/api" if self.environment == "production" else "http://localhost:5000/api"
        self.api_url: str = os.environ.get("PRINTBOOTH_API_URL", self._raw_data.get("apiUrl", default_api)).rstrip("/")

        # ── TLS Verification Security Guard ──
        # CRITICAL: In production or staging, TLS verification is unconditionally enforced!
        if self.environment in ("production", "staging"):
            self.tls_verify: bool = True
            if self.wss_url.startswith("ws://"):
                raise SecurityError(f"Insecure 'ws://' endpoint is forbidden in {self.environment} environment! Must use 'wss://'.")
        else:
            # Only allowed in local development
            allow_insecure_dev = os.environ.get("PRINTBOOTH_DEV_INSECURE_TLS", "false").lower() == "true"
            self.tls_verify = not allow_insecure_dev

        # Optional Custom CA Certificate path for private enterprise deployments
        custom_ca = os.environ.get("PRINTBOOTH_CA_CERT", self._raw_data.get("caCertPath"))
        self.ca_cert_path: Optional[Path] = Path(custom_ca).resolve() if custom_ca and Path(custom_ca).exists() else None

        # ── Device Identity ──
        self.kiosk_id: str = os.environ.get("KIOSK_ID", self._raw_data.get("kioskId", "")).strip().upper()
        self.kiosk_name: str = os.environ.get("KIOSK_NAME", self._raw_data.get("kioskName", "PrintBooth Kiosk"))

        # Private Key Path
        configured_key = os.environ.get("DEVICE_KEY_PATH", self._raw_data.get("keyPath"))
        if configured_key:
            self.key_path = Path(configured_key)
        elif DEFAULT_KEY_PATH.exists():
            self.key_path = DEFAULT_KEY_PATH
        else:
            self.key_path = LOCAL_KEY_PATH

        # ── Storage & Paths ──
        configured_db = os.environ.get("AGENT_DB_PATH", self._raw_data.get("dbPath"))
        self.db_path: Path = Path(configured_db) if configured_db else DEFAULT_DB_PATH
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

        configured_jobs = os.environ.get("AGENT_JOBS_DIR", self._raw_data.get("jobsDir"))
        if configured_jobs:
            self.jobs_dir = Path(configured_jobs)
        elif DEFAULT_JOBS_DIR.parent.exists() and os.access(DEFAULT_JOBS_DIR.parent, os.W_OK):
            self.jobs_dir = DEFAULT_JOBS_DIR
        else:
            self.jobs_dir = LOCAL_JOBS_DIR
        self.jobs_dir.mkdir(parents=True, exist_ok=True)

        # ── Operational Limits & Safeguards ──
        self.max_file_size_bytes: int = int(self._raw_data.get("maxFileSizeBytes", 50 * 1024 * 1024))  # 50 MB
        self.max_copies: int = int(self._raw_data.get("maxCopies", 20))
        self.max_pages: int = int(self._raw_data.get("maxPages", 250))
        self.heartbeat_interval_seconds: int = int(self._raw_data.get("heartbeatIntervalSeconds", 15))
        self.poll_interval_seconds: int = int(self._raw_data.get("pollIntervalSeconds", 3))

        # Printer configuration
        self.printer_name: str = os.environ.get("PRINTER_NAME", self._raw_data.get("printerName", "auto")).strip()
        self.agent_version: str = "1.0.0"

    def _load_config(self, config_file: Optional[str] = None):
        """Loads JSON configuration file with standard priority."""
        paths_to_check = []
        if config_file:
            paths_to_check.append(Path(config_file))
        if os.environ.get("PRINTBOOTH_CONFIG_FILE"):
            paths_to_check.append(Path(os.environ["PRINTBOOTH_CONFIG_FILE"]))
        paths_to_check.extend([DEFAULT_CONFIG_PATH, LOCAL_CONFIG_PATH])

        for p in paths_to_check:
            if p.exists() and p.is_file():
                try:
                    with open(p, "r", encoding="utf-8") as f:
                        self._raw_data = json.load(f)
                        return
                except Exception as e:
                    print(f"[Config] Warning: Failed to parse {p}: {e}", file=sys.stderr)


class SecurityError(Exception):
    """Raised when an operation violates cryptographic or device security boundaries."""
    pass
