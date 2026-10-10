import { useState, useEffect, useCallback, useRef } from 'react'
import { useLocation } from 'react-router-dom'
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
}

const FALLBACK_CAMPUS_ADS: KioskAdItem[] = [
  {
    campaignId: 'AD-CAM-001',
    title: 'Red Bull Campus Energy Rush',
    advertiser: 'Red Bull India',
    mediaUrl: 'https://images.unsplash.com/photo-1551698618-1dfe5d97d256?auto=format&fit=crop&w=1600&q=80',
    headline: 'Fuel Your Late Night Study Sessions',
    tagline: 'Get 20% off with Student ID at Campus Cafeteria',
    callToAction: 'Special Student Perk',
    badgeText: 'CAMPUS SPONSOR',
    accentColor: '#dc2626',
  },
  {
    campaignId: 'AD-CAM-002',
    title: 'Spotify Student Premium',
    advertiser: 'Spotify India',
    mediaUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=1600&q=80',
    headline: 'Ad-Free Exam Music & Lo-Fi Study Beats',
    tagline: 'Spotify Premium at ₹59/month for verified college students',
    callToAction: 'Stream Nonstop',
    badgeText: 'STUDENT PERK',
    accentColor: '#10b981',
  },
  {
    campaignId: 'AD-CAM-003',
    title: 'MIT ADT Annual Hackathon 2026',
    advertiser: 'Tech Fest Committee',
    mediaUrl: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1600&q=80',
    headline: '36-Hour National Hackathon • ₹2.5L Prize Pool',
    tagline: 'Register before Oct 31 • Free cloud computing credits for participants',
    callToAction: 'Register Online',
    badgeText: 'CAMPUS EVENT',
    accentColor: '#f59e0b',
  },
]

interface KioskAdBackgroundProps {
  kioskId?: string
}

export default function KioskAdBackground({ kioskId: propKioskId }: KioskAdBackgroundProps) {
  const location = useLocation()
  const kioskId = propKioskId || getKioskId() || 'PB-001'
  const apiUrl = getKioskApiUrl()

  // Only render on "Print from your phone" / home screen
  const isPrintFromPhonePage = location.pathname === '/' || location.pathname === '/session'

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
    return FALLBACK_CAMPUS_ADS
  })

  const [currentIndex, setCurrentIndex] = useState(0)
  const [fadeOpacity, setFadeOpacity] = useState(1)
  const lastTrackedImpression = useRef<string | null>(null)

  // Fetch active campaigns for this kiosk
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
    const poll = setInterval(fetchAds, 60000)
    return () => clearInterval(poll)
  }, [fetchAds])

  // Auto-rotate advertisement every 12 seconds
  useEffect(() => {
    if (ads.length <= 1) return

    const cycle = setInterval(() => {
      setFadeOpacity(0)
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % ads.length)
        setFadeOpacity(1)
      }, 400)
    }, 12000)

    return () => clearInterval(cycle)
  }, [ads.length])

  const currentAd = ads[currentIndex] || ads[0] || FALLBACK_CAMPUS_ADS[0]

  // Track impression silently
  useEffect(() => {
    if (!currentAd?.campaignId || !isPrintFromPhonePage) return
    if (lastTrackedImpression.current === currentAd.campaignId) return

    lastTrackedImpression.current = currentAd.campaignId
    fetch(`${apiUrl}/api/advertisements/${encodeURIComponent(currentAd.campaignId)}/impression`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kioskId }),
    }).catch(() => {})
  }, [currentAd?.campaignId, apiUrl, kioskId, isPrintFromPhonePage])

  if (!isPrintFromPhonePage) {
    return null
  }

  const tickerText = `${currentAd.headline || currentAd.title} — ${currentAd.tagline || ''}`

  return (
    <>
      {/* ── Background Moving Advertisement Image ── */}
      <div className="kiosk-ad-bg-canvas" aria-hidden="true">
        <div
          className="kiosk-ad-layer kiosk-ad-motion-drift"
          style={{
            backgroundImage: `url(${currentAd.mediaUrl})`,
            opacity: fadeOpacity * 0.75,
          }}
        />
        <div className="kiosk-ad-vignette" />
      </div>

      {/* ── Bottom Marquee Ticker: Text Moving From Left to Right (Little Transparency Only) ── */}
      <div className="ks-ad-bottom-ticker" role="marquee" aria-label="Campus Announcement">
        <div className="ks-ad-ticker-badge">
          <span className="ks-ad-ticker-dot" />
          <span>{currentAd.badgeText || 'SPONSOR'}</span>
        </div>

        <div className="ks-ad-ticker-viewport">
          <div className="ks-ad-ticker-track-ltr">
            {/* Repeated 6 times to guarantee seamless infinite loop from left to right */}
            {[0, 1, 2, 3, 4, 5].map((idx) => (
              <div key={idx} className="ks-ad-ticker-segment">
                <span className="ks-ad-ticker-advertiser">{currentAd.advertiser}</span>
                <span className="ks-ad-ticker-divider">•</span>
                <span className="ks-ad-ticker-text">{tickerText}</span>
                {currentAd.callToAction && (
                  <>
                    <span className="ks-ad-ticker-divider">•</span>
                    <span className="ks-ad-ticker-cta">{currentAd.callToAction}</span>
                  </>
                )}
                <span className="ks-ad-ticker-divider">★</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
