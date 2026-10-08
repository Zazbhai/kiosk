import { Routes, Route, Navigate } from 'react-router-dom'
import WelcomeScreen from './screens/WelcomeScreen'
import UploadMethodScreen from './screens/UploadMethodScreen'
import QRUploadScreen from './screens/QRUploadScreen'
import USBSelectScreen from './screens/USBSelectScreen'
import PrintSettingsScreen from './screens/PrintSettingsScreen'
import ReviewScreen from './screens/ReviewScreen'
import PaymentScreen from './screens/PaymentScreen'
import PrintingScreen from './screens/PrintingScreen'
import CollectionScreen from './screens/CollectionScreen'
import PinReleaseScreen from './screens/PinReleaseScreen'
import ErrorScreen from './screens/ErrorScreen'
import NetworkOfflineScreen from './screens/NetworkOfflineScreen'
import PrinterOfflineScreen from './screens/PrinterOfflineScreen'
import PrinterErrorOverlay from './components/PrinterErrorOverlay'
import { usePrinterStatus } from './hooks/usePrinterStatus'

export default function App() {
  const searchParams = new URLSearchParams(window.location.search)
  const kioskId =
    searchParams.get('kioskId') ||
    searchParams.get('id') ||
    localStorage.getItem('pb_kiosk_id') ||
    (window as any).__PRINTBOOTH_KIOSK_ID__ ||
    import.meta.env.VITE_KIOSK_ID ||
    'PB-001'

  const kioskName =
    localStorage.getItem('pb_kiosk_name') ||
    (window as any).__PRINTBOOTH_KIOSK_NAME__ ||
    import.meta.env.VITE_KIOSK_NAME ||
    'Station 1'

  const { isOffline, reason, detail } = usePrinterStatus(kioskId)

  return (
    <>
      <Routes>
        <Route path="/" element={<PinReleaseScreen />} />
        <Route path="/pin" element={<PinReleaseScreen />} />
        <Route path="/pickup" element={<PinReleaseScreen />} />
        <Route path="/welcome" element={<WelcomeScreen />} />
        <Route path="/upload" element={<UploadMethodScreen />} />
        <Route path="/upload/qr" element={<QRUploadScreen />} />
        <Route path="/upload/usb" element={<USBSelectScreen />} />
        <Route path="/settings" element={<PrintSettingsScreen />} />
        <Route path="/review" element={<ReviewScreen />} />
        <Route path="/payment" element={<PaymentScreen />} />
        <Route path="/printing" element={<PrintingScreen />} />
        <Route path="/collect" element={<CollectionScreen />} />
        <Route path="/error" element={<ErrorScreen />} />
        <Route path="/offline" element={<NetworkOfflineScreen />} />
        <Route path="/printer-offline" element={<PrinterOfflineScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* Global Printer Offline Overlay — Displays when printer is disconnected or cold-booting */}
      <PrinterErrorOverlay
        isOpen={isOffline}
        title="PRINTER OFFLINE"
        reason={reason}
        detail={detail}
        kioskId={kioskId}
        kioskName={kioskName}
      />
    </>
  )
}
