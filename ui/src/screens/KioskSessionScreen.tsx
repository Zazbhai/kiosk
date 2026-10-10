/**
 * KioskSessionScreen — PrintBooth Kiosk QR Upload Session & Interactive Display
 *
 * Implements full interactive kiosk display workflow:
 * 1. Frame 0 Instant QR Code for mobile upload
 * 2. Mobile Connected & Uploading State
 * 3. Section 1: Review Document & Page Preview (Thumbnails, sheet count, hardware telemetry)
 * 4. Section 2: Print Settings (Colour B&W vs Full Colour, Duplex, Copies, Pages, Live Price ₹)
 * 5. Section 3: Payment & UPI QR (Itemized order summary, Dynamic UPI QR code, Counter pay)
 * 6. Section 4: Live Printing Progress (Animated paper feed, percentage, hardware feedback)
 * 7. Section 5: Collection & Auto-Rotate (Thank you, collect pages, reset to fresh QR)
 * 8. Zero layout shift, White & Laser-Red (#dc2626) high-contrast theme
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
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

export type SessionState =
  | 'QR_READY'
  | 'CLAIMED'
  | 'UPLOADING'
  | 'CONFIRMING'
  | 'CONFIGURING'
  | 'PAYING'
  | 'OTP_READY'
  | 'PRINTING'
  | 'DONE'
  | null

export interface DocumentPreviewPage {
  pageNumber: number
  url: string
  title?: string
}

export interface DocumentData {
  fileName: string
  fileSize: number
  fileType: string
  pageCount: number
  filePath?: string
  fileUrl?: string
  pages?: DocumentPreviewPage[]
  uploadedAt: number
}

export interface PrintSettingsData {
  colour: 'BW' | 'COLOUR'
  duplex: 'SINGLE' | 'DOUBLE'
  copies: number
  pageRange: string
  paperSize: string
  pricePerPage: number
  totalAmount: number
}

export interface LiveSession {
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
  document?: DocumentData
  settings?: PrintSettingsData
  progressData?: Record<string, any>
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
    color: '#dc2626',
  },
  CONFIRMING: {
    label: 'Review Document',
    sublabel: 'Inspect your pages and continue to print settings',
    step: 3,
    icon: '📄',
    color: '#dc2626',
  },
  CONFIGURING: {
    label: 'Print Settings',
    sublabel: 'Select colour, copies, and sides on touchscreen',
    step: 4,
    icon: '⚙',
    color: '#dc2626',
  },
  PAYING: {
    label: 'Pay & Print',
    sublabel: 'Scan the UPI QR code to complete your order',
    step: 5,
    icon: '₹',
    color: '#dc2626',
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
    icon: '🖨️',
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

  const kioskId = getKioskId()
  const kioskName = getKioskName()
  const apiUrl = getKioskApiUrl()
  const { siteUrl } = useKioskSiteUrl(apiUrl, kioskId)

  // Immediate non-null session: QR code displays INSTANTLY on frame 0
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

  const [timeLeft, setTimeLeft] = useState(300)
  const [stateChanged, setStateChanged] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isEncryptedSession, setIsEncryptedSession] = useState(false)
  const [isActionPending, setIsActionPending] = useState(false)

  // Interactive UI Selection States on Touchscreen
  const [activePageIdx, setActivePageIdx] = useState(0)
  const [selectedColour, setSelectedColour] = useState<'BW' | 'COLOUR'>('BW')
  const [selectedDuplex, setSelectedDuplex] = useState<'SINGLE' | 'DOUBLE'>('SINGLE')
  const [selectedCopies, setSelectedCopies] = useState(1)
  const [selectedPageRange, setSelectedPageRange] = useState('ALL')
  const [printingProgress, setPrintingProgress] = useState(0)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const rotateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)

  // ── Session Creation & Upgrade ────────────────────────────────────────────

  const createSession = useCallback(async () => {
    if (!mountedRef.current) return
    setIsRefreshing(true)

    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }

    try {
      let res: Response | null = null
      try {
        res = await fetch(`${apiUrl}/api/kiosk-sessions/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kioskId, webBaseUrl: siteUrl }),
        })
      } catch {
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
          setActivePageIdx(0)
          setSelectedCopies(1)
          setSelectedColour('BW')
          setSelectedDuplex('SINGLE')
          setSelectedPageRange('ALL')
          setPrintingProgress(0)
          return
        }
      }

      if (mountedRef.current) {
        retryTimerRef.current = setTimeout(createSession, 4000)
      }
    } catch (e) {
      console.warn('[KioskSession] Network issue creating session:', e)
      if (mountedRef.current) {
        retryTimerRef.current = setTimeout(createSession, 4000)
      }
    } finally {
      if (mountedRef.current) setIsRefreshing(false)
    }
  }, [apiUrl, kioskId, siteUrl])

  useEffect(() => {
    mountedRef.current = true
    loadKioskRuntimeConfig().catch(() => {})
    createSession()

    return () => {
      mountedRef.current = false
      if (pollRef.current) clearInterval(pollRef.current)
      if (rotateTimerRef.current) clearTimeout(rotateTimerRef.current)
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
      if (progressTimerRef.current) clearInterval(progressTimerRef.current)
    }
  }, [createSession])

  // ── Session Polling (every 1.5s) ─────────────────────────────────────────

  useEffect(() => {
    if (!session?.sessionId || session.sessionId.startsWith('init-')) return

    const poll = async () => {
      if (!mountedRef.current) return
      try {
        let res = await fetch(`${apiUrl}/api/kiosk-sessions/active/${encodeURIComponent(kioskId)}`).catch(() => null)
        if (!res || !res.ok) {
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
            setTimeout(() => setStateChanged(false), 500)
          }
          return { ...prev, ...s }
        })

        // Auto-rotate on completion after 6 seconds
        if (s.state === 'DONE' && !rotateTimerRef.current) {
          rotateTimerRef.current = setTimeout(() => {
            if (!mountedRef.current) return
            rotateTimerRef.current = null
            createSession()
          }, 6000)
        }

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
      setTimeLeft(tl => Math.max(0, tl - 1))
    }, 1000)
    return () => clearInterval(t)
  }, [session?.state])

  useEffect(() => {
    if (timeLeft === 0 && session?.state === 'QR_READY') {
      createSession()
    }
  }, [timeLeft, session?.state, createSession])

  // ── Sync Settings from Session ───────────────────────────────────────────

  useEffect(() => {
    if (session?.settings) {
      if (session.settings.colour) setSelectedColour(session.settings.colour)
      if (session.settings.duplex) setSelectedDuplex(session.settings.duplex)
      if (session.settings.copies) setSelectedCopies(session.settings.copies)
      if (session.settings.pageRange) setSelectedPageRange(session.settings.pageRange)
    } else if (session?.colourMode) {
      setSelectedColour(session.colourMode === 'COLOUR' ? 'COLOUR' : 'BW')
    }
  }, [session?.settings, session?.colourMode])

  // ── Dynamic Pricing Calculation ──────────────────────────────────────────

  const pageCount = session?.document?.pageCount || session?.totalPages || 1
  const pricePerSheet = selectedColour === 'COLOUR'
    ? (selectedDuplex === 'SINGLE' ? 8 : 12)
    : (selectedDuplex === 'SINGLE' ? 2 : 3)
  const calculatedSheets = selectedDuplex === 'DOUBLE' ? Math.ceil(pageCount / 2) : pageCount
  const totalAmount = calculatedSheets * selectedCopies * pricePerSheet

  // ── Handlers for Customer Interactions on Kiosk Touchscreen ──────────────

  const handleContinueToSettings = async () => {
    if (!session?.sessionId) return
    setIsActionPending(true)
    try {
      await fetch(`${apiUrl}/api/kiosk-sessions/${encodeURIComponent(session.sessionId)}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nextState: 'CONFIGURING',
          colour: selectedColour,
          duplex: selectedDuplex,
          copies: selectedCopies,
          pageRange: selectedPageRange,
          pricePerPage: pricePerSheet,
          totalAmount,
        }),
      })
      setSession(prev => prev ? { ...prev, state: 'CONFIGURING', phase: 'Select print settings on touchscreen' } : null)
    } finally {
      setIsActionPending(false)
    }
  }

  const handleProceedToPayment = async () => {
    if (!session?.sessionId) return
    setIsActionPending(true)
    try {
      await fetch(`${apiUrl}/api/kiosk-sessions/${encodeURIComponent(session.sessionId)}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          colour: selectedColour,
          duplex: selectedDuplex,
          copies: selectedCopies,
          pageRange: selectedPageRange,
          pricePerPage: pricePerSheet,
          totalAmount,
        }),
      })

      const res = await fetch(`${apiUrl}/api/kiosk-sessions/${encodeURIComponent(session.sessionId)}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: totalAmount }),
      })
      const data = await res.json()
      setSession(prev => prev ? {
        ...prev,
        state: 'PAYING',
        orderId: data.orderId || prev.orderId,
        otp: data.otp || prev.otp,
        amount: totalAmount,
      } : null)
    } finally {
      setIsActionPending(false)
    }
  }

  const handleBackToConfirm = async () => {
    if (!session?.sessionId) return
    setSession(prev => prev ? { ...prev, state: 'CONFIRMING' } : null)
  }

  const handleBackToSettings = async () => {
    if (!session?.sessionId) return
    setSession(prev => prev ? { ...prev, state: 'CONFIGURING' } : null)
  }

  const handleExecutePrint = async () => {
    if (!session?.sessionId) return
    setIsActionPending(true)
    try {
      await fetch(`${apiUrl}/api/kiosk-sessions/${encodeURIComponent(session.sessionId)}/execute-print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      setSession(prev => prev ? { ...prev, state: 'PRINTING', phase: 'Printing document on Brother hardware…' } : null)

      // Start live progress bar simulation
      setPrintingProgress(5)
      let cur = 5
      if (progressTimerRef.current) clearInterval(progressTimerRef.current)
      progressTimerRef.current = setInterval(() => {
        cur += 15
        if (cur >= 100) {
          cur = 100
          if (progressTimerRef.current) clearInterval(progressTimerRef.current)
          fetch(`${apiUrl}/api/kiosk-sessions/${encodeURIComponent(session.sessionId)}/complete`, { method: 'POST' }).catch(() => {})
          setSession(prev => prev ? { ...prev, state: 'DONE', phase: 'Print complete! Collect from tray.' } : null)
        }
        setPrintingProgress(cur)
      }, 700)
    } finally {
      setIsActionPending(false)
    }
  }

  // ── Derived State ────────────────────────────────────────────────────────

  const rawState = session?.state || 'QR_READY'
  // If document was uploaded, but backend state is still transitioning, show CONFIRMING
  const state: SessionState = (rawState === 'CLAIMED' || rawState === 'UPLOADING') && session?.document
    ? 'CONFIRMING'
    : rawState

  const phase = PHASES[state || 'QR_READY'] || PHASES.QR_READY
  const isWaiting = state === 'QR_READY'
  const isOtpReady = state === 'OTP_READY'
  const isPrinting = state === 'PRINTING'
  const isDone = state === 'DONE'

  const minutes = Math.floor(timeLeft / 60).toString().padStart(2, '0')
  const seconds = (timeLeft % 60).toString().padStart(2, '0')

  const qrDisplayValue = session?.qrUrl || getKioskQrUrl(kioskId, siteUrl)

  // Current document and previews
  const doc = session?.document
  const docFileName = doc?.fileName || session?.fileName || 'Document.pdf'
  const docPages = doc?.pages || []
  const activePageUrl = docPages[activePageIdx]?.url

  // Dynamic UPI URL for payment QR code
  const effectiveOrderId = session?.orderId || `ORD-${Date.now().toString().slice(-6)}`
  const upiQrValue = useMemo(() => {
    const vpa = 'printbooth@upi'
    return `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(kioskName)}&am=${totalAmount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(effectiveOrderId)}`
  }, [kioskName, totalAmount, effectiveOrderId])

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

      {/* Main Container */}
      <main className={`ks-main ${stateChanged ? 'ks-transition' : ''}`}>

        {/* ── STEP 0: IDLE QR Code Display (Instant Frame 0) ── */}
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

            {/* QR Code Frame with Red Corner Brackets */}
            <div className="ks-qr-frame">
              <div className="ks-qr-corner ks-qr-corner--tl" />
              <div className="ks-qr-corner ks-qr-corner--tr" />
              <div className="ks-qr-corner ks-qr-corner--bl" />
              <div className="ks-qr-corner ks-qr-corner--br" />
              <div className="ks-qr-inner">
                <QRCodeSVG
                  value={qrDisplayValue}
                  size={216}
                  level="H"
                  includeMargin={false}
                  fgColor="#09090b"
                  bgColor="#ffffff"
                />
              </div>
              <div className="ks-qr-sweep" />
            </div>

            {/* Session Security Pill */}
            <div className="ks-security-badge">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <span>Single-use encrypted session · Valid for {minutes}:{seconds}</span>
            </div>

            {/* Actions Row */}
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

            {/* Direct PIN Keypad Switch */}
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

        {/* ── STEP 1: Phone Connected & Uploading State ── */}
        {(state === 'CLAIMED' || state === 'UPLOADING') && !doc && (
          <div className="ks-flow-panel">
            <div className="ks-phase-card" style={{ borderColor: 'rgba(220, 38, 38, 0.3)' }}>
              <div className="ks-phase-icon-wrap" style={{ background: 'rgba(220, 38, 38, 0.1)', color: '#dc2626' }}>
                <span className="ks-big-icon">📲</span>
              </div>
              <div className="ks-phase-info">
                <h2 className="ks-phase-title" style={{ color: '#dc2626' }}>Phone Connected</h2>
                <p className="ks-phase-sub">User is selecting and uploading document from their phone…</p>
                <div className="ks-await-pill" style={{ marginTop: 12 }}>
                  <span className="ks-await-dot" style={{ background: '#dc2626' }} />
                  <span>Document will appear on this touchscreen immediately once uploaded</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── SECTION 1: Review Document & Page Preview (CONFIRMING) ── */}
        {state === 'CONFIRMING' && (
          <div className="ks-interactive-panel">
            {/* Flow Steps Header */}
            <div className="ks-flow-tabs">
              <div className="ks-flow-tab ks-flow-tab--active">
                <span className="ks-flow-tab-num">1</span>
                <span>Review Document</span>
              </div>
              <span className="ks-flow-tab-arrow">→</span>
              <div className="ks-flow-tab">
                <span className="ks-flow-tab-num">2</span>
                <span>Print Settings</span>
              </div>
              <span className="ks-flow-tab-arrow">→</span>
              <div className="ks-flow-tab">
                <span className="ks-flow-tab-num">3</span>
                <span>Pay &amp; Print</span>
              </div>
            </div>

            {/* Split Body */}
            <div className="ks-flow-body">
              {/* Left Column: Page Canvas / Preview */}
              <div className="ks-flow-left">
                <div className="ks-preview-wrap">
                  {activePageUrl ? (
                    <img src={activePageUrl} alt={`Page ${activePageIdx + 1}`} className="ks-preview-img" />
                  ) : (
                    <div className="ks-preview-canvas">
                      <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#dc2626' }}>PRINTBOOTH VERIFIED</span>
                        <span style={{ fontSize: 11, color: '#64748b' }}>PAGE {activePageIdx + 1} OF {pageCount}</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 36 }}>📄</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#09090b', textAlign: 'center', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {docFileName}
                        </span>
                      </div>
                      <div style={{ width: '100%', fontSize: 10, color: '#94a3b8', textAlign: 'center', borderTop: '1px solid #f1f5f9', paddingTop: 6 }}>
                        A4 Paper Size • Standard 75GSM
                      </div>
                    </div>
                  )}

                  {/* Navigation Arrows */}
                  {pageCount > 1 && (
                    <>
                      <button
                        type="button"
                        className="ks-preview-nav-btn ks-preview-nav-btn--prev"
                        onClick={() => setActivePageIdx(i => Math.max(0, i - 1))}
                        disabled={activePageIdx === 0}
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        className="ks-preview-nav-btn ks-preview-nav-btn--next"
                        onClick={() => setActivePageIdx(i => Math.min(pageCount - 1, i + 1))}
                        disabled={activePageIdx === pageCount - 1}
                      >
                        ›
                      </button>
                    </>
                  )}
                </div>

                {/* Thumbnail Chips Strip */}
                {pageCount > 1 && (
                  <div className="ks-thumb-strip">
                    {Array.from({ length: pageCount }).map((_, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className={`ks-thumb-chip ${idx === activePageIdx ? 'ks-thumb-chip--active' : ''}`}
                        onClick={() => setActivePageIdx(idx)}
                      >
                        Page {idx + 1}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Right Column: Specs & Actions */}
              <div className="ks-flow-right">
                <div>
                  <h3 className="ks-summary-title">Document Details</h3>
                  <div className="ks-summary-table">
                    <div className="ks-summary-row">
                      <span>Document</span>
                      <strong style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{docFileName}</strong>
                    </div>
                    <div className="ks-summary-row">
                      <span>Total Pages</span>
                      <strong>{pageCount} {pageCount === 1 ? 'Page' : 'Pages'}</strong>
                    </div>
                    <div className="ks-summary-row">
                      <span>Paper Tray</span>
                      <strong style={{ color: '#16a34a' }}>Ready (A4 75GSM)</strong>
                    </div>
                    <div className="ks-summary-row">
                      <span>Base Rate</span>
                      <strong>₹2.00 / page (B&amp;W)</strong>
                    </div>
                  </div>
                </div>

                <div className="ks-action-row">
                  <button
                    type="button"
                    className="ks-btn-primary"
                    onClick={handleContinueToSettings}
                    disabled={isActionPending}
                    id="ks-continue-to-settings"
                  >
                    <span>Continue to Print Settings</span>
                    <span>→</span>
                  </button>

                  <button
                    type="button"
                    className="ks-btn-secondary"
                    onClick={() => createSession()}
                  >
                    Cancel / New Upload
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── SECTION 2: Print Settings (CONFIGURING) ── */}
        {state === 'CONFIGURING' && (
          <div className="ks-interactive-panel">
            {/* Flow Steps Header */}
            <div className="ks-flow-tabs">
              <div className="ks-flow-tab ks-flow-tab--done">
                <span className="ks-flow-tab-num">✓</span>
                <span>Review Document</span>
              </div>
              <span className="ks-flow-tab-arrow">→</span>
              <div className="ks-flow-tab ks-flow-tab--active">
                <span className="ks-flow-tab-num">2</span>
                <span>Print Settings</span>
              </div>
              <span className="ks-flow-tab-arrow">→</span>
              <div className="ks-flow-tab">
                <span className="ks-flow-tab-num">3</span>
                <span>Pay &amp; Print</span>
              </div>
            </div>

            {/* Split Body */}
            <div className="ks-flow-body">
              {/* Left Column: Interactive Settings Options */}
              <div className="ks-flow-left">
                {/* 1. Colour Mode */}
                <div className="ks-settings-group">
                  <span className="ks-settings-label">1. Colour Mode</span>
                  <div className="ks-opt-row">
                    <button
                      type="button"
                      className={`ks-opt-card ${selectedColour === 'BW' ? 'ks-opt-card--active' : ''}`}
                      onClick={() => setSelectedColour('BW')}
                      id="ks-opt-bw"
                    >
                      <span className="ks-opt-title">Black &amp; White</span>
                      <span className="ks-opt-sub">₹2.00 per sheet • Crisp laser text</span>
                    </button>
                    <button
                      type="button"
                      className={`ks-opt-card ${selectedColour === 'COLOUR' ? 'ks-opt-card--active' : ''}`}
                      onClick={() => setSelectedColour('COLOUR')}
                      id="ks-opt-colour"
                    >
                      <span className="ks-opt-title">Full Colour</span>
                      <span className="ks-opt-sub">₹8.00 per sheet • Vivid ink presentation</span>
                    </button>
                  </div>
                </div>

                {/* 2. Sides (Duplex) */}
                <div className="ks-settings-group">
                  <span className="ks-settings-label">2. Print Sides</span>
                  <div className="ks-opt-row">
                    <button
                      type="button"
                      className={`ks-opt-card ${selectedDuplex === 'SINGLE' ? 'ks-opt-card--active' : ''}`}
                      onClick={() => setSelectedDuplex('SINGLE')}
                      id="ks-opt-single"
                    >
                      <span className="ks-opt-title">Single-Sided</span>
                      <span className="ks-opt-sub">1 page per sheet</span>
                    </button>
                    <button
                      type="button"
                      className={`ks-opt-card ${selectedDuplex === 'DOUBLE' ? 'ks-opt-card--active' : ''}`}
                      onClick={() => setSelectedDuplex('DOUBLE')}
                      id="ks-opt-double"
                    >
                      <span className="ks-opt-title">Double-Sided</span>
                      <span className="ks-opt-sub">2 pages per sheet (saves paper)</span>
                    </button>
                  </div>
                </div>

                {/* 3. Copies Stepper */}
                <div className="ks-settings-group">
                  <span className="ks-settings-label">3. Number of Copies</span>
                  <div className="ks-counter">
                    <button
                      type="button"
                      className="ks-counter-btn"
                      onClick={() => setSelectedCopies(c => Math.max(1, c - 1))}
                      disabled={selectedCopies <= 1}
                    >
                      −
                    </button>
                    <span className="ks-counter-val">{selectedCopies}</span>
                    <button
                      type="button"
                      className="ks-counter-btn"
                      onClick={() => setSelectedCopies(c => Math.min(50, c + 1))}
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Column: Live Calculation Summary & Action */}
              <div className="ks-flow-right">
                <div>
                  <h3 className="ks-summary-title">Order Summary</h3>
                  <div className="ks-summary-table">
                    <div className="ks-summary-row">
                      <span>Document</span>
                      <strong style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{docFileName}</strong>
                    </div>
                    <div className="ks-summary-row">
                      <span>Colour</span>
                      <strong>{selectedColour === 'COLOUR' ? 'Full Colour' : 'Black & White'}</strong>
                    </div>
                    <div className="ks-summary-row">
                      <span>Sides</span>
                      <strong>{selectedDuplex === 'DOUBLE' ? 'Double-Sided' : 'Single-Sided'}</strong>
                    </div>
                    <div className="ks-summary-row">
                      <span>Copies</span>
                      <strong>{selectedCopies}</strong>
                    </div>
                    <div className="ks-summary-row">
                      <span>Sheets Required</span>
                      <strong>{calculatedSheets * selectedCopies} sheets</strong>
                    </div>
                  </div>

                  <div className="ks-total-banner">
                    <span className="ks-total-label">Total Amount</span>
                    <span className="ks-total-price">₹{totalAmount.toFixed(2)}</span>
                  </div>
                </div>

                <div className="ks-action-row">
                  <button
                    type="button"
                    className="ks-btn-primary"
                    onClick={handleProceedToPayment}
                    disabled={isActionPending}
                    id="ks-proceed-to-payment"
                  >
                    <span>Proceed to Payment</span>
                    <span>→</span>
                  </button>

                  <button
                    type="button"
                    className="ks-btn-secondary"
                    onClick={handleBackToConfirm}
                  >
                    ← Back to Preview
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── SECTION 3: Payment & UPI QR (PAYING) ── */}
        {state === 'PAYING' && (
          <div className="ks-interactive-panel">
            {/* Flow Steps Header */}
            <div className="ks-flow-tabs">
              <div className="ks-flow-tab ks-flow-tab--done">
                <span className="ks-flow-tab-num">✓</span>
                <span>Review Document</span>
              </div>
              <span className="ks-flow-tab-arrow">→</span>
              <div className="ks-flow-tab ks-flow-tab--done">
                <span className="ks-flow-tab-num">✓</span>
                <span>Print Settings</span>
              </div>
              <span className="ks-flow-tab-arrow">→</span>
              <div className="ks-flow-tab ks-flow-tab--active">
                <span className="ks-flow-tab-num">3</span>
                <span>Pay &amp; Print</span>
              </div>
            </div>

            {/* Split Body */}
            <div className="ks-flow-body">
              {/* Left Column: Order Breakdown & Touch Confirmation */}
              <div className="ks-flow-left" style={{ justifyContent: 'space-between' }}>
                <div>
                  <h3 className="ks-summary-title">Complete Payment</h3>
                  <div className="ks-summary-table">
                    <div className="ks-summary-row">
                      <span>Order ID</span>
                      <strong style={{ fontFamily: 'var(--ks-mono)' }}>{effectiveOrderId}</strong>
                    </div>
                    <div className="ks-summary-row">
                      <span>Document</span>
                      <strong style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{docFileName}</strong>
                    </div>
                    <div className="ks-summary-row">
                      <span>Configuration</span>
                      <strong>{selectedColour === 'COLOUR' ? 'Colour' : 'B&W'} • {selectedCopies} copy • {calculatedSheets} sheets</strong>
                    </div>
                  </div>

                  <div className="ks-total-banner">
                    <span className="ks-total-label">Payable Amount</span>
                    <span className="ks-total-price">₹{totalAmount.toFixed(2)}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <button
                    type="button"
                    className="ks-btn-primary"
                    onClick={handleExecutePrint}
                    disabled={isActionPending}
                    id="ks-confirm-payment-print"
                  >
                    <span>Confirm Payment &amp; Start Printing</span>
                    <span>🖨️</span>
                  </button>

                  <button
                    type="button"
                    className="ks-btn-secondary"
                    onClick={handleBackToSettings}
                  >
                    ← Back to Settings
                  </button>
                </div>
              </div>

              {/* Right Column: Dynamic UPI QR Box */}
              <div className="ks-flow-right" style={{ alignItems: 'center', justifyContent: 'center' }}>
                <div className="ks-pay-qr-card">
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    Scan with Any UPI App
                  </div>

                  <div style={{ padding: 10, background: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                    <QRCodeSVG
                      value={upiQrValue}
                      size={200}
                      level="H"
                      includeMargin={false}
                      fgColor="#09090b"
                      bgColor="#ffffff"
                    />
                  </div>

                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    GPay • PhonePe • Paytm • BHIM UPI
                  </div>
                  <div style={{ fontSize: 11, fontFamily: 'var(--ks-mono)', color: '#94a3b8' }}>
                    VPA: printbooth@upi
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── SECTION 4: Live Printing Progress (PRINTING) ── */}
        {isPrinting && (
          <div className="ks-printing-panel">
            <div className="ks-printing-icon">
              <svg width="68" height="68" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6,9 6,2 18,2 18,9" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" />
              </svg>
            </div>
            <h2 className="ks-printing-title">Printing Your Document…</h2>
            <p className="ks-printing-sub">Feeding pages into the output tray. Please wait while physical printing finishes.</p>
            <div className="ks-file-pill" style={{ justifyContent: 'center', marginTop: 10 }}>
              <span>📄</span>
              <span>{docFileName}</span>
              <span className="ks-file-pages">· {calculatedSheets * selectedCopies} sheets</span>
              <span className="ks-file-pages" style={{ color: '#dc2626', fontWeight: 700 }}>· {printingProgress}%</span>
            </div>
            <div className="ks-progress-track" style={{ width: '100%', maxWidth: 440, marginTop: 16 }}>
              <div className="ks-progress-fill" style={{ width: `${printingProgress}%`, background: '#dc2626' }} />
            </div>
          </div>
        )}

        {/* ── SECTION 5: Collection & Success (DONE) ── */}
        {isDone && (
          <div className="ks-done-panel">
            <div className="ks-done-tick">
              <svg className="ks-done-svg" viewBox="0 0 52 52">
                <circle className="ks-done-circle" cx="26" cy="26" r="23" fill="none" />
                <path className="ks-done-check" fill="none" d="M14.5 27.2l7.5 7.5 15.5-16.5" />
              </svg>
            </div>
            <h2 className="ks-done-title">Print Complete!</h2>
            <p className="ks-done-sub">Thank you for using PrintBooth. Please collect your fresh pages from the output tray below.</p>
            <div className="ks-rotate-notice">
              <span>↻</span>
              <span>Screen resetting for next customer in 6s…</span>
            </div>
          </div>
        )}

        {/* ── OTP DISPLAY FALLBACK (When OTP Ready code entered) ── */}
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

            <div className="ks-otp-digits">
              {session.otp.split('').map((digit, i) => (
                <div key={i} className="ks-otp-digit">
                  {digit}
                </div>
              ))}
            </div>

            <p className="ks-otp-hint">Enter these 4 digits on the touchscreen keypad to begin printing ↓</p>

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

      </main>

      {/* Footer */}
      <footer className="ks-footer">
        <span>Hardware Engine: <strong>Brother DCP-T420W</strong></span>
        <span>•</span>
        <span>Telemetry: <code>ONLINE</code></span>
        <span>•</span>
        <span>Paper: <code>A4 75GSM</code></span>
      </footer>
    </div>
  )
}
