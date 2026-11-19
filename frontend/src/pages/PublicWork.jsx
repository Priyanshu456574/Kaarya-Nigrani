import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, fmtDate } from '../api'
import { publicStatus, useLang } from '../i18n'
import { useApp } from '../App'
import { Icon } from '../components/Icons'
import CitTop from './CitTop'
import { useT } from '../strings'

const CATS = ['usability', 'quality', 'safety', 'delay']

export default function PublicWork() {
  const { qr } = useParams()
  const [params, setParams] = useSearchParams()
  const { lang, t, toggle } = useLang()
  const { term } = useT()
  const [w, setW] = useState(null)
  const [err, setErr] = useState('')
  const [voted, setVoted] = useState(false)
  const load = useCallback(() => api.get(`/public/works/${qr}`).then(setW).catch(e => setErr(e.message)), [qr])
  useEffect(() => { load() }, [load])
  const reporting = params.get('report') === '1'

  if (err) return <div className="cit"><p className="cit-sec error">{err}</p></div>
  if (!w) return <div className="cit"><p className="cit-sec muted">…</p></div>
  const open = w.reports.filter(r => !['CLOSED', 'NOT_SUBSTANTIATED'].includes(r.status))
  const dueTxt = fmtDate(w.due_date) + (w.revised_end ? ` (${t.extendedNote})` : '')
  const line = w.status === 'IN_PROGRESS' ? t.statusLine.IN_PROGRESS(Math.round(w.progress), dueTxt)
    : w.status === 'SANCTIONED' ? t.statusLine.SANCTIONED(dueTxt) : t.statusLine[w.status]()

  async function vote(usable) {
    await api.post(`/public/works/${qr}/usable`, { usable })
    setVoted(true)
    if (!usable) setParams({ report: '1' })
  }

  return (
    <div className="cit" lang={lang}>
      <CitTop t={t} toggle={toggle} />
      <section className="cit-board">
        <p className="small" style={{ opacity: .8 }}>{w.village}, {w.block}</p>
        <h1>{w.name}</h1>
        <p className="statusline">{line}</p>
        {w.status === 'IN_PROGRESS' && w.check_measured != null && <p className="small muted">{t.checkedM(Math.round(w.check_measured))}</p>}
      </section>

      {reporting ? (
        <ReportWizard w={w} qr={qr} open={open} t={t} lang={lang} onClose={() => { setParams({}); load() }} />
      ) : (
        <>
          <section className="cit-sec">
            {w.status === 'USABLE_VERIFIED' && !voted && (
              <div className="voteq">
                <b>{t.usableQ}</b>
                <div className="vote-btns">
                  <button className="btn bigbtn secondary" onClick={() => vote(true)}>{t.yes}</button>
                  <button className="btn bigbtn danger" onClick={() => vote(false)}>{t.noProblem}</button>
                </div>
              </div>
            )}
            {voted && <p className="thanks" role="status">{t.thanksVote}</p>}
            <button className="btn bigbtn" onClick={() => setParams({ report: '1' })}><span className="ic-inline">{Icon.report(22)}</span>{t.report}</button>
          </section>

          <section className="cit-sec">
            <h2>{t.stages}</h2>
            <ul className="cit-stages">
              {w.stages.map(s => (
                <li key={s.name}><span>{term('stage', s.name)}</span><span className="bar"><span style={{ width: `${s.progress}%` }} /></span><span className="num">{Math.round(s.progress)}%</span></li>
              ))}
            </ul>
            <p className="small muted">{t.cost}: ₹{w.sanctioned_lakh} {lang === 'hi' ? 'लाख' : 'lakh'}. {t.dept}: {w.department}</p>
          </section>

          <section className="cit-sec">
            <h2>{t.reports}</h2>
            <p className="small muted">{t.legend}</p>
            {w.reports.length === 0 && <p className="muted">{t.noReports}</p>}
            {w.reports.map(r => {
              const st = publicStatus(r, t)
              return (
                <div key={r.ticket} className={`issue ${st.cls === 'claim' ? 'is-claim' : st.cls === 'defect' ? 'is-defect' : ''}`}>
                  <div className="issue-h">
                    <div className="top"><span className="ticket">{r.ticket}</span><span className={`tag ${st.cls}`}>{st.text}</span></div>
                    <span>{r.title}</span>
                    {r.supporters > 0 && <span className="supporters">{t.othersToo(r.supporters)}</span>}
                  </div>
                </div>
              )
            })}
          </section>
        </>
      )}
    </div>
  )
}

