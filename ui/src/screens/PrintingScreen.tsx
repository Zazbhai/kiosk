import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Printer } from '@phosphor-icons/react'
import './KioskScreens.css'

export default function PrintingScreen() {
  const navigate = useNavigate()
  const fileName = sessionStorage.getItem('pb_file_name') ?? 'document.pdf'
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    let p = 0
    const timer = setInterval(() => {
      p += 7
      setProgress(Math.min(100, p))
      if (p >= 100) {
        clearInterval(timer)
        setTimeout(() => navigate('/collect'), 800)
      }
    }, 400)
    return () => clearInterval(timer)
  }, [navigate])

  return (
    <div className="kiosk-screen">
      <div className="kiosk-bg-mesh" />
      <div className="kiosk-statusbar">
        <div className="statusbar__left"><div className="statusbar__dot" /><span className="statusbar__kiosk">PB-001</span></div>
        <div className="statusbar__right"><span>Printing…</span></div>
      </div>

      <div className="kiosk-printing kiosk-enter" style={{ marginTop: 48 }}>
        <div className="kiosk-printer-icon">
          <Printer size={80} weight="duotone" style={{ color: 'var(--clr-accent-light)' }} />
        </div>

        <h1 className="kiosk-title" style={{ fontSize: '2.2rem' }}>Printing…</h1>
        <p className="kiosk-subtitle">{fileName}</p>

        <div className="kiosk-progress-wrap">
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: 'var(--clr-text-3)' }}>
            <span>Progress</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--clr-text-1)' }}>{progress}%</span>
          </div>
          <div className="kiosk-progress-bar">
            <div className="kiosk-progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <p className="kiosk-print-info">Please do not remove any USB drives or power off the kiosk.</p>
      </div>
    </div>
  )
}
