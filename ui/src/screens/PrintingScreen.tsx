import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight } from '@phosphor-icons/react'
import './PrintingScreen.css'

interface PrintSheet {
  fileName: string
  pageIndex: number
  mode: 'mono' | 'color'
}

const R = (a: number, b: number) => a + Math.random() * (b - a)

function generateFallbackArt(n: number, m: 'mono' | 'color') {
  const k = Math.floor(R(0, 5))
  const ph = R(0, 6)
  const h = R(0, 360)
  const col = m === 'color'
  const c = [
    col ? `hsl(${h},88%,52%)` : '#1e293b',
    col ? `hsl(${h + 45},92%,56%)` : '#1e293b',
    col ? `hsl(${h + 190},80%,46%)` : '#1e293b',
  ]
  let g = ''
  if (k === 0) {
    for (let i = 0; i < 9; i++) {
      g += `<circle cx="100" cy="150" r="${14 + i * 11}" fill="${i ? 'none' : c[1]}" stroke="${c[i % 3]}" stroke-width="${1.5 + i % 3}"/>`
    }
  }
  if (k === 1) {
    for (let i = 0; i < 16; i++) {
      const hh = R(20, 150)
      g += `<rect x="${14 + i * 11}" y="${232 - hh}" width="7" height="${hh}" rx="1" fill="${c[i % 3]}"/>`
    }
  }
  if (k === 2) {
    for (let y = 0; y < 14; y++) {
      for (let x = 0; x < 10; x++) {
        const d = Math.hypot(x - 4.5, y - 6.5)
        g += `<circle cx="${20 + x * 18}" cy="${52 + y * 14.5}" r="${Math.max(0.8, 6.2 - d * 0.85)}" fill="${c[(x + y) % 3]}"/>`
      }
    }
  }
  if (k === 3) {
    for (let i = 0; i < 14; i++) {
      let q = `M0 ${70 + i * 12}`
      for (let x = 0; x <= 200; x += 8) {
        q += `L${x} ${70 + i * 12 + Math.sin(x / 22 + i * 0.45 + ph) * 9}`
      }
      g += `<path d="${q}" fill="none" stroke="${c[i % 3]}" stroke-width="${1.8}"/>`
    }
  }
  if (k === 4) {
    for (let i = -6; i < 14; i++) {
      g += `<path d="${i * 18} 270L${i * 18 + 90} 40" stroke="${c[i % 2]}" stroke-width="${3 + i % 3 * 2}"/>`
    }
    g += `<circle cx="100" cy="150" r="46" fill="#f1f5f9"/><circle cx="100" cy="150" r="30" fill="${c[2]}"/>`
  }
  const tag = col ? `<rect x="0" y="0" width="200" height="8" fill="${c[0]}"/>` : ''
  return `<svg viewBox="0 0 200 270">${tag}<g>${g}</g><text x="14" y="28" font-family="'Space Grotesk',sans-serif" font-weight="700" font-size="15" letter-spacing="2" fill="#0f172a">PAGE ${String(n).padStart(3, '0')}</text><rect x="14" y="250" width="172" height="2" fill="#0f172a"/><rect x="172" y="15" width="14" height="14" fill="#dc2626"/></svg>`
}

