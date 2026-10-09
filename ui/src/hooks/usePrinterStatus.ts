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
  const isLocalPiDetectedRef = useRef(
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  )
  const failureStreakRef = useRef(0)
  const successStreakRef = useRef(0)
  const isOfflineRef = useRef(isOffline)
  isOfflineRef.current = isOffline

  const checkStatus = useCallback(async () => {
    if (forceOffline) {
      setIsOffline(true)
      return
    }
    if (checkingRef.current) return
    checkingRef.current = true

    try {
      // 1. First probe local Raspberry Pi HTTP daemon if present (Port 5175 /api/printer/status)
      let localProbeSucceeded = false
      try {
        const localRes = await fetch('/api/printer/status', { signal: AbortSignal.timeout(4000) })
        if (localRes.ok) {
          const localData = await localRes.json()
          localProbeSucceeded = true
          isLocalPiDetectedRef.current = true

          const online = Boolean(localData.isOnline)
          const pStat = String(localData.printerStatus || (online ? 'READY' : 'OFFLINE')).toUpperCase()
          setPrinterStatus(pStat)

          if (!online || pStat === 'OFFLINE' || pStat === 'STOPPED' || pStat === 'ERROR') {
            failureStreakRef.current += 1
            successStreakRef.current = 0
            setIsOffline(true)
            setReason('The printer is currently offline or rebooting after a power cycle.')
            setDetail('The station is auto-recovering and will resume automatically as soon as the printer is ready.')
            return
          } else {
            // Local printer is physically confirmed ready
            successStreakRef.current += 1
            failureStreakRef.current = 0
            setIsOffline(false)
            return
          }
        }
      } catch {
        // Local probe timed out or network error
      }

      // If we are on the Raspberry Pi and local probe was previously active,
      // do not let remote fleet backend falsely clear an offline state during local recovery!
      if (isLocalPiDetectedRef.current && isOfflineRef.current && !localProbeSucceeded) {
        // Keep offline state while local daemon is restarting or recovering CUPS
        return
      }

      // 2. Query central backend kiosk fleet status
      try {
        const cleanId = encodeURIComponent(kioskId || 'PB-001')
        const netRes = await fetch(`${apiUrl}/api/kiosks/${cleanId}`, { signal: AbortSignal.timeout(3500) })
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
            failureStreakRef.current += 1
            successStreakRef.current = 0
            setIsOffline(true)
            setReason(
              k.printerStatus === 'OFFLINE'
                ? 'Printer is offline or disconnected.'
                : 'Printing station is currently unavailable.'
            )
            setDetail(`Station ${k.name || kioskId} is auto-recovering hardware connection.`)
            return
          } else {
            successStreakRef.current += 1
            // Hysteresis: require 2 confirmations before clearing offline status if recovering
            if (!isOfflineRef.current || successStreakRef.current >= 2) {
              failureStreakRef.current = 0
              setIsOffline(false)
            }
            return
          }
        }
      } catch {
        // Central API unreachable
      }

      // 3. Fallback: Query print detect endpoint
      try {
        const detRes = await fetch(`${apiUrl}/api/print/detect`, { signal: AbortSignal.timeout(3000) })
        if (detRes.ok) {
          const detData = await detRes.json()
          if (!detData.isOnline) {
            failureStreakRef.current += 1
            successStreakRef.current = 0
            setIsOffline(true)
            setPrinterStatus('OFFLINE')
            return
          } else {
            successStreakRef.current += 1
            if (!isOfflineRef.current || successStreakRef.current >= 2) {
              failureStreakRef.current = 0
              setIsOffline(false)
              setPrinterStatus('READY')
            }
            return
          }
        }
      } catch {}

      // If all probes failed while previously online:
      // Debounce: only switch to offline after 2 consecutive probe failures to prevent transient network blips from flickering
      failureStreakRef.current += 1
      if (failureStreakRef.current >= 2 && !isOfflineRef.current) {
        setIsOffline(true)
        setPrinterStatus('OFFLINE')
      }
    } finally {
      checkingRef.current = false
    }
  }, [apiUrl, kioskId, forceOffline])

  useEffect(() => {
    checkStatus()
    // Stable 4.5s polling loop — no tearing down and recreating timer on every state toggle
    const timer = setInterval(checkStatus, 4500)
    return () => clearInterval(timer)
  }, [checkStatus])

  return {
    isOffline,
    printerStatus,
    reason,
    detail,
    checkNow: checkStatus,
  }
}
