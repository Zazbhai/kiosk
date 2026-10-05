import { WifiSlash } from '@phosphor-icons/react'
import './KioskScreens.css'

export default function NetworkOfflineScreen() {
  return (
    <div className="kiosk-screen">
      <div className="kiosk-bg-mesh" />
      <div className="kiosk-error kiosk-enter">
        <WifiSlash size={80} weight="duotone" style={{ color: 'var(--clr-warning)' }} />
        <h1 className="kiosk-error__title">No Network Connection</h1>
        <p className="kiosk-error__sub">
          PrintBooth is temporarily unable to connect to the server.
          Please wait while we attempt to reconnect. USB-based printing may still be available.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--clr-text-2)' }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid var(--clr-accent-light)', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
          <span>Reconnecting…</span>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--clr-text-4)' }}>
          If this persists, please call support: +91 90906 36363 / team1printbooth@gmail.com
        </p>
      </div>
    </div>
  )
}
