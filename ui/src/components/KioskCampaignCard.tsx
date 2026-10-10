import { useState, useEffect, useRef, useCallback } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { getKioskApiUrl, getKioskId } from '../utils/siteConfig'
import './KioskCampaignCard.css'

export interface KioskAdItem {
  campaignId: string
  title: string
  advertiser: string
  mediaUrl: string
  headline?: string
  tagline?: string
  callToAction?: string
  qrCodeUrl?: string
  badgeText?: string
  accentColor?: string
  targetKiosks?: string[]
}

const FALLBACK_CAMPUS_ADS: KioskAdItem[] = [
  {
    campaignId: 'AD-CAM-001',
    title: 'Red Bull Campus Energy Rush',
    advertiser: 'Red Bull India',
    mediaUrl: 'https://images.unsplash.com/photo-1551698618-1dfe5d97d256?auto=format&fit=crop&w=1200&q=80',
    headline: 'Fuel Your Late Night Study Sessions',
    tagline: 'Get 20% off on Red Bull with Student ID at Campus Cafeteria',
    callToAction: 'Scan for Offer',
    qrCodeUrl: 'https://printbooth.in/offers/redbull',
    badgeText: 'CAMPUS SPONSOR',
    accentColor: '#dc2626',
  },
  {
    campaignId: 'AD-CAM-002',
    title: 'Spotify Student Special',
    advertiser: 'Spotify India',
    mediaUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=1200&q=80',
    headline: 'Ad-Free Exam Music & Lo-Fi Beats',
    tagline: 'Spotify Premium at ₹59/month for verified college students',
    callToAction: 'Get Student Plan',
    qrCodeUrl: 'https://spotify.com/student',
    badgeText: 'STUDENT PERK',
    accentColor: '#10b981',
  },
  {
    campaignId: 'AD-CAM-003',
    title: 'MIT ADT Annual Hackathon 2026',
    advertiser: 'Tech Fest Committee',
    mediaUrl: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1200&q=80',
    headline: '36-Hour National Hackathon • ₹2.5L Prize Pool',
    tagline: 'Register before Oct 31 • Free cloud computing credits for participants',
    callToAction: 'Register Team',
    qrCodeUrl: 'https://mitadt.edu/hackathon2026',
    badgeText: 'CAMPUS EVENT',
    accentColor: '#f59e0b',
  },
]

interface KioskCampaignCardProps {
  kioskId?: string
}

