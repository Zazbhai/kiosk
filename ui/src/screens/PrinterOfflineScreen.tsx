import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export default function PrinterOfflineScreen() {
  const navigate = useNavigate()

  // Polling to see if printer recovers, then navigate to home
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const kioskId = localStorage.getItem('pb_kiosk_id') || 'PB-001'
        const apiUrl = (localStorage.getItem('pb_api_url') || '').replace(/\/api$/, '')

        // 1. Try local printer status
        const localRes = await fetch('/api/printer/status', { signal: AbortSignal.timeout(3000) }).catch(() => null)
        if (localRes && localRes.ok) {
          const localData = await localRes.json()
          if (localData.isOnline) {
            navigate('/', { replace: true })
            return
          }
        }

        // 2. Try backend kiosk status
        const netRes = await fetch(`${apiUrl}/api/kiosks/${kioskId}`, { signal: AbortSignal.timeout(3000) }).catch(() => null)
        if (netRes && netRes.ok) {
          const netData = await netRes.json()
          const k = netData.data || netData
          const pStatus = String(k.printerStatus || '').toUpperCase()
          if (k.status === 'ONLINE' && (pStatus === 'READY' || pStatus === 'IDLE')) {
            navigate('/', { replace: true })
            return
          }
        }
      } catch {}
    }

    const interval = setInterval(checkStatus, 4000)
    return () => clearInterval(interval)
  }, [navigate])

  // The global PrinterErrorOverlay in App.tsx already provides the full-screen takeover.
  // Rendering an empty kiosk background avoids portal duplication and z-fighting.
  return (
    <div className="kiosk-screen" style={{ background: '#06110D' }}>
      <div className="kiosk-bg-mesh" />
    </div>
  )
}
