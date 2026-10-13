import './KioskInactivityBanner.css'

interface KioskInactivityBannerProps {
  remainingSec: number | null
  resetAt: number | null
}

export default function KioskInactivityBanner({
  remainingSec,
  resetAt,
}: KioskInactivityBannerProps) {
  // Only display when 15 seconds or fewer remain and session is active
  if (remainingSec === null || remainingSec > 15 || remainingSec <= 0) {
    return null
  }

  // Format the target reset time (e.g. 07:15:30 PM or 19:15:30)
  const timeString = resetAt
    ? new Date(resetAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      })
    : ''

  return (
    <div className="kiosk-inactivity-banner-root" role="alert" aria-live="assertive">
      <div className="kiosk-inactivity-banner-pill">
        <div className="kiosk-inactivity-beacon">
          <span className="kiosk-inactivity-beacon-ping" />
          <span className="kiosk-inactivity-beacon-dot" />
        </div>
        <p className="kiosk-inactivity-message">
          Session will reset at <strong className="kiosk-inactivity-time">{timeString || 'soon'}</strong>. Please interact with your website to continue.
        </p>
        <span className="kiosk-inactivity-timer-tag">
          {remainingSec}s
        </span>
      </div>
    </div>
  )
}
