import React, { useMemo, useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { Palette, Sparkle } from '@phosphor-icons/react'
import type { ColourMode } from '../../utils/printSettingsUtils'
import { getKioskPricing } from '../../utils/printSettingsUtils'
import RubberSegment from '../ui/RubberSegment'
import './CustomColourControl.css'

interface CustomColourControlProps {
  selectedPages: number[]
  globalColour: ColourMode
  pageColours?: Record<string, ColourMode>
  onGlobalColourChange: (colour: ColourMode) => void
  onPageColoursChange: (map: Record<string, ColourMode> | undefined) => void
}

export const CustomColourControl: React.FC<CustomColourControlProps> = ({
  selectedPages,
  globalColour,
  pageColours,
  onGlobalColourChange,
  onPageColoursChange,
}) => {
  const canCustomizePerPage = selectedPages.length > 1
  const isPerPageMode = canCustomizePerPage && Boolean(pageColours && Object.keys(pageColours).length > 0)
  const kioskPricing = getKioskPricing()

  const onPageColoursChangeRef = useRef(onPageColoursChange)
  onPageColoursChangeRef.current = onPageColoursChange

  // Reset per-page colour map when there is only 1 page
  useEffect(() => {
    if (!canCustomizePerPage && pageColours && Object.keys(pageColours).length > 0) {
      onPageColoursChangeRef.current(undefined)
    }
  }, [canCustomizePerPage])

  const toggleMode = (perPage: boolean) => {
    if (perPage) {
      const initMap: Record<string, ColourMode> = {}
      selectedPages.forEach(p => { initMap[String(p)] = globalColour || 'BW' })
      onPageColoursChange(initMap)
    } else {
      onPageColoursChange(undefined)
    }
  }

  const setPageColour = (pageNum: number, mode: ColourMode) => {
    const updated = { ...(pageColours || {}) }
    updated[String(pageNum)] = mode
    onPageColoursChange(updated)
  }

  const setAllPagesTo = (mode: ColourMode) => {
    const updated: Record<string, ColourMode> = {}
    selectedPages.forEach(p => { updated[String(p)] = mode })
    onPageColoursChange(updated)
  }

  const { monoCount, colourCount } = useMemo(() => {
    let mono = 0
    let colour = 0
    if (isPerPageMode && pageColours) {
      selectedPages.forEach(p => {
        const mode = pageColours[String(p)] ?? globalColour ?? 'BW'
        if (mode === 'COLOUR') colour++
        else mono++
      })
    } else {
      if (globalColour === 'COLOUR') colour = selectedPages.length
      else mono = selectedPages.length
    }
    return { monoCount: mono, colourCount: colour }
  }, [selectedPages, globalColour, isPerPageMode, pageColours])

  return (
    <div className="clr-root" onClick={e => e.stopPropagation()}>

      {/* ── Mode switcher (only when multiple pages exist) ── */}
      {canCustomizePerPage && (
        <div style={{ width: '100%', marginBottom: 8 }}>
          <RubberSegment
            items={[
              { value: 'uniform', label: 'All pages', icon: <Palette size={13} weight="duotone" /> },
              { value: 'perpage', label: 'Per page',  icon: <Sparkle  size={13} weight="duotone" /> },
            ]}
            value={isPerPageMode ? 'perpage' : 'uniform'}
            onChange={(val) => toggleMode(val === 'perpage')}
            trackColor="rgba(15, 23, 42, 0.05)"
            thumbColor="#dc2626"
            textColor="#64748b"
            activeTextColor="#ffffff"
            size="md"
            radius={12}
            inset={3}
            equalSlots
            stretch={80}
            squash={3}
            speed={1.1}
            draggable
          />
        </div>
      )}

      {/* ── Mode 1: Uniform (single BW / Colour toggle) ── */}
      {!isPerPageMode && (
        <div style={{ width: '100%' }}>
          <RubberSegment
            items={[
              { value: 'BW',     label: `B&W · \u20b9${kioskPricing.bwSingle}/pg` },
              { value: 'COLOUR', label: `Colour · \u20b9${kioskPricing.colorSingle}/pg` },
            ]}
            value={globalColour}
            onChange={(val) => onGlobalColourChange(val as ColourMode)}
            trackColor="rgba(15, 23, 42, 0.05)"
            thumbColor={globalColour === 'COLOUR' ? '#ec4899' : '#1e293b'}
            textColor="#64748b"
            activeTextColor="#ffffff"
            size="lg"
            radius={14}
            inset={3}
            equalSlots
            stretch={85}
            squash={3}
            speed={1.15}
            draggable
          />
        </div>
      )}

      {/* ── Mode 2: Per-page colour ── */}
      {isPerPageMode && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="clr-perpage-container"
        >
          {/* Toolbar */}
          <div className="clr-perpage-toolbar">
            <span className="clr-perpage-heading">
              {selectedPages.length} {selectedPages.length === 1 ? 'Page' : 'Pages'}
            </span>
            <div className="clr-quick-actions">
              <button type="button" className="clr-quick-btn clr-quick-btn--bw"     onClick={() => setAllPagesTo('BW')}>All B&W</button>
              <button type="button" className="clr-quick-btn clr-quick-btn--colour" onClick={() => setAllPagesTo('COLOUR')}>All Colour</button>
            </div>
          </div>

          {/* Per-page rows */}
          <div className="clr-pages-list">
            {selectedPages.map(pageNum => {
              const currentColour = (pageColours && pageColours[String(pageNum)]) ?? globalColour ?? 'BW'
              const isCol = currentColour === 'COLOUR'
              return (
                <div key={pageNum} className={`clr-page-row${isCol ? ' is-colour' : ''}`}>
                  <span className="clr-page-badge">{pageNum}</span>
                  <span className="clr-page-label">Page {pageNum}</span>
                  <div className="clr-page-toggle">
                    <button type="button" className={`clr-toggle-btn${!isCol ? ' active bw' : ''}`}    onClick={() => setPageColour(pageNum, 'BW')}>B&W</button>
                    <button type="button" className={`clr-toggle-btn${isCol  ? ' active colour' : ''}`} onClick={() => setPageColour(pageNum, 'COLOUR')}>Colour</button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Summary */}
          <div className="clr-summary-strip">
            <div className="clr-summary-stat">
              <span className="clr-summary-num">{monoCount}</span>
              <span className="clr-summary-meta">B&W · ₹{monoCount * kioskPricing.bwSingle}</span>
            </div>
            <div className="clr-summary-divider" />
            <div className="clr-summary-stat clr-summary-stat--colour">
              <span className="clr-summary-num">{colourCount}</span>
              <span className="clr-summary-meta">Colour · ₹{colourCount * kioskPricing.colorSingle}</span>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  )
}