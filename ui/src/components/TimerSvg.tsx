import type { SVGProps, CSSProperties } from 'react'

interface TimerSvgProps extends SVGProps<SVGSVGElement> {
  size?: number | string
  className?: string
  style?: CSSProperties
}

/**
 * TimerSvg — High-fidelity Stopwatch & Hand Timer Icon for Kiosk UI
 */
export default function TimerSvg({ size = 24, className = '', style, ...props }: TimerSvgProps) {
  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={`ks-timer-svg ${className}`.trim()}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }}
      aria-label="Timer"
      role="img"
      {...props}
    >
      <image href="/timer.png" width="512" height="512" preserveAspectRatio="xMidYMid meet" />
    </svg>
  )
}
