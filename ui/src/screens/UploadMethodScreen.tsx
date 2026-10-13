import { useNavigate } from 'react-router-dom'
import { QrCode, Usb } from '@phosphor-icons/react'
import './KioskScreens.css'

export default function UploadMethodScreen() {
  const navigate = useNavigate()
  const kioskId = localStorage.getItem('pb_kiosk_id') || 'PB-001'
  const kioskName = localStorage.getItem('pb_kiosk_name') || 'Station 1'

  return (
    <div className="kiosk-screen">
      <div className="kiosk-bg-mesh" />
      <div className="kiosk-statusbar">
        <div className="statusbar__left">
          <button
            type="button"
            className="kiosk-nav-btn kiosk-nav-btn--back"
            onClick={() => navigate('/')}
            id="upload-nav-back"
          >
            <span>←</span>
            <span>Back</span>
          </button>
        </div>
        <div className="statusbar__center">
          <div className="statusbar__pill">
            <div className="statusbar__dot" />
            <span className="statusbar__kiosk">{kioskId}</span>
            <span>•</span>
            <span>{kioskName}</span>
          </div>
        </div>
        <div className="statusbar__right">
          <button
            type="button"
            className="kiosk-nav-btn kiosk-nav-btn--cancel"
            onClick={() => navigate('/')}
            id="upload-nav-cancel"
          >
            <span>✕</span>
            <span>Cancel</span>
          </button>
        </div>
      </div>

      <div className="kiosk-upload-methods kiosk-enter" style={{ margin: 'auto auto', gap: 28, marginTop: 'auto', marginBottom: 'auto' }}>
        <div>
          <h1 className="kiosk-title" style={{ fontSize: '2.2rem' }}>Upload Document</h1>
          <p className="kiosk-subtitle" style={{ marginTop: 8 }}>Choose your preferred upload method</p>
        </div>

        <div className="upload-method-options" style={{ gap: 24 }}>
          <button
            className="upload-method-card"
            onClick={() => navigate('/upload/qr')}
            id="kiosk-upload-qr"
          >
            <div className="upload-method-card__icon">
              <QrCode size={56} weight="duotone" />
            </div>
            <div className="upload-method-card__title">Scan QR Code</div>
            <div className="upload-method-card__sub">Upload from your phone</div>
          </button>

          <button
            className="upload-method-card"
            onClick={() => navigate('/upload/usb')}
            id="kiosk-upload-usb"
          >
            <div className="upload-method-card__icon">
              <Usb size={56} weight="duotone" />
            </div>
            <div className="upload-method-card__title">USB Drive</div>
            <div className="upload-method-card__sub">Insert USB to browse files</div>
          </button>
        </div>
      </div>
    </div>
  )
}
