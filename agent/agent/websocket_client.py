"""
PrintBooth Device Agent — Resilient Outbound WebSocket Client
==============================================================
Manages outbound WSS connection from Raspberry Pi to PrintBooth Cloud:
  - Outbound-only: Pi initiates the TCP 443 connection (Zero inbound ports required)
  - Strict TLS verification with host validation in production
  - Ed25519 cryptographic challenge-response authentication
  - Exponential backoff with jitter on network disconnects
  - Background telemetry heartbeat sender
  - Message loop with strict pre-dispatch validation
"""

import os
import ssl
import json
import time
import random
import logging
import asyncio
from typing import Optional, Dict, Any

import websockets
from websockets.exceptions import ConnectionClosed, WebSocketException

from config import AgentConfig, SecurityError
from authentication import DeviceIdentityManager
from validation import validate_incoming_message, ValidationError
from commands import CommandDispatcher
from heartbeat import HeartbeatMonitor
from logging_config import audit_log

logger = logging.getLogger("printbooth.wss")


class DeviceWebSocketClient:
    def __init__(
        self,
        config: AgentConfig,
        identity: DeviceIdentityManager,
        dispatcher: CommandDispatcher,
        heartbeat: HeartbeatMonitor,
    ):
        self.config = config
        self.identity = identity
        self.dispatcher = dispatcher
        self.heartbeat = heartbeat

        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._is_running: bool = False
        self._is_authenticated: bool = False
        self._heartbeat_task: Optional[asyncio.Task] = None

        # Exponential backoff schedule (seconds)
        self.backoff_intervals = [1, 2, 5, 10, 30, 60]

    def _build_ssl_context(self) -> Optional[ssl.SSLContext]:
        """
        Builds a secure SSL context for outbound WSS.
        Enforces certificate and hostname validation in production.
        """
        if self.config.wss_url.startswith("ws://"):
            if self.config.environment in ("production", "staging"):
                raise SecurityError("Insecure ws:// protocol is strictly forbidden in production/staging environments!")
            return None

        ctx = ssl.create_default_context(ssl.Purpose.SERVER_AUTH)
        ctx.check_hostname = True
        ctx.verify_mode = ssl.CERT_REQUIRED

        if self.config.ca_cert_path and self.config.ca_cert_path.exists():
            ctx.load_verify_locations(cafile=str(self.config.ca_cert_path))
            logger.info(f"Loaded custom CA certificate from {self.config.ca_cert_path}")

        # In development only, allow disabling TLS verification if explicitly configured
        if not self.config.tls_verify and self.config.environment == "development":
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            logger.warning("[SECURITY WARNING] TLS certificate verification disabled in DEVELOPMENT mode only.")

        return ctx

    @property
    def is_connected(self) -> bool:
        """Returns True if the WebSocket connection is actively open across library versions."""
        if not self._ws:
            return False
        if hasattr(self._ws, "closed"):
            return not self._ws.closed
        if hasattr(self._ws, "state"):
            return str(self._ws.state.name) == "OPEN"
        return getattr(self._ws, "close_code", None) is None

    async def send_json(self, payload: Dict[str, Any]):
        """Encodes and transmits a JSON message over the active WebSocket."""
        if not self.is_connected:
            logger.warning("Attempted to send message while WebSocket is disconnected.")
            return

        try:
            raw_text = json.dumps(payload)
            await self._ws.send(raw_text)
        except Exception as e:
            logger.error(f"Failed to transmit WebSocket message: {e}")

    async def _authenticate(self) -> bool:
        """
        Executes zero-knowledge challenge-response handshake:
        1. Awaits AUTH_CHALLENGE containing server nonce & timestamp
        2. Signs payload with Ed25519 private key
        3. Sends AUTH_RESPONSE
        4. Awaits AUTH_SUCCESS
        """
        try:
            raw_challenge = await asyncio.wait_for(self._ws.recv(), timeout=10.0)
            challenge_msg = json.loads(raw_challenge)

            if challenge_msg.get("type") != "AUTH_CHALLENGE":
                logger.error(f"Expected AUTH_CHALLENGE from server, got: {challenge_msg.get('type')}")
                return False

            nonce = challenge_msg["nonce"]
            timestamp = int(challenge_msg["timestamp"])

            # Sign the nonce with the device's private key
            signature = self.identity.sign_challenge(
                nonce=nonce,
                timestamp=timestamp,
                kiosk_id=self.config.kiosk_id,
            )

            # Send response to server
            auth_response = {
                "type": "AUTH_RESPONSE",
                "kioskId": self.config.kiosk_id,
                "publicKey": self.identity.public_key_base64,
                "signature": signature,
                "timestamp": timestamp,
                "agentVersion": self.config.agent_version,
            }
            await self.send_json(auth_response)

            # Wait for server confirmation
            raw_confirm = await asyncio.wait_for(self._ws.recv(), timeout=10.0)
            confirm_msg = json.loads(raw_confirm)

            if confirm_msg.get("type") == "AUTH_SUCCESS":
                audit_log(logger, "AUTH_SUCCESS", f"Kiosk {self.config.kiosk_id} authenticated successfully.")
                self._is_authenticated = True
                return True
            else:
                reason = confirm_msg.get("error", "Unknown rejection")
                audit_log(logger, "AUTH_FAILED", f"Authentication rejected by server: {reason}")
                return False

        except Exception as e:
            audit_log(logger, "AUTH_ERROR", f"Exception during authentication handshake: {e}")
            return False

    async def _heartbeat_loop(self):
        """Continuously transmits live telemetry while connected."""
        interval = self.config.heartbeat_interval_seconds
        while self._is_running and self._is_authenticated and self.is_connected:
            try:
                await asyncio.sleep(interval)
                payload = self.heartbeat.generate_heartbeat_payload()
                await self.send_json(payload)
                logger.debug(f"Heartbeat telemetry sent for {self.config.kiosk_id}")
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning(f"Error sending heartbeat: {e}")

    async def _listen_loop(self):
        """Main message pump listening for inbound commands from backend."""
        while self._is_running and self.is_connected:
            try:
                raw_msg = await self._ws.recv()
                if not isinstance(raw_msg, str):
                    continue

                # 1. Strict schema validation
                try:
                    cmd = validate_incoming_message(
                        raw_msg=raw_msg,
                        device_kiosk_id=self.config.kiosk_id,
                        max_copies=self.config.max_copies,
                    )
                except ValidationError as val_err:
                    audit_log(logger, "REJECTED_COMMAND", f"Validation failure: {val_err}")
                    await self.send_json({
                        "type": "ERROR",
                        "code": "VALIDATION_FAILED",
                        "error": str(val_err),
                    })
                    continue

                # 2. Dispatch to processor
                await self.dispatcher.handle_command(cmd)

            except ConnectionClosed as cc:
                logger.info(f"WebSocket connection closed by server (code {cc.code}): {cc.reason}")
                break
            except Exception as e:
                logger.error(f"Error processing inbound message: {e}")

    async def connect_and_run(self):
        """
        Manages permanent connection lifecycle with exponential backoff & reconnection.
        """
        self._is_running = True
        backoff_idx = 0
        ssl_ctx = self._build_ssl_context()

        logger.info(f"Starting PrintBooth Agent for {self.config.kiosk_id} -> {self.config.wss_url}")

        while self._is_running:
            try:
                logger.info(f"Connecting to PrintBooth Gateway: {self.config.wss_url}...")
                extra_headers = {
                    "X-Kiosk-Id": self.config.kiosk_id,
                    "X-Agent-Version": self.config.agent_version,
                }

                connect_kwargs: dict[str, Any] = {
                    "ping_interval": 20,
                    "ping_timeout": 15,
                    "close_timeout": 5,
                    "max_size": 65536,
                }
                if ssl_ctx is not None:
                    connect_kwargs["ssl"] = ssl_ctx

                import inspect
                sig = inspect.signature(websockets.connect)
                if "additional_headers" in sig.parameters:
                    connect_kwargs["additional_headers"] = extra_headers
                else:
                    connect_kwargs["extra_headers"] = extra_headers

                async with websockets.connect(self.config.wss_url, **connect_kwargs) as ws:
                    self._ws = ws
                    logger.info("TCP/TLS connection established. Commencing challenge-response authentication...")

                    authenticated = await self._authenticate()
                    if not authenticated:
                        logger.error("Authentication failed. Closing connection and backing off.")
                        await ws.close(code=4003, reason="Authentication failed")
                        backoff_idx = min(backoff_idx + 1, len(self.backoff_intervals) - 1)
                        delay = self.backoff_intervals[backoff_idx] + random.uniform(0.5, 2.0)
                        await asyncio.sleep(delay)
                        continue

                    # Reset backoff on successful authentication
                    backoff_idx = 0

                    # Synchronize pending jobs and printer status
                    await self.dispatcher.handle_command({"type": "SYNC_JOBS", "kioskId": self.config.kiosk_id})
                    await self.dispatcher.handle_command({"type": "GET_STATUS", "kioskId": self.config.kiosk_id})

                    # Start background heartbeat task
                    self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

                    # Enter listening loop
                    await self._listen_loop()

            except (ConnectionRefusedError, OSError, WebSocketException) as net_err:
                logger.warning(f"Connection attempt failed: {net_err}")
            except Exception as e:
                logger.error(f"Unexpected error in connection loop: {e}", exc_info=True)

            finally:
                self._is_authenticated = False
                if self._heartbeat_task and not self._heartbeat_task.done():
                    self._heartbeat_task.cancel()

            if not self._is_running:
                break

            # Exponential backoff with jitter
            backoff_idx = min(backoff_idx + 1, len(self.backoff_intervals) - 1)
            base_delay = self.backoff_intervals[backoff_idx]
            jitter = random.uniform(0.2, 1.5)
            delay = base_delay + jitter
            logger.info(f"Reconnecting in {delay:.1f}s (backoff tier {backoff_idx})...")
            await asyncio.sleep(delay)

    def stop(self):
        """Signals client to shut down gracefully."""
        self._is_running = False
        if self._ws:
            asyncio.create_task(self._ws.close(code=1000, reason="Agent stopping"))
