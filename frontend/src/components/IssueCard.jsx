import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, DEMO } from '../api'
import { useApp } from '../App'
import { useT } from '../strings'
import { IssueTag, issueKind } from './Tags'

const NEEDS_EVIDENCE = new Set(['verify', 'reject', 'rectified', 'close', 'reopen'])
const NEEDS_NOTE = new Set(['verify', 'reject', 'reopen', 'direct'])
// what the uploaded file is filed as; the server only accepts matching purposes for each step
const PURPOSE = { verify: 'inspection', reject: 'inspection', rectified: 'rectification', close: 'reinspection', reopen: 'reinspection' }

export default function IssueCard({ issue, work, onChanged, showWork }) {
  const { meta, user, setToast } = useApp()
  const { L, lang, date, dateTime, role, action, actionDone, note: noteLabel, evHint, issueStatus } = useT()
  const [open, setOpen] = useState(null)
  const [note, setNote] = useState('')
  const [file, setFile] = useState(null)
  const [caption, setCaption] = useState('')
  const [owner, setOwner] = useState('')
  const [due, setDue] = useState('')
  const [geo, setGeo] = useState('site')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const k = issueKind(issue.status)
  const roleLabel = (r) => role[r] || r

  function start(a) {
    setOpen(a); setErr(''); setNote(''); setFile(null); setCaption('')
    setOwner(''); setDue(a === 'assign' ? new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10) : a === 'direct' ? new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10) : '')
  }

  async function location() {
    if (geo === 'site' || !navigator.geolocation) return { lat: work?.lat, lng: work?.lng }
    return new Promise(res => navigator.geolocation.getCurrentPosition(
      p => res({ lat: p.coords.latitude, lng: p.coords.longitude }), () => res({}), { timeout: 6000 }))
  }

  async function submit(e) {
    e.preventDefault()
    setErr('')
    if (NEEDS_NOTE.has(open) && !note.trim()) return setErr(L.errNote)
    if (NEEDS_EVIDENCE.has(open) && !file) return setErr(L.errPhoto)
    if (open === 'assign' && (!owner || !due)) return setErr(L.errAssign)
    if (open === 'direct' && !due) return setErr(L.errAssign)
    setBusy(true)
    try {
      let evidence_id
      if (NEEDS_EVIDENCE.has(open)) {
        const { lat, lng } = await location()
        const isDoc = file?.type === 'application/pdf'
        const purpose = open === 'rectified' && ['CO', 'BDO'].includes(user.role) ? 'document' : PURPOSE[open]
        const ev = await api.form(`/works/${issue.work_id}/evidence`, {
          kind: isDoc ? 'document' : 'photo', purpose, caption: caption || `${evHint[open]}: ${issue.ticket}`, stage_id: issue.stage_id, lat, lng, file,
        })
        evidence_id = ev.id
      }
      // expected_status: if someone else acted since this screen loaded, the server refuses instead of double-stepping
      await api.post(`/issues/${issue.id}/actions`, { action: open, note, evidence_id, expected_status: issue.status, owner_id: owner ? Number(owner) : undefined, due_date: due || undefined })
      setToast(`${actionDone[open]}: ${issue.ticket}`)
      setOpen(null)
      onChanged?.()
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  const waitingOn = issue.escalated_to || issue.owner
  return (
    <article id={`issue-${issue.id}`} className={`issue ${k === 'claim' ? 'is-claim' : k === 'defect' ? 'is-defect' : ''}`}>
      <div className="issue-h">
        <div className="top">
          <span className="ticket">{issue.ticket} <span className="small">{L.src[issue.source]}{issue.reason_code ? `, ${L.holdup}: ${lang === 'hi' ? issue.reason_label_hi : issue.reason_label}` : ''}</span></span>
          <IssueTag issue={issue} />
        </div>
        {showWork && <Link to={`/works/${issue.work.id}`} className="small">{issue.work.code}: {issue.work.name}</Link>}
        <h3>{issue.title}</h3>
        {issue.description && issue.description !== issue.title && !issue.description.startsWith(issue.title + '.') && <p className="small muted">{issue.description}</p>}
        {issue.supporters > 0 && <p className="supporters">{L.sameProblem(issue.supporters)}</p>}
        {issue.voice && <div className="voice"><span className="small muted">{L.voiceNote}</span><audio controls src={issue.voice} preload="none" /></div>}
        {issue.complainant_name && <p className="small muted">{L.fromLine(issue.complainant_name, issue.complainant_phone)}</p>}
        {issue.owner && (
          <p className="owner">{L.nextLine}: <b>{roleLabel(issue.owner.role)}, {issue.owner.name.replace('Er. ', '')}</b>
            {issue.due_date && <> {L.by} <span className={issue.overdue ? 'overdue' : ''}>{date(issue.due_date)}{issue.overdue ? ` (${L.overdueTag})` : ''}</span></>}
          </p>
        )}
        {issue.escalated_to && <p className="escalated">{L.escalatedTo(roleLabel(issue.escalated_to.role), issue.escalated_to.name, issue.overdue_days)}</p>}
      </div>
      {issue.finding && <p className={`finding ${['NOT_SUBSTANTIATED', 'CLOSED'].includes(issue.status) ? 'ok' : ''}`}><b>{L.findingLabel}:</b> {issue.finding}</p>}
      <ol className="timeline" aria-label="History">
        {issue.events.map((e, i) => (
          <li key={i}>
            <b>{issueStatus[e.to_status]}</b> <span className="when">{dateTime(e.at)}, {e.actor}</span>
            {e.note && e.action !== 'create' && <div className="small">{e.note}</div>}
          </li>
        ))}
      </ol>
      {issue.actions?.length > 0 && (
        <div className="actions">
          {!open && (
            <>
              <span className="actions-label">{L.yourStep(roleLabel(user.role))}</span>
              <div className="btnrow">
                {issue.actions.map(a => (
                  <button key={a} className={`btn ${a === 'reject' || a === 'reopen' ? 'danger' : a === issue.actions[0] ? '' : 'secondary'}`} onClick={() => start(a)}>{action[a]}</button>
                ))}
              </div>
            </>
          )}
          {open && (
            <form onSubmit={submit} className="form">
              <h3>{action[open]}</h3>
              {open === 'direct' && (
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor={`d${issue.id}`}>{L.dueDate}</label>
                    <input id={`d${issue.id}`} type="date" value={due} onChange={e => setDue(e.target.value)} />
                  </div>
                </div>
              )}
              {open === 'assign' && (
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor={`o${issue.id}`}>{L.whoActs}</label>
                    <select id={`o${issue.id}`} value={owner} onChange={e => setOwner(e.target.value)}>
                      <option value="">{L.choose}</option>
                      {meta.officers.filter(o => !['DM', 'DDC'].includes(o.role)).map(o => <option key={o.id} value={o.id}>{roleLabel(o.role)}: {o.name} ({o.department})</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`d${issue.id}`}>{L.dueDate}</label>
                    <input id={`d${issue.id}`} type="date" value={due} onChange={e => setDue(e.target.value)} />
                  </div>
                </div>
              )}
              {NEEDS_EVIDENCE.has(open) && (
                <>
                  <div className="form-grid">
                    <p className="field small muted" style={{ alignSelf: 'end' }}>{evHint[open]}</p>
                    <div className="field">
                      <label htmlFor={`g${issue.id}`}>{L.evAt}</label>
                      <select id={`g${issue.id}`} value={geo} onChange={e => setGeo(e.target.value)}>
                        <option value="site">{L.atSite}</option>
                        {!DEMO && <option value="device">{L.device}</option>}
                      </select>
                    </div>
                  </div>
                  <div className="form-grid">
                    <div className="field">
                      <label htmlFor={`f${issue.id}`}>{L.file}</label>
                      <input id={`f${issue.id}`} type="file" accept="image/*,application/pdf" capture="environment" onChange={e => setFile(e.target.files[0])} />
                    </div>
                    <div className="field">
                      <label htmlFor={`c${issue.id}`}>{L.caption}</label>
                      <input id={`c${issue.id}`} value={caption} onChange={e => setCaption(e.target.value)} placeholder={L.captionPh} />
                    </div>
                  </div>
                </>
              )}
              <div className="field">
                <label htmlFor={`n${issue.id}`}>{noteLabel[open] || L.noteOpt}</label>
                <textarea id={`n${issue.id}`} value={note} onChange={e => setNote(e.target.value)} />
              </div>
              {err && <p className="error" role="alert">{err}</p>}
              <div className="btnrow">
                <button className="btn" disabled={busy}>{busy ? L.saving : action[open]}</button>
                <button type="button" className="btn secondary" onClick={() => setOpen(null)}>{L.cancel}</button>
              </div>
            </form>
          )}
        </div>
      )}
      {!issue.actions?.length && user && !['CLOSED', 'NOT_SUBSTANTIATED'].includes(issue.status) && (
        <div className="actions idle">{L.waitingOn(waitingOn ? `${roleLabel(waitingOn.role)} ${waitingOn.name.replace('Er. ', '')}` : L.responsible)}</div>
      )}
    </article>
  )
}
