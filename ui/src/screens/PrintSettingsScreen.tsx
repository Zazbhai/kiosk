import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, FileText, MapPin } from 'lucide-react'
import { Receipt, XCircle, Clock } from '@phosphor-icons/react'
import { motion } from 'motion/react'
import {
  MorphingPopover,
  MorphingPopoverTrigger,
  MorphingPopoverContent,
  MorphingPopoverClose,
} from '../components/ui/morphing-popover'
import { MinimalCarousel, type CarouselCard } from '../components/watermelon/minimal-carousel'
import {
  AnimatedPaperIcon,
  AnimatedColourIcon,
  AnimatedCopiesIcon,
  AnimatedSidesIcon,
} from '../components/watermelon/CardAnimatedIcons'
import { CustomPagesSlider } from '../components/watermelon/CustomPagesSlider'
import { CustomCopiesControl } from '../components/watermelon/CustomCopiesControl'
import { CustomColourControl } from '../components/watermelon/CustomColourControl'
import RubberSegment from '../components/ui/RubberSegment'
import {
  parsePageRange,
  calcFileTotalSheets,
  calcFileTotalPrice,
  getKioskPricing,
  type ColourMode,
  type DuplexMode,
  type FileSettings,
} from '../utils/printSettingsUtils'
import { getKioskId, getKioskName } from '../utils/siteConfig'
import './PrintSettingsScreen.css'

// ─── Inactivity Constants (Auto-Return to Print from Phone) ─────────────────
const INACTIVITY_TIMEOUT_MS = 90 * 1000 // 1 minute 30 seconds
const INACTIVITY_WARNING_SECONDS = 15 // warning popup at 15s remaining

