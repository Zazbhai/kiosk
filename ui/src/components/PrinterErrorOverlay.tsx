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
  onDismiss?: () => void
}

export const PrinterErrorOverlay: React.FC<PrinterErrorOverlayProps> = ({
  isOpen,
  title,
}) => {
  if (!isOpen) return null

  const displayTitle = title || 'PRINTER OFFLINE'

  return createPortal(
    <AnimatePresence>
      <motion.div
        id="oopss"
        key="oopss-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="oopss-title"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
        onPointerDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        <div id="error-text">
          {/* 60fps GPU-Composited Floating Mascot — Pure GPU translate quad, 0 SVG re-rasterization */}
          <div className="oopss-mascot-container">
            <div className="oopss-mascot-animator">
              <svg
                className="sad-mascot-svg"
                viewBox="0 0 100 100"
                xmlns="http://www.w3.org/2000/svg"
                preserveAspectRatio="xMidYMid meet"
                aria-hidden="true"
              >
                <g>
                  {/* Face Head */}
                  <circle cx="50" cy="50" r="40" fill="#ffffff" stroke="#000000" strokeWidth="6" strokeMiterlimit="10" />
                  {/* Sad Curved Mouth */}
                  <path
                    d="M31.866,71.591c2.57-7.556,9.709-13,18.134-13s15.564,5.444,18.134,13"
                    stroke="#000000"
                    strokeWidth="5"
                    strokeLinecap="round"
                    fill="none"
                    strokeMiterlimit="10"
                  />
                  {/* Left Eye X */}
                  <line x1="27.5" y1="32.409" x2="39.5" y2="44.409" stroke="#000000" strokeWidth="5" strokeLinecap="round" strokeMiterlimit="10" />
                  <line x1="27.5" y1="44.409" x2="39.5" y2="32.409" stroke="#000000" strokeWidth="5" strokeLinecap="round" strokeMiterlimit="10" />
                  {/* Right Eye X */}
                  <line x1="60.5" y1="32.409" x2="72.5" y2="44.409" stroke="#000000" strokeWidth="5" strokeLinecap="round" strokeMiterlimit="10" />
                  <line x1="60.5" y1="44.409" x2="72.5" y2="32.409" stroke="#000000" strokeWidth="5" strokeLinecap="round" strokeMiterlimit="10" />
                </g>
              </svg>
            </div>
            {/* Hardware-accelerated ground shadow */}
            <div className="mascot-ground-shadow" aria-hidden="true" />
          </div>

          {/* Headline Only — Remains locked while printer is offline */}
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
