import { useState, useEffect, useCallback, useRef } from 'react'

export interface PrinterStatusInfo {
  isOffline: boolean
  printerStatus: string
  reason: string
  detail: string
  checkNow: () => void
}

export function usePrinterStatus(kioskId: string = 'PB-001', customApiUrl?: string): PrinterStatusInfo {
  const urlParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
  const forceOffline = urlParams.get('offline') === '1' || urlParams.get('error') === '1'
  const [isOffline, setIsOffline] = useState(forceOffline)
  const [printerStatus, setPrinterStatus] = useState(forceOffline ? 'OFFLINE' : 'READY')
  const [reason, setReason] = useState('Printer is currently offline or rebooting after a power cycle.')
  const [detail, setDetail] = useState('The station is auto-recovering and will resume automatically as soon as the printer is ready.')

  const apiUrl = (
    customApiUrl ||
    localStorage.getItem('pb_api_url') ||
    (window as any).__PRINTBOOTH_API_URL__ ||
    import.meta.env.VITE_PRINTBOOTH_API_URL ||
    import.meta.env.VITE_API_URL ||
    'http://localhost:5000'
  ).replace(/\/api$/, '')

  const checkingRef = useRef(false)

  const checkStatus = useCallback(async () => {
    if (forceOffline) {
      setIsOffline(true)
      return
    }
    if (checkingRef.current) return
    checkingRef.current = true

    try {
      // 1. First probe local Raspberry Pi HTTP daemon if present
      try {
        const localRes = await fetch('/api/printer/status', { signal: AbortSignal.timeout(2000) })
        if (localRes.ok) {
          const localData = await localRes.json()
          const online = Boolean(localData.isOnline)
          const pStat = String(localData.printerStatus || (online ? 'READY' : 'OFFLINE')).toUpperCase()
          setPrinterStatus(pStat)

          if (!online || pStat === 'OFFLINE' || pStat === 'STOPPED' || pStat === 'ERROR') {
            setIsOffline(true)
            setReason('The printer is currently offline or rebooting after a power cycle.')
            setDetail('The station is auto-recovering and will resume automatically as soon as the printer is ready.')
            return
          } else {
            setIsOffline(false)
            return
          }
        }
      } catch {
        // Local probe failed, fall back to backend API
      }

      // 2. Query central backend kiosk fleet status
      try {
        const cleanId = encodeURIComponent(kioskId || 'PB-001')
        const netRes = await fetch(`${apiUrl}/api/kiosks/${cleanId}`, { signal: AbortSignal.timeout(3000) })
        if (netRes.ok) {
          const netData = await netRes.json()
          const k = netData.data || netData
          const kStatus = String(k.status || '').toUpperCase()
          const pStatus = String(k.printerStatus || '').toUpperCase()
          setPrinterStatus(pStatus || kStatus)

          const isProblem =
            kStatus === 'OFFLINE' ||
            pStatus === 'OFFLINE' ||
            pStatus === 'ERROR' ||
            pStatus === 'STOPPED' ||
            Boolean(k.isOffline)

          if (isProblem) {
            setIsOffline(true)
            setReason(
              k.printerStatus === 'OFFLINE'
                ? 'Printer is offline or disconnected.'
                : 'Printing station is currently unavailable.'
            )
            setDetail(`Station ${k.name || kioskId} is auto-recovering hardware connection.`)
            return
          } else {
            setIsOffline(false)
            return
          }
        }
      } catch {
        // Central API unreachable, probe detect fallback
      }

      // 3. Probe detect endpoint fallback
      try {
        const detRes = await fetch(`${apiUrl}/api/print/detect`, { signal: AbortSignal.timeout(3000) })
        if (detRes.ok) {
          const detData = await detRes.json()
          if (!detData.isOnline) {
            setIsOffline(true)
            setPrinterStatus('OFFLINE')
            return
          } else {
            setIsOffline(false)
            return
          }
        }
      } catch {}
    } finally {
      checkingRef.current = false
    }
  }, [apiUrl, kioskId, forceOffline])

  useEffect(() => {
    checkStatus()
    // Poll every 4 seconds if offline to immediately catch printer recovery, 10 seconds if online
    const intervalTime = isOffline ? 4000 : 10000
    const timer = setInterval(checkStatus, intervalTime)
    return () => clearInterval(timer)
  }, [checkStatus, isOffline])

  return {
    isOffline,
    printerStatus,
    reason,
    detail,
    checkNow: checkStatus,
  }
}
