import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Key, CheckCircle, XCircle, ArrowCounterClockwise } from '@phosphor-icons/react'
import './KioskScreens.css'

export default function PinReleaseScreen() {
  const navigate = useNavigate()
  const kioskId = import.meta.env.VITE_KIOSK_ID || 'PB-001'
  const kioskName = import.meta.env.VITE_KIOSK_NAME || 'PrintBooth — Station'
  const apiUrl = import.meta.env.VITE_PRINTBOOTH_API_URL || import.meta.env.VITE_API_URL || 'http://localhost:5000'

  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successInfo, setSuccessInfo] = useState<{ orderNumber?: string; fileName?: string } | null>(null)

  const handleDigit = (digit: string) => {
    if (loading || successInfo) return
    setErrorMsg('')
    if (pin.length < 6) {
      const nextPin = pin + digit
      setPin(nextPin)
      if (nextPin.length === 6) {
        verifyPin(nextPin)
      }
    }
  }

  const handleBackspace = () => {
    if (loading || successInfo) return
    setErrorMsg('')
    setPin(prev => prev.slice(0, -1))
  }

  const handleClear = () => {
    if (loading || successInfo) return
    setErrorMsg('')
    setPin('')
  }

  const verifyPin = async (pinToVerify: string) => {
    setLoading(true)
    setErrorMsg('')
    try {
      const res = await fetch(`${apiUrl}/api/kiosks/${kioskId}/verify-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinToVerify }),
      })
      const data = await res.json()
      if (data.success) {
        setSuccessInfo({
          orderNumber: data.data?.orderNumber || 'PRINT-JOB',
          fileName: data.data?.fileName || 'Document',
        })
        setTimeout(() => {
          navigate('/printing')
        }, 1800)
      } else {
        setErrorMsg(data.error || 'Invalid or expired Pickup PIN. Please check your phone.')
      }
    } catch (err: any) {
      setErrorMsg('Could not contact station server. Please ensure kiosk is connected.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="kiosk-screen">
      <div className="kiosk-bg-mesh" />

      {/* Top statusbar */}
      <div className="kiosk-statusbar">
        <div className="statusbar__left">
          <div className="statusbar__dot" />
          <span className="statusbar__kiosk">{kioskId}</span>
          <span>{kioskName}</span>
        </div>
        <div className="statusbar__right">
          <span>Release Station</span>
        </div>
      </div>

      <div className="kiosk-container kiosk-enter" style={{ maxWidth: '560px', margin: '0 auto', textAlign: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <button
            className="kiosk-btn kiosk-btn-secondary"
            onClick={() => navigate('/')}
            style={{ padding: '8px 16px', fontSize: '14px', gap: '6px' }}
          >
            <ArrowLeft size={16} weight="bold" />
            Back
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--clr-accent-light)', fontSize: '13px', fontWeight: 600 }}>
            <Key size={18} weight="fill" />
            <span>Walk-up Pickup Code</span>
          </div>
        </div>

        <h2 className="kiosk-title" style={{ fontSize: '28px', marginBottom: '6px' }}>
          Enter 6-Digit Pickup PIN
        </h2>
        <p className="kiosk-subtitle" style={{ fontSize: '14px', marginBottom: '24px' }}>
          Type the release code shown on your phone after completing payment.
        </p>

        {/* PIN Box Display */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '12px',
            marginBottom: '20px',
          }}
        >
          {[0, 1, 2, 3, 4, 5].map((idx) => {
            const digit = pin[idx]
            const isCurrent = pin.length === idx
            return (
              <div
                key={idx}
                style={{
                  width: '56px',
                  height: '68px',
                  borderRadius: '12px',
                  border: isCurrent
                    ? '2px solid var(--clr-accent-light, #dc2626)'
                    : '1.5px solid rgba(255, 255, 255, 0.15)',
                  background: digit ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.25)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '32px',
                  fontWeight: 800,
                  color: '#fff',
                  boxShadow: isCurrent ? '0 0 16px rgba(220, 38, 38, 0.4)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                {digit || ''}
              </div>
            )
          })}
        </div>

        {/* Status Alerts */}
        {errorMsg && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 16px',
              borderRadius: '8px',
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              color: '#f87171',
              fontSize: '13px',
              marginBottom: '16px',
            }}
          >
            <XCircle size={18} weight="bold" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successInfo && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 18px',
              borderRadius: '8px',
              background: 'rgba(34, 197, 94, 0.15)',
              border: '1px solid rgba(34, 197, 94, 0.4)',
              color: '#4ade80',
              fontSize: '14px',
              fontWeight: 600,
              marginBottom: '16px',
            }}
          >
            <CheckCircle size={20} weight="fill" />
            <span>PIN Verified! Printing {successInfo.fileName}…</span>
          </div>
        )}

        {/* Touch Numpad */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '12px',
            maxWidth: '380px',
            margin: '0 auto',
          }}
        >
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
            <button
              key={num}
              type="button"
              onClick={() => handleDigit(num)}
              disabled={loading || Boolean(successInfo)}
              style={{
                height: '60px',
                borderRadius: '12px',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                background: 'rgba(255, 255, 255, 0.05)',
                color: '#fff',
                fontSize: '24px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.1s ease',
              }}
            >
              {num}
            </button>
          ))}
          <button
            type="button"
            onClick={handleClear}
            disabled={loading || Boolean(successInfo)}
            style={{
              height: '60px',
              borderRadius: '12px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              background: 'rgba(255, 255, 255, 0.03)',
              color: '#94a3b8',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            CLEAR
          </button>
          <button
            type="button"
            onClick={() => handleDigit('0')}
            disabled={loading || Boolean(successInfo)}
            style={{
              height: '60px',
              borderRadius: '12px',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              background: 'rgba(255, 255, 255, 0.05)',
              color: '#fff',
              fontSize: '24px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            0
          </button>
          <button
            type="button"
            onClick={handleBackspace}
            disabled={loading || Boolean(successInfo)}
            style={{
              height: '60px',
              borderRadius: '12px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              background: 'rgba(255, 255, 255, 0.03)',
              color: '#94a3b8',
              fontSize: '18px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ArrowCounterClockwise size={20} weight="bold" />
          </button>
        </div>
      </div>
    </div>
  )
}
