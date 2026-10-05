import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { File, ArrowLeft, ArrowRight } from '@phosphor-icons/react'
import './KioskScreens.css'

const MOCK_USB_FILES = [
  { name: 'assignment_final.pdf', size: '2.4 MB' },
  { name: 'resume_2026.pdf', size: '450 KB' },
  { name: 'notes_chapter5.pdf', size: '1.1 MB' },
  { name: 'form_application.pdf', size: '180 KB' },
]

export default function USBSelectScreen() {
  const navigate = useNavigate()
  const [selected, setSelected] = useState<string | null>(null)

  function handleContinue() {
    if (!selected) return
    sessionStorage.setItem('pb_file_name', selected)
    navigate('/settings')
  }

  return (
    <div className="kiosk-screen">
      <div className="kiosk-bg-mesh" />
      <div className="kiosk-statusbar">
        <div className="statusbar__left">
          <div className="statusbar__dot" />
          <span className="statusbar__kiosk">PB-001</span>
        </div>
      </div>

      <div className="kiosk-enter" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 32, marginTop: 48 }}>
        <div style={{ textAlign: 'center' }}>
          <h1 className="kiosk-title" style={{ fontSize: '2rem' }}>Select File</h1>
          <p className="kiosk-subtitle" style={{ marginTop: 10 }}>USB Drive — 4 files found</p>
        </div>

        <div className="usb-file-list">
          {MOCK_USB_FILES.map(f => (
            <button
              key={f.name}
              className={`usb-file-item ${selected === f.name ? 'selected' : ''}`}
              onClick={() => setSelected(f.name)}
              id={`usb-file-${f.name}`}
            >
              <File size={24} weight="duotone" style={{ color: 'var(--clr-accent-light)', flexShrink: 0 }} />
              <div style={{ flex: 1, textAlign: 'left' }}>
                <div className="usb-file-item__name">{f.name}</div>
                <div className="usb-file-item__size">{f.size}</div>
              </div>
            </button>
          ))}
        </div>

        <div className="kiosk-action-bar">
          <button
            className="kiosk-btn kiosk-btn-primary"
            onClick={handleContinue}
            disabled={!selected}
            style={{ opacity: selected ? 1 : 0.4 }}
            id="usb-continue"
          >
            <ArrowRight size={20} weight="bold" />
            Continue
          </button>
        </div>
      </div>

      <div className="kiosk-back">
        <button className="kiosk-btn kiosk-btn-ghost" onClick={() => navigate('/upload')} id="usb-back">
          <ArrowLeft size={20} />
          Back
        </button>
      </div>
    </div>
  )
}
