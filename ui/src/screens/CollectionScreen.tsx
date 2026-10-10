import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import './CollectionScreen.css'

export default function CollectionScreen() {
  const navigate = useNavigate()

  // Return back to session QR display after 3 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      navigate('/session', { replace: true })
    }, 3000)
    return () => clearTimeout(timer)
  }, [navigate])

  return (
    <div className="kiosk-collect-screen">
      <div className="kiosk-collect-card">
        {/* Animated Green Tick */}
        <div className="kiosk-collect-tick-wrap">
          <svg className="kiosk-collect-tick-svg" viewBox="0 0 52 52">
            <circle className="kiosk-collect-tick-circle" cx="26" cy="26" r="23" fill="none" />
            <path className="kiosk-collect-tick-check" fill="none" d="M14.5 27.2l7.5 7.5 15.5-16.5" />
          </svg>
        </div>

        {/* Status Text */}
        <h1 className="kiosk-collect-text">
          Print completed, please collect from tray
        </h1>
      </div>
    </div>
  )
}
