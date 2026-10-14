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
import { QRCodeSVG } from 'qrcode.react'
import {
  useKioskSiteUrl,
  getKioskId,
  getKioskName,
  getKioskApiUrl,
  getKioskSiteUrl,
  getKioskQrUrl,
  getKioskVariant,
  setKioskVariant,
  loadKioskRuntimeConfig,
} from '../utils/siteConfig'
import {
  getKioskPricing,
  parsePageRange,
} from '../utils/printSettingsUtils'
import KioskAdBackground from '../components/KioskAdBackground'
import PrinterDispenseAnimation from '../components/PrinterDispenseAnimation'
import KioskInactivityBanner from '../components/KioskInactivityBanner'
import { usePrinterStatus } from '../hooks/usePrinterStatus'
import './KioskSessionScreen.css'

// ─── Types ──────────────────────────────────────────────────────────────────

export type SessionState =
  | 'QR_READY'
  | 'CLAIMED'
  | 'UPLOADING'
  | 'CONFIRMING'
  | 'CONFIGURING'
  | 'REVIEWING'
  | 'PAYING'
  | 'OTP_READY'
  | 'PRINTING'
  | 'DONE'
  | 'CANCELLED'
  | 'EXPIRED'
  | null

export interface DocumentPreviewPage {
  pageNumber: number
  url: string
  title?: string
}

export interface DocumentFileItem {
  id?: string
  fileName: string
  fileSize?: number
  fileType?: string
  pageCount?: number
  copies?: number
  colour?: string
  duplex?: string
  pages?: string
  pageRange?: string
  settings?: any
  previews?: DocumentPreviewPage[]
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
  files?: DocumentFileItem[]
}

export interface PrintSettingsData {
  colour: 'BW' | 'COLOUR'
  duplex: 'SINGLE' | 'DOUBLE'
  copies: number
  pageRange: string
  pages?: string
  paperSize: string
  pricePerPage: number
  totalAmount: number
  settingsMode?: 'GLOBAL' | 'PER_PAGE'
  nUpLayout?: 1 | 2 | 4
  duplexBinding?: 'LONG_EDGE' | 'SHORT_EDGE'
  printDpi?: '600' | '1200'
  paperWeight?: '75GSM' | '100GSM'
  pageCustomizations?: Record<number, {
    colour: 'BW' | 'COLOUR'
    skipped: boolean
    orientation?: 'PORTRAIT' | 'LANDSCAPE'
  }>
}

export interface LiveSession {
  sessionId: string
  token: string
  qrUrl: string
  state: SessionState
  phase?: string
  phaseStep?: number
  kioskVariant?: 'pro' | 'lite'
  otp?: string
  orderId?: string
  fileName?: string
  totalPages?: number
  copies?: number
  colourMode?: string
  amount?: number
  expiresAt: number
  createdAt: number
  claimedAt?: number
  completedAt?: number
  document?: DocumentData
  files?: DocumentFileItem[]
  settings?: PrintSettingsData
  progressData?: Record<string, any>
  upiQrValue?: string
  paymentUrl?: string
  upiIntentUrl?: string
  merchantUpiId?: string
  gateway?: string
  paymentError?: string
  qrAmount?: number
  lastPhoneActivityAt?: number
  phoneDisconnected?: boolean
  phoneDisconnectedAt?: number
  phoneGraceRemainingSec?: number
  isBackwardNav?: boolean
}

// ─── Phase Metadata ──────────────────────────────────────────────────────────

interface PhaseInfo {
  label: string
  sublabel: string
  step: number
  icon: string
  color: string
}

