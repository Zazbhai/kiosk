import React, { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { X } from '@phosphor-icons/react'
import './PrinterErrorOverlay.css'

export interface PrinterErrorOverlayProps {
  isOpen: boolean
  title?: string
  reason?: string
  detail?: string
  kioskId?: string
  kioskName?: string
  isTestMode?: boolean
  onDismiss?: () => void
}

export const PrinterErrorOverlay: React.FC<PrinterErrorOverlayProps> = ({
  isOpen,
  title,
  reason,
  detail,
  kioskId = 'PB-001',
  kioskName,
  isTestMode: propIsTestMode,
  onDismiss,
}) => {
  // Determine if running in TEST mode
  const [isTestMode, setIsTestMode] = useState<boolean>(() => {
    if (typeof propIsTestMode === 'boolean') return propIsTestMode
    const urlParams = new URLSearchParams(window.location.search)
    if (urlParams.get('test') === '1' || urlParams.get('mode') === 'test') return true
    const envMode = (import.meta.env.VITE_PRINT_MODE || '').toLowerCase()
    if (envMode === 'test') return true
    const sessionMode = (sessionStorage.getItem('pb_print_mode') || '').toLowerCase()
    return sessionMode === 'test'
  })

  // Admin secret 5-tap bypass for shop testing without hardware
  const tapCountRef = useRef(0)
  const lastTapRef = useRef(0)
  const handleSecretTap = () => {
    const now = Date.now()
    if (now - lastTapRef.current > 1500) {
      tapCountRef.current = 1
    } else {
      tapCountRef.current += 1
    }
    lastTapRef.current = now

    if (tapCountRef.current >= 5) {
      tapCountRef.current = 0
      if (onDismiss) {
        onDismiss()
      }
    }
  }

  if (!isOpen) return null

  const displayTitle = title || 'PRINTER OFFLINE'
  const displayReason = reason || 'The printer is currently offline or rebooting after a power cycle.'
  const displayDetail = detail || 'The station is auto-recovering and will resume automatically as soon as the printer is ready.'

  return createPortal(
    <AnimatePresence>
      <motion.div
        id="oopss"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="oopss-title"
      >
        {/* Top-left station info badge */}
        <div className="oopss-station-badge" onClick={handleSecretTap}>
          <span className="oopss-station-dot" />
          <span>{kioskId} {kioskName ? `• ${kioskName}` : ''}</span>
        </div>

        {/* Close Button — Rendered when test mode is active */}
        {(isTestMode || Boolean(onDismiss)) && (
          <button
            type="button"
            className="oopss-test-close-btn"
            onClick={onDismiss}
            title="Dismiss error (Test Mode only)"
            aria-label="Dismiss error (Test Mode only)"
          >
            <span className="oopss-test-badge">TEST MODE</span>
            <X size={16} weight="bold" />
          </button>
        )}

        <div id="error-text">
          {/* Full-Page Animated Sad Face Illustration */}
          <div className="oopss-img-wrap" onClick={handleSecretTap}>
            <img
              src="/sad404.svg"
              onError={(e) => {
                e.currentTarget.src = 'https://cdn.rawgit.com/ahmedhosna95/upload/1731955f/sad404.svg'
              }}
              alt="Printer Offline"
            />
          </div>

          {/* Headline */}
          <span id="oopss-title" className="oopss-title" onClick={handleSecretTap}>
            {displayTitle}
          </span>

          {/* Primary Reason */}
          <p className="p-a">
            {displayReason}
          </p>

          {/* Secondary Subtitle */}
          <p className="p-b">
            {displayDetail}
          </p>

          {/* Live Status Heartbeat Indicator */}
          <div className="oopss-live-indicator">
            <span className="oopss-live-dot" />
            <span className="oopss-live-text">Monitoring hardware connection & auto-recovering…</span>
          </div>

        </div>
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}

export default PrinterErrorOverlay
