import { useNavigate } from 'react-router-dom'
import './KioskScreens.css'

export default function ReviewScreen() {
  const navigate = useNavigate()
  const kioskId = localStorage.getItem('pb_kiosk_id') || 'PB-001'
  const kioskName = localStorage.getItem('pb_kiosk_name') || 'Station 1'
  const fileName = sessionStorage.getItem('pb_file_name') ?? 'document.pdf'
  const totalPrice = sessionStorage.getItem('pb_total_price') ?? '10'
  const rawSettings = sessionStorage.getItem('pb_settings')
  const settings = rawSettings ? JSON.parse(rawSettings) : { copies: 1, colour: 'BW', duplex: 'SINGLE' }

  return (
    <div className="kiosk-screen">
      <div className="kiosk-bg-mesh" />
      <div className="kiosk-statusbar">
        <div className="statusbar__left">
          <button
            type="button"
            className="kiosk-nav-btn kiosk-nav-btn--back"
            onClick={() => navigate('/settings')}
            id="review-nav-back"
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
            id="review-nav-cancel"
          >
            <span>✕</span>
            <span>Cancel</span>
          </button>
        </div>
      </div>

      <div className="kiosk-enter" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, margin: 'auto auto', width: '100%', maxWidth: 520 }}>
        <h1 className="kiosk-title" style={{ fontSize: '2rem' }}>Review Order</h1>

        <div className="kiosk-review" style={{ width: '100%' }}>
          <div className="kiosk-review-card">
            {[
              { label: 'Document', value: fileName },
              { label: 'Colour', value: String(settings.colour || settings.colourMode || '').toUpperCase().includes('COL') ? 'Colour' : 'Black & White' },
              { label: 'Sides', value: (String(settings.duplex || settings.duplexMode || '').toUpperCase().includes('DOUB') || String(settings.duplex || '').includes('2')) ? 'Double-sided' : 'Single-sided' },
              { label: 'Copies', value: settings.copies || 1 },
            ].map(row => (
              <div key={row.label} className="kiosk-review-row">
                <span className="kiosk-review-row__label">{row.label}</span>
                <span className="kiosk-review-row__value">{row.value}</span>
              </div>
            ))}
          </div>

          <div className="kiosk-total-row" style={{ borderRadius: 'var(--radius-xl)', marginTop: 12 }}>
            <span style={{ fontSize: '1rem', color: 'var(--clr-text-1)', fontWeight: 600 }}>Total Amount</span>
            <span className="kiosk-total-amount">₹{totalPrice}</span>
          </div>
        </div>

        <div className="kiosk-action-bar" style={{ width: '100%', marginTop: 6 }}>
          <button className="kiosk-btn kiosk-btn-primary" onClick={() => navigate('/payment')} style={{ width: '100%' }} id="review-pay">
            Proceed to Payment
          </button>
        </div>
      </div>
    </div>
  )
}
