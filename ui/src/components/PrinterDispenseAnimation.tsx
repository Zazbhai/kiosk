import { useEffect, useRef, useState, useCallback } from 'react'
import './PrinterDispenseAnimation.css'

interface DocPageItem {
  pageNumber: number
  url?: string
  title?: string
}

export interface PrinterDispenseAnimationProps {
  progress?: number
  fileName?: string
  sheets?: number
  copies?: number
  colourMode?: 'BW' | 'COLOUR' | 'mono' | 'color'
  isComplete?: boolean
  phaseMessage?: string
  onComplete?: () => void
  docPages?: DocPageItem[]
}

const R = (a: number, b: number) => a + Math.random() * (b - a)
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Generative print artwork generator from MONO P1 hardware simulation
 */
function generateArt(n: number, m: 'mono' | 'color') {
  const k = Math.floor(R(0, 5))
  const ph = R(0, 6)
  const h = R(0, 360)
  const col = m === 'color'
  const c = [
    col ? `hsl(${h},88%,52%)` : '#0a0a0a',
    col ? `hsl(${h + 45},92%,56%)` : '#0a0a0a',
    col ? `hsl(${h + 190},80%,46%)` : '#0a0a0a',
  ]
  let g = ''
  if (k === 0) {
    for (let i = 0; i < 9; i++) {
      g += `<circle cx="100" cy="150" r="${14 + i * 11}" fill="${i ? 'none' : c[1]}" stroke="${c[i % 3]}" stroke-width="${1.5 + i % 3}"/>`
    }
  }
  if (k === 1) {
    for (let i = 0; i < 16; i++) {
      const q = R(20, 150)
      g += `<rect x="${14 + i * 11}" y="${232 - q}" width="7" height="${q}" rx="1" fill="${c[i % 3]}"/>`
    }
  }
  if (k === 2) {
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 9; x++) {
        const d = Math.hypot(x - 4, y - 5.5)
        g += `<circle cx="${28 + x * 18}" cy="${58 + y * 16}" r="${Math.max(0.8, 6.4 - d * 0.9)}" fill="${c[(x + y) % 3]}"/>`
      }
    }
  }
  if (k === 3) {
    for (let i = 0; i < 14; i++) {
      let q = `M0 ${70 + i * 12}`
      for (let x = 0; x <= 200; x += 10) {
        q += `L${x} ${70 + i * 12 + Math.sin(x / 22 + i * 0.45 + ph) * 9}`
      }
      g += `<path d="${q}" fill="none" stroke="${c[i % 3]}" stroke-width="1.8"/>`
    }
  }
  if (k === 4) {
    for (let i = -6; i < 14; i++) {
      g += `<path d="${i * 18} 270L${i * 18 + 90} 40" stroke="${c[i % 2]}" stroke-width="${3 + (i % 3) * 2}"/>`
    }
    g += `<circle cx="100" cy="150" r="46" fill="#dcdcdf"/><circle cx="100" cy="150" r="30" fill="${c[2]}"/>`
  }
  const badgeColor = col ? '#e5322d' : '#111111'
  return `<svg viewBox="0 0 200 270">${col ? `<rect width="200" height="8" fill="${c[0]}"/>` : ''}${g}<text x="14" y="28" font-family="'Space Grotesk',sans-serif" font-weight="700" font-size="15" letter-spacing="2" fill="#111">NO.${String(n).padStart(3, '0')}</text><rect x="14" y="250" width="172" height="2" fill="#111"/><rect x="172" y="15" width="14" height="14" fill="${badgeColor}"/></svg>`
}

