import { useState, useCallback, useEffect, useRef, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { QrCode, Printer } from '@phosphor-icons/react'
import ParticleBackground from '../components/ParticleBackground'
import { useKioskSiteUrl } from '../utils/siteConfig'
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

  // Dynamic Web Upload URL & QR Code (Auto-fetched from API, no kiosk .env required)
  const [showQrModal, setShowQrModal] = useState(false)
  const { siteUrl, qrUrl: kioskQrUrl, setSiteUrl } = useKioskSiteUrl(apiUrl, kioskId)

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
        // 1. ALWAYS query the local Kiosk server on the Pi first (0ms latency, works completely offline!)
        let data: any = null
        try {
          const localRes = await fetch('/api/verify-pin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin: codeToVerify, kioskId }),
          })
          if (localRes.ok) {
            data = await localRes.json()
          }
        } catch (localErr) {
          console.log('[Kiosk UI] Local /api/verify-pin notice:', localErr)
        }

        // 2. If not matched locally, fallback to central API
        if (!data || (!data.success && !data.valid)) {
          const cleanApi = apiUrl.replace(/\/api$/, '')
          let res = await fetch(`${cleanApi}/api/kiosks/${kioskId}/verify-pin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin: codeToVerify, kioskId }),
          }).catch(() => null)
          if (res && res.ok) {
            data = await res.json().catch(() => null)
          }

          if (!data || (!data.success && !data.valid)) {
            const res2 = await fetch(`${cleanApi}/api/print/verify-pin`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ kioskId, pin: codeToVerify }),
            }).catch(() => null)
            if (res2 && res2.ok) {
              data = await res2.json().catch(() => null)
            }
          }
        }

        if (data && (data.success || data.valid)) {
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
        if (nextPin === '9999' || nextPin === '8888') {
          // Technician Wi-Fi shortcut: Trigger terminal network configuration
          fetch('/api/wifi').catch(() => {})
          setPin('')
          return
        }
        setPin(nextPin)
        if (nextPin.length === 4) {
          verifyOtp(nextPin)
        }
      }
    },
    [busy, showDone, pin, verifyOtp]
  )

  // Technician 5-tap trigger ref
  const tapCountRef = useRef(0)
  const tapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleTechnicianTap = useCallback(() => {
    tapCountRef.current += 1
    if (tapTimeoutRef.current) clearTimeout(tapTimeoutRef.current)
    tapTimeoutRef.current = setTimeout(() => {
      tapCountRef.current = 0
    }, 2500)
    if (tapCountRef.current >= 5) {
      tapCountRef.current = 0
      fetch('/api/wifi').catch(() => {})
    }
  }, [])

  // Keyboard support: Numbers, Backspace, Clear, AND Ctrl+Alt+W / Ctrl+C
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 1. LAUNCH WI-FI CHANGER ON CTRL+ALT+W, CTRL+SHIFT+W, F12, F10
      if (
        (e.ctrlKey && e.altKey && (e.key === 'w' || e.key === 'W')) ||
        (e.ctrlKey && e.shiftKey && (e.key === 'w' || e.key === 'W')) ||
        e.key === 'F12' ||
        e.key === 'F10'
      ) {
        e.preventDefault()
        fetch('/api/wifi').catch(() => {})
        return
      }

      // 2. EXIT KIOSK ON CTRL + C or CTRL + Q
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

      // 3. SET SITE URL ON CTRL + U
      if ((e.ctrlKey || e.metaKey) && (e.key === 'u' || e.key === 'U')) {
        e.preventDefault()
        const customUrl = prompt('Enter customer upload site URL (e.g. https://your-site.com):', siteUrl)
        if (customUrl && customUrl.trim()) {
          setSiteUrl(customUrl.trim())
        }
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
  }, [busy, showDone, handlePress, siteUrl, setSiteUrl])

  return (
    <div className="kiosk-otp-root">
      {/* High-Performance Static Ambient Background (Zero CPU overhead) */}
      <ParticleBackground />

      {/* Clean Customer-Facing Top Bar (No settings button, 5-tap technician secret trigger) */}
      <header className="kiosk-otp-topbar">
        <div className="kiosk-otp-topbar-pill" onClick={handleTechnicianTap} title="Station info (tap 5x for technician settings)">
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
            <p style={{ fontSize: '0.95rem', color: 'var(--mu)', margin: '0 0 14px', lineHeight: 1.4 }}>
              Upload your documents, choose print settings, and get your 4-digit pickup code right on your screen.
            </p>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              background: '#f1f5f9',
              padding: '6px 14px',
              borderRadius: 12,
              margin: '0 auto 16px',
              maxWidth: '96%',
              fontSize: '0.78rem',
              color: 'var(--mu)',
            }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Upload URL: <strong style={{ color: 'var(--tx)' }}>{kioskQrUrl}</strong>
              </span>
              <button
                type="button"
                onClick={() => {
                  const val = prompt('Enter custom site URL for phone uploads (e.g. https://your-site.com):', siteUrl)
                  if (val && val.trim()) {
                    setSiteUrl(val.trim())
                  }
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--red)',
                  fontWeight: 700,
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  padding: 0,
                  whiteSpace: 'nowrap',
                }}
              >
                Change
              </button>
            </div>

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
