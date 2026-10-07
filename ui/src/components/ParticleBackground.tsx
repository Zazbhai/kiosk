import './ParticleBackground.css'

export default function ParticleBackground() {
  return (
    <div className="kiosk-ambient-bg" aria-hidden="true">
      {/* High-performance GPU-composited ambient gradients — 0% CPU on Raspberry Pi */}
      <div className="kiosk-ambient-orb orb-primary" />
      <div className="kiosk-ambient-orb orb-secondary" />
      <div className="kiosk-ambient-grid" />
    </div>
  )
}
