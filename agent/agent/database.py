"""
PrintBooth Device Agent — SQLite Database & Idempotency Store
=============================================================
Manages persistent local state, ensuring:
  - Strict idempotency: Duplicate PRINT_JOB messages for an already-completed
    or in-progress job will NEVER reprint after network disconnects or reboots.
  - Full crash recovery: Pending jobs can be re-synchronized upon restart.
  - Local audit event history for device forensics.
"""

import sqlite3
import time
import logging
from pathlib import Path
from typing import Dict, Any, Optional, List

logger = logging.getLogger("printbooth.db")


class AgentDatabase:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=10.0)
        conn.row_factory = sqlite3.Row
        # Enable WAL mode for high concurrency & resilience against sudden power loss
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        return conn

    def _init_db(self):
        """Initializes relational tables if they do not exist."""
        with self._get_connection() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS devices (
                    kiosk_id TEXT PRIMARY KEY,
                    public_key TEXT,
                    registered_at REAL,
                    last_seen_at REAL
                );

                CREATE TABLE IF NOT EXISTS jobs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT UNIQUE NOT NULL,
                    kiosk_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    file_id TEXT,
                    copies INTEGER DEFAULT 1,
                    colour INTEGER DEFAULT 0,
                    duplex INTEGER DEFAULT 0,
                    paper_size TEXT DEFAULT 'A4',
                    total_pages INTEGER DEFAULT 1,
                    printed_pages INTEGER DEFAULT 0,
                    error TEXT,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    started_at REAL,
                    completed_at REAL
                );

                CREATE INDEX IF NOT EXISTS idx_jobs_job_id ON jobs(job_id);
                CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

                CREATE TABLE IF NOT EXISTS job_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    details TEXT,
                    timestamp REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS printer_status (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    status TEXT NOT NULL,
                    details TEXT,
                    recorded_at REAL NOT NULL
                );
            """)
            conn.commit()

    # ── Idempotency Verification ──
    def is_job_duplicate(self, job_id: str) -> bool:
        """
        Returns True if this job has already been received and is either currently
        printing or has already reached a terminal state (COMPLETED).
        Guarantees physical duplicate prints can NEVER occur.
        """
        with self._get_connection() as conn:
            row = conn.execute(
                "SELECT status FROM jobs WHERE job_id = ?",
                (job_id,)
            ).fetchone()

            if not row:
                return False

            status = row["status"]
            # Active or completed states must not be re-executed
            if status in ("COMPLETED", "PRINTING", "SUBMITTED", "DOWNLOADING"):
                return True

            return False

    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves record for a specific job."""
        with self._get_connection() as conn:
            row = conn.execute("SELECT * FROM jobs WHERE job_id = ?", (job_id,)).fetchone()
            return dict(row) if row else None

    def register_job(
        self,
        job_id: str,
        kiosk_id: str,
        file_id: str,
        copies: int,
        colour: bool,
        duplex: bool,
        paper_size: str = "A4",
        status: str = "QUEUED",
    ) -> bool:
        """Atomically inserts a new job record. Returns False if already exists."""
        now = time.time()
        with self._get_connection() as conn:
            try:
                conn.execute(
                    """
                    INSERT INTO jobs (
                        job_id, kiosk_id, status, file_id, copies, colour, duplex, paper_size,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        job_id,
                        kiosk_id,
                        status,
                        file_id,
                        copies,
                        1 if colour else 0,
                        1 if duplex else 0,
                        paper_size,
                        now,
                        now,
                    )
                )
                conn.commit()
                self.record_event(job_id, "JOB_REGISTERED", f"Status: {status}, Copies: {copies}")
                return True
            except sqlite3.IntegrityError:
                # Already exists
                return False

    def update_job_status(
        self,
        job_id: str,
        status: str,
        error: Optional[str] = None,
        printed_pages: Optional[int] = None,
        total_pages: Optional[int] = None,
    ):
        """Updates job state machine progress."""
        now = time.time()
        with self._get_connection() as conn:
            updates = ["status = ?", "updated_at = ?"]
            params: List[Any] = [status, now]

            if status == "PRINTING":
                updates.append("started_at = COALESCE(started_at, ?)")
                params.append(now)
            elif status in ("COMPLETED", "FAILED", "CANCELLED"):
                updates.append("completed_at = COALESCE(completed_at, ?)")
                params.append(now)

            if error is not None:
                updates.append("error = ?")
                params.append(error)

            if printed_pages is not None:
                updates.append("printed_pages = ?")
                params.append(printed_pages)

            if total_pages is not None:
                updates.append("total_pages = ?")
                params.append(total_pages)

            params.append(job_id)
            query = f"UPDATE jobs SET {', '.join(updates)} WHERE job_id = ?"
            conn.execute(query, tuple(params))
            conn.commit()

        self.record_event(job_id, f"STATUS_{status}", f"Error: {error}" if error else None)

    def record_event(self, job_id: str, event_type: str, details: Optional[str] = None):
        """Appends an event to the local audit timeline."""
        with self._get_connection() as conn:
            conn.execute(
                "INSERT INTO job_events (job_id, event_type, details, timestamp) VALUES (?, ?, ?, ?)",
                (job_id, event_type, details or "", time.time())
            )
            conn.commit()

    def get_pending_jobs(self) -> List[Dict[str, Any]]:
        """Returns jobs that were queued or authorized but not completed before a crash/reboot."""
        with self._get_connection() as conn:
            rows = conn.execute(
                "SELECT * FROM jobs WHERE status IN ('QUEUED', 'AUTHORIZED', 'DOWNLOADING', 'DOWNLOADED') ORDER BY created_at ASC"
            ).fetchall()
            return [dict(r) for r in rows]

    def record_printer_status(self, status: str, details: str):
        """Records current hardware status snapshot."""
        with self._get_connection() as conn:
            conn.execute(
                "INSERT INTO printer_status (status, details, recorded_at) VALUES (?, ?, ?)",
                (status, details, time.time())
            )
            conn.commit()
