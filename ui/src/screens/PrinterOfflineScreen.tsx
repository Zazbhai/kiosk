import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import PrinterErrorOverlay from '../components/PrinterErrorOverlay'
import { usePrinterStatus } from '../hooks/usePrinterStatus'

export default function PrinterOfflineScreen() {
  const navigate = useNavigate()
  const searchParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
  const kioskId =
    searchParams.get('kioskId') ||
    searchParams.get('id') ||
    localStorage.getItem('pb_kiosk_id') ||
    (window as any).__PRINTBOOTH_KIOSK_ID__ ||
    import.meta.env.VITE_KIOSK_ID ||
    'PB-001'

  const { isOffline, reason, detail } = usePrinterStatus(kioskId)

  // Polling to see if printer & network recover, then smoothly navigate back to kiosk home
  useEffect(() => {
    if (!isOffline && (typeof navigator === 'undefined' || navigator.onLine)) {
      navigate('/', { replace: true })
    }
  }, [isOffline, navigate])

  return (
    <div className="kiosk-screen" style={{ background: '#06110D' }}>
      <div className="kiosk-bg-mesh" />
      <PrinterErrorOverlay
        isOpen={true}
        title="PRINTER OFFLINE"
        reason={reason || 'Station is offline or network connection interrupted.'}
        detail={detail || 'PrintBooth is reconnecting and will resume automatically once connection is restored.'}
        kioskId={kioskId}
      />
    </div>
  )
}
