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

export function isLocalOrLanHost(hostname: string): boolean {
  if (!hostname) return false
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    /^192\.168\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
  )
}

export function getKioskSiteUrl(): string {
  // Purge any stale LAN/localhost URLs from localStorage
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem('pb_site_url') || localStorage.getItem('pb_web_url')
      if (stored && (stored.includes('192.168.') || stored.includes('5200') || stored.includes('localhost') || stored.includes('127.0.0.1'))) {
        localStorage.removeItem('pb_site_url')
        localStorage.removeItem('pb_web_url')
      }
    } catch {}
  }

  // 1. Explicit runtime query parameter override (?siteUrl=... or ?webUrl=...)
  if (typeof window !== 'undefined') {
    const search = new URLSearchParams(window.location.search)
    const paramUrl = search.get('siteUrl') || search.get('webUrl') || search.get('clientWebUrl')
    if (paramUrl && paramUrl.trim() && !paramUrl.includes('192.168.') && !paramUrl.includes('localhost')) {
      return paramUrl.trim().replace(/\/+$/, '')
    }
  }

  // Canonical production upload domain for customer smartphones
  return 'https://printbooth.co.in'
}

export function getKioskId(): string {
  if (typeof window !== 'undefined') {
    const search = new URLSearchParams(window.location.search)
    const paramId = search.get('kioskId') || search.get('id')
    if (paramId && paramId.trim()) return paramId.trim().toUpperCase()
    const localId = localStorage.getItem('pb_kiosk_id')
    if (localId && localId.trim()) return localId.trim().toUpperCase()
    const winId = (window as any).__PRINTBOOTH_KIOSK_ID__
    if (winId && typeof winId === 'string' && winId.trim()) return winId.trim().toUpperCase()
  }
  return import.meta.env.VITE_KIOSK_ID || 'PB-001'
}

export function getKioskName(): string {
  if (typeof window !== 'undefined') {
    const search = new URLSearchParams(window.location.search)
    const paramName = search.get('name') || search.get('kioskName')
    if (paramName && paramName.trim()) return paramName.trim()
    const localName = localStorage.getItem('pb_kiosk_name')
    if (localName && localName.trim()) return localName.trim()
    const winName = (window as any).__PRINTBOOTH_KIOSK_NAME__
    if (winName && typeof winName === 'string' && winName.trim()) return winName.trim()
  }
  return import.meta.env.VITE_KIOSK_NAME || 'PrintBooth — Station 1'
}

export function getKioskVariant(): 'pro' | 'lite' {
  if (typeof window !== 'undefined') {
    const search = new URLSearchParams(window.location.search)
    const paramVariant = search.get('variant') || search.get('kioskVariant') || search.get('model')
    if (paramVariant && paramVariant.trim()) {
      return paramVariant.trim().toLowerCase().includes('lite') ? 'lite' : 'pro'
    }
    const localVariant = localStorage.getItem('pb_kiosk_variant')
    if (localVariant && localVariant.trim()) {
      return localVariant.trim().toLowerCase().includes('lite') ? 'lite' : 'pro'
    }
    const winVariant = (window as any).__PRINTBOOTH_KIOSK_VARIANT__
    if (winVariant && typeof winVariant === 'string' && winVariant.trim()) {
      return winVariant.trim().toLowerCase().includes('lite') ? 'lite' : 'pro'
    }
  }
  const envVariant = import.meta.env.VITE_KIOSK_VARIANT || import.meta.env.VITE_VARIANT
  if (envVariant && typeof envVariant === 'string' && envVariant.trim()) {
    return envVariant.trim().toLowerCase().includes('lite') ? 'lite' : 'pro'
  }
  return 'pro'
}

export function setKioskVariant(variant: 'pro' | 'lite') {
  if (typeof window !== 'undefined') {
    localStorage.setItem('pb_kiosk_variant', variant)
    window.dispatchEvent(new CustomEvent('pb_kiosk_variant_changed', { detail: variant }))
  }
}

export function getKioskApiUrl(): string {
  const isLan = typeof window !== 'undefined' && isLocalOrLanHost(window.location.hostname)

  if (typeof window !== 'undefined') {
    const search = new URLSearchParams(window.location.search)
    const paramApi = search.get('api') || search.get('apiUrl')
    if (paramApi && paramApi.trim()) {
      return paramApi.trim().replace(/\/+$/, '').replace(/\/api$/, '')
    }
    const localApi = localStorage.getItem('pb_api_url')
    if (localApi && localApi.trim()) {
      const clean = localApi.trim().replace(/\/+$/, '').replace(/\/api$/, '')
      if (clean.includes('192.168.1.4:') || (isLan && clean.includes('api.printbooth.co.in'))) {
        try {
          localStorage.removeItem('pb_api_url')
        } catch {}
      } else {
        return clean
      }
    }
    const winApi = (window as any).__PRINTBOOTH_API_URL__
    if (winApi && typeof winApi === 'string' && winApi.trim()) {
      const clean = winApi.trim().replace(/\/+$/, '').replace(/\/api$/, '')
      if (!clean.includes('192.168.1.4:') && !(isLan && clean.includes('api.printbooth.co.in'))) {
        return clean
      }
    }
  }
  const envApi = import.meta.env.VITE_API_URL
  if (envApi && typeof envApi === 'string' && envApi.trim()) {
    return envApi.trim().replace(/\/+$/, '').replace(/\/api$/, '')
  }
  if (typeof window !== 'undefined') {
    const h = window.location.hostname
    if (isLocalOrLanHost(h)) {
      return `http://${h}:5000`
    }
  }
  return 'https://api.printbooth.co.in'
}

