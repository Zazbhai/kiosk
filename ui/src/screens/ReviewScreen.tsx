import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from '@phosphor-icons/react'
import './KioskScreens.css'

export default function ReviewScreen() {
  const navigate = useNavigate()
  const fileName = sessionStorage.getItem('pb_file_name') ?? 'document.pdf'
  const totalPrice = sessionStorage.getItem('pb_total_price') ?? '10'
  const rawSettings = sessionStorage.getItem('pb_settings')
  const settings = rawSettings ? JSON.parse(rawSettings) : { copies: 1, colour: 'BW', duplex: 'SINGLE' }

  return (
    <div className="kiosk-screen">
      <div className="kiosk-bg-mesh" />
      <div className="kiosk-statusbar">
        <div className="statusbar__left"><div className="statusbar__dot" /><span className="statusbar__kiosk">PB-001</span></div>
      </div>

      <div className="kiosk-enter" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 32, marginTop: 48 }}>
        <h1 className="kiosk-title" style={{ fontSize: '2rem' }}>Review Order</h1>

        <div className="kiosk-review">
          <div className="kiosk-review-card">
            {[
              { label: 'Document', value: fileName },
              { label: 'Colour', value: settings.colour === 'BW' ? 'Black & White' : 'Colour' },
              { label: 'Sides', value: settings.duplex === 'DOUBLE' ? 'Double-sided' : 'Single-sided' },
              { label: 'Copies', value: settings.copies },
            ].map(row => (
              <div key={row.label} className="kiosk-review-row">
                <span className="kiosk-review-row__label">{row.label}</span>
                <span className="kiosk-review-row__value">{row.value}</span>
              </div>
            ))}
          </div>

          <div className="kiosk-total-row" style={{ borderRadius: 'var(--radius-xl)' }}>
            <span style={{ fontSize: '1rem', color: 'var(--clr-text-1)', fontWeight: 600 }}>Total Amount</span>
            <span className="kiosk-total-amount">₹{totalPrice}</span>
          </div>
        </div>

        <div className="kiosk-action-bar">
          <button className="kiosk-btn kiosk-btn-primary" onClick={() => navigate('/payment')} id="review-pay">
            Proceed to Payment
          </button>
        </div>
      </div>

      <div className="kiosk-back">
        <button className="kiosk-btn kiosk-btn-ghost" onClick={() => navigate('/settings')} id="review-back">
          <ArrowLeft size={20} />
          Back
        </button>
      </div>
    </div>
  )
}
