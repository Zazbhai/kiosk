/**
 * KioskSessionScreen — PrintBooth Kiosk QR Upload Session Display
 *
 * This screen:
 * 1. Auto-generates an encrypted single-use QR code on mount
 * 2. Polls the kiosk session API every 1.5s to reflect user progress
 * 3. When user scans, shows mirrored flow phases with visual progress indicators
 * 4. When OTP is ready, displays it LARGE on screen (user no longer needs phone)
 * 5. After DONE, auto-rotates to a new session QR after 4 seconds
 *
 * Reuses the exact same kiosk design tokens as PinReleaseScreen + PrintingScreen.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { useKioskSiteUrl } from '../utils/siteConfig'
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
    label: 'Session Claimed',
    sublabel: 'User opening PrintBooth on their phone…',
    step: 1,
    icon: '⟳',
    color: '#f59e0b',
  },
  UPLOADING: {
    label: 'Uploading Document',
    sublabel: 'User is uploading their file…',
    step: 2,
    icon: '⬆',
    color: '#f59e0b',
  },
  CONFIGURING: {
    label: 'Configuring Print Settings',
    sublabel: 'User is selecting options (B&W, copies, duplex…)',
    step: 3,
    icon: '⚙',
    color: '#3b82f6',
  },
  PAYING: {
    label: 'Processing Payment',
    sublabel: 'User is completing UPI payment…',
    step: 4,
    icon: '₹',
    color: '#8b5cf6',
  },
  OTP_READY: {
    label: 'Enter OTP on Keypad',
    sublabel: 'Your 4-digit code is shown below ↓',
    step: 5,
    icon: '✓',
    color: '#16a34a',
  },
  PRINTING: {
    label: 'Printing…',
    sublabel: 'Collecting your document from the tray below',
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
  const kioskId = localStorage.getItem('pb_kiosk_id') || import.meta.env.VITE_KIOSK_ID || 'PB-001'
  const kioskName = localStorage.getItem('pb_kiosk_name') || import.meta.env.VITE_KIOSK_NAME || 'PrintBooth — Station 1'
  const apiUrl = (localStorage.getItem('pb_api_url') || import.meta.env.VITE_API_URL || 'http://localhost:5000').replace(/\/api$/, '')
  const { siteUrl } = useKioskSiteUrl(apiUrl, kioskId)

  const [session, setSession] = useState<LiveSession | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [timeLeft, setTimeLeft] = useState(300) // 5 minutes
  const [stateChanged, setStateChanged] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const rotateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  // ── Session Creation ──────────────────────────────────────────────────────

  const createSession = useCallback(async () => {
    if (isCreating) return
    setIsCreating(true)
    try {
      const res = await fetch(`${apiUrl}/api/kiosk-sessions/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kioskId, webBaseUrl: siteUrl }),
      })
      const data = await res.json()
      if (data.success && mountedRef.current) {
        setSession({
          sessionId: data.sessionId,
          token: data.token,
          qrUrl: data.qrUrl,
          state: 'QR_READY',
          phase: 'Scan QR to start uploading',
          phaseStep: 0,
          expiresAt: data.expiresAt,
          createdAt: Date.now(),
        })
        setTimeLeft(Math.floor((data.expiresAt - Date.now()) / 1000))
      }
    } catch (e) {
      console.error('[KioskSession] Failed to create session:', e)
    } finally {
      if (mountedRef.current) setIsCreating(false)
    }
  }, [apiUrl, kioskId, siteUrl, isCreating])

  // ── Auto-create session on mount ─────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true
    createSession()
    return () => {
      mountedRef.current = false
      if (pollRef.current) clearInterval(pollRef.current)
      if (rotateTimerRef.current) clearTimeout(rotateTimerRef.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Session Polling (every 1.5s) ─────────────────────────────────────────

  useEffect(() => {
    if (!session?.sessionId) return

    const poll = async () => {
      if (!mountedRef.current) return
      try {
        const res = await fetch(`${apiUrl}/api/kiosk-sessions/active/${encodeURIComponent(kioskId)}`)
        const data = await res.json()
        if (!data.success || !data.session) return
        if (!mountedRef.current) return

        const s = data.session as LiveSession

        setSession(prev => {
          if (!prev) return s
          // Detect state transitions for animation
          if (prev.state !== s.state) {
            setStateChanged(true)
            setTimeout(() => setStateChanged(false), 600)
          }
          return { ...prev, ...s }
        })

        // If DONE, auto-rotate to new session after 4 seconds
        if (s.state === 'DONE' && !rotateTimerRef.current) {
          rotateTimerRef.current = setTimeout(() => {
            if (!mountedRef.current) return
            rotateTimerRef.current = null
            createSession()
          }, 4000)
        }

        // Expired while still in QR_READY — rotate immediately
        if (data.isExpired && s.state === 'QR_READY') {
          createSession()
        }
      } catch {}
    }

    pollRef.current = setInterval(poll, 1500)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [session?.sessionId, apiUrl, kioskId]) // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [session?.state]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-rotate on timer expiry
  useEffect(() => {
    if (timeLeft === 0 && session?.state === 'QR_READY') {
      createSession()
    }
  }, [timeLeft, session?.state]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── Render ────────────────────────────────────────────────────────────────

  if (!session && isCreating) {
    return (
      <div className="ks-root">
        <div className="ks-creating">
          <div className="ks-spinner" />
          <p>Generating secure QR session…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="ks-root">
      {/* Ambient particle background */}
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

        {/* ── IDLE: QR Code Display ── */}
        {isWaiting && session && (
          <div className="ks-qr-panel">
            <div className="ks-qr-header">
              <div className="ks-phase-badge" style={{ background: `${phase.color}18`, border: `1px solid ${phase.color}40` }}>
                <span className="ks-phase-icon" style={{ color: phase.color }}>⬡</span>
                <span className="ks-phase-badge-text">SECURE SESSION ACTIVE</span>
              </div>
              <h1 className="ks-title">Print from Your Phone</h1>
              <p className="ks-subtitle">Scan the QR code with your camera to upload documents to this station</p>
            </div>

            {/* QR Code */}
            <div className="ks-qr-frame">
              <div className="ks-qr-corner ks-qr-corner--tl" />
              <div className="ks-qr-corner ks-qr-corner--tr" />
              <div className="ks-qr-corner ks-qr-corner--bl" />
              <div className="ks-qr-corner ks-qr-corner--br" />
              <div className="ks-qr-inner">
                <QRCodeSVG
                  value={session.qrUrl || `${siteUrl}/print?id=${kioskId}`}
                  size={230}
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
              <span>Encrypted single-use session · valid for {minutes}:{seconds}</span>
            </div>

            {/* Pulsing waiting indicator */}
            <div className="ks-await-pill">
              <span className="ks-await-dot" />
              <span>Waiting for user to scan…</span>
            </div>
          </div>
        )}

        {/* ── ACTIVE: Mirrored Flow Panel ── */}
        {isActiveFlow && !isOtpReady && (
          <div className="ks-flow-panel">
            {/* Progress Steps */}
            <div className="ks-steps">
              {['Scan', 'Upload', 'Configure', 'Pay', 'OTP', 'Print'].map((label, i) => {
                const stepPhase = phase.step
                const isDone = i < stepPhase - 1
                const isActive = i === stepPhase - 1
                return (
                  <div key={label} className={`ks-step ${isDone ? 'ks-step--done' : ''} ${isActive ? 'ks-step--active' : ''}`}>
                    <div className="ks-step-dot" style={isActive ? { background: phase.color, boxShadow: `0 0 12px ${phase.color}60` } : {}}>
                      {isDone ? '✓' : i + 1}
                    </div>
                    <span className="ks-step-label">{label}</span>
                    {i < 5 && <div className={`ks-step-line ${isDone ? 'ks-step-line--done' : ''}`} />}
                  </div>
                )
              })}
            </div>

            {/* Progress Bar */}
            <div className="ks-progress-track">
              <div className="ks-progress-fill" style={{ width: `${progressPercent}%`, background: phase.color }} />
            </div>

            {/* Phase Card */}
            <div className="ks-phase-card" style={{ borderColor: `${phase.color}30` }}>
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
                    {typeof session.amount === 'number' && <span className="ks-file-pages" style={{ color: '#c8ff00', fontWeight: 700 }}>· ₹{session.amount.toFixed(2)}</span>}
                  </div>
                )}
              </div>
            </div>

            {/* Pulsing waiting indicator */}
            <div className="ks-await-pill" style={{ borderColor: `${phase.color}30` }}>
              <span className="ks-await-dot" style={{ background: phase.color }} />
              <span>Waiting for user action…</span>
            </div>
          </div>
        )}

        {/* ── OTP READY: Show OTP Large ── */}
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

            {/* OTP Digits — Large Display */}
            <div className="ks-otp-digits">
              {session.otp.split('').map((digit, i) => (
                <div key={i} className="ks-otp-digit">
                  {digit}
                </div>
              ))}
            </div>

            <p className="ks-otp-hint">Enter these 4 digits on the keypad to the right →</p>

            {/* File info */}
            {session.fileName && (
              <div className="ks-file-pill" style={{ justifyContent: 'center' }}>
                <span>📄</span>
                <span>{session.fileName}</span>
                {session.totalPages && <span className="ks-file-pages">· {session.totalPages} {session.totalPages === 1 ? 'page' : 'pages'}</span>}
                {session.copies && session.copies > 1 && <span className="ks-file-pages">· {session.copies} copies</span>}
                {session.colourMode && <span className="ks-file-pages">· {session.colourMode === 'COLOUR' ? 'Color' : 'B&W'}</span>}
                {typeof session.amount === 'number' && <span className="ks-file-pages" style={{ color: '#c8ff00', fontWeight: 700 }}>· ₹{session.amount.toFixed(2)}</span>}
              </div>
            )}

            {/* Arrow pointing to keypad */}
            <div className="ks-keypad-arrow">
              <div className="ks-keypad-arrow-line" />
              <div className="ks-keypad-arrow-text">KEYPAD →</div>
            </div>

            {/* Navigate to OTP keypad button */}
            <button
              className="ks-goto-keypad-btn"
              onClick={() => navigate('/pin')}
              id="ks-goto-keypad"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <rect x="4" y="11" width="16" height="10" rx="3" />
                <path d="M8 11V8a4 4 0 018 0v3" />
              </svg>
              Open OTP Keypad
            </button>
          </div>
        )}

        {/* ── PRINTING State ── */}
        {state === 'PRINTING' && (
          <div className="ks-printing-panel">
            <div className="ks-printing-icon">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6,9 6,2 18,2 18,9" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" />
              </svg>
            </div>
            <h2 className="ks-printing-title">Printing…</h2>
            <p className="ks-printing-sub">Your document is being printed. Please collect from the tray below.</p>
            {session?.fileName && (
              <div className="ks-file-pill" style={{ justifyContent: 'center', marginTop: 8 }}>
                <span>📄</span>
                <span>{session.fileName}</span>
              </div>
            )}
            <div className="ks-printing-bars">
              {[0,1,2,3,4].map(i => (
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
            <h2 className="ks-done-title">Print Complete</h2>
            <p className="ks-done-sub">Please collect your pages from the tray below</p>
            <div className="ks-rotate-notice">
              <span className="ks-await-dot" style={{ background: '#dc2626' }} />
              <span>New QR code generating in a moment…</span>
            </div>
          </div>
        )}
      </main>

      {/* Bottom Info Strip */}
      <footer className="ks-footer">
        <span>Session ID: <code>{session?.sessionId?.slice(-8) || '—'}</code></span>
        <span>•</span>
        <span>Encrypted QR · Single-use · Auto-rotates on completion</span>
        {isWaiting && <span>• Expires in {minutes}:{seconds}</span>}
      </footer>
    </div>
  )
}
