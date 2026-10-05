import { useState, useCallback } from 'react'
import { Backspace, CheckCircle, Keyboard, Key } from '@phosphor-icons/react'
import './CustomKioskKeyboard.css'

interface CustomKioskKeyboardProps {
  onKeyPress: (char: string) => void
  onBackspace: () => void
  onClear: () => void
  onSubmit?: () => void
  disabled?: boolean
  submitLabel?: string
  showAlphaToggle?: boolean
}

// Synthetic physical tactile click sound via Web Audio API
function playKeyClickSound() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(680, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(320, ctx.currentTime + 0.035)
    gain.gain.setValueAtTime(0.09, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.035)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.035)
  } catch {}
}

const NUM_SUB_LETTERS: Record<string, string> = {
  '1': '',
  '2': 'ABC',
  '3': 'DEF',
  '4': 'GHI',
  '5': 'JKL',
  '6': 'MNO',
  '7': 'PQRS',
  '8': 'TUV',
  '9': 'WXYZ',
  '0': '+',
}

const QWERTY_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
]

export function CustomKioskKeyboard({
  onKeyPress,
  onBackspace,
  onClear,
  onSubmit,
  disabled = false,
  submitLabel = 'VERIFY & PRINT',
  showAlphaToggle = true,
}: CustomKioskKeyboardProps) {
  const [mode, setMode] = useState<'numeric' | 'alpha'>('numeric')

  const handleKeyClick = useCallback(
    (char: string) => {
      if (disabled) return
      playKeyClickSound()
      onKeyPress(char)
    },
    [disabled, onKeyPress]
  )

  const handleBackspaceClick = useCallback(() => {
    if (disabled) return
    playKeyClickSound()
    onBackspace()
  }, [disabled, onBackspace])

  const handleClearClick = useCallback(() => {
    if (disabled) return
    playKeyClickSound()
    onClear()
  }, [disabled, onClear])

  const handleSubmitClick = useCallback(() => {
    if (disabled) return
    playKeyClickSound()
    onSubmit?.()
  }, [disabled, onSubmit])

  return (
    <div className={`kiosk-keyboard-wrapper ${disabled ? 'is-disabled' : ''}`}>
      {/* Mode switch pill */}
      {showAlphaToggle && (
        <div className="kiosk-kb-mode-bar">
          <button
            type="button"
            className={`kiosk-kb-tab ${mode === 'numeric' ? 'active' : ''}`}
            onClick={() => {
              playKeyClickSound()
              setMode('numeric')
            }}
          >
            <Key size={16} weight="bold" />
            <span>NUMPAD (PIN)</span>
          </button>
          <button
            type="button"
            className={`kiosk-kb-tab ${mode === 'alpha' ? 'active' : ''}`}
            onClick={() => {
              playKeyClickSound()
              setMode('alpha')
            }}
          >
            <Keyboard size={16} weight="bold" />
            <span>ALPHANUMERIC (QWERTY)</span>
          </button>
        </div>
      )}

      {mode === 'numeric' ? (
        /* ── Touch Numpad (Large 3x4 Layout) ── */
        <div className="kiosk-numpad-grid">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(num => (
            <button
              key={num}
              type="button"
              className="kiosk-num-key"
              disabled={disabled}
              onClick={() => handleKeyClick(num)}
            >
              <span className="kiosk-key-digit">{num}</span>
              {NUM_SUB_LETTERS[num] && (
                <span className="kiosk-key-sub">{NUM_SUB_LETTERS[num]}</span>
              )}
            </button>
          ))}

          {/* Bottom row: Clear, 0, Backspace */}
          <button
            type="button"
            className="kiosk-num-key kiosk-action-key kiosk-key-clear"
            disabled={disabled}
            onClick={handleClearClick}
            aria-label="Clear All"
          >
            <span className="kiosk-action-text">CLEAR</span>
          </button>

          <button
            type="button"
            className="kiosk-num-key"
            disabled={disabled}
            onClick={() => handleKeyClick('0')}
          >
            <span className="kiosk-key-digit">0</span>
            <span className="kiosk-key-sub">{NUM_SUB_LETTERS['0']}</span>
          </button>

          <button
            type="button"
            className="kiosk-num-key kiosk-action-key kiosk-key-backspace"
            disabled={disabled}
            onClick={handleBackspaceClick}
            aria-label="Backspace"
          >
            <Backspace size={28} weight="fill" />
          </button>
        </div>
      ) : (
        /* ── Alphanumeric QWERTY Touch Layout ── */
        <div className="kiosk-qwerty-grid">
          {/* Row 0: Digits */}
          <div className="kiosk-qwerty-row">
            {QWERTY_ROWS[0].map(ch => (
              <button
                key={ch}
                type="button"
                className="kiosk-alpha-key kiosk-key-num"
                disabled={disabled}
                onClick={() => handleKeyClick(ch)}
              >
                {ch}
              </button>
            ))}
          </div>

          {/* Row 1 */}
          <div className="kiosk-qwerty-row">
            {QWERTY_ROWS[1].map(ch => (
              <button
                key={ch}
                type="button"
                className="kiosk-alpha-key"
                disabled={disabled}
                onClick={() => handleKeyClick(ch)}
              >
                {ch}
              </button>
            ))}
          </div>

          {/* Row 2 */}
          <div className="kiosk-qwerty-row" style={{ padding: '0 12px' }}>
            {QWERTY_ROWS[2].map(ch => (
              <button
                key={ch}
                type="button"
                className="kiosk-alpha-key"
                disabled={disabled}
                onClick={() => handleKeyClick(ch)}
              >
                {ch}
              </button>
            ))}
          </div>

          {/* Row 3 with Backspace */}
          <div className="kiosk-qwerty-row">
            <button
              type="button"
              className="kiosk-alpha-key kiosk-key-wide kiosk-key-clear-small"
              disabled={disabled}
              onClick={handleClearClick}
            >
              AC
            </button>
            {QWERTY_ROWS[3].map(ch => (
              <button
                key={ch}
                type="button"
                className="kiosk-alpha-key"
                disabled={disabled}
                onClick={() => handleKeyClick(ch)}
              >
                {ch}
              </button>
            ))}
            <button
              type="button"
              className="kiosk-alpha-key kiosk-key-wide kiosk-key-backspace-small"
              disabled={disabled}
              onClick={handleBackspaceClick}
              aria-label="Backspace"
            >
              <Backspace size={24} weight="fill" />
            </button>
          </div>
        </div>
      )}

      {/* Manual Submit Button */}
      {onSubmit && (
        <button
          type="button"
          className="kiosk-kb-submit-btn"
          disabled={disabled}
          onClick={handleSubmitClick}
        >
          <CheckCircle size={24} weight="fill" />
          <span>{submitLabel}</span>
        </button>
      )}
    </div>
  )
}
