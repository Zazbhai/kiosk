import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import TimerSvg from '../components/TimerSvg'
import KioskWebPrintSettings from '../components/KioskWebPrintSettings'
import {
  parsePageRange,
  type FileSettings,
} from '../utils/printSettingsUtils'
import { getKioskId, getKioskName } from '../utils/siteConfig'
import './PrintSettingsScreen.css'

// ─── Inactivity Constants (Auto-Return to Home on Idle) ─────────────────────
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

  // Initial settings parsed from session storage if present
  const initialSettings = useMemo<Partial<FileSettings>>(() => {
    const raw = sessionStorage.getItem('pb_settings')
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        return {
          pages: parsed.pages || (parsed.pagesMode === 'CUSTOM' ? (parsed.pageRange || 'ALL') : (parsed.pagesMode || 'ALL')),
          copies: Math.max(1, Number(parsed.copies) || 1),
          pageCopies: parsed.pageCopies,
          colour: parsed.colour || 'BW',
          pageColours: parsed.pageColours,
          duplex: parsed.duplex || 'SINGLE',
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

  function handleContinue(finalSettings: FileSettings, totalSheets: number, totalPrice: number) {
    const selectedPagesList = parsePageRange(finalSettings.pages, realPageCount)
    sessionStorage.setItem('pb_file_name', fileName)
    sessionStorage.setItem('pb_page_count', String(selectedPagesList.length))
    sessionStorage.setItem('pb_doc_page_count', String(realPageCount))
    sessionStorage.setItem('pb_selected_pages', JSON.stringify(selectedPagesList))
    sessionStorage.setItem('pb_page_range', finalSettings.pages)
    sessionStorage.setItem('pb_copies', String(finalSettings.copies))
    sessionStorage.setItem('pb_colour_mode', finalSettings.colour)
    sessionStorage.setItem('pb_total_price', String(totalPrice))
    sessionStorage.setItem('pb_total_sheets', String(totalSheets))
    sessionStorage.setItem(
      'pb_settings',
      JSON.stringify({
        ...finalSettings,
        scaling: 'FIT',
        paperSize: 'A4',
      })
    )
    navigate('/review')
  }

  return (
    <div className="ks-web-settings-root">
      {/* Ambient Lighting Mesh */}
      <div className="ks-web-settings-mesh" />

      {/* Unified Pi-Optimized Web Print Settings Component */}
      <KioskWebPrintSettings
        fileName={fileName}
        totalPages={realPageCount}
        initialSettings={initialSettings}
        onProceed={handleContinue}
        onBack={() => navigate(-1)}
        onCancel={handleCancelOrder}
        proceedLabel="Review →"
        kioskId={kioskId}
        kioskName={kioskName}
        showTopbar={true}
      />

      {/* ── Inactivity Warning Modal (Auto-Cancel Protection) ── */}
      {inactivityRemaining !== null && (
        <div className="ks-inactivity-modal-backdrop" onClick={resetInactivity}>
          <div className="ks-inactivity-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="ks-inactivity-icon-pulse">
              <TimerSvg size={56} />
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
                Keep Alive
              </button>
              <button
                type="button"
                className="ks-inactivity-btn-cancel"
                onClick={handleCancelOrder}
              >
                Cancel Order
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