export default function PrinterDispenseAnimation({
  sheets = 1,
  copies = 1,
  colourMode = 'mono',
  onComplete,
  docPages,
}: PrinterDispenseAnimationProps) {
  const printerRef = useRef<HTMLDivElement>(null)
  const rigRef = useRef<HTMLDivElement>(null)

  // Hardware Status State
  const [lcdStatus, setLcdStatus] = useState<string>('IDLE')
  const [lcdNumber, setLcdNumber] = useState<string>('000')
  const [isPrintingClass, setIsPrintingClass] = useState<boolean>(false)
  const [isBootingClass, setIsBootingClass] = useState<boolean>(false)
  const [isRigOn, setIsRigOn] = useState<boolean>(false)
  const [isReady, setIsReady] = useState<boolean>(false)

  // Mode: 'mono' or 'color'
  const isColor = colourMode === 'COLOUR' || colourMode === 'color'
  const mode: 'mono' | 'color' = isColor ? 'color' : 'mono'

  // Total physical pages to dispense
  const totalSheetsToPrint = Math.max(1, (sheets || 1) * (copies || 1))

  // Gravity drop physics from MONO P1
  const dropPaper = useCallback((p: HTMLElement, k: number) => {
    const fx = R(-0.8, 0.8)
    const fr = R(-0.7, 0.7)
    const tip = R(-5, 5)
    const land = 44 - Math.min(k, 14) * 0.5
    const T = (y: number, r: number) => `translate(${fx}%,${y}%) rotate(${r}deg)`
    const fin = T(land, fr)

    p.animate(
      [
        { transform: 'translate(0,0%) rotate(0deg)', offset: 0 },
        { transform: 'translate(0,0%) rotate(0deg)', offset: 0.07, easing: 'cubic-bezier(.55,0,.95,.6)' },
        { transform: T(land, tip), offset: 0.5, easing: 'cubic-bezier(.2,.65,.4,1)' },
        { transform: T(land - 4.5, tip * 0.35), offset: 0.68, easing: 'cubic-bezier(.55,0,.9,.6)' },
        { transform: T(land, fr * 1.6), offset: 0.84, easing: 'cubic-bezier(.2,.65,.4,1)' },
        { transform: T(land - 0.8, fr), offset: 0.92, easing: 'ease-in' },
        { transform: fin, offset: 1 },
      ],
      { duration: 850, fill: 'forwards' }
    ).finished.then(() => {
      p.style.transform = fin
      p.style.willChange = 'auto'
      p.getAnimations().forEach(a => a.cancel())
    })
  }, [])

  // Paper feeder sheet sliding into top input slot (smooth mechanical feed)
  const feedSheet = useCallback(() => {
    const printer = printerRef.current
    if (!printer) return
    const f = document.createElement('div')
    f.className = 'feed'
    printer.prepend(f)

    f.animate(
      [
        { transform: 'translate(-50%,0) rotate(-6deg)' },
        { transform: 'translate(-50%,0) rotate(-6deg)', offset: 0.15 },
        { transform: 'translate(-50%,150%) rotate(0deg)' },
      ],
      { duration: 800, easing: 'cubic-bezier(.5,0,.8,.7)' }
    ).finished.then(() => f.remove())
  }, [])

  const docPagesRef = useRef(docPages)
  docPagesRef.current = docPages
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete
  const hasStartedRef = useRef(false)

  // Calibrated real-hardware animation lifecycle:
  // - 8s hardware boot, fuser roller warm-up, and CUPS spool receive
  // - 4s per page physical laser print speed
  // - Realtime LCD telemetry updates
  useEffect(() => {
    if (hasStartedRef.current) return
    hasStartedRef.current = true
    let isCancelled = false
    const rig = rigRef.current

    async function executePrintRun() {
      // ── PHASE 1: Hardware Warmup & Spooling (8 seconds) ──
      setIsBootingClass(true)
      setIsPrintingClass(true)
      setLcdStatus('WARM UP')
      setLcdNumber('008')

      // Real hardware countdown for 8s warm-up & spooling
      for (let sec = 8; sec > 0; sec--) {
        if (isCancelled) return
        setLcdNumber(String(sec).padStart(3, '0'))
        if (sec <= 4) {
          setLcdStatus('SPOOL')
        }
        await wait(1000)
      }
      if (isCancelled) return

      setIsBootingClass(false)
      setIsRigOn(true)

      // ── PHASE 2: Page-by-Page Physical Print Loop (4 seconds per page) ──
      const pagePrintDuration = 4000

      for (let pageIdx = 1; pageIdx <= totalSheetsToPrint; pageIdx++) {
        if (isCancelled) return

        setLcdStatus('PRINTING')
        setLcdNumber(String(pageIdx).padStart(3, '0'))

        // Feed input sheet from top stack
        feedSheet()

        // Create printed output paper
        const paperEl = document.createElement('div')
        paperEl.className = 'paper'
        paperEl.dataset.m = mode

        // Check if thumbnail preview is available for this sheet
        const previewUrl = docPages?.[(pageIdx - 1) % (docPages.length || 1)]?.url
        if (previewUrl && previewUrl.trim()) {
          paperEl.innerHTML = `
            <div class="paper-preview-container">
              <img src="${previewUrl}" alt="" class="paper-preview-img" style="${!isColor ? 'filter: grayscale(100%) contrast(108%);' : ''}" />
              <div class="paper-meta-strip">
                <span class="paper-no">NO.${String(pageIdx).padStart(3, '0')}</span>
                <span class="paper-accent"></span>
              </div>
            </div>
            <div class="cover"></div>
          `
        } else {
          paperEl.innerHTML = generateArt(pageIdx, mode) + '<div class="cover"></div>'
        }

        if (rig) {
          rig.appendChild(paperEl)
          const allPapers = rig.querySelectorAll('.paper')
          if (allPapers.length > 15) {
            allPapers[0].remove()
          }
        }

        await wait(300)
        if (isCancelled) return

        // Cover sliding reveal & smooth paper ejection (3400ms for 4s page cycle)
        const adjustedDuration = pagePrintDuration - 600
        const coverEl = paperEl.querySelector('.cover')
        if (coverEl) {
          coverEl.animate(
            [
              { transform: 'translateY(0)' },
              { transform: 'translateY(-102%)', offset: 0.82 },
              { transform: 'translateY(-102%)' },
            ],
            { duration: adjustedDuration, easing: 'cubic-bezier(.45,.05,.35,1)', fill: 'forwards' }
          )
        }

        const ejectionAnim = paperEl.animate(
          [
            { transform: 'translate(0,-100%)' },
            { transform: 'translate(0,0%)' },
          ],
          { duration: adjustedDuration, easing: 'cubic-bezier(.45,.05,.35,1)', fill: 'forwards' }
        )

        await ejectionAnim.finished
        if (isCancelled) return

        paperEl.style.transform = 'translate(0,0%)'
        ejectionAnim.cancel()

        // Gravity drop into output tray with mechanical bounce
        dropPaper(paperEl, pageIdx - 1)

        // Micro-pause before the next feed begins (300ms) -> total 4000ms per sheet
        await wait(300)
        if (isCancelled) return
      }

      // ── PHASE 3: Print Complete ──
      setIsPrintingClass(false)
      setIsRigOn(false)
      setIsReady(true)
      setLcdStatus('DONE')
      setLcdNumber(String(totalSheetsToPrint).padStart(3, '0'))

      // Settle time for customer to observe finished pages in output tray
      await wait(1500)
      if (isCancelled) return

      onCompleteRef.current?.()
    }

    executePrintRun()

    return () => {
      isCancelled = true
    }
  }, [totalSheetsToPrint, mode, feedSheet, dropPaper])

  return (
    <div className="ks-mono-stage" data-mode={mode}>
      {/* ---------- printer ---------- */}
      <div
        className={`printer ${isPrintingClass ? 'printing' : ''} ${isBootingClass ? 'booting' : ''}`}
        ref={printerRef}
      >
        <div className="stk b" />
        <div className="stk a" />
        <div className="top" />
        <div className="body">
          <div className="brand">MONO·P1</div>
          <div className="leds">
            <div className="led g">
              <u />
              PWR
            </div>
            <div className={`led g rdy ${isReady ? 'on' : ''}`}>
              <u />
              RDY
            </div>
            <div className="led r">
              <u />
              BSY
            </div>
          </div>
          <div className="seam" />
          <div className="lcd">
            <small id="st">{lcdStatus}</small>
            <b id="pg">{lcdNumber}</b>
            <i />
          </div>
          <button
            type="button"
            className="btn"
            id="btn"
            aria-label="Printer Hardware Key"
          >
            <svg viewBox="0 0 24 24">
              <path d="M12 3.5v8" />
              <path d="M7 6.6a8 8 0 1 0 10 0" />
            </svg>
          </button>
          <div className="vent" />
          <div className="lip">
            <div className="scan" />
          </div>
        </div>
      </div>

      {/* ---------- output rig ---------- */}
      <div className={`rig ${isRigOn ? 'on' : ''}`} ref={rigRef}>
        <div className="cavity" />
        <div className="spill" />
        <div className="pshadow" />
      </div>

      {/* ---------- tray ---------- */}
      <div className="tray" />
    </div>
  )
}
