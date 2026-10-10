/**
 * KioskSessionScreen — PrintBooth Kiosk QR Upload Session Display
 *
 * This screen:
 * 1. Instantly renders an active QR code on frame 0 (ZERO lag, never blank)
 * 2. Asynchronously registers an encrypted single-use session with the backend
 * 3. Polls the kiosk session API every 1.5s to reflect live user flow
 * 4. When OTP is ready, displays it LARGE on screen with touch shortcut to keypad
 * 5. After DONE, auto-rotates to a new session QR after 4 seconds
 * 6. Includes instant switch to PIN release keypad for direct touch code entry
 * 7. Adheres to high-contrast White & Laser-Red (#dc2626) aesthetic
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import {
  useKioskSiteUrl,
  getKioskId,
  getKioskName,
  getKioskApiUrl,
  getKioskSiteUrl,
  getKioskQrUrl,
  loadKioskRuntimeConfig,
} from '../utils/siteConfig'
import './KioskSessionScreen.css'

// ─── Types ──────────────────────────────────────────────────────────────────

type SessionState =
  | 'QR_READY'
  | 'CLAIMED'
  | 'UPLOADING'
  | 'CONFIGURING'
  | 'PAYING'
  | 'OTP_READY'
  | 'PRINTING'
  | 'DONE'
  | null

interface LiveSession {
  sessionId: string
  token: string
  qrUrl: string
  state: SessionState
  phase?: string
  phaseStep?: number
  otp?: string
  orderId?: string
  fileName?: string
  totalPages?: number
  copies?: number
  colourMode?: string
  amount?: number
  expiresAt: number
  createdAt: number
  completedAt?: number
}

// ─── Phase Metadata ──────────────────────────────────────────────────────────

interface PhaseInfo {
  label: string
  sublabel: string
  step: number
  icon: string
  color: string
}

const PHASES: Record<string, PhaseInfo> = {
  QR_READY: {
    label: 'Scan QR to Upload',
    sublabel: 'Use your phone camera to scan the code below',
    step: 0,
    icon: '⬡',
    color: '#dc2626',
  },
  CLAIMED: {
    label: 'Session Connected',
    sublabel: 'User opened PrintBooth on their phone…',
    step: 1,
    icon: '⟳',
    color: '#dc2626',
  },
  UPLOADING: {
    label: 'Uploading Document',
    sublabel: 'User is uploading their file from mobile…',
    step: 2,
    icon: '⬆',
    color: '#e11d48',
  },
  CONFIGURING: {
    label: 'Configuring Print Settings',
    sublabel: 'User is selecting options (Color/Mono, copies, pages…)',
    step: 3,
    icon: '⚙',
    color: '#2563eb',
  },
  PAYING: {
    label: 'Processing UPI Payment',
    sublabel: 'User is completing payment on mobile…',
    step: 4,
    icon: '₹',
    color: '#7c3aed',
  },
  OTP_READY: {
    label: 'Enter OTP on Keypad',
    sublabel: 'Your 4-digit code is shown below ↓',
    step: 5,
    icon: '✓',
    color: '#16a34a',
  },
  PRINTING: {
    label: 'Printing Document…',
    sublabel: 'Feeding pages into output tray below',
    step: 6,
    icon: '⬛',
    color: '#dc2626',
  },
  DONE: {
    label: 'Print Complete!',
    sublabel: 'Thank you — please collect your pages from the tray',
    step: 7,
    icon: '✓',
    color: '#16a34a',
  },
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function KioskSessionScreen() {
  const navigate = useNavigate()

  // Dynamically resolve station identifiers (query params, localStorage, env)
  const kioskId = getKioskId()
  const kioskName = getKioskName()
  const apiUrl = getKioskApiUrl()
  const { siteUrl } = useKioskSiteUrl(apiUrl, kioskId)

  // Immediate non-null session: QR code displays INSTANTLY on frame 0 with ZERO LAG
  const [session, setSession] = useState<LiveSession>(() => {
    const kid = getKioskId()
    const surl = getKioskSiteUrl()
    return {
      sessionId: `init-${kid}`,
      token: 'init',
      qrUrl: getKioskQrUrl(kid, surl),
      state: 'QR_READY',
      phase: 'Scan QR to start uploading',
      phaseStep: 0,
      expiresAt: Date.now() + 300000,
      createdAt: Date.now(),
    }
  })

  const [timeLeft, setTimeLeft] = useState(300) // 5 minutes
  const [stateChanged, setStateChanged] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isEncryptedSession, setIsEncryptedSession] = useState(false)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const rotateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  // ── Session Creation & Upgrade ────────────────────────────────────────────

  const createSession = useCallback(async () => {
    if (!mountedRef.current) return
    setIsRefreshing(true)

    // Clear any pending retry timer before starting
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }

    try {
      // Primary attempt: backend API URL
      let res: Response | null = null
      try {
        res = await fetch(`${apiUrl}/api/kiosk-sessions/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kioskId, webBaseUrl: siteUrl }),
        })
      } catch (err) {
        // Fallback: try same-origin relative URL (for proxied servers)
        if (typeof window !== 'undefined' && window.location.origin !== apiUrl) {
          try {
            res = await fetch('/api/kiosk-sessions/create', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ kioskId, webBaseUrl: siteUrl }),
            })
          } catch {}
        }
      }

      if (res && res.ok) {
        const data = await res.json()
        if (data.success && mountedRef.current) {
          setSession({
            sessionId: data.sessionId,
            token: data.token,
            qrUrl: data.qrUrl || getKioskQrUrl(kioskId, siteUrl),
            state: 'QR_READY',
            phase: 'Scan QR to start uploading',
            phaseStep: 0,
            expiresAt: data.expiresAt || (Date.now() + 300000),
            createdAt: Date.now(),
          })
          setIsEncryptedSession(true)
          const remaining = Math.max(10, Math.floor(((data.expiresAt || (Date.now() + 300000)) - Date.now()) / 1000))
          setTimeLeft(remaining)
          return
        }
      }

      // If backend response wasn't successful, keep the existing QR and retry in background
      console.warn('[KioskSession] Backend session not ready yet; using station QR fallback. Will retry...')
      if (mountedRef.current) {
        retryTimerRef.current = setTimeout(createSession, 4000)
      }
    } catch (e) {
      console.warn('[KioskSession] Network glitch creating session:', e)
      if (mountedRef.current) {
        retryTimerRef.current = setTimeout(createSession, 4000)
      }
    } finally {
      if (mountedRef.current) setIsRefreshing(false)
    }
  }, [apiUrl, kioskId, siteUrl])

  // ── Auto-create session on mount + load config ────────────────────────────

  useEffect(() => {
    mountedRef.current = true
    loadKioskRuntimeConfig().catch(() => {})
    createSession()

    return () => {
      mountedRef.current = false
      if (pollRef.current) clearInterval(pollRef.current)
      if (rotateTimerRef.current) clearTimeout(rotateTimerRef.current)
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
  }, [createSession])

  // ── Session Polling (every 1.5s) ─────────────────────────────────────────

  useEffect(() => {
    // If we're still on fallback init session, don't poll until registered
    if (!session?.sessionId || session.sessionId.startsWith('init-')) return

    const poll = async () => {
      if (!mountedRef.current) return
      try {
        let res = await fetch(`${apiUrl}/api/kiosk-sessions/active/${encodeURIComponent(kioskId)}`).catch(() => null)
        if (!res || !res.ok) {
          // Fallback relative poll
          res = await fetch(`/api/kiosk-sessions/active/${encodeURIComponent(kioskId)}`).catch(() => null)
        }
        if (!res || !res.ok) return

        const data = await res.json()
        if (!data.success || !data.session || !mountedRef.current) return

        const s = data.session as LiveSession

        setSession(prev => {
          if (!prev) return s
          if (prev.state !== s.state) {
            setStateChanged(true)
            setTimeout(() => setStateChanged(false), 600)
          }
          return { ...prev, ...s }
        })

        // Auto-rotate on completion after 4 seconds
        if (s.state === 'DONE' && !rotateTimerRef.current) {
          rotateTimerRef.current = setTimeout(() => {
            if (!mountedRef.current) return
            rotateTimerRef.current = null
            createSession()
          }, 4000)
        }

        // Expired while still waiting: rotate immediately
        if (data.isExpired && s.state === 'QR_READY') {
          createSession()
        }
      } catch {}
    }

    pollRef.current = setInterval(poll, 1500)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [session?.sessionId, apiUrl, kioskId, createSession])

  // ── Countdown Timer ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!session || session.state !== 'QR_READY') return
    const t = setInterval(() => {
      setTimeLeft(tl => {
        if (tl <= 1) return 0
        return tl - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [session?.state])

  // Auto-rotate on timer expiry
  useEffect(() => {
    if (timeLeft === 0 && session?.state === 'QR_READY') {
      createSession()
    }
  }, [timeLeft, session?.state, createSession])

  // ── Derived UI State ──────────────────────────────────────────────────────

  const state = session?.state || 'QR_READY'
  const phase = PHASES[state] || PHASES.QR_READY
  const isWaiting = state === 'QR_READY'
  const isActiveFlow = !isWaiting && state !== 'DONE'
  const isOtpReady = state === 'OTP_READY'
  const isDone = state === 'DONE'

  const progressPercent = Math.round(((phase.step) / 7) * 100)
  const minutes = Math.floor(timeLeft / 60).toString().padStart(2, '0')
  const seconds = (timeLeft % 60).toString().padStart(2, '0')

  // Always valid QR URL
  const qrDisplayValue = session?.qrUrl || getKioskQrUrl(kioskId, siteUrl)

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="ks-root">
      {/* Ambient Red & White Mesh Lighting */}
      <div className="ks-bg-mesh" />

      {/* Top Status Bar */}
      <header className="ks-topbar">
        <div className="ks-topbar-pill">
          <span className="ks-topbar-dot" />
          <span>{kioskId} • {kioskName}</span>
        </div>
        <div className="ks-topbar-pill ks-topbar-right">
          <span className="ks-topbar-state-dot" style={{ background: phase.color }} />
          <span style={{ color: phase.color, fontWeight: 700 }}>{phase.label}</span>
        </div>
      </header>

      {/* Main Content */}
      <main className={`ks-main ${stateChanged ? 'ks-transition' : ''}`}>

        {/* ── IDLE: QR Code Display (ALWAYS VISIBLE, ZERO LAG) ── */}
        {isWaiting && (
          <div className="ks-qr-panel">
            <div className="ks-qr-header">
              <div className="ks-phase-badge">
                <span className="ks-phase-icon">⬡</span>
                <span className="ks-phase-badge-text">
                  {isEncryptedSession ? 'SECURE SESSION ACTIVE' : 'STATION QR ACTIVE'}
                </span>
              </div>
              <h1 className="ks-title">Print from Your Phone</h1>
              <p className="ks-subtitle">Scan the QR code with your camera to upload documents to this station</p>
            </div>

            {/* QR Code Frame with Red Corner Brackets & Laser Sweep */}
            <div className="ks-qr-frame">
              <div className="ks-qr-corner ks-qr-corner--tl" />
              <div className="ks-qr-corner ks-qr-corner--tr" />
              <div className="ks-qr-corner ks-qr-corner--bl" />
              <div className="ks-qr-corner ks-qr-corner--br" />
              <div className="ks-qr-inner">
                <QRCodeSVG
                  value={qrDisplayValue}
                  size={240}
                  level="H"
                  includeMargin={false}
                  fgColor="#09090b"
                  bgColor="#ffffff"
                />
              </div>
              {/* Laser sweep animation line */}
              <div className="ks-qr-sweep" />
            </div>

            {/* Session security badge */}
            <div className="ks-security-badge">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <span>Single-use encrypted session · Valid for {minutes}:{seconds}</span>
            </div>

            {/* Pulsing waiting indicator + Quick actions */}
            <div className="ks-qr-actions-row">
              <div className="ks-await-pill">
                <span className="ks-await-dot" />
                <span>Waiting for phone scan…</span>
              </div>

              <button
                type="button"
                className="ks-refresh-btn"
                onClick={() => createSession()}
                title="Refresh QR Code"
                disabled={isRefreshing}
              >
                <span className={`ks-refresh-icon ${isRefreshing ? 'ks-spinning' : ''}`}>↻</span>
                <span>Refresh QR</span>
              </button>
            </div>

            {/* Direct Switch to Keypad Button */}
            <button
              type="button"
              className="ks-pin-switch-btn"
              onClick={() => navigate('/pin')}
              id="kiosk-switch-to-pin"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span>Already Have a PIN? Enter on Keypad</span>
            </button>
          </div>
        )}

        {/* ── ACTIVE: Mirrored Flow Panel (When user scans on phone) ── */}
        {isActiveFlow && !isOtpReady && (
          <div className="ks-flow-panel">
            {/* Progress Steps */}
            <div className="ks-steps">
              {['Scan', 'Upload', 'Configure', 'Pay', 'OTP', 'Print'].map((label, i) => {
                const stepPhase = phase.step
                const isStepDone = i < stepPhase - 1
                const isStepActive = i === stepPhase - 1
                return (
                  <div key={label} className={`ks-step ${isStepDone ? 'ks-step--done' : ''} ${isStepActive ? 'ks-step--active' : ''}`}>
                    <div
                      className="ks-step-dot"
                      style={isStepActive ? { background: phase.color, color: '#ffffff', borderColor: phase.color, boxShadow: `0 0 14px ${phase.color}60` } : {}}
                    >
                      {isStepDone ? '✓' : i + 1}
                    </div>
                    <span className="ks-step-label">{label}</span>
                    {i < 5 && <div className={`ks-step-line ${isStepDone ? 'ks-step-line--done' : ''}`} />}
                  </div>
                )
              })}
            </div>

            {/* Progress Bar */}
            <div className="ks-progress-track">
              <div className="ks-progress-fill" style={{ width: `${progressPercent}%`, background: phase.color }} />
            </div>

            {/* Phase Card */}
            <div className="ks-phase-card" style={{ borderColor: `${phase.color}40` }}>
              <div className="ks-phase-icon-wrap" style={{ background: `${phase.color}15`, color: phase.color }}>
                <span className="ks-big-icon">{phase.icon}</span>
              </div>
              <div className="ks-phase-info">
                <h2 className="ks-phase-title" style={{ color: phase.color }}>{phase.label}</h2>
                <p className="ks-phase-sub">{session?.phase || phase.sublabel}</p>
                {session?.fileName && (
                  <div className="ks-file-pill">
                    <span>📄</span>
                    <span>{session.fileName}</span>
                    {session.totalPages && <span className="ks-file-pages">· {session.totalPages} {session.totalPages === 1 ? 'page' : 'pages'}</span>}
                    {session.copies && session.copies > 1 && <span className="ks-file-pages">· {session.copies} copies</span>}
                    {session.colourMode && <span className="ks-file-pages">· {session.colourMode === 'COLOUR' ? 'Color' : 'B&W'}</span>}
                    {typeof session.amount === 'number' && <span className="ks-file-pages" style={{ color: '#dc2626', fontWeight: 700 }}>· ₹{session.amount.toFixed(2)}</span>}
                  </div>
                )}
              </div>
            </div>

            {/* Pulsing waiting indicator */}
            <div className="ks-await-pill" style={{ borderColor: `${phase.color}40` }}>
              <span className="ks-await-dot" style={{ background: phase.color }} />
              <span>User is completing action on mobile…</span>
            </div>
          </div>
        )}

        {/* ── OTP READY: Show OTP Large (Customer sees PIN directly on kiosk) ── */}
        {isOtpReady && session?.otp && (
          <div className="ks-otp-panel">
            <div className="ks-otp-badge">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22,4 12,14.01 9,11.01" />
              </svg>
              <span>Payment Verified — Enter This Code on the Keypad</span>
            </div>

            <h1 className="ks-otp-headline">Your Print Code</h1>

            {/* OTP Digits — Large High-Contrast Display */}
            <div className="ks-otp-digits">
              {session.otp.split('').map((digit, i) => (
                <div key={i} className="ks-otp-digit">
                  {digit}
                </div>
              ))}
            </div>

            <p className="ks-otp-hint">Enter these 4 digits on the touchscreen keypad to begin printing ↓</p>

            {/* File info */}
            {session.fileName && (
              <div className="ks-file-pill" style={{ justifyContent: 'center' }}>
                <span>📄</span>
                <span>{session.fileName}</span>
                {session.totalPages && <span className="ks-file-pages">· {session.totalPages} {session.totalPages === 1 ? 'page' : 'pages'}</span>}
                {session.copies && session.copies > 1 && <span className="ks-file-pages">· {session.copies} copies</span>}
                {session.colourMode && <span className="ks-file-pages">· {session.colourMode === 'COLOUR' ? 'Color' : 'B&W'}</span>}
                {typeof session.amount === 'number' && <span className="ks-file-pages" style={{ color: '#dc2626', fontWeight: 700 }}>· ₹{session.amount.toFixed(2)}</span>}
              </div>
            )}

            {/* Navigate to OTP keypad button */}
            <button
              type="button"
              className="ks-goto-keypad-btn"
              onClick={() => navigate('/pin')}
              id="ks-goto-keypad"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <rect x="4" y="11" width="16" height="10" rx="3" />
                <path d="M8 11V8a4 4 0 018 0v3" />
              </svg>
              <span>Open Touch Keypad Now</span>
            </button>
          </div>
        )}

        {/* ── PRINTING State ── */}
        {state === 'PRINTING' && (
          <div className="ks-printing-panel">
            <div className="ks-printing-icon">
              <svg width="68" height="68" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6,9 6,2 18,2 18,9" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" />
              </svg>
            </div>
            <h2 className="ks-printing-title">Printing Document…</h2>
            <p className="ks-printing-sub">Your document is being printed. Please collect your pages from the tray below.</p>
            {session?.fileName && (
              <div className="ks-file-pill" style={{ justifyContent: 'center', marginTop: 8 }}>
                <span>📄</span>
                <span>{session.fileName}</span>
              </div>
            )}
            <div className="ks-printing-bars">
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} className="ks-printing-bar" style={{ animationDelay: `${i * 0.12}s` }} />
              ))}
            </div>
          </div>
        )}

        {/* ── DONE State ── */}
        {isDone && (
          <div className="ks-done-panel">
            <div className="ks-done-tick">
              <svg className="ks-done-svg" viewBox="0 0 52 52">
                <circle className="ks-done-circle" cx="26" cy="26" r="23" fill="none" />
                <path className="ks-done-check" fill="none" d="M14.5 27.2l7.5 7.5 15.5-16.5" />
              </svg>
            </div>
            <h2 className="ks-done-title">Print Complete!</h2>
            <p className="ks-done-sub">Please collect your pages from the output tray below</p>
            <div className="ks-rotate-notice">
              <span className="ks-await-dot" style={{ background: '#dc2626' }} />
              <span>Next customer QR generating in a moment…</span>
            </div>
          </div>
        )}
      </main>

      {/* Bottom Info Strip */}
      <footer className="ks-footer">
        <span>Station: <strong>{kioskId}</strong></span>
        <span>•</span>
        <span>Session: <code>{session?.sessionId?.slice(-8) || 'READY'}</code></span>
        <span>•</span>
        <span>Encrypted QR Upload</span>
        {isWaiting && <span>• Expires in {minutes}:{seconds}</span>}
      </footer>
    </div>
  )
}
