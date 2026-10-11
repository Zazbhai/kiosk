import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from '@phosphor-icons/react'
import { QRCodeSVG } from 'qrcode.react'
import { useKioskSiteUrl, getKioskSiteUrl } from '../utils/siteConfig'
import './KioskScreens.css'

export default function QRUploadScreen() {
  const navigate = useNavigate()
  const [timeLeft, setTimeLeft] = useState(5 * 60)
  const [sessionToken, setSessionToken] = useState<string>('')
  const [uniqueQrUrl, setUniqueQrUrl] = useState<string>('')

  const kioskId = localStorage.getItem('pb_kiosk_id') || import.meta.env.VITE_KIOSK_ID || 'PB-001'
  const kioskName = localStorage.getItem('pb_kiosk_name') || import.meta.env.VITE_KIOSK_NAME || 'PrintBooth — Station 1'
  const apiUrl = (localStorage.getItem('pb_api_url') || import.meta.env.VITE_API_URL || 'https://api.printbooth.co.in').replace(/\/api$/, '')
  const { siteUrl, setSiteUrl } = useKioskSiteUrl(apiUrl, kioskId, sessionToken)

  const createSession = useCallback(async () => {
    try {
      const base = (siteUrl || getKioskSiteUrl()).replace(/\/+$/, '')
      let res = await fetch(`${apiUrl}/api/kiosk-sessions/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kioskId, webBaseUrl: base, force: true }),
      }).catch(() => null)

      if (!res || !res.ok) {
        res = await fetch('/api/kiosk-sessions/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kioskId, webBaseUrl: base, force: true }),
        }).catch(() => null)
      }

      if (res && res.ok) {
        const data = await res.json()
        const token = (data.token || data.session?.token || '').trim()
        if (token) {
          setSessionToken(token)
          const qr = (data.qrUrl || data.session?.qrUrl || `${base}/print?id=${encodeURIComponent(kioskId)}&session=${encodeURIComponent(token)}`)
          setUniqueQrUrl(qr)
          setTimeLeft(5 * 60)
        }
      }
    } catch (err) {
      console.warn('[QRUploadScreen] Failed to create session:', err)
    }
  }, [apiUrl, kioskId, siteUrl])

  useEffect(() => {
    createSession()
  }, [createSession])

  // Poll for document upload / session claim
  useEffect(() => {
    if (!sessionToken) return
    const interval = setInterval(async () => {
      try {
        let res = await fetch(`${apiUrl}/api/kiosk-sessions/active/${encodeURIComponent(kioskId)}`).catch(() => null)
        if (!res || !res.ok) {
          res = await fetch(`/api/kiosk-sessions/active/${encodeURIComponent(kioskId)}`).catch(() => null)
        }
        if (res && res.ok) {
          const data = await res.json()
          if (data.success && data.session) {
            const s = data.session
            if (s.state === 'CLAIMED' || s.state === 'UPLOADING' || s.state === 'CONFIRMING' || s.document) {
              navigate('/')
            }
          }
        }
      } catch {}
    }, 1500)
    return () => clearInterval(interval)
  }, [apiUrl, kioskId, sessionToken, navigate])

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          createSession()
          return 5 * 60
        }
        return t - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [createSession])

  const minutes = Math.floor(timeLeft / 60).toString().padStart(2, '0')
  const seconds = (timeLeft % 60).toString().padStart(2, '0')

  const effectiveQr = useMemo(() => {
    if (uniqueQrUrl && uniqueQrUrl.includes('&session=')) return uniqueQrUrl
    if (sessionToken) {
      const base = (siteUrl || getKioskSiteUrl()).replace(/\/+$/, '')
      return `${base}/print?id=${encodeURIComponent(kioskId)}&session=${encodeURIComponent(sessionToken)}`
    }
    return ''
  }, [uniqueQrUrl, sessionToken, siteUrl, kioskId])

  return (
    <div className="kiosk-screen">
      <div className="kiosk-bg-mesh" />
      <div className="kiosk-statusbar">
        <div className="statusbar__left">
          <div className="statusbar__dot" />
          <span className="statusbar__kiosk">{kioskId}</span>
          <span>{kioskName}</span>
        </div>
      </div>

      <div className="kiosk-qr-screen kiosk-enter">
        <h1 className="kiosk-title" style={{ fontSize: '2rem' }}>Scan to Upload</h1>
        <p className="kiosk-subtitle">Open phone camera or QR scanner to upload files to this station</p>

        <div className="qr-display" style={{ background: '#ffffff', padding: '16px', borderRadius: '16px', display: 'inline-block', boxShadow: '0 8px 30px rgba(0,0,0,0.15)' }}>
          {effectiveQr ? (
            <QRCodeSVG
              value={effectiveQr}
              size={220}
              level="H"
              includeMargin={true}
            />
          ) : (
            <div style={{ width: 220, height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span>Generating session…</span>
            </div>
          )}
        </div>

        <div className="kiosk-waiting" style={{ marginTop: '14px' }}>
          <div className="kiosk-waiting__dot" />
          <span>Awaiting document upload on mobile…</span>
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          background: 'rgba(255, 255, 255, 0.08)',
          padding: '6px 14px',
          borderRadius: 12,
          marginTop: '10px',
          fontSize: '0.8rem',
          color: 'var(--clr-text-3)',
        }}>
          <span>Upload Link: <strong style={{ color: 'var(--clr-text-1)' }}>{effectiveQr}</strong></span>
          <button
            type="button"
            onClick={() => {
              const val = prompt('Enter custom site URL for phone uploads (e.g. https://your-site.com):', siteUrl)
              if (val && val.trim()) {
                setSiteUrl(val.trim())
              }
            }}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--clr-accent-light)',
              fontWeight: 700,
              fontSize: '0.8rem',
              cursor: 'pointer',
              textDecoration: 'underline',
              padding: 0,
            }}
          >
            Change
          </button>
        </div>

        <div className="kiosk-timer">{minutes}:{seconds}</div>
        <p style={{ fontSize: '0.8rem', color: 'var(--clr-text-3)' }}>Session active for {minutes}:{seconds}</p>
      </div>

      <div className="kiosk-back">
        <button className="kiosk-btn kiosk-btn-ghost" onClick={() => navigate('/upload')} id="qr-back">
          <ArrowLeft size={20} />
          Back
        </button>
      </div>
    </div>
  )
}
