import React, { useMemo, useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import {
  Copy,
  Plus,
  Minus,
  Sparkle,
} from '@phosphor-icons/react'
import { Stepper } from './stepper'
import RubberSegment from '../ui/RubberSegment'
import './CustomCopiesControl.css'

interface CustomCopiesControlProps {
  selectedPages: number[]
  globalCopies: number
  pageCopies?: Record<string, number>
  onGlobalCopiesChange: (copies: number) => void
  onPageCopiesChange: (map: Record<string, number> | undefined) => void
}

export const CustomCopiesControl: React.FC<CustomCopiesControlProps> = ({
  selectedPages,
  globalCopies,
  pageCopies,
  onGlobalCopiesChange,
  onPageCopiesChange,
}) => {
  const canCustomizePerPage = selectedPages.length > 1
  const isPerPagMode = canCustomizePerPage && Boolean(pageCopies && Object.keys(pageCopies).length > 0)

  const onPageCopiesChangeRef = useRef(onPageCopiesChange)
  onPageCopiesChangeRef.current = onPageCopiesChange

  // Reset per-page copies when only 1 page / card
  useEffect(() => {
    if (!canCustomizePerPage && pageCopies && Object.keys(pageCopies).length > 0) {
      onPageCopiesChangeRef.current(undefined)
    }
  }, [canCustomizePerPage])

  // Calculate total copies
  const totalCopies = useMemo(() => {
    if (isPerPagMode && pageCopies) {
      return selectedPages.reduce((sum, p) => {
        const c = pageCopies[String(p)] ?? globalCopies ?? 1
        return sum + Math.max(1, c)
      }, 0)
    }
    return selectedPages.length * Math.max(1, globalCopies)
  }, [selectedPages, globalCopies, isPerPagMode, pageCopies])

  // Switch between Uniform vs Per-Page Mode
  const toggleMode = (perPage: boolean) => {
    if (perPage) {
      // Initialize per-page map from current global copies
      const initMap: Record<string, number> = {}
      selectedPages.forEach(p => {
        initMap[String(p)] = globalCopies || 1
      })
      onPageCopiesChange(initMap)
    } else {
      onPageCopiesChange(undefined)
    }
  }

  // Set copies for a specific page
  const setPageCopy = (pageNum: number, count: number) => {
    const updated = { ...(pageCopies || {}) }
    updated[String(pageNum)] = Math.max(1, Math.min(50, count))
    onPageCopiesChange(updated)
  }

  // Quick set all to N
  const setAllPagesTo = (count: number) => {
    const updated: Record<string, number> = {}
    selectedPages.forEach(p => {
      updated[String(p)] = count
    })
    onPageCopiesChange(updated)
  }

  return (
    <div className="ccc-root" onClick={e => e.stopPropagation()}>
      {/* RubberSegment Mode Switcher - Only shown when multiple pages exist */}
      {canCustomizePerPage && (
        <div style={{ width: '100%', marginBottom: 12 }}>
          <RubberSegment
            items={[
              {
                value: 'uniform',
                label: `Same for all pages (${globalCopies}x)`,
                icon: <Copy size={14} weight="duotone" />,
              },
              {
                value: 'perpage',
                label: 'Specify per page',
                icon: <Sparkle size={14} weight="duotone" />,
              },
            ]}
            value={isPerPagMode ? 'perpage' : 'uniform'}
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

      {/* Mode 1: Uniform Global Stepper */}
      {!isPerPagMode && (
        <div className="ccc-uniform-row">
          <div className="ccc-uniform-info">
            <span className="ccc-uniform-label">Copies per selected page:</span>
            <span className="ccc-uniform-sub">
              {totalCopies} sheets total ({selectedPages.length} {selectedPages.length === 1 ? 'page' : 'pages'} × {globalCopies} {globalCopies === 1 ? 'copy' : 'copies'})
            </span>
          </div>

          <Stepper
            value={globalCopies}
            min={1}
            max={50}
            onChange={onGlobalCopiesChange}
            size="compact"
          />
        </div>
      )}

      {/* Mode 2: Per-Page Copies List */}
      {isPerPagMode && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="ccc-perpage-container"
        >
          <div className="ccc-perpage-toolbar">
            <span className="ccc-perpage-heading">
              Copies for {selectedPages.length} Specified {selectedPages.length === 1 ? 'Page' : 'Pages'}
            </span>
            <div className="ccc-quick-actions">
              <button type="button" onClick={() => setAllPagesTo(1)} className="ccc-quick-btn">
                All 1x
              </button>
              <button type="button" onClick={() => setAllPagesTo(2)} className="ccc-quick-btn">
                All 2x
              </button>
            </div>
          </div>

          {/* Cards for each specified page */}
          <div className="ccc-pages-grid">
            {selectedPages.map(pageNum => {
              const currentCopies = (pageCopies && pageCopies[String(pageNum)]) ?? globalCopies ?? 1
              return (
                <div key={pageNum} className="ccc-page-item">
                  <div className="ccc-page-tag">
                    <span className="ccc-page-num">Pg {pageNum}</span>
                  </div>

                  <div className="ccc-page-stepper-wrap">
                    <button
                      type="button"
                      className="ccc-step-btn"
                      onClick={() => setPageCopy(pageNum, currentCopies - 1)}
                      disabled={currentCopies <= 1}
                      title="Decrease copy count"
                    >
                      <Minus size={11} weight="bold" />
                    </button>

                    <span className="ccc-step-val">{currentCopies}</span>

                    <button
                      type="button"
                      className="ccc-step-btn"
                      onClick={() => setPageCopy(pageNum, currentCopies + 1)}
                      disabled={currentCopies >= 50}
                      title="Increase copy count"
                    >
                      <Plus size={11} weight="bold" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Per-Page Total Summary */}
          <div className="ccc-perpage-footer">
            <span className="ccc-footer-highlight">
              Total Output: <strong>{totalCopies} Copies</strong> across {selectedPages.length} pages
            </span>
          </div>
        </motion.div>
      )}
    </div>
  )
}
