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
  const isLan = typeof window !== 'undefined' && isLocalOrLanHost(window.location.hostname)

  // 1. Explicit runtime query parameter override (?siteUrl=... or ?webUrl=...)
  if (typeof window !== 'undefined') {
    const search = new URLSearchParams(window.location.search)
    const paramUrl = search.get('siteUrl') || search.get('webUrl') || search.get('clientWebUrl')
    if (paramUrl && paramUrl.trim()) {
      return paramUrl.trim().replace(/\/+$/, '')
    }

    // Proactively clean up obsolete hardcoded IP from local storage if present
    const localUrl = localStorage.getItem('pb_site_url') || localStorage.getItem('pb_web_url')
    if (localUrl && (localUrl.includes('192.168.1.4:') || (isLan && localUrl.includes('printbooth.co.in')))) {
      try {
        localStorage.removeItem('pb_site_url')
        localStorage.removeItem('pb_web_url')
      } catch {}
    }
  }

  // 2. Environment variable from .env (VITE_SITE_URL or VITE_CLIENT_WEB_URL)
  const envUrl = import.meta.env.VITE_SITE_URL || import.meta.env.VITE_CLIENT_WEB_URL
  if (envUrl && typeof envUrl === 'string' && envUrl.trim()) {
    const cleanEnv = envUrl.trim().replace(/\/+$/, '')
    if (!cleanEnv.includes('192.168.1.4:')) {
      return cleanEnv
    }
  }

  // 3. User / session local storage override (if clean)
  if (typeof window !== 'undefined') {
    const localUrl = localStorage.getItem('pb_site_url') || localStorage.getItem('pb_web_url')
    if (localUrl && localUrl.trim()) {
      const clean = localUrl.trim().replace(/\/+$/, '')
      if (!clean.includes('192.168.1.4:') && !(isLan && clean.includes('printbooth.co.in'))) {
        return clean
      }
    }

    const winUrl = (window as any).__PRINTBOOTH_SITE_URL__ || (window as any).__PRINTBOOTH_WEB_URL__
    if (winUrl && typeof winUrl === 'string' && winUrl.trim()) {
      const clean = winUrl.trim().replace(/\/+$/, '')
      if (!clean.includes('192.168.1.4:') && !(isLan && clean.includes('printbooth.co.in'))) {
        return clean
      }
    }
  }

  // 4. Dynamic hostname resolution (matches current browser host on port 5200)
  if (typeof window !== 'undefined') {
    const h = window.location.hostname
    if (isLocalOrLanHost(h)) {
      const proto = window.location.protocol || 'http:'
      return `${proto}//${h}:5200`
    }
  }

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
