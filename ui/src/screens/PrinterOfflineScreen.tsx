import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { PrinterErrorOverlay } from '../components/PrinterErrorOverlay'

export default function PrinterOfflineScreen() {
  const navigate = useNavigate()

  // Polling to see if printer recovers
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const kioskId = localStorage.getItem('pb_kiosk_id') || 'PB-001'
        const apiUrl = (localStorage.getItem('pb_api_url') || '').replace(/\/api$/, '')
        
        // 1. Try local printer status
        const localRes = await fetch('/api/printer/status').catch(() => null)
        if (localRes && localRes.ok) {
          const localData = await localRes.json()
          if (localData.isOnline) {
            navigate('/')
            return
          }
        }

        // 2. Try backend kiosk status
        const netRes = await fetch(`${apiUrl}/api/kiosks/${kioskId}`).catch(() => null)
        if (netRes && netRes.ok) {
          const netData = await netRes.json()
          const k = netData.data || netData
          const pStatus = String(k.printerStatus || '').toUpperCase()
          if (k.status === 'ONLINE' && (pStatus === 'READY' || pStatus === 'IDLE')) {
            navigate('/')
            return
          }
        }
      } catch {}
    }

    const interval = setInterval(checkStatus, 3500)
    return () => clearInterval(interval)
  }, [navigate])

  return (
    <PrinterErrorOverlay
      isOpen={true}
      title="PRINTER OFFLINE"
      reason="The printer is currently offline or rebooting after a power cycle."
      detail="The station is auto-recovering and will resume automatically as soon as the printer is ready."
    />
  )
}
