# PrintBooth Secure Raspberry Pi Device Agent

> **Production-Grade, Outbound-Only Device Controller for PrintBooth Kiosks**  
> Target Platform: Raspberry Pi 4 (Raspberry Pi OS 64-bit / Debian Bookworm)  
> Architectural Security Principle: **The Raspberry Pi is a client, not a public server.**

---

## 1. Executive Architecture Summary

PrintBooth kiosks run an isolated, headless daemon on Raspberry Pi OS 64-bit that controls physical printing via CUPS (Common UNIX Printing System). The system is architected around zero-trust device boundaries:

```
Customer Smartphone / Laptop
        │  (HTTPS :443)
        ▼
PrintBooth Web / Cloud API
        │  (Verified Order & Payment)
        ▼
PrintBooth Device Gateway (Node.js/TypeScript)
        ▲
        │  (Outbound Persistent WSS over port 443 only)
        │  (Zero Inbound Ports on Kiosk)
Raspberry Pi 4 Device Agent (Python asyncio)
        │  (Local IPC / UNIX domain socket)
        ▼
      CUPS  ───(USB / LAN)───>  Brother Printer
```

### Critical Security Boundaries
1. **Outbound-Only Connectivity**: The Raspberry Pi opens an outbound TLS 1.3 WebSocket connection (`wss://api.printbooth.in/device`). It accepts **zero inbound TCP/UDP ports**. No port forwarding, no public IP, no inbound HTTP/FastAPI, no public CUPS (port 631), and no public SSH.
2. **Kiosk UI Isolation**: The Chromium browser / React UI running on the kiosk touchscreen has **zero access** to the WebSocket connection, cryptographic keys, or device control socket. If a customer reloads, crashes, or inspects the kiosk webpage, they cannot send device commands or access backend credentials.
3. **Cryptographic Device Identity**: Every kiosk possesses an individual Ed25519 private key (`/etc/printbooth/device.key`, permissions `0600`) generated locally during provisioning. Private keys never leave the hardware. Connections authenticate via zero-knowledge challenge-response nonces.
4. **Strict Whitelist Command Dispatcher**: Arbitrary shell execution (`subprocess.run(shell=True)`, `eval()`, `exec()`, `/execute`) is completely forbidden. Only strictly schema-validated commands are permitted: `PING`, `PRINT_JOB`, `CANCEL_JOB`, `GET_STATUS`, `SYNC_JOBS`.
5. **Idempotent Job Engine**: SQLite local WAL-mode database ensures no print job is ever executed twice across reconnections, server retries, or hardware reboots.

---

## 2. Directory Structure

```
/opt/printbooth-agent/
├── agent/
│   ├── main.py                 # System daemon entrypoint & signal orchestrator
│   ├── websocket_client.py     # Outbound TLS WSS client with exponential backoff
│   ├── authentication.py       # Ed25519 cryptographic identity & signature provider
│   ├── commands.py             # Whitelist command router & idempotency validator
│   ├── jobs.py                 # Sandboxed PDF downloader, validator & lifecycle manager
│   ├── printer.py              # CUPS print engine & Windows development fallback
│   ├── heartbeat.py            # Hardware vitals (SoC temp, RAM, disk) & telemetry
│   ├── database.py             # SQLite WAL-mode idempotency database
│   ├── validation.py           # Strict Pydantic message schemas & path traversal sanitizer
│   ├── config.py               # Immutable environment configuration manager
│   └── logging_config.py       # Structured audit logger with automatic token redaction
│
├── data/
│   ├── agent.db                # SQLite state database (0600 permissions)
│   └── jobs/                   # Ephemeral sandbox directory for in-flight jobs
│
├── certs/
│   └── device.key              # Ed25519 256-bit private key (chmod 600)
│
├── config/
│   ├── device.json             # Active station configuration
│   └── device.json.example     # Reference template
│
├── systemd/
│   └── printbooth-agent.service # Hardened systemd service unit
│
├── scripts/
│   ├── install.sh              # Production provisioning & installer script
│   ├── firewall.sh             # UFW lockdown script (DENY all inbound)
│   └── provision.py            # Onboarding & key generation tool
│
├── tests/
│   └── test_agent_security.py  # 20 Automated security & penetration test cases
│
└── requirements.txt            # Locked Python dependencies
```