export default function PrintingScreen() {
  const navigate = useNavigate()

  // References
  const stageRef = useRef<HTMLDivElement>(null)
  const printerRef = useRef<HTMLDivElement>(null)
  const planeRef = useRef<HTMLDivElement>(null)
  const isPrintingRef = useRef(false)
  const hasMountedRef = useRef(false)

  // Order Details from Session Storage
  const orderId = sessionStorage.getItem('pb_order_id') || 'PB-' + Math.floor(100000 + Math.random() * 900000)
  const fileName = sessionStorage.getItem('pb_file_name') || 'document.pdf'
  const rawPageCount = Number(sessionStorage.getItem('pb_page_count') || 1)
  const pageCount = Math.max(1, isNaN(rawPageCount) ? 1 : rawPageCount)
  const rawColour = sessionStorage.getItem('pb_colour_mode') || 'BW'
  const primaryMode: 'mono' | 'color' =
    rawColour.toUpperCase() === 'COLOUR' || rawColour.toUpperCase() === 'COLOR'
      ? 'color'
      : 'mono'

  const kioskId = import.meta.env.VITE_KIOSK_ID || sessionStorage.getItem('pb_kiosk_id') || 'PB-001'
  const kioskName = import.meta.env.VITE_KIOSK_NAME || sessionStorage.getItem('pb_kiosk_name') || 'PrintBooth — Station 1'

  // Construct sheet queue
  const [sheetsQueue] = useState<PrintSheet[]>(() => {
    const list: PrintSheet[] = []
    for (let p = 1; p <= pageCount; p++) {
      list.push({
        fileName,
        pageIndex: p,
        mode: primaryMode,
      })
    }
    return list
  })

  // State
  const [currentSheetIndex, setCurrentSheetIndex] = useState(1)
  const [isCompleted, setIsCompleted] = useState(false)
  const [lcdText, setLcdText] = useState('PRINTING')
  const [lcdNumber, setLcdNumber] = useState('001')

  // Top feeder animation
  const feedSheet = useCallback(() => {
    const printer = printerRef.current
    if (!printer) return
    const f = document.createElement('div')
    f.className = 'mono-feed'
    printer.prepend(f)

    f.animate(
      [
        { transform: 'translate(-50%,0) rotate(-6deg)' },
        { transform: 'translate(-50%,0) rotate(-6deg)', offset: 0.15 },
        { transform: 'translate(-50%,150%) rotate(0deg)' },
      ],
      { duration: 800, easing: 'cubic-bezier(.5,0,.8,.7)', fill: 'forwards' }
    ).finished.then(() => f.remove())
  }, [])

  // Print single sheet animation with laser scan cover reveal
  const printSheet = useCallback(
    async (sheet: PrintSheet, sheetNumber: number) => {
      const printer = printerRef.current
      const plane = planeRef.current
      if (!printer || !plane) return

      setLcdNumber(String(sheetNumber).padStart(3, '0'))
      setLcdText('PRINTING')
      feedSheet()

      const p = document.createElement('div')
      p.className = 'mono-paper'
      p.dataset.m = sheet.mode
      p.innerHTML = generateFallbackArt(sheetNumber, sheet.mode) + '<div class="mono-cover"></div>'

      plane.appendChild(p)

      // Prune DOM paper elements if too many
      while (plane.querySelectorAll('.mono-paper').length > 40) {
        plane.querySelector('.mono-paper')?.remove()
      }

      // Kiosk realistic pacing: 3.8s for mono, 6s for color
      const D = sheet.mode === 'color' ? 6000 : 3800
      const E = 'cubic-bezier(.45,.05,.35,1)'
      const end = 'translate(0,6%) rotate(0deg)'

      await new Promise(r => setTimeout(r, 350))

      const coverEl = p.querySelector('.mono-cover')
      if (coverEl) {
        coverEl.animate(
          [
            { transform: 'translateY(0)' },
            { transform: 'translateY(-102%)', offset: 0.85 },
            { transform: 'translateY(-102%)' },
          ],
          { duration: D, easing: E, fill: 'forwards' }
        )
      }

      const em = p.animate(
        [{ transform: 'translate(0,-100%)' }, { transform: end }],
        { duration: D, easing: E, fill: 'forwards' }
      )

      await em.finished
      p.style.transform = end
      em.cancel()

      // Output tray drop with natural offset variance
      const k = Math.min(sheetNumber - 1, 36)
      const fx = R(-1.2, 1.2)
      const fy = 70 - k * 0.55
      const fr = R(-0.7, 0.7)
      const fin = `translate(${fx}%,${fy}%) rotate(${fr}deg)`

      p.animate(
        [
          { transform: end },
          { transform: `translate(${fx}%,${fy * 0.55}%) rotate(${fr * 0.5}deg) scale(1.025)`, offset: 0.5 },
          { transform: fin },
        ],
        { duration: 1000, easing: 'cubic-bezier(.35,.1,.2,1)', fill: 'forwards' }
      ).finished.then(() => {
        p.style.transform = fin
        p.getAnimations().forEach(a => a.cancel())
      })
    },
    [feedSheet]
  )

  // Run the mechanical print sequence
  useEffect(() => {
    if (hasMountedRef.current || isPrintingRef.current || sheetsQueue.length === 0) return
    hasMountedRef.current = true
    isPrintingRef.current = true

    const stage = stageRef.current
    const printer = printerRef.current
    const plane = planeRef.current

    if (stage) stage.classList.add('printing')
    if (printer) printer.classList.add('printing')
    if (plane) plane.classList.add('printing')

    async function runQueue() {
      for (let i = 0; i < sheetsQueue.length; i++) {
        setCurrentSheetIndex(i + 1)
        await printSheet(sheetsQueue[i], i + 1)
        // Natural brief gap between pages
        if (i < sheetsQueue.length - 1) {
          await new Promise(r => setTimeout(r, 450))
        }
      }

      // Finish printing
      isPrintingRef.current = false
      if (stage) stage.classList.remove('printing')
      if (printer) printer.classList.remove('printing')
      if (plane) plane.classList.remove('printing')

      setLcdText('DONE')
      setLcdNumber(String(sheetsQueue.length).padStart(3, '0'))
      setIsCompleted(true)

      // Auto-navigate to collection screen after seeing final printed sheets in the tray
      setTimeout(() => {
        navigate('/collect')
      }, 1800)
    }

    runQueue()
  }, [sheetsQueue, printSheet, navigate])

  return (
    <div
      ref={stageRef}
      className="kiosk-printer-stage printing"
      data-mode={primaryMode}
      id="kiosk-hardware-printer"
    >
      {/* Kiosk Top Hardware Bar */}
      <div className="kiosk-top-bar">
        <div className="kiosk-top-bar__left">
          <div className="kiosk-top-bar__dot" />
          <div>
            <div className="kiosk-top-bar__title">{kioskName}</div>
            <div className="kiosk-top-bar__sub">Station ID: {kioskId}</div>
          </div>
        </div>

        <div className="kiosk-top-bar__badge">
          Order #{orderId}
        </div>
      </div>

      {/* 3D Perspective Desk Plane with Grid & Output Tray */}
      <div ref={planeRef} className="mono-plane printing" id="mono-plane">
        <div className="mono-desk" />
        <div className="mono-tray" />
        <div className="mono-glow" />
        <div className="mono-pshadow" />
      </div>

      {/* Center Mechanical Printer Chassis */}
      <div ref={printerRef} className="mono-printer printing" id="mono-printer">
        <div className="mono-stk b" />
        <div className="mono-stk a" />
        <div className="mono-top" />
        <div className="mono-body">
          <div className="mono-brand">PRINTBOOTH</div>
          <div className="mono-leds">
            <div className="mono-led g">
              <u />
              PWR
            </div>
            <div className="mono-led g rdy">
              <u />
              RDY
            </div>
            <div className="mono-led r">
              <u />
              BSY
            </div>
          </div>
          <div className="mono-seam" />
          <div className="mono-lcd">
            <small>{lcdText}</small>
            <b>{lcdNumber}</b>
            <i />
          </div>
          <button
            type="button"
            className="mono-btn"
            aria-label="Hardware Status"
          >
            <svg viewBox="0 0 24 24">
              <path d="M12 3.5v8" />
              <path d="M7 6.6a8 8 0 1 0 10 0" />
            </svg>
          </button>
          <div className="mono-vent" />
          <div className="mono-lip">
            <div className="mono-scan" />
          </div>
        </div>
      </div>

      {/* Bottom Floating Status Pill HUD */}
      <div className="mono-hud">
        <div className="mono-status-pill">
          <span className={`mono-status-dot${isCompleted ? ' done' : ''}`} />
          <span>
            {isCompleted
              ? `Printed ${sheetsQueue.length} ${sheetsQueue.length === 1 ? 'Page' : 'Pages'} · Ready in Tray Below ↓`
              : `Printing Page ${currentSheetIndex} of ${sheetsQueue.length} · ${fileName} · ${primaryMode === 'color' ? 'Color' : 'B&W'}`}
          </span>
        </div>

        {isCompleted && (
          <button
            type="button"
            className="mono-hud-btn"
            onClick={() => navigate('/collect')}
          >
            Collect Now
            <ArrowRight size={18} weight="bold" />
          </button>
        )}
      </div>
    </div>
  )
}
