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

export default function App() {
  return (
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
