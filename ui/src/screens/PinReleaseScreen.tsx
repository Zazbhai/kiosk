import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { QrCode, Printer, Gear, CheckCircle, WarningCircle } from '@phosphor-icons/react'
import ParticleBackground from '../components/ParticleBackground'
import './PinReleaseScreen.css'

export default function PinReleaseScreen() {
  const navigate = useNavigate()

  // 1. Dynamic API & Station ID Resolution with multiple robust fallbacks
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
  // Station Config Modal (allows technician or user to configure backend IP right on screen)
  const [showConfigModal, setShowConfigModal] = useState(false)
  const [configDraftUrl, setConfigDraftUrl] = useState(apiUrl)
  const [configDraftId, setConfigDraftId] = useState(kioskId)
  const [pingStatus, setPingStatus] = useState<{ testing: boolean; success?: boolean; text?: string } | null>(null)

  const webAppUrl = import.meta.env.VITE_CUSTOMER_WEB_URL || 'http://localhost:5200'
  const kioskQrUrl = `${webAppUrl}/print?id=${encodeURIComponent(kioskId)}`

  // Live clock
  const [timeStr, setTimeStr] = useState('')
  useEffect(() => {
    const updateTime = () => {
      setTimeStr(
        new Date().toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        })
      )
    }
    updateTime()
    const timer = setInterval(updateTime, 1000)
    return () => clearInterval(timer)
  }, [])

  // Auto-fetch runtime config.json if served by Pi HTTP server
  useEffect(() => {
    fetch('/config.json')
      .then(res => res.json())
      .then(cfg => {
        if (!paramApi && !localStorage.getItem('pb_api_url') && cfg.apiUrl) {
          const cleanUrl = cfg.apiUrl.replace(/\/api$/, '')
          setApiUrl(cleanUrl)
          setConfigDraftUrl(cleanUrl)
        }
        if (!paramId && !localStorage.getItem('pb_kiosk_id') && cfg.kioskId) {
          setKioskId(cfg.kioskId)
          setConfigDraftId(cfg.kioskId)
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
      setBusy(true)
      setMsg({ text: 'Verifying code with station spooler…', isErr: false })

      try {
        const cleanApi = apiUrl.replace(/\/api$/, '')
        // 1. Primary endpoint: /api/kiosks/:id/verify-pin
        let res = await fetch(`${cleanApi}/api/kiosks/${kioskId}/verify-pin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: codeToVerify, kioskId }),
        })
        let data = await res.json()

        // 2. Secondary fallback endpoint: /api/print/verify-pin
        if (!data.success && !data.valid) {
          const res2 = await fetch(`${cleanApi}/api/print/verify-pin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kioskId, pin: codeToVerify }),
          })
          data = await res2.json()
        }

        if (data.success || data.valid) {
          setIsOk(true)
          buzz([30, 40, 60])
          setMsg({ text: '✓ Code verified successfully!', isErr: false })

          const ord = data.order || data.data || data
          const orderNum = ord?.orderNumber || ord?.orderId || 'PB-' + Math.floor(100000 + Math.random() * 900000)
          const fileNm = ord?.fileName || 'Document.pdf'
          const pCount = Number(ord?.pageCount || 1)
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

          setTimeout(() => {
            setShowDone(true)
            setTimeout(() => {
              navigate('/printing')
            }, 1200)
          }, 600)
          return
        }

        // Invalid code
        setShake(true)
        buzz([60, 40, 60])
        setMsg({ text: data.error || 'Incorrect OTP code. Please try again.', isErr: true })
        setTimeout(() => {
          setShake(false)
          setPin('')
          setBusy(false)
        }, 650)
      } catch (err: any) {
        setShake(true)
        buzz([60, 40, 60])
        setMsg({
          text: `Could not connect to station spooler at ${apiUrl}.`,
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

  // Physical keyboard support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (busy || showDone) return
      const k = /^\d$/.test(e.key) ? e.key : e.key === 'Backspace' ? '⌫' : e.key === 'Escape' ? 'clear' : null
      if (!k) return
      const b = document.querySelector(`[data-k="${k}"]`) as HTMLElement | null
      if (b) {
        b.classList.add('p')
        setTimeout(() => b.classList.remove('p'), 120)
      }
      handlePress(k, b || undefined)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [busy, showDone, handlePress])

  // Test Ping from Config Modal
  const testConnectionPing = async () => {
    setPingStatus({ testing: true })
    try {
      const clean = configDraftUrl.trim().replace(/\/api$/, '')
      const res = await fetch(`${clean}/api/kiosks/${configDraftId}/verify-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: '0000', kioskId: configDraftId }),
      })
      if (res.status === 200 || res.status === 400) {
        setPingStatus({ testing: false, success: true, text: '✓ Connected to backend successfully!' })
      } else {
        setPingStatus({ testing: false, success: false, text: `Received HTTP ${res.status}` })
      }
    } catch (e: any) {
      setPingStatus({ testing: false, success: false, text: `Failed: ${e.message || 'Connection refused'}` })
    }
  }

  const handleSaveConfig = () => {
    const clean = configDraftUrl.trim().replace(/\/api$/, '')
    setApiUrl(clean)
    setKioskId(configDraftId.trim().toUpperCase())
    localStorage.setItem('pb_api_url', clean)
    localStorage.setItem('pb_kiosk_id', configDraftId.trim().toUpperCase())
    setShowConfigModal(false)
    setMsg({ text: `✓ Server updated to ${clean}`, isErr: false })
  }

  return (
    <div className="kiosk-otp-root">
      {/* High-Performance Ambient Background (0% CPU on Pi) */}
      <ParticleBackground />

      {/* Floating Station Top Bar */}
      <header className="kiosk-otp-topbar">
        <button
          type="button"
          className="kiosk-otp-topbar-pill kiosk-topbar-interactive"
          onClick={() => {
            setConfigDraftUrl(apiUrl)
            setConfigDraftId(kioskId)
            setPingStatus(null)
            setShowConfigModal(true)
          }}
          title="Tap to configure Station Spooler IP"
        >
          <span className="kiosk-otp-topbar-dot" />
          <span>{kioskId} • {kioskName}</span>
          <Gear size={15} weight="bold" style={{ opacity: 0.6, marginLeft: 2 }} />
        </button>

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
            <span>Ready • {timeStr}</span>
          </div>
        </div>
      </header>

      {/* Main Glass Neomorphic OTP Card */}
      <main className={`kiosk-card ${showDone ? 'leave' : ''}`} id="card">
        <div className="pane" />

        {/* Lock Icon */}
        <div className="lock">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
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
                {digit && (
                  <>
                    <span className="d">{digit}</span>
                    <i className="ring" />
                  </>
                )}
              </div>
            )
          })}
        </div>

        {/* Status Message Line */}
        <div className={`msg ${msg.isErr ? 'err' : ''}`} id="msg">
          <span>{msg.text}</span>
          {msg.isErr && msg.text.includes('Could not connect') && (
            <button
              type="button"
              className="msg-fix-btn"
              onClick={() => {
                setConfigDraftUrl(apiUrl)
                setConfigDraftId(kioskId)
                setPingStatus(null)
                setShowConfigModal(true)
              }}
            >
              Configure IP
            </button>
          )}
        </div>

        {/* 3x4 Neomorphic Keypad */}
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
                setTimeout(() => btn.classList.remove('p'), 150)
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

            <div style={{ margin: '0 auto 16px', display: 'inline-flex', padding: 12, borderRadius: 24, background: '#f8fafc', boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.06)' }}>
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

      {/* Technician / Station Configuration Modal */}
      {showConfigModal && (
        <div className="kiosk-qr-modal-backdrop" onClick={() => setShowConfigModal(false)}>
          <div className="kiosk-qr-modal-card config-modal-card" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              className="kiosk-qr-close-btn"
              onClick={() => setShowConfigModal(false)}
            >
              ✕
            </button>

            <div className="config-modal-icon">
              <Gear size={28} weight="bold" color="var(--red)" />
            </div>

            <h3 style={{ fontSize: '1.3rem', fontWeight: 800, margin: '0 0 6px', color: 'var(--tx)' }}>
              Station Spooler Setup
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--mu)', margin: '0 0 16px', lineHeight: 1.4 }}>
              Connect this touchscreen kiosk to your central backend API or PC.
            </p>

            <div className="config-form-group">
              <label>Backend API URL</label>
              <input
                type="text"
                value={configDraftUrl}
                onChange={e => setConfigDraftUrl(e.target.value)}
                placeholder="http://192.168.1.4:5000"
                className="config-input"
              />
              <div className="config-quick-chips">
                <button
                  type="button"
                  onClick={() => setConfigDraftUrl('http://192.168.1.4:5000')}
                >
                  Local PC: 192.168.1.4
                </button>
                <button
                  type="button"
                  onClick={() => setConfigDraftUrl('http://localhost:5000')}
                >
                  localhost:5000
                </button>
              </div>
            </div>

            <div className="config-form-group" style={{ marginTop: 12 }}>
              <label>Station ID</label>
              <input
                type="text"
                value={configDraftId}
                onChange={e => setConfigDraftId(e.target.value.toUpperCase())}
                placeholder="PB-001"
                className="config-input"
              />
            </div>

            {/* Test Ping Indicator */}
            {pingStatus && (
              <div className={`config-ping-box ${pingStatus.success ? 'ok' : 'err'}`}>
                {pingStatus.testing ? (
                  <span>Pinging {configDraftUrl}…</span>
                ) : pingStatus.success ? (
                  <>
                    <CheckCircle size={16} weight="fill" />
                    <span>{pingStatus.text}</span>
                  </>
                ) : (
                  <>
                    <WarningCircle size={16} weight="fill" />
                    <span>{pingStatus.text}</span>
                  </>
                )}
              </div>
            )}

            <div className="config-modal-actions">
              <button
                type="button"
                className="config-btn-secondary"
                onClick={testConnectionPing}
                disabled={pingStatus?.testing}
              >
                {pingStatus?.testing ? 'Testing…' : 'Test Ping'}
              </button>

              <button
                type="button"
                className="config-btn-primary"
                onClick={handleSaveConfig}
              >
                Save & Connect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
