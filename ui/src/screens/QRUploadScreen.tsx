import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { useKioskSiteUrl, getKioskSiteUrl, getKioskApiUrl } from '../utils/siteConfig'
import TimerSvg from '../components/TimerSvg'
import './KioskScreens.css'

export default function QRUploadScreen() {
  const navigate = useNavigate()
  const [timeLeft, setTimeLeft] = useState(5 * 60)
  const [sessionToken, setSessionToken] = useState<string>('')
  const [uniqueQrUrl, setUniqueQrUrl] = useState<string>('')

  const kioskId = localStorage.getItem('pb_kiosk_id') || import.meta.env.VITE_KIOSK_ID || 'PB-001'
  const kioskName = localStorage.getItem('pb_kiosk_name') || import.meta.env.VITE_KIOSK_NAME || 'Station 1'
  const apiUrl = getKioskApiUrl()
  const { siteUrl } = useKioskSiteUrl(apiUrl, kioskId, sessionToken)

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
          <button
            type="button"
            className="kiosk-nav-btn kiosk-nav-btn--back"
            onClick={() => navigate('/upload')}
            id="qr-nav-back"
          >
            <span>←</span>
            <span>Back</span>
          </button>
        </div>
        <div className="statusbar__center">
          <div className="statusbar__pill">
            <div className="statusbar__dot" />
            <span className="statusbar__kiosk">{kioskId}</span>
            <span>•</span>
            <span>{kioskName}</span>
          </div>
        </div>
        <div className="statusbar__right">
          <button
            type="button"
            className="kiosk-nav-btn kiosk-nav-btn--cancel"
            onClick={() => navigate('/')}
            id="qr-nav-cancel"
          >
            <span>✕</span>
            <span>Cancel</span>
          </button>
        </div>
      </div>

      <div className="kiosk-qr-screen kiosk-enter" style={{ margin: 'auto auto', gap: 16 }}>
        <h1 className="kiosk-title" style={{ fontSize: '2rem' }}>Scan to Upload</h1>
        <p className="kiosk-subtitle" style={{ margin: 0 }}>Open your phone camera to scan this QR code and upload documents</p>

        <div className="qr-display" style={{ background: '#ffffff', padding: '16px', borderRadius: '16px', display: 'inline-block', boxShadow: '0 8px 30px rgba(0,0,0,0.12)' }}>
          {effectiveQr ? (
            <QRCodeSVG
              value={effectiveQr}
              size={220}
              level="H"
              includeMargin={true}
            />
          ) : (
            <div style={{ width: 220, height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>Generating secure session…</span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="kiosk-waiting" style={{ margin: 0 }}>
            <div className="kiosk-waiting__dot" />
            <span>Awaiting phone upload…</span>
          </div>

          <div className="kiosk-timer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 999, fontSize: 12, fontWeight: 700, color: '#0f172a' }}>
            <TimerSvg size={16} />
            <span>{minutes}:{seconds}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
