import { useState, useEffect, useRef, useCallback } from 'react'
import { getKioskApiUrl, getKioskId } from '../utils/siteConfig'
import './KioskAdBackground.css'

export interface KioskAdItem {
  campaignId: string
  title: string
  advertiser: string
  mediaType?: 'IMAGE' | 'VIDEO' | 'TEXT_BANNER'
  mediaUrl: string
  headline?: string
  tagline?: string
  callToAction?: string
  badgeText?: string
  accentColor?: string
  motionType?: 'DRIFT' | 'FLOAT' | 'MARQUEE' | 'PULSE' | 'KEN_BURNS'
  motionSpeed?: 'SLOW' | 'NORMAL' | 'FAST'
  opacity?: number
  targetKiosks?: string[]
  status?: string
}

// High-fidelity fallback campus sponsor campaign in case network is disconnected on boot
const FALLBACK_CAMPUS_ADS: KioskAdItem[] = [
  {
    campaignId: 'AD-CAM-001',
    title: 'Red Bull Campus Energy Rush',
    advertiser: 'Red Bull India',
    mediaUrl: 'https://images.unsplash.com/photo-1551698618-1dfe5d97d256?auto=format&fit=crop&w=1600&q=80',
    headline: 'Fuel Your Late Night Study Sessions',
    tagline: '20% off with Student ID at Campus Cafeteria',
    badgeText: 'CAMPUS SPONSOR',
    accentColor: '#dc2626',
    motionType: 'DRIFT',
    motionSpeed: 'SLOW',
    opacity: 0.22,
  },
  {
    campaignId: 'AD-CAM-002',
    title: 'Spotify Student Special',
    advertiser: 'Spotify India',
    mediaUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=1600&q=80',
    headline: 'Ad-Free Exam Music & Lo-Fi Beats',
    tagline: 'Spotify Premium at ₹59/month for verified students',
    badgeText: 'STUDENT PERK',
    accentColor: '#10b981',
    motionType: 'FLOAT',
    motionSpeed: 'SLOW',
    opacity: 0.20,
  },
  {
    campaignId: 'AD-CAM-003',
    title: 'MIT ADT Annual Hackathon 2026',
    advertiser: 'Tech Fest Committee',
    mediaUrl: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1600&q=80',
    headline: '36-Hour National Hackathon • ₹2.5L Prize Pool',
    tagline: 'Free cloud computing credits for all participants',
    badgeText: 'CAMPUS EVENT',
    accentColor: '#f59e0b',
    motionType: 'KEN_BURNS',
    motionSpeed: 'SLOW',
    opacity: 0.24,
  },
]

interface KioskAdBackgroundProps {
  kioskId?: string
}

export default function KioskAdBackground({ kioskId: propKioskId }: KioskAdBackgroundProps) {
  const kioskId = propKioskId || getKioskId() || 'PB-001'
  const apiUrl = getKioskApiUrl()

  // Initialize with cached ads or fallback immediately to avoid any initial delay
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
  const lastTrackedCampaign = useRef<string | null>(null)

  // Fetch live active campaigns from backend
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
    } catch {
      // Offline fallback: continue using cached ads smoothly
    }
  }, [apiUrl, kioskId])

  useEffect(() => {
    fetchAds()
    // Poll for new/updated campaigns every 40 seconds
    const pollInterval = setInterval(fetchAds, 40000)
    return () => clearInterval(pollInterval)
  }, [fetchAds])

  // Cycle through multiple campaigns smoothly
  useEffect(() => {
    if (ads.length <= 1) return

    const cycleInterval = setInterval(() => {
      // Initiate crossfade
      setFadeOpacity(0)
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % ads.length)
        setFadeOpacity(1)
      }, 900)
    }, 24000) // 24 seconds per campaign

    return () => clearInterval(cycleInterval)
  }, [ads.length])

  const currentAd = ads[currentIndex] || ads[0] || FALLBACK_CAMPUS_ADS[0]

  // Track verified impression on screen display
  useEffect(() => {
    if (!currentAd || !currentAd.campaignId) return
    if (lastTrackedCampaign.current === currentAd.campaignId) return
    lastTrackedCampaign.current = currentAd.campaignId

    try {
      fetch(`${apiUrl}/api/advertisements/kiosk/${encodeURIComponent(kioskId)}/impression/${encodeURIComponent(currentAd.campaignId)}`, {
        method: 'POST',
      }).catch(() => {})
    } catch {}
  }, [currentAd?.campaignId, apiUrl, kioskId])

  if (!currentAd || !currentAd.mediaUrl) return null

  const motionClass = `kiosk-ad-motion-${(currentAd.motionType || 'DRIFT').toLowerCase()}`
  const speedClass = `kiosk-ad-speed-${(currentAd.motionSpeed || 'SLOW').toLowerCase()}`
  const effectiveOpacity = (currentAd.opacity ?? 0.22) * fadeOpacity

  return (
    <div className="kiosk-ad-bg-canvas" aria-hidden="true">
      {/* Moving Background Layer with GPU Transform */}
      <div
        key={`${currentAd.campaignId}-${currentIndex}`}
        className={`kiosk-ad-layer ${motionClass} ${speedClass}`}
        style={{
          backgroundImage: `url(${currentAd.mediaUrl})`,
          opacity: effectiveOpacity,
        }}
      />

      {/* Contrast Vignette to ensure foreground PIN buttons & text stay 100% crisp */}
      <div className="kiosk-ad-vignette" />

      {/* Non-Intrusive Floating Sponsor Ticker (Bottom Right Corner) */}
      <div className="kiosk-ad-sponsor-pill" style={{ opacity: fadeOpacity }}>
        <span
          className="kiosk-ad-sponsor-badge"
          style={{ background: currentAd.accentColor || '#dc2626' }}
        >
          {currentAd.badgeText || 'SPONSORED'}
        </span>
        <span className="kiosk-ad-sponsor-title">
          {currentAd.headline || currentAd.title}
        </span>
        {currentAd.callToAction && (
          <span className="kiosk-ad-sponsor-cta">
            • {currentAd.callToAction}
          </span>
        )}
      </div>
    </div>
  )
}
