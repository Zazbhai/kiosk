import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import PrinterErrorOverlay from '../components/PrinterErrorOverlay'

export default function PrinterOfflineScreen() {
  const navigate = useNavigate()

  // Polling to see if printer & network recover, then navigate to home
  useEffect(() => {
    const checkStatus = async () => {
      // If network is completely offline, wait for network event
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return
      }

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

    const interval = setInterval(checkStatus, 3500)
    window.addEventListener('online', checkStatus)
    return () => {
      clearInterval(interval)
      window.removeEventListener('online', checkStatus)
    }
  }, [navigate])

  return (
    <div className="kiosk-screen" style={{ background: '#06110D' }}>
      <div className="kiosk-bg-mesh" />
      <PrinterErrorOverlay
        isOpen={true}
        title="PRINTER OFFLINE"
        reason="Station is offline or network connection interrupted."
        detail="PrintBooth is reconnecting and will resume automatically once connection is restored."
      />
    </div>
  )
}
