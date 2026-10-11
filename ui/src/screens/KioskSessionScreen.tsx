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
import {
  getKioskPricing,
  parsePageRange,
} from '../utils/printSettingsUtils'
import KioskWebPrintSettings from '../components/KioskWebPrintSettings'
import './KioskSessionScreen.css'

// ─── Inactivity Constants (Auto-Return to Print from Phone) ─────────────────
const INACTIVITY_TIMEOUT_MS = 90 * 1000 // 1 minute 30 seconds
const INACTIVITY_WARNING_SECONDS = 15 // warning popup at 15s remaining (75s elapsed)

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
  const [copiedUrl, setCopiedUrl] = useState(false)

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

        if (data.isExpired && s.state === 'QR_READY') {
          createSession(true)
        }
      } catch {}
    }

    pollRef.current = setInterval(poll, 1500)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [session?.sessionId, session?.token, apiUrl, kioskId, siteUrl, createSession])

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

  const pageCount = session?.document?.pageCount || session?.totalPages || 5

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
          pricePerPage: pageDetails.bwRate,
          totalAmount,
          settingsMode,
          nUpLayout,
          duplexBinding,
          printDpi,
          paperWeight,
          pageCustomizations,
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
          pricePerPage: pageDetails.bwRate,
          totalAmount,
          settingsMode,
          nUpLayout,
          duplexBinding,
          printDpi,
          paperWeight,
          pageCustomizations,
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

  const handleCancelAndNewUpload = useCallback(async () => {
    setIsActionPending(true)
    // Instantly reset UI state so screen switches immediately without waiting for network lag
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
  }, [session?.sessionId, apiUrl, createSession])

  // ── Derived State ────────────────────────────────────────────────────────

  const searchParamState = typeof window !== 'undefined'
    ? (new URLSearchParams(window.location.search).get('devState') || new URLSearchParams(window.location.search).get('state')) as SessionState | null
    : null
  const rawState = searchParamState || session?.state || 'QR_READY'
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

  // ── Inactivity Auto-Back Timer (90s total, warning at 15s) ───────────────────
  const [inactivityRemaining, setInactivityRemaining] = useState<number | null>(null)
  const lastInteractionTimeRef = useRef<number>(Date.now())

  const resetInactivityTimer = useCallback(() => {
    lastInteractionTimeRef.current = Date.now()
    setInactivityRemaining(null)
  }, [])

  useEffect(() => {
    if (!isConnectedOrAbove) {
      setInactivityRemaining(null)
      return
    }

    lastInteractionTimeRef.current = Date.now()

    const handleUserActivity = () => {
      lastInteractionTimeRef.current = Date.now()
      setInactivityRemaining(prev => prev !== null ? null : prev)
    }

    window.addEventListener('touchstart', handleUserActivity, { passive: true })
    window.addEventListener('touchmove', handleUserActivity, { passive: true })
    window.addEventListener('mousedown', handleUserActivity, { passive: true })
    window.addEventListener('click', handleUserActivity, { passive: true })
    window.addEventListener('keydown', handleUserActivity, { passive: true })

    const interval = setInterval(() => {
      const elapsed = Date.now() - lastInteractionTimeRef.current
      const remaining = Math.max(0, Math.ceil((INACTIVITY_TIMEOUT_MS - elapsed) / 1000))

      if (remaining <= 0) {
        clearInterval(interval)
        setInactivityRemaining(null)
        handleCancelAndNewUpload()
      } else if (remaining <= INACTIVITY_WARNING_SECONDS) {
        setInactivityRemaining(remaining)
      } else {
        setInactivityRemaining(null)
      }
    }, 500)

    return () => {
      clearInterval(interval)
      window.removeEventListener('touchstart', handleUserActivity)
      window.removeEventListener('touchmove', handleUserActivity)
      window.removeEventListener('mousedown', handleUserActivity)
      window.removeEventListener('click', handleUserActivity)
      window.removeEventListener('keydown', handleUserActivity)
    }
  }, [isConnectedOrAbove, handleCancelAndNewUpload])

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

  const localTestUrl = useMemo(() => {
    if (session?.token && session.token !== 'init') {
      return `http://localhost:5200/print?id=${encodeURIComponent(kioskId)}&session=${encodeURIComponent(session.token)}`
    }
    return ''
  }, [kioskId, session?.token])

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
        {isConnectedOrAbove && (
          <div className="ks-topbar-right-group">
            <div className="ks-topbar-pill ks-topbar-right">
              <span className="ks-topbar-state-dot" style={{ background: phase.color }} />
              <span style={{ color: phase.color, fontWeight: 700 }}>{phase.label}</span>
            </div>

            {/* Always-Visible Cancel Button on Connected Phone or above step */}
            <button
              type="button"
              className="ks-always-cancel-btn"
              onClick={handleCancelAndNewUpload}
              disabled={isActionPending}
              id="kiosk-always-cancel-btn"
              title="Cancel session and return to Print from Phone"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
              <span>Cancel Order</span>
            </button>
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

              {/* Temp Test URL Box for Laptop Testing */}
              {qrDisplayValue && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 12,
                    padding: '8px 12px',
                    width: '100%',
                    maxWidth: '440px',
                    boxSizing: 'border-box',
                    fontSize: 12,
                    color: '#475569',
                    marginTop: 4,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                    <span style={{ fontWeight: 800, color: '#dc2626', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>
                      Session URL:
                    </span>
                    <a
                      href={localTestUrl || qrDisplayValue}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        fontFamily: 'monospace',
                        fontSize: 11,
                        color: '#0284c7',
                        textDecoration: 'underline',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                        textAlign: 'left',
                      }}
                      title={localTestUrl || qrDisplayValue}
                    >
                      {localTestUrl || qrDisplayValue}
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        if (navigator.clipboard) {
                          navigator.clipboard.writeText(localTestUrl || qrDisplayValue)
                          setCopiedUrl(true)
                          setTimeout(() => setCopiedUrl(false), 2000)
                        }
                      }}
                      style={{
                        border: '1px solid #cbd5e1',
                        background: copiedUrl ? '#16a34a' : '#ffffff',
                        color: copiedUrl ? '#ffffff' : '#334155',
                        borderRadius: 6,
                        padding: '4px 10px',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                        flexShrink: 0,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {copiedUrl ? 'Copied!' : 'Copy'}
                    </button>
                  </div>

                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', width: '100%' }}>
                    {localTestUrl && (
                      <button
                        type="button"
                        onClick={() => window.open(localTestUrl, '_blank')}
                        style={{
                          border: '1px solid #16a34a',
                          background: '#16a34a',
                          color: '#ffffff',
                          borderRadius: 6,
                          padding: '4px 10px',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                        title="Open in local dev web app (http://localhost:5200)"
                      >
                        Open Local (Port 5200) ↗
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => window.open(qrDisplayValue, '_blank')}
                      style={{
                        border: '1px solid #dc2626',
                        background: '#dc2626',
                        color: '#ffffff',
                        borderRadius: 6,
                        padding: '4px 10px',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                      title="Open in production domain (printbooth.co.in)"
                    >
                      Open Prod Domain ↗
                    </button>
                  </div>
                </div>
              )}

              {/* Direct PIN Keypad Switch */}
              <button
                type="button"
                className="ks-pin-switch-btn"
                onClick={() => navigate('/pin')}
                id="kiosk-switch-to-pin"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span>Already Have a PIN? Enter on Keypad</span>
              </button>
            </div>
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
                <div style={{ marginTop: 16 }}>
                  <button
                    type="button"
                    className="ks-inline-cancel-btn"
                    onClick={handleCancelAndNewUpload}
                    disabled={isActionPending}
                    id="ks-cancel-phone-connected"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                    <span>Cancel Connection &amp; Reset to Print from Phone</span>
                  </button>
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
                      <strong>₹{pageDetails.pricing.bwSingle.toFixed(2)} / page (B&amp;W)</strong>
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
                    onClick={handleCancelAndNewUpload}
                    disabled={isActionPending}
                    id="ks-cancel-new-upload-btn"
                  >
                    Cancel / New Upload
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── SECTION 2: Print Settings (CONFIGURING) ── */}
        {/* ── SECTION 2: Print Settings (CONFIGURING) — Same Web Settings Optimized for Pi ── */}
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

            <KioskWebPrintSettings
              fileName={docFileName}
              totalPages={pageCount}
              initialSettings={{
                colour: selectedColour,
                duplex: selectedDuplex,
                copies: selectedCopies,
                pages: selectedPageRange,
              }}
              onSettingsChange={(newSettings) => {
                setSelectedColour(newSettings.colour)
                setSelectedDuplex(newSettings.duplex)
                setSelectedCopies(newSettings.copies)
                setSelectedPageRange(newSettings.pages)
              }}
              onProceed={() => handleProceedToPayment()}
              onBack={handleBackToConfirm}
              onCancel={handleCancelAndNewUpload}
              proceedLabel="Proceed to Payment →"
              isActionPending={isActionPending}
              kioskId={kioskId}
              kioskName={kioskName}
              showTopbar={false}
            />
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

                  <button
                    type="button"
                    className="ks-btn-secondary"
                    onClick={handleCancelAndNewUpload}
                    disabled={isActionPending}
                    style={{ color: '#dc2626' }}
                    id="ks-cancel-from-pay"
                  >
                    Cancel / New Upload
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

      {/* Footer — shown during DONE to avoid colliding with campaign bar */}
      {state === 'DONE' && (
        <footer className="ks-footer">
          <span>Hardware Engine: <strong>Brother DCP-T420W</strong></span>
          <span>•</span>
          <span>Telemetry: <code>ONLINE</code></span>
          <span>•</span>
          <span>Paper: <code>A4 75GSM</code></span>
        </footer>
      )}

      {/* ── 15-SECOND INACTIVITY NOTICE MODAL (Stops auto-cancelling order) ── */}
      {inactivityRemaining !== null && (
        <div
          className="ks-inactivity-modal-backdrop"
          onClick={resetInactivityTimer}
          role="alertdialog"
          aria-modal="true"
        >
          <div
            className="ks-inactivity-modal-card"
            onClick={(e) => {
              e.stopPropagation()
              resetInactivityTimer()
            }}
          >
            <div className="ks-inactivity-icon-wrap">
              <span className="ks-inactivity-pulse-ring" />
              <span className="ks-inactivity-icon">⏳</span>
            </div>

            <div className="ks-inactivity-countdown-badge">
              <span className="ks-inactivity-countdown-num">{inactivityRemaining}</span>
              <span className="ks-inactivity-countdown-unit">SECONDS</span>
            </div>

            <h2 className="ks-inactivity-title">Are you still there?</h2>
            <p className="ks-inactivity-desc">
              No interaction detected. To protect your document privacy and clear the kiosk, your order will be cancelled and reset in <strong>{inactivityRemaining} seconds</strong>.
            </p>

            <div className="ks-inactivity-actions">
              <button
                type="button"
                className="ks-inactivity-btn-keep"
                onClick={resetInactivityTimer}
                id="ks-inactivity-keep-session"
              >
                <span>✓ Keep Session &amp; Continue</span>
              </button>

              <button
                type="button"
                className="ks-inactivity-btn-cancel"
                onClick={(e) => {
                  e.stopPropagation()
                  setInactivityRemaining(null)
                  handleCancelAndNewUpload()
                }}
                id="ks-inactivity-cancel-now"
              >
                <span>✕ Cancel Order Now</span>
              </button>
            </div>

            <p className="ks-inactivity-subhint">
              👉 Tap anywhere on the screen to stay on this page
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
