import './PrinterDispenseAnimation.css'

interface PrinterDispenseAnimationProps {
  progress?: number
  fileName?: string
  sheets?: number
  copies?: number
  isComplete?: boolean
  phaseMessage?: string
}

/**
 * PrinterDispenseAnimation
 * Authentic hardware dispensing animation featuring the custom blue desktop printer.
 * Animates paper feed, mechanical vibration, and tray dispensing in real time.
 */
export default function PrinterDispenseAnimation({
  progress = 0,
  fileName,
  sheets,
  copies = 1,
  isComplete = false,
  phaseMessage,
}: PrinterDispenseAnimationProps) {
  const displayProgress = Math.max(0, Math.min(100, Math.round(progress)))

  const isPpt = (fileName && /\.(pptx?|ppsx?)$/i.test(fileName)) || (phaseMessage && /ppt/i.test(phaseMessage))
  const isDocx = (fileName && /\.(docx?|doc)$/i.test(fileName)) || (phaseMessage && /(docx?|word)/i.test(phaseMessage))
  const isConverting = (isPpt || isDocx) && displayProgress < 25

  const headline = isComplete
    ? 'Printing Complete!'
    : isConverting
    ? isPpt
      ? 'Processing PPT…'
      : 'Processing DOCX…'
    : phaseMessage && phaseMessage.startsWith('Processing')
    ? phaseMessage
    : 'Printing Your Document…'

  const caption = isComplete
    ? 'Your document is ready in the tray below. Please collect your pages.'
    : isConverting
    ? isPpt
      ? 'Converting presentation into high-resolution print PDF • Dispensing shortly'
      : 'Converting Word document into high-resolution print PDF • Dispensing shortly'
    : phaseMessage || 'Dispensing physical sheets from the printer. Please wait…'

  return (
    <div className={`ks-printer-anim-container ${isComplete ? 'ks-printer--complete' : 'ks-printer--active'}`}>
      <div className="ks-printer-stage">
        {/* Soft radial glow behind the printer */}
        <div className="ks-printer-ambient-glow" />

        {/* Animated paper sliding down into the top slot */}
        <div className="ks-paper-input-slot">
          <div className="ks-paper-in-sheet" />
        </div>

        {/* Main Printer Illustration with subtle mechanical vibration */}
        <div className="ks-printer-body-wrap">
          <img
            src="/printer-anim.png"
            alt="PrintBooth Hardware Dispensing"
            className="ks-printer-graphic"
            draggable={false}
          />

          {/* Hardware Status LEDs */}
          <div className="ks-printer-led ks-printer-led--green" title="Printer Online" />
          <div className="ks-printer-led ks-printer-led--busy" title="Dispensing Job" />
        </div>

        {/* Animated printed paper emerging from output tray */}
        <div className="ks-paper-output-tray">
          <div className="ks-paper-dispensing-sheet">
            <div className="ks-paper-print-line ks-line-header" />
            <div className="ks-paper-print-line ks-line-body-1" />
            <div className="ks-paper-print-line ks-line-body-2" />
          </div>
        </div>
      </div>

      {/* Progress & Document Telemetry */}
      <div className="ks-printer-meta">
        <h2 className="ks-printer-headline">
          {headline}
        </h2>
        <p className="ks-printer-caption">
          {caption}
        </p>

        {fileName && (
          <div className="ks-printer-file-badge">
            <span className="ks-printer-file-icon">📄</span>
            <span className="ks-printer-file-name">{fileName}</span>
            {sheets !== undefined && (
              <span className="ks-printer-file-count">· {sheets * copies} sheet{sheets * copies > 1 ? 's' : ''}</span>
            )}
            <span className="ks-printer-file-pct">· {displayProgress}%</span>
          </div>
        )}

        {/* Progress Bar */}
        <div className="ks-printer-progress-track">
          <div
            className="ks-printer-progress-bar"
            style={{ width: `${Math.max(5, displayProgress)}%` }}
          />
        </div>
      </div>
    </div>
  )
}
