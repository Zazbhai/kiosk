import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  Palette,
  Copy,
  BookOpen,
  FileText,
  XCircle,
  Clock,
} from '@phosphor-icons/react'
import './PrintSettingsScreen.css'

// ─── Inactivity Constants (Auto-Return to Print from Phone) ─────────────────
const INACTIVITY_TIMEOUT_MS = 90 * 1000 // 1 minute 30 seconds
const INACTIVITY_WARNING_SECONDS = 15 // warning popup at 15s remaining

type ColourMode = 'BW' | 'COLOUR'
type DuplexMode = 'SINGLE' | 'DOUBLE'
type DuplexBinding = 'LONG_EDGE' | 'SHORT_EDGE'
type PagesMode = 'ALL' | 'FIRST' | 'ODD' | 'EVEN' | 'CUSTOM'

export default function PrintSettingsScreen() {
  const navigate = useNavigate()
  const fileName = sessionStorage.getItem('pb_file_name') ?? 'document.pdf'
  const estimatedPages = Math.max(1, Number(sessionStorage.getItem('pb_doc_page_count') || sessionStorage.getItem('pb_page_count')) || 5)

  // ── Core Settings State (Same as Web Kiosk) ──
  const [colour, setColour] = useState<ColourMode>('BW')
  const [duplex, setDuplex] = useState<DuplexMode>('SINGLE')
  const [duplexBinding, setDuplexBinding] = useState<DuplexBinding>('LONG_EDGE')
  const [pagesMode, setPagesMode] = useState<PagesMode>('ALL')
  const [customRange, setCustomRange] = useState<string>('')
  const [copies, setCopies] = useState<number>(1)
  const [printDpi, setPrintDpi] = useState<'600' | '1200'>('600')

  // Per-page customisation state (optional drawer/strip)
  const [isPerPageOpen, setIsPerPageOpen] = useState(false)
  const [pageColours, setPageColours] = useState<Record<number, ColourMode>>({})

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

  // ── Parse Selected Pages ──
  const selectedPages = useMemo<number[]>(() => {
    if (pagesMode === 'ALL') {
      return Array.from({ length: estimatedPages }, (_, i) => i + 1)
    }
    if (pagesMode === 'FIRST') {
      return [1]
    }
    if (pagesMode === 'ODD') {
      return Array.from({ length: estimatedPages }, (_, i) => i + 1).filter(p => p % 2 !== 0)
    }
    if (pagesMode === 'EVEN') {
      const evens = Array.from({ length: estimatedPages }, (_, i) => i + 1).filter(p => p % 2 === 0)
      return evens.length > 0 ? evens : [1]
    }
    // CUSTOM syntax: "1-3, 5"
    if (pagesMode === 'CUSTOM' && customRange.trim()) {
      const set = new Set<number>()
      const parts = customRange.split(',').map(s => s.trim()).filter(Boolean)
      for (const p of parts) {
        if (p.includes('-')) {
          const [startStr, endStr] = p.split('-')
          const s = Math.max(1, parseInt(startStr, 10) || 1)
          const e = Math.min(estimatedPages, parseInt(endStr, 10) || estimatedPages)
          if (s <= e) {
            for (let i = s; i <= e; i++) set.add(i)
          }
        } else {
          const n = parseInt(p, 10)
          if (!isNaN(n) && n >= 1 && n <= estimatedPages) {
            set.add(n)
          }
        }
      }
      const list = Array.from(set).sort((a, b) => a - b)
      return list.length > 0 ? list : [1]
    }
    return Array.from({ length: estimatedPages }, (_, i) => i + 1)
  }, [pagesMode, customRange, estimatedPages])

  // ── Cost & Paper Calculations ──
  const pageDetails = useMemo(() => {
    let bwCount = 0
    let colourCount = 0

    selectedPages.forEach(p => {
      const pageCol = isPerPageOpen && pageColours[p] ? pageColours[p] : colour
      if (pageCol === 'COLOUR') {
        colourCount++
      } else {
        bwCount++
      }
    })

    const includedPages = selectedPages.length
    const sheetsPerCopy = duplex === 'DOUBLE' ? Math.max(1, Math.ceil(includedPages / 2)) : includedPages
    const totalSheets = sheetsPerCopy * copies

    const bwRate = duplex === 'DOUBLE' ? 1.5 : 2.0
    const colourRate = duplex === 'DOUBLE' ? 6.0 : 8.0
    const dpiMultiplier = printDpi === '1200' ? 1.2 : 1.0

    const baseCostPerCopy = (bwCount * bwRate) + (colourCount * colourRate)
    const subtotalPerCopy = baseCostPerCopy * dpiMultiplier
    const totalAmount = Math.max(2, Math.round(subtotalPerCopy * copies))

    const standardSheets = includedPages * copies
    const savedSheets = Math.max(0, standardSheets - totalSheets)
    const savedPercentage = standardSheets > 0 ? Math.round((savedSheets / standardSheets) * 100) : 0

    return {
      bwCount,
      colourCount,
      includedPages,
      sheetsPerCopy,
      totalSheets,
      totalAmount,
      savedSheets,
      savedPercentage,
    }
  }, [selectedPages, isPerPageOpen, pageColours, colour, duplex, printDpi, copies])

  // Toggle page color in per-page strip
  const togglePageColor = (pageNumber: number) => {
    setPageColours(prev => {
      const current = prev[pageNumber] || colour
      return {
        ...prev,
        [pageNumber]: current === 'BW' ? 'COLOUR' : 'BW',
      }
    })
  }

  const setAllPagesColor = (target: ColourMode) => {
    const updated: Record<number, ColourMode> = {}
    selectedPages.forEach(p => { updated[p] = target })
    setPageColours(updated)
    setColour(target)
  }

  function handleContinue() {
    sessionStorage.setItem('pb_file_name', fileName)
    sessionStorage.setItem('pb_page_count', String(selectedPages.length))
    sessionStorage.setItem('pb_doc_page_count', String(estimatedPages))
    sessionStorage.setItem('pb_selected_pages', JSON.stringify(selectedPages))
    sessionStorage.setItem('pb_page_range', pagesMode === 'ALL' ? 'ALL' : customRange || String(selectedPages.join(',')))
    sessionStorage.setItem('pb_copies', String(copies))
    sessionStorage.setItem('pb_colour_mode', colour)
    sessionStorage.setItem('pb_total_price', String(pageDetails.totalAmount))
    sessionStorage.setItem('pb_settings', JSON.stringify({
      copies,
      colour,
      duplex,
      duplexBinding,
      pagesMode,
      selectedPages,
      printDpi,
      paperSize: 'A4',
      isPerPage: isPerPageOpen,
      pageColours,
    }))
    navigate('/review')
  }

  return (
    <div className="ks-compact-settings-root">
      <div className="ks-compact-bg-mesh" />

      {/* ── Top Bar ── */}
      <header className="ks-compact-topbar">
        <div className="ks-compact-topbar__left">
          <div className="ks-compact-topbar__dot" />
          <span className="ks-compact-topbar__kiosk">PB-001</span>
          <span className="ks-compact-topbar__file">{fileName}</span>
          <span className="ks-compact-topbar__badge">{estimatedPages} Pages Total</span>
        </div>
        <button
          type="button"
          className="ks-compact-cancel-btn"
          onClick={handleCancelOrder}
          title="Cancel order and return to scan QR"
        >
          <XCircle size={17} weight="bold" />
          Cancel Order
        </button>
      </header>

      {/* ── Title Header ── */}
      <div className="ks-compact-header">
        <h1 className="ks-compact-title">Print Settings</h1>
        <p className="ks-compact-sub">Format, sides, and colour options for your document</p>
      </div>

      {/* ── 2x2 Bento Settings Grid ── */}
      <div className="ks-compact-grid">

        {/* ── Card 1: Colour Mode ── */}
        <div className="ks-bento-card">
          <div className="ks-bento-card__head">
            <div className="ks-bento-card__title-group">
              <div className="ks-bento-card__icon">
                <Palette size={18} weight="duotone" />
              </div>
              <span className="ks-bento-card__title">Colour Mode</span>
            </div>
            <span className={`ks-bento-card__badge ${colour === 'COLOUR' || isPerPageOpen ? 'ks-bento-card__badge--highlight' : ''}`}>
              {isPerPageOpen
                ? `${pageDetails.colourCount} Col, ${pageDetails.bwCount} B&W`
                : colour === 'COLOUR' ? 'Colour · ₹8.00/pg' : 'B&W · ₹2.00/pg'}
            </span>
          </div>

          <div className="ks-bento-card__body">
            <div className="ks-seg-group">
              <button
                type="button"
                className={`ks-seg-btn ${colour === 'BW' && !isPerPageOpen ? 'ks-seg-btn--active' : ''}`}
                onClick={() => {
                  setColour('BW')
                  setIsPerPageOpen(false)
                }}
              >
                <div className="ks-mono-dot" />
                Black & White (₹2)
              </button>
              <button
                type="button"
                className={`ks-seg-btn ${colour === 'COLOUR' && !isPerPageOpen ? 'ks-seg-btn--active-colour' : ''}`}
                onClick={() => {
                  setColour('COLOUR')
                  setIsPerPageOpen(false)
                }}
              >
                <div className="ks-colour-dot" />
                Full Colour (₹8)
              </button>
            </div>

            {/* Per-Page Customize Option */}
            <div className="ks-sub-toggle-bar">
              <button
                type="button"
                className="ks-link-btn"
                onClick={() => {
                  if (!isPerPageOpen) {
                    const init: Record<number, ColourMode> = {}
                    selectedPages.forEach(p => { init[p] = colour })
                    setPageColours(init)
                    setIsPerPageOpen(true)
                  } else {
                    setIsPerPageOpen(false)
                  }
                }}
              >
                {isPerPageOpen ? '✓ Done Customising' : '🎨 Customise per-page…'}
              </button>
              {isPerPageOpen && (
                <div style={{ display: 'flex', gap: 4 }}>
                  <button type="button" className="ks-link-btn" onClick={() => setAllPagesColor('BW')}>All B&W</button>
                  <button type="button" className="ks-link-btn" onClick={() => setAllPagesColor('COLOUR')}>All Colour</button>
                </div>
              )}
            </div>

            {/* Per-Page Mini Strip (Active only when toggled) */}
            {isPerPageOpen && (
              <div className="ks-page-chips-scroll">
                {selectedPages.map(p => {
                  const pCol = pageColours[p] || colour
                  return (
                    <button
                      key={p}
                      type="button"
                      className={`ks-page-chip ${pCol === 'COLOUR' ? 'ks-page-chip--col' : 'ks-page-chip--bw'}`}
                      onClick={() => togglePageColor(p)}
                      title={`Page ${p}: Click to switch colour`}
                    >
                      P.{p}: {pCol === 'COLOUR' ? '🌈 Col' : '⬛ B&W'}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Card 2: Sides (Duplex) ── */}
        <div className="ks-bento-card">
          <div className="ks-bento-card__head">
            <div className="ks-bento-card__title-group">
              <div className="ks-bento-card__icon">
                <BookOpen size={18} weight="duotone" />
              </div>
              <span className="ks-bento-card__title">Print Sides</span>
            </div>
            <span className={`ks-bento-card__badge ${duplex === 'DOUBLE' ? 'ks-bento-card__badge--highlight' : ''}`}>
              {duplex === 'DOUBLE' ? '2-Sided · 25% Off' : 'Single-Sided'}
            </span>
          </div>

          <div className="ks-bento-card__body">
            <div className="ks-seg-group">
              <button
                type="button"
                className={`ks-seg-btn ${duplex === 'SINGLE' ? 'ks-seg-btn--active' : ''}`}
                onClick={() => setDuplex('SINGLE')}
              >
                📄 1-Sided
              </button>
              <button
                type="button"
                className={`ks-seg-btn ${duplex === 'DOUBLE' ? 'ks-seg-btn--active-colour' : ''}`}
                onClick={() => setDuplex('DOUBLE')}
              >
                📑 2-Sided (Duplex)
              </button>
            </div>

            {/* Flip Edge Sub-Options (Only when 2-Sided) */}
            {duplex === 'DOUBLE' ? (
              <div className="ks-sub-toggle-bar">
                <button
                  type="button"
                  className={`ks-sub-chip ${duplexBinding === 'LONG_EDGE' ? 'ks-sub-chip--active' : ''}`}
                  onClick={() => setDuplexBinding('LONG_EDGE')}
                >
                  📖 Long-Edge (Booklet)
                </button>
                <button
                  type="button"
                  className={`ks-sub-chip ${duplexBinding === 'SHORT_EDGE' ? 'ks-sub-chip--active' : ''}`}
                  onClick={() => setDuplexBinding('SHORT_EDGE')}
                >
                  🗓️ Short-Edge (Calendar)
                </button>
              </div>
            ) : (
              <div className="ks-sub-toggle-bar" style={{ opacity: 0.6 }}>
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Standard 1 page per sheet</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Card 3: Pages to Print ── */}
        <div className="ks-bento-card">
          <div className="ks-bento-card__head">
            <div className="ks-bento-card__title-group">
              <div className="ks-bento-card__icon">
                <FileText size={18} weight="duotone" />
              </div>
              <span className="ks-bento-card__title">Pages to Print</span>
            </div>
            <span className="ks-bento-card__badge">
              {selectedPages.length} of {estimatedPages} Pgs
            </span>
          </div>

          <div className="ks-bento-card__body">
            <div className="ks-pages-preset-grid">
              <button
                type="button"
                className={`ks-preset-pill ${pagesMode === 'ALL' ? 'ks-preset-pill--active' : ''}`}
                onClick={() => setPagesMode('ALL')}
              >
                All ({estimatedPages})
              </button>
              <button
                type="button"
                className={`ks-preset-pill ${pagesMode === 'FIRST' ? 'ks-preset-pill--active' : ''}`}
                onClick={() => setPagesMode('FIRST')}
              >
                Pg 1
              </button>
              <button
                type="button"
                className={`ks-preset-pill ${pagesMode === 'ODD' ? 'ks-preset-pill--active' : ''}`}
                onClick={() => setPagesMode('ODD')}
              >
                Odd
              </button>
              <button
                type="button"
                className={`ks-preset-pill ${pagesMode === 'CUSTOM' ? 'ks-preset-pill--active' : ''}`}
                onClick={() => {
                  setPagesMode('CUSTOM')
                  if (!customRange) setCustomRange(`1-${Math.min(3, estimatedPages)}`)
                }}
              >
                Custom
              </button>
            </div>

            {pagesMode === 'CUSTOM' && (
              <input
                type="text"
                className="ks-custom-range-input"
                placeholder="e.g. 1-3, 5"
                value={customRange}
                onChange={e => setCustomRange(e.target.value)}
                autoFocus
              />
            )}
          </div>
        </div>

        {/* ── Card 4: Copies ── */}
        <div className="ks-bento-card">
          <div className="ks-bento-card__head">
            <div className="ks-bento-card__title-group">
              <div className="ks-bento-card__icon">
                <Copy size={18} weight="duotone" />
              </div>
              <span className="ks-bento-card__title">Copies</span>
            </div>
            <span className="ks-bento-card__badge">
              {copies} {copies === 1 ? 'Copy' : 'Copies'}
            </span>
          </div>

          <div className="ks-bento-card__body">
            <div className="ks-copies-row">
              <div className="ks-copies-stepper">
                <button
                  type="button"
                  className="ks-stepper-btn"
                  onClick={() => setCopies(c => Math.max(1, c - 1))}
                  disabled={copies <= 1}
                >
                  −
                </button>
                <span className="ks-stepper-val">{copies}</span>
                <button
                  type="button"
                  className="ks-stepper-btn"
                  onClick={() => setCopies(c => Math.min(50, c + 1))}
                  disabled={copies >= 50}
                >
                  +
                </button>
              </div>

              <div className="ks-copies-presets">
                {[1, 2, 3, 5, 10].map(cnt => (
                  <button
                    key={cnt}
                    type="button"
                    className={`ks-copy-chip ${copies === cnt ? 'ks-copy-chip--active' : ''}`}
                    onClick={() => setCopies(cnt)}
                  >
                    {cnt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Compact Utility Strip (Quality & Paper) ── */}
      <div className="ks-compact-meta-strip">
        <span>Paper: <strong>A4</strong></span>
        <span>•</span>
        <span>Quality:</span>
        <button
          type="button"
          className={`ks-meta-opt-btn ${printDpi === '600' ? 'ks-meta-opt-btn--active' : ''}`}
          onClick={() => setPrintDpi('600')}
        >
          ⚡ 600 DPI (Laser)
        </button>
        <button
          type="button"
          className={`ks-meta-opt-btn ${printDpi === '1200' ? 'ks-meta-opt-btn--active' : ''}`}
          onClick={() => setPrintDpi('1200')}
        >
          💎 1200 DPI (HD)
        </button>
      </div>

      {/* ── Fixed Bottom Action Bar ── */}
      <footer className="ks-compact-bottom-bar">
        <button
          type="button"
          className="ks-bottom-back-btn"
          onClick={() => navigate('/upload')}
        >
          <ArrowLeft size={18} weight="bold" />
          Back
        </button>

        <div className="ks-bottom-price-group">
          <div className="ks-bottom-price-val">₹{pageDetails.totalAmount}.00</div>
          <div className="ks-bottom-price-sub">
            <span>{pageDetails.totalSheets} sheets ({pageDetails.includedPages} pgs × {copies}x)</span>
            {pageDetails.savedSheets > 0 && (
              <span className="ks-bottom-eco-pill">
                🌱 Saved {pageDetails.savedSheets} sheets
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          className="ks-bottom-continue-btn"
          onClick={handleContinue}
          id="settings-kiosk-continue"
        >
          Review Order
          <ArrowRight size={18} weight="bold" />
        </button>
      </footer>

      {/* ── 15-Second Inactivity Warning Dialog Modal ── */}
      {inactivityRemaining !== null && (
        <div className="ks-inactivity-modal-backdrop" onClick={resetInactivity}>
          <div className="ks-inactivity-modal-card" onClick={e => e.stopPropagation()}>
            <div className="ks-inactivity-icon-pulse">
              <Clock size={40} weight="fill" color="#dc2626" />
            </div>
            <div className="ks-inactivity-countdown-badge">
              {inactivityRemaining}
            </div>
            <h3 className="ks-inactivity-title">Are you still there?</h3>
            <p className="ks-inactivity-message">
              Returning to home in <strong>{inactivityRemaining} seconds</strong> due to inactivity.
              Touch anywhere to keep your session alive.
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