export default function KioskCampaignCard({ kioskId: propKioskId }: KioskCampaignCardProps) {
  const kioskId = propKioskId || getKioskId() || 'PB-001'
  const apiUrl = getKioskApiUrl()

  // Delay appearance by 2.2 seconds after "Print from your phone" section loads
  const [isVisible, setIsVisible] = useState(false)
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
  const [activeModalAd, setActiveModalAd] = useState<KioskAdItem | null>(null)
  const [modalCountdown, setModalCountdown] = useState(25)

  const lastTrackedImpression = useRef<string | null>(null)
  const modalTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Reveal card smoothly after initial delay
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(true)
    }, 2200)
    return () => clearTimeout(timer)
  }, [])

  // Fetch active ads for this kiosk from backend
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
    const poll = setInterval(fetchAds, 45000)
    return () => clearInterval(poll)
  }, [fetchAds])

  // Automatic smooth campaign rotation every 9 seconds
  useEffect(() => {
    if (ads.length <= 1 || activeModalAd) return

    const cycle = setInterval(() => {
      setFadeOpacity(0)
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % ads.length)
        setFadeOpacity(1)
      }, 350)
    }, 9000)

    return () => clearInterval(cycle)
  }, [ads.length, activeModalAd])

  const currentAd = ads[currentIndex] || ads[0] || FALLBACK_CAMPUS_ADS[0]

  // Track verified impression
  useEffect(() => {
    if (!currentAd?.campaignId || !isVisible) return
    if (lastTrackedImpression.current === currentAd.campaignId) return
    lastTrackedImpression.current = currentAd.campaignId

    fetch(`${apiUrl}/api/advertisements/kiosk/${encodeURIComponent(kioskId)}/impression/${encodeURIComponent(currentAd.campaignId)}`, {
      method: 'POST',
    }).catch(() => {})
  }, [currentAd?.campaignId, isVisible, apiUrl, kioskId])

  // Open QR modal on ad touch/click & track click
  const handleOpenAdModal = (ad: KioskAdItem) => {
    setActiveModalAd(ad)
    setModalCountdown(25)

    // Track click event on backend
    fetch(`${apiUrl}/api/advertisements/kiosk/${encodeURIComponent(kioskId)}/click/${encodeURIComponent(ad.campaignId)}`, {
      method: 'POST',
    }).catch(() => {})
  }

  // Handle modal countdown auto-dismiss
  useEffect(() => {
    if (!activeModalAd) {
      if (modalTimerRef.current) clearInterval(modalTimerRef.current)
      return
    }

    modalTimerRef.current = setInterval(() => {
      setModalCountdown((c) => {
        if (c <= 1) {
          setActiveModalAd(null)
          return 25
        }
        return c - 1
      })
    }, 1000)

    return () => {
      if (modalTimerRef.current) clearInterval(modalTimerRef.current)
    }
  }, [activeModalAd])

  if (!currentAd) return null

  const targetQrUrl =
    currentAd.qrCodeUrl || `https://printbooth.in/offers/${currentAd.campaignId.toLowerCase()}`

  return (
    <>
      {/* Featured Campaign Card inside "Print from your phone" section */}
      <div
        className={`ks-ad-card-container ${isVisible ? 'ks-ad-card-container--visible' : ''}`}
        id="kiosk-featured-campaign-card"
      >
        <div
          className="ks-ad-card"
          onClick={() => handleOpenAdModal(currentAd)}
          style={{ opacity: fadeOpacity }}
        >
          {/* Top Sponsor Header */}
          <div className="ks-ad-card-top">
            <div className="ks-ad-badge-group">
              <span
                className="ks-ad-sponsor-pill"
                style={{ backgroundColor: currentAd.accentColor || '#dc2626' }}
              >
                {currentAd.badgeText || 'CAMPUS SPONSOR'}
              </span>
              <span className="ks-ad-advertiser-label">{currentAd.advertiser}</span>
            </div>

            {/* Campaign Dots Indicator */}
            {ads.length > 1 && (
              <div
                className="ks-ad-dots"
                onClick={(e) => e.stopPropagation()}
              >
                {ads.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className={`ks-ad-dot ${idx === currentIndex ? 'ks-ad-dot--active' : ''}`}
                    onClick={() => {
                      setFadeOpacity(0)
                      setTimeout(() => {
                        setCurrentIndex(idx)
                        setFadeOpacity(1)
                      }, 200)
                    }}
                    title={`View campaign ${idx + 1}`}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Prominent High-Definition Campaign Image */}
          <div className="ks-ad-image-wrap">
            <img
              src={currentAd.mediaUrl}
              alt={currentAd.title}
              className="ks-ad-image"
              loading="lazy"
            />
            <div className="ks-ad-image-overlay" />
            <span className="ks-ad-tap-hint">Tap to scan QR</span>
          </div>

          {/* Full Readable Content (No clipping, high contrast) */}
          <div className="ks-ad-content">
            <h3 className="ks-ad-headline">{currentAd.headline || currentAd.title}</h3>
            {currentAd.tagline && (
              <p className="ks-ad-tagline">{currentAd.tagline}</p>
            )}

            {/* Large Responsive Touch Action Button */}
            <button
              type="button"
              className="ks-ad-cta-btn"
              onClick={(e) => {
                e.stopPropagation()
                handleOpenAdModal(currentAd)
              }}
              style={{
                borderColor: currentAd.accentColor || '#dc2626',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
              <span>{currentAd.callToAction || 'View Offer & QR'}</span>
              <span>→</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── High-Contrast QR Code Campaign Modal ── */}
      {activeModalAd && (
        <div
          className="ks-ad-modal-backdrop"
          onClick={() => setActiveModalAd(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="ks-ad-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="ks-ad-modal-header">
              <span
                className="ks-ad-modal-badge"
                style={{ backgroundColor: activeModalAd.accentColor || '#dc2626' }}
              >
                {activeModalAd.badgeText || 'SPECIAL OFFER'}
              </span>
              <span className="ks-ad-modal-advertiser">{activeModalAd.advertiser}</span>
            </div>

            <h2 className="ks-ad-modal-title">
              {activeModalAd.headline || activeModalAd.title}
            </h2>

            {activeModalAd.tagline && (
              <p className="ks-ad-modal-tagline">{activeModalAd.tagline}</p>
            )}

            {/* Large Scannable QR Code */}
            <div className="ks-ad-modal-qr-frame">
              <QRCodeSVG
                value={targetQrUrl}
                size={220}
                level="H"
                includeMargin={false}
                fgColor="#09090b"
                bgColor="#ffffff"
              />
            </div>

            {/* Link Preview Pill */}
            <div className="ks-ad-modal-link-pill">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              <span className="ks-ad-modal-link-text">{targetQrUrl}</span>
            </div>

            <p className="ks-ad-modal-hint">
              📱 Point your smartphone camera at this QR code to open the campaign page
            </p>

            {/* Touch-Friendly Responsive Close Button */}
            <button
              type="button"
              className="ks-ad-modal-close-btn"
              onClick={() => setActiveModalAd(null)}
            >
              <span>✕ Close &amp; Return to Print</span>
              <span className="ks-ad-modal-timer">({modalCountdown}s)</span>
            </button>
          </div>
        </div>
      )}
    </>
  )
}
