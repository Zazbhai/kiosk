"""
PrintBooth Raspberry Pi Device Agent — Main Daemon Entry Point
=============================================================
Runs as a systemd service (/etc/systemd/system/printbooth-agent.service).
Initializes hardware identity, local idempotency store, printer controller,
and outbound WSS connectivity.
"""

import os
import sys
import signal
import asyncio
import argparse
from pathlib import Path

# Ensure agent package directory is in sys.path
_AGENT_DIR = Path(__file__).resolve().parent
_BASE_DIR = _AGENT_DIR.parent
if str(_AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(_AGENT_DIR))

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

from config import AgentConfig
from logging_config import setup_agent_logging, audit_log
from database import AgentDatabase
from authentication import DeviceIdentityManager
from printer import PrinterController
from jobs import JobManager
from heartbeat import HeartbeatMonitor
from commands import CommandDispatcher
from websocket_client import DeviceWebSocketClient


async def async_main(config_file: str = None):
    # 1. Load configuration
    config = AgentConfig(config_file=config_file)

    # 2. Setup security logging
    log_dir = config.db_path.parent / "logs"
    logger = setup_agent_logging(log_dir=log_dir, log_level="INFO")

    logger.info("========================================================")
    logger.info(f"  PrintBooth Device Agent v{config.agent_version}")
    logger.info(f"  Kiosk Station ID : {config.kiosk_id or 'UNSET (Provisioning Required)'}")
    logger.info(f"  Environment      : {config.environment.upper()}")
    logger.info(f"  Gateway WSS URL  : {config.wss_url}")
    logger.info(f"  TLS Verification : {'ENABLED (Strict)' if config.tls_verify else 'DISABLED (Dev Only)'}")
    logger.info("========================================================")

    if not config.kiosk_id:
        logger.error("No kioskId configured! Please run provisioning or set KIOSK_ID in device.json.")
        sys.exit(1)

    # 3. Initialize SQLite local idempotency store
    db = AgentDatabase(config.db_path)

    # 4. Initialize Cryptographic Device Identity (Ed25519)
    identity = DeviceIdentityManager(key_path=config.key_path, kiosk_id=config.kiosk_id)
    audit_log(logger, "DEVICE_INIT", f"Public Key: {identity.public_key_base64[:16]}... (Private Key secured at {config.key_path})")

    # 5. Initialize Hardware Printer Controller (CUPS / GDI)
    printer = PrinterController(target_printer=config.printer_name)

    # 6. Initialize Sandboxed Job Manager
    job_manager = JobManager(
        db=db,
        printer=printer,
        jobs_dir=config.jobs_dir,
        api_url=config.api_url,
        max_file_size_bytes=config.max_file_size_bytes,
        max_pages=config.max_pages,
        tls_verify=config.tls_verify,
    )

    # 7. Initialize Heartbeat Telemetry Monitor
    heartbeat = HeartbeatMonitor(
        kiosk_id=config.kiosk_id,
        agent_version=config.agent_version,
        printer=printer,
    )

    # 8. Create Command Dispatcher
    client_ref = []

    async def send_response(payload):
        if client_ref:
            await client_ref[0].send_json(payload)

    dispatcher = CommandDispatcher(
        db=db,
        job_manager=job_manager,
        printer=printer,
        heartbeat_monitor=heartbeat,
        send_response=send_response,
    )

    # 9. Create Outbound WebSocket Client
    client = DeviceWebSocketClient(
        config=config,
        identity=identity,
        dispatcher=dispatcher,
        heartbeat=heartbeat,
    )
    client_ref.append(client)

    # 10. Handle graceful POSIX & Windows termination signals
    loop = asyncio.get_running_loop()

    def handle_shutdown():
        logger.info("Shutdown signal received. Stopping device agent gracefully...")
        client.stop()

    if os.name != "nt":
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, handle_shutdown)

    # Run connection lifecycle
    await client.connect_and_run()


def main():
    parser = argparse.ArgumentParser(description="PrintBooth Raspberry Pi Device Agent")
    parser.add_argument("--config", default=None, help="Path to custom device.json configuration file")
    parser.add_argument("--print-public-key", action="store_true", help="Display local device Ed25519 public key")
    args = parser.parse_args()

    if args.print_public_key:
        config = AgentConfig(config_file=args.config)
        identity = DeviceIdentityManager(key_path=config.key_path, kiosk_id=config.kiosk_id or "PB-UNKNOWN")
        print(f"Kiosk ID   : {config.kiosk_id}")
        print(f"Key Path   : {config.key_path}")
        print(f"Public Key : {identity.public_key_base64}")
        sys.exit(0)

    try:
        asyncio.run(async_main(config_file=args.config))
    except KeyboardInterrupt:
        print("\n[Agent] Stopped by user.")
    except Exception as e:
        print(f"[Agent] Fatal error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
