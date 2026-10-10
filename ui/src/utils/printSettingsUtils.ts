export type ColourMode = 'BW' | 'COLOUR'
export type DuplexMode = 'SINGLE' | 'DOUBLE'
export type PaperSize = 'A4' | 'A3' | 'LETTER' | 'LEGAL' | 'LEDGER' | 'A5'

export interface FileSettings {
  pages: string
  copies: number
  pageCopies?: Record<string, number>
  colour: ColourMode
  pageColours?: Record<string, ColourMode>
  duplex: DuplexMode
  paperSize: PaperSize
  scaling?: 'FIT' | 'ACTUAL'
  dpi?: '600' | '1200'
  orientation?: 'AUTO' | 'PORTRAIT' | 'LANDSCAPE'
  pagesPerSheet?: number
  margins?: 'STANDARD' | 'BORDERLESS'
  contrastMode?: 'BALANCED' | 'CRISP_TEXT'
}

export function parsePageRange(val: string, total: number): number[] {
  if (!val || val.trim().toUpperCase() === 'ALL') {
    return Array.from({ length: Math.max(1, total) }, (_, i) => i + 1)
  }
  const selected = new Set<number>()
  const parts = val.split(',').map(s => s.trim()).filter(Boolean)
  for (const part of parts) {
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-').map(s => s.trim())
      const start = Math.max(1, parseInt(startStr, 10) || 1)
      const end = Math.min(total, parseInt(endStr, 10) || total)
      if (start <= end) {
        for (let i = start; i <= end; i++) selected.add(i)
      }
    } else {
      const p = parseInt(part, 10)
      if (!isNaN(p) && p >= 1 && p <= total) selected.add(p)
    }
  }
  const res = Array.from(selected).sort((a, b) => a - b)
  return res.length > 0 ? res : Array.from({ length: Math.max(1, total) }, (_, i) => i + 1)
}

export function formatPageRange(pages: number[], total: number): string {
  if (!pages.length) return 'ALL'
  if (pages.length === total && total > 0) return 'ALL'
  if (pages.length === 1 && pages[0] === 1) return '1'

  const sorted = Array.from(new Set(pages)).sort((a, b) => a - b)
  const ranges: string[] = []
  let start = sorted[0]
  let prev = start

  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]
    if (cur === prev + 1) {
      prev = cur
    } else {
      ranges.push(start === prev ? `${start}` : `${start}-${prev}`)
      start = cur
      prev = cur
    }
  }
  ranges.push(start === prev ? `${start}` : `${start}-${prev}`)
  return ranges.join(', ')
}

export interface KioskPricing {
  bwSingle: number
  bwDouble: number
  colorSingle: number
  colorDouble: number
}

export function getKioskPricing(): KioskPricing {
  try {
    const saved = sessionStorage.getItem('pb_kiosk_pricing')
    if (saved) {
      const parsed = JSON.parse(saved)
      if (typeof parsed?.bwSingle === 'number') {
        return {
          bwSingle: Number(parsed.bwSingle),
          bwDouble: Number(parsed.bwDouble),
          colorSingle: Number(parsed.colorSingle),
          colorDouble: Number(parsed.colorDouble),
        }
      }
    }
  } catch {}
  return {
    bwSingle: 2,
    bwDouble: 3,
    colorSingle: 8,
    colorDouble: 12,
  }
}

export function calcFileTotalSheets(
  pageCount: number,
  pages: string,
  copies: number,
  duplex: DuplexMode,
  pageCopies?: Record<string, number>,
  pagesPerSheet: number = 1
): number {
  const selectedPages = parsePageRange(pages, pageCount)
  let totalPagePrints = 0
  if (pageCopies && Object.keys(pageCopies).length > 0) {
    for (const p of selectedPages) {
      const c = Number(pageCopies[String(p)]) || copies || 1
      totalPagePrints += Math.max(1, c)
    }
  } else {
    totalPagePrints = selectedPages.length * Math.max(1, copies)
  }

  const effectivePrints = Math.max(1, Math.ceil(totalPagePrints / pagesPerSheet))
  if (duplex === 'DOUBLE') {
    return Math.max(1, Math.ceil(effectivePrints / 2))
  }
  return effectivePrints
}

export function calcFileTotalPrice(
  pageCount: number,
  pages: string,
  copies: number,
  duplex: DuplexMode,
  colour: ColourMode,
  pageColours?: Record<string, ColourMode>,
  pageCopies?: Record<string, number>
): number {
  const selectedPages = parsePageRange(pages, pageCount)
  const isDuplex = duplex === 'DOUBLE'
  const hasPageColours = pageColours && Object.keys(pageColours).length > 0
  const hasPageCopies = pageCopies && Object.keys(pageCopies).length > 0
  const pricing = getKioskPricing()

  if (!hasPageColours) {
    const sheets = calcFileTotalSheets(pageCount, pages, copies, duplex, pageCopies)
    const PRICES: Record<string, number> = {
      BW_SINGLE: pricing.bwSingle,
      BW_DOUBLE: pricing.bwDouble,
      COLOUR_SINGLE: pricing.colorSingle,
      COLOUR_DOUBLE: pricing.colorDouble,
    }
    const key = `${colour}_${duplex}`
    return sheets * (PRICES[key] ?? pricing.bwSingle)
  }

  const impressions: ColourMode[] = []
  for (const p of selectedPages) {
    const pCopies = hasPageCopies ? (Number(pageCopies?.[String(p)]) || copies || 1) : (copies || 1)
    const pColour = pageColours?.[String(p)] || colour
    for (let c = 0; c < Math.max(1, pCopies); c++) {
      impressions.push(pColour)
    }
  }

  if (!isDuplex) {
    return impressions.reduce((acc, col) => acc + (col === 'COLOUR' ? pricing.colorSingle : pricing.bwSingle), 0)
  } else {
    let total = 0
    for (let i = 0; i < impressions.length; i += 2) {
      const side1 = impressions[i]
      const side2 = impressions[i + 1]
      if (side2 !== undefined) {
        const hasColour = side1 === 'COLOUR' || side2 === 'COLOUR'
        total += hasColour ? pricing.colorDouble : pricing.bwDouble
      } else {
        total += side1 === 'COLOUR' ? pricing.colorSingle : pricing.bwSingle
      }
    }
    return Math.max(1, total)
  }
}
