import { useState, useCallback, useEffect, useRef, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { QrCode, Printer } from '@phosphor-icons/react'
import ParticleBackground from '../components/ParticleBackground'
import './PinReleaseScreen.css'

// Isolated clock component: re-renders only itself every second without causing keypad re-renders
const StationClock = memo(function StationClock() {
  const [time, setTime] = useState(() =>
    new Date().toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    })
  )

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(
        new Date().toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        })
      )
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  return <span>Ready • {time}</span>
})

export default function PinReleaseScreen() {
  const navigate = useNavigate()

  // Dynamic API & Station ID Resolution
  const searchParams = new URLSearchParams(window.location.search)
  const paramApi = searchParams.get('api') || searchParams.get('apiUrl')
  const paramId = searchParams.get('kioskId') || searchParams.get('id')

  const initialApi = (
    paramApi ||
    localStorage.getItem('pb_api_url') ||
    (window as any).__PRINTBOOTH_API_URL__ ||
    import.meta.env.VITE_PRINTBOOTH_API_URL ||
    import.meta.env.VITE_API_URL ||
    'http://localhost:5000'
  ).replace(/\/api$/, '')

  const initialId =
    paramId ||
    localStorage.getItem('pb_kiosk_id') ||
    (window as any).__PRINTBOOTH_KIOSK_ID__ ||
    import.meta.env.VITE_KIOSK_ID ||
    'PB-001'

  const [apiUrl, setApiUrl] = useState(initialApi)
  const [kioskId, setKioskId] = useState(initialId)
  const [kioskName, setKioskName] = useState(import.meta.env.VITE_KIOSK_NAME || 'PrintBooth — Station 1')

  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState({ text: 'Enter the 4-digit code sent to your phone', isErr: false })
  const [shake, setShake] = useState(false)
  const [isOk, setIsOk] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [verifiedInfo, setVerifiedInfo] = useState<{
    orderNumber?: string
    fileName?: string
    pageCount?: number
  } | null>(null)

  // QR Modal toggle for direct walk-up mobile upload
  const [showQrModal, setShowQrModal] = useState(false)
  const webAppUrl = import.meta.env.VITE_CUSTOMER_WEB_URL || 'http://localhost:5200'
  const kioskQrUrl = `${webAppUrl}/print?id=${encodeURIComponent(kioskId)}`

  // Auto-fetch runtime config.json if served by Pi HTTP server
  useEffect(() => {
    fetch('/config.json')
      .then(res => res.json())
      .then(cfg => {
        if (!paramApi && !localStorage.getItem('pb_api_url') && cfg.apiUrl) {
          setApiUrl(cfg.apiUrl.replace(/\/api$/, ''))
        }
        if (!paramId && !localStorage.getItem('pb_kiosk_id') && cfg.kioskId) {
          setKioskId(cfg.kioskId)
        }
        if (cfg.kioskName) {
          setKioskName(cfg.kioskName)
        }
      })
      .catch(() => {})
  }, [paramApi, paramId])

  // Auto reset idle timer
  const idleRef = useRef(0)
  useEffect(() => {
    const timer = setInterval(() => {
      idleRef.current += 1
      if (idleRef.current >= 45 && pin && !busy) {
        setPin('')
        setMsg({ text: 'Enter the 4-digit code sent to your phone', isErr: false })
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [pin, busy])

  const buzz = (pattern: number | number[]) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(pattern)
      }
    } catch {}
  }

  const verifyOtp = useCallback(
    async (codeToVerify: string) => {
      // 0. Instant local guard: Reject if PIN was already used on this station
      const localUsed: string[] = (() => {
        try {
          return JSON.parse(localStorage.getItem('pb_used_pins') || '[]')
        } catch {
          return []
        }
      })()

      if (localUsed.includes(codeToVerify)) {
        setShake(true)
        buzz([60, 40, 60])
        setMsg({ text: 'This PIN has already been used and is no longer valid.', isErr: true })
        setTimeout(() => {
          setShake(false)
          setPin('')
          setBusy(false)
        }, 1500)
        return
      }

      setBusy(true)
      setMsg({ text: 'Verifying code with station spooler…', isErr: false })

      try {
        const cleanApi = apiUrl.replace(/\/api$/, '')
        let res = await fetch(`${cleanApi}/api/kiosks/${kioskId}/verify-pin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: codeToVerify, kioskId }),
        })
        let data = await res.json()

        if (!data.success && !data.valid) {
          const res2 = await fetch(`${cleanApi}/api/print/verify-pin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kioskId, pin: codeToVerify }),
          })
          data = await res2.json()
        }

        if (data.success || data.valid) {
          // Permanently record in local used PIN list
          try {
            const updated = [...localUsed, codeToVerify].slice(-200)
            localStorage.setItem('pb_used_pins', JSON.stringify(updated))
          } catch {}

          setIsOk(true)
          buzz([30, 40, 60])
          setMsg({ text: '✓ Code verified successfully!', isErr: false })

          const ord = data.order || data.data || data
          const orderNum = ord?.orderNumber || ord?.orderId || 'PB-' + Math.floor(100000 + Math.random() * 900000)
          const fileNm = ord?.fileName || 'Document.pdf'
          const pCount = Math.max(1, Number(ord?.pageCount || ord?.totalPages || ord?.pages || ord?.totalSheets || 1))
          const cMode = ord?.colourMode || ord?.colour || 'BW'

          sessionStorage.setItem('pb_order_id', orderNum)
          sessionStorage.setItem('pb_file_name', fileNm)
          sessionStorage.setItem('pb_page_count', String(pCount))
          sessionStorage.setItem('pb_colour_mode', cMode)
          sessionStorage.setItem('pb_release_pin', codeToVerify)

          setVerifiedInfo({
            orderNumber: orderNum,
            fileName: fileNm,
            pageCount: pCount,
          })

          // Snappy instant start: trigger leave animation and navigate to printer animation in 250ms
          setShowDone(true)
          setTimeout(() => {
            navigate('/printing')
          }, 250)
          return
        }

        // Invalid or already used code
        setShake(true)
        buzz([60, 40, 60])
        const errorText = data?.error || 'Invalid OTP'
        setMsg({ text: errorText, isErr: true })
        setTimeout(() => {
          setShake(false)
          setPin('')
          setBusy(false)
        }, 1500)
      } catch (err: any) {
        setShake(true)
        buzz([60, 40, 60])
        setMsg({
          text: `Could not connect to station spooler (${apiUrl}).`,
          isErr: true,
        })
        setTimeout(() => {
          setShake(false)
          setPin('')
          setBusy(false)
        }, 650)
      }
    },
    [apiUrl, kioskId, navigate]
  )

  const handlePress = useCallback(
    (k: string, _btn?: HTMLElement) => {
      if (busy || showDone) return
      idleRef.current = 0
      buzz(12)
      setMsg({ text: 'Enter the 4-digit code sent to your phone', isErr: false })

      if (k === '⌫') {
        setPin(prev => prev.slice(0, -1))
      } else if (k === 'clear') {
        setPin('')
      } else if (pin.length < 4) {
        const nextPin = pin + k
        setPin(nextPin)
        if (nextPin.length === 4) {
          verifyOtp(nextPin)
        }
      }
    },
    [busy, showDone, pin, verifyOtp]
  )

  // Keyboard support: Numbers, Backspace, Clear, AND Ctrl+C to Exit Kiosk Mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 1. EXIT KIOSK ON CTRL + C or CTRL + Q
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C' || e.key === 'q' || e.key === 'Q')) {
        e.preventDefault()
        // Signal local kiosk UI server to terminate Chromium
        fetch('/api/exit').catch(() => {})
        // Attempt browser window close
        try {
          window.close()
        } catch {}
        return
      }

      if (busy || showDone) return
      const k = /^\d$/.test(e.key) ? e.key : e.key === 'Backspace' ? '⌫' : e.key === 'Escape' ? 'clear' : null
      if (!k) return
      const b = document.querySelector(`[data-k="${k}"]`) as HTMLElement | null
      if (b) {
        b.classList.add('p')
        setTimeout(() => b.classList.remove('p'), 160)
      }
      handlePress(k, b || undefined)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [busy, showDone, handlePress])

  return (
    <div className="kiosk-otp-root">
      {/* High-Performance Static Ambient Background (Zero CPU overhead) */}
      <ParticleBackground />

      {/* Clean Customer-Facing Top Bar (No settings button) */}
      <header className="kiosk-otp-topbar">
        <div className="kiosk-otp-topbar-pill">
          <span className="kiosk-otp-topbar-dot" />
          <span>{kioskId} • {kioskName}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            className="kiosk-otp-qr-action-btn"
            onClick={() => setShowQrModal(true)}
            title="Scan QR to upload file from mobile phone"
          >
            <QrCode size={18} weight="bold" color="var(--red)" />
            <span>Scan QR to Upload</span>
          </button>

          <div className="kiosk-otp-topbar-pill">
            <Printer size={16} weight="bold" color="var(--red)" />
            <StationClock />
          </div>
        </div>
      </header>

      {/* Main Fast Neomorphic OTP Card */}
      <main className={`kiosk-card ${showDone ? 'leave' : ''}`} id="card">
        {/* Lock Icon */}
        <div className="lock">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <rect x="4" y="11" width="16" height="10" rx="3" />
            <path d="M8 11V8a4 4 0 018 0v3" />
          </svg>
        </div>

        <h1>Enter OTP</h1>
        <p>Enter the 4-digit code sent to your phone</p>

        {/* 4 OTP Digits Display */}
        <div className={`otp ${shake ? 'shake' : ''} ${isOk ? 'ok' : ''}`} id="otp">
          {[0, 1, 2, 3].map(i => {
            const digit = pin[i] || ''
            const isCurrent = i === pin.length && !busy
            const isFilled = Boolean(digit)

            return (
              <div
                key={i}
                className={`box ${isFilled ? 'filled' : ''} ${isCurrent ? 'active' : ''}`}
                data-c={digit}
              >
                {digit && <span className="d">{digit}</span>}
              </div>
            )
          })}
        </div>

        {/* Status Message Line */}
        <div className={`msg ${msg.isErr ? 'err' : ''}`} id="msg">
          <span>{msg.text}</span>
        </div>

        {/* 3x4 Tactile Neomorphic Keypad */}
        <div className="pad" id="pad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', '⌫'].map(k => (
            <button
              key={k}
              type="button"
              className={`k ${k.length > 1 && k !== '⌫' ? 'fn' : ''}`}
              data-k={k}
              onPointerDown={e => {
                e.preventDefault()
                const btn = e.currentTarget
                btn.classList.add('p')
                setTimeout(() => btn.classList.remove('p'), 160)
                handlePress(k, btn)
              }}
            >
              <span className="t">{k === 'clear' ? 'Clear' : k}</span>
            </button>
          ))}
        </div>
      </main>

      {/* Success "Verified" Screen */}
      <section className={`done ${showDone ? 'show' : ''}`} id="done">
        <div className="badge">
          <svg viewBox="0 0 110 110">
            <circle cx="55" cy="55" r="48" />
            <path d="M33 57l16 16 29-32" />
          </svg>
        </div>
        <h2>Verified</h2>
        <span>
          {verifiedInfo?.orderNumber
            ? `Releasing Order ${verifiedInfo.orderNumber} • Dispensing to printer…`
            : 'Starting hardware print… Please collect your pages!'}
        </span>
      </section>

      {/* Direct Mobile Upload QR Modal */}
      {showQrModal && (
        <div className="kiosk-qr-modal-backdrop" onClick={() => setShowQrModal(false)}>
          <div className="kiosk-qr-modal-card" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              className="kiosk-qr-close-btn"
              onClick={() => setShowQrModal(false)}
            >
              ✕
            </button>

            <div style={{ margin: '0 auto 16px', display: 'inline-flex', padding: 12, borderRadius: 24, background: '#f8fafc', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.06)' }}>
              <QRCodeSVG
                value={kioskQrUrl}
                size={200}
                level="H"
                includeMargin={false}
                fgColor="#111827"
                bgColor="#ffffff"
              />
            </div>

            <h3 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0 0 6px', color: 'var(--tx)' }}>
              Scan with Phone Camera
            </h3>
            <p style={{ fontSize: '0.95rem', color: 'var(--mu)', margin: '0 0 20px', lineHeight: 1.4 }}>
              Upload your documents, choose print settings, and get your 4-digit pickup code right on your screen.
            </p>

            <button
              type="button"
              className="kiosk-otp-qr-action-btn"
              style={{ width: '100%', justifyContent: 'center', padding: '12px 20px', fontSize: '0.95rem' }}
              onClick={() => setShowQrModal(false)}
            >
              I Have My 4-Digit Code
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