export function getKioskQrUrl(kioskId: string, customBaseUrl?: string, sessionToken?: string): string {
  const base = (customBaseUrl || getKioskSiteUrl()).replace(/\/+$/, '')
  const idPart = encodeURIComponent(kioskId || 'PB-001')
  if (sessionToken && sessionToken !== 'init') {
    return `${base}/print?id=${idPart}&session=${encodeURIComponent(sessionToken)}`
  }
  return `${base}/print?id=${idPart}`
}

export function setKioskSiteUrl(url: string) {
  if (typeof window === 'undefined') return
  const clean = url.trim().replace(/\/+$/, '')
  if (clean.includes('192.168.') || clean.includes('localhost') || clean.includes(':5200') || clean.includes('127.0.0.1')) {
    return
  }
  localStorage.setItem('pb_site_url', clean)
  localStorage.setItem('pb_web_url', clean)
  window.dispatchEvent(new CustomEvent('pb_site_url_changed', { detail: clean }))
}

export async function loadKioskRuntimeConfig(): Promise<{ apiUrl?: string; kioskId?: string; siteUrl?: string } | null> {
  if (typeof window === 'undefined') return null
  try {
    const res = await fetch('/config.json', { cache: 'no-cache' })
    if (res.ok) {
      const data = await res.json()
      if (data.apiUrl && !localStorage.getItem('pb_api_url')) {
        localStorage.setItem('pb_api_url', data.apiUrl)
      }
      if (data.kioskId && !localStorage.getItem('pb_kiosk_id')) {
        localStorage.setItem('pb_kiosk_id', data.kioskId)
      }
      if (data.siteUrl && !localStorage.getItem('pb_site_url')) {
        setKioskSiteUrl(data.siteUrl)
      }
      return data
    }
  } catch {}
  return null
}

/**
 * Fetches the site URL dynamically from the backend server so the kiosk
 * never needs its own .env file.
 */
export async function fetchRemoteSiteConfig(apiUrl: string, kioskId: string = 'PB-001'): Promise<string | null> {
  try {
    const isLan = typeof window !== 'undefined' && isLocalOrLanHost(window.location.hostname)
    const cleanApi = (apiUrl || getKioskApiUrl()).replace(/\/api$/, '')
    // Try kiosk-specific config first, then global /api/config
    let res = await fetch(`${cleanApi}/api/kiosks/${encodeURIComponent(kioskId)}/config`).catch(() => null)
    if (!res || !res.ok) {
      res = await fetch(`${cleanApi}/api/config?kioskId=${encodeURIComponent(kioskId)}`).catch(() => null)
    }

    if (res && res.ok) {
      const data = await res.json()
      if (data.kioskVariant || data.variant) {
        setKioskVariant((data.kioskVariant || data.variant).toLowerCase().includes('lite') ? 'lite' : 'pro')
      }
      const resolved = data.siteUrl || data.webUrl || data.clientWebUrl
      if (resolved && typeof resolved === 'string' && resolved.trim()) {
        const clean = resolved.trim().replace(/\/+$/, '')
        if (!clean.includes('192.168.1.4:') && !(isLan && clean.includes('printbooth.co.in'))) {
          setKioskSiteUrl(clean)
          return clean
        }
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
export function useKioskSiteUrl(apiUrl: string = getKioskApiUrl(), kioskId: string = 'PB-001', sessionToken?: string) {
  const [siteUrl, setSiteUrlState] = useState<string>(() => getKioskSiteUrl())
  const [qrUrl, setQrUrl] = useState<string>(() => getKioskQrUrl(kioskId, siteUrl, sessionToken))

  const updateSiteUrl = useCallback((newUrl: string) => {
    setKioskSiteUrl(newUrl)
    setSiteUrlState(newUrl)
    setQrUrl(getKioskQrUrl(kioskId, newUrl, sessionToken))
  }, [kioskId, sessionToken])

  // Sync with cross-tab / CustomEvent updates
  useEffect(() => {
    const handler = (e: any) => {
      const url = e.detail || getKioskSiteUrl()
      setSiteUrlState(url)
      setQrUrl(getKioskQrUrl(kioskId, url, sessionToken))
    }
    window.addEventListener('pb_site_url_changed', handler)
    window.addEventListener('storage', handler)
    return () => {
      window.removeEventListener('pb_site_url_changed', handler)
      window.removeEventListener('storage', handler)
    }
  }, [kioskId, sessionToken])

  // Auto-fetch from backend API on mount
  useEffect(() => {
    fetchRemoteSiteConfig(apiUrl, kioskId).then(remoteUrl => {
      if (remoteUrl) {
        setSiteUrlState(remoteUrl)
        setQrUrl(getKioskQrUrl(kioskId, remoteUrl, sessionToken))
      }
    })
  }, [apiUrl, kioskId, sessionToken])

  // Keep QR code synchronized if kioskId changes
  useEffect(() => {
    setQrUrl(getKioskQrUrl(kioskId, siteUrl, sessionToken))
  }, [kioskId, siteUrl, sessionToken])

  return {
    siteUrl,
    qrUrl,
    setSiteUrl: updateSiteUrl,
  }
}
