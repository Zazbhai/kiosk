import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight } from '@phosphor-icons/react'
import './KioskScreens.css'

export default function PrintSettingsScreen() {
  const navigate = useNavigate()
  const fileName = sessionStorage.getItem('pb_file_name') ?? 'document.pdf'

  const [copies, setCopies] = useState(1)
  const [colour, setColour] = useState<'BW' | 'COLOUR'>('BW')
  const [duplex, setDuplex] = useState<'SINGLE' | 'DOUBLE'>('SINGLE')

  const pricePerPage = colour === 'BW' ? (duplex === 'SINGLE' ? 2 : 3) : (duplex === 'SINGLE' ? 8 : 12)
  const estimatedPages = 5
  const total = estimatedPages * copies * pricePerPage

  function handleContinue() {
    sessionStorage.setItem('pb_settings', JSON.stringify({ copies, colour, duplex }))
    sessionStorage.setItem('pb_total_price', String(total))
    navigate('/review')
  }

  return (
    <div className="kiosk-screen" style={{ justifyContent: 'flex-start', paddingTop: 80 }}>
      <div className="kiosk-bg-mesh" />
      <div className="kiosk-statusbar">
        <div className="statusbar__left">
          <div className="statusbar__dot" />
          <span className="statusbar__kiosk">PB-001</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{fileName}</span>
        </div>
      </div>

      <div className="kiosk-enter" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28, width: '100%' }}>
        <h1 className="kiosk-title" style={{ fontSize: '2rem' }}>Print Settings</h1>

        <div className="kiosk-settings">
          {/* Colour */}
          <div className="kiosk-setting-row">
            <span className="kiosk-setting-label">Colour</span>
            <div className="kiosk-radio-group">
              {(['BW', 'COLOUR'] as const).map(c => (
                <button
                  key={c}
                  className={`kiosk-radio ${colour === c ? 'selected' : ''}`}
                  onClick={() => setColour(c)}
                  id={`setting-colour-${c}`}
                >
                  {c === 'BW' ? 'Black & White' : 'Colour'}
                </button>
              ))}
            </div>
          </div>

          {/* Duplex */}
          <div className="kiosk-setting-row">
            <span className="kiosk-setting-label">Sides</span>
            <div className="kiosk-radio-group">
              {(['SINGLE', 'DOUBLE'] as const).map(d => (
                <button
                  key={d}
                  className={`kiosk-radio ${duplex === d ? 'selected' : ''}`}
                  onClick={() => setDuplex(d)}
                  id={`setting-duplex-${d}`}
                >
                  {d === 'SINGLE' ? 'Single-sided' : 'Double-sided'}
                </button>
              ))}
            </div>
          </div>

          {/* Copies */}
          <div className="kiosk-setting-row">
            <span className="kiosk-setting-label">Copies</span>
            <div className="kiosk-counter">
              <button
                className="kiosk-counter-btn"
                onClick={() => setCopies(c => Math.max(1, c - 1))}
                disabled={copies <= 1}
                id="copies-dec"
              >−</button>
              <span className="kiosk-counter-value">{copies}</span>
              <button
                className="kiosk-counter-btn"
                onClick={() => setCopies(c => Math.min(50, c + 1))}
                disabled={copies >= 50}
                id="copies-inc"
              >+</button>
            </div>
          </div>
        </div>

        {/* Estimate */}
        <div style={{ textAlign: 'center', color: 'var(--clr-text-3)', fontSize: '0.9rem' }}>
          Estimated total: <span style={{ color: 'var(--clr-accent-light)', fontWeight: 700, fontSize: '1.2rem', fontFamily: 'var(--font-mono)' }}>₹{total}</span>
        </div>

        <div className="kiosk-action-bar">
          <button className="kiosk-btn kiosk-btn-primary" onClick={handleContinue} id="settings-kiosk-continue">
            <ArrowRight size={20} weight="bold" />
            Review Order
          </button>
        </div>
      </div>

      <div className="kiosk-back">
        <button className="kiosk-btn kiosk-btn-ghost" onClick={() => navigate('/upload')} id="settings-back">
          <ArrowLeft size={20} />
          Back
        </button>
      </div>
    </div>
  )
}
