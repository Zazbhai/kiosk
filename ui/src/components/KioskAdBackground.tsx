import { useState, useEffect, useCallback, useRef } from 'react'
import { getKioskApiUrl, getKioskId } from '../utils/siteConfig'
import './KioskAdBackground.css'

export interface KioskAdItem {
  campaignId: string
  title: string
  advertiser: string
  mediaUrl: string
  headline?: string
  tagline?: string
  callToAction?: string
  badgeText?: string
  accentColor?: string
  opacity?: number
}

interface KioskAdBackgroundProps {
  kioskId?: string
}

const AD_DISPLAY_DURATION_MS = 10000 // 10 seconds per advertisement
const FADE_TRANSITION_MS = 600 // Smooth cross-fade transition

export default function KioskAdBackground({ kioskId: propKioskId }: KioskAdBackgroundProps) {
  const kioskId = propKioskId || getKioskId() || 'PB-001'
  const apiUrl = getKioskApiUrl()

  // Only use admin-specified ads loaded from backend API or valid cache
  const [ads, setAds] = useState<KioskAdItem[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('pb_kiosk_cached_ads')
        if (cached) {
          const parsed = JSON.parse(cached)
          if (Array.isArray(parsed) && parsed.length > 0) return parsed
        }
      } catch {}
    }
    return []
  })

  const [currentIndex, setCurrentIndex] = useState(0)
  const [fadeOpacity, setFadeOpacity] = useState(1)
  const lastTrackedImpression = useRef<string | null>(null)

  // Fetch active campaigns for this kiosk from backend (strictly admin-created campaigns)
  const fetchAds = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/advertisements/kiosk/${encodeURIComponent(kioskId)}`)
      if (res.ok) {
        const json = await res.json()
        if (json.success && Array.isArray(json.data) && json.data.length > 0) {
          setAds(json.data)
          try {
            localStorage.setItem('pb_kiosk_cached_ads', JSON.stringify(json.data))
          } catch {}
        }
      }
    } catch {}
  }, [apiUrl, kioskId])

  useEffect(() => {
    fetchAds()
    const poll = setInterval(fetchAds, 30000)
    return () => clearInterval(poll)
  }, [fetchAds])

  // Continuous smooth ad rotation (cycles through active ads with smooth cross-fade)
  useEffect(() => {
    if (ads.length <= 1) {
      setFadeOpacity(1)
      return
    }

    const interval = setInterval(() => {
      // Fade out current ad
      setFadeOpacity(0)
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % ads.length)
        setFadeOpacity(1)
      }, FADE_TRANSITION_MS)
    }, AD_DISPLAY_DURATION_MS)

    return () => clearInterval(interval)
  }, [ads.length])

  const currentAd = ads.length > 0 ? ads[currentIndex] || ads[0] : null

  // Track impression silently only when ad is displayed
  useEffect(() => {
    if (!currentAd?.campaignId) return
    if (lastTrackedImpression.current === currentAd.campaignId) return

    lastTrackedImpression.current = currentAd.campaignId
    fetch(`${apiUrl}/api/advertisements/kiosk/${encodeURIComponent(kioskId)}/impression/${encodeURIComponent(currentAd.campaignId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => {
      // Fallback endpoint
      fetch(`${apiUrl}/api/advertisements/${encodeURIComponent(currentAd.campaignId)}/impression`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kioskId }),
      }).catch(() => {})
    })
  }, [currentAd?.campaignId, apiUrl, kioskId])

  // Reduced, subtle opacity so the advertisement artwork is elegantly understated behind the kiosk
  const rawAdOpacity = currentAd?.opacity ?? 0.25
  const effectiveAdOpacity = Math.min(0.28, Math.max(0.18, (rawAdOpacity || 0.25) * 0.75))

  return (
    <>
      {/* ── Layer 1: Fixed Ambient Ad Background Canvas (z-index: 0) ── */}
      <div className="kiosk-ad-bg-canvas" aria-hidden="true">
        {currentAd ? (
          <div
            className="kiosk-ad-layer kiosk-ad-motion-drift"
            style={{
              backgroundImage: `url(${currentAd.mediaUrl})`,
              opacity: fadeOpacity * effectiveAdOpacity,
            }}
          />
        ) : (
          /* Default Brand Logo Stage (when 0 campaigns configured) */
          <div className="kiosk-bg-logo-stage">
            <div className="kiosk-bg-logo-card">
              <div className="kiosk-bg-logo-mark-wrap">
                <div className="kiosk-bg-logo-aura" />
                <img
                  src="/logo.png"
                  alt="PrintBooth"
                  className="kiosk-bg-logo-img"
                />
              </div>
              <div className="kiosk-bg-logo-typography">
                <h2 className="kiosk-bg-logo-wordmark">PRINTBOOTH</h2>
                <div className="kiosk-bg-logo-badge">
                  <span className="kiosk-bg-logo-dot" />
                  <span>AUTONOMOUS PRINTING KIOSK</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Subtle Depth Vignette */}
        <div className="kiosk-ad-vignette" />
      </div>

      {/* ── Layer 2: Dynamic Animated Bottom Moving Text Ticker (Full-bleed edge-to-edge shiny red) ── */}
      <aside className="ks-ad-bottom-bar" role="complementary" aria-label="Sponsor Announcements">
        <div className="ks-ad-shine-overlay" aria-hidden="true" />
        <div className="ks-ad-ticker-viewport">
          <div className="ks-ad-ticker-track">
            {/* 4 duplicated segments for seamless, infinite continuous glide with zero blank gaps */}
            {[0, 1, 2, 3].map((idx) => (
              <div key={idx} className="ks-ad-ticker-segment">
                <span
                  className="ks-ad-ticker-badge"
                  style={{
                    backgroundColor: currentAd?.accentColor || '#dc2626',
                  }}
                >
                  <span className="ks-ad-ticker-badge-dot" />
                  {currentAd?.badgeText || 'CAMPUS SPONSOR'}
                </span>

                <span
                  className="ks-ad-ticker-advertiser"
                  style={{
                    color: currentAd?.accentColor || '#dc2626',
                  }}
                >
                  {currentAd?.advertiser || 'PrintBooth Express'}
                </span>

                <span className="ks-ad-ticker-divider">/</span>

                <span className="ks-ad-ticker-text">
                  {currentAd?.headline || currentAd?.title || 'Autonomous High-Speed Laser Printing'}
                </span>

                {currentAd?.tagline && (
                  <>
                    <span className="ks-ad-ticker-divider">•</span>
                    <span className="ks-ad-ticker-sub">{currentAd.tagline}</span>
                  </>
                )}

                {currentAd?.callToAction && (
                  <span
                    className="ks-ad-ticker-cta"
                    style={{
                      borderColor: currentAd?.accentColor || '#dc2626',
                      color: currentAd?.accentColor || '#dc2626',
                    }}
                  >
                    {currentAd.callToAction}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </aside>
    </>
  )
}
