import { useNavigate } from 'react-router-dom'
import { XCircle } from '@phosphor-icons/react'
import './KioskScreens.css'

export default function ErrorScreen() {
  const navigate = useNavigate()

  return (
    <div className="kiosk-screen">
      <div className="kiosk-bg-mesh" />
      <div className="kiosk-error kiosk-enter">
        <XCircle size={80} weight="fill" className="kiosk-error__icon" />
        <h1 className="kiosk-error__title">Something went wrong</h1>
        <p className="kiosk-error__sub">
          There was an error processing your request. Your money has not been charged.
          Please try again or contact support.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, fontSize: '0.85rem', color: 'var(--clr-text-3)', textAlign: 'center' }}>
          <p>Support: +91 90906 36363 / team1printbooth@gmail.com</p>
        </div>
        <button className="kiosk-btn kiosk-btn-primary" onClick={() => navigate('/')} id="error-home">
          Return to Home
        </button>
      </div>
    </div>
  )
}
