import { Link } from 'react-router-dom'
import { useLang } from '../i18n'
import { Icon } from '../components/Icons'
import CitTop from './CitTop'

/** Three big, plainly worded choices. Nothing else competes for attention. */
export default function PublicHome() {
  const { lang, t, toggle } = useLang()
  return (
    <div className="cit" lang={lang}>
      <CitTop t={t} toggle={toggle} />
      <section className="cit-sec">
        <h1 className="cit-q">{t.homeQ}</h1>
        <p className="muted">{t.homeSub}</p>
        <nav className="bigchoices">
          <Link to="/public/find?then=report" className="bigchoice primary">
            <span className="ic">{Icon.report()}</span><span><b>{t.optReport}</b><small>{t.optReportSub}</small></span>
          </Link>
          <Link to="/track" className="bigchoice">
            <span className="ic">{Icon.track()}</span><span><b>{t.optTrack}</b><small>{t.optTrackSub}</small></span>
          </Link>
          <Link to="/public/find" className="bigchoice">
            <span className="ic">{Icon.works()}</span><span><b>{t.optBrowse}</b><small>{t.optBrowseSub}</small></span>
          </Link>
        </nav>
      </section>
      <section className="cit-sec">
        <div className="nophone">
          <h2>{t.noPhone}</h2>
          <ul>
            <li><span className="ic">{Icon.phone()}</span><span>{t.noPhoneMissed} <small className="muted">{t.pilotNo}</small></span></li>
            <li><span className="ic">{Icon.chat()}</span><span>{t.noPhoneWa} <small className="muted">{t.pilotNo}</small></span></li>
            <li><span className="ic">{Icon.people()}</span><span>{t.noPhonePanchayat}</span></li>
          </ul>
        </div>
      </section>
    </div>
  )
}
