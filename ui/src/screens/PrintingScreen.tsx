import { useNavigate } from 'react-router-dom'
import PrinterDispenseAnimation from '../components/PrinterDispenseAnimation'

export default function PrintingScreen() {
  const navigate = useNavigate()
  const fileName = sessionStorage.getItem('pb_file_name') || 'document.pdf'
  const rawSettings = sessionStorage.getItem('pb_settings')
  let parsedColour = ''
  if (rawSettings) {
    try {
      const parsed = JSON.parse(rawSettings)
      parsedColour = parsed.colour || parsed.colourMode || ''
    } catch {}
  }
  const rawColour = sessionStorage.getItem('pb_colour_mode') || sessionStorage.getItem('pb_colour') || parsedColour || 'BW'
  const isColor = String(rawColour).toUpperCase().includes('COL')
  const rawCount = Number(sessionStorage.getItem('pb_page_count') || 1)
  const copies = Number(sessionStorage.getItem('pb_copies') || 1)

  return (
    <PrinterDispenseAnimation
      fileName={fileName}
      sheets={rawCount}
      copies={copies}
      colourMode={isColor ? 'color' : 'mono'}
      onComplete={() => navigate('/')}
    />
  )
}