function ReportWizard({ w, qr, open, t, lang, onClose }) {
  const { setLastTicket } = useApp()
  const hasSimilar = open.length > 0
  const total = hasSimilar ? 3 : 2
  const [step, setStep] = useState(1)
  const [cat, setCat] = useState('')
  const [desc, setDesc] = useState('')
  const [voice, setVoice] = useState(null)
  const [file, setFile] = useState(null)
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(null)

  async function send(e) {
    e?.preventDefault()
    if (desc.trim().length < 5 && !voice) return setErr(t.needOne)
    setBusy(true); setErr('')
    try {
      const r = await api.form(`/public/works/${qr}/reports`, { category: cat, description: desc, phone, file, voice, lat: w.lat, lng: w.lng })
      setLastTicket({ ticket: r.ticket, key: r.track_key }); setDone({ ...r, joined: false })
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  async function join(ticket) {
    setBusy(true); setErr('')
    try {
      const r = await api.post(`/public/issues/${ticket}/support`, { phone })
      setDone({ ...r, joined: true })
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  if (done) return (
    <section className="cit-sec">
      <div className="receipt" role="status">
        <b>{done.joined ? t.joined : t.received}</b>
        <span className="num">{done.ticket}</span>
        {done.track_key && <span className="trackcode">{t.trackCode}: <b>{done.track_key}</b></span>}
        <span className="small muted">{done.joined ? t.joinedNote : t.keep}</span>
      </div>
      {done.sms?.length > 0 && (
        <div className="smsbox">
          <small>{t.smsSent}, {done.sms[0].to}</small>
          <p>{lang === 'hi' ? done.sms[done.sms.length - 1].text_hi : done.sms[done.sms.length - 1].text}</p>
        </div>
      )}
      <h2>{t.whatNext}</h2>
      <ol className="nextsteps">{t.nextSteps.map((s, i) => <li key={i}>{s}</li>)}</ol>
      {done.track_key && <Link to={`/track/${done.ticket}?k=${encodeURIComponent(done.track_key)}`} className="btn bigbtn">{t.track}</Link>}
      <button className="btn secondary" onClick={onClose}>{t.backBtn}</button>
    </section>
  )

  return (
    <section className="cit-sec wizard">
      <div className="wiz-top">
        <span className="small muted">{t.stepN(step === 3 || (!hasSimilar && step === 2) ? total : step, total)}</span>
        <span className="dots" aria-hidden="true">{Array.from({ length: total }, (_, i) => <i key={i} className={i < (step === 3 && !hasSimilar ? 2 : step) ? 'on' : ''} />)}</span>
      </div>

      {step === 1 && <>
        <h2 className="cit-q">{t.s1}</h2>
        <div className="cattiles" role="radiogroup" aria-label={t.s1}>
          {CATS.map(c => (
            <button key={c} role="radio" aria-checked={cat === c} className={`cattile ${cat === c ? 'on' : ''}`} onClick={() => { setCat(c); setStep(hasSimilar ? 2 : 3) }}>
              <span className="ic">{Icon[c]()}</span><span>{t.cat[c]}</span>
            </button>
          ))}
        </div>
        <button className="btn secondary" onClick={onClose}>{t.cancel}</button>
      </>}

      {step === 2 && hasSimilar && <>
        <h2 className="cit-q">{t.s2}</h2>
        <p className="muted">{t.s2Sub}</p>
        <ul className="similar">
          {open.map(r => (
            <li key={r.ticket}>
              <p>{r.title}</p>
              {r.supporters > 0 && <span className="supporters">{t.othersToo(r.supporters)}</span>}
              <button className="btn secondary" disabled={busy} onClick={() => join(r.ticket)}>{t.sameYes}</button>
            </li>
          ))}
        </ul>
        <div className="field"><label htmlFor="ph2">{t.smsQ}</label><input id="ph2" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} /><small className="muted">{t.smsWhy}</small></div>
        {err && <p className="error" role="alert">{err}</p>}
        <button className="btn bigbtn" onClick={() => setStep(3)}>{t.sameNo}</button>
        <button className="btn secondary" onClick={() => setStep(1)}>{t.backBtn}</button>
      </>}

      {step === 3 && <form className="form" onSubmit={send}>
        <h2 className="cit-q">{t.s3}</h2>
        <label className={`voicebtn ${voice ? 'on' : ''}`}>
          <span className="ic">{Icon.mic()}</span>
          <span><b>{voice ? t.recorded : t.speak}</b><small>{t.speakSub}</small></span>
          <input type="file" accept="audio/*" capture="user" onChange={e => setVoice(e.target.files[0] || null)} className="visually-hidden" />
        </label>
        <div className="field"><label htmlFor="pd">{t.orType}</label><textarea id="pd" value={desc} onChange={e => setDesc(e.target.value)} placeholder={t.descPh} /></div>
        <div className="field"><label htmlFor="pp">{t.addPhoto}</label><input id="pp" type="file" accept="image/*" capture="environment" onChange={e => setFile(e.target.files[0])} /></div>
        <div className="field"><label htmlFor="ph">{t.smsQ}</label><input id="ph" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} /><small className="muted">{t.smsWhy}</small></div>
        {err && <p className="error" role="alert">{err}</p>}
        <button className="btn bigbtn" disabled={busy}>{busy ? t.sending : t.send}</button>
        <button type="button" className="btn secondary" onClick={() => setStep(hasSimilar ? 2 : 1)}>{t.backBtn}</button>
      </form>}
    </section>
  )
}
