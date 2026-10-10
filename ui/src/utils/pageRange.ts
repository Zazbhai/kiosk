/**
 * PrintBooth Kiosk - Page Range & User Specified Print Resolution
 * ===============================================================
 * Parses human-entered and API-provided page ranges (e.g. "1-2", "1, 3", "ALL", [1, 2])
 * and constructs the exact sheet queue for physical and animated kiosk printing.
 */

export interface PrintSheet {
  fileName: string
  pageIndex: number
  mode: 'mono' | 'color'
}

/**
 * Parses user-specified page ranges into a deduplicated, ascending array of 1-indexed page numbers.
 * @param val Range string (e.g. "1-2", "1, 3", "ALL"), array of numbers, or JSON string
 * @param total Total document pages in the source document
 */
export function parsePageRange(
  val: string | number[] | undefined | null,
  total: number
): number[] {
  const maxTotal = Math.max(1, isNaN(Number(total)) ? 1 : Number(total))

  if (Array.isArray(val)) {
    const valid = val
      .map(Number)
      .filter(n => !isNaN(n) && n >= 1 && n <= maxTotal)
    if (valid.length > 0) {
      return Array.from(new Set(valid)).sort((a, b) => a - b)
    }
  }

  if (
    val === undefined ||
    val === null ||
    typeof val !== 'string' ||
    !val.trim() ||
    val.trim().toUpperCase() === 'ALL' ||
    val.trim() === '*'
  ) {
    return Array.from({ length: maxTotal }, (_, i) => i + 1)
  }

  const clean = val.trim()

  // Handle serialized JSON arrays (e.g. "[1, 2]")
  if (clean.startsWith('[') && clean.endsWith(']')) {
    try {
      const parsed = JSON.parse(clean)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsePageRange(parsed, maxTotal)
      }
    } catch {}
  }

  const selected = new Set<number>()
  const parts = clean.split(',').map(s => s.trim()).filter(Boolean)

  for (const part of parts) {
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-').map(s => s.trim())
      const start = Math.max(1, parseInt(startStr, 10) || 1)
      const end = Math.min(maxTotal, parseInt(endStr, 10) || maxTotal)
      if (start <= end) {
        for (let i = start; i <= end; i++) selected.add(i)
      }
    } else {
      const p = parseInt(part, 10)
      if (!isNaN(p) && p >= 1 && p <= maxTotal) {
        selected.add(p)
      }
    }
  }

  const res = Array.from(selected).sort((a, b) => a - b)
  return res.length > 0 ? res : Array.from({ length: maxTotal }, (_, i) => i + 1)
}

/**
 * Resolves the exact list of sheets to animate in the Kiosk printer.
 * Strictly respects the user's specified pages, per-page colors, and copies.
 */
export function resolveUserSpecifiedSheets(options: {
  fileName?: string
  primaryMode?: 'mono' | 'color'
  selectedPages?: number[]
  pageRange?: string
  totalDocPages?: number
  copies?: number
  pageColours?: Record<string, string>
  pageCopies?: Record<string, number>
}): PrintSheet[] {
  const {
    fileName = 'document.pdf',
    primaryMode = 'mono',
    totalDocPages = 1,
    copies = 1,
    pageColours = {},
    pageCopies = {},
  } = options

  let pages = options.selectedPages || []
  if (!pages.length) {
    pages = parsePageRange(options.pageRange, totalDocPages)
  }

  if (!pages.length) {
    pages = [1]
  }

  const list: PrintSheet[] = []
  const resolvedCopies = Math.max(1, copies)

  if (pageCopies && Object.keys(pageCopies).length > 0) {
    for (const p of pages) {
      const cCount = Math.max(1, Number(pageCopies[String(p)]) || resolvedCopies)
      const colStr = String(pageColours[String(p)] || '').toUpperCase()
      const mode: 'mono' | 'color' = colStr.includes('COL')
        ? 'color'
        : colStr.includes('BW')
        ? 'mono'
        : primaryMode

      for (let c = 0; c < cCount; c++) {
        list.push({ fileName, pageIndex: p, mode })
      }
    }
  } else {
    for (let c = 0; c < resolvedCopies; c++) {
      for (const p of pages) {
        const colStr = String(pageColours[String(p)] || '').toUpperCase()
        const mode: 'mono' | 'color' = colStr.includes('COL')
          ? 'color'
          : colStr.includes('BW')
          ? 'mono'
          : primaryMode

        list.push({ fileName, pageIndex: p, mode })
      }
    }
  }

  return list.length > 0 ? list : [{ fileName, pageIndex: 1, mode: primaryMode }]
}
