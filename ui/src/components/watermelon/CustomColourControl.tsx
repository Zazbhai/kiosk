import React, { useEffect, useRef } from 'react'
import type { ColourMode } from '../../utils/printSettingsUtils'
import { getKioskPricing } from '../../utils/printSettingsUtils'
import RubberSegment from '../ui/RubberSegment'
import './CustomColourControl.css'

interface CustomColourControlProps {
  selectedPages?: number[]
  globalColour: ColourMode
  pageColours?: Record<string, ColourMode>
  onGlobalColourChange: (colour: ColourMode) => void
  onPageColoursChange?: (map: Record<string, ColourMode> | undefined) => void
}

export const CustomColourControl: React.FC<CustomColourControlProps> = ({
  globalColour,
  pageColours,
  onGlobalColourChange,
  onPageColoursChange,
}) => {
  const kioskPricing = getKioskPricing()
  const onPageColoursChangeRef = useRef(onPageColoursChange)
  onPageColoursChangeRef.current = onPageColoursChange

  // Clear any existing per-page colour map so user only selects all black or all colour
  useEffect(() => {
    if (pageColours && Object.keys(pageColours).length > 0) {
      onPageColoursChangeRef.current?.(undefined)
    }
  }, [pageColours])

  return (
    <div className="clr-root" onClick={e => e.stopPropagation()}>
      <div style={{ width: '100%' }}>
        <RubberSegment
          items={[
            { value: 'BW',     label: `B&W · ₹${kioskPricing.bwSingle}/pg` },
            { value: 'COLOUR', label: `Colour · ₹${kioskPricing.colorSingle}/pg` },
          ]}
          value={globalColour || 'BW'}
          onChange={(val) => {
            onGlobalColourChange(val as ColourMode)
            onPageColoursChangeRef.current?.(undefined)
          }}
          trackColor="rgba(15, 23, 42, 0.05)"
          thumbColor={globalColour === 'COLOUR' ? '#ec4899' : '#1e293b'}
          textColor="#64748b"
          activeTextColor="#ffffff"
          size="lg"
          radius={14}
          inset={3}
          equalSlots
          stretch={85}
          squash={3}
          speed={1.15}
          draggable
        />
      </div>
    </div>
  )
}