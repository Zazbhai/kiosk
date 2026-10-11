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
  loadKioskRuntimeConfig,
} from '../utils/siteConfig'
import {
  getKioskPricing,
  parsePageRange,
} from '../utils/printSettingsUtils'
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
  upiQrValue?: string
  paymentUrl?: string
  upiIntentUrl?: string
  merchantUpiId?: string
  gateway?: string
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
    sublabel: 'Customer is reviewing document on mobile…',
    step: 2,
    icon: '📄',
    color: '#dc2626',
  },
  CONFIGURING: {
    label: 'Print Settings',
    sublabel: 'Customer is configuring options on mobile…',
    step: 3,
    icon: '⚙',
    color: '#dc2626',
  },
  REVIEWING: {
    label: 'Reviewing Order',
    sublabel: 'Customer is reviewing order on mobile…',
    step: 4,
    icon: '📋',
    color: '#dc2626',
  },
  PAYING: {
    label: 'Pay & Print',
    sublabel: 'Scan the UPI QR code below to complete your order',
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
  const kioskId = getKioskId()
  const kioskName = getKioskName()
  const apiUrl = getKioskApiUrl()
  const { siteUrl } = useKioskSiteUrl(apiUrl, kioskId)

  // Immediate non-null session: initialized with empty token and qrUrl so that
  // we NEVER display a stale or constant sessionless QR while creating the session
  const [session, setSession] = useState<LiveSession>(() => {
    const kid = getKioskId()
    return {
      sessionId: `init-${kid}`,
      token: '',
      qrUrl: '',
      state: 'QR_READY',
      phase: 'Scan QR to start uploading',
      phaseStep: 0,
      expiresAt: Date.now() + 300000,
      createdAt: Date.now(),
    }
  })

  const [timeLeft, setTimeLeft] = useState(300)
  const [stateChanged, setStateChanged] = useState(false)
  const [isActionPending, setIsActionPending] = useState(false)
  const [activeStateOverride, setActiveStateOverride] = useState<SessionState | null>(null)

  // Interactive UI Selection States on Touchscreen
  const [activePageIdx, setActivePageIdx] = useState(0)
  const [selectedColour, setSelectedColour] = useState<'BW' | 'COLOUR'>('BW')
  const [selectedDuplex, setSelectedDuplex] = useState<'SINGLE' | 'DOUBLE'>('SINGLE')
  const [selectedCopies, setSelectedCopies] = useState(1)
  const [selectedPageRange, setSelectedPageRange] = useState('ALL')
  const [printingProgress, setPrintingProgress] = useState(0)

  // Enhanced & Per-Page Customization State
  const [settingsMode, setSettingsMode] = useState<'GLOBAL' | 'PER_PAGE'>('GLOBAL')
  const [nUpLayout, setNUpLayout] = useState<1 | 2 | 4>(1)
  const [duplexBinding, setDuplexBinding] = useState<'LONG_EDGE' | 'SHORT_EDGE'>('LONG_EDGE')
  const [printDpi, setPrintDpi] = useState<'600' | '1200'>('600')
  const [paperWeight, setPaperWeight] = useState<'75GSM' | '100GSM'>('75GSM')
  const [pageCustomizations, setPageCustomizations] = useState<Record<number, {
    colour: 'BW' | 'COLOUR'
    skipped: boolean
    orientation: 'PORTRAIT' | 'LANDSCAPE'
  }>>({})

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const rotateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)

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

          setSession({
            sessionId: s.sessionId || data.sessionId,
            token: resolvedToken,
            qrUrl: resolvedQrUrl,
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
    if (typeof window !== 'undefined' && window.location.search) {
      const url = new URL(window.location.href)
      if (url.searchParams.has('state') || url.searchParams.has('devState')) {
        url.searchParams.delete('state')
        url.searchParams.delete('devState')
        window.history.replaceState({}, '', url.pathname + (url.search ? url.search : ''))
      }
    }
  }, [])

  const handleCancelAndNewUpload = useCallback(async () => {
    clearUrlStateParam()
    setActiveStateOverride(null)
    setIsActionPending(true)
    setSession(prev => prev ? {
      ...prev,
      state: 'QR_READY',
      document: undefined,
      fileName: undefined,
      totalPages: undefined,
      settings: undefined,
    } : null)
    setActivePageIdx(0)
    setSelectedCopies(1)
    setSelectedColour('BW')
    setSelectedDuplex('SINGLE')
    setSelectedPageRange('ALL')
    setPrintingProgress(0)

    try {
      if (session?.sessionId && !session.sessionId.startsWith('init-')) {
        try {
          await fetch(`${apiUrl}/api/kiosk-sessions/${encodeURIComponent(session.sessionId)}/cancel`, {
            method: 'POST',
          })
        } catch {
          if (typeof window !== 'undefined' && window.location.origin !== apiUrl) {
            try {
              await fetch(`/api/kiosk-sessions/${encodeURIComponent(session.sessionId)}/cancel`, {
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
  }, [session?.sessionId, apiUrl, createSession, clearUrlStateParam])

  const handleExecutePrint = useCallback(async () => {
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
        const effectiveToken = (s.token || session?.token || '').trim()
        const effectiveBaseUrl = (siteUrl || getKioskSiteUrl()).replace(/\/+$/, '')

        let effectiveQrUrl = ''
        if (s.qrUrl && s.qrUrl.includes('&session=') && !s.qrUrl.includes('session=init')) {
          effectiveQrUrl = s.qrUrl
        } else if (effectiveToken && effectiveToken !== 'init') {
          effectiveQrUrl = `${effectiveBaseUrl}/print?id=${encodeURIComponent(kioskId)}&session=${encodeURIComponent(effectiveToken)}`
        }

        setSession(prev => {
          if (!prev) return { ...s, qrUrl: effectiveQrUrl, token: effectiveToken }
          if (prev.state !== s.state) {
            setStateChanged(true)
            setTimeout(() => setStateChanged(false), 500)
          }
          return {
            ...prev,
            ...s,
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

        if (s.state === 'CANCELLED') {
          handleCancelAndNewUpload()
        }

        if (data.isExpired && s.state === 'QR_READY') {
          createSession(true)
        }
      } catch {}
    }

    pollRef.current = setInterval(poll, 1500)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [session?.sessionId, session?.token, apiUrl, kioskId, siteUrl, createSession, handleCancelAndNewUpload])

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
      if (session.settings.settingsMode) setSettingsMode(session.settings.settingsMode as any)
      if (session.settings.nUpLayout) setNUpLayout(session.settings.nUpLayout as any)
      if (session.settings.duplexBinding) setDuplexBinding(session.settings.duplexBinding as any)
      if (session.settings.printDpi) setPrintDpi(session.settings.printDpi as any)
      if (session.settings.paperWeight) setPaperWeight(session.settings.paperWeight as any)
      if (session.settings.pageCustomizations) setPageCustomizations(session.settings.pageCustomizations as any)
    } else if (session?.colourMode) {
      setSelectedColour(session.colourMode === 'COLOUR' ? 'COLOUR' : 'BW')
    }
  }, [session?.settings, session?.colourMode])

  // ── Dynamic Pricing Calculation with Per-Page & Eco Savings ───────────────

  const pageCount = session?.document?.pageCount || session?.totalPages || (session?.document?.pages?.length) || 1

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
      const activePages = parsePageRange(selectedPageRange, pageCount)
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

    // Rates dynamically derived from live station pricing
    const isDouble = selectedDuplex === 'DOUBLE'
    const bwRate = isDouble ? (pricing.bwDouble / 2) : pricing.bwSingle
    const colourRate = isDouble ? (pricing.colorDouble / 2) : pricing.colorSingle

    // Multipliers
    const dpiMultiplier = printDpi === '1200' ? 1.2 : 1.0
    const paperSurcharge = paperWeight === '100GSM' ? 1.0 : 0.0

    // Subtotal
    const baseCostPerCopy = (bwCount * bwRate) + (colourCount * colourRate)
    const paperCostPerCopy = sheetsPerCopy * paperSurcharge
    const subtotalPerCopy = (baseCostPerCopy * dpiMultiplier) + paperCostPerCopy
    const calculatedTotal = Math.max(2, Math.round(subtotalPerCopy * selectedCopies))

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
      bwRate,
      colourRate,
      pricing,
    }
  }, [pageCount, pageCustomizations, settingsMode, selectedColour, selectedDuplex, nUpLayout, selectedCopies, printDpi, paperWeight, selectedPageRange])

  const totalAmount = pageDetails.calculatedTotal
  const calculatedSheets = pageDetails.sheetsPerCopy

  // ── Derived State ────────────────────────────────────────────────────────

  const searchParamState = typeof window !== 'undefined'
    ? (new URLSearchParams(window.location.search).get('devState') || new URLSearchParams(window.location.search).get('state')) as SessionState | null
    : null
  const rawState = activeStateOverride || searchParamState || session?.state || 'QR_READY'
  // If document was uploaded, but backend state is still transitioning, show CONFIRMING
  const state: SessionState = (rawState === 'CLAIMED' || rawState === 'UPLOADING') && session?.document
    ? 'CONFIRMING'
    : rawState

  const phase = PHASES[state || 'QR_READY'] || PHASES.QR_READY
  const isWaiting = state === 'QR_READY'
  const isOtpReady = state === 'OTP_READY'
  const isPrinting = state === 'PRINTING'
  const isDone = state === 'DONE'

  // User is in "connected phone or above step" (Phone Connected, Review Document, Print Settings, Payment)
  const isConnectedOrAbove = !isWaiting && !isPrinting && !isDone


  const qrDisplayValue = useMemo(() => {
    // 1. Explicit unique session QR URL containing cryptographic session token
    if (session?.qrUrl && session.qrUrl.includes('&session=') && !session.qrUrl.includes('session=init')) {
      return session.qrUrl
    }
    // 2. Synthesize using active cryptographic session token
    if (session?.token && session.token !== 'init') {
      const base = (siteUrl || getKioskSiteUrl()).replace(/\/+$/, '')
      return `${base}/print?id=${encodeURIComponent(kioskId)}&session=${encodeURIComponent(session.token)}`
    }
    // 3. While initializing, return empty string so loading state renders instead of a constant sessionless QR
    return ''
  }, [session?.qrUrl, session?.token, siteUrl, kioskId])

  // Current document and previews
  const doc = session?.document
  const docFileName = doc?.fileName || session?.fileName || 'Document.pdf'
  const docPages = doc?.pages || []
  const activePageUrl = docPages[activePageIdx]?.url || docPages[0]?.url

  // Auto-cycle through document pages smoothly on zero-touch kiosk display
  useEffect(() => {
    if (pageCount <= 1) {
      setActivePageIdx(0)
      return
    }
    const timer = setInterval(() => {
      setActivePageIdx(prev => (prev + 1) % pageCount)
    }, 3500)
    return () => clearInterval(timer)
  }, [pageCount])

  // Dynamic UPI URL for payment QR code generated by merchant UPI Express key
  const effectiveOrderId = session?.orderId || `ORD-${Date.now().toString().slice(-6)}`
  const upiQrValue = useMemo(() => {
    if (session?.upiQrValue) return session.upiQrValue
    if (session?.upiIntentUrl) return session.upiIntentUrl
    if (session?.paymentUrl) return session.paymentUrl
    const vpa = session?.merchantUpiId || 'printbooth@okaxis'
    return `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(kioskName)}&am=${totalAmount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(effectiveOrderId)}`
  }, [session?.upiQrValue, session?.upiIntentUrl, session?.paymentUrl, session?.merchantUpiId, kioskName, totalAmount, effectiveOrderId])

  // If in PAYING state but UPI Express QR is not yet populated, auto-request it
  useEffect(() => {
    if (state === 'PAYING' && session?.sessionId && !session?.upiQrValue && !session.sessionId.startsWith('init-')) {
      fetch(`${apiUrl}/api/kiosk-sessions/${encodeURIComponent(session.sessionId)}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: totalAmount }),
      })
        .then(r => r.json())
        .then(data => {
          if (data && data.success && (data.upiQrValue || data.session?.upiQrValue)) {
            setSession(prev => prev ? {
              ...prev,
              orderId: data.orderId || prev.orderId,
              otp: data.otp || prev.otp,
              upiQrValue: data.upiQrValue || data.session?.upiQrValue,
              paymentUrl: data.paymentUrl || data.session?.paymentUrl,
              upiIntentUrl: data.upiIntentUrl || data.session?.upiIntentUrl,
              merchantUpiId: data.merchantUpiId || data.session?.merchantUpiId,
              gateway: data.session?.gateway || 'upiexpress',
            } : null)
          }
        })
        .catch(() => {})
    }
  }, [state, session?.sessionId, session?.upiQrValue, apiUrl, totalAmount])

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

  const renderStepTabs = (currentStep: 'UPLOADING' | 'CONFIRMING' | 'CONFIGURING' | 'REVIEWING' | 'PAYING') => {
    const steps = [
      { id: 'UPLOADING', num: 1, label: 'Upload' },
      { id: 'CONFIRMING', num: 2, label: 'Review Document' },
      { id: 'CONFIGURING', num: 3, label: 'Print Options' },
      { id: 'REVIEWING', num: 4, label: 'Review Order' },
      { id: 'PAYING', num: 5, label: 'Pay & Dispense' },
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

  const renderDocumentPreviewBox = () => (
    <div className="ks-flow-left">
      <div className="ks-preview-wrap">
        {activePageUrl ? (
          <img
            src={activePageUrl}
            alt={`Page ${activePageIdx + 1} of ${pageCount}`}
            className="ks-preview-img"
          />
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

        {/* Floating Page Badge */}
        <div className="ks-preview-page-badge">
          <span className="ks-auto-cycle-dot" />
          <span>Page {activePageIdx + 1} of {pageCount}</span>
        </div>
      </div>

      {/* Horizontal thumbnail gallery of all uploaded pages */}
      {pageCount > 1 && (
        <div className="ks-gallery-strip">
          {Array.from({ length: pageCount }).map((_, idx) => {
            const thumbUrl = docPages[idx]?.url
            const isActive = idx === activePageIdx
            return (
              <div
                key={idx}
                className={`ks-gallery-thumb-item ${isActive ? 'ks-gallery-thumb-item--active' : ''}`}
              >
                <div className="ks-gallery-thumb-img-wrap">
                  {thumbUrl ? (
                    <img src={thumbUrl} alt={`Page ${idx + 1}`} className="ks-gallery-thumb-img" />
                  ) : (
                    <span style={{ fontSize: 14 }}>📄</span>
                  )}
                </div>
                <span className="ks-gallery-thumb-num">P.{idx + 1}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  return (
    <div className="ks-root">
      {/* Ambient Red & White Mesh Lighting */}
      <div className="ks-bg-mesh" />

      {/* Top Status Bar */}
      <header className="ks-topbar">
        <div className="ks-topbar-pill">
          <img src="/logo.png" alt="PrintBooth" style={{ width: 18, height: 18, objectFit: 'contain' }} />
          <span className="ks-topbar-dot" />
          <span>{kioskId} • {kioskName}</span>
        </div>
        {isConnectedOrAbove && (
          <div className="ks-topbar-right-group">
            <div className="ks-topbar-pill ks-topbar-right">
              <span className="ks-topbar-state-dot" style={{ background: phase.color }} />
              <span style={{ color: phase.color, fontWeight: 700 }}>{phase.label}</span>
            </div>
          </div>
        )}
      </header>

      {/* Main Container */}
      <main className={`ks-main ${stateChanged ? 'ks-transition' : ''}`}>

        {/* ── STEP 0: IDLE QR Code Display (Scanner in Middle, Zero Buttons) ── */}
        {isWaiting && (
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
                    size={260}
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

              {/* Unique Session Active verification badge */}
              {session?.token && session.token !== 'init' && (
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 12px',
                  borderRadius: 999,
                  background: 'rgba(22, 163, 74, 0.08)',
                  border: '1px solid rgba(22, 163, 74, 0.2)',
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#16a34a',
                  marginTop: -6,
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16a34a' }} />
                  <span>Unique Session Active</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── STEP 1: Phone Connected & Uploading State ── */}
        {(state === 'CLAIMED' || state === 'UPLOADING') && !doc && (
          <div className="ks-flow-panel" style={{ width: '100%', maxWidth: '820px' }}>
            <div className="ks-interactive-panel" style={{ width: '100%' }}>
              {renderStepTabs('UPLOADING')}
              <div style={{ padding: '36px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 16 }}>
                <div className="ks-phase-icon-wrap" style={{ background: 'rgba(220, 38, 38, 0.1)', color: '#dc2626', width: 68, height: 68, borderRadius: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 36 }}>📲</span>
                </div>
                <div>
                  <h2 style={{ fontSize: 24, fontWeight: 800, color: '#dc2626', margin: '0 0 6px' }}>Phone Connected</h2>
                  <p style={{ fontSize: 14, color: '#475569', margin: 0 }}>Please select and upload your document on your mobile screen.</p>
                </div>
                <div className="ks-companion-status-pill" style={{ marginTop: 8 }}>
                  <span className="ks-companion-dot" />
                  <span>Zero Touch • Document will appear here once uploaded</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── SECTION 1: Review Document (CONFIRMING) ── */}
        {state === 'CONFIRMING' && (
          <div className="ks-interactive-panel">
            {renderStepTabs('CONFIRMING')}
            <div className="ks-flow-body">
              {/* Left Column: Real Page Preview & Gallery */}
              {renderDocumentPreviewBox()}

              {/* Right Column: Specs & Zero-Touch Companion Card */}
              <div className="ks-flow-right" style={{ justifyContent: 'space-between', gap: 16 }}>
                <div>
                  <h3 className="ks-summary-title">Document Received</h3>
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
                      <span>Colour Options</span>
                      <strong>B&amp;W or Colour Available</strong>
                    </div>
                  </div>
                </div>

                <div className="ks-companion-card">
                  <div className="ks-companion-card-header">
                    <div className="ks-companion-card-icon">📱</div>
                    <div>
                      <div className="ks-companion-card-title">Reviewing Document on Mobile</div>
                      <div className="ks-companion-card-sub">Please review and confirm pages on your phone screen. No touch required on this display.</div>
                    </div>
                  </div>
                  <div className="ks-companion-status-pill">
                    <span className="ks-companion-dot" />
                    <span>Continue on phone to Print Options →</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── SECTION 2: Print Settings (CONFIGURING) ── */}
        {state === 'CONFIGURING' && (
          <div className="ks-interactive-panel">
            {renderStepTabs('CONFIGURING')}
            <div className="ks-flow-body">
              {/* Left Column: Real Page Preview & Gallery */}
              {renderDocumentPreviewBox()}

              {/* Right Column: Mirrored Settings & Specs */}
              <div className="ks-flow-right" style={{ justifyContent: 'space-between', gap: 16 }}>
                <div>
                  <h3 className="ks-summary-title" style={{ marginBottom: 12 }}>Mirrored Print Options</h3>
                  <div className="ks-mirrored-grid">
                    <div className="ks-mirror-card">
                      <span className="ks-mirror-label">Color Mode</span>
                      <strong className="ks-mirror-val" style={{ color: selectedColour === 'COLOUR' ? '#dc2626' : '#09090b' }}>
                        {selectedColour === 'COLOUR' ? 'Full Colour' : 'Black & White'}
                      </strong>
                      <span className="ks-mirror-sub">{selectedColour === 'COLOUR' ? 'High Quality' : 'Monochrome Laser'}</span>
                    </div>
                    <div className="ks-mirror-card">
                      <span className="ks-mirror-label">Sides</span>
                      <strong className="ks-mirror-val">
                        {selectedDuplex === 'DOUBLE' ? '2-Sided' : '1-Sided'}
                      </strong>
                      <span className="ks-mirror-sub">{selectedDuplex === 'DOUBLE' ? (duplexBinding === 'SHORT_EDGE' ? 'Short Edge Flip' : 'Long Edge Flip') : 'Single Sided'}</span>
                    </div>
                    <div className="ks-mirror-card">
                      <span className="ks-mirror-label">Copies</span>
                      <strong className="ks-mirror-val">{selectedCopies} {selectedCopies === 1 ? 'Copy' : 'Copies'}</strong>
                      <span className="ks-mirror-sub">{calculatedSheets * selectedCopies} Total Sheets</span>
                    </div>
                    <div className="ks-mirror-card">
                      <span className="ks-mirror-label">Paper Tray</span>
                      <strong className="ks-mirror-val" style={{ color: '#16a34a' }}>A4 75GSM</strong>
                      <span className="ks-mirror-sub">Standard Tray Ready</span>
                    </div>
                  </div>

                  <div className="ks-total-banner" style={{ marginTop: 14 }}>
                    <span className="ks-total-label">Estimated Total</span>
                    <span className="ks-total-price">₹{totalAmount.toFixed(2)}</span>
                  </div>
                </div>

                <div className="ks-companion-card">
                  <div className="ks-companion-card-header">
                    <div className="ks-companion-card-icon">⚙️</div>
                    <div>
                      <div className="ks-companion-card-title">Configuring Options on Mobile</div>
                      <div className="ks-companion-card-sub">Select copies, colours, and sides on your phone screen. Selections reflect here in real time.</div>
                    </div>
                  </div>
                  <div className="ks-companion-status-pill">
                    <span className="ks-companion-dot" />
                    <span>Zero Touch • Continue on phone screen</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── SECTION 3: Review Order (REVIEWING) ── */}
        {state === 'REVIEWING' && (
          <div className="ks-interactive-panel">
            {renderStepTabs('REVIEWING')}
            <div className="ks-flow-body">
              {/* Left Column: Real Page Preview & Gallery */}
              {renderDocumentPreviewBox()}

              {/* Right Column: Order Breakdown & Next Step Callout */}
              <div className="ks-flow-right" style={{ justifyContent: 'space-between', gap: 16 }}>
                <div>
                  <h3 className="ks-summary-title">Order Breakdown</h3>
                  <div className="ks-summary-table">
                    <div className="ks-summary-row">
                      <span>Document</span>
                      <strong style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{docFileName}</strong>
                    </div>
                    <div className="ks-summary-row">
                      <span>Print Configuration</span>
                      <strong>{selectedColour === 'COLOUR' ? 'Colour' : 'B&W'} • {selectedCopies} copy • {calculatedSheets * selectedCopies} sheets</strong>
                    </div>
                    <div className="ks-summary-row">
                      <span>Paper</span>
                      <strong>A4 75GSM Plain Paper</strong>
                    </div>
                    <div className="ks-summary-row">
                      <span>Station ID</span>
                      <strong style={{ fontFamily: 'var(--ks-mono)' }}>{kioskId}</strong>
                    </div>
                  </div>

                  <div className="ks-total-banner" style={{ marginTop: 14 }}>
                    <span className="ks-total-label">Payable Amount</span>
                    <span className="ks-total-price">₹{totalAmount.toFixed(2)}</span>
                  </div>
                </div>

                <div className="ks-companion-card">
                  <div className="ks-companion-card-header">
                    <div className="ks-companion-card-icon">📋</div>
                    <div>
                      <div className="ks-companion-card-title">Reviewing Order on Mobile</div>
                      <div className="ks-companion-card-sub">Please review the order details on your phone and tap Pay to show the payment QR code here.</div>
                    </div>
                  </div>
                  <div className="ks-companion-status-pill">
                    <span className="ks-companion-dot" />
                    <span>Awaiting continue from phone…</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── SECTION 4: Payment & UPI QR (PAYING) ── */}
        {state === 'PAYING' && (
          <div className="ks-interactive-panel">
            {renderStepTabs('PAYING')}
            <div className="ks-flow-body">
              {/* Left Column: Order Breakdown & Hardware Dispense Notice */}
              <div className="ks-flow-left" style={{ justifyContent: 'space-between' }}>
                <div>
                  <h3 className="ks-summary-title">Payment Due</h3>
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
                      <span>Prints</span>
                      <strong>{selectedColour === 'COLOUR' ? 'Colour' : 'B&W'} • {selectedCopies} copy • {calculatedSheets * selectedCopies} sheets</strong>
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
                    The moment UPI payment is received via webhook, printing starts automatically on the laser printer below. No touch or PIN required!
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
                        size={230}
                        level="M"
                        includeMargin={false}
                        fgColor="#09090b"
                        bgColor="#ffffff"
                      />
                    ) : (
                      <div style={{ width: 230, height: 230, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                        <div className="ks-qr-spinner" />
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>Generating QR…</span>
                      </div>
                    )}
                  </div>

                  <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>UPI Express Gateway</span>
                    <span style={{ color: '#cbd5e1' }}>•</span>
                    <span style={{ color: '#16a34a' }}>GPay • PhonePe • Paytm • Any UPI</span>
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
                    <span>Listening for payment confirmation…</span>
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

            <div className="ks-companion-status-pill" style={{ marginTop: 14 }}>
              <span className="ks-companion-dot" />
              <span>Zero Touch • Release code active</span>
            </div>
          </div>
        )}

      </main>
    </div>
  )
}
