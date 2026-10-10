import React from 'react'
import './CardAnimatedIcons.css'

interface IconProps {
  size?: number
  className?: string
  color?: string
}

/**
 * Animated Paper / Document SVG Icon for "Pages"
 * Features dual floating sheets with folded dog-ear and shimmering text lines.
 */
export const AnimatedPaperIcon: React.FC<IconProps> = ({
  size = 24,
  className = '',
  color = 'currentColor',
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`anim-paper-icon ${className}`}
      aria-label="Pages animation icon"
    >
      {/* Background fanning sheet */}
      <g className="anim-paper-back">
        <rect
          x="5"
          y="7"
          width="18"
          height="22"
          rx="3.5"
          fill="rgba(255, 255, 255, 0.22)"
          stroke={color}
          strokeWidth="1.6"
          strokeOpacity="0.6"
        />
      </g>

      {/* Front active sheet */}
      <g className="anim-paper-front">
        {/* Main paper body */}
        <path
          d="M9 4.5H20.5L26 10V26C26 27.3807 24.8807 28.5 23.5 28.5H11.5C10.1193 28.5 9 27.3807 9 26V4.5Z"
          fill="rgba(255, 255, 255, 0.35)"
          stroke={color}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        {/* Dog-ear corner fold */}
        <path
          d="M20.5 4.5V9C20.5 9.55228 20.9477 10 21.5 10H26"
          stroke={color}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="rgba(255, 255, 255, 0.45)"
        />

        {/* Content text lines with pulse animation */}
        <line
          x1="13"
          y1="14"
          x2="22"
          y2="14"
          stroke={color}
          strokeWidth="1.8"
          strokeLinecap="round"
          className="anim-paper-line-1"
        />
        <line
          x1="13"
          y1="18"
          x2="20"
          y2="18"
          stroke={color}
          strokeWidth="1.8"
          strokeLinecap="round"
          className="anim-paper-line-2"
        />
        <line
          x1="13"
          y1="22"
          x2="17"
          y2="22"
          stroke={color}
          strokeWidth="1.8"
          strokeLinecap="round"
          className="anim-paper-line-3"
        />
      </g>

      {/* Magic Sparkle on corner */}
      <g className="anim-paper-sparkle">
        <path
          d="M6 3.5L6.8 5.2L8.5 6L6.8 6.8L6 8.5L5.2 6.8L3.5 6L5.2 5.2L6 3.5Z"
          fill="#ffffff"
          opacity="0.9"
        />
      </g>
    </svg>
  )
}

/**
 * Animated Color SVG Icon for "Colour"
 * Features a modern artist palette with pulsating rainbow color wells and rotating chromatic gleam.
 */
export const AnimatedColourIcon: React.FC<IconProps> = ({
  size = 24,
  className = '',
  color = 'currentColor',
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`anim-colour-icon ${className}`}
      aria-label="Colour animation icon"
    >
      <defs>
        <radialGradient id="paletteShine" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.12" />
        </radialGradient>
      </defs>

      {/* Artist Palette Body */}
      <path
        d="M16 4C9.37 4 4 9.37 4 16C4 22.63 9.37 28 16 28C17.38 28 18.5 26.88 18.5 25.5C18.5 24.86 18.25 24.28 17.85 23.85C17.44 23.41 17.18 22.84 17.18 22.2C17.18 20.82 18.3 19.7 19.68 19.7H22C25.31 19.7 28 17.01 28 13.7C28 8.34 22.63 4 16 4Z"
        fill="url(#paletteShine)"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="anim-colour-drop"
      />

      {/* Palette Grip Hole */}
      <circle
        cx="19.5"
        cy="24"
        r="1.8"
        fill="rgba(0, 0, 0, 0.15)"
        stroke={color}
        strokeWidth="1.2"
      />

      {/* Pulsing Colorful Paint Wells */}
      {/* 1: Cyan / Blue */}
      <circle
        cx="9.5"
        cy="12.5"
        r="2.2"
        fill="#38bdf8"
        stroke="#ffffff"
        strokeWidth="0.8"
        className="anim-colour-dot-1"
      />

      {/* 2: Yellow / Gold */}
      <circle
        cx="14"
        cy="8.5"
        r="2.2"
        fill="#fde047"
        stroke="#ffffff"
        strokeWidth="0.8"
        className="anim-colour-dot-2"
      />

      {/* 3: Magenta / Crimson */}
      <circle
        cx="20.5"
        cy="9"
        r="2.2"
        fill="#f43f5e"
        stroke="#ffffff"
        strokeWidth="0.8"
        className="anim-colour-dot-3"
      />

      {/* 4: Emerald Green */}
      <circle
        cx="10"
        cy="18.5"
        r="2.2"
        fill="#34d399"
        stroke="#ffffff"
        strokeWidth="0.8"
        className="anim-colour-dot-4"
      />

      {/* 5: Violet / Purple */}
      <circle
        cx="24"
        cy="14"
        r="2.2"
        fill="#c084fc"
        stroke="#ffffff"
        strokeWidth="0.8"
        className="anim-colour-dot-5"
      />
    </svg>
  )
}