---

## 3. Cryptographic Authentication & Handshake Protocol

PrintBooth uses zero-knowledge Ed25519 challenge-response authentication. Stolen API keys do not exist because devices never use static bearer tokens.

```
Raspberry Pi (Client)                             Cloud Gateway (Server)
        │                                                    │
        │─── Outbound TCP :443 + TLS Handshake ─────────────>│
        │                                                    │
        │<── AUTH_CHALLENGE { nonce, timestamp } ────────────│
        │                                                    │
  [Computes Ed25519 signature]                               │
  data = "{kioskId}:{nonce}:{timestamp}"                    │
  sig = Ed25519_Sign(privateKey, data)                       │
        │                                                    │
        │─── AUTH_RESPONSE { kioskId, pubKey, sig } ────────>│
        │                                            [Verifies sig via pubKey]
        │                                            [Checks 60s clock skew]
        │<── AUTH_SUCCESS { serverTime } ────────────────────│
        │                                                    │
  [Session Established — Authenticated]                      │
```

---

## 4. Print Job State Machine

Print jobs strictly progress through immutable states persisted to SQLite:

```
[QUEUED] ──> [AUTHORIZED] ──> [DOWNLOADING] ──> [DOWNLOADED] ──> [SUBMITTED] ──> [PRINTING] ──> [COMPLETED]
   │              │                 │                 │               │              │
   ▼              ▼                 ▼                 ▼               ▼              ▼
[FAILED]       [FAILED]          [FAILED]          [FAILED]        [FAILED]       [FAILED]
```

### File Security & Sandboxing
- Inbound files are streamed directly into an isolated directory: `/var/lib/printbooth/jobs/<jobId>/document.pdf`.
- File streaming is aborted immediately if byte size exceeds `maxFileSizeBytes` (default 50MB).
- PDF header magic bytes (`%PDF-`) and PyMuPDF structural checks are validated before CUPS submission.
- Once printing completes or fails, the job sandbox directory is **permanently purged** from disk to guarantee customer confidentiality.

---

## 5. Production Installation (Raspberry Pi OS 64-bit)

### Step 1: Run the Automated Installer
As root or with sudo:
```bash
sudo bash /opt/printbooth-agent/scripts/install.sh
```
This script automatically:
1. Installs CUPS, libcups2-dev, build-essential, and Python 3 venv.
2. Creates the dedicated non-login system user `printbooth` in groups `lp` and `lpadmin`.
3. Sets up directory structures with strict `0750` / `0600` permissions.
4. Generates an Ed25519 hardware keypair in `/etc/printbooth/device.key`.
5. Installs the hardened `systemd` service and configures auto-start.

### Step 2: Apply the Firewall Lockdown
```bash
sudo bash /opt/printbooth-agent/scripts/firewall.sh
```
The firewall enforces:
- `ufw default deny incoming`
- `ufw default allow outgoing`
- External access to CUPS (port 631) is explicitly denied.
- Optional LAN-only SSH rate-limited on port 22.

### Step 3: Register the Kiosk in Admin Console
Run the provisioning tool:
```bash
sudo /opt/printbooth-agent/venv/bin/python /opt/printbooth-agent/scripts/provision.py \
  --kiosk-id PB-PUNE-001 \
  --name "Pune Station Alpha" \
  --api-url https://api.printbooth.in/api
```
Copy the printed Public Key or submit the pairing code to the PrintBooth Cloud Dashboard.

### Step 4: Start the Agent Daemon
```bash
sudo systemctl enable printbooth-agent
sudo systemctl start printbooth-agent
sudo systemctl status printbooth-agent
```

---

## 6. Local Development Mode