export const PHASES: Record<string, PhaseInfo> = {
  QR_READY: {
    label: 'Scan QR to Upload',
    sublabel: 'Use your phone camera to scan the code below',
    step: 0,
    icon: '⬡',
    color: '#dc2626',
  },
  CLAIMED: {
    label: 'Step 1: Phone Connected',
    sublabel: 'Smartphone connected to station • Choose files on phone',
    step: 1,
    icon: '📱',
    color: '#16a34a',
  },
  UPLOADING: {
    label: 'Step 1: Uploading Files',
    sublabel: 'Selecting & uploading documents on mobile…',
    step: 1,
    icon: '📲',
    color: '#16a34a',
  },
  CONFIRMING: {
    label: 'Step 2: Confirm Doc',
    sublabel: 'Customer is reviewing document on mobile…',
    step: 2,
    icon: '📄',
    color: '#dc2626',
  },
  CONFIGURING: {
    label: 'Step 3: Settings',
    sublabel: 'Customer is configuring options on mobile…',
    step: 3,
    icon: '⚙',
    color: '#dc2626',
  },
  REVIEWING: {
    label: 'Step 4: Review Order',
    sublabel: 'Customer is reviewing order on mobile…',
    step: 4,
    icon: '📋',
    color: '#dc2626',
  },
  PAYING: {
    label: 'Step 5: Payment',
    sublabel: 'Scan the UPI QR code below to complete your order',
    step: 5,
    icon: '₹',
    color: '#dc2626',
  },
  OTP_READY: {
    label: 'Step 6: Enter OTP',
    sublabel: 'Your 4-digit code is shown below ↓',
    step: 6,
    icon: '✓',
    color: '#16a34a',
  },
  PRINTING: {
    label: 'Step 7: Printing',
    sublabel: 'Feeding pages into output tray below',
    step: 7,
    icon: '🖨️',
    color: '#dc2626',
  },
  DONE: {
    label: 'Complete!',
    sublabel: 'Thank you — please collect your pages from the tray',
    step: 8,
    icon: '✓',
    color: '#16a34a',
  },
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function KioskSessionScreen() {
  const kioskId = getKioskId()
  const kioskName = getKioskName()
  const apiUrl = getKioskApiUrl()
  const { siteUrl } = useKioskSiteUrl(apiUrl, kioskId)
  const { isOffline: isPrinterOffline, printerStatus } = usePrinterStatus(kioskId, apiUrl)
  const isPrinterReady = !isPrinterOffline && (printerStatus === 'READY' || printerStatus === 'IDLE' || printerStatus === 'PRINTING')

  // Immediate non-null session: initialized with empty token and qrUrl so that
  // we NEVER display a stale or constant sessionless QR while creating the session
  const [session, setSession] = useState<LiveSession>(() => {
    const kid = getKioskId()
    return {
      sessionId: `init-${kid}`,
      token: '',
      qrUrl: '',
      kioskVariant: getKioskVariant(),
      state: 'QR_READY',
      phase: 'Scan QR to start uploading',
      phaseStep: 0,
      expiresAt: Date.now() + 300000,
      createdAt: Date.now(),
    }
  })

  const [_timeLeft, setTimeLeft] = useState(300)
  const [stateChanged, setStateChanged] = useState(false)
  const [isActionPending, setIsActionPending] = useState(false)
  const [activeStateOverride, setActiveStateOverride] = useState<SessionState | null>(null)
  const [urlParamsCleared, setUrlParamsCleared] = useState(false)

  // Hardware variant: PrintBooth Pro (Touch & Color) vs PrintBooth Lite (Zero-touch & Monochrome)
  const queryVariant = typeof window !== 'undefined'
    ? (new URLSearchParams(window.location.search).get('variant') || new URLSearchParams(window.location.search).get('kioskVariant') || new URLSearchParams(window.location.search).get('model'))
    : null
  const kioskVariant: 'pro' | 'lite' = (queryVariant ? (queryVariant.toLowerCase().includes('lite') ? 'lite' : 'pro') : null) || session?.kioskVariant || getKioskVariant()
  const isLite = kioskVariant === 'lite'
  const isPro = !isLite

  // Interactive UI Selection States on Touchscreen
  const [activePageIdx, setActivePageIdx] = useState(0)
  const [selectedColour, setSelectedColour] = useState<'BW' | 'COLOUR'>('BW')
  const [selectedDuplex, setSelectedDuplex] = useState<'SINGLE' | 'DOUBLE'>('SINGLE')
  const [selectedCopies, setSelectedCopies] = useState(1)
  const [selectedPageRange, setSelectedPageRange] = useState('ALL')
  const [touchModified, setTouchModified] = useState(false)
  const [_printingProgress, setPrintingProgress] = useState(0)

  // Viewport Responsive Sizing
  const [windowWidth, setWindowWidth] = useState(() => typeof window !== 'undefined' ? window.innerWidth : 1024)
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const responsiveMainQrSize = windowWidth <= 420 ? 190 : windowWidth <= 640 ? 220 : 260
  const responsiveUpiQrSize = windowWidth <= 420 ? 180 : windowWidth <= 640 ? 200 : 230

  // Enhanced & Per-Page Customization State
  const [settingsMode, setSettingsMode] = useState<'GLOBAL' | 'PER_PAGE'>('GLOBAL')
  const [nUpLayout, setNUpLayout] = useState<1 | 2 | 4>(1)
  const [duplexBinding, setDuplexBinding] = useState<'LONG_EDGE' | 'SHORT_EDGE'>('LONG_EDGE')
  const [failedPreviewUrls, setFailedPreviewUrls] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    setFailedPreviewUrls(new Set())
  }, [session?.sessionId, session?.document?.fileName])
  const [_printDpi, setPrintDpi] = useState<'600' | '1200'>('600')
  const [_paperWeight, setPaperWeight] = useState<'75GSM' | '100GSM'>('75GSM')
  void _timeLeft
  void _printingProgress
  void _printDpi
  void _paperWeight
  void duplexBinding
  void setDuplexBinding
  const [pageCustomizations, setPageCustomizations] = useState<Record<number, {
    colour: 'BW' | 'COLOUR'
    skipped: boolean
    orientation: 'PORTRAIT' | 'LANDSCAPE'
  }>>({})

  // 5-second countdown when user goes back or exits on phone
  const [phoneDisconnectCountdown, setPhoneDisconnectCountdown] = useState<number | null>(null)
  const disconnectCountdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 5-minute (300s) inactivity watchdog in each interactive section
  const [inactivitySecondsLeft, setInactivitySecondsLeft] = useState<number>(300)
  const lastSectionActivityTimeRef = useRef<number>(Date.now())
  const lastActiveSectionRef = useRef<string | null>(null)
  const lastTouchTimeRef = useRef<number>(0)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const rotateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)
  const sessionRef = useRef<LiveSession | null>(session)

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  // ── Session Creation & Upgrade ────────────────────────────────────────────

  const createSession = useCallback(async (force = true) => {
    if (!mountedRef.current) return

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
          body: JSON.stringify({ kioskId, webBaseUrl: siteUrl, force }),
        })
      } catch {
        if (typeof window !== 'undefined' && window.location.origin !== apiUrl) {
          try {
            res = await fetch('/api/kiosk-sessions/create', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ kioskId, webBaseUrl: siteUrl, force }),
            })
          } catch {}
        }
      }

      if (res && res.ok) {
        const data = await res.json()
        if (data.success && mountedRef.current) {
          const s = data.session || data
          const resolvedToken = (s.token || data.token || '').trim()
          const effectiveBaseUrl = (siteUrl || getKioskSiteUrl()).replace(/\/+$/, '')

          // Guarantee that the QR URL strictly embeds the unique cryptographic session token
          let resolvedQrUrl = ''
          if (s.qrUrl && s.qrUrl.includes('&session=') && !s.qrUrl.includes('session=init')) {
            resolvedQrUrl = s.qrUrl
          } else if (data.qrUrl && data.qrUrl.includes('&session=') && !data.qrUrl.includes('session=init')) {
            resolvedQrUrl = data.qrUrl
          } else if (resolvedToken && resolvedToken !== 'init') {
            resolvedQrUrl = `${effectiveBaseUrl}/print?id=${encodeURIComponent(kioskId)}&session=${encodeURIComponent(resolvedToken)}`
          } else {
            resolvedQrUrl = getKioskQrUrl(kioskId, effectiveBaseUrl, resolvedToken)
          }

          const resolvedVariant: 'pro' | 'lite' = s.kioskVariant || data.kioskVariant || getKioskVariant()
          setKioskVariant(resolvedVariant)

          setSession({
            sessionId: s.sessionId || data.sessionId,
            token: resolvedToken,
            qrUrl: resolvedQrUrl,
            kioskVariant: resolvedVariant,
            state: s.state || data.state || 'QR_READY',
            phase: s.phase || 'Scan QR to start uploading',
            phaseStep: s.phaseStep || 0,
            expiresAt: s.expiresAt || data.expiresAt || (Date.now() + 300000),
            createdAt: s.createdAt || Date.now(),
            document: s.document,
            settings: s.settings,
            fileName: s.fileName,
            totalPages: s.totalPages,
            copies: s.copies,
            colourMode: s.colourMode,
            amount: s.amount,
            orderId: s.orderId,
            otp: s.otp,
            progressData: s.progressData,
            upiQrValue: s.upiQrValue || data.upiQrValue,
            paymentUrl: s.paymentUrl || data.paymentUrl,
            upiIntentUrl: s.upiIntentUrl || data.upiIntentUrl,
            merchantUpiId: s.merchantUpiId || data.merchantUpiId,
            gateway: s.gateway || data.gateway,
            lastPhoneActivityAt: s.lastPhoneActivityAt || data.lastPhoneActivityAt || Date.now(),
          })
          const remaining = Math.max(10, Math.floor(((data.expiresAt || (Date.now() + 300000)) - Date.now()) / 1000))
          setTimeLeft(remaining)
          if (!s.document) {
            setActivePageIdx(0)
            setSelectedCopies(1)
            setSelectedColour('BW')
            setSelectedDuplex('SINGLE')
            setSelectedPageRange('ALL')
            setPrintingProgress(0)
          }
          return
        }
      }

      if (mountedRef.current) {
        retryTimerRef.current = setTimeout(() => createSession(true), 4000)
      }
    } catch (e) {
      console.warn('[KioskSession] Network issue creating session:', e)
      if (mountedRef.current) {
        retryTimerRef.current = setTimeout(() => createSession(true), 4000)
      }
    }
  }, [apiUrl, kioskId, siteUrl])

  const clearUrlStateParam = useCallback(() => {
    setUrlParamsCleared(true)
    if (typeof window !== 'undefined' && window.location.search) {
      const url = new URL(window.location.href)
      let changed = false
      for (const param of ['state', 'devState', 'devFiles', 'step']) {
        if (url.searchParams.has(param)) {
          url.searchParams.delete(param)
          changed = true
        }
      }
      if (changed) {
        window.history.replaceState({}, '', url.pathname + (url.search ? url.search : ''))
      }
    }
  }, [])

  const handleCancelAndNewUpload = useCallback(async () => {
    clearUrlStateParam()
    setActiveStateOverride(null)
    setPhoneDisconnectCountdown(null)
    setIsActionPending(true)
    setSession({
      sessionId: `init-${kioskId}`,
      token: '',
      qrUrl: '',
      kioskVariant: getKioskVariant(),
      state: 'QR_READY',
      phase: 'Waiting for user to scan QR',
      phaseStep: 0,
      createdAt: Date.now(),
      expiresAt: Date.now() + 300000,
      document: undefined,
      fileName: undefined,
      totalPages: undefined,
      settings: undefined,
      amount: undefined,
      orderId: undefined,
      otp: undefined,
      upiQrValue: undefined,
      paymentUrl: undefined,
      upiIntentUrl: undefined,
      merchantUpiId: undefined,
      gateway: undefined,
      phoneDisconnected: false,
      phoneGraceRemainingSec: 0,
    })
    setActivePageIdx(0)
    setSelectedCopies(1)
    setSelectedColour('BW')
    setSelectedDuplex('SINGLE')
    setSelectedPageRange('ALL')
    setPrintingProgress(0)

    try {
      const curId = sessionRef.current?.sessionId
      if (curId && !curId.startsWith('init-')) {
        try {
          await fetch(`${apiUrl}/api/kiosk-sessions/${encodeURIComponent(curId)}/cancel`, {
            method: 'POST',
          })
        } catch {
          if (typeof window !== 'undefined' && window.location.origin !== apiUrl) {
            try {
              await fetch(`/api/kiosk-sessions/${encodeURIComponent(curId)}/cancel`, {
                method: 'POST',
              })
            } catch {}
          }
        }
      }
      await createSession(true)
    } finally {
      setIsActionPending(false)
    }
  }, [kioskId, apiUrl, createSession, clearUrlStateParam])

  // ── 1-Minute Inactivity Auto-Reset Handler ───────────────────────────────
  const handleInactivityExpireAndReset = useCallback(async () => {
    clearUrlStateParam()
    setActiveStateOverride(null)
    setPhoneDisconnectCountdown(null)
    setIsActionPending(true)
    console.log('[KioskSession] ⏱️ 1-minute inactivity timeout reached in section. Expiring session and refreshing kiosk.')

    const curId = sessionRef.current?.sessionId
    if (curId && !curId.startsWith('init-')) {
      try {
        await fetch(`${apiUrl}/api/kiosk-sessions/${encodeURIComponent(curId)}/expire`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: '1_MIN_INACTIVITY_TIMEOUT' }),
        }).catch(() => {})
      } catch {}
    }

    setSession({
      sessionId: `init-${kioskId}`,
      token: '',
      qrUrl: '',
      kioskVariant: getKioskVariant(),
      state: 'QR_READY',
      phase: 'Waiting for user to scan QR',
      phaseStep: 0,
      createdAt: Date.now(),
      expiresAt: Date.now() + 300000,
      document: undefined,
      fileName: undefined,
      totalPages: undefined,
      settings: undefined,
      amount: undefined,
      orderId: undefined,
      otp: undefined,
      upiQrValue: undefined,
      paymentUrl: undefined,
      upiIntentUrl: undefined,
      merchantUpiId: undefined,
      gateway: undefined,
      phoneDisconnected: false,
      phoneGraceRemainingSec: 0,
    })
    setActivePageIdx(0)
    setSelectedCopies(1)
    setSelectedColour('BW')
    setSelectedDuplex('SINGLE')
    setSelectedPageRange('ALL')
    setPrintingProgress(0)

    try {
      await createSession(true)
    } finally {
      setIsActionPending(false)
    }
  }, [kioskId, apiUrl, createSession, clearUrlStateParam])

  // Touch/pointer on kiosk screen resets the inactivity timer and notifies backend
  const recordKioskActivity = useCallback(() => {
    lastTouchTimeRef.current = Date.now()
    lastSectionActivityTimeRef.current = Date.now()
    setInactivitySecondsLeft(300)
    const curId = sessionRef.current?.sessionId
    if (curId && !curId.startsWith('init-')) {
      fetch(`${apiUrl}/api/kiosk-sessions/${encodeURIComponent(curId)}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'kiosk' }),
      }).catch(() => {})
    }
  }, [apiUrl])

  useEffect(() => {
    window.addEventListener('pointerdown', recordKioskActivity, { passive: true })
    window.addEventListener('keydown', recordKioskActivity, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', recordKioskActivity)
      window.removeEventListener('keydown', recordKioskActivity)
    }
  }, [recordKioskActivity])

  // Reset section inactivity timer to 300s whenever state changes or updates arrive from phone
  useEffect(() => {
    if (!session) return
    const curState = session.state
    if (curState !== lastActiveSectionRef.current) {
      lastActiveSectionRef.current = curState
      lastSectionActivityTimeRef.current = Date.now()
      setInactivitySecondsLeft(300)
    } else {
      lastSectionActivityTimeRef.current = Date.now()
      setInactivitySecondsLeft(300)
    }
  }, [session?.state, session?.document, session?.settings, session?.lastPhoneActivityAt])

  // Watchdog: 5-minute countdown in each interactive section if no activity on user phone
  useEffect(() => {
    const currentSectionState = session?.state
    const isInteractiveSection =
      currentSectionState === 'CLAIMED' ||
      currentSectionState === 'UPLOADING' ||
      currentSectionState === 'CONFIRMING' ||
      currentSectionState === 'CONFIGURING' ||
      currentSectionState === 'REVIEWING' ||
      currentSectionState === 'PAYING'

    if (!isInteractiveSection) return

    const watchdog = setInterval(() => {
      const elapsed = Date.now() - lastSectionActivityTimeRef.current
      const remaining = Math.max(0, Math.ceil((300000 - elapsed) / 1000))
      setInactivitySecondsLeft(remaining)

      if (elapsed >= 300000) {
        clearInterval(watchdog)
        handleInactivityExpireAndReset()
      }
    }, 1000)

    return () => clearInterval(watchdog)
  }, [session?.state, handleInactivityExpireAndReset])

  const handlePrintComplete = useCallback(async () => {
    clearUrlStateParam()
    const curId = session?.sessionId
    if (curId && !curId.startsWith('init-')) {
      try {
        await fetch(`${apiUrl}/api/kiosk-sessions/${encodeURIComponent(curId)}/complete`, {
          method: 'POST',
        }).catch(() => {})
      } catch {}
    }
    setSession(prev =>
      prev
        ? {
            ...prev,
            state: 'DONE',
            phase: 'Print complete! Collect from tray.',
            phaseStep: 4,
          }
        : null
    )
    setActiveStateOverride('DONE')

    if (rotateTimerRef.current) clearTimeout(rotateTimerRef.current)
    rotateTimerRef.current = setTimeout(async () => {
      if (!mountedRef.current) return
      rotateTimerRef.current = null
      setActiveStateOverride(null)
      await handleCancelAndNewUpload()
    }, 2200)
  }, [session?.sessionId, apiUrl, clearUrlStateParam, handleCancelAndNewUpload])

  const handleExecutePrint = useCallback(async () => {
    if (!session?.sessionId) return
    setIsActionPending(true)
    try {
      await fetch(`${apiUrl}/api/kiosk-sessions/${encodeURIComponent(session.sessionId)}/execute-print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      setSession(prev => (prev ? { ...prev, state: 'PRINTING', phase: 'Printing document…' } : null))
    } finally {
      setIsActionPending(false)
    }
  }, [session?.sessionId, apiUrl])

  useEffect(() => {
    mountedRef.current = true
    loadKioskRuntimeConfig().catch(() => {})
    createSession(true)

    return () => {
      mountedRef.current = false
      if (pollRef.current) clearInterval(pollRef.current)
      if (rotateTimerRef.current) clearTimeout(rotateTimerRef.current)
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
      if (progressTimerRef.current) clearInterval(progressTimerRef.current)
      if (disconnectCountdownTimerRef.current) clearInterval(disconnectCountdownTimerRef.current)
    }
  }, [createSession])

  // ── High-Performance Non-Overlapping Polling Loop ────────────────────────
  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout> | null = null
    let inFlight = false

    const poll = async () => {
      if (!mountedRef.current || inFlight) return
      inFlight = true
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 2500)

        let res = await fetch(`${apiUrl}/api/kiosk-sessions/active/${encodeURIComponent(kioskId)}`, {
          signal: controller.signal,
        }).catch(() => null)
        clearTimeout(timeoutId)

        if (!res || !res.ok) {
          const fallbackCtrl = new AbortController()
          const fbTimeout = setTimeout(() => fallbackCtrl.abort(), 2500)
          res = await fetch(`/api/kiosk-sessions/active/${encodeURIComponent(kioskId)}`, {
            signal: fallbackCtrl.signal,
          }).catch(() => null)
          clearTimeout(fbTimeout)
        }
        if (!res || !res.ok) return

        const data = await res.json()
        if (!data.success || !data.session || !mountedRef.current) return

        const s = data.session as LiveSession
        const currentSession = sessionRef.current
        const effectiveToken = (s.token || currentSession?.token || '').trim()
        const effectiveBaseUrl = (siteUrl || getKioskSiteUrl()).replace(/\/+$/, '')

        let effectiveQrUrl = ''
        if (s.qrUrl && s.qrUrl.includes('&session=') && !s.qrUrl.includes('session=init')) {
          effectiveQrUrl = s.qrUrl
        } else if (effectiveToken && effectiveToken !== 'init') {
          effectiveQrUrl = `${effectiveBaseUrl}/print?id=${encodeURIComponent(kioskId)}&session=${encodeURIComponent(effectiveToken)}`
        }

        if (s.kioskVariant) {
          setKioskVariant(s.kioskVariant)
        }

        // Active document and state detection
        const hasActiveDoc = Boolean(s.document) || Boolean(s.files && s.files.length > 0) || Boolean(currentSession?.document) || Boolean(currentSession?.files && currentSession.files.length > 0)
        const isInteractiveSession = Boolean(
          (currentSession && ['CLAIMED', 'UPLOADING', 'CONFIRMING', 'CONFIGURING', 'REVIEWING', 'PAYING', 'PRINTING'].includes(currentSession.state)) ||
          ['CLAIMED', 'UPLOADING', 'CONFIRMING', 'CONFIGURING', 'REVIEWING', 'PAYING', 'PRINTING'].includes(s.state)
        )
        const isLocallyActive = (Date.now() - lastSectionActivityTimeRef.current) < 300000

        // Only transition to QR_READY if the session is genuinely idle and has no active customer documents
        const shouldResetToIdle = (s.state === 'QR_READY' && !isInteractiveSession && !hasActiveDoc) ||
          ((data.isInactiveTimeout || s.state === 'EXPIRED') && !hasActiveDoc && !isLocallyActive && !isInteractiveSession)

        if (shouldResetToIdle) {
          if (currentSession?.state !== 'QR_READY' || (effectiveToken && currentSession?.token !== effectiveToken)) {
            setSession({
              sessionId: s.sessionId || `init-${kioskId}`,
              token: effectiveToken,
              qrUrl: effectiveQrUrl || s.qrUrl || '',
              kioskVariant: s.kioskVariant || getKioskVariant(),
              state: 'QR_READY',
              phase: s.phase || 'Waiting for user to scan QR',
              phaseStep: 0,
              createdAt: s.createdAt || Date.now(),
              expiresAt: s.expiresAt || (Date.now() + 300000),
              document: undefined,
              fileName: undefined,
              totalPages: undefined,
              settings: undefined,
              amount: undefined,
              orderId: undefined,
              otp: undefined,
              upiQrValue: undefined,
              paymentUrl: undefined,
              upiIntentUrl: undefined,
              merchantUpiId: undefined,
              gateway: undefined,
              phoneDisconnected: false,
              phoneGraceRemainingSec: 0,
            })
            setPhoneDisconnectCountdown(null)
          }
          return
        }

        setSession(prev => {
          if (!prev) return { ...s, qrUrl: effectiveQrUrl, token: effectiveToken, kioskVariant: s.kioskVariant }
          
          // State regression guard: Never regress from PAYING or PRINTING to an earlier state like REVIEWING/CONFIGURING
          // unless isBackwardNav is explicitly signaled from user interaction.
          const isRegressingFromPayment = (prev.state === 'PAYING' || prev.state === 'OTP_READY') &&
            ['REVIEWING', 'CONFIGURING', 'CONFIRMING', 'UPLOADING'].includes(s.state) &&
            !s.isBackwardNav
          const isRegressingFromPrinting = prev.state === 'PRINTING' && s.state !== 'PRINTING' && s.state !== 'DONE'

          if (isRegressingFromPayment || isRegressingFromPrinting) {
            console.log(`[KioskSessionScreen] 🛡️ Ignored polling state regression: ${prev.state} -> ${s.state}`)
            return {
              ...prev,
              ...s,
              state: prev.state,
              phase: prev.phase,
              phaseStep: prev.phaseStep,
              upiQrValue: prev.upiQrValue || s.upiQrValue,
              upiIntentUrl: prev.upiIntentUrl || s.upiIntentUrl,
              paymentUrl: prev.paymentUrl || s.paymentUrl,
              qrAmount: prev.qrAmount || s.qrAmount,
              amount: prev.amount || s.amount,
              orderId: prev.orderId || s.orderId,
            }
          }

          const isStateChanged = prev.state !== s.state
          if (isStateChanged) {
            setStateChanged(true)
            setTimeout(() => setStateChanged(false), 250)
          }

          // Structural memoization: compare essential fields to avoid unnecessary re-renders
          const isDocEqual = prev.document?.fileName === s.document?.fileName &&
            (prev.document?.pages?.length || 0) === (s.document?.pages?.length || 0) &&
            (prev.files?.length || 0) === (s.files?.length || 0)
          const isSettingsEqual = prev.settings?.copies === s.settings?.copies &&
            prev.settings?.colour === s.settings?.colour &&
            prev.settings?.duplex === s.settings?.duplex &&
            prev.settings?.pageRange === s.settings?.pageRange &&
            prev.amount === s.amount
          const isDisconnectEqual = prev.phoneDisconnected === s.phoneDisconnected &&
            prev.phoneGraceRemainingSec === s.phoneGraceRemainingSec

          if (!isStateChanged && isDocEqual && isSettingsEqual && isDisconnectEqual &&
              prev.upiQrValue === s.upiQrValue && prev.orderId === s.orderId && prev.phase === s.phase) {
            return prev
          }

          return {
            ...prev,
            ...s,
            // Keep existing document if incoming poll doesn't include it
            document: s.document || prev.document,
            files: (s.files && s.files.length > 0) ? s.files : prev.files,
            lastPhoneActivityAt: s.lastPhoneActivityAt || prev.lastPhoneActivityAt,
            phoneDisconnected: s.phoneDisconnected !== undefined ? s.phoneDisconnected : prev.phoneDisconnected,
            phoneGraceRemainingSec: s.phoneGraceRemainingSec !== undefined ? s.phoneGraceRemainingSec : prev.phoneGraceRemainingSec,
            kioskVariant: s.kioskVariant || prev.kioskVariant,
            qrUrl: effectiveQrUrl || prev.qrUrl,
            token: effectiveToken || prev.token,
          }
        })

        // Auto-rotate on completion after 6 seconds
        if (s.state === 'DONE' && !rotateTimerRef.current) {
          rotateTimerRef.current = setTimeout(() => {
            if (!mountedRef.current) return
            rotateTimerRef.current = null
            createSession(true)
          }, 6000)
        }

        // Phone Disconnect handling: only count down if session has no document and phone truly left
        const isDisconnected = Boolean(s.phoneDisconnected || data.phoneDisconnected) && !hasActiveDoc
        const isPrePrint = s.state !== 'PRINTING' && s.state !== 'DONE' && s.state !== 'CANCELLED'

        if (isPrePrint && isDisconnected) {
          const remaining = Math.max(1, s.phoneGraceRemainingSec || data.phoneGraceRemainingSec || 15)
          setPhoneDisconnectCountdown(prev => (prev === null ? remaining : Math.min(prev, remaining)))
        } else if (!isDisconnected || hasActiveDoc || !data.phoneDisconnected) {
          setPhoneDisconnectCountdown(null)
        }

        // Inactivity Countdown: maintain a robust local 5-minute countdown from real phone/touch interaction
        if (s.lastPhoneActivityAt && s.lastPhoneActivityAt > lastSectionActivityTimeRef.current) {
          lastSectionActivityTimeRef.current = s.lastPhoneActivityAt
        }
        const localRemaining = Math.max(0, Math.ceil((300000 - (Date.now() - lastSectionActivityTimeRef.current)) / 1000))
        setInactivitySecondsLeft(localRemaining)

        // Cancellation guard: strictly ignore premature cancellations if customer has active document or interactive flow
        if (s.state === 'CANCELLED' && !hasActiveDoc && !isInteractiveSession) {
          setPhoneDisconnectCountdown(null)
          handleCancelAndNewUpload()
        } else if ((data.isPhoneInactive || data.isPhoneDisconnectedExpired || data.isInactiveTimeout) && !hasActiveDoc && !isInteractiveSession && !isLocallyActive) {
          setPhoneDisconnectCountdown(null)
          handleCancelAndNewUpload()
        }
      } catch {} finally {
        inFlight = false
        if (mountedRef.current) {
          timerId = setTimeout(poll, 400)
        }
      }
    }

    poll()
    return () => {
      if (timerId) clearTimeout(timerId)
    }
  }, [apiUrl, kioskId, siteUrl, createSession, handleCancelAndNewUpload])

  // ── Phone Disconnect 5-Second Countdown Ticker ───────────────────────────
  useEffect(() => {
    if (phoneDisconnectCountdown === null) {
      if (disconnectCountdownTimerRef.current) {
        clearInterval(disconnectCountdownTimerRef.current)
        disconnectCountdownTimerRef.current = null
      }
      return
    }

    if (phoneDisconnectCountdown <= 0) {
      console.log('[KioskSessionScreen] ⏱️ Phone disconnect 5s countdown elapsed. Resetting kiosk session.')
      setPhoneDisconnectCountdown(null)
      handleCancelAndNewUpload()
      return
    }

    if (!disconnectCountdownTimerRef.current) {
      disconnectCountdownTimerRef.current = setInterval(() => {
        setPhoneDisconnectCountdown(prev => {
          if (prev === null) return null
          return Math.max(0, prev - 1)
        })
      }, 1000)
    }

    return () => {
      if (disconnectCountdownTimerRef.current) {
        clearInterval(disconnectCountdownTimerRef.current)
        disconnectCountdownTimerRef.current = null
      }
    }
  }, [phoneDisconnectCountdown, handleCancelAndNewUpload])

  // ── Sync Settings from Session ───────────────────────────────────────────
  // Guards against UI jitter: if the user recently tapped or modified settings on the touchscreen
  // (within 2.5s), don't overwrite their selection with in-flight polled server state.
  useEffect(() => {
    if (Date.now() - lastTouchTimeRef.current < 2500) return
    if (session?.settings || session?.colourMode || (session as any)?.colour || (session?.files && session.files.length > 0)) {
      const rawColour = (
        session?.settings?.colour ||
        (session?.settings as any)?.colourMode ||
        (session?.settings as any)?.color ||
        (session?.settings as any)?.colorMode ||
        session?.colourMode ||
        (session as any)?.colour ||
        (session?.files && (session.files[0]?.settings?.colour || (session.files[0] as any)?.colour || (session.files[0] as any)?.colourMode))
      )
      if (rawColour) {
        const isCol = String(rawColour).toUpperCase().includes('COL')
        setSelectedColour(isLite ? 'BW' : (isCol ? 'COLOUR' : 'BW'))
      }

      const rawDuplex = (
        session?.settings?.duplex ||
        (session?.settings as any)?.duplexMode ||
        (session as any)?.duplex ||
        (session?.files && (session.files[0]?.settings?.duplex || session.files[0]?.duplex))
      )
      if (rawDuplex) {
        const isDub = String(rawDuplex).toUpperCase().includes('DOUB') || String(rawDuplex).toUpperCase().includes('2') || String(rawDuplex).toUpperCase().includes('TWO')
        setSelectedDuplex(isDub ? 'DOUBLE' : 'SINGLE')
      }

      const rawCopies = session?.settings?.copies || (session as any)?.copies || (session?.files && (session.files[0]?.settings?.copies || session.files[0]?.copies))
      if (rawCopies) {
        setSelectedCopies(Math.max(1, Number(rawCopies)))
      }

      const incomingPages = session?.settings?.pageRange || session?.settings?.pages || (session?.files && (session.files[0]?.settings?.pages || session.files[0]?.settings?.pageRange))
      if (incomingPages) setSelectedPageRange(incomingPages)

      if (session?.settings?.settingsMode) setSettingsMode(session.settings.settingsMode as any)
      if (session?.settings?.nUpLayout) setNUpLayout(session.settings.nUpLayout as any)
      if (session?.settings?.duplexBinding) setDuplexBinding(session.settings.duplexBinding as any)
      if (session?.settings?.printDpi) setPrintDpi(session.settings.printDpi as any)
      if (session?.settings?.paperWeight) setPaperWeight(session.settings.paperWeight as any)
      if (session?.settings?.pageCustomizations) setPageCustomizations(session.settings.pageCustomizations as any)
    }
    const rootPages = (session as any)?.pageRange || (session as any)?.pages
    if (rootPages) setSelectedPageRange(rootPages)
  }, [session?.settings, session?.colourMode, (session as any)?.colour, session?.files, (session as any)?.pageRange, (session as any)?.pages, isLite])

  // Support dev-mode ?devPages= URL query parameter
  useEffect(() => {
    if (typeof window !== 'undefined' && !urlParamsCleared) {
      const devPagesParam = new URLSearchParams(window.location.search).get('devPages')
      if (devPagesParam) {
        setSelectedPageRange(devPagesParam)
      }
    }
  }, [urlParamsCleared])

  // Strictly enforce B&W monochrome on Lite kiosks
  useEffect(() => {
    if (isLite && selectedColour !== 'BW') {
      setSelectedColour('BW')
    }
  }, [isLite, selectedColour])

  // ── Dynamic Pricing Calculation with Per-Page & Eco Savings ───────────────

  const rawDocPageCount = session?.document?.pageCount || session?.totalPages || (session?.document?.pages?.length) || 1

  const maxPageFromQuery = useMemo(() => {
    if (typeof window !== 'undefined') {
      const dev = new URLSearchParams(window.location.search).get('devPages') || new URLSearchParams(window.location.search).get('pages')
      if (dev) {
        const nums = dev.split(/[,-]/).map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
        if (nums.length > 0) return Math.max(...nums)
      }
    }
    return 1
  }, [])

  const devTotalParam = typeof window !== 'undefined' ? Number(new URLSearchParams(window.location.search).get('devTotalPages')) : 0
  const pageCount = Math.max(rawDocPageCount, devTotalParam || 0, maxPageFromQuery)

  const effectivePageRange = useMemo(() => {
    if (typeof window !== 'undefined') {
      const devPagesParam = new URLSearchParams(window.location.search).get('devPages') || new URLSearchParams(window.location.search).get('pages')
      if (devPagesParam) return devPagesParam
    }
    if (selectedPageRange && selectedPageRange !== 'ALL') return selectedPageRange
    if (session?.settings?.pageRange && session.settings.pageRange !== 'ALL') return session.settings.pageRange
    if (session?.settings?.pages && session.settings.pages !== 'ALL') return session.settings.pages
    if ((session as any)?.pageRange && (session as any).pageRange !== 'ALL') return (session as any).pageRange
    if ((session as any)?.pages && (session as any).pages !== 'ALL') return (session as any).pages
    return 'ALL'
  }, [selectedPageRange, session?.settings?.pageRange, session?.settings?.pages, (session as any)?.pageRange, (session as any)?.pages])

  const isCustomPages = effectivePageRange.trim().toUpperCase() !== 'ALL' && effectivePageRange.trim().length > 0
  const selectedPageNumbers = useMemo(() => {
    return parsePageRange(effectivePageRange, pageCount)
  }, [effectivePageRange, pageCount])

  const pageDetails = useMemo(() => {
    const pricing = getKioskPricing()
    let bwCount = 0
    let colourCount = 0
    let skippedCount = 0

    if (settingsMode === 'PER_PAGE') {
      for (let i = 0; i < pageCount; i++) {
        const custom = pageCustomizations[i]
        const isSkipped = Boolean(custom?.skipped)
        if (isSkipped) {
          skippedCount++
          continue
        }
        const pageColour = custom?.colour || selectedColour
        if (pageColour === 'COLOUR') {
          colourCount++
        } else {
          bwCount++
        }
      }
    } else {
      // GLOBAL uniform mode with selected page range
      const activePages = parsePageRange(effectivePageRange, pageCount)
      skippedCount = Math.max(0, pageCount - activePages.length)
      if (selectedColour === 'COLOUR') {
        colourCount = activePages.length
      } else {
        bwCount = activePages.length
      }
    }

    const includedPages = bwCount + colourCount
    const pagesPerSheet = nUpLayout * (selectedDuplex === 'DOUBLE' ? 2 : 1)
    const sheetsPerCopy = Math.max(1, Math.ceil(includedPages / pagesPerSheet))
    const totalSheets = sheetsPerCopy * selectedCopies

    // Rates dynamically derived from live station pricing matching customer mobile app
    const isDouble = selectedDuplex === 'DOUBLE'
    let baseCost = 0
    if (selectedColour === 'COLOUR') {
      const sheets = isDouble ? Math.max(1, Math.ceil(includedPages / 2)) : includedPages
      const rate = isDouble ? pricing.colorDouble : pricing.colorSingle
      baseCost = sheets * rate
    } else {
      const sheets = isDouble ? Math.max(1, Math.ceil(includedPages / 2)) : includedPages
      const rate = isDouble ? pricing.bwDouble : pricing.bwSingle
      baseCost = sheets * rate
    }

    const calculatedTotal = Math.max(1, Math.round(baseCost * selectedCopies * 100) / 100)

    // Sheets saved vs standard simplex 1-Up
    const standardSheets = includedPages * selectedCopies
    const savedSheets = Math.max(0, standardSheets - totalSheets)
    const savedPercentage = standardSheets > 0 ? Math.round((savedSheets / standardSheets) * 100) : 0

    return {
      bwCount,
      colourCount,
      skippedCount,
      includedPages,
      sheetsPerCopy,
      totalSheets,
      calculatedTotal,
      savedSheets,
      savedPercentage,
      bwRate: isDouble ? pricing.bwDouble : pricing.bwSingle,
      colourRate: isDouble ? pricing.colorDouble : pricing.colorSingle,
      pricing,
    }
  }, [pageCount, pageCustomizations, settingsMode, selectedColour, selectedDuplex, nUpLayout, selectedCopies, effectivePageRange])

  // Reset touch override whenever phone updates the session amount
  useEffect(() => {
    if (session?.amount || session?.settings?.totalAmount) {
      setTouchModified(false)
    }
  }, [session?.amount, session?.settings?.totalAmount])

  // Priority: Always honor the customer's phone order amount down to the exact paise unless actively changed on kiosk screen
  const sessionSettingsAmount = (session?.settings as any)?.amount
  const sessionReportedAmount = (typeof session?.amount === 'number' && session.amount > 0)
    ? session.amount
    : (typeof session?.settings?.totalAmount === 'number' && session.settings.totalAmount > 0)
      ? session.settings.totalAmount
      : (typeof sessionSettingsAmount === 'number' && sessionSettingsAmount > 0)
        ? sessionSettingsAmount
        : null

  const totalAmount = (!touchModified && sessionReportedAmount !== null)
    ? sessionReportedAmount
    : pageDetails.calculatedTotal
  const calculatedSheets = pageDetails.sheetsPerCopy

  // ── Progress Sync & Pro Touchscreen Handlers ────────────────────────────

  const syncProgress = useCallback(async (updates: {
    state?: SessionState
    phase?: string
    phaseStep?: number
    settings?: any
    copies?: number
    colourMode?: string
    amount?: number
  }) => {
    if (!session?.sessionId || session.sessionId.startsWith('init-')) return
    try {
      await fetch(`${apiUrl}/api/kiosk-sessions/${encodeURIComponent(session.sessionId)}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
    } catch (err) {
      console.warn('[KioskSession] Failed to sync progress:', err)
    }
  }, [session?.sessionId, apiUrl])

  const handleProColourChange = useCallback((mode: 'BW' | 'COLOUR') => {
    if (isLite) return
    lastTouchTimeRef.current = Date.now()
    setTouchModified(true)
    setSelectedColour(mode)
    syncProgress({
      colourMode: mode,
      settings: {
        ...session?.settings,
        colour: mode,
        duplex: selectedDuplex,
        copies: selectedCopies,
        totalAmount: pageDetails.calculatedTotal,
      },
    })
  }, [isLite, selectedDuplex, selectedCopies, pageDetails.calculatedTotal, session?.settings, syncProgress])

  const handleProDuplexChange = useCallback((duplex: 'SINGLE' | 'DOUBLE') => {
    lastTouchTimeRef.current = Date.now()
    setTouchModified(true)
    setSelectedDuplex(duplex)
    syncProgress({
      settings: {
        ...session?.settings,
        colour: selectedColour,
        duplex,
        copies: selectedCopies,
        totalAmount: pageDetails.calculatedTotal,
      },
    })
  }, [selectedColour, selectedCopies, pageDetails.calculatedTotal, session?.settings, syncProgress])

  const handleProCopiesChange = useCallback((delta: number) => {
    lastTouchTimeRef.current = Date.now()
    setTouchModified(true)
    const next = Math.max(1, Math.min(50, selectedCopies + delta))
    setSelectedCopies(next)
    syncProgress({
      copies: next,
      settings: {
        ...session?.settings,
        colour: selectedColour,
        duplex: selectedDuplex,
        copies: next,
        pageRange: effectivePageRange,
        pages: effectivePageRange,
        totalAmount: pageDetails.calculatedTotal,
      },
    })
  }, [selectedCopies, selectedColour, selectedDuplex, effectivePageRange, pageDetails.calculatedTotal, session?.settings, syncProgress])

  const handleProPageRangeChange = useCallback((range: string) => {
    lastTouchTimeRef.current = Date.now()
    setTouchModified(true)
    setSelectedPageRange(range)
    syncProgress({
      settings: {
        ...session?.settings,
        colour: selectedColour,
        duplex: selectedDuplex,
        copies: selectedCopies,
        pageRange: range,
        pages: range,
        totalAmount: pageDetails.calculatedTotal,
      },
    })
  }, [selectedColour, selectedDuplex, selectedCopies, pageDetails.calculatedTotal, session?.settings, syncProgress])

  const handleProConfirmAndNext = useCallback(() => {
    setActiveStateOverride(null)
    setSession(prev => prev ? { ...prev, state: 'CONFIGURING' } : null)
    syncProgress({
      state: 'CONFIGURING',
      phase: 'Print Settings on Touchscreen',
      phaseStep: 3,
    })
  }, [syncProgress])

  const handleProProceedToReview = useCallback(() => {
    setActiveStateOverride(null)
    setSession(prev => prev ? { ...prev, state: 'REVIEWING' } : null)
    syncProgress({
      state: 'REVIEWING',
      phase: 'Reviewing Order on Touchscreen',
      phaseStep: 3,
      amount: totalAmount,
      settings: {
        ...session?.settings,
        colour: selectedColour,
        duplex: selectedDuplex,
        copies: selectedCopies,
        pageRange: effectivePageRange,
        pages: effectivePageRange,
        totalAmount,
      },
    })
  }, [totalAmount, selectedColour, selectedDuplex, selectedCopies, effectivePageRange, session?.settings, syncProgress])

  const handleProProceedToPayment = useCallback(() => {
    setActiveStateOverride(null)
    setSession(prev => prev ? { ...prev, state: 'PAYING' } : null)
    syncProgress({
      state: 'PAYING',
      phase: `Scan UPI QR to Pay ₹${totalAmount.toFixed(2)}`,
      phaseStep: 4,
      amount: totalAmount,
    })
  }, [totalAmount, syncProgress])

  const handleProBackToReview = useCallback(() => {
    setActiveStateOverride(null)
    setSession(prev => prev ? { ...prev, state: 'REVIEWING', upiQrValue: '', upiIntentUrl: '', paymentUrl: '', qrAmount: undefined } : null)
    syncProgress({
      state: 'REVIEWING',
      phase: 'Reviewing Order on Touchscreen',
      phaseStep: 4,
    })
  }, [syncProgress])

  const handleProBackToSettings = useCallback(() => {
    setActiveStateOverride(null)
    setSession(prev => prev ? { ...prev, state: 'CONFIGURING', upiQrValue: '', upiIntentUrl: '', paymentUrl: '', qrAmount: undefined } : null)
    syncProgress({
      state: 'CONFIGURING',
      phase: 'Configuring Print Settings',
      phaseStep: 3,
    })
  }, [syncProgress])

  const handleProBackToDoc = useCallback(() => {
    setActiveStateOverride(null)
    setSession(prev => prev ? { ...prev, state: 'CONFIRMING', upiQrValue: '', upiIntentUrl: '', paymentUrl: '', qrAmount: undefined } : null)
    syncProgress({
      state: 'CONFIRMING',
      phase: 'Confirming Document on Kiosk',
      phaseStep: 2,
    })
  }, [syncProgress])

  // ── Derived State ────────────────────────────────────────────────────────

  const searchParamState = typeof window !== 'undefined' && !urlParamsCleared
    ? (new URLSearchParams(window.location.search).get('devState') || new URLSearchParams(window.location.search).get('state')) as SessionState | null
    : null
  const rawState = activeStateOverride || searchParamState || session?.state || 'QR_READY'
  // Accurately mirror the mobile user's exact flow step without premature jumping
  const state: SessionState = rawState

  const handleUniversalBack = useCallback(() => {
    if (state === 'PAYING') {
      handleProBackToReview()
    } else if (state === 'REVIEWING') {
      handleProBackToSettings()
    } else if (state === 'CONFIGURING') {
      handleProBackToDoc()
    } else if (state === 'CONFIRMING' || state === 'CLAIMED' || state === 'UPLOADING') {
      handleCancelAndNewUpload()
    } else if (state === 'OTP_READY') {
      handleProBackToSettings()
    }
  }, [state, handleProBackToReview, handleProBackToSettings, handleProBackToDoc, handleCancelAndNewUpload])

  const isWaiting = state === 'QR_READY'
  const isPrinting = state === 'PRINTING'
  const isDone = state === 'DONE'

  // User is in "connected phone or above step" (Phone Connected, Review Document, Print Settings, Payment)
  const isConnectedOrAbove = !isWaiting && !isPrinting && !isDone


  const qrDisplayValue = useMemo(() => {
    const base = 'https://printbooth.co.in'
    // 1. Explicit unique session QR URL containing cryptographic session token
    if (session?.qrUrl && session.qrUrl.includes('&session=') && !session.qrUrl.includes('session=init')) {
      try {
        const u = new URL(session.qrUrl)
        return `${base}${u.pathname}${u.search}`
      } catch {
        return session.qrUrl.replace(/^https?:\/\/[^/]+/, base)
      }
    }
    // 2. Synthesize using active cryptographic session token
    if (session?.token && session.token !== 'init') {
      return `${base}/print?id=${encodeURIComponent(kioskId)}&session=${encodeURIComponent(session.token)}`
    }
    // 3. While initializing, return empty string so loading state renders instead of a constant sessionless QR
    return ''
  }, [session?.qrUrl, session?.token, kioskId])


  // Current document and previews
  const doc = session?.document
  const docFileName = doc?.fileName || session?.fileName || 'Document.pdf'
  const docFiles: DocumentFileItem[] = useMemo(() => {
    if (doc?.files && doc.files.length > 0) return doc.files
    if (session?.files && session.files.length > 0) return session.files
    if (typeof window !== 'undefined' && !urlParamsCleared && new URLSearchParams(window.location.search).get('devFiles')) {
      const count = Number(new URLSearchParams(window.location.search).get('devFiles')) || 2
      return Array.from({ length: count }).map((_, i) => ({
        id: `dev-file-${i + 1}`,
        fileName: i === 0 ? 'Project_Report_Final.pdf' : i === 1 ? 'Presentation_Deck.pdf' : `Annexure_${i + 1}.pdf`,
        fileSize: 1024 * 1024 * (i + 1),
        fileType: 'pdf',
        pageCount: (i + 1) * 2,
      }))
    }
    return []
  }, [doc?.files, session?.files, urlParamsCleared])
  // Collect all available preview pages from document or sub-files
  const docPages = useMemo(() => {
    const resolveUrl = (u?: string) => {
      if (!u || !u.trim()) return ''
      return u.startsWith('/api') ? `${apiUrl}${u}` : u
    }

    // 1. Check doc.pages with valid URLs
    const validDocPages = (doc?.pages || [])
      .filter(p => p && typeof p.url === 'string' && p.url.trim().length > 0)
      .map(p => ({
        ...p,
        url: resolveUrl(p.url),
      }))

    if (validDocPages.length > 0) {
      return validDocPages
    }

    // 2. Fallback: check files array previews
    if (docFiles && docFiles.length > 0) {
      const collected: Array<{ pageNumber: number; url: string; title?: string }> = []
      for (const f of docFiles) {
        if (f.previews && f.previews.length > 0) {
          for (const p of f.previews) {
            if (p && typeof p.url === 'string' && p.url.trim().length > 0) {
              collected.push({
                ...p,
                url: resolveUrl(p.url),
              })
            }
          }
        }
      }
      if (collected.length > 0) return collected
    }

    // 3. Fallback: if document has fileUrl or is an image file
    const isImage = /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(docFileName) ||
      Boolean(doc?.fileUrl && /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(doc.fileUrl))

    if (isImage) {
      const directUrl = doc?.fileUrl
        ? resolveUrl(doc.fileUrl)
        : (session?.sessionId && !session.sessionId.startsWith('init-') ? `${apiUrl}/api/kiosk-sessions/${session.sessionId}/file` : '')
      if (directUrl) {
        return [{ pageNumber: 1, url: directUrl, title: docFileName }]
      }
    }

    // 4. If doc.pages exists but URLs were empty, preserve structure for page labels
    if (doc?.pages && doc.pages.length > 0) {
      return doc.pages.map((p, idx) => ({
        pageNumber: p.pageNumber || idx + 1,
        url: resolveUrl(p.url),
        title: p.title || `Page ${idx + 1}`,
      }))
    }

    return []
  }, [doc?.pages, docFiles, doc?.fileUrl, docFileName, apiUrl, session?.sessionId])

  // ── Single-File Custom Pages Preview Filtering ───────────────────────────
  const filteredDocPages = useMemo(() => {
    if (docFiles.length > 1) return []

    if (!isCustomPages) {
      if (docPages.length > 0) return docPages
      return Array.from({ length: pageCount }).map((_, i) => ({
        pageNumber: i + 1,
        url: '',
        title: `Page ${i + 1}`,
      }))
    }

    // Custom pages active: strictly only include pages selected by user
    const filtered: Array<{ pageNumber: number; url: string; title?: string }> = []
    for (const pNum of selectedPageNumbers) {
      const match = docPages.find(p => p.pageNumber === pNum)
      if (match) {
        filtered.push(match)
      } else {
        filtered.push({
          pageNumber: pNum,
          url: '',
          title: `Page ${pNum}`,
        })
      }
    }
    return filtered
  }, [docFiles.length, isCustomPages, docPages, selectedPageNumbers, pageCount])

  // ── Multi-File Representation with Per-File Previews & Custom Pages ─────────
  const multiFileItems = useMemo(() => {
    if (docFiles.length <= 1) return []

    const resolveUrl = (u?: string) => {
      if (!u || !u.trim()) return ''
      return u.startsWith('/api') ? `${apiUrl}${u}` : u
    }

    return docFiles.map((f, fileIdx) => {
      const rawPages = Math.max(1, f.pageCount || 1)
      const fileRange = f.pageRange || f.pages || f.settings?.pageRange || f.settings?.pages || (isCustomPages ? effectivePageRange : 'ALL')
      const activeNums = parsePageRange(fileRange, rawPages)
      const isFileCustom = fileRange.trim().toUpperCase() !== 'ALL'

      const filePages = activeNums.map(pageNum => {
        const matched = f.previews?.find(p => p.pageNumber === pageNum)
        const url = matched?.url ? resolveUrl(matched.url) : ''
        return {
          pageNumber: pageNum,
          url,
          title: `${f.fileName} - Page ${pageNum}`,
        }
      })

      return {
        file: f,
        index: fileIdx,
        fileName: f.fileName,
        pageCount: rawPages,
        effectiveRange: fileRange,
        isCustom: isFileCustom,
        activePageNumbers: activeNums,
        pages: filePages,
      }
    })
  }, [docFiles, isCustomPages, effectivePageRange, apiUrl])

  // ── Interleaved Animation Sequence ─────────────────────────────────────────
  // Spec: "1st file 1st page then 2nd file first page and so on and returns back to 1st file 2nd page and so on"
  const interleavedSequence = useMemo(() => {
    if (multiFileItems.length <= 1) return []

    const maxPages = Math.max(...multiFileItems.map(item => item.activePageNumbers.length), 1)
    const steps: Array<{
      fileIndex: number
      fileName: string
      pageNumber: number
      pageIndexWithinFile: number
      totalPagesInFile: number
      previewUrl: string
    }> = []

    for (let s = 0; s < maxPages; s++) {
      for (let fIdx = 0; fIdx < multiFileItems.length; fIdx++) {
        const item = multiFileItems[fIdx]
        if (s < item.activePageNumbers.length) {
          const pageNum = item.activePageNumbers[s]
          const pageObj = item.pages[s]
          steps.push({
            fileIndex: fIdx,
            fileName: item.fileName,
            pageNumber: pageNum,
            pageIndexWithinFile: s,
            totalPagesInFile: item.activePageNumbers.length,
            previewUrl: pageObj?.url || '',
          })
        }
      }
    }

    return steps
  }, [multiFileItems])

  const [interleavedStepIdx, setInterleavedStepIdx] = useState(0)
  const [fileCurrentPage, setFileCurrentPage] = useState<Record<number, number>>({})

  // Multi-File Auto-Animation Timer (runs every 2800ms)
  useEffect(() => {
    if (multiFileItems.length <= 1 || interleavedSequence.length <= 1) {
      setInterleavedStepIdx(0)
      return
    }

    const timer = setInterval(() => {
      setInterleavedStepIdx(prev => (prev + 1) % interleavedSequence.length)
    }, 2800)

    return () => clearInterval(timer)
  }, [multiFileItems.length, interleavedSequence.length])

  const currentInterleavedStep = interleavedSequence[interleavedStepIdx] || interleavedSequence[0]

  useEffect(() => {
    if (currentInterleavedStep) {
      setFileCurrentPage(prev => ({
        ...prev,
        [currentInterleavedStep.fileIndex]: currentInterleavedStep.pageNumber,
      }))
    }
  }, [currentInterleavedStep])

  // Active single-file page
  const currentFilteredPage = filteredDocPages[activePageIdx % (filteredDocPages.length || 1)] || filteredDocPages[0] || { pageNumber: 1, url: '', title: 'Page 1' }
  const activePageUrl = currentFilteredPage.url || ''
  const activePageTitle = currentFilteredPage.title || `Page ${currentFilteredPage.pageNumber} of ${pageCount}`

  // Single-File Auto-cycle through filtered custom document pages smoothly
  useEffect(() => {
    if (docFiles.length > 1) return
    if (filteredDocPages.length <= 1) {
      setActivePageIdx(0)
      return
    }
    const timer = setInterval(() => {
      setActivePageIdx(prev => (prev + 1) % filteredDocPages.length)
    }, 3200)
    return () => clearInterval(timer)
  }, [docFiles.length, filteredDocPages.length])

  // Dynamic UPI URL for payment QR code generated by merchant UPI Express key
  const stableOrderIdRef = useRef<string>('')
  if (!stableOrderIdRef.current) {
    stableOrderIdRef.current = session?.orderId || `PB-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(100000 + Math.random() * 900000)}`
  }
  if (session?.orderId && session.orderId !== stableOrderIdRef.current) {
    stableOrderIdRef.current = session.orderId
  }
  const effectiveOrderId = session?.orderId || stableOrderIdRef.current

  const upiQrValue = useMemo(() => {
    // If previous QR was generated for an older amount and current totalAmount changed, invalidate it
    if (session?.qrAmount && totalAmount && Math.abs(session.qrAmount - totalAmount) > 0.25) {
      return ''
    }
    // Strictly prioritize the dynamic upiintent string provided by UPI Express API without modifying it (matching test.py)
    const intent = session?.upiIntentUrl || session?.upiQrValue
    if (intent && typeof intent === 'string' && intent.trim().startsWith('upi://')) {
      return intent.trim()
    }
    if (session?.paymentUrl && typeof session.paymentUrl === 'string' && session.paymentUrl.trim().startsWith('upi://')) {
      return session.paymentUrl.trim()
    }
    // Return empty string so loading state renders until real UPI Express order is created
    return ''
  }, [session?.upiQrValue, session?.upiIntentUrl, session?.paymentUrl, session?.qrAmount, totalAmount])

  // In-flight guard to prevent multiple redundant /pay requests in race condition
  const isCreatingPayQrRef = useRef(false)

  // If in PAYING state, check if QR needs to be generated or regenerated (if amount changed)
  useEffect(() => {
    if (state === 'PAYING') {
      const isQrValidForAmount = Boolean(upiQrValue) && Boolean(session?.qrAmount) && Math.abs((session?.qrAmount ?? 0) - totalAmount) <= 0.25
      if (!isQrValidForAmount && !isCreatingPayQrRef.current) {
        isCreatingPayQrRef.current = true
        const activeSessionId = session?.sessionId || `init-${kioskId}`
        fetch(`${apiUrl}/api/kiosk-sessions/${encodeURIComponent(activeSessionId)}/pay`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: totalAmount, kioskId, orderId: effectiveOrderId }),
        })
          .then(r => r.json())
          .then(data => {
            isCreatingPayQrRef.current = false
            if (data && data.success) {
              const rawIntent = data.upiIntentUrl || data.upiQrValue || data.session?.upiIntentUrl || data.session?.upiQrValue
              setSession(prev => prev ? {
                ...prev,
                orderId: data.orderId || data.session?.orderId || prev.orderId,
                otp: data.otp || data.session?.otp || prev.otp,
                amount: data.amount ?? totalAmount,
                qrAmount: data.amount ?? totalAmount,
                upiQrValue: rawIntent,
                paymentUrl: data.paymentUrl || data.session?.paymentUrl,
                upiIntentUrl: rawIntent,
                gateway: data.session?.gateway || data.gateway || 'upiexpress',
                paymentError: undefined,
              } : null)
            } else if (data && data.error) {
              setSession(prev => prev ? {
                ...prev,
                paymentError: data.error,
                upiQrValue: '',
                upiIntentUrl: '',
                qrAmount: undefined,
              } : null)
            }
          })
          .catch(() => {
            isCreatingPayQrRef.current = false
          })
      }
    }
  }, [state, upiQrValue, session?.sessionId, session?.qrAmount, session?.amount, totalAmount, kioskId, apiUrl, effectiveOrderId])

  const [isSimulatingPayment, setIsSimulatingPayment] = useState(false)

  const handleSimulatePaymentOnKiosk = useCallback(async () => {
    if (isSimulatingPayment) return
    setIsSimulatingPayment(true)
    const targetSessionId = session?.sessionId || `sess_${kioskId}`
    console.log(`[KioskScreen] 🧪 Simulating payment on kiosk for order ${effectiveOrderId}`)

    try {
      const res = await fetch(`${apiUrl}/api/kiosk-sessions/${encodeURIComponent(targetSessionId)}/simulate-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: targetSessionId,
          kioskId,
          orderId: effectiveOrderId,
          amount: totalAmount,
          isSimulated: true,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setSession(prev => prev ? { ...prev, state: 'PRINTING', phase: 'Simulated payment confirmed! Printing document…', phaseStep: 5 } : null)
        setActiveStateOverride('PRINTING')
      } else {
        // Fallback to execute-print
        await fetch(`${apiUrl}/api/kiosk-sessions/${encodeURIComponent(targetSessionId)}/execute-print`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
        setSession(prev => prev ? { ...prev, state: 'PRINTING' } : null)
        setActiveStateOverride('PRINTING')
      }
    } catch (err) {
      console.error('[KioskScreen] Simulate payment error:', err)
    } finally {
      setIsSimulatingPayment(false)
    }
  }, [isSimulatingPayment, session?.sessionId, kioskId, effectiveOrderId, totalAmount, apiUrl])

  // Automatically poll UPI Express order status every 2.5 seconds while customer pays
  useEffect(() => {
    if (state !== 'PAYING' || !effectiveOrderId || effectiveOrderId.startsWith('init-') || isActionPending) {
      return
    }

    let isSubscribed = true
    const pollPaymentInterval = setInterval(async () => {
      try {
        const res = await fetch(`${apiUrl}/api/upiexpress/check-status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientTxnId: effectiveOrderId,
            kioskId,
          }),
        })
        const data = await res.json()
        if (isSubscribed && data && data.success && data.data) {
          const txnStatus = String(data.data.status || '').toLowerCase()
          if (txnStatus === 'success') {
            console.log(`[Kiosk] ✓ UPI Express payment captured for ${effectiveOrderId}! Starting print job…`)
            clearInterval(pollPaymentInterval)
            handleExecutePrint()
          }
        }
      } catch {
        // Non-blocking status poll
      }
    }, 2500)

    return () => {
      isSubscribed = false
      clearInterval(pollPaymentInterval)
    }
  }, [state, effectiveOrderId, kioskId, apiUrl, handleExecutePrint, isActionPending])

  const renderStepTabs = (currentStep: 'upload' | 'confirm' | 'settings' | 'review' | 'payment') => {
    const isStep1Connected = state === 'CLAIMED' || state === 'UPLOADING'
    const steps = [
      { id: 'upload', num: 1, label: isStep1Connected ? 'Device Connected' : 'Upload' },
      { id: 'confirm', num: 2, label: 'Confirm Doc' },
      { id: 'settings', num: 3, label: 'Settings' },
      { id: 'review', num: 4, label: 'Review Order' },
      { id: 'payment', num: 5, label: 'Payment' },
    ]
    const currentIdx = steps.findIndex(s => s.id === currentStep)

    return (
      <div className="ks-flow-tabs">
        {steps.map((st, i) => {
          const isDone = i < currentIdx
          const isActive = i === currentIdx
          return (
            <div key={st.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className={`ks-flow-tab ${isDone ? 'ks-flow-tab--done' : ''} ${isActive ? 'ks-flow-tab--active' : ''}`}>
                <span className="ks-flow-tab-num">{isDone ? '✓' : st.num}</span>
                <span>{st.label}</span>
              </div>
              {i < steps.length - 1 && <span className="ks-flow-tab-arrow">→</span>}
            </div>
          )
        })}
      </div>
    )
  }

  const renderDocumentPreviewBox = () => {
    // ── Multi-File View: Different rows per file with interleaved auto-show animation ──
    if (multiFileItems.length > 1) {
      return (
        <div className="ks-flow-left">
          <div className="ks-multifile-preview-wrap">
            {/* Header bar indicating file count and current animation ticker */}
            <div className="ks-multifile-header-bar">
              <div className="ks-mf-header-title-wrap">
                <span className="ks-mf-header-icon">📂</span>
                <span className="ks-mf-header-title">{multiFileItems.length} Files Uploaded</span>
                <span className="ks-mf-header-badge">{calculatedSheets * selectedCopies} Total Sheets</span>
              </div>
              <div className="ks-mf-ticker-badge">
                <span className="ks-auto-cycle-dot" />
                <span className="ks-mf-ticker-text">
                  {currentInterleavedStep
                    ? `File ${currentInterleavedStep.fileIndex + 1} of ${multiFileItems.length} · Page ${currentInterleavedStep.pageNumber}`
                    : `Active Preview`}
                </span>
              </div>
            </div>

            {/* Individual rows for each file */}
            <div className="ks-multifile-rows-container">
              {multiFileItems.map((item) => {
                const isRowActive = currentInterleavedStep ? currentInterleavedStep.fileIndex === item.index : false
                const displayedPageNum = fileCurrentPage[item.index] || item.activePageNumbers[0] || 1
                const pageObj = item.pages.find(p => p.pageNumber === displayedPageNum) || item.pages[0]
                const hasImg = Boolean(pageObj?.url && !failedPreviewUrls.has(pageObj.url))

                return (
                  <div
                    key={item.index}
                    className={`ks-multifile-row ${isRowActive ? 'ks-multifile-row--active' : ''}`}
                    onClick={isPro ? () => {
                      setFileCurrentPage(prev => ({ ...prev, [item.index]: displayedPageNum }))
                    } : undefined}
                  >
                    {/* Left: Interactive/Animated Page Thumbnail */}
                    <div className="ks-row-thumb-wrap">
                      {hasImg ? (
                        <img
                          src={pageObj?.url}
                          alt={pageObj?.title}
                          className="ks-row-thumb-img"
                          style={{
                            filter: ((item.file.colour ? item.file.colour === 'COLOUR' : selectedColour === 'COLOUR') ? 'none' : 'grayscale(100%) contrast(108%)')
                          }}
                          onError={() => {
                            if (pageObj?.url) {
                              setFailedPreviewUrls(prev => new Set(prev).add(pageObj.url))
                            }
                          }}
                        />
                      ) : (
                        <div className="ks-row-thumb-canvas">
                          <div className="ks-row-thumb-canvas-top">
                            <span className="ks-row-thumb-type-tag">A4</span>
                            <span className="ks-row-thumb-page-indicator">P.{displayedPageNum}</span>
                          </div>
                          <div className="ks-row-thumb-body-mockup">
                            <div className="ks-mock-line ks-mock-line--head" />
                            <div className="ks-mock-line" />
                            <div className="ks-mock-line ks-mock-line--short" />
                          </div>
                        </div>
                      )}
                      <div className="ks-row-thumb-badge">
                        <span>P.{displayedPageNum}</span>
                      </div>
                    </div>

                    {/* Middle: File Details */}
                    <div className="ks-row-info">
                      <div className="ks-row-info-header">
                        <span className="ks-row-file-name" title={item.fileName}>
                          {item.fileName}
                        </span>
                        {isRowActive && (
                          <span className="ks-row-active-pill">
                            <span className="ks-auto-cycle-dot" />
                            <span>Previewing Page {displayedPageNum}</span>
                          </span>
                        )}
                      </div>

                      <div className="ks-row-meta-line">
                        <span>{item.pageCount} {item.pageCount === 1 ? 'page' : 'pages'}</span>
                        <span className="ks-row-dot">•</span>
                        <span>{((item.file.colour ? item.file.colour === 'COLOUR' : selectedColour === 'COLOUR') ? 'Colour' : 'B&W')}</span>
                        <span className="ks-row-dot">•</span>
                        <span>{((item.file.duplex ? (item.file.duplex === 'DOUBLE' || String(item.file.duplex).includes('2')) : selectedDuplex === 'DOUBLE') ? '2-Sided' : '1-Sided')}</span>
                        {item.isCustom && (
                          <>
                            <span className="ks-row-dot">•</span>
                            <span className="ks-row-custom-tag">
                              Custom: {item.effectiveRange} ({item.activePageNumbers.length} pgs)
                            </span>
                          </>
                        )}
                      </div>

                      {/* Right/Bottom: Page selection pills for this file */}
                      <div className="ks-row-pages-bar">
                        <span className="ks-row-pages-label">Pages:</span>
                        {item.activePageNumbers.map((pNum) => {
                          const isPageActive = displayedPageNum === pNum
                          return (
                            <button
                              key={pNum}
                              type="button"
                              className={`ks-row-page-pill ${isPageActive ? 'ks-row-page-pill--active' : ''}`}
                              onClick={isPro ? (e) => {
                                e.stopPropagation()
                                setFileCurrentPage(prev => ({ ...prev, [item.index]: pNum }))
                              } : undefined}
                              title={`Page ${pNum}`}
                            >
                              {pNum}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )
    }

    // ── Single Document Preview Box ──
    return (
      <div className="ks-flow-left">
        <div className="ks-preview-wrap">
          {activePageUrl && !failedPreviewUrls.has(activePageUrl) ? (
            <img
              src={activePageUrl}
              alt={activePageTitle}
              className="ks-preview-img"
              style={{
                filter: selectedColour === 'BW' ? 'grayscale(100%) contrast(108%)' : 'none'
              }}
              onError={() => {
                setFailedPreviewUrls(prev => new Set(prev).add(activePageUrl))
              }}
            />
          ) : (
            <div className="ks-preview-canvas">
              <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#dc2626' }}>PRINTBOOTH VERIFIED</span>
                <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>
                  {isCustomPages
                    ? `PAGE ${currentFilteredPage.pageNumber} OF ${pageCount} (CUSTOM · ${(activePageIdx % filteredDocPages.length) + 1}/${selectedPageNumbers.length})`
                    : `PAGE ${currentFilteredPage.pageNumber} OF ${pageCount}`}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 36 }}>📄</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#09090b', textAlign: 'center', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {docFileName}
                </span>
                {isCustomPages && (
                  <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 700, background: '#fef2f2', padding: '2px 8px', borderRadius: 6, border: '1px solid #fecaca' }}>
                    Custom Pages: {effectivePageRange} ({selectedPageNumbers.length} of {pageCount} Selected)
                  </span>
                )}
              </div>

              <div style={{ width: '100%', fontSize: 10, color: '#94a3b8', textAlign: 'center', borderTop: '1px solid #f1f5f9', paddingTop: 6 }}>
                A4 Paper Size • Standard 75GSM
              </div>
            </div>
          )}

          {/* Floating Page Badge */}
          <div className="ks-preview-page-badge">
            <span className="ks-auto-cycle-dot" />
            <span>
              {isCustomPages
                ? `Page ${currentFilteredPage.pageNumber} of ${pageCount} (Custom · ${(activePageIdx % filteredDocPages.length) + 1} of ${selectedPageNumbers.length})`
                : (filteredDocPages[activePageIdx % filteredDocPages.length]?.title || `Page ${(activePageIdx % pageCount) + 1} of ${pageCount}`)}
            </span>
          </div>
        </div>

        {/* Pro Touchscreen Navigation Bar */}
        {isPro && filteredDocPages.length > 1 && (
          <div className="ks-preview-nav-bar">
            <button
              type="button"
              className="ks-preview-nav-btn"
              disabled={activePageIdx === 0}
              onClick={() => setActivePageIdx(p => Math.max(0, p - 1))}
            >
              ◀ Prev
            </button>
            <span className="ks-preview-nav-text">
              {isCustomPages
                ? `Page ${currentFilteredPage.pageNumber} of ${pageCount} (${(activePageIdx % filteredDocPages.length) + 1}/${selectedPageNumbers.length})`
                : `Page ${(activePageIdx % pageCount) + 1} of ${pageCount}`}
            </span>
            <button
              type="button"
              className="ks-preview-nav-btn"
              disabled={activePageIdx >= filteredDocPages.length - 1}
              onClick={() => setActivePageIdx(p => Math.min(filteredDocPages.length - 1, p + 1))}
            >
              Next ▶
            </button>
          </div>
        )}

        {/* Horizontal thumbnail gallery of pages */}
        {filteredDocPages.length > 1 && (
          <div className="ks-gallery-strip">
            {filteredDocPages.map((p, idx) => {
              const thumbUrl = p.url
              const pageTitle = p.title || `Page ${p.pageNumber}`
              const isActive = (activePageIdx % filteredDocPages.length) === idx
              return (
                <div
                  key={idx}
                  className={`ks-gallery-thumb-item ${isActive ? 'ks-gallery-thumb-item--active' : ''}`}
                  onClick={isPro ? () => setActivePageIdx(idx) : undefined}
                  style={{ cursor: isPro ? 'pointer' : 'default' }}
                  title={isPro ? `Touch to view ${pageTitle}` : undefined}
                >
                  <div className="ks-gallery-thumb-img-wrap">
                    {thumbUrl && !failedPreviewUrls.has(thumbUrl) ? (
                      <img
                        src={thumbUrl}
                        alt={pageTitle}
                        className="ks-gallery-thumb-img"
                        style={{
                          filter: selectedColour === 'BW' ? 'grayscale(100%) contrast(108%)' : 'none'
                        }}
                        onError={() => {
                          setFailedPreviewUrls(prev => new Set(prev).add(thumbUrl))
                        }}
                      />
                    ) : (
                      <div className="ks-gallery-thumb-placeholder">
                        <span className="ks-gallery-thumb-doc-icon">📄</span>
                        <span className="ks-gallery-thumb-num">P.{p.pageNumber}</span>
                      </div>
                    )}
                  </div>
                  <span className="ks-gallery-thumb-num" title={pageTitle}>
                    P.{p.pageNumber}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="ks-root">
      {/* ── Kiosk Moving Advertisement Background (Strictly on upload from your phone page) ── */}
      {isWaiting && <KioskAdBackground kioskId={kioskId} />}

      {/* Ambient Red & White Mesh Lighting */}
      <div className="ks-bg-mesh" />

      {/* ── 5-Second Phone Disconnect Grace Warning Banner ── */}
      {phoneDisconnectCountdown !== null && phoneDisconnectCountdown > 0 && !isWaiting && state !== 'PRINTING' && state !== 'DONE' && (
        <aside className="ks-phone-disconnect-banner" role="alert" aria-live="assertive">
          <div className="ks-phone-disconnect-content">
            <div className="ks-phone-disconnect-badge">
              <span className="ks-phone-disconnect-pulse" />
              <span>📱 PHONE DISCONNECTED</span>
            </div>
            <div className="ks-phone-disconnect-message">
              User exited on phone. Refreshing kiosk in{' '}
              <strong className="ks-phone-disconnect-timer">{phoneDisconnectCountdown}s</strong>...
            </div>
            <div className="ks-phone-disconnect-actions">
              <button
                type="button"
                className="ks-phone-disconnect-btn ks-phone-disconnect-btn--keep"
                onClick={() => setPhoneDisconnectCountdown(null)}
              >
                Keep Session
              </button>
              <button
                type="button"
                className="ks-phone-disconnect-btn ks-phone-disconnect-btn--reset"
                onClick={() => {
                  setPhoneDisconnectCountdown(null)
                  handleCancelAndNewUpload()
                }}
              >
                Reset Now
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* Universal Kiosk Header (Station Pill on Sharp Top Left ONLY on upload from phone page) */}
      {isWaiting && (
        <header className="ks-topbar">
          <div className="ks-topbar-left">
            <div
              className={`ks-topbar-pill ${isPrinterReady ? 'ks-topbar-pill--online' : 'ks-topbar-pill--offline'}`}
              title={isPrinterReady ? 'Printer Hardware Online & Ready' : 'Printer Offline (Checking Connection)'}
            >
              <img src="/logo.png" alt="PrintBooth" style={{ width: 18, height: 18, objectFit: 'contain' }} />
              <span className={`ks-topbar-dot ${isPrinterReady ? 'ks-topbar-dot--online' : 'ks-topbar-dot--offline'}`} />
              <span className="ks-topbar-station-name">{kioskName || kioskId}</span>
              <span className="ks-topbar-sep">•</span>
              <span className={`ks-topbar-status-text ${isPrinterReady ? 'online' : 'offline'}`}>
                {isPrinterReady ? 'Ready' : 'Offline'}
              </span>
            </div>
          </div>
        </header>
      )}

      {/* Main Container */}
      <main className={`ks-main ${stateChanged ? 'ks-transition' : ''}`}>

        {/* ── STEP 0: IDLE QR Code Display (Scanner in Middle, Zero Buttons) ── */}
        {isWaiting && (
          <>
            <div className="ks-qr-panel ks-qr-panel--centered">
              <div className="ks-qr-center-box">
                <div className="ks-qr-header">
                  <h1 className="ks-title">Print from Your Phone</h1>
                  <p className="ks-subtitle">Scan the QR code with your camera to upload documents</p>
                </div>

                <div className="ks-qr-card">
                  {qrDisplayValue ? (
                    <QRCodeSVG
                      value={qrDisplayValue}
                      size={responsiveMainQrSize}
                      level="M"
                      includeMargin={false}
                      fgColor="#09090b"
                      bgColor="#ffffff"
                    />
                  ) : (
                    <div className="ks-qr-loading-placeholder">
                      <div className="ks-qr-spinner" />
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#64748b' }}>
                        Generating Secure Session…
                      </span>
                    </div>
                  )}
                </div>

                {/* Clean Scan Prompt */}
                {session?.token && session.token !== 'init' && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginTop: 6 }}>
                    <div style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 16px',
                      borderRadius: 0,
                      background: 'rgba(255, 255, 255, 0.95)',
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
                      fontSize: 13,
                      fontWeight: 700,
                      color: '#0f172a',
                      fontFamily: 'var(--ks-font)',
                    }}>
                      <span style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: '#16a34a',
                        boxShadow: '0 0 6px #16a34a',
                        display: 'inline-block',
                      }} />
                      <span>Scan with phone camera to start</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* ── STEP 1: Device Connected / Uploading State ── */}
        {/* ── STEP 1: Device Connected / Uploading State ── */}
        {(state === 'CLAIMED' || state === 'UPLOADING') && (() => {
          const isUploadingActive = state === 'UPLOADING' ||
            Boolean(session?.progressData?.isUploading) ||
            typeof session?.progressData?.uploadPercent === 'number' ||
            (Boolean(session?.phase) && (
              session!.phase.toLowerCase().includes('upload') ||
              session!.phase.toLowerCase().includes('preparing') ||
              session!.phase.toLowerCase().includes('processing')
            ))

          const activeUploadPercent = Math.min(100, Math.max(
            0,
            typeof session?.progressData?.uploadPercent === 'number'
              ? Math.round(session.progressData.uploadPercent)
              : (session?.phase && session.phase.match(/(\d+)%/)?.[1]
                ? parseInt(session.phase.match(/(\d+)%/)?.[1], 10)
                : (isUploadingActive ? 45 : 0))
          ))

          return (
            <div className="ks-interactive-panel">
              {renderStepTabs('upload')}
              {!doc ? (
                isUploadingActive ? (
                  <div className="ks-connected-view ks-uploading-stage" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="ks-upload-card">
                      <div className="ks-upload-graphic-wrap">
                        <div className="ks-upload-radar-ring ks-radar-1" />
                        <div className="ks-upload-radar-ring ks-radar-2" />
                        <div className="ks-upload-icon-circle">
                          <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="ks-upload-pulse-svg">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" y1="3" x2="12" y2="15" />
                          </svg>
                        </div>
                      </div>

                      <div className="ks-upload-percent-row">
                        <span className="ks-upload-percent-val">{activeUploadPercent}%</span>
                      </div>

                      <h1 className="ks-upload-heading">Receiving Document…</h1>

                      <div className="ks-upload-progress-track">
                        <div
                          className="ks-upload-progress-fill"
                          style={{ width: `${Math.max(6, activeUploadPercent)}%` }}
                        >
                          <span className="ks-upload-progress-glow" />
                        </div>
                      </div>

                      <div className="ks-upload-meta-line">
                        <span className="ks-upload-filename">
                          {session?.fileName || session?.progressData?.fileName || 'Document.pdf'}
                        </span>
                        {session?.progressData?.loadedMB && session?.progressData?.totalMB && (
                          <span className="ks-upload-bytes">
                            · {session.progressData.loadedMB} MB / {session.progressData.totalMB} MB
                          </span>
                        )}
                      </div>

                      <div className="ks-companion-status-pill" style={{ marginTop: 22 }}>
                        <span className="ks-companion-dot" />
                        <span>{session?.phase || `Step 1: Uploading from phone (${activeUploadPercent}%)`}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="ks-connected-view" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="ks-connected-center">
                      <div className="ks-connected-icon-wrap">
                        <img
                          src="/phone-connected.svg"
                          alt="Device Connected"
                          className="ks-connected-phone-svg"
                        />
                      </div>
                      <h1 className="ks-connected-title">Device Connected</h1>
                      <p className="ks-connected-sub" style={{ fontSize: 16, color: '#64748b', margin: '6px 0 0', fontWeight: 500 }}>
                        Select your document on your phone to continue
                      </p>
                      <div className="ks-companion-status-pill" style={{ marginTop: 20 }}>
                        <span className="ks-companion-dot" />
                        <span>Step 1: Choose or upload documents on phone</span>
                      </div>
                    </div>
                  </div>
                )
              ) : (
                <div className="ks-flow-body">
                  {/* Left Column: Real Page Preview & Gallery */}
                  {renderDocumentPreviewBox()}

                  {/* Right Column: Upload Progress & Mobile Companion Status */}
                  <div className="ks-flow-right" style={{ justifyContent: 'space-between', gap: 16 }}>
                    <div>
                      {isUploadingActive && (
                        <div className="ks-upload-live-banner">
                          <div className="ks-upload-banner-top">
                            <span className="ks-upload-banner-label">Transfer in Progress</span>
                            <strong className="ks-upload-banner-pct">{activeUploadPercent}%</strong>
                          </div>
                          <div className="ks-upload-progress-track ks-upload-progress-track--small">
                            <div className="ks-upload-progress-fill" style={{ width: `${Math.max(6, activeUploadPercent)}%` }} />
                          </div>
                        </div>
                      )}
                      <h3 className="ks-summary-title">Uploading Documents</h3>
                      <div className="ks-summary-table">
                        {docFiles.length > 1 ? (
                          <div className="ks-summary-row ks-summary-row--multifile">
                            <span>Documents ({docFiles.length})</span>
                            <div className="ks-multifile-chip-group">
                              {docFiles.map((f, i) => (
                                <div key={i} className="ks-multifile-chip" title={`${f.fileName} (${f.pageCount || 1} pages)`}>
                                  <span className="ks-multifile-chip-name">{f.fileName}</span>
                                  <span className="ks-multifile-chip-badge">{f.pageCount || 1}p</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="ks-summary-row">
                            <span>Document</span>
                            <strong style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{docFileName}</strong>
                          </div>
                        )}
                        <div className="ks-summary-row">
                          <span>Total Pages</span>
                          <strong>{pageCount} {pageCount === 1 ? 'Page' : 'Pages'}</strong>
                        </div>
                        <div className="ks-summary-row">
                          <span>Paper Tray</span>
                          <strong style={{ color: '#16a34a' }}>Ready (A4 75GSM)</strong>
                        </div>
                        <div className="ks-summary-row">
                          <span>Current Stage</span>
                          <strong style={{ color: '#16a34a' }}>Step 1: Selecting on Mobile</strong>
                        </div>
                      </div>
                    </div>

                    <div className="ks-companion-card">
                      <div className="ks-companion-card-header">
                        <div className="ks-companion-card-icon">📱</div>
                        <div>
                          <div className="ks-companion-card-title">Selecting Files on Mobile</div>
                          <div className="ks-companion-card-sub">Add more files or tap "Review &amp; Continue" on your phone to confirm.</div>
                        </div>
                      </div>
                      <div className="ks-companion-status-pill">
                        <span className="ks-companion-dot" />
                        <span>Step 1: Preparing documents on phone →</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })()}

        {/* ── SECTION 2: Confirm Doc (CONFIRMING) ── */}
        {state === 'CONFIRMING' && (
          <div className="ks-interactive-panel">
            {renderStepTabs('confirm')}
            <div className="ks-flow-body">
              {/* Left Column: Real Page Preview & Gallery */}
              {renderDocumentPreviewBox()}

              {/* Right Column: Specs & Companion/Touch Card */}
              <div className="ks-flow-right" style={{ justifyContent: 'space-between', gap: 16 }}>
                <div>
                  <h3 className="ks-summary-title">Confirm Documents</h3>
                  <div className="ks-summary-table">
                    {docFiles.length > 1 ? (
                      <div className="ks-summary-row ks-summary-row--multifile">
                        <span>Documents ({docFiles.length})</span>
                        <div className="ks-multifile-chip-group">
                          {docFiles.map((f, i) => (
                            <div key={i} className="ks-multifile-chip" title={`${f.fileName} (${f.pageCount || 1} pages)`}>
                              <span className="ks-multifile-chip-name">{f.fileName}</span>
                              <span className="ks-multifile-chip-badge">{f.pageCount || 1}p</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="ks-summary-row">
                        <span>Document</span>
                        <strong style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{docFileName}</strong>
                      </div>
                    )}
                    <div className="ks-summary-row">
                      <span>Total Pages</span>
                      <strong>{pageCount} {pageCount === 1 ? 'Page' : 'Pages'}</strong>
                    </div>
                  </div>
                </div>

                {isLite ? (
                  <div className="ks-companion-card">
                    <div className="ks-companion-card-header">
                      <div className="ks-companion-card-icon">📱</div>
                      <div>
                        <div className="ks-companion-card-title">Confirming on Mobile</div>
                        <div className="ks-companion-card-sub">Review and confirm pages on your phone to continue.</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="ks-pro-touch-card" style={{ marginTop: 'auto' }}>
                    <button
                      type="button"
                      onClick={handleProConfirmAndNext}
                      className="ks-pro-btn ks-pro-btn--primary"
                      style={{ width: '100%', height: 48 }}
                    >
                      <span>Confirm &amp; Print Settings</span>
                      <span className="ks-pro-arrow">→</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── SECTION 3: Settings (CONFIGURING) ── */}
        {state === 'CONFIGURING' && (
          <div className="ks-interactive-panel">
            {renderStepTabs('settings')}
            <div className="ks-flow-body">
              {/* Left Column: Real Page Preview & Gallery */}
              {renderDocumentPreviewBox()}

              {/* Right Column: Settings & Touch Controls */}
              <div className="ks-flow-right" style={{ justifyContent: 'space-between', gap: 14 }}>
                {isLite ? (
                  <div>
                    <h3 className="ks-summary-title" style={{ marginBottom: 12 }}>Print Settings</h3>
                    <div className="ks-mirrored-grid">
                      <div className="ks-mirror-card">
                        <span className="ks-mirror-label">Color Mode</span>
                        <strong className="ks-mirror-val" style={{ color: selectedColour === 'COLOUR' ? '#dc2626' : '#09090b' }}>
                          {selectedColour === 'COLOUR' ? 'Full Colour' : 'Black & White'}
                        </strong>
                        <span className="ks-mirror-sub">{selectedColour === 'COLOUR' ? 'High Quality Colour' : 'Standard B&W'}</span>
                      </div>
                      <div className="ks-mirror-card">
                        <span className="ks-mirror-label">Sides</span>
                        <strong className="ks-mirror-val">{selectedDuplex === 'DOUBLE' ? '2-Sided' : '1-Sided'}</strong>
                        <span className="ks-mirror-sub">{selectedDuplex === 'DOUBLE' ? 'Duplex' : 'Single Sided'}</span>
                      </div>
                      <div className="ks-mirror-card">
                        <span className="ks-mirror-label">Copies</span>
                        <strong className="ks-mirror-val">{selectedCopies} {selectedCopies === 1 ? 'Copy' : 'Copies'}</strong>
                        <span className="ks-mirror-sub">{calculatedSheets * selectedCopies} Total Sheets</span>
                      </div>
                      <div className={`ks-mirror-card ${isCustomPages ? 'ks-mirror-card--custom' : ''}`}>
                        <span className="ks-mirror-label">Pages</span>
                        <strong className="ks-mirror-val" style={{ color: isCustomPages ? '#dc2626' : '#09090b' }}>
                          {isCustomPages ? `Custom (${effectivePageRange})` : 'All Pages'}
                        </strong>
                        <span className="ks-mirror-sub" style={{ color: isCustomPages ? '#dc2626' : '#94a3b8' }}>
                          {isCustomPages ? `${selectedPageNumbers.length} of ${pageCount} Selected` : `${pageCount} Total Pages`}
                        </span>
                      </div>
                      <div className="ks-mirror-card ks-mirror-card--full">
                        <span className="ks-mirror-label">Paper Tray</span>
                        <strong className="ks-mirror-val" style={{ color: '#16a34a' }}>A4 75GSM</strong>
                        <span className="ks-mirror-sub">Ready • Standard Tray</span>
                      </div>
                    </div>

                    <div className="ks-total-banner" style={{ marginTop: 14 }}>
                      <span className="ks-total-label">Estimated Total</span>
                      <span className="ks-total-price">₹{totalAmount.toFixed(2)}</span>
                    </div>

                    <div className="ks-companion-card" style={{ marginTop: 12 }}>
                      <div className="ks-companion-card-header">
                        <div className="ks-companion-card-icon">⚙️</div>
                        <div>
                          <div className="ks-companion-card-title">Configuring on Mobile</div>
                          <div className="ks-companion-card-sub">Select copies, custom pages, and duplex on phone. Changes reflect here live.</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="ks-pro-touch-card" style={{ height: '100%', justifyContent: 'space-between' }}>
                    <div>
                      <h3 className="ks-summary-title" style={{ marginBottom: 10 }}>Print Settings</h3>
                      <div className="ks-pro-settings-controls">
                        {/* Colour Mode Selector */}
                        <div className="ks-pro-control-group">
                          <span className="ks-pro-control-label">Colour Mode</span>
                          <div className="ks-pro-pill-toggle">
                            <button
                              type="button"
                              className={`ks-pro-pill-opt ${selectedColour === 'BW' ? 'ks-pro-pill-opt--active' : ''}`}
                              onClick={() => handleProColourChange('BW')}
                            >
                              <span>🖤 B&amp;W (₹{pageDetails.pricing.bwSingle}/p)</span>
                            </button>
                            <button
                              type="button"
                              className={`ks-pro-pill-opt ${selectedColour === 'COLOUR' ? 'ks-pro-pill-opt--active-red' : ''}`}
                              onClick={() => handleProColourChange('COLOUR')}
                            >
                              <span>🎨 Full Colour (₹{pageDetails.pricing.colorSingle}/p)</span>
                            </button>
                          </div>
                        </div>

                        {/* Sides Selector */}
                        <div className="ks-pro-control-group">
                          <span className="ks-pro-control-label">Sides</span>
                          <div className="ks-pro-pill-toggle">
                            <button
                              type="button"
                              className={`ks-pro-pill-opt ${selectedDuplex === 'SINGLE' ? 'ks-pro-pill-opt--active' : ''}`}
                              onClick={() => handleProDuplexChange('SINGLE')}
                            >
                              <span>📄 1-Sided</span>
                            </button>
                            <button
                              type="button"
                              className={`ks-pro-pill-opt ${selectedDuplex === 'DOUBLE' ? 'ks-pro-pill-opt--active' : ''}`}
                              onClick={() => handleProDuplexChange('DOUBLE')}
                            >
                              <span>📑 2-Sided</span>
                            </button>
                          </div>
                        </div>

                        {/* Pages Selector */}
                        <div className="ks-pro-control-group">
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <span className="ks-pro-control-label">Pages</span>
                            <span style={{ fontSize: 11, fontWeight: 700, color: isCustomPages ? '#dc2626' : '#64748b' }}>
                              {isCustomPages ? `Custom: ${effectivePageRange} (${selectedPageNumbers.length}/${pageCount} pgs)` : `All Pages (${pageCount})`}
                            </span>
                          </div>
                          <div className="ks-pro-pill-toggle">
                            <button
                              type="button"
                              className={`ks-pro-pill-opt ${!isCustomPages ? 'ks-pro-pill-opt--active' : ''}`}
                              onClick={() => handleProPageRangeChange('ALL')}
                            >
                              <span>📄 All Pages</span>
                            </button>
                            <button
                              type="button"
                              className={`ks-pro-pill-opt ${isCustomPages ? 'ks-pro-pill-opt--active-red' : ''}`}
                              onClick={() => handleProPageRangeChange(isCustomPages ? effectivePageRange : (pageCount > 1 ? `1-${Math.min(2, pageCount)}` : '1'))}
                            >
                              <span>📑 Custom Range</span>
                            </button>
                          </div>
                          {isCustomPages && pageCount > 1 && (
                            <div className="ks-pro-page-preset-chips" style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                className={`ks-pro-chip ${effectivePageRange === '1' ? 'ks-pro-chip--active' : ''}`}
                                onClick={() => handleProPageRangeChange('1')}
                              >
                                Page 1
                              </button>
                              {pageCount >= 2 && (
                                <button
                                  type="button"
                                  className={`ks-pro-chip ${effectivePageRange === `1-${Math.min(2, pageCount)}` ? 'ks-pro-chip--active' : ''}`}
                                  onClick={() => handleProPageRangeChange(`1-${Math.min(2, pageCount)}`)}
                                >
                                  Pages 1-{Math.min(2, pageCount)}
                                </button>
                              )}
                              {pageCount >= 3 && (
                                <button
                                  type="button"
                                  className={`ks-pro-chip ${effectivePageRange === '1,3' ? 'ks-pro-chip--active' : ''}`}
                                  onClick={() => handleProPageRangeChange('1,3')}
                                >
                                  Odd (1, 3)
                                </button>
                              )}
                              {pageCount >= 4 && (
                                <button
                                  type="button"
                                  className={`ks-pro-chip ${effectivePageRange === '2,4' ? 'ks-pro-chip--active' : ''}`}
                                  onClick={() => handleProPageRangeChange('2,4')}
                                >
                                  Even (2, 4)
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Copies Stepper */}
                        <div className="ks-pro-control-group">
                          <span className="ks-pro-control-label">Copies</span>
                          <div className="ks-pro-stepper">
                            <button
                              type="button"
                              className="ks-pro-stepper-btn"
                              disabled={selectedCopies <= 1}
                              onClick={() => handleProCopiesChange(-1)}
                            >
                              −
                            </button>
                            <span className="ks-pro-stepper-val">{selectedCopies}</span>
                            <button
                              type="button"
                              className="ks-pro-stepper-btn"
                              disabled={selectedCopies >= 50}
                              onClick={() => handleProCopiesChange(1)}
                            >
                              +
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="ks-total-banner" style={{ marginTop: 12 }}>
                        <span className="ks-total-label">Estimated Total</span>
                        <span className="ks-total-price">₹{totalAmount.toFixed(2)}</span>
                      </div>
                    </div>

                    <div style={{ marginTop: 12 }}>
                      <button
                        type="button"
                        onClick={handleProProceedToReview}
                        className="ks-pro-btn ks-pro-btn--primary"
                        style={{ width: '100%', height: 48 }}
                      >
                        <span>Review Order (₹{totalAmount.toFixed(2)})</span>
                        <span className="ks-pro-arrow">→</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── SECTION 3 (Sub): Review Order (REVIEWING) ── */}
        {state === 'REVIEWING' && (
          <div className="ks-interactive-panel">
            {renderStepTabs('review')}
            <div className="ks-flow-body">
              {/* Left Column: Real Page Preview & Gallery */}
              {renderDocumentPreviewBox()}

              {/* Right Column: Order Breakdown & Next Step Callout */}
              <div className="ks-flow-right" style={{ justifyContent: 'space-between', gap: 14 }}>
                <div>
                  <h3 className="ks-summary-title">Review Order</h3>
                  <div className="ks-summary-table">
                    {docFiles.length > 1 ? (
                      <div className="ks-summary-row ks-summary-row--multifile">
                        <span>Documents ({docFiles.length})</span>
                        <div className="ks-multifile-chip-group">
                          {docFiles.map((f, i) => (
                            <div key={i} className="ks-multifile-chip" title={`${f.fileName} (${f.pageCount || 1} pages)`}>
                              <span className="ks-multifile-chip-name">{f.fileName}</span>
                              <span className="ks-multifile-chip-badge">{f.pageCount || 1}p</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="ks-summary-row">
                        <span>Document</span>
                        <strong style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{docFileName}</strong>
                      </div>
                    )}
                    <div className="ks-summary-row">
                      <span>Print Configuration</span>
                      <strong>{selectedColour === 'COLOUR' ? 'Full Colour' : 'B&W'} • {selectedCopies} {selectedCopies === 1 ? 'copy' : 'copies'} • {calculatedSheets * selectedCopies} sheets</strong>
                    </div>
                    <div className="ks-summary-row">
                      <span>Pages to Print</span>
                      <strong style={{ color: isCustomPages ? '#dc2626' : '#09090b' }}>
                        {isCustomPages
                          ? `Custom: ${effectivePageRange} (${selectedPageNumbers.length} of ${pageCount} pages)`
                          : `All Pages (${pageCount} pages)`}
                      </strong>
                    </div>
                    <div className="ks-summary-row">
                      <span>Paper Tray</span>
                      <strong style={{ color: '#16a34a' }}>Ready (A4 75GSM)</strong>
                    </div>
                  </div>

                  <div className="ks-total-banner" style={{ marginTop: 12 }}>
                    <span className="ks-total-label">Payable Amount</span>
                    <span className="ks-total-price">₹{totalAmount.toFixed(2)}</span>
                  </div>
                </div>

                {isLite ? (
                  <div className="ks-companion-card">
                    <div className="ks-companion-card-header">
                      <div className="ks-companion-card-icon">📋</div>
                      <div>
                        <div className="ks-companion-card-title">Reviewing Order on Mobile</div>
                        <div className="ks-companion-card-sub">Review order details on phone and tap Pay to show payment QR.</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="ks-pro-touch-card">
                    <button
                      type="button"
                      onClick={handleProProceedToPayment}
                      className="ks-pro-btn ks-pro-btn--primary"
                      style={{ width: '100%', height: 48 }}
                    >
                      <span>Proceed to Pay ₹{totalAmount.toFixed(2)}</span>
                      <span className="ks-pro-arrow">→</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── SECTION 4: Payment & UPI QR (PAYING) ── */}
        {state === 'PAYING' && (
          <div className="ks-interactive-panel">
            {renderStepTabs('payment')}
            <div className="ks-flow-body">
              {/* Left Column: Order Breakdown & Hardware Dispense Notice */}
              <div className="ks-flow-left" style={{ justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <h3 className="ks-summary-title">Payment</h3>
                  <div className="ks-summary-table">
                    <div className="ks-summary-row">
                      <span>Order ID</span>
                      <strong style={{ fontFamily: 'var(--ks-mono)' }}>{effectiveOrderId}</strong>
                    </div>
                    {docFiles.length > 1 ? (
                      <div className="ks-summary-row ks-summary-row--multifile">
                        <span>Documents ({docFiles.length})</span>
                        <div className="ks-multifile-chip-group">
                          {docFiles.map((f, i) => (
                            <div key={i} className="ks-multifile-chip" title={`${f.fileName} (${f.pageCount || 1} pages)`}>
                              <span className="ks-multifile-chip-name">{f.fileName}</span>
                              <span className="ks-multifile-chip-badge">{f.pageCount || 1}p</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="ks-summary-row">
                        <span>Document</span>
                        <strong style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{docFileName}</strong>
                      </div>
                    )}
                    <div className="ks-summary-row">
                      <span>Prints</span>
                      <strong>
                        {selectedColour === 'COLOUR' ? 'Colour' : 'B&W'} • {selectedCopies} copy • {calculatedSheets * selectedCopies} sheets
                        {isCustomPages ? ` • Custom (${effectivePageRange})` : ''}
                      </strong>
                    </div>
                  </div>

                  <div className="ks-total-banner">
                    <span className="ks-total-label">Payable Amount</span>
                    <span className="ks-total-price">₹{totalAmount.toFixed(2)}</span>
                  </div>
                </div>

                <div className="ks-auto-dispense-card">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 20 }}>⚡</span>
                    <strong style={{ fontSize: 13, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Automatic Print Dispense</strong>
                  </div>
                  <p style={{ margin: '6px 0 0', fontSize: 12, color: '#475569', lineHeight: 1.5 }}>
                    Printing begins automatically once payment is received. Collect your printed pages from the output tray below.
                  </p>
                </div>
              </div>

              {/* Right Column: Large Dynamic UPI Payment QR Box */}
              <div className="ks-flow-right" style={{ alignItems: 'center', justifyContent: 'center' }}>
                <div className="ks-pay-qr-card">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a', boxShadow: '0 0 8px rgba(22, 163, 74, 0.6)' }} />
                    <span style={{ fontSize: 13, fontWeight: 800, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      Scan to Pay ₹{totalAmount.toFixed(2)}
                    </span>
                  </div>

                  <div style={{ padding: 12, background: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }}>
                    {upiQrValue ? (
                      <QRCodeSVG
                        value={upiQrValue}
                        size={responsiveUpiQrSize}
                        level="M"
                        includeMargin={false}
                        fgColor="#09090b"
                        bgColor="#ffffff"
                      />
                    ) : session?.paymentError ? (
                      <div style={{ width: responsiveUpiQrSize, height: responsiveUpiQrSize, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 16, textAlign: 'center' }}>
                        <span style={{ fontSize: 28 }}>⚠️</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#dc2626' }}>Payment Not Configured</span>
                        <span style={{ fontSize: 11, color: '#64748b', lineHeight: 1.4 }}>{session.paymentError}</span>
                      </div>
                    ) : (
                      <div style={{ width: responsiveUpiQrSize, height: responsiveUpiQrSize, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                        <div className="ks-qr-spinner" />
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>Generating QR…</span>
                      </div>
                    )}
                  </div>

                  <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ color: '#16a34a', fontWeight: 700 }}>Accepted: GPay • PhonePe • Paytm • Any UPI App</span>
                  </div>

                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '5px 12px',
                    borderRadius: 999,
                    background: '#f1f5f9',
                    fontSize: 11,
                    color: '#475569',
                    fontWeight: 600,
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16a34a', boxShadow: '0 0 6px #16a34a' }} />
                    <span>Awaiting payment confirmation…</span>
                  </div>

                  <div style={{ marginTop: 12, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <button
                      type="button"
                      onClick={handleSimulatePaymentOnKiosk}
                      disabled={isSimulatingPayment}
                      className="ks-simulate-pay-btn"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        padding: '8px 18px',
                        background: 'linear-gradient(135deg, #fef2f2, #fff1f2)',
                        border: '1.5px dashed #dc2626',
                        borderRadius: 10,
                        color: '#dc2626',
                        fontWeight: 700,
                        fontSize: 12,
                        cursor: isSimulatingPayment ? 'not-allowed' : 'pointer',
                        letterSpacing: '0.02em',
                        boxShadow: '0 2px 8px rgba(220, 38, 38, 0.08)',
                        transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                      }}
                    >
                      <span>🧪</span>
                      <span>{isSimulatingPayment ? 'Simulating Print…' : 'Simulate Payment (Test Print)'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── SECTION 4 (Sub): Enter OTP on Hardware Keypad (OTP_READY) ── */}
        {state === 'OTP_READY' && (
          <div className="ks-interactive-panel" style={{ alignItems: 'center', justifyContent: 'center' }}>
            <div className="ks-otp-panel">
              <div className="ks-otp-badge">
                <span>🔐</span>
                <span>AUTHENTICATION PIN</span>
              </div>
              <h2 className="ks-otp-headline">Enter OTP on Hardware Keypad</h2>
              <div className="ks-otp-digits">
                {(session?.otp || '----').split('').map((digit, i) => (
                  <div key={i} className="ks-otp-digit">{digit}</div>
                ))}
              </div>
              <p className="ks-otp-hint">
                Type this 4-digit code on the kiosk physical keypad to release your pages.
              </p>
            </div>
          </div>
        )}

        {/* ── SECTION 4: Live Printing Progress (PRINTING) ── */}
        {isPrinting && (
          <PrinterDispenseAnimation
            fileName={docFileName}
            sheets={calculatedSheets}
            copies={selectedCopies}
            colourMode={
              isLite ? 'BW' : (
                (
                  (session?.settings?.colour && session.settings.colour === 'COLOUR') ||
                  ((session?.settings as any)?.colourMode && String((session.settings as any).colourMode).toUpperCase().includes('COL')) ||
                  (session?.colourMode && String(session.colourMode).toUpperCase().includes('COL')) ||
                  (session?.files && session.files.some((f: any) => (f.colour && String(f.colour).toUpperCase().includes('COL')) || (f.settings?.colour && String(f.settings.colour).toUpperCase().includes('COL')))) ||
                  selectedColour === 'COLOUR'
                ) ? 'COLOUR' : 'BW'
              )
            }
            onComplete={handlePrintComplete}
            docPages={filteredDocPages.length > 0 ? filteredDocPages : docPages}
          />
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
            {isPro && (
              <button
                type="button"
                onClick={() => {
                  if (rotateTimerRef.current) {
                    clearTimeout(rotateTimerRef.current)
                    rotateTimerRef.current = null
                  }
                  createSession(true)
                }}
                className="ks-pro-btn ks-pro-btn--primary"
                style={{ marginTop: 16 }}
              >
                <span>Print Another Document</span>
                <span className="ks-pro-arrow">→</span>
              </button>
            )}
          </div>
        )}


        {/* ── 15-Second Inactivity Warning Text (Requested by user) ── */}
        {isConnectedOrAbove && (
          <KioskInactivityBanner
            remainingSec={inactivitySecondsLeft}
            resetAt={Date.now() + inactivitySecondsLeft * 1000}
          />
        )}

      </main>

      {/* Universal Kiosk Bottom Navigation (Back on Sharp Bottom Left, Cancel on Sharp Bottom Right) */}
      {isConnectedOrAbove && (
        <nav className="ks-bottom-nav" aria-label="Session Navigation">
          <button
            type="button"
            className="ks-bottom-btn ks-bottom-btn--back"
            onClick={handleUniversalBack}
            title="Back to previous step"
            id="ks-universal-back"
          >
            <span className="ks-bottom-btn-arrow">←</span>
            <span>Back</span>
          </button>

          <button
            type="button"
            className="ks-bottom-btn ks-bottom-btn--cancel"
            onClick={handleCancelAndNewUpload}
            title="Cancel session and start over"
            id="ks-universal-cancel"
          >
            <span className="ks-bottom-btn-cross">✕</span>
            <span>Cancel</span>
          </button>
        </nav>
      )}
    </div>
  )
}
