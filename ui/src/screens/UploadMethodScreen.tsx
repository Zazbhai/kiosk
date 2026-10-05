import { useNavigate } from 'react-router-dom'
import { QrCode, Usb, ArrowLeft } from '@phosphor-icons/react'
import './KioskScreens.css'

export default function UploadMethodScreen() {
  const navigate = useNavigate()

  return (
    <div className="kiosk-screen">
      <div className="kiosk-bg-mesh" />
      <div className="kiosk-statusbar">
        <div className="statusbar__left">
          <div className="statusbar__dot" />
          <span className="statusbar__kiosk">PB-001</span>
          <span>MIT ADT University</span>
        </div>
      </div>

      <div className="kiosk-upload-methods kiosk-enter">
        <div>
          <h1 className="kiosk-title">Upload Document</h1>
          <p className="kiosk-subtitle" style={{ marginTop: 12 }}>How would you like to upload?</p>
        </div>

        <div className="upload-method-options">
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

      <div className="kiosk-back">
        <button className="kiosk-btn kiosk-btn-ghost" onClick={() => navigate('/')} id="upload-back">
          <ArrowLeft size={20} />
          Back
        </button>
      </div>
    </div>
  )
}