To run both backend and agent locally on Windows, macOS, or Linux:

### 1. Start the Backend API & Gateway
```bash
# In repository root
npm run dev:api
```
The server will bind HTTP to port 5000 and the Device Gateway to `ws://localhost:5000/device`.

### 2. Configure Device Agent for Development
Edit `kiosk/agent/config/device.json`:
```json
{
  "kioskId": "PB-001",
  "kioskName": "Development Station",
  "environment": "development",
  "wssUrl": "ws://localhost:5000/device",
  "apiUrl": "http://localhost:5000/api",
  "printerName": "auto",
  "maxCopies": 20,
  "maxPages": 250,
  "maxFileSizeBytes": 52428800,
  "heartbeatIntervalSeconds": 10
}
```

### 3. Run the Agent
```bash
python kiosk/agent/agent/main.py --config kiosk/agent/config/device.json
```

### 4. Trigger End-to-End Demo Job
In a separate terminal:
```bash
node -e "fetch('http://localhost:5000/demo/jobs', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({kioskId: 'PB-001', jobId: 'JOB-TEST-100', copies: 1})}).then(r => r.json()).then(d => console.log(d))"
```

---

## 7. Threat Model & Security Mitigations

| Threat Vector | Attack Scenario | PrintBooth Mitigation |
| :--- | :--- | :--- |
| **Inbound Network Probing** | Attacker port-scans kiosk IP on public Wi-Fi. | **Zero open ports.** UFW drops all inbound connections. Pi acts purely as an outbound client. |
| **Kiosk Web Manipulation** | Customer opens DevTools or crashes React UI. | **Process boundary isolation.** React/Chromium runs in unprivileged sandbox without access to device agent or private keys. |
| **Arbitrary Shell Execution** | Rogue backend message sends bash injection. | **Whitelist commands only.** No `shell=True`, no dynamic code execution, strict Pydantic parsing. |
| **Credential Theft** | Attacker clones SD card or inspects filesystem. | Private key stored at `/etc/printbooth/device.key` with `chmod 600`. Backend only stores public keys. Single stolen key grants no cluster privileges. |
| **Duplicate Print Exploitation** | Network drops during printing; server retries command. | **SQLite Idempotency Engine.** Job state machine rejects previously processed or in-flight job IDs. |
| **Path Traversal Attacks** | Malicious `jobId` containing `../../etc/shadow`. | **Filename sanitization.** `re.sub(r'[^a-zA-Z0-9_\-]', '', token)` strictly strips directory traversal sequences. |
| **Resource Exhaustion** | 2GB file uploaded to fill Raspberry Pi RAM/Disk. | **Streaming size limits.** Download stream aborts after 50MB; PyMuPDF rejects documents > 250 pages. |
| **Unauthorized Jobs** | Attacker sends forged `PRINT_JOB` frame. | **Pre-flight server authorization.** Device agent verifies job authorization token against backend before spooling. |

---

## 8. Troubleshooting Guide

### 1. Agent Shows "Authentication failed: Invalid cryptographic signature"
- Check that the Kiosk's public key registered in the backend matches `/etc/printbooth/device.key`.
- Verify system clock: `timedatectl status`. Ed25519 handshake enforces a 60-second maximum clock skew.

### 2. CUPS Printer Rejection / "lp: Destination not found"
- Verify connected printers: `lpstat -p -d`.
- Set default printer queue: `sudo lpadmin -d Brother_DCP-T420W`.
- Check CUPS daemon: `sudo systemctl status cups`.

### 3. Agent Keeps Disconnecting / Backoff Loop
- Review agent logs: `journalctl -u printbooth-agent -f`.
- Verify DNS resolution: `curl -I https://api.printbooth.in/api/health`.
- Confirm outbound port 443 is unblocked on the local router/firewall.

### 4. Database Locked or Corrupted
- Check SQLite database permissions: `ls -la /opt/printbooth-agent/data/agent.db`.
- WAL mode requires write access to the parent folder for `.db-wal` and `.db-shm` files.
