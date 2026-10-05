import { useNavigate } from 'react-router-dom'
import { ArrowRight, QrCode, Key } from '@phosphor-icons/react'
import './KioskScreens.css'

export default function WelcomeScreen() {
  const navigate = useNavigate()
  const kioskId = import.meta.env.VITE_KIOSK_ID || 'PB-001'
  const kioskName = import.meta.env.VITE_KIOSK_NAME || 'PrintBooth — Test Station'

  return (
    <div className="kiosk-screen">
      <div className="kiosk-bg-mesh" />

      {/* Status bar */}
      <div className="kiosk-statusbar">
        <div className="statusbar__left">
          <div className="statusbar__dot" />
          <span className="statusbar__kiosk">{kioskId}</span>
          <span>{kioskName}</span>
        </div>
        <div className="statusbar__right">
          <span>Printer: Ready</span>
          <span>Paper: 100%</span>
          <span id="kiosk-time" />
        </div>
      </div>

      {/* Main content */}
      <div className="kiosk-welcome kiosk-enter">
        <div className="kiosk-welcome__text">
          <h1 className="kiosk-title">
            Welcome to<br />
            <span style={{ color: 'var(--clr-accent-light)' }}>PrintBooth</span>
          </h1>
          <p className="kiosk-subtitle">
            Print your documents quickly and easily.<br />
            Scan a QR, insert a USB drive, or enter a pickup PIN.
          </p>
        </div>

        <div className="kiosk-welcome__actions" style={{ display: 'flex', flexDirection: 'column', gap: '14px', alignItems: 'center' }}>
          <button
            className="kiosk-btn kiosk-btn-primary kiosk-pulse"
            onClick={() => navigate('/upload')}
            id="kiosk-start"
            style={{ width: '100%', maxWidth: '380px' }}
          >
            <ArrowRight size={24} weight="bold" />
            START PRINTING
          </button>

          <button
            className="kiosk-btn kiosk-btn-secondary"
            onClick={() => navigate('/pickup')}
            id="kiosk-enter-pin"
            style={{ width: '100%', maxWidth: '380px', background: 'rgba(255, 255, 255, 0.08)', borderColor: 'rgba(255, 255, 255, 0.2)' }}
          >
            <Key size={22} weight="bold" />
            ENTER PICKUP PIN
          </button>
        </div>

        <div className="kiosk-welcome__qr-hint">
          <QrCode size={18} />
          <span>Scan to upload from your phone</span>
        </div>
      </div>
    </div>
  )
}
