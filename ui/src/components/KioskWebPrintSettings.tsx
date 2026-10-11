import { useState, useMemo, useEffect, useCallback } from 'react'
import { ArrowLeft, FileText, MapPin, Receipt, XCircle, Leaf } from '@phosphor-icons/react'
import { MinimalCarousel, type CarouselCard } from './watermelon/minimal-carousel'
import {
  AnimatedPaperIcon,
  AnimatedColourIcon,
  AnimatedCopiesIcon,
  AnimatedSidesIcon,
} from './watermelon/CardAnimatedIcons'
import { CustomPagesSlider } from './watermelon/CustomPagesSlider'
import { CustomCopiesControl } from './watermelon/CustomCopiesControl'
import { CustomColourControl } from './watermelon/CustomColourControl'
import RubberSegment from './ui/RubberSegment'
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
import './KioskWebPrintSettings.css'

export interface KioskWebPrintSettingsProps {
  fileName?: string
  totalPages?: number
  initialSettings?: Partial<FileSettings>
  onSettingsChange?: (settings: FileSettings, totalSheets: number, totalPrice: number) => void
  onProceed: (settings: FileSettings, totalSheets: number, totalPrice: number) => void
  onBack?: () => void
  onCancel?: () => void
  proceedLabel?: string
  isActionPending?: boolean
  kioskId?: string
  kioskName?: string
  showTopbar?: boolean
}

