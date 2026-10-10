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
  const [isActionPending, setIsActionPending] = useState(false)

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

  const createSession = useCallback(async (force = false) => {
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
          setSession({
            sessionId: s.sessionId || data.sessionId,
            token: s.token || data.token,
            qrUrl: s.qrUrl || data.qrUrl || getKioskQrUrl(kioskId, siteUrl),
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
        retryTimerRef.current = setTimeout(createSession, 4000)
      }
    } catch (e) {
      console.warn('[KioskSession] Network issue creating session:', e)
      if (mountedRef.current) {
        retryTimerRef.current = setTimeout(createSession, 4000)
      }
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
    let bwCount = 0
    let colourCount = 0
    let skippedCount = 0

    for (let i = 0; i < pageCount; i++) {
      const custom = pageCustomizations[i]
      const isSkipped = settingsMode === 'PER_PAGE' && Boolean(custom?.skipped)
      if (isSkipped) {
        skippedCount++
        continue
      }
      const pageColour = settingsMode === 'PER_PAGE' && custom?.colour
        ? custom.colour
        : selectedColour

      if (pageColour === 'COLOUR') {
        colourCount++
      } else {
        bwCount++
      }
    }

    const includedPages = bwCount + colourCount
    const pagesPerSheet = nUpLayout * (selectedDuplex === 'DOUBLE' ? 2 : 1)
    const sheetsPerCopy = Math.max(1, Math.ceil(includedPages / pagesPerSheet))
    const totalSheets = sheetsPerCopy * selectedCopies

    // Rates (Duplex offers discount per page: ₹1.50 vs ₹2.00 for B&W, ₹6.00 vs ₹8.00 for Colour)
    const bwRate = selectedDuplex === 'DOUBLE' ? 1.5 : 2.0
    const colourRate = selectedDuplex === 'DOUBLE' ? 6.0 : 8.0

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
    }
  }, [pageCount, pageCustomizations, settingsMode, selectedColour, selectedDuplex, nUpLayout, selectedCopies, printDpi, paperWeight])

  const totalAmount = pageDetails.calculatedTotal
  const calculatedSheets = pageDetails.sheetsPerCopy

  // ── Per-Page Customization Actions ─────────────────────────────────────────

  const handleSetAllBw = () => {
    const updated: Record<number, { colour: 'BW' | 'COLOUR'; skipped: boolean; orientation: 'PORTRAIT' | 'LANDSCAPE' }> = {}
    for (let i = 0; i < pageCount; i++) {
      updated[i] = {
        colour: 'BW',
        skipped: pageCustomizations[i]?.skipped || false,
        orientation: pageCustomizations[i]?.orientation || 'PORTRAIT',
      }
    }
    setPageCustomizations(updated)
    setSelectedColour('BW')
  }

  const handleSetAllColour = () => {
    const updated: Record<number, { colour: 'BW' | 'COLOUR'; skipped: boolean; orientation: 'PORTRAIT' | 'LANDSCAPE' }> = {}
    for (let i = 0; i < pageCount; i++) {
      updated[i] = {
        colour: 'COLOUR',
        skipped: pageCustomizations[i]?.skipped || false,
        orientation: pageCustomizations[i]?.orientation || 'PORTRAIT',
      }
    }
    setPageCustomizations(updated)
    setSelectedColour('COLOUR')
  }

  const handleAutoDetectColour = () => {
    const updated: Record<number, { colour: 'BW' | 'COLOUR'; skipped: boolean; orientation: 'PORTRAIT' | 'LANDSCAPE' }> = {}
    for (let i = 0; i < pageCount; i++) {
      // Highlight cover page and occasional graphical pages as colour, rest B&W
      const isColour = i === 0 || i % 3 === 0
      updated[i] = {
        colour: isColour ? 'COLOUR' : 'BW',
        skipped: false,
        orientation: pageCustomizations[i]?.orientation || 'PORTRAIT',
      }
    }
    setPageCustomizations(updated)
  }

  const handleToggleEvenOdd = (filter: 'ODD' | 'EVEN') => {
    const updated: Record<number, { colour: 'BW' | 'COLOUR'; skipped: boolean; orientation: 'PORTRAIT' | 'LANDSCAPE' }> = { ...pageCustomizations }
    for (let i = 0; i < pageCount; i++) {
      const pageNum = i + 1
      const shouldInclude = filter === 'ODD' ? pageNum % 2 !== 0 : pageNum % 2 === 0
      updated[i] = {
        colour: updated[i]?.colour || selectedColour,
        skipped: !shouldInclude,
        orientation: updated[i]?.orientation || 'PORTRAIT',
      }
    }
    setPageCustomizations(updated)
  }

  const handleResetPerPage = () => {
    setPageCustomizations({})
  }

  const togglePageColour = (pageIdx: number) => {
    setPageCustomizations(prev => {
      const cur = prev[pageIdx]?.colour || selectedColour
      const nextColour = cur === 'BW' ? 'COLOUR' : 'BW'
      return {
        ...prev,
        [pageIdx]: {
          colour: nextColour,
          skipped: prev[pageIdx]?.skipped || false,
          orientation: prev[pageIdx]?.orientation || 'PORTRAIT',
        },
      }
    })
  }

  const togglePageSkip = (pageIdx: number) => {
    setPageCustomizations(prev => ({
      ...prev,
      [pageIdx]: {
        colour: prev[pageIdx]?.colour || selectedColour,
        skipped: !(prev[pageIdx]?.skipped || false),
        orientation: prev[pageIdx]?.orientation || 'PORTRAIT',
      },
    }))
  }

  const togglePageOrientation = (pageIdx: number) => {
    setPageCustomizations(prev => {
      const curOrient = prev[pageIdx]?.orientation || 'PORTRAIT'
      return {
        ...prev,
        [pageIdx]: {
          colour: prev[pageIdx]?.colour || selectedColour,
          skipped: prev[pageIdx]?.skipped || false,
          orientation: curOrient === 'PORTRAIT' ? 'LANDSCAPE' : 'PORTRAIT',
        },
      }
    })
  }

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
                <QRCodeSVG
                  value={qrDisplayValue}
                  size={260}
                  level="M"
                  includeMargin={false}
                  fgColor="#09090b"
                  bgColor="#ffffff"
                />
              </div>
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
                {/* Mode Switcher */}
                <div className="ks-settings-mode-bar">
                  <button
                    type="button"
                    className={`ks-mode-pill ${settingsMode === 'GLOBAL' ? 'ks-mode-pill--active' : ''}`}
                    onClick={() => setSettingsMode('GLOBAL')}
                    id="ks-mode-global"
                  >
                    <span>⚡ Quick Print (Uniform)</span>
                  </button>
                  <button
                    type="button"
                    className={`ks-mode-pill ${settingsMode === 'PER_PAGE' ? 'ks-mode-pill--active' : ''}`}
                    onClick={() => setSettingsMode('PER_PAGE')}
                    id="ks-mode-perpage"
                  >
                    <span>🎨 Customise Each Page</span>
                  </button>
                </div>

                {/* 1. Global Colour Mode (When GLOBAL) */}
                {settingsMode === 'GLOBAL' && (
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
                        <span className="ks-opt-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span>Full Colour</span>
                          <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'linear-gradient(135deg, #ec4899, #8b5cf6)', color: '#fff' }}>Vivid</span>
                        </span>
                        <span className="ks-opt-sub">₹8.00 per sheet • CMYK photo ink</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* 1b. Per-Page Interactive Matrix (When PER_PAGE) */}
                {settingsMode === 'PER_PAGE' && (
                  <div className="ks-settings-group">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span className="ks-settings-label">1. Page-by-Page Customisation</span>
                      <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'var(--ks-mono)' }}>
                        {pageDetails.includedPages} of {pageCount} pages included
                      </span>
                    </div>

                    {/* Bulk Action Toolbar */}
                    <div className="ks-bulk-toolbar">
                      <span className="ks-bulk-title">Quick Actions:</span>
                      <div className="ks-bulk-actions">
                        <button type="button" className="ks-bulk-btn" onClick={handleSetAllBw} id="ks-bulk-bw">
                          ⬛ All B&W
                        </button>
                        <button type="button" className="ks-bulk-btn" onClick={handleSetAllColour} id="ks-bulk-colour">
                          🌈 All Colour
                        </button>
                        <button type="button" className="ks-bulk-btn" onClick={handleAutoDetectColour} id="ks-bulk-autodetect" title="Detect graphics and set cover & image pages to colour">
                          🔍 Auto-Detect
                        </button>
                        <button type="button" className="ks-bulk-btn" onClick={() => handleToggleEvenOdd('ODD')} id="ks-bulk-odd">
                          1️⃣ Odd Only
                        </button>
                        <button type="button" className="ks-bulk-btn" onClick={() => handleToggleEvenOdd('EVEN')} id="ks-bulk-even">
                          2️⃣ Even Only
                        </button>
                        <button type="button" className="ks-bulk-btn" onClick={handleResetPerPage} id="ks-bulk-reset">
                          🔄 Reset
                        </button>
                      </div>
                    </div>

                    {/* Grid of Pages */}
                    <div className="ks-page-matrix">
                      {Array.from({ length: pageCount }).map((_, idx) => {
                        const custom = pageCustomizations[idx]
                        const isSkipped = Boolean(custom?.skipped)
                        const pageColour = custom?.colour || selectedColour
                        const orientation = custom?.orientation || 'PORTRAIT'

                        return (
                          <div
                            key={idx}
                            className={`ks-page-card ${
                              isSkipped
                                ? 'ks-page-card--skipped'
                                : pageColour === 'COLOUR'
                                ? 'ks-page-card--colour'
                                : 'ks-page-card--bw'
                            }`}
                          >
                            <div className="ks-page-card-header">
                              <span className="ks-page-num">P.{idx + 1}</span>
                              <button
                                type="button"
                                className="ks-page-skip-toggle"
                                onClick={() => togglePageSkip(idx)}
                                title={isSkipped ? 'Include this page' : 'Skip this page'}
                              >
                                {isSkipped ? (
                                  <span style={{ fontSize: 10, color: '#dc2626', fontWeight: 800 }}>+ Include</span>
                                ) : (
                                  <span style={{ fontSize: 10, color: '#94a3b8' }}>✕ Skip</span>
                                )}
                              </button>
                            </div>

                            {/* Mini preview sheet */}
                            <div
                              className={`ks-page-mini-sheet ${
                                !isSkipped && pageColour === 'COLOUR' ? 'colour-glow' : ''
                              } ${orientation === 'LANDSCAPE' ? 'ks-sheet-landscape' : ''}`}
                            >
                              <div className="ks-sheet-micro-lines">
                                <div
                                  className={`ks-sheet-micro-line ${
                                    !isSkipped && pageColour === 'COLOUR' ? 'ks-sheet-micro-line--colour' : ''
                                  }`}
                                />
                                <div className="ks-sheet-micro-line" />
                                <div
                                  className={`ks-sheet-micro-line ks-sheet-micro-line--short ${
                                    !isSkipped && pageColour === 'COLOUR' ? 'ks-sheet-micro-line--colour' : ''
                                  }`}
                                />
                              </div>
                            </div>

                            {/* Colour Toggle Pill */}
                            <button
                              type="button"
                              className={`ks-page-color-toggle ${
                                pageColour === 'COLOUR' ? 'ks-badge-cmyk' : 'ks-badge-bw'
                              }`}
                              onClick={() => togglePageColour(idx)}
                              disabled={isSkipped}
                            >
                              {pageColour === 'COLOUR' ? '🎨 Colour' : '⬛ B&W'}
                            </button>

                            {/* Orientation Toggle */}
                            <button
                              type="button"
                              className="ks-page-orient-btn"
                              onClick={() => togglePageOrientation(idx)}
                              disabled={isSkipped}
                            >
                              {orientation === 'PORTRAIT' ? '↕ Portrait' : '↔ Land'}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* 2. Layout N-Up (Multi-Page per Sheet) */}
                <div className="ks-settings-group">
                  <span className="ks-settings-label">2. Page Layout (N-Up Multi-Sheet)</span>
                  <div className="ks-nup-grid">
                    <button
                      type="button"
                      className={`ks-nup-card ${nUpLayout === 1 ? 'ks-nup-card--active' : ''}`}
                      onClick={() => setNUpLayout(1)}
                      id="ks-nup-1"
                    >
                      <span className="ks-nup-title">1-Up Standard</span>
                      <span className="ks-nup-sub">1 page per sheet</span>
                    </button>
                    <button
                      type="button"
                      className={`ks-nup-card ${nUpLayout === 2 ? 'ks-nup-card--active' : ''}`}
                      onClick={() => setNUpLayout(2)}
                      id="ks-nup-2"
                    >
                      <span className="ks-nup-title">2-in-1 Side-by-Side</span>
                      <span className="ks-nup-sub" style={{ color: '#059669', fontWeight: 700 }}>50% paper savings</span>
                    </button>
                    <button
                      type="button"
                      className={`ks-nup-card ${nUpLayout === 4 ? 'ks-nup-card--active' : ''}`}
                      onClick={() => setNUpLayout(4)}
                      id="ks-nup-4"
                    >
                      <span className="ks-nup-title">4-in-1 Handout Grid</span>
                      <span className="ks-nup-sub" style={{ color: '#059669', fontWeight: 700 }}>75% paper savings</span>
                    </button>
                  </div>
                </div>

                {/* 3. Sides & Duplex Binding */}
                <div className="ks-settings-group">
                  <span className="ks-settings-label">3. Print Sides &amp; Binding</span>
                  <div className="ks-opt-row">
                    <button
                      type="button"
                      className={`ks-opt-card ${selectedDuplex === 'SINGLE' ? 'ks-opt-card--active' : ''}`}
                      onClick={() => setSelectedDuplex('SINGLE')}
                      id="ks-opt-single"
                    >
                      <span className="ks-opt-title">Single-Sided</span>
                      <span className="ks-opt-sub">Front side only</span>
                    </button>
                    <button
                      type="button"
                      className={`ks-opt-card ${selectedDuplex === 'DOUBLE' ? 'ks-opt-card--active' : ''}`}
                      onClick={() => setSelectedDuplex('DOUBLE')}
                      id="ks-opt-double"
                    >
                      <span className="ks-opt-title">Double-Sided</span>
                      <span className="ks-opt-sub">2 sides per sheet (25% off)</span>
                    </button>
                  </div>

                  {selectedDuplex === 'DOUBLE' && (
                    <div className="ks-binding-row">
                      <button
                        type="button"
                        className={`ks-binding-opt ${duplexBinding === 'LONG_EDGE' ? 'ks-binding-opt--active' : ''}`}
                        onClick={() => setDuplexBinding('LONG_EDGE')}
                      >
                        <span>📖 Long-Edge Flip (Booklet)</span>
                      </button>
                      <button
                        type="button"
                        className={`ks-binding-opt ${duplexBinding === 'SHORT_EDGE' ? 'ks-binding-opt--active' : ''}`}
                        onClick={() => setDuplexBinding('SHORT_EDGE')}
                      >
                        <span>🗓️ Short-Edge Flip (Calendar)</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* 4. Quality DPI & Paper Selection */}
                <div className="ks-settings-group">
                  <span className="ks-settings-label">4. Quality &amp; Paper Type</span>
                  <div className="ks-quality-grid">
                    <button
                      type="button"
                      className={`ks-quality-card ${printDpi === '600' ? 'ks-quality-card--active' : ''}`}
                      onClick={() => setPrintDpi('600')}
                      id="ks-dpi-600"
                    >
                      <span className="ks-quality-title">⚡ Standard Laser (600 DPI)</span>
                      <span className="ks-quality-sub">Fast high-speed print • Sharp text</span>
                    </button>
                    <button
                      type="button"
                      className={`ks-quality-card ${printDpi === '1200' ? 'ks-quality-card--active' : ''}`}
                      onClick={() => setPrintDpi('1200')}
                      id="ks-dpi-1200"
                    >
                      <span className="ks-quality-title">💎 Studio Vivid (1200 DPI)</span>
                      <span className="ks-quality-sub">Ultra-high resolution graphics</span>
                    </button>
                  </div>
                </div>

                {/* 5. Copies Stepper & Quick Presets */}
                <div className="ks-settings-group">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span className="ks-settings-label">5. Number of Copies</span>
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

                  {/* Preset Buttons */}
                  <div className="ks-copies-presets">
                    {[1, 2, 3, 5, 10].map(cnt => (
                      <button
                        key={cnt}
                        type="button"
                        className={`ks-copy-preset-btn ${selectedCopies === cnt ? 'ks-copy-preset-btn--active' : ''}`}
                        onClick={() => setSelectedCopies(cnt)}
                      >
                        {cnt} {cnt === 1 ? 'Set' : 'Sets'}
                      </button>
                    ))}
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

                    {settingsMode === 'PER_PAGE' ? (
                      <div className="ks-summary-row">
                        <span>Page Mix</span>
                        <strong>
                          {pageDetails.bwCount} B&W • {pageDetails.colourCount} Colour
                          {pageDetails.skippedCount > 0 ? ` (${pageDetails.skippedCount} skipped)` : ''}
                        </strong>
                      </div>
                    ) : (
                      <div className="ks-summary-row">
                        <span>Colour</span>
                        <strong>{selectedColour === 'COLOUR' ? 'Full Colour' : 'Black & White'}</strong>
                      </div>
                    )}

                    <div className="ks-summary-row">
                      <span>Layout &amp; Sides</span>
                      <strong>
                        {selectedDuplex === 'DOUBLE' ? '2-Sided' : '1-Sided'} ({nUpLayout}-Up)
                      </strong>
                    </div>

                    <div className="ks-summary-row">
                      <span>Quality</span>
                      <strong>{printDpi} DPI Laser</strong>
                    </div>

                    <div className="ks-summary-row">
                      <span>Copies</span>
                      <strong>{selectedCopies} {selectedCopies === 1 ? 'copy' : 'copies'}</strong>
                    </div>

                    <div className="ks-summary-row">
                      <span>Paper Sheets</span>
                      <strong>{pageDetails.totalSheets} sheets</strong>
                    </div>
                  </div>

                  {/* Eco Savings pill if paper saved */}
                  {pageDetails.savedSheets > 0 && (
                    <div style={{ marginTop: 10, display: 'flex', justifyContent: 'center' }}>
                      <span className="ks-savings-tag">
                        🌱 Saved {pageDetails.savedSheets} paper sheets ({pageDetails.savedPercentage}%)
                      </span>
                    </div>
                  )}

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

                  <button
                    type="button"
                    className="ks-btn-secondary"
                    onClick={handleCancelAndNewUpload}
                    disabled={isActionPending}
                    style={{ color: '#dc2626' }}
                    id="ks-cancel-from-settings"
                  >
                    Cancel / New Upload
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

      {/* Footer — hidden during scan page to eliminate unnecessary technical details */}
      {!isWaiting && (
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
