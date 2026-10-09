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
    urlParams.get('api') ||
    urlParams.get('apiUrl') ||
    localStorage.getItem('pb_api_url') ||
    (window as any).__PRINTBOOTH_API_URL__ ||
    import.meta.env.VITE_PRINTBOOTH_API_URL ||
    import.meta.env.VITE_API_URL ||
    'http://localhost:5000'
  ).replace(/\/api$/, '')

  const effectiveKioskId = (
    urlParams.get('kioskId') ||
    urlParams.get('id') ||
    kioskId ||
    localStorage.getItem('pb_kiosk_id') ||
    (window as any).__PRINTBOOTH_KIOSK_ID__ ||
    import.meta.env.VITE_KIOSK_ID ||
    'PB-001'
  ).trim().toUpperCase()

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

    // 0. Immediate hardware / network check
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setIsOffline(true)
      setPrinterStatus('OFFLINE')
      setReason('Station is offline or network connection interrupted.')
      setDetail('PrintBooth is waiting for network reconnection and will resume automatically once connected.')
      return
    }

    if (checkingRef.current) return
    checkingRef.current = true

    try {
      // 1. First probe local Raspberry Pi / API status endpoint (Port 5175 /api/printer/status)
      let localProbeSucceeded = false
      try {
        const localRes = await fetch('/api/printer/status', { signal: AbortSignal.timeout(3000) })
        if (localRes.ok) {
          const localData = await localRes.json()
          localProbeSucceeded = true
          isLocalPiDetectedRef.current = true

          const online = Boolean(localData.isOnline)
          const pStat = String(localData.printerStatus || (online ? 'READY' : 'OFFLINE')).toUpperCase()
          setPrinterStatus(pStat)

          if (!online || pStat === 'OFFLINE' || pStat === 'STOPPED' || pStat === 'ERROR' || pStat === 'DISCONNECTED') {
            failureStreakRef.current += 1
            successStreakRef.current = 0
            setIsOffline(true)
            setReason('The printer is currently offline or disconnected.')
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

      // If on Raspberry Pi and local probe was previously active, keep offline during local recovery
      if (isLocalPiDetectedRef.current && isOfflineRef.current && !localProbeSucceeded) {
        return
      }

      // 2. Query central backend kiosk fleet status
      try {
        const cleanId = encodeURIComponent(effectiveKioskId)
        const netRes = await fetch(`${apiUrl}/api/kiosks/${cleanId}`, { signal: AbortSignal.timeout(3500) })
        if (netRes.ok) {
          const netData = await netRes.json()
          const k = netData.data || netData
          const kStatus = String(k.status || '').toUpperCase()
          const pStatus = String(k.printerStatus || '').toUpperCase()
          const hw = k.hardwareDetails

          const isProblem =
            Boolean(k.isOffline) ||
            kStatus === 'OFFLINE' ||
            kStatus === 'DISCONNECTED' ||
            pStatus === 'OFFLINE' ||
            pStatus === 'ERROR' ||
            pStatus === 'STOPPED' ||
            pStatus === 'DISCONNECTED' ||
            (hw && (hw.isOnline === false || hw.isAvailable === false || hw.isHardwareReady === false)) ||
            (pStatus && !['READY', 'IDLE', 'PRINTING'].includes(pStatus))

          if (isProblem) {
            failureStreakRef.current += 1
            successStreakRef.current = 0
            setIsOffline(true)
            setPrinterStatus(pStatus || 'OFFLINE')
            setReason(
              pStatus === 'OFFLINE' || pStatus === 'DISCONNECTED'
                ? 'Printer is offline or disconnected.'
                : 'Printing station is currently unavailable.'
            )
            setDetail(`Station ${k.name || effectiveKioskId} is auto-recovering hardware connection.`)
            return
          } else {
            successStreakRef.current += 1
            failureStreakRef.current = 0
            setIsOffline(false)
            setPrinterStatus(pStatus || 'READY')
            return
          }
        }
      } catch {
        // Central API unreachable
      }

      // 3. Fallback: Query print detect endpoint
      try {
        const cleanId = encodeURIComponent(effectiveKioskId)
        const detRes = await fetch(`${apiUrl}/api/print/detect?kioskId=${cleanId}`, { signal: AbortSignal.timeout(3000) })
        if (detRes.ok) {
          const detData = await detRes.json()
          const isOnline = Boolean(detData.isAvailable || detData.isHardwareReady || detData.details?.is_online)
          if (!isOnline) {
            failureStreakRef.current += 1
            successStreakRef.current = 0
            setIsOffline(true)
            setPrinterStatus('OFFLINE')
            setReason(detData.reason || 'Printer is offline or disconnected.')
            setDetail('Station is checking hardware connection.')
            return
          } else {
            successStreakRef.current += 1
            failureStreakRef.current = 0
            setIsOffline(false)
            setPrinterStatus('READY')
            return
          }
        }
      } catch {}

      // If all probes failed: station is offline or server unreachable
      failureStreakRef.current += 1
      setIsOffline(true)
      setPrinterStatus('OFFLINE')
      setReason('Station is offline or network connection interrupted.')
      setDetail('PrintBooth is reconnecting and will resume automatically as soon as connection is restored.')
    } finally {
      checkingRef.current = false
    }
  }, [apiUrl, effectiveKioskId, forceOffline])

  useEffect(() => {
    checkStatus()

    const handleOffline = () => {
      setIsOffline(true)
      setPrinterStatus('OFFLINE')
      setReason('Station is offline or network connection interrupted.')
      setDetail('PrintBooth is waiting for network reconnection and will resume automatically once connected.')
    }
    const handleOnline = () => {
      checkStatus()
    }

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)

    // Fast 3s polling loop to immediately detect physical printer disconnection
    const timer = setInterval(checkStatus, 3000)
    return () => {
      clearInterval(timer)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [checkStatus])

  return {
    isOffline,
    printerStatus,
    reason,
    detail,
    checkNow: checkStatus,
  }
}
