import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import {
  Key,
  CheckCircle,
  XCircle,
  QrCode,
  Usb,
  Printer,
} from '@phosphor-icons/react'
import { CustomKioskKeyboard } from '../components/CustomKioskKeyboard'
import './KioskScreens.css'
import './PinReleaseScreen.css'

export default function PinReleaseScreen() {
  const navigate = useNavigate()
  const kioskId = import.meta.env.VITE_KIOSK_ID || 'PB-001'
  const kioskName = import.meta.env.VITE_KIOSK_NAME || 'PrintBooth — Station 1'
  const apiUrl =
    import.meta.env.VITE_PRINTBOOTH_API_URL ||
    import.meta.env.VITE_API_URL ||
    'http://localhost:5000'

  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [isShaking, setIsShaking] = useState(false)
  const [successInfo, setSuccessInfo] = useState<{
    orderNumber?: string
    fileName?: string
    pageCount?: number
  } | null>(null)

  // Real upload URL for this specific kiosk
  const webAppUrl =
    import.meta.env.VITE_CUSTOMER_WEB_URL ||
    'http://localhost:5200'
  const kioskQrUrl = `${webAppUrl}/print?id=${encodeURIComponent(kioskId)}`

  // Live clock for kiosk header
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

  const verifyPin = useCallback(
    async (pinToVerify: string) => {
      if (pinToVerify.length < 4) {
        setErrorMsg('Please enter at least 4 digits')
        return
      }
      setLoading(true)
      setErrorMsg('')

      try {
        // 1. Primary endpoint: /api/kiosks/:id/verify-pin
        const res = await fetch(`${apiUrl}/api/kiosks/${kioskId}/verify-pin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: pinToVerify, kioskId }),
        })
        const data = await res.json()

        if (data.success || data.valid) {
          setSuccessInfo({
            orderNumber: data.data?.orderNumber || data.orderNumber || 'PRINT-JOB',
            fileName: data.data?.fileName || data.fileName || 'Document',
            pageCount: data.data?.pageCount || data.pageCount || 1,
          })
          setTimeout(() => {
            navigate('/printing')
          }, 1600)
          return
        }

        // 2. Secondary fallback endpoint: /api/print/verify-pin
        const res2 = await fetch(`${apiUrl}/api/print/verify-pin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kioskId, pin: pinToVerify }),
        })
        const data2 = await res2.json()

        if (data2.success || data2.valid) {
          setSuccessInfo({
            orderNumber: data2.data?.orderNumber || data2.orderNumber || 'PRINT-JOB',
            fileName: data2.data?.fileName || data2.fileName || 'Document',
            pageCount: data2.data?.pageCount || data2.pageCount || 1,
          })
          setTimeout(() => {
            navigate('/printing')
          }, 1600)
          return
        }

        // If both failed, display error
        setErrorMsg(
          data.error ||
            data2.error ||
            'Invalid or expired PIN. Please check the code on your phone screen.'
        )
        setIsShaking(true)
        setTimeout(() => setIsShaking(false), 500)
      } catch (err: any) {
        setErrorMsg('Could not contact station print server. Please check connection.')
        setIsShaking(true)
        setTimeout(() => setIsShaking(false), 500)
      } finally {
        setLoading(false)
      }
    },
    [apiUrl, kioskId, navigate]
  )

  const handleKeyPress = useCallback(
    (char: string) => {
      if (loading || successInfo) return
      setErrorMsg('')
      if (pin.length < 6) {
        const nextPin = pin + char
        setPin(nextPin)
        if (nextPin.length === 6) {
          verifyPin(nextPin)
        }
      }
    },
    [loading, successInfo, pin, verifyPin]
  )

  const handleBackspace = useCallback(() => {
    if (loading || successInfo) return
    setErrorMsg('')
    setPin(prev => prev.slice(0, -1))
  }, [loading, successInfo])

  const handleClear = useCallback(() => {
    if (loading || successInfo) return
    setErrorMsg('')
    setPin('')
  }, [loading, successInfo])

  const handleSubmit = useCallback(() => {
    if (loading || successInfo) return
    if (!pin) {
      setErrorMsg('Please enter your pickup PIN')
      return
    }
    verifyPin(pin)
  }, [loading, successInfo, pin, verifyPin])

  return (
    <div className="kiosk-screen">
      <div className="kiosk-bg-mesh" />

      {/* Top Station Status Bar */}
      <div className="kiosk-statusbar">
        <div className="statusbar__left">
          <div className="statusbar__dot" />
          <span className="statusbar__kiosk">{kioskId}</span>
          <span>{kioskName}</span>
        </div>
        <div className="statusbar__right">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Printer size={15} weight="bold" color="var(--clr-accent-light)" />
            Printer: Ready
          </span>
          <span>Paper: 100%</span>
          <span>{timeStr}</span>
        </div>
      </div>

      {/* Main Dual-Column Interactive Surface */}
      <div className="kiosk-pin-screen-layout kiosk-enter">
        {/* Left Column: Enter PIN & Custom Touch Keyboard */}
        <div className="kiosk-pin-main-col">
          <div className="kiosk-pin-badge">
            <Key size={15} weight="fill" />
            <span>Walk-up Print Release</span>
          </div>

          <h1 className="kiosk-pin-title">Enter Pickup PIN</h1>
          <p className="kiosk-pin-sub">
            Type the 6-digit release code displayed on your phone after completing payment.
          </p>

          {/* 6 Digit Display Slots */}
          <div
            className={`kiosk-pin-slots-row ${isShaking ? 'is-error' : ''}`}
            aria-label="PIN Code Input"
          >
            {[0, 1, 2, 3, 4, 5].map(idx => {
              const digit = pin[idx]
              const isCurrent = pin.length === idx && !loading && !successInfo
              const isFilled = Boolean(digit)

              return (
                <div
                  key={idx}
                  className={`kiosk-pin-slot ${isFilled ? 'is-filled' : ''} ${
                    isCurrent ? 'is-active' : ''
                  }`}
                >
                  {digit ? (
                    digit
                  ) : isCurrent ? (
                    <div className="kiosk-pin-cursor" />
                  ) : (
                    ''
                  )}
                </div>
              )
            })}
          </div>

          {/* Status Alert Banners */}
          {loading && (
            <div className="kiosk-feedback-box loading">
              <div className="kiosk-spinner-dot" />
              <span>Verifying PIN with local printer spooler…</span>
            </div>
          )}

          {errorMsg && !loading && (
            <div className="kiosk-feedback-box error">
              <XCircle size={18} weight="bold" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successInfo && (
            <div className="kiosk-feedback-box success">
              <CheckCircle size={20} weight="fill" />
              <span>
                PIN Verified! Releasing order {successInfo.orderNumber} ({successInfo.fileName})…
              </span>
            </div>
          )}

          {/* Custom On-Screen Virtual Keyboard */}
          <CustomKioskKeyboard
            onKeyPress={handleKeyPress}
            onBackspace={handleBackspace}
            onClear={handleClear}
            onSubmit={handleSubmit}
            disabled={loading || Boolean(successInfo)}
            submitLabel={loading ? 'VERIFYING…' : 'PRINT NOW'}
            showAlphaToggle={true}
          />
        </div>

        {/* Right Column: Scan QR to Upload from Phone */}
        <div className="kiosk-pin-side-col">
          <div className="kiosk-qr-box">
            <QRCodeSVG
              value={kioskQrUrl}
              size={180}
              level="H"
              includeMargin={false}
              fgColor="#06110D"
              bgColor="#ffffff"
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--clr-accent-light)', marginBottom: 6 }}>
            <QrCode size={18} weight="bold" />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em' }}>
              DIRECT MOBILE UPLOAD
            </span>
          </div>

          <h3 className="kiosk-qr-title">Don't Have a PIN Yet?</h3>
          <p className="kiosk-qr-sub">
            Scan this QR code with your phone camera to select documents, choose print settings, and get your instant PIN.
          </p>

          <button
            type="button"
            className="kiosk-usb-opt-btn"
            onClick={() => navigate('/upload/usb')}
          >
            <Usb size={20} weight="bold" color="var(--clr-accent-light)" />
            <span>Or Print from USB Flash Drive</span>
          </button>
        </div>
      </div>
    </div>
  )
}
