import React from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import './PrinterErrorOverlay.css'

export interface PrinterErrorOverlayProps {
  isOpen: boolean
  title?: string
  reason?: string
  detail?: string
  kioskId?: string
  kioskName?: string
}

export const PrinterErrorOverlay: React.FC<PrinterErrorOverlayProps> = ({
  isOpen,
  title,
  reason,
  detail,
  kioskId = 'PB-001',
  kioskName,
}) => {
  if (!isOpen) return null

  const displayTitle = title || 'PRINTER OFFLINE'

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
        <div id="error-text">
          {/* Full-Page Animated Sad Face Illustration */}
          <div className="oopss-img-wrap">
            <img
              src="/sad404.svg"
              onError={(e) => {
                e.currentTarget.src = 'https://cdn.rawgit.com/ahmedhosna95/upload/1731955f/sad404.svg'
              }}
              alt="Printer Offline"
            />
          </div>

          {/* Headline */}
          <span id="oopss-title" className="oopss-title">
            {displayTitle}
          </span>
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}

export default PrinterErrorOverlay

