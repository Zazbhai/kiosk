"""
PrintBooth Device Agent — Strict Message & Command Validator
=============================================================
Defines and executes rigorous schema validation on every message received
over the WebSocket connection before any command processing can occur.
Guarantees:
  - Whitelist enforcement (PING, PRINT_JOB, CANCEL_JOB, GET_STATUS, SYNC_JOBS)
  - Zero arbitrary code execution or shell parameter injection
  - Strict type checking (e.g. copies must be integer between 1 and MAX_COPIES)
  - Kiosk identity matching (rejects jobs targeted to other stations)
  - Path traversal and null byte sanitization
"""

import re
import json
from typing import Dict, Any, Tuple, Optional


# Whitelist of allowed incoming WebSocket commands
ALLOWED_COMMANDS = frozenset([
    "PING",
    "PRINT_JOB",
    "CANCEL_JOB",
    "GET_STATUS",
    "SYNC_JOBS",
])

# Canonical regular expressions for identifiers
JOB_ID_REGEX = re.compile(r"^JOB-[A-Za-z0-9_\-]{4,64}$")
KIOSK_ID_REGEX = re.compile(r"^PB-[A-Z0-9_\-]{2,32}$")
FILE_ID_REGEX = re.compile(r"^[A-Za-z0-9_\-]{4,128}$")

# Suspicious path traversal & shell injection character sequences
TRAVERSAL_PATTERN = re.compile(r"(\.\./|\.\.\\|/|\\|\x00|~|\$|;|\||&|>|<|`|!)")


class ValidationError(Exception):
    """Raised when an incoming message violates schema or security constraints."""
    pass


def sanitize_filename_token(token: str) -> str:
    """
    Sanitizes an identifier to prevent path traversal or shell injection.
    Only permits alphanumeric characters, hyphens, and underscores.
    """
    if not token or not isinstance(token, str):
        raise ValidationError("Identifier token must be a non-empty string.")
    if TRAVERSAL_PATTERN.search(token):
        raise ValidationError(f"Dangerous character detected in identifier: {token!r}")
    cleaned = re.sub(r"[^A-Za-z0-9_\-]", "", token)
    if not cleaned:
        raise ValidationError("Identifier cannot be empty after sanitization.")
    return cleaned


def validate_incoming_message(raw_msg: str, device_kiosk_id: str, max_copies: int = 20) -> Dict[str, Any]:
    """
    Validates a raw WebSocket message string.
    Returns parsed & validated message dictionary or raises ValidationError.
    """
    # 1. JSON parsing check
    if not raw_msg or not isinstance(raw_msg, str):
        raise ValidationError("Message payload must be a non-empty string.")

    if len(raw_msg) > 65536:  # 64 KB maximum message size
        raise ValidationError("Message payload exceeds 64KB maximum size limit.")

    try:
        msg = json.loads(raw_msg)
    except json.JSONDecodeError as e:
        raise ValidationError(f"Invalid JSON format: {e}")

    if not isinstance(msg, dict):
        raise ValidationError("Top-level message must be a JSON object.")

    # 2. Command type whitelist check
    msg_type = msg.get("type")
    if not msg_type or not isinstance(msg_type, str):
        raise ValidationError("Message missing 'type' string field.")

    cmd = msg_type.upper().strip()
    if cmd not in ALLOWED_COMMANDS:
        raise ValidationError(f"Command '{cmd}' is not in the allowed command whitelist.")

    # 3. Command-specific schema validation
    if cmd == "PRINT_JOB":
        return _validate_print_job(msg, device_kiosk_id, max_copies)
    elif cmd == "CANCEL_JOB":
        return _validate_cancel_job(msg, device_kiosk_id)
    elif cmd in ("PING", "GET_STATUS", "SYNC_JOBS"):
        return _validate_simple_command(cmd, msg, device_kiosk_id)

    raise ValidationError(f"Unhandled command: {cmd}")