export default function KioskWebPrintSettings({
  fileName: propFileName,
  totalPages: propTotalPages,
  initialSettings,
  onSettingsChange,
  onProceed,
  onBack,
  onCancel,
  proceedLabel = 'Proceed to Payment →',
  isActionPending = false,
  kioskId: propKioskId,
  kioskName: propKioskName,
  showTopbar = true,
}: KioskWebPrintSettingsProps) {
  const kioskId = propKioskId || getKioskId() || 'PB-001'
  const kioskName = propKioskName || getKioskName() || 'Station 1'

  const fileName = propFileName || sessionStorage.getItem('pb_file_name') || 'document.pdf'
  const realPageCount = Math.max(
    1,
    propTotalPages ||
    Number(sessionStorage.getItem('pb_doc_page_count') || sessionStorage.getItem('pb_page_count')) ||
    1
  )

  // ── Print Settings State (Exact Web Architecture) ──
  const [settings, setSettings] = useState<FileSettings>(() => {
    return {
      pages: initialSettings?.pages || 'ALL',
      copies: Math.max(1, Number(initialSettings?.copies) || 1),
      pageCopies: initialSettings?.pageCopies,
      colour: (initialSettings?.colour || 'BW') as ColourMode,
      pageColours: initialSettings?.pageColours,
      duplex: (initialSettings?.duplex || 'SINGLE') as DuplexMode,
      paperSize: 'A4',
      scaling: 'FIT',
      dpi: initialSettings?.dpi || '600',
    }
  })

  // Start with colour card active (exact web default)
  const [activeCardId, setActiveCardId] = useState<string | null>('spending')

  const patchSettings = useCallback((patch: Partial<FileSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      return next
    })
  }, [])

  // ── Pricing & Calculations ──
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

  const savedSheets = useMemo(() => {
    if (settings.duplex === 'DOUBLE' && pageCount > 1) {
      const singleSheets = Math.ceil(totalPagePrints / (settings.pagesPerSheet || 1))
      return Math.max(0, singleSheets - totalSheets)
    }
    return 0
  }, [settings.duplex, pageCount, totalPagePrints, settings.pagesPerSheet, totalSheets])

  // Notify parent of updates
  useEffect(() => {
    onSettingsChange?.(settings, totalSheets, fileTotalPrice)
  }, [settings, totalSheets, fileTotalPrice, onSettingsChange])

  // ── 4 Web Cards Definition (Identical to Web) ──
  const CARDS: CarouselCard[] = useMemo(() => [
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
            size="md"
            radius={9999}
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
  ], [settings, realPageCount, selectedPagesList, totalPagePrints, colourCardValue, patchSettings])

  const handleProceedClick = () => {
    onProceed(settings, totalSheets, fileTotalPrice)
  }

  return (
    <div className="kwps-root">
      {/* ── Top Bar (Optional, can be hidden if parent screen has top header) ── */}
      {showTopbar && (
        <header className="kwps-topbar">
          <div className="kwps-topbar__left">
            <div className="kwps-topbar__dot" />
            <span className="kwps-station-tag">{kioskId} • {kioskName}</span>
          </div>

          <div className="kwps-topbar__actions">
            {onBack && (
              <button
                type="button"
                className="kwps-btn-back"
                onClick={onBack}
                disabled={isActionPending}
                id="kwps-back-btn"
              >
                <ArrowLeft size={16} weight="bold" />
                <span>Review Document</span>
              </button>
            )}

            {onCancel && (
              <button
                type="button"
                className="kwps-btn-cancel"
                onClick={onCancel}
                disabled={isActionPending}
                id="kwps-cancel-btn"
              >
                <XCircle size={16} weight="bold" />
                <span>Cancel</span>
              </button>
            )}
          </div>
        </header>
      )}

      {/* ── Widescreen Responsive Kiosk Layout ── */}
      <div className="kwps-layout-container">
        {/* Left Column: Interactive Settings Cards */}
        <div className="kwps-cards-column">
          {/* Header */}
          <div className="kwps-doc-header">
            <h1 className="kwps-doc-title">Print Settings</h1>
            <div className="kwps-doc-meta">
              <span className="kwps-meta-pill">
                <FileText size={15} weight="bold" className="kwps-meta-icon" />
                <span className="kwps-doc-filename" title={fileName}>{fileName}</span>
              </span>
              <span className="kwps-meta-sep">•</span>
              <span className="kwps-meta-pill">
                <span>{realPageCount} {realPageCount === 1 ? 'Page' : 'Pages'}</span>
              </span>
              <span className="kwps-meta-sep">•</span>
              <span className="kwps-meta-pill kwps-meta-pill--loc">
                <MapPin size={15} weight="bold" className="kwps-meta-icon" />
                <span>{kioskName}</span>
              </span>
            </div>
          </div>

          {/* Minimal Carousel Card Section (Hardware Accelerated for Pi) */}
          <div className="kwps-carousel-stage">
            <MinimalCarousel
              cards={CARDS}
              activeId={activeCardId}
              onActiveChange={(id) => setActiveCardId(id)}
            />
          </div>
        </div>

        {/* Right Column: Order Summary & Instant Touch CTA (Pi Landscape Ergonomics) */}
        <aside className="kwps-summary-column">
          <div className="kwps-summary-card">
            <div className="kwps-summary-header">
              <div className="kwps-summary-badge-wrap">
                <Receipt size={18} weight="bold" color="#dc2626" />
                <h3 className="kwps-summary-title">Live Order Summary</h3>
              </div>
              <span className="kwps-live-quote-tag">Live Quote</span>
            </div>

            {/* Spec breakdown table */}
            <div className="kwps-summary-table">
              <div className="kwps-table-row">
                <span className="kwps-row-label">Document</span>
                <span className="kwps-row-val kwps-row-val--truncate" title={fileName}>
                  {fileName}
                </span>
              </div>

              <div className="kwps-table-row">
                <span className="kwps-row-label">Pages Selected</span>
                <span className="kwps-row-val">
                  {pageCount} of {realPageCount} {realPageCount === 1 ? 'pg' : 'pgs'}
                </span>
              </div>

              <div className="kwps-table-row">
                <span className="kwps-row-label">Colour Mode</span>
                <span className="kwps-row-val">
                  {settings.colour === 'COLOUR' ? (
                    <strong style={{ color: '#db2777' }}>Colour (₹{prices.COLOUR_SINGLE}/pg)</strong>
                  ) : (
                    <span>B&amp;W (₹{prices.BW_SINGLE}/pg)</span>
                  )}
                </span>
              </div>

              <div className="kwps-table-row">
                <span className="kwps-row-label">Print Sides</span>
                <span className="kwps-row-val">
                  {settings.duplex === 'DOUBLE' ? '2-Sided (Duplex)' : '1-Sided (Single)'}
                </span>
              </div>

              <div className="kwps-table-row">
                <span className="kwps-row-label">Copies</span>
                <span className="kwps-row-val">
                  {settings.pageCopies && Object.keys(settings.pageCopies).length > 0
                    ? `Custom (${totalPagePrints} total)`
                    : `${settings.copies} ${settings.copies === 1 ? 'copy' : 'copies'}`}
                </span>
              </div>

              <div className="kwps-table-row kwps-table-row--sheets">
                <span className="kwps-row-label">Paper Sheets</span>
                <span className="kwps-row-val">
                  <strong>{totalSheets} sheets</strong> (A4)
                </span>
              </div>
            </div>

            {/* Eco Savings Badge */}
            {savedSheets > 0 && (
              <div className="kwps-eco-badge">
                <Leaf size={16} weight="fill" color="#16a34a" />
                <span>Saves {savedSheets} paper sheets (50% eco saver)</span>
              </div>
            )}

            {/* Grand Total Banner */}
            <div className="kwps-total-banner">
              <div className="kwps-total-meta">
                <span className="kwps-total-label">Total Payable</span>
                <span className="kwps-total-sub">Inc. all taxes &amp; GST</span>
              </div>
              <div className="kwps-total-price">
                <span className="kwps-currency">₹</span>
                <span className="kwps-amount">{fileTotalPrice}</span>
                <span className="kwps-cents">.00</span>
              </div>
            </div>

            {/* Large Primary Action Button (Optimized 56px touch target for Pi) */}
            <button
              type="button"
              className="kwps-primary-cta"
              onClick={handleProceedClick}
              disabled={isActionPending}
              id="kwps-primary-proceed-btn"
            >
              <span>{proceedLabel}</span>
            </button>

            {/* Secondary actions row */}
            <div className="kwps-summary-actions">
              {onBack && (
                <button
                  type="button"
                  className="kwps-sec-btn"
                  onClick={onBack}
                  disabled={isActionPending}
                >
                  <ArrowLeft size={15} />
                  <span>Review Preview</span>
                </button>
              )}

              {onCancel && (
                <button
                  type="button"
                  className="kwps-sec-btn kwps-sec-btn--cancel"
                  onClick={onCancel}
                  disabled={isActionPending}
                >
                  <span>Cancel Order</span>
                </button>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* ── Compact Floating Action Bar (Active on Mobile / Narrow Displays) ── */}
      <div className="kwps-compact-action-bar">
        <div className="kwps-compact-price-pill">
          <div className="kwps-compact-meta">
            <span className="kwps-compact-label">Total Estimate</span>
            <span className="kwps-compact-breakdown">
              {totalSheets} {totalSheets === 1 ? 'Sheet' : 'Sheets'} · ₹{pricePerPage}/sheet
            </span>
          </div>
          <div className="kwps-compact-amount">
            <span>₹{fileTotalPrice}.00</span>
          </div>
        </div>

        <button
          type="button"
          className="kwps-compact-btn"
          onClick={handleProceedClick}
          disabled={isActionPending}
        >
          <span>{proceedLabel}</span>
        </button>
      </div>
    </div>
  )
}
