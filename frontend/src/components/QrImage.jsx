import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { useNavigate } from 'react-router-dom'
import { DEMO } from '../api'

/** Site-board QR. In the live app it comes from the server; in the demo it is drawn here and opens the resident page on click. */
export default function QrImage({ work }) {
  const nav = useNavigate()
  const [src, setSrc] = useState(null)
  const target = `${window.location.origin}/w/${work.qr_token}`
  useEffect(() => {
    if (DEMO) QRCode.toDataURL(target, { margin: 0, width: 200 }).then(setSrc)
  }, [target])
  if (!DEMO) return <img src={`/api/works/${work.id}/qr.png?base=${encodeURIComponent(window.location.origin)}`} alt={`QR code linking to the public page for ${work.code}`} />
  return (
    <button className="qr-btn" onClick={() => nav(`/w/${work.qr_token}`)} title="Open the resident page this QR code leads to">
      {src && <img src={src} alt={`QR code for ${work.code}. Click to open the resident page.`} />}
    </button>
  )
}