export default function PrintSettingsScreen() {
  const navigate = useNavigate()
  const kioskId = getKioskId() || 'PB-001'
  const kioskName = getKioskName() || 'Station 1'

  const fileName = sessionStorage.getItem('pb_file_name') || 'document.pdf'
  const realPageCount = Math.max(
    1,
    Number(sessionStorage.getItem('pb_doc_page_count') || sessionStorage.getItem('pb_page_count')) || 5
  )

  // ── Settings State (Identical to Web) ──
  const [settings, setSettings] = useState<FileSettings>(() => {
    const raw = sessionStorage.getItem('pb_settings')
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        return {
          pages: parsed.pages || parsed.pagesMode === 'CUSTOM' ? (parsed.pageRange || 'ALL') : (parsed.pagesMode || 'ALL'),
          copies: Math.max(1, Number(parsed.copies) || 1),
          pageCopies: parsed.pageCopies,
          colour: (parsed.colour || 'BW') as ColourMode,
          pageColours: parsed.pageColours,
          duplex: (parsed.duplex || 'SINGLE') as DuplexMode,
          paperSize: 'A4',
          scaling: 'FIT',
          dpi: parsed.printDpi || '600',
        }
      } catch {}
    }
    return {
      pages: 'ALL',
      copies: 1,
      colour: 'BW',
      duplex: 'SINGLE',
      paperSize: 'A4',
      scaling: 'FIT',
      dpi: '600',
    }
  })

  // Start with colour card active (exactly as web)
  const [activeCardId, setActiveCardId] = useState<string | null>('spending')

  const patchSettings = useCallback((patch: Partial<FileSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      sessionStorage.setItem('pb_settings', JSON.stringify(next))
      return next
    })
  }, [])

  // ── Inactivity Auto-Cancel & Timer ──
  const [inactivityRemaining, setInactivityRemaining] = useState<number | null>(null)
  const lastActivityRef = useRef<number>(Date.now())

  const resetInactivity = useCallback(() => {
    lastActivityRef.current = Date.now()
    setInactivityRemaining(null)
  }, [])

  const handleCancelOrder = useCallback(() => {
    sessionStorage.removeItem('pb_settings')
    sessionStorage.removeItem('pb_total_price')
    sessionStorage.removeItem('pb_file_name')
    navigate('/')
  }, [navigate])

  useEffect(() => {
    lastActivityRef.current = Date.now()

    const onUserTouch = () => {
      lastActivityRef.current = Date.now()
      setInactivityRemaining(null)
    }

    window.addEventListener('touchstart', onUserTouch, { passive: true })
    window.addEventListener('touchmove', onUserTouch, { passive: true })
    window.addEventListener('mousedown', onUserTouch, { passive: true })
    window.addEventListener('click', onUserTouch, { passive: true })
    window.addEventListener('keydown', onUserTouch, { passive: true })

    const interval = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current
      const leftMs = INACTIVITY_TIMEOUT_MS - elapsed

      if (leftMs <= 0) {
        clearInterval(interval)
        handleCancelOrder()
        return
      }

      const leftSec = Math.ceil(leftMs / 1000)
      if (leftSec <= INACTIVITY_WARNING_SECONDS) {
        setInactivityRemaining(leftSec)
      } else {
        setInactivityRemaining(null)
      }
    }, 500)

    return () => {
      clearInterval(interval)
      window.removeEventListener('touchstart', onUserTouch)
      window.removeEventListener('touchmove', onUserTouch)
      window.removeEventListener('mousedown', onUserTouch)
      window.removeEventListener('click', onUserTouch)
      window.removeEventListener('keydown', onUserTouch)
    }
  }, [handleCancelOrder])

  // ── Calculations ──
  const selectedPagesList = useMemo(() => {
    return parsePageRange(settings.pages, realPageCount)
  }, [settings.pages, realPageCount])

  const pageCount = selectedPagesList.length

  const totalPagePrints = useMemo(() => {
    if (settings.pageCopies && Object.keys(settings.pageCopies).length > 0) {
      return selectedPagesList.reduce((sum, p) => {
        const c = Number(settings.pageCopies?.[String(p)]) || settings.copies || 1
        return sum + Math.max(1, c)
      }, 0)
    }
    return selectedPagesList.length * Math.max(1, settings.copies)
  }, [selectedPagesList, settings.pageCopies, settings.copies])

  const isCustomColour =
    selectedPagesList.length > 1 &&
    Boolean(settings.pageColours && Object.keys(settings.pageColours).length > 0)

  const kioskPricing = getKioskPricing()
  const prices = useMemo(
    () => ({
      BW_SINGLE: kioskPricing.bwSingle,
      BW_DOUBLE: kioskPricing.bwDouble,
      COLOUR_SINGLE: kioskPricing.colorSingle,
      COLOUR_DOUBLE: kioskPricing.colorDouble,
    }),
    [kioskPricing]
  )

  const pricePerPage = useMemo(() => {
    if (settings.colour === 'BW' && settings.duplex === 'SINGLE') return prices.BW_SINGLE
    if (settings.colour === 'BW' && settings.duplex === 'DOUBLE') return prices.BW_DOUBLE
    if (settings.colour === 'COLOUR' && settings.duplex === 'SINGLE') return prices.COLOUR_SINGLE
    return prices.COLOUR_DOUBLE
  }, [settings.colour, settings.duplex, prices])

  const colourCardValue = useMemo(() => {
    if (isCustomColour && settings.pageColours) {
      let col = 0
      let mono = 0
      selectedPagesList.forEach((p) => {
        const mode = settings.pageColours?.[String(p)] ?? settings.colour ?? 'BW'
        if (mode === 'COLOUR') col++
        else mono++
      })
      return `Custom (${col} Col, ${mono} B&W)`
    }
    return settings.colour === 'BW'
      ? `B&W · ₹${prices.BW_SINGLE}/pg`
      : `Colour · ₹${prices.COLOUR_SINGLE}/pg`
  }, [isCustomColour, settings.pageColours, settings.colour, selectedPagesList, prices])

  const totalSheets = useMemo(() => {
    return calcFileTotalSheets(
      realPageCount,
      settings.pages,
      settings.copies,
      settings.duplex,
      settings.pageCopies,
      settings.pagesPerSheet || 1
    )
  }, [realPageCount, settings.pages, settings.copies, settings.duplex, settings.pageCopies, settings.pagesPerSheet])

  const fileTotalPrice = useMemo(() => {
    return calcFileTotalPrice(
      realPageCount,
      settings.pages,
      settings.copies,
      settings.duplex,
      settings.colour,
      settings.pageColours,
      settings.pageCopies
    )
  }, [realPageCount, settings.pages, settings.copies, settings.duplex, settings.colour, settings.pageColours, settings.pageCopies])

  // ── Carousel Cards (Identical to Web) ──
  const CARDS: CarouselCard[] = [
    {
      id: 'gxuri',
      title: 'Pages',
      value:
        settings.pages === 'ALL' || realPageCount <= 1
          ? `All (${realPageCount} ${realPageCount === 1 ? 'Page' : 'Pgs'})`
          : settings.pages === '1'
          ? 'First Page'
          : `Pages ${settings.pages} (${selectedPagesList.length} pgs)`,
      color: 'card-theme-pages',
      icon: AnimatedPaperIcon,
      fullWidthActions: true,
      renderActions: () => (
        <CustomPagesSlider
          totalPages={realPageCount}
          value={settings.pages}
          onChange={(newVal) => patchSettings({ pages: newVal })}
        />
      ),
    },
    {
      id: 'savings',
      title: 'Copies',
      value:
        settings.pageCopies && Object.keys(settings.pageCopies).length > 0
          ? `Custom (${totalPagePrints} total)`
          : `${settings.copies} ${settings.copies === 1 ? 'Copy' : 'Copies'}`,
      color: 'card-theme-copies',
      icon: AnimatedCopiesIcon,
      fullWidthActions: true,
      renderActions: () => (
        <CustomCopiesControl
          selectedPages={selectedPagesList}
          globalCopies={settings.copies}
          pageCopies={settings.pageCopies}
          onGlobalCopiesChange={(newVal) => patchSettings({ copies: newVal })}
          onPageCopiesChange={(newMap) => patchSettings({ pageCopies: newMap })}
        />
      ),
    },
    {
      id: 'yield',
      title: 'Sides',
      value: settings.duplex === 'SINGLE' ? 'Single-Sided' : 'Double-Sided',
      color: 'card-theme-sides',
      icon: AnimatedSidesIcon,
      renderActions: () => (
        <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
          <RubberSegment
            items={[
              { value: 'SINGLE', label: 'Single' },
              { value: 'DOUBLE', label: 'Double' },
            ]}
            value={settings.duplex}
            onChange={(val) => patchSettings({ duplex: val as DuplexMode })}
            trackColor="rgba(15, 23, 42, 0.05)"
            thumbColor="#dc2626"
            textColor="#475569"
            activeTextColor="#ffffff"
            size="sm"
            radius={8}
            inset={3}
            equalSlots
            stretch={85}
            squash={3}
            speed={1.15}
          />
        </div>
      ),
    },
    {
      id: 'spending',
      title: 'Colour',
      value: colourCardValue,
      color: 'card-theme-colour',
      icon: AnimatedColourIcon,
      fullWidthActions: true,
      renderActions: () => (
        <CustomColourControl
          selectedPages={selectedPagesList}
          globalColour={settings.colour}
          pageColours={settings.pageColours}
          onGlobalColourChange={(newVal) => patchSettings({ colour: newVal })}
          onPageColoursChange={(newMap) => patchSettings({ pageColours: newMap })}
        />
      ),
    },
  ]

  function handleContinue() {
    sessionStorage.setItem('pb_file_name', fileName)
    sessionStorage.setItem('pb_page_count', String(pageCount))
    sessionStorage.setItem('pb_doc_page_count', String(realPageCount))
    sessionStorage.setItem('pb_selected_pages', JSON.stringify(selectedPagesList))
    sessionStorage.setItem('pb_page_range', settings.pages)
    sessionStorage.setItem('pb_copies', String(settings.copies))
    sessionStorage.setItem('pb_colour_mode', settings.colour)
    sessionStorage.setItem('pb_total_price', String(fileTotalPrice))
    sessionStorage.setItem(
      'pb_settings',
      JSON.stringify({
        ...settings,
        scaling: 'FIT',
        paperSize: 'A4',
      })
    )
    navigate('/review')
  }

  return (
    <div className="ks-web-settings-root">
      <div className="ks-web-settings-mesh" />

      {/* ── Top Bar ── */}
      <header className="ks-web-topbar">
        <div className="ks-web-topbar__left">
          <div className="ks-web-topbar__dot" />
          <span>{kioskId} • {kioskName}</span>
        </div>
        <button
          type="button"
          className="ks-web-cancel-btn"
          onClick={handleCancelOrder}
          title="Cancel order and return to scan QR"
          id="kiosk-cancel-order-settings"
        >
          <XCircle size={16} weight="bold" />
          <span>Cancel Order</span>
        </button>
      </header>

      {/* ── Main Container (Matches Web Clean Settings Container) ── */}
      <div className="clean-settings-container">
        {/* Header */}
        <div className="clean-header">
          <h1 className="clean-title">Print Settings</h1>
          <div className="clean-subtitle">
            <span className="subtitle-item">
              <FileText size={13} className="subtitle-icon" />
              <span>{fileName}</span>
            </span>
            <span className="subtitle-separator">·</span>
            <span className="subtitle-item">
              <MapPin size={13} className="subtitle-icon" />
              <span>{kioskName}</span>
            </span>
          </div>
        </div>

        {/* Minimal Carousel Card Section */}
        <div className="clean-carousel-stage">
          <MinimalCarousel
            cards={CARDS}
            activeId={activeCardId}
            onActiveChange={(id) => setActiveCardId(id)}
          />
        </div>
      </div>

      {/* Floating Bottom Action Bar with Standout Highlighted Price & Morphing Receipt */}
      <div className="clean-action-bar">
        <div className="clean-price-pill">
          <div className="price-top-meta">
            <span className="price-pill-label">Total Estimate</span>
            <MorphingPopover>
              <MorphingPopoverTrigger asChild>
                <button
                  type="button"
                  className="price-pill-breakdown"
                  title="Click to view full price calculation"
                >
                  <motion.span layoutId="price-calc-badge-label" layout="position">
                    {totalSheets} {totalSheets === 1 ? 'Sheet' : 'Sheets'} · ₹{pricePerPage}/sheet
                  </motion.span>
                </button>
              </MorphingPopoverTrigger>
              <MorphingPopoverContent className="theme-crimson position-top align-start">
                <div className="price-calc-popover-content">
                  <div className="price-calc-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Receipt size={17} weight="bold" color="#dc2626" />
                      <motion.h4
                        layoutId="price-calc-badge-label"
                        layout="position"
                        className="price-calc-title"
                      >
                        Price Breakdown
                      </motion.h4>
                    </div>
                    <span className="price-calc-badge">Live Quote</span>
                  </div>
                  <div className="price-calc-list">
                    <div className="price-calc-row">
                      <span>Rate per sheet</span>
                      <span className="price-calc-val">
                        ₹{pricePerPage}.00 ({settings.colour === 'BW' ? 'B&W' : 'Colour'})
                      </span>
                    </div>
                    <div className="price-calc-row">
                      <span>Pages Selected</span>
                      <span className="price-calc-val">{pageCount} pgs</span>
                    </div>
                    <div className="price-calc-row">
                      <span>Copies</span>
                      <span className="price-calc-val">
                        {settings.pageCopies && Object.keys(settings.pageCopies).length > 0
                          ? `Custom (${totalPagePrints} prints)`
                          : `${settings.copies}x`}
                      </span>
                    </div>
                    <div className="price-calc-row">
                      <span>Total Print Sheets</span>
                      <span className="price-calc-val">{totalSheets} sheets</span>
                    </div>
                    <div className="price-calc-row highlight">
                      <span>Total Payable</span>
                      <span className="price-calc-val">₹{fileTotalPrice}.00</span>
                    </div>
                  </div>
                  <div className="price-calc-footer">
                    <MorphingPopoverClose asChild>
                      <button type="button" className="price-calc-done-btn">
                        Done
                      </button>
                    </MorphingPopoverClose>
                  </div>
                </div>
              </MorphingPopoverContent>
            </MorphingPopover>
          </div>
          <div className="price-figure-wrap">
            <span className="price-currency-symbol">₹</span>
            <span className="price-pill-amount">{fileTotalPrice}</span>
            <span className="price-tax-badge">inc. GST</span>
          </div>
        </div>

        <button
          type="button"
          className="clean-continue-btn"
          onClick={handleContinue}
          id="settings-kiosk-continue"
        >
          <span>Review Order</span>
          <ArrowRight size={16} />
        </button>
      </div>

      {/* ── Inactivity Warning Modal (Auto-Cancel Protection) ── */}
      {inactivityRemaining !== null && (
        <div className="ks-inactivity-modal-backdrop" onClick={resetInactivity}>
          <div className="ks-inactivity-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="ks-inactivity-icon-pulse">
              <Clock size={44} weight="fill" color="#dc2626" />
            </div>
            <div className="ks-inactivity-countdown-badge">{inactivityRemaining}</div>
            <h3 className="ks-inactivity-title">Are you still there?</h3>
            <p className="ks-inactivity-message">
              Returning to home screen in <strong>{inactivityRemaining} seconds</strong> due to
              inactivity. Touch anywhere to keep your session alive.
            </p>
            <div className="ks-inactivity-actions">
              <button
                type="button"
                className="ks-inactivity-btn-keep"
                onClick={resetInactivity}
              >
                Keep Session & Continue
              </button>
              <button
                type="button"
                className="ks-inactivity-btn-cancel"
                onClick={handleCancelOrder}
              >
                Cancel Order Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
