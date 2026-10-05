import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import './KioskScreens.css'

export default function PaymentScreen() {
  const navigate = useNavigate()
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
        <div className="statusbar__left"><div className="statusbar__dot" /><span className="statusbar__kiosk">PB-001</span></div>
        <div className="statusbar__right"><span>Expires: {minutes}:{seconds}</span></div>
      </div>

      <div className="kiosk-payment kiosk-enter" style={{ marginTop: 48 }}>
        <h1 className="kiosk-title" style={{ fontSize: '2rem' }}>Pay ₹{totalPrice}</h1>
        <p className="kiosk-subtitle">Scan with any UPI app to pay</p>

        <div className="kiosk-qr-box">
          <svg width="220" height="220" viewBox="0 0 220 220" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="UPI payment QR code">
            <rect width="220" height="220" rx="8" fill="white"/>
            <rect x="10" y="10" width="70" height="70" rx="4" fill="#c8ff00"/>
            <rect x="20" y="20" width="50" height="50" rx="2" fill="white"/>
            <rect x="30" y="30" width="30" height="30" rx="1" fill="#c8ff00"/>
            <rect x="140" y="10" width="70" height="70" rx="4" fill="#c8ff00"/>
            <rect x="150" y="20" width="50" height="50" rx="2" fill="white"/>
            <rect x="160" y="30" width="30" height="30" rx="1" fill="#c8ff00"/>
            <rect x="10" y="140" width="70" height="70" rx="4" fill="#c8ff00"/>
            <rect x="20" y="150" width="50" height="50" rx="2" fill="white"/>
            <rect x="30" y="160" width="30" height="30" rx="1" fill="#c8ff00"/>
            {[100, 110, 120, 130, 140].map(x =>
              [100, 110, 120, 130, 140, 150].map(y =>
                Math.sin(x * 0.5 + y * 0.3) > 0.15 ? (
                  <rect key={`${x}-${y}`} x={x} y={y} width="9" height="9" fill="#06110D" />
                ) : null
              )
            )}
          </svg>
        </div>

        <div className="kiosk-waiting">
          <div className="kiosk-waiting__dot" />
          <span>Waiting for payment…</span>
        </div>

        <p style={{ fontSize: '0.8rem', color: 'var(--clr-text-3)' }}>
          Do not close or restart the machine while payment is pending.
        </p>
      </div>
    </div>
  )
}
