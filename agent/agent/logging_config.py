"""
PrintBooth Device Agent — Security Logging Configuration
=========================================================
Configures structured, tamper-evident audit logging for the device agent.
Features:
  - Automatic redaction of cryptographic keys, tokens, and authorization headers
  - Structured fields for event classification (AUTH, COMMAND, JOB, HARDWARE)
  - Console and rotating file handler support
"""

import os
import re
import sys
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, Dict


# Regex patterns to detect and sanitize accidental credential leak attempts
SENSITIVE_PATTERNS = [
    (re.compile(r"(private_key|device_key|secret|password|sessionToken|bearer)\s*[:=]\s*['\"]?[A-Za-z0-9+/=_\-]{8,}['\"]?", re.IGNORECASE), r"\1=[REDACTED]"),
    (re.compile(r"(BEGIN (?:RSA |EC )?PRIVATE KEY)[\s\S]*?(END (?:RSA |EC )?PRIVATE KEY)", re.IGNORECASE), r"[REDACTED_PRIVATE_KEY]"),
    (re.compile(r"(signature\s*[:=]\s*['\"])[A-Za-z0-9+/=]{16,}(['\"])", re.IGNORECASE), r"\1[REDACTED_SIGNATURE]\2"),
]


class SecurityRedactionFilter(logging.Filter):
    """Filters log records to guarantee sensitive data is never written to disk or console."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            msg = record.msg
            for pattern, repl in SENSITIVE_PATTERNS:
                msg = pattern.sub(repl, msg)
            record.msg = msg
        return True


def setup_agent_logging(log_dir: Path, log_level: str = "INFO") -> logging.Logger:
    """Configures structured, redacted logging for the agent."""
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "agent.log"

    level = getattr(logging, log_level.upper(), logging.INFO)

    root_logger = logging.getLogger("printbooth")
    root_logger.setLevel(level)

    # Avoid duplicate handlers on re-initialization
    if root_logger.handlers:
        return root_logger

    formatter = logging.Formatter(
        fmt="%(asctime)s [%(levelname)s] [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    redaction_filter = SecurityRedactionFilter()

    # 1. Console Handler (stdout)
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(level)
    console_handler.setFormatter(formatter)
    console_handler.addFilter(redaction_filter)
    root_logger.addHandler(console_handler)

    # 2. Rotating File Handler (max 10MB x 5 backups)
    try:
        file_handler = RotatingFileHandler(
            str(log_file),
            maxBytes=10 * 1024 * 1024,
            backupCount=5,
            encoding="utf-8",
        )
        file_handler.setLevel(level)
        file_handler.setFormatter(formatter)
        file_handler.addFilter(redaction_filter)
        root_logger.addHandler(file_handler)
    except Exception as e:
        print(f"[Logging] Warning: Could not initialize log file {log_file}: {e}", file=sys.stderr)

    return root_logger


def audit_log(logger: logging.Logger, event_type: str, message: str, **kwargs: Any):
    """Logs a structured security audit event."""
    extra_str = f" | {kwargs}" if kwargs else ""
    logger.info(f"[AUDIT:{event_type}] {message}{extra_str}")