/**
 * Animated Copies SVG Icon for "Copies"
 * Features multiple stacked sheets duplicating and sliding forward.
 */
export const AnimatedCopiesIcon: React.FC<IconProps> = ({
  size = 24,
  className = '',
  color = 'currentColor',
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`anim-copies-icon ${className}`}
      aria-label="Copies animation icon"
    >
      {/* Third background sheet */}
      <rect
        x="11"
        y="4"
        width="15"
        height="18"
        rx="3"
        fill="rgba(255, 255, 255, 0.2)"
        stroke={color}
        strokeWidth="1.4"
        strokeOpacity="0.5"
        className="anim-copy-sheet-1"
      />

      {/* Second middle sheet */}
      <rect
        x="8"
        y="7"
        width="15"
        height="18"
        rx="3"
        fill="rgba(255, 255, 255, 0.3)"
        stroke={color}
        strokeWidth="1.6"
        strokeOpacity="0.8"
      />

      {/* Primary front sheet */}
      <g className="anim-copy-sheet-2">
        <rect
          x="5"
          y="10"
          width="15"
          height="18"
          rx="3"
          fill="rgba(255, 255, 255, 0.45)"
          stroke={color}
          strokeWidth="1.8"
        />

        {/* Text lines on front sheet */}
        <line
          x1="8.5"
          y1="14.5"
          x2="15.5"
          y2="14.5"
          stroke={color}
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <line
          x1="8.5"
          y1="18"
          x2="16.5"
          y2="18"
          stroke={color}
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <line
          x1="8.5"
          y1="21.5"
          x2="13.5"
          y2="21.5"
          stroke={color}
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </g>

      {/* "x2" Duplicate Copy Badge */}
      <g className="anim-copy-badge">
        <circle cx="23.5" cy="22.5" r="5.5" fill="#ffffff" />
        <path
          d="M21 21L23 23M23 21L21 23M24.5 24V21H26"
          stroke="#dc2626"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  )
}

/**
 * Animated Sides / Duplex SVG Icon for "Sides"
 * Features a dual-sided page with 3D cyclic flip arrows.
 */
export const AnimatedSidesIcon: React.FC<IconProps> = ({
  size = 24,
  className = '',
  color = 'currentColor',
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`anim-sides-icon ${className}`}
      aria-label="Sides duplex animation icon"
    >
      {/* Central Double-sided Paper */}
      <g className="anim-duplex-card">
        <rect
          x="8.5"
          y="6.5"
          width="15"
          height="19"
          rx="3"
          fill="rgba(255, 255, 255, 0.38)"
          stroke={color}
          strokeWidth="1.8"
        />
        {/* Page divider line indicating 2 sides */}
        <line
          x1="12"
          y1="11"
          x2="20"
          y2="11"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <line
          x1="12"
          y1="15"
          x2="18"
          y2="15"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <line
          x1="12"
          y1="19"
          x2="15"
          y2="19"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </g>

      {/* Cyclic Duplex Flip Arrow Top */}
      <g className="anim-duplex-arrow-1">
        <path
          d="M6 9C6.5 5.5 10 3.5 14 3.5C18.5 3.5 22 5 23.5 7.5"
          stroke={color}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeDasharray="2 1"
        />
        <path
          d="M21 7.5H24V4.5"
          stroke={color}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      {/* Cyclic Duplex Flip Arrow Bottom */}
      <g className="anim-duplex-arrow-2">
        <path
          d="M26 23C25.5 26.5 22 28.5 18 28.5C13.5 28.5 10 27 8.5 24.5"
          stroke={color}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeDasharray="2 1"
        />
        <path
          d="M11 24.5H8V27.5"
          stroke={color}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  )
}
