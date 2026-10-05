"""
PrintBooth Device Agent — Strict Command Processor
===================================================
Executes validated whitelisted commands from the central backend.
Guarantees:
  - Strict idempotency: Duplicate PRINT_JOB messages for an already-completed
    or actively-printing job are rejected with duplicate warning
  - Zero execution of arbitrary shell or python commands
  - Asynchronous background task execution for physical printing
"""

import logging
import asyncio
from typing import Dict, Any, Callable, Awaitable

from database import AgentDatabase
from jobs import JobManager
from printer import PrinterController
from heartbeat import HeartbeatMonitor

logger = logging.getLogger("printbooth.commands")


class CommandDispatcher:
    def __init__(
        self,
        db: AgentDatabase,
        job_manager: JobManager,
        printer: PrinterController,
        heartbeat_monitor: HeartbeatMonitor,
        send_response: Callable[[Dict[str, Any]], Awaitable[None]],
    ):
        self.db = db
        self.job_manager = job_manager
        self.printer = printer
        self.heartbeat_monitor = heartbeat_monitor
        self.send_response = send_response

    async def handle_command(self, cmd: Dict[str, Any]):
        """Dispatches validated command payload."""
        cmd_type = cmd["type"]

        if cmd_type == "PING":
            await self._handle_ping(cmd)
        elif cmd_type == "GET_STATUS":
            await self._handle_get_status(cmd)
        elif cmd_type == "PRINT_JOB":
            await self._handle_print_job(cmd)
        elif cmd_type == "CANCEL_JOB":
            await self._handle_cancel_job(cmd)
        elif cmd_type == "SYNC_JOBS":
            await self._handle_sync_jobs(cmd)
        else:
            logger.warning(f"Unrecognized command: {cmd_type}")

    async def _handle_ping(self, cmd: Dict[str, Any]):
        """Responds to server PING with PONG."""
        await self.send_response({
            "type": "PONG",
            "kioskId": cmd["kioskId"],
            "timestamp": cmd.get("timestamp"),
        })

    async def _handle_get_status(self, cmd: Dict[str, Any]):
        """Returns comprehensive device & printer telemetry."""
        payload = self.heartbeat_monitor.generate_heartbeat_payload()
        payload["type"] = "DEVICE_STATUS"
        await self.send_response(payload)

    async def _handle_print_job(self, cmd: Dict[str, Any]):
        """
        Processes PRINT_JOB with strict idempotency protection.
        """
        job_id = cmd["jobId"]
        kiosk_id = cmd["kioskId"]

        # ── Idempotency Check ──
        if self.db.is_job_duplicate(job_id):
            logger.warning(
                f"[IDEMPOTENCY] Job {job_id} has already been printed or is currently printing! "
                "Rejecting duplicate PRINT_JOB command to prevent double paper charging."
            )
            await self.send_response({
                "type": "JOB_REJECTED",
                "jobId": job_id,
                "kioskId": kiosk_id,
                "reason": "DUPLICATE_JOB",
                "message": f"Job {job_id} is already in progress or has completed.",
            })
            return

        # Register in local SQLite database
        registered = self.db.register_job(
            job_id=job_id,
            kiosk_id=kiosk_id,
            file_id=cmd["fileId"],
            copies=cmd["copies"],
            colour=cmd["colour"],
            duplex=cmd["duplex"],
            paper_size=cmd.get("paperSize", "A4"),
            status="QUEUED",
        )

        if not registered:
            # Race condition caught by primary key constraint
            logger.warning(f"[IDEMPOTENCY] Duplicate race condition caught for {job_id}.")
            return

        # Acknowledge receipt to backend
        await self.send_response({
            "type": "JOB_ACCEPTED",
            "jobId": job_id,
            "kioskId": kiosk_id,
            "message": "Job verified, stored locally, and queued for printing",
        })

        # Spawn asynchronous print execution so the WebSocket listener is not blocked
        async def on_status_update(status: str, payload: Dict[str, Any]):
            await self.send_response(payload)

        asyncio.create_task(
            self.job_manager.execute_job(
                job_id=job_id,
                kiosk_id=kiosk_id,
                file_id=cmd["fileId"],
                copies=cmd["copies"],
                colour=cmd["colour"],
                duplex=cmd["duplex"],
                paper_size=cmd.get("paperSize", "A4"),
                download_url=cmd.get("downloadUrl"),
                auth_token=cmd.get("authToken"),
                status_callback=on_status_update,
            )
        )

    async def _handle_cancel_job(self, cmd: Dict[str, Any]):
        """Cancels a job in the local database and spooler."""
        job_id = cmd["jobId"]
        self.db.update_job_status(job_id, "CANCELLED")
        await self.send_response({
            "type": "JOB_CANCELLED",
            "jobId": job_id,
            "kioskId": cmd["kioskId"],
        })

    async def _handle_sync_jobs(self, cmd: Dict[str, Any]):
        """Reports any pending jobs waiting in local SQLite queue."""
        pending = self.db.get_pending_jobs()
        await self.send_response({
            "type": "SYNC_JOBS_RESPONSE",
            "kioskId": cmd["kioskId"],
            "pendingCount": len(pending),
            "jobs": [p["job_id"] for p in pending],
        })
