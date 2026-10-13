import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import TimerSvg from '../components/TimerSvg'
import './KioskScreens.css'

export default function PaymentScreen() {
  const navigate = useNavigate()
  const kioskId = localStorage.getItem('pb_kiosk_id') || 'PB-001'
  const kioskName = localStorage.getItem('pb_kiosk_name') || 'Station 1'
  const totalPrice = sessionStorage.getItem('pb_total_price') ?? '10'
  const [timeLeft, setTimeLeft] = useState(10 * 60)

  useEffect(() => {
    const timer = setInterval(() => setTimeLeft(t => Math.max(0, t - 1)), 1000)
    return () => clearInterval(timer)
  }, [])

  // Simulate payment after 5 seconds (demo)
  useEffect(() => {
    const demo = setTimeout(() => navigate('/printing'), 5000)
    return () => clearTimeout(demo)
  }, [navigate])

  const minutes = Math.floor(timeLeft / 60).toString().padStart(2, '0')
  const seconds = (timeLeft % 60).toString().padStart(2, '0')

  return (
    <div className="kiosk-screen">
      <div className="kiosk-bg-mesh" />
      <div className="kiosk-statusbar">
        <div className="statusbar__left">
          <button
            type="button"
            className="kiosk-nav-btn kiosk-nav-btn--back"
            onClick={() => navigate('/review')}
            id="pay-nav-back"
          >
            <span>←</span>
            <span>Back</span>
          </button>
        </div>
        <div className="statusbar__center">
          <div className="statusbar__pill">
            <div className="statusbar__dot" />
            <span className="statusbar__kiosk">{kioskId}</span>
            <span>•</span>
            <span>{kioskName}</span>
          </div>
        </div>
        <div className="statusbar__right">
          <button
            type="button"
            className="kiosk-nav-btn kiosk-nav-btn--cancel"
            onClick={() => navigate('/')}
            id="pay-nav-cancel"
          >
            <span>✕</span>
            <span>Cancel</span>
          </button>
        </div>
      </div>

      <div className="kiosk-payment kiosk-enter" style={{ margin: 'auto auto', gap: 16 }}>
        <h1 className="kiosk-title" style={{ fontSize: '2rem' }}>Pay ₹{totalPrice}</h1>
        <p className="kiosk-subtitle" style={{ margin: 0 }}>Scan with any UPI app to pay</p>

        <div className="kiosk-qr-box" style={{ padding: 14 }}>
          <svg width="200" height="200" viewBox="0 0 220 220" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="UPI payment QR code">
            <rect width="220" height="220" rx="8" fill="white"/>
            <rect x="10" y="10" width="70" height="70" rx="4" fill="#dc2626"/>
            <rect x="20" y="20" width="50" height="50" rx="2" fill="white"/>
            <rect x="30" y="30" width="30" height="30" rx="1" fill="#dc2626"/>
            <rect x="140" y="10" width="70" height="70" rx="4" fill="#dc2626"/>
            <rect x="150" y="20" width="50" height="50" rx="2" fill="white"/>
            <rect x="160" y="30" width="30" height="30" rx="1" fill="#dc2626"/>
            <rect x="10" y="140" width="70" height="70" rx="4" fill="#dc2626"/>
            <rect x="20" y="150" width="50" height="50" rx="2" fill="white"/>
            <rect x="30" y="160" width="30" height="30" rx="1" fill="#dc2626"/>
            {[100, 110, 120, 130, 140].map(x =>
              [100, 110, 120, 130, 140, 150].map(y =>
                Math.sin(x * 0.5 + y * 0.3) > 0.15 ? (
                  <rect key={`${x}-${y}`} x={x} y={y} width="9" height="9" fill="#09090b" />
                ) : null
              )
            )}
          </svg>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="kiosk-waiting" style={{ margin: 0 }}>
            <div className="kiosk-waiting__dot" />
            <span>Waiting for payment…</span>
          </div>

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 999, fontSize: 12, fontWeight: 700, color: '#0f172a' }}>
            <TimerSvg size={16} />
            <span>{minutes}:{seconds}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