def _validate_print_job(msg: Dict[str, Any], device_kiosk_id: str, max_copies: int) -> Dict[str, Any]:
    """Validates PRINT_JOB command payload."""
    job_id = msg.get("jobId")
    if not job_id or not isinstance(job_id, str):
        raise ValidationError("PRINT_JOB requires a string 'jobId' field.")
    if not JOB_ID_REGEX.match(job_id):
        raise ValidationError(f"Invalid jobId format '{job_id}'. Must match ^JOB-[A-Za-z0-9_\\-]+$")

    kiosk_id = msg.get("kioskId")
    if not kiosk_id or not isinstance(kiosk_id, str):
        raise ValidationError("PRINT_JOB requires a string 'kioskId' field.")

    # Authorization boundary: Kiosk ID must match this specific device
    if kiosk_id.strip().upper() != device_kiosk_id:
        raise ValidationError(
            f"Kiosk ID mismatch: Message destined for '{kiosk_id}', but this device is '{device_kiosk_id}'."
        )

    file_id = msg.get("fileId")
    if not file_id or not isinstance(file_id, str):
        raise ValidationError("PRINT_JOB requires a string 'fileId' field.")
    if not FILE_ID_REGEX.match(file_id) or TRAVERSAL_PATTERN.search(file_id):
        raise ValidationError("Invalid or suspicious 'fileId'. Path traversal characters are forbidden.")

    # Copies validation (must be strict integer, 1 <= copies <= max_copies)
    copies = msg.get("copies", 1)
    if isinstance(copies, bool) or not isinstance(copies, int):
        raise ValidationError("'copies' must be an integer.")
    if copies < 1:
        raise ValidationError("'copies' must be at least 1.")
    if copies > max_copies:
        raise ValidationError(f"'copies' ({copies}) exceeds device maximum limit ({max_copies}).")

    # Boolean flags validation
    colour = msg.get("colour", False)
    if not isinstance(colour, bool):
        raise ValidationError("'colour' field must be a strict boolean.")

    duplex = msg.get("duplex", False)
    if not isinstance(duplex, bool):
        raise ValidationError("'duplex' field must be a strict boolean.")

    paper_size = msg.get("paperSize", "A4")
    if not isinstance(paper_size, str) or paper_size.upper() not in ("A4", "A3", "LETTER", "LEGAL"):
        raise ValidationError(f"Unsupported paper size '{paper_size}'. Supported: A4, A3, LETTER, LEGAL.")

    return {
        "type": "PRINT_JOB",
        "jobId": sanitize_filename_token(job_id),
        "kioskId": kiosk_id.strip().upper(),
        "fileId": sanitize_filename_token(file_id),
        "copies": copies,
        "colour": colour,
        "duplex": duplex,
        "paperSize": paper_size.upper(),
        "downloadUrl": msg.get("downloadUrl"),  # Optional authorized temporary download link
        "authToken": msg.get("authToken"),      # Temporary job access bearer token
    }


def _validate_cancel_job(msg: Dict[str, Any], device_kiosk_id: str) -> Dict[str, Any]:
    """Validates CANCEL_JOB payload."""
    job_id = msg.get("jobId")
    if not job_id or not isinstance(job_id, str):
        raise ValidationError("CANCEL_JOB requires a string 'jobId' field.")
    if not JOB_ID_REGEX.match(job_id):
        raise ValidationError(f"Invalid jobId format '{job_id}'.")

    kiosk_id = msg.get("kioskId", device_kiosk_id)
    if kiosk_id and kiosk_id.strip().upper() != device_kiosk_id:
        raise ValidationError(f"Kiosk ID mismatch in CANCEL_JOB.")

    return {
        "type": "CANCEL_JOB",
        "jobId": sanitize_filename_token(job_id),
        "kioskId": device_kiosk_id,
    }


def _validate_simple_command(cmd: str, msg: Dict[str, Any], device_kiosk_id: str) -> Dict[str, Any]:
    """Validates simple parameterless commands."""
    kiosk_id = msg.get("kioskId")
    if kiosk_id and kiosk_id.strip().upper() != device_kiosk_id:
        raise ValidationError(f"Kiosk ID mismatch in {cmd}.")

    return {
        "type": cmd,
        "kioskId": device_kiosk_id,
        "timestamp": msg.get("timestamp"),
    }
