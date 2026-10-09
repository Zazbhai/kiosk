import { useState, useEffect, useCallback } from 'react'

/**
 * Centralized Site & Upload URL Resolver for Kiosk UI
 * Eliminates the need for any .env inside the kiosk!
 * 
 * Hierarchy:
 * 1. URL Parameter: ?siteUrl=... or ?webUrl=...
 * 2. User/Session override: localStorage.getItem('pb_site_url')
 * 3. Dynamic Backend API: /api/kiosks/:id/config or /api/config (reads root .env SITE_URL)
 * 4. Window global: window.__PRINTBOOTH_SITE_URL__
 * 5. Fallback: http://localhost:5200
 */

export function getKioskSiteUrl(): string {
  if (typeof window !== 'undefined') {
    const search = new URLSearchParams(window.location.search)
    const paramUrl = search.get('siteUrl') || search.get('webUrl') || search.get('clientWebUrl')
    if (paramUrl && paramUrl.trim()) {
      return paramUrl.trim().replace(/\/+$/, '')
    }

    const localUrl = localStorage.getItem('pb_site_url') || localStorage.getItem('pb_web_url')
    if (localUrl && localUrl.trim() && localUrl !== 'http://localhost:5200') {
      return localUrl.trim().replace(/\/+$/, '')
    }

    const winUrl = (window as any).__PRINTBOOTH_SITE_URL__ || (window as any).__PRINTBOOTH_WEB_URL__
    if (winUrl && typeof winUrl === 'string' && winUrl.trim()) {
      return winUrl.trim().replace(/\/+$/, '')
    }
  }

  const envUrl = import.meta.env.VITE_CLIENT_WEB_URL || import.meta.env.VITE_SITE_URL
  if (envUrl && typeof envUrl === 'string' && envUrl.trim() && envUrl !== 'http://localhost:5200') {
    return envUrl.trim().replace(/\/+$/, '')
  }

  const cached = typeof window !== 'undefined' ? localStorage.getItem('pb_site_url') : null
  return cached || 'http://localhost:5200'
}

export function getKioskQrUrl(kioskId: string, customBaseUrl?: string): string {
  const base = (customBaseUrl || getKioskSiteUrl()).replace(/\/+$/, '')
  return `${base}/print?id=${encodeURIComponent(kioskId || 'PB-001')}`
}

export function setKioskSiteUrl(url: string) {
  if (typeof window === 'undefined') return
  const clean = url.trim().replace(/\/+$/, '')
  localStorage.setItem('pb_site_url', clean)
  localStorage.setItem('pb_web_url', clean)
  window.dispatchEvent(new CustomEvent('pb_site_url_changed', { detail: clean }))
}

/**
 * Fetches the site URL dynamically from the backend server so the kiosk
 * never needs its own .env file.
 */
export async function fetchRemoteSiteConfig(apiUrl: string, kioskId: string = 'PB-001'): Promise<string | null> {
  try {
    const cleanApi = apiUrl.replace(/\/api$/, '')
    // Try kiosk-specific config first, then global /api/config
    let res = await fetch(`${cleanApi}/api/kiosks/${encodeURIComponent(kioskId)}/config`).catch(() => null)
    if (!res || !res.ok) {
      res = await fetch(`${cleanApi}/api/config?kioskId=${encodeURIComponent(kioskId)}`).catch(() => null)
    }

    if (res && res.ok) {
      const data = await res.json()
      const resolved = data.siteUrl || data.webUrl || data.clientWebUrl
      if (resolved && typeof resolved === 'string' && resolved.trim()) {
        const clean = resolved.trim().replace(/\/+$/, '')
        setKioskSiteUrl(clean)
        return clean
      }
    }
  } catch (err) {
    console.warn('[KioskConfig] Remote site URL auto-fetch notice:', err)
  }
  return null
}

/**
 * React Hook that keeps the site URL and QR code URL reactively updated
 */
export function useKioskSiteUrl(apiUrl: string = 'http://localhost:5000', kioskId: string = 'PB-001') {
  const [siteUrl, setSiteUrlState] = useState<string>(() => getKioskSiteUrl())
  const [qrUrl, setQrUrl] = useState<string>(() => getKioskQrUrl(kioskId, siteUrl))

  const updateSiteUrl = useCallback((newUrl: string) => {
    setKioskSiteUrl(newUrl)
    setSiteUrlState(newUrl)
    setQrUrl(getKioskQrUrl(kioskId, newUrl))
  }, [kioskId])

  // Sync with cross-tab / CustomEvent updates
  useEffect(() => {
    const handler = (e: any) => {
      const url = e.detail || getKioskSiteUrl()
      setSiteUrlState(url)
      setQrUrl(getKioskQrUrl(kioskId, url))
    }
    window.addEventListener('pb_site_url_changed', handler)
    window.addEventListener('storage', handler)
    return () => {
      window.removeEventListener('pb_site_url_changed', handler)
      window.removeEventListener('storage', handler)
    }
  }, [kioskId])

  // Auto-fetch from backend API on mount
  useEffect(() => {
    fetchRemoteSiteConfig(apiUrl, kioskId).then(remoteUrl => {
      if (remoteUrl) {
        setSiteUrlState(remoteUrl)
        setQrUrl(getKioskQrUrl(kioskId, remoteUrl))
      }
    })
  }, [apiUrl, kioskId])

  // Keep QR code synchronized if kioskId changes
  useEffect(() => {
    setQrUrl(getKioskQrUrl(kioskId, siteUrl))
  }, [kioskId, siteUrl])

  return {
    siteUrl,
    qrUrl,
    setSiteUrl: updateSiteUrl,
  }
}
