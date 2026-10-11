import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  SlidersHorizontal,
  Check,
  ArrowRight,
  X,
} from '@phosphor-icons/react'
import { parsePageRange, formatPageRange } from '../../utils/printSettingsUtils'
import RubberSegment from '../ui/RubberSegment'
import './CustomPagesSlider.css'

interface CustomPagesSliderProps {
  totalPages: number
  value: string // e.g. "ALL", "1", "1-4", "1-4, 7"
  onChange: (newValue: string) => void
  onClose?: () => void
}

export const CustomPagesSlider: React.FC<CustomPagesSliderProps> = ({
  totalPages,
  value,
  onChange,
  onClose,
}) => {
  const maxPages = Math.max(1, totalPages)

  // Current selected page set
  const selectedPages = useMemo(() => {
    return parsePageRange(value, maxPages)
  }, [value, maxPages])

  // Track whether customize section is open
  const [isCustomMode, setIsCustomMode] = useState<boolean>(() => value !== 'ALL')

  useEffect(() => {
    if (value !== 'ALL') {
      setIsCustomMode(true)
    } else {
      setIsCustomMode(false)
    }
  }, [value])

  // Derive initial From/To slider bounds from current selection
  const [sliderFrom, setSliderFrom] = useState<number>(() => {
    return selectedPages.length > 0 ? selectedPages[0] : 1
  })
  const [sliderTo, setSliderTo] = useState<number>(() => {
    return selectedPages.length > 0 ? selectedPages[selectedPages.length - 1] : Math.min(3, maxPages)
  })

  // Text input for direct syntax editing e.g. "1-4, 7"
  const [inputText, setInputText] = useState<string>(() => {
    return value === 'ALL' ? `1-${maxPages}` : value
  })
  const [inputError, setInputError] = useState<string | null>(null)

  const currentPreset = useMemo(() => {
    if (selectedPages.length === maxPages) return 'all'
    if (selectedPages.length === 1 && selectedPages[0] === 1) return 'first'
    if (maxPages > 2 && selectedPages.length === Math.ceil(maxPages / 2) && selectedPages.every(p => p % 2 !== 0)) return 'odd'
    if (maxPages > 2 && selectedPages.length === Math.floor(maxPages / 2) && selectedPages.every(p => p % 2 === 0)) return 'even'
    return undefined
  }, [selectedPages, maxPages])

  const presetItems = useMemo(() => {
    const items = [
      { value: 'all', label: 'All' },
      { value: 'first', label: 'Pg 1' },
    ]
    if (maxPages > 2) {
      items.push({ value: 'odd', label: 'Odd' })
      items.push({ value: 'even', label: 'Even' })
    }
    return items
  }, [maxPages])

  // Keep input in sync with external value
  useEffect(() => {
    const formatted = value === 'ALL' ? `1-${maxPages}` : value
    setInputText(formatted)
    setInputError(null)

    const parsed = parsePageRange(value, maxPages)
    if (parsed.length > 0) {
      setSliderFrom(parsed[0])
      setSliderTo(parsed[parsed.length - 1])
    }
  }, [value, maxPages])

  // Toggle individual page chip
  const togglePage = useCallback((pageNum: number) => {
    let nextList: number[]
    if (selectedPages.includes(pageNum)) {
      if (selectedPages.length === 1) {
        // Keep at least 1 page
        return
      }
      nextList = selectedPages.filter(p => p !== pageNum)
    } else {
      nextList = [...selectedPages, pageNum].sort((a, b) => a - b)
    }

    const formatted = formatPageRange(nextList, maxPages)
    onChange(formatted)
  }, [selectedPages, maxPages, onChange])

  // Handle Range Slider changes (from page X to page Y)
  const handleFromChange = (newFrom: number) => {
    const clampedFrom = Math.max(1, Math.min(newFrom, sliderTo))
    setSliderFrom(clampedFrom)

    // Build range from clampedFrom to sliderTo, while preserving any specific extra pages outside range if desired
    // Or generate clean range
    const rangePages: number[] = []
    for (let i = clampedFrom; i <= sliderTo; i++) {
      rangePages.push(i)
    }

    // Keep any pages > sliderTo that were already explicitly picked (e.g. page 7)
    const extraOutliers = selectedPages.filter(p => p > sliderTo || p < clampedFrom)
    const merged = Array.from(new Set([...rangePages, ...extraOutliers])).sort((a, b) => a - b)
    onChange(formatPageRange(merged, maxPages))
  }

  const handleToChange = (newTo: number) => {
    const clampedTo = Math.max(sliderFrom, Math.min(newTo, maxPages))
    setSliderTo(clampedTo)

    const rangePages: number[] = []
    for (let i = sliderFrom; i <= clampedTo; i++) {
      rangePages.push(i)
    }

    const extraOutliers = selectedPages.filter(p => p > clampedTo || p < sliderFrom)
    const merged = Array.from(new Set([...rangePages, ...extraOutliers])).sort((a, b) => a - b)
    onChange(formatPageRange(merged, maxPages))
  }

  // Quick Preset Actions
  const applyPreset = (preset: 'all' | 'first' | 'odd' | 'even' | 'range') => {
    let pages: number[] = []
    if (preset === 'all') {
      setIsCustomMode(false)
      onChange('ALL')
      return
    }
    if (preset === 'first') {
      onChange('1')
      return
    }
    if (preset === 'odd') {
      for (let i = 1; i <= maxPages; i += 2) pages.push(i)
    } else if (preset === 'even') {
      for (let i = 2; i <= maxPages; i += 2) pages.push(i)
    } else if (preset === 'range') {
      for (let i = sliderFrom; i <= sliderTo; i++) pages.push(i)
    }

    if (pages.length > 0) {
      onChange(formatPageRange(pages, maxPages))
    }
  }

  // Handle direct text typing
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value
    setInputText(text)

    if (!text.trim()) {
      setInputError('Please specify at least one page')
      return
    }

    try {
      const parsed = parsePageRange(text, maxPages)
      if (parsed.length === 0) {
        setInputError('No valid pages found')
        return
      }
      setInputError(null)
      onChange(formatPageRange(parsed, maxPages))
    } catch {
      setInputError('Invalid format (e.g. 1-4, 7)')
    }
  }

  // Track fill calculations for animated range bar
  const rangeSpan = maxPages > 1 ? maxPages - 1 : 1
  const trackLeftPercent = ((sliderFrom - 1) / rangeSpan) * 100
  const trackWidthPercent = Math.max(4, ((sliderTo - sliderFrom) / rangeSpan) * 100)

  // 1-page document: No need for customize tab or buttons
  if (maxPages <= 1) {
    return (
      <div className="cps-single-container" onClick={e => e.stopPropagation()}>
        <div className="cps-single-pill">
          <Check size={14} weight="bold" className="cps-single-check" />
          <span>All Pages · 1 Page Document</span>
        </div>
      </div>
    )
  }

  return (
    <div className="cps-wrapper" onClick={e => e.stopPropagation()}>
      {/* ── Mode Switcher: All vs Customize ── */}
      <div className="cps-mode-toggle-wrap">
        <RubberSegment
          items={[
            {
              value: 'ALL',
              label: 'All Pages',
              icon: <Check size={13} weight="bold" />,
            },
            {
              value: 'CUSTOM',
              label: 'Customize',
              icon: <SlidersHorizontal size={13} weight="bold" />,
            },
          ]}
          value={isCustomMode ? 'CUSTOM' : 'ALL'}
          onChange={(val) => {
            if (val === 'ALL') {
              setIsCustomMode(false)
              onChange('ALL')
            } else {
              setIsCustomMode(true)
              if (value === 'ALL') {
                onChange(`1-${maxPages}`)
              }
            }
          }}
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

      {/* When All mode is active: subtle confirmation banner */}
      {!isCustomMode && (
        <div className="cps-all-indicator">
          <span className="cps-all-indicator-text">
            Printing all {maxPages} pages in document order (1 → {maxPages})
          </span>
        </div>
      )}

      {/* When Customize mode is active: full animated expandable controls */}
      <AnimatePresence>
        {isCustomMode && (
          <motion.div
            key="cps-custom-body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="cps-root"
          >
            {/* Top Header & Summary */}
            <div className="cps-header">
              <div className="cps-header-title-wrap">
                <SlidersHorizontal size={15} weight="bold" className="cps-header-icon" />
                <span className="cps-header-title">Page Selection</span>
              </div>
              <div className="cps-header-right">
                <span className="cps-badge-count">
                  {selectedPages.length} of {maxPages} {maxPages === 1 ? 'Page' : 'Pages'}
                </span>
                <button
                  type="button"
                  className="cps-close-btn"
                  onClick={() => {
                    setIsCustomMode(false)
                    onChange('ALL')
                    onClose?.()
                  }}
                  title="Reset to All Pages and close"
                >
                  <X size={14} weight="bold" />
                </button>
              </div>
            </div>

            {/* ── 1. Interactive Animated Range Slider (From Page → To Page) ── */}
            <div className="cps-slider-section">
              <div className="cps-slider-meta">
                <div className="cps-slider-bound-tag from">
                  <span className="cps-bound-label">From Page</span>
                  <span className="cps-bound-val">{sliderFrom}</span>
                </div>
                <div className="cps-slider-arrow">
                  <ArrowRight size={14} weight="bold" />
                </div>
                <div className="cps-slider-bound-tag to">
                  <span className="cps-bound-label">To Page</span>
                  <span className="cps-bound-val">{sliderTo}</span>
                </div>
              </div>

              {/* Dual Slider Track Shell */}
              <div className="cps-dual-slider-wrap">
                <div className="cps-slider-track-bg" />
                
                {/* Animated Highlighted Fill */}
                <motion.div
                  className="cps-slider-track-fill"
                  animate={{
                    left: `${trackLeftPercent}%`,
                    width: `${trackWidthPercent}%`,
                  }}
                  transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                />

                {/* Left / From Slider */}
                <input
                  type="range"
                  min={1}
                  max={maxPages}
                  value={sliderFrom}
                  onChange={e => handleFromChange(Number(e.target.value))}
                  className="cps-range-input cps-range-from"
                  aria-label="From page slider"
                />

                {/* Right / To Slider */}
                <input
                  type="range"
                  min={1}
                  max={maxPages}
                  value={sliderTo}
                  onChange={e => handleToChange(Number(e.target.value))}
                  className="cps-range-input cps-range-to"
                  aria-label="To page slider"
                />
              </div>

              {/* Range Tick Labels */}
              <div className="cps-slider-ticks">
                <span>Pg 1</span>
                {maxPages > 4 && <span>Pg {Math.round(maxPages / 2)}</span>}
                <span>Pg {maxPages}</span>
              </div>
            </div>

            {/* ── 2. "Pick Specific Pages" Interactive Chip Grid ── */}
            <div className="cps-chips-section">
              <div className="cps-chips-header">
                <span className="cps-chips-label">Pick Individual Pages (Click to toggle)</span>
                <span className="cps-chips-hint">e.g. Range 1–4 + Page 7</span>
              </div>

              <div className="cps-chips-scroll">
                {Array.from({ length: maxPages }, (_, i) => i + 1).map(pageNum => {
                  const isSelected = selectedPages.includes(pageNum)
                  const isInSliderRange = pageNum >= sliderFrom && pageNum <= sliderTo
                  return (
                    <motion.button
                      key={pageNum}
                      type="button"
                      whileTap={{ scale: 0.92 }}
                      onClick={() => togglePage(pageNum)}
                      className={`cps-page-chip ${isSelected ? 'selected' : ''} ${isInSliderRange ? 'in-range' : ''}`}
                      title={isSelected ? `Page ${pageNum} is selected (click to remove)` : `Click to include Page ${pageNum}`}
                    >
                      {isSelected && <Check size={11} weight="bold" className="cps-chip-check" />}
                      <span>{pageNum}</span>
                    </motion.button>
                  )
                })}
              </div>
            </div>

            {/* ── 3. Direct Syntax Input & Quick Filters (e.g. "1-4, 7") ── */}
            <div className="cps-input-row">
              <div className="cps-input-shell">
                <span className="cps-input-prefix">Pages:</span>
                <input
                  type="text"
                  value={inputText}
                  onChange={handleInputChange}
                  placeholder="e.g. 1-4, 7"
                  className={`cps-text-input ${inputError ? 'error' : ''}`}
                  aria-label="Custom page range expression"
                />
                {value !== 'ALL' && (
                  <button
                    type="button"
                    className="cps-clear-input-btn"
                    onClick={() => applyPreset('all')}
                    title="Reset to All Pages"
                  >
                    Reset All
                  </button>
                )}
              </div>

              {/* Quick Presets with Rubber Motion */}
              <div className="cps-preset-rubber" style={{ display: 'flex', alignItems: 'center' }}>
                <RubberSegment
                  items={presetItems}
                  value={currentPreset}
                  onChange={(val) => applyPreset(val as any)}
                  trackColor="rgba(15, 23, 42, 0.05)"
                  thumbColor="#dc2626"
                  textColor="#64748b"
                  activeTextColor="#ffffff"
                  size="sm"
                  radius={9999}
                  inset={2}
                  stretch={75}
                  squash={2}
                  speed={1.2}
                />
              </div>
            </div>

            {inputError && (
              <span className="cps-input-error-msg">{inputError}</span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
