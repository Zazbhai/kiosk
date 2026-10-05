import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle } from '@phosphor-icons/react'
import './KioskScreens.css'

export default function CollectionScreen() {
  const navigate = useNavigate()

  // Auto-return to home after 20 seconds
  useEffect(() => {
    const timer = setTimeout(() => navigate('/'), 20000)
    return () => clearTimeout(timer)
  }, [navigate])

  return (
    <div className="kiosk-screen">
      <div className="kiosk-bg-mesh" />
      <div className="kiosk-statusbar">
        <div className="statusbar__left"><div className="statusbar__dot" /><span className="statusbar__kiosk">PB-001</span></div>
      </div>

      <div className="kiosk-collection kiosk-enter" style={{ marginTop: 48 }}>
        <CheckCircle size={100} weight="fill" className="kiosk-success-icon" />

        <h1 className="kiosk-title">
          Your prints are ready!
        </h1>

        <p className="kiosk-subtitle" style={{ maxWidth: '40ch' }}>
          Please collect your document from the output tray below.
          Thank you for using PrintBooth.
        </p>

        <div style={{
          padding: '20px 40px',
          background: 'var(--clr-success-dim)',
          border: '1px solid rgba(16,185,129,0.3)',
          borderRadius: 'var(--radius-xl)',
          fontSize: '1rem',
          color: 'var(--clr-success)',
          fontWeight: 500,
        }}>
          ↓ Output tray below
        </div>

        <button
          className="kiosk-btn kiosk-btn-secondary"
          onClick={() => navigate('/')}
          id="collect-done"
          style={{ marginTop: 16 }}
        >
          Tap to dismiss
        </button>

        <p style={{ fontSize: '0.75rem', color: 'var(--clr-text-4)', fontFamily: 'var(--font-mono)' }}>
          Auto-returning to home in 20 seconds
        </p>
      </div>
    </div>
  )
}
