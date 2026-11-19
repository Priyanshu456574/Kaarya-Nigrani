import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, fmtDate, fmtDateTime } from '../api'
import { publicStatus, useLang } from '../i18n'
import CitTop from './CitTop'

export default function Track() {
  const { ticket } = useParams()
  const [params] = useSearchParams()
  const key = params.get('k') || ''
  const nav = useNavigate()
  const { lang, t, role, toggle } = useLang()
  const [q, setQ] = useState(ticket || '')
  const [code, setCode] = useState(key)
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = () => api.get(`/public/track/${ticket}?key=${encodeURIComponent(key)}`).then(setData).catch(() => setErr(t.notfound))
  useEffect(() => {
    if (!ticket) return
    setErr(''); setData(null)
    if (!key) return
    load()
  }, [ticket, key])  // eslint-disable-line react-hooks/exhaustive-deps

  async function appeal(e) {
    e.preventDefault()
    setBusy(true); setMsg('')
    try { await api.post(`/public/track/${ticket}/appeal`, { key, reason }); setMsg(t.appealed); setReason(''); await load() }
    catch (ex) { setMsg(ex.message) } finally { setBusy(false) }
  }

  const i = data?.issue
  const st = i && publicStatus(i, t)
  return (
    <div className="cit" lang={lang}>
      <CitTop t={t} toggle={toggle} />
      <section className="cit-sec">
        <h1 style={{ fontSize: 26, marginBottom: 10 }}>{t.trackTitle}</h1>
        <form className="trackform" onSubmit={e => { e.preventDefault(); if (q.trim() && code.trim()) nav(`/track/${q.trim().toUpperCase()}?k=${encodeURIComponent(code.trim())}`) }}>
          <label><span className="small">{t.ticket}</span><input value={q} onChange={e => setQ(e.target.value)} placeholder="KGR-2026-0001" autoComplete="off" /></label>
          <label><span className="small">{t.trackCode}</span><input value={code} onChange={e => setCode(e.target.value)} placeholder={t.codePh} autoComplete="off" /></label>
          <button className="btn">{t.go}</button>
        </form>
        {err && <p className="error" style={{ marginTop: 10 }}>{err}</p>}
      </section>
      {i && (
        <section className="cit-sec">
          <div className={`issue ${st.cls === 'claim' ? 'is-claim' : st.cls === 'defect' ? 'is-defect' : ''}`}>
            <div className="issue-h">
              <div className="top"><span className="ticket">{i.ticket}</span><span className={`tag ${st.cls}`}>{st.text}</span></div>
              <Link to={`/w/${data.work.qr_token}`}>{data.work.name}</Link>
              <h3>{i.title}</h3>
              <span className="small muted">{fmtDate(i.created_at)}</span>
              {i.owner_role && <p className="owner">{t.nextBy}: <b>{role[i.owner_role] || i.owner_role}</b>{i.due_date && <>, {fmtDate(i.due_date)}</>}</p>}
            </div>
            {i.finding && <p className={`finding ${['NOT_SUBSTANTIATED', 'CLOSED'].includes(i.status) ? 'ok' : ''}`}><b>{t.finding}:</b> {i.finding}</p>}
            {i.status === 'CLOSED' && i.events.some(e => e.action === 'rectified') && <p className="small" style={{ padding: '0 14px' }}>{t.independent}</p>}
            <h3 style={{ padding: '8px 14px 0' }}>{t.history}</h3>
            <ol className="timeline">
              {i.events.map((e, k) => (
                <li key={k}><b>{t.step[e.to_status]}</b>
                  <div className="when">{fmtDateTime(e.at)}, {role[e.actor] || e.actor}</div>
                  {e.note && e.action !== 'create' && <div className="small">{e.note}</div>}
                </li>
              ))}
            </ol>
          </div>
          {(i.appealable || msg) && (
            <form className="form appeal" onSubmit={appeal}>
              <h3>{t.appealTitle}</h3>
              <p className="small muted">{t.appealSub}</p>
              {i.appealable && <>
                <label className="visually-hidden" htmlFor="ap">{t.appealPh}</label>
                <textarea id="ap" value={reason} onChange={e => setReason(e.target.value)} placeholder={t.appealPh} maxLength={1000} />
                <button className="btn" disabled={busy || reason.trim().length < 10}>{t.appealBtn}</button>
              </>}
              {msg && <p className="small" role="status">{msg}</p>}
            </form>
          )}
          {data.sms?.length > 0 && (
            <div className="smslist">
              <h3>{t.smsUpdates}</h3>
              {data.sms.map((s, k) => <div key={k} className="smsbox"><small>{s.to}, {fmtDateTime(s.at)}</small><p>{lang === 'hi' ? s.text_hi : s.text}</p></div>)}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
