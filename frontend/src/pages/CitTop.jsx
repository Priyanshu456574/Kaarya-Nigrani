import { Link } from 'react-router-dom'

export default function CitTop({ t, toggle }) {
  return (
    <header className="cit-top">
      <Link to="/public" className="brand">{t.site}<small>{t.sub}</small></Link>
      <button className="langbtn" onClick={toggle}>{t.lang}</button>
    </header>
  )
}
