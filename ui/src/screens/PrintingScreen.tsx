import { useNavigate } from 'react-router-dom'
import PrinterDispenseAnimation from '../components/PrinterDispenseAnimation'

export default function PrintingScreen() {
  const navigate = useNavigate()
  const fileName = sessionStorage.getItem('pb_file_name') || 'document.pdf'
  const rawColour = sessionStorage.getItem('pb_colour_mode') || 'BW'
  const isColor = rawColour.toUpperCase() === 'COLOUR' || rawColour.toUpperCase() === 'COLOR'
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
