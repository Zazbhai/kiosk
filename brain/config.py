"""
PrintBooth Kiosk Brain Configuration
====================================
Loads environment variables with robust fallback defaults.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Search for .env in current folder, parent folder, or root
current_dir = Path(__file__).resolve().parent
for env_path in [current_dir / ".env", current_dir.parent / ".env", current_dir.parent.parent / ".env"]:
    if env_path.exists():
        load_dotenv(env_path)
        break

KIOSK_ID = os.environ.get("KIOSK_ID", "PB-001").strip().upper()
KIOSK_NAME = os.environ.get("KIOSK_NAME", "PrintBooth — Test Station")
KIOSK_SECRET = os.environ.get("KIOSK_SECRET", "").strip()
API_URL = os.environ.get("PRINTBOOTH_API_URL", "http://localhost:5000/api").rstrip("/")
PRINTER_NAME = os.environ.get("PRINTER_NAME", "auto")
POLL_INTERVAL_SECONDS = int(os.environ.get("POLL_INTERVAL_SECONDS", "3"))
HEARTBEAT_INTERVAL_SECONDS = int(os.environ.get("HEARTBEAT_INTERVAL_SECONDS", "10"))

TEMP_JOBS_DIR = Path(os.environ.get("TEMP_JOBS_DIR", "/tmp/printbooth_jobs" if os.name != "nt" else "./temp_jobs"))
TEMP_JOBS_DIR.mkdir(parents=True, exist_ok=True)

# Persistent data directory that survives Pi reboots (stored in project root or /var/lib/printbooth, NOT in /tmp)
DATA_DIR = Path(os.environ.get("DATA_DIR", current_dir / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
