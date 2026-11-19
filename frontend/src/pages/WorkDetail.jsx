import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useApp } from '../App'
import IssueCard from '../components/IssueCard'
import ProgressChart from '../components/ProgressChart'
import QrImage from '../components/QrImage'
import KhagariaMap, { MapLegend } from '../components/KhagariaMap'
import { WorkTag } from '../components/Tags'
import { useT } from '../strings'
import { Icon } from '../components/Icons'

const short = (n) => n?.replace('Er. ', '')
const num = (x) => String(+Number(x).toFixed(3))
const TABS = ['overview', 'issues', 'work', 'money']

export default function WorkDetail() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const { meta, user, setToast } = useApp()
  const { L, lang, date, dateTime, lakh, msg, role, term } = useT()
  const [w, setW] = useState(null)
  const [mine, setMine] = useState([])
  const [photo, setPhoto] = useState(null)
  const [panel, setPanel] = useState(null)
  const [covStage, setCovStage] = useState(null)
  const [allFlags, setAllFlags] = useState(false)
  const [allMine, setAllMine] = useState(false)
  const [denied, setDenied] = useState(null)
  const tabs = w?.access?.tabs || TABS
  const tab = tabs.includes(params.get('tab')) ? params.get('tab') : 'overview'
  const focus = params.get('focus')
  const load = useCallback(() => Promise.all([
    api.get(`/works/${id}`).then(x => { setW(x); setDenied(null) }).catch(e => { if (e.status === 403 || e.status === 404) setDenied(e.status); else setToast(e.message) }),
    api.get('/tasks').then(ts => setMine(ts.filter(t => String(t.work.id) === String(id)))).catch(() => setMine([])),
  ]), [id, setToast])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!photo) return
    const k = (e) => e.key === 'Escape' && setPhoto(null)
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [photo])
  useEffect(() => {  // bring the item a task points at into view, and mark it briefly
    if (!w || !focus) return
    const el = document.getElementById(focus)
    if (!el) return
    setTimeout(() => { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 2400) }, 250)
  }, [w, focus, tab])

  const linearStages = useMemo(() => (w?.stages || []).filter(s => s.linear && s.qty_executed > 0), [w])
  const shownStage = useMemo(() => {
    if (!linearStages.length) return null
    return linearStages.find(s => s.id === covStage) || linearStages.find(s => s.gaps.length) || linearStages[linearStages.length - 1]
  }, [linearStages, covStage])

  if (denied) return <NoAccess />
  if (!w) return <div className="page muted">{L.loading}</div>
  const note = w.access.level === 'contractor' ? L.viewNote.contractor : w.access.level === 'limited' ? L.viewNote.limited : user.role === 'JE' ? L.viewNote.je : null
  const openIssues = w.issues.filter(i => !['CLOSED', 'NOT_SUBSTANTIATED'].includes(i.status))
  const closedIssues = w.issues.filter(i => ['CLOSED', 'NOT_SUBSTANTIATED'].includes(i.status))
  const general = w.evidence.filter(e => !e.stage_id)
  const ok = (m) => { load(); setToast(m) }
  const go = (tb, f) => setParams(f ? { tab: tb, focus: f } : { tab: tb }, { replace: true })
  const coverage = shownStage ? {
    executed: shownStage.executed, gaps: shownStage.gaps,
    photos: w.evidence.filter(e => e.stage_id === shownStage.id && e.source === 'officer' && e.lat != null),
  } : null
  const paidTotal = w.bills.filter(b => b.status === 'PAID').reduce((a, b) => a + (b.paid_lakh || 0), 0)
  const flagsShown = allFlags ? w.flags : w.flags.slice(0, 3)
  const showUsability = ['REPORTED_COMPLETE', 'USABLE_VERIFIED'].includes(w.status)

  async function doPost(path, body, m) {
    try { await api.post(path, body); ok(m) } catch (e) { setToast(e.message) }
  }

  return (
    <main className="page">
      <nav className="crumbs" aria-label="Breadcrumb"><Link to="/">{user.role === 'DM' ? L.crumbsHome : L.navTasks}</Link><span aria-hidden="true">/</span><span>{w.code}</span></nav>

      <header className="siteboard">
        <div className="sb-main">
          <span className="code">{w.code}, {w.department}, {w.scheme}</span>
          <h1>{w.name}</h1>
          <div className="board-status">
            <WorkTag status={w.status} />
            <span className="small">{w.village}, {w.block} {L.block}. {L.dueOn(date(w.due_date))}{w.revised_end ? ` (${L.origDate(date(w.planned_end))})` : ''}</span>
          </div>
        </div>
        <div className="sb-qr">
          <div className="qr"><QrImage work={w} /></div>
          <small>{L.residentsScan}</small>
        </div>
        <dl className="sb-facts">
          <div><dt>{L.fSanctioned}</dt><dd>{lakh(w.sanctioned_lakh)}</dd></div>
          <div><dt>{L.fContractor}</dt><dd>{w.people.contractor?.name}</dd></div>
          <div><dt>{L.fJE}</dt><dd>{short(w.people.je?.name)}</dd></div>
          <div><dt>{L.fAEEE}</dt><dd>{short(w.people.ae?.name)} / {short(w.people.ee?.name)}</dd></div>
        </dl>
      </header>

      {mine.length > 0 && (
        <section className="mytasks" aria-label={L.yourTasksHere}>
          <h2>{L.yourTasksHere}</h2>
          <ul>
            {(allMine ? mine : mine.slice(0, 2)).map((t, k) => (
              <li key={k}>
                <span><b>{lang === 'hi' ? t.title_hi : t.title}</b><small>{lang === 'hi' ? t.detail_hi : t.detail}</small></span>
                <button className="btn" onClick={() => go(t.tab, t.focus)}>{L.doThis}</button>
              </li>
            ))}
          </ul>
          {mine.length > 2 && <button className="linkbtn" onClick={() => setAllMine(!allMine)}>{allMine ? L.fewerFlags : L.moreFlags(mine.length - 2)}</button>}
        </section>
      )}

      <div className="tabs" role="tablist" aria-label={w.name}>
        {tabs.map(k => (
          <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => go(k)}>
            {L.tabs[k]}{k === 'issues' && openIssues.length > 0 && <span className="tabcount">{openIssues.length}</span>}
            {k === 'work' && w.stages.some(s => s.hold || s.gaps.length || (s.progress > 0 && !s.evidence_count) || s.tests.some(x => x.passed === false || (x.result == null && s.progress >= 50)) || s.measurements.some(m => !m.checked_by)) && <span className="tabdot" aria-hidden="true" />}
          </button>
        ))}
      </div>

      {note && <p className="viewnote">{Icon.lock()}<span>{note}</span></p>}

      {tab === 'overview' && (
        <div className="tabpanel" role="tabpanel">
          <Layers w={w} />
          <div className="work-grid">
            <div className="stack">
              {w.flags.length > 0 && (
                <section className="panel attention" aria-labelledby="att-h">
                  <header className="panel-h"><h2 id="att-h">{L.attention}</h2><span className="small muted">{L.items(w.flags.length)}</span></header>
                  <ul className="flaglist">
                    {flagsShown.map((f, i) => (
                      <li key={i} className={`s${f.severity}`}>
                        <span className="sev">{L.sev[f.severity]}</span>
                        <span className="msg">{msg(f)}</span>
                        <span className="next">{L.next}: {role[f.next_action_by] || f.next_action_by}{f.next_person ? `, ${short(f.next_person)}` : ''}</span>
                      </li>
                    ))}
                  </ul>
                  {w.flags.length > 3 && <div className="showall tight"><button className="linkbtn" onClick={() => setAllFlags(!allFlags)}>{allFlags ? L.fewerFlags : L.moreFlags(w.flags.length - 3)}</button></div>}
                </section>
              )}
              <TimePanel w={w} onDone={() => ok(L.extSaved)} />
              {w.inspection && <InspectionPanel w={w} onDone={() => ok(L.inspSaved)} />}
              {(w.certified_on || w.postchecks.length > 0) && <AfterPanel w={w} onDone={() => ok(L.recheckSaved)} />}
            </div>
            <div className="stack">
              {showUsability && (
                <section className="panel" id="usability">
                  <header className="panel-h"><h2>{L.usableTitle}</h2></header>
                  <div className="panel-b">
                    <p className="small muted">{L.usableSub}</p>
                    <ul className="checklist">
                      {w.checklist.map(c => (
                        <li key={c.id}>
                          <span className={`box ${c.passed ? 'ok' : c.passed === false ? 'bad' : ''}`} aria-hidden="true" />
                          <span className="ci">{term('check', c.item)}<small>{c.passed ? L.passed(date(c.verified_on)) : c.passed === false ? L.failed : L.notChecked2}</small></span>
                          {['AE', 'EE'].includes(user.role) && w.status !== 'USABLE_VERIFIED' && !c.passed && <CheckItem w={w} item={c} onDone={() => ok(L.checklistUpdated)} />}
                        </li>
                      ))}
                    </ul>
                    {w.status === 'REPORTED_COMPLETE' && w.access.level === 'full' && <Readiness w={w} canCertify={user.role === 'EE'} onDone={ok} />}
                  </div>
                </section>
              )}
              {user.role === 'JE' && w.status === 'IN_PROGRESS' && w.actual > 0 && (
                <section className="panel"><div className="panel-b">
                  {w.certification.claim_blockers.length > 0 && <Blockers title={L.claimBlocked} items={w.certification.claim_blockers} />}
                  <button className="btn secondary full" disabled={w.certification.claim_blockers.length > 0} onClick={() => doPost(`/works/${w.id}/claim-complete`, {}, L.claimMsg)}>{L.claim}</button>
                </div></section>
              )}
              <section className="panel">
                <header className="panel-h"><h2>{L.mapTitle}</h2><span className="small muted">{L.mapSub(w.block, w.geofence_m)}</span></header>
                {linearStages.length > 0 && (
                  <div className="covchips" role="group" aria-label={L.coverageFor}>
                    <span className="small muted">{L.coverageFor}</span>
                    {linearStages.map(s => (
                      <button key={s.id} className={`chip sm ${shownStage?.id === s.id ? 'on' : ''}`} onClick={() => setCovStage(s.id)} aria-pressed={shownStage?.id === s.id}>
                        {term('stage', s.name)}{s.gaps.length > 0 && <span className="chipflag">!</span>}
                      </button>
                    ))}
                  </div>
                )}
                <KhagariaMap works={[w]} height={280} focus={[w.lat, w.lng]} selectedBlock={w.block} coverage={coverage} />
                <MapLegend coverage={!!coverage} />
              </section>
            </div>
          </div>
        </div>
      )}

      {tab === 'issues' && (
        <section className="panel tabpanel" role="tabpanel" id="issues">
          <header className="panel-h">
            <div><h2>{L.issuesTitle}</h2><p className="small muted">{L.issuesSub(openIssues.length, openIssues.filter(i => i.actions?.length).length)}</p></div>
            {user.role !== 'CONTRACTOR' && <button className="btn secondary" onClick={() => setPanel(panel === 'issue' ? null : 'issue')}>{L.raiseIssue}</button>}
          </header>
          <div className="panel-b">
            {panel === 'issue' && <RaiseIssue w={w} onDone={() => { setPanel(null); ok(L.raise.recorded) }} />}
            {openIssues.length === 0 && <p className="empty">{L.noOpen}</p>}
            <div className="issues">{openIssues.map(i => <IssueCard key={i.id} issue={i} work={w} onChanged={load} />)}</div>
            {closedIssues.length > 0 && (
              <details className="resolved">
                <summary>{L.resolved(closedIssues.length)}</summary>
                <div className="issues">{closedIssues.map(i => <IssueCard key={i.id} issue={i} work={w} onChanged={load} />)}</div>
              </details>
            )}
          </div>
        </section>
      )}

      {tab === 'work' && (
        <section className="panel tabpanel" role="tabpanel" id="stages">
          <header className="panel-h">
            <h2>{L.stagesTitle}</h2>
            {user.role === 'JE' && w.status !== 'USABLE_VERIFIED' && <button className="btn secondary" onClick={() => setPanel(panel === 'mb' ? null : 'mb')}>{L.recordMb}</button>}
          </header>
          <div className="panel-b">
            {panel === 'mb' && <MeasurementForm w={w} onDone={() => { setPanel(null); ok(L.mbSaved) }} />}
            <ol className="stages">
              {w.stages.map(s => <StageRow key={s.id} w={w} s={s} isEngineer={['JE', 'AE', 'EE'].includes(user.role)} onOpen={setPhoto} onChanged={ok} />)}
            </ol>
            {general.length > 0 && (<div className="other-ev"><h3>{L.photosLabel}</h3><div className="evstrip">{general.map(e => <Thumb key={e.id} e={e} onOpen={setPhoto} />)}</div></div>)}
          </div>
        </section>
      )}

      {tab === 'money' && (
        <div className="work-grid tabpanel" role="tabpanel">
          <div className="stack">
          {w.finance && <FinancePanel w={w} onDone={ok} />}
          <section className="panel">
            <header className="panel-h"><h2>{L.billsTitle}</h2>{w.bills.length > 0 && <span className="small muted">{L.totalPaid(lakh(paidTotal.toFixed(1)), Math.round(w.financial))}</span>}</header>
            <div className="panel-b">
              {w.bills.length === 0 ? <p className="empty">{L.noBills}</p> : (
                <div className="tablewrap"><table className="plain">
                  <thead><tr><th>{L.billNo}</th><th>{L.billDate}</th><th className="r">{L.billAmt}</th><th>{L.colStatus}</th></tr></thead>
                  <tbody>{[...w.bills].reverse().map(b => (
                    <tr key={b.id}>
                      <td>RA {b.bill_no}{b.unchecked && ['AUTHORIZED', 'PAID'].includes(b.status) && <><br /><span className="tag defect sm">{L.billUnchecked}</span></>}</td>
                      <td>{date(b.bill_date)}</td>
                      <td className="r num">{lakh(b.amount_lakh.toFixed(2))}</td>
                      <td><span className={`tag sm ${b.status === 'PAID' ? 'done' : 'claim'}`}>{L.billStatus[b.status]}</span>
                        {b.payment_ref && <small className="muted block">{b.payment_ref}</small>}
                        <BillAction w={w} b={b} onDone={ok} /></td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
            </div>
          </section>
          </div>
          <div className="stack">
          <section className="panel">
            <header className="panel-h"><h2>{L.chartTitle}</h2></header>
            <div className="panel-b"><ProgressChart curve={w.curve} reports={w.reports} start={w.start_date} end={w.due_date} today={meta.today} /></div>
          </section>
          <Revisions w={w} onDone={ok} />
          {w.audit && w.audit.length > 0 && <AuditPanel w={w} />}
          </div>
        </div>
      )}

      {photo && (
        <div className="lightbox" onClick={() => setPhoto(null)} role="dialog" aria-label={photo.caption}>
          <figure onClick={e => e.stopPropagation()}>
            {photo.url && <img src={photo.url} alt={photo.caption} />}
            <figcaption>
              <b>{photo.caption}</b>
              <span className="small muted">{photo.source === 'citizen' ? L.photoCitizen : L.photoOfficer}, {dateTime(photo.captured_at)}</span>
              {photo.lat && <span className="small muted">{L.geotag} {photo.lat.toFixed(4)}, {photo.lng.toFixed(4)}{photo.chainage_km != null ? `, km ${photo.chainage_km.toFixed(2)}` : ''}{photo.in_geofence === false ? L.outside : photo.in_geofence ? L.inside : ''}</span>}
              <button className="btn secondary" style={{ justifySelf: 'start', marginTop: 6 }} onClick={() => setPhoto(null)}>{L.close}</button>
            </figcaption>
          </figure>
        </div>
      )}
    </main>
  )
}

/** A photo plus "fine / found problems" and a note: used for re-checks and surprise inspections. */
function ResultForm({ w, caption, okLabel, badLabel, onSubmit, onCancel }) {
  const { L } = useT()
  const [good, setGood] = useState(true)
  const [note, setNote] = useState('')
  const [file, setFile] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault(); setErr('')
    if (!file) return setErr(L.photoSite)
    if (!good && !note.trim()) return setErr(L.describe)
    setBusy(true)
    try {
      const ev = await api.form(`/works/${w.id}/evidence`, { kind: 'photo', purpose: 'inspection', caption, lat: w.lat, lng: w.lng, file })
      await onSubmit(good, note, ev.id)
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  return (
    <form className="form" onSubmit={submit}>
      <div className="seg" role="radiogroup">
        <label className={good ? 'on' : ''}><input type="radio" checked={good} onChange={() => setGood(true)} />{okLabel}</label>
        <label className={!good ? 'on bad' : ''}><input type="radio" checked={!good} onChange={() => setGood(false)} />{badLabel}</label>
      </div>
      <div className="field"><label htmlFor={`rf-${caption}`}>{L.photoSite}</label><input id={`rf-${caption}`} type="file" accept="image/*" capture="environment" onChange={e => setFile(e.target.files[0])} /></div>
      <div className="field"><label htmlFor={`rn-${caption}`}>{L.describe}{good ? ` ${L.optional}` : ''}</label><textarea id={`rn-${caption}`} value={note} onChange={e => setNote(e.target.value)} /></div>
      {err && <p className="error" role="alert">{err}</p>}
      <div className="btnrow"><button className="btn" disabled={busy}>{busy ? L.saving : L.save}</button><button type="button" className="btn secondary" onClick={onCancel}>{L.cancel}</button></div>
    </form>
  )
}

function TimePanel({ w, onDone }) {
  const { user, meta } = useApp()
  const { L, lang, date, term } = useT()
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ new_end: '', reason_code: '', note: '' })
  const [err, setErr] = useState('')
  if (w.status === 'USABLE_VERIFIED' && !w.extensions.length) return null
  async function submit(e) {
    e.preventDefault(); setErr('')
    try { await api.post(`/works/${w.id}/extensions`, f); setOpen(false); onDone() } catch (ex) { setErr(ex.message) }
  }
  return (
    <section className="panel" id="time">
      <header className="panel-h"><h2>{L.timeTitle}</h2>{user.role === 'EE' && w.status !== 'USABLE_VERIFIED' && !open && <button className="btn secondary sm" onClick={() => setOpen(true)}>{L.grantExt}</button>}</header>
      <div className="panel-b">
        <p><b>{L.dueOn(date(w.due_date))}</b>{w.revised_end && <span className="muted small"> ({L.origDate(date(w.planned_end))})</span>}</p>
        {w.extensions.map(x => <p key={x.id} className="small muted">{L.extended(date(x.old_end), date(x.new_end), lang === 'hi' ? x.reason_label_hi : x.reason_label)} {x.note} ({x.approved_by_name}, {date(x.approved_on)})</p>)}
        {open && (
          <form className="form" onSubmit={submit} style={{ marginTop: 12 }}>
            <div className="form-grid">
              <div className="field"><label htmlFor="xe">{L.extNew}</label><input id="xe" type="date" value={f.new_end} onChange={e => setF({ ...f, new_end: e.target.value })} /></div>
              <div className="field"><label htmlFor="xr">{L.extReason}</label>
                <select id="xr" value={f.reason_code} onChange={e => setF({ ...f, reason_code: e.target.value })}>
                  <option value="">{L.choose}</option>{Object.entries(meta.delay_reasons).map(([k, v]) => <option key={k} value={k}>{lang === 'hi' ? term('reason', k) : v}</option>)}
                </select></div>
            </div>
            <div className="field"><label htmlFor="xn">{L.extNote}</label><textarea id="xn" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></div>
            {err && <p className="error" role="alert">{err}</p>}
            <div className="btnrow"><button className="btn">{L.grantExt}</button><button type="button" className="btn secondary" onClick={() => setOpen(false)}>{L.cancel}</button></div>
          </form>
        )}
      </div>
    </section>
  )
}

function InspectionPanel({ w, onDone }) {
  const { user } = useApp()
  const { L, date } = useT()
  const [open, setOpen] = useState(false)
  const p = w.inspection
  const canDo = ['AE', 'EE'].includes(user.role) && !p.done
  return (
    <section className="panel" id="inspection">
      <header className="panel-h"><h2>{L.inspHere}</h2>{canDo && !open && <button className="btn sm" onClick={() => setOpen(true)}>{L.recordInsp}</button>}</header>
      <div className="panel-b">
        <p className="small">{p.reason === 'risk' ? L.inspWhyRisk : L.inspWhyRandom} {L.dueBy(date(p.due))}.</p>
        {p.done && <p><span className={`tag ${p.done.outcome === 'ok' ? 'done' : 'defect'}`}>{p.done.outcome === 'ok' ? L.inspDoneOk : L.inspDoneIssues}</span> {p.done.note}</p>}
        {open && <ResultForm w={w} caption="Surprise inspection" okLabel={L.inspOk} badLabel={L.inspIssues} onCancel={() => setOpen(false)}
          onSubmit={async (good, note, ev) => { await api.post(`/works/${w.id}/inspection`, { outcome: good ? 'ok' : 'issues', note, evidence_id: ev }); setOpen(false); onDone() }} />}
      </div>
    </section>
  )
}

function AfterPanel({ w, onDone }) {
  const { user } = useApp()
  const { L, date } = useT()
  const [open, setOpen] = useState(null)
  const today = new Date().toISOString().slice(0, 10)
  return (
    <section className="panel" id="after">
      <header className="panel-h"><h2>{L.afterTitle}</h2></header>
      <div className="panel-b stack" style={{ gap: 8 }}>
        {w.certified_on && <p>{L.certifiedOn(date(w.certified_on))}</p>}
        {w.dlp_end && <p className="small muted">{L.dlp(date(w.dlp_end))}</p>}
        {w.postchecks.map(pc => (
          <div key={pc.id} className="recheck">
            {pc.done_on ? <p><span className={`tag ${pc.passed ? 'done' : 'defect'}`}>{L.recheckDone(date(pc.done_on), pc.passed)}</span> {pc.note}</p>
              : <p className={pc.due_date < today ? 'late' : ''}>{pc.due_date < today ? L.recheckLate(date(pc.due_date)) : L.recheckDue(date(pc.due_date))}</p>}
            {!pc.done_on && ['AE', 'EE'].includes(user.role) && open !== pc.id && <button className="btn sm" onClick={() => setOpen(pc.id)}>{L.recordRecheck}</button>}
            {open === pc.id && <ResultForm w={w} caption="Post-monsoon re-check" okLabel={L.fine} badLabel={L.problems} onCancel={() => setOpen(null)}
              onSubmit={async (good, note, ev) => { await api.post(`/postchecks/${pc.id}`, { passed: good, note, evidence_id: ev }); setOpen(null); onDone() }} />}
          </div>
        ))}
        {(w.votes.yes + w.votes.no) > 0 && <p className={w.votes.no >= 2 ? 'late' : 'small'}>{L.votes(w.votes.yes, w.votes.no)}</p>}
      </div>
    </section>
  )
}

function StageRow({ w, s, isEngineer, onOpen, onChanged }) {
  const { user } = useApp()
  const { L, lang, date, term, role } = useT()
  const [testOpen, setTestOpen] = useState(null)
  const ev = w.evidence.filter(e => e.stage_id === s.id)
  const unit = term('unit', s.unit)
  const unchecked = s.measurements.filter(m => !m.checked_by).length
  const canCheck = ['AE', 'EE'].includes(user.role)
  const needsLook = s.tests.some(x => x.passed === false || (x.result == null && s.progress >= 50)) || unchecked > 0 || !!s.hold

  async function check(mbId) {
    try { await api.post(`/measurements/${mbId}/check`); onChanged(lang === 'hi' ? 'जाँच-माप दर्ज' : 'Check-measurement recorded') } catch (e) { onChanged(e.message) }
  }

  return (
    <li id={`stage-${s.id}`}>
      <div className="stage-row">
        <div className="stage-name"><b>{term('stage', s.name)}</b><small>{L.qtyDone(num(s.qty_executed), num(s.qty_sanctioned), unit)}, {L.weight(s.weight)}, {date(s.planned_start)} – {date(s.planned_end)}</small></div>
        <div className="bar" aria-hidden="true"><span style={{ width: `${s.progress}%` }} /></div>
        <div className="pct num">{Math.round(s.progress)}%</div>
      </div>
      {s.linear && s.qty_executed > 0 && <CoverageStrip s={s} length={w.length_km} />}
      <div className="badges">
        {s.hold && <span className="tag claim">{L.onHold(lang === 'hi' ? s.hold.stage_hi : s.hold.stage, (lang === 'hi' ? s.hold.tests_hi : s.hold.tests).join(', '))}</span>}
        {s.progress > 0 && s.evidence_count === 0 && <span className="noev">{L.noPhoto(Math.round(s.progress))}</span>}
        {s.linear && s.gaps.length > 0 && s.evidence_count > 0 && <span className="noev">{L.gaps(s.gaps.map(([a, b]) => `${a.toFixed(1)}–${b.toFixed(1)}`).join(', '))}</span>}
      </div>
      {ev.length > 0 && <div className="evstrip">{ev.map(e => <Thumb key={e.id} e={e} onOpen={onOpen} />)}</div>}
      {isEngineer && s.progress > 0 && <UploadInline w={w} stage={s} onDone={() => onChanged(L.photoAdded)} />}

      {(s.tests.length > 0 || s.measurements.length > 0) && (
      <details className="stage-more" open={needsLook}>
        <summary>{L.testsAndMb}{needsLook && <span className="tabdot" aria-hidden="true" />}</summary>
      {s.tests.length > 0 && (
        <div className="subtable">
          <h4>{L.testsTitle}</h4>
          <ul className="tests">
            {s.tests.map(t => (
              <li key={t.id} className={t.passed === true ? 'pass' : t.passed === false ? 'fail' : 'pending'}>
                <span className="t-name">{term('test', t.name)}<small>{L.testSpec}: {lang === 'hi' ? t.spec_hi : t.spec}</small></span>
                <span className="t-res">
                  {t.result == null ? <span className="tag claim">{L.testPending}</span> : (
                    <>
                      <span className={`tag ${t.passed ? 'done' : 'defect'}`}>{t.passed ? L.testPass : L.testFail}</span>
                      <small>{t.kind === 'passfail' ? '' : `${num(t.result)} ${t.unit}`}{t.chainage_km != null ? `, ${L.testAt(t.chainage_km)}` : ''}{t.tested_on ? `, ${date(t.tested_on)}` : ''}</small>
                    </>
                  )}
                </span>
                {isEngineer && t.result == null && testOpen !== t.id && <button className="btn secondary sm" onClick={() => setTestOpen(t.id)}>{L.recordResult}</button>}
                {isEngineer && t.passed === false && testOpen !== t.id && <button className="btn secondary sm" onClick={() => setTestOpen(t.id)}>{L.retest}</button>}
                {testOpen === t.id && <TestForm w={w} s={s} t={t} onCancel={() => setTestOpen(null)} onDone={(m) => { setTestOpen(null); onChanged(m) }} />}
              </li>
            ))}
          </ul>
        </div>
      )}

      {s.measurements.length > 0 && (
        <details className="subtable" open={canCheck && unchecked > 0}>
          <summary>{L.mbTitle(s.measurements.length)}{unchecked > 0 && <span className="tag claim sm">{unchecked} {L.notChecked}</span>}</summary>
          <div className="tablewrap">
            <table className="plain mb">
              <thead><tr><th>{L.mbDate}</th><th className="r">{L.mbQty}</th>{s.linear && <th>{L.mbCh}</th>}<th>{L.mbBy}</th><th>{L.mbCheck}</th></tr></thead>
              <tbody>{s.measurements.map(m => (
                <tr key={m.id}>
                  <td>{date(m.entry_date)}</td>
                  <td className="r num">{num(m.qty)} {unit}</td>
                  {s.linear && <td className="num">{m.ch_from != null ? `${num(m.ch_from)}–${num(m.ch_to)}` : '—'}</td>}
                  <td>{role.JE}, {short(m.recorded_by_name)}</td>
                  <td>{m.checked_by ? <span className="small">{L.checkedBy(short(m.checked_by_name))}</span>
                    : canCheck ? <button className="btn secondary sm" onClick={() => check(m.id)}>{L.checkBtn}</button>
                      : <span className="tag claim sm">{L.notChecked}</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </details>
      )}
      </details>
      )}
    </li>
  )
}

/** Strip along the chainage: blue where measured and photographed, red dashes where measured without a photo. */
function CoverageStrip({ s, length }) {
  const { L } = useT()
  const pct = (x) => `${(x / length) * 100}%`
  return (
    <div className="covstrip" role="img" aria-label={L.coveredPct(Math.round(s.covered * 100))}>
      <div className="covbar">
        {s.executed.map(([a, b], i) => <span key={`e${i}`} className="cov-ex" style={{ left: pct(a), width: pct(b - a) }} />)}
        {s.gaps.map(([a, b], i) => <span key={`g${i}`} className="cov-gap" style={{ left: pct(a), width: pct(b - a) }} />)}
      </div>
      <div className="covscale"><span>0</span><span>{L.coveredPct(Math.round(s.covered * 100))}</span><span>{num(length)} km</span></div>
    </div>
  )
}

function TestForm({ w, s, t, onDone, onCancel }) {
  const { L } = useT()
  const [result, setResult] = useState(t.kind === 'passfail' ? '1' : '')
  const [ch, setCh] = useState('')
  const [lab, setLab] = useState('Field test')
  const [reason, setReason] = useState('')
  const [file, setFile] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault()
    if (result === '') return setErr(L.resultLabel(t.unit))
    if (!file) return setErr(L.reportFile)
    if (t.result != null && !reason.trim()) return setErr(L.retestReason)
    setBusy(true); setErr('')
    try {
      const ev = await api.form(`/works/${w.id}/evidence`, { kind: 'test_report', purpose: 'test_report', caption: `${t.name}: ${result} ${t.unit}`, stage_id: s.id, lat: w.lat, lng: w.lng, file })
      const r = await api.post(`/tests/${t.id}`, { result: Number(result), chainage_km: ch === '' ? null : Number(ch), lab, evidence_id: ev.id, reason })
      onDone(r.passed ? L.testPassedMsg : L.testFailedRaised(r.issue))
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  return (
    <form className="form testform" onSubmit={submit}>
      <div className="form-grid">
        {t.kind === 'passfail' ? (
          <div className="field"><label htmlFor={`r${t.id}`}>{L.passFail}</label>
            <select id={`r${t.id}`} value={result} onChange={e => setResult(e.target.value)}><option value="1">{L.testPass}</option><option value="0">{L.testFail}</option></select></div>
        ) : (
          <div className="field"><label htmlFor={`r${t.id}`}>{L.resultLabel(t.unit)}</label>
            <input id={`r${t.id}`} type="number" step="0.1" inputMode="decimal" value={result} onChange={e => setResult(e.target.value)} /></div>
        )}
        {s.linear ? (
          <div className="field"><label htmlFor={`c${t.id}`}>{L.chainageKm}</label>
            <input id={`c${t.id}`} type="number" step="0.01" min="0" max={w.length_km} value={ch} onChange={e => setCh(e.target.value)} /></div>
        ) : (
          <div className="field"><label htmlFor={`l${t.id}`}>{L.labLabel}</label>
            <select id={`l${t.id}`} value={lab} onChange={e => setLab(e.target.value)}><option value="Field test">{L.field}</option><option value="District quality control lab">{L.lab}</option></select></div>
        )}
      </div>
      <div className="field"><label htmlFor={`f${t.id}`}>{L.reportFile}</label><input id={`f${t.id}`} type="file" accept="image/*,application/pdf" onChange={e => setFile(e.target.files[0])} /></div>
      {t.result != null && <div className="field"><label htmlFor={`rr${t.id}`}>{L.retestReason}</label><input id={`rr${t.id}`} value={reason} onChange={e => setReason(e.target.value)} /></div>}
      {err && <p className="error" role="alert">{err}</p>}
      <div className="btnrow"><button className="btn" disabled={busy}>{busy ? L.saving : L.save}</button><button type="button" className="btn secondary" onClick={onCancel}>{L.cancel}</button></div>
    </form>
  )
}

function MeasurementForm({ w, onDone }) {
  const { L, term } = useT()
  const open = w.stages.filter(s => s.qty_executed < s.qty_sanctioned)
  const [stageId, setStageId] = useState(open[0]?.id || '')
  const st = w.stages.find(s => s.id === Number(stageId))
  const reach = st ? Math.max(0, ...st.executed.map(([, b]) => b)) : 0
  const [qty, setQty] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => { if (st?.linear) { setFrom(String(+reach.toFixed(2))); setTo('') } }, [stageId])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (st?.linear && from !== '' && to !== '' && Number(to) > Number(from)) setQty(String(+(Number(to) - Number(from)).toFixed(3))) }, [from, to, st])
  async function submit(e) {
    e.preventDefault(); setErr('')
    try {
      await api.post(`/works/${w.id}/measurements`, { stage_id: Number(stageId), qty: Number(qty), ch_from: st?.linear ? Number(from) : null, ch_to: st?.linear ? Number(to) : null })
      onDone()
    } catch (ex) { setErr(ex.message) }
  }
  return (
    <form onSubmit={submit} className="form inset">
      <div className="form-grid">
        <div className="field"><label htmlFor="mbs">{L.mbStage}</label>
          <select id="mbs" value={stageId} onChange={e => setStageId(e.target.value)}>
            {open.map(s => <option key={s.id} value={s.id}>{term('stage', s.name)} ({num(s.qty_executed)} / {num(s.qty_sanctioned)} {term('unit', s.unit)})</option>)}
          </select></div>
        <div className="field"><label htmlFor="mbq">{L.mbQtyLabel(term('unit', st?.unit || ''))}</label>
          <input id="mbq" type="number" step="0.001" min="0" value={qty} onChange={e => setQty(e.target.value)} readOnly={!!st?.linear} /></div>
        {st?.linear && <>
          <div className="field"><label htmlFor="mbf">{L.mbFrom}</label><input id="mbf" type="number" step="0.01" min="0" max={w.length_km} value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div className="field"><label htmlFor="mbt">{L.mbTo}</label><input id="mbt" type="number" step="0.01" min="0" max={w.length_km} value={to} onChange={e => setTo(e.target.value)} /></div>
        </>}
      </div>
      <p className="small muted">{L.mbHint}</p>
      {err && <p className="error" role="alert">{err}</p>}
      <div><button className="btn">{L.recordMb}</button></div>
    </form>
  )
}

function Thumb({ e, onOpen }) {
  const { date } = useT()
  return (
    <button className={`thumb ${e.source === 'citizen' ? 'citizen' : ''} ${e.in_geofence === false ? 'offsite' : ''}`} onClick={() => onOpen(e)} aria-label={e.caption}>
      {e.url ? <img src={e.url} alt="" loading="lazy" /> : <div className="thumb-ph small">{e.kind.replace('_', ' ')}</div>}
      <span>{e.chainage_km != null ? `km ${e.chainage_km.toFixed(1)}, ` : ''}{date(e.captured_at)}</span>
    </button>
  )
}

function UploadInline({ w, stage, onDone }) {
  const { L } = useT()
  const [busy, setBusy] = useState(false)
  async function pick(e) {
    const file = e.target.files[0]
    if (!file) return
    setBusy(true)
    try {
      await api.form(`/works/${w.id}/evidence`, { kind: 'photo', purpose: 'progress', caption: `${stage.name}, site photo`, stage_id: stage.id, lat: w.lat, lng: w.lng, file })
      onDone()
    } finally { setBusy(false); e.target.value = '' }
  }
  return (
    <label className="addphoto">
      {busy ? L.uploading : L.addPhoto}
      <input type="file" accept="image/*" capture="environment" onChange={pick} className="visually-hidden" />
    </label>
  )
}

function RaiseIssue({ w, onDone }) {
  const { meta, user } = useApp()
  const { L, lang, term } = useT()
  const [f, setF] = useState({ category: 'quality', title: '', description: '', stage_id: '', reason_code: '' })
  const [file, setFile] = useState(null)
  const [err, setErr] = useState('')
  const technical = ['AE', 'EE'].includes(user.role)
  async function submit(e) {
    e.preventDefault()
    if (!f.title.trim()) return setErr(L.raise.errTitle)
    if (f.category === 'delay' && !f.reason_code) return setErr(L.raise.errReason)
    try {
      let evidence_id
      if (file) evidence_id = (await api.form(`/works/${w.id}/evidence`, { kind: 'photo', purpose: ['CO', 'BDO'].includes(user.role) ? 'progress' : 'inspection', caption: `Inspection: ${f.title}`, stage_id: f.stage_id, lat: w.lat, lng: w.lng, file })).id
      await api.post(`/works/${w.id}/issues`, { ...f, stage_id: f.stage_id ? Number(f.stage_id) : null, reason_code: f.reason_code || null, evidence_id })
      onDone()
    } catch (ex) { setErr(ex.message) }
  }
  return (
    <form onSubmit={submit} className="form inset">
      <div className="form-grid">
        <div className="field"><label htmlFor="ic">{L.raise.type}</label>
          <select id="ic" value={f.category} onChange={e => setF({ ...f, category: e.target.value })}>
            {Object.entries(L.raise.cats).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div className="field"><label htmlFor="is">{L.raise.stage}</label>
          <select id="is" value={f.stage_id} onChange={e => setF({ ...f, stage_id: e.target.value })}>
            <option value="">{L.raise.whole}</option>{w.stages.map(s => <option key={s.id} value={s.id}>{term('stage', s.name)}</option>)}
          </select></div>
      </div>
      {f.category === 'delay' && (
        <div className="field"><label htmlFor="ir">{L.raise.reason}</label>
          <select id="ir" value={f.reason_code} onChange={e => setF({ ...f, reason_code: e.target.value })}>
            <option value="">{L.choose}</option>{Object.entries(meta.delay_reasons).map(([k, v]) => <option key={k} value={k}>{lang === 'hi' ? term('reason', k) : v}</option>)}
          </select></div>
      )}
      <div className="field"><label htmlFor="it">{L.raise.title}</label><input id="it" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></div>
      <div className="field"><label htmlFor="id">{L.raise.details}</label><textarea id="id" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></div>
      <div className="field"><label htmlFor="if">{technical ? L.raise.photoTech : L.raise.photo}</label>
        <input id="if" type="file" accept="image/*" capture="environment" onChange={e => setFile(e.target.files[0])} /></div>
      {err && <p className="error">{err}</p>}
      <div><button className="btn">{L.raise.record}</button></div>
    </form>
  )
}

function CheckItem({ w, item, onDone }) {
  const { L } = useT()
  const [busy, setBusy] = useState(false)
  async function pick(e) {
    const file = e.target.files[0]
    if (!file) return
    setBusy(true)
    try {
      const ev = await api.form(`/works/${w.id}/evidence`, { kind: 'photo', purpose: 'completion', caption: `Usability: ${item.item}`, lat: w.lat, lng: w.lng, file })
      await api.post(`/works/${w.id}/checklist/${item.id}`, { passed: true, evidence_id: ev.id })
      onDone()
    } finally { setBusy(false) }
  }
  return (
    <label className="btn secondary sm" style={{ position: 'relative' }}>
      {busy ? L.saving : L.passWithPhoto}
      <input type="file" accept="image/*" capture="environment" onChange={pick} className="visually-hidden" />
    </label>
  )
}

/** Shown when someone opens a work outside their responsibilities: say why, and offer the public page. */
/** Four numbers and one plain sentence. Claims are dashed, engineer-checked facts are solid. */
function Layers({ w }) {
  const { L, date } = useT()
  const limited = w.access.level === 'limited'
  const r = Math.round
  const verdict = w.status === 'USABLE_VERIFIED' ? { ok: true, text: L.vCertified(date(w.certified_on)) }
    : w.actual - w.check_measured >= 10 ? { ok: false, text: L.vGap(r(w.actual), r(w.check_measured)) }
      : !limited && w.financial - w.check_measured >= 15 ? { ok: false, text: L.vPaidAhead(r(w.financial), r(w.check_measured)) }
        : w.planned - w.actual >= 15 ? { ok: false, text: L.vBehind(r(w.planned - w.actual)) }
          : { ok: true, text: L.vFine }
  return (
    <section aria-label={L.layersTitle}>
      <div className="figures4" style={limited ? { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' } : undefined}>
        <div><span className="num">{r(w.planned)}%</span><span>{L.gPlanned}</span></div>
        <div className="claimfig"><span className="num">{r(w.actual)}%</span><span>{L.gReported}</span></div>
        <div className={`checkfig ${w.actual - w.check_measured >= 10 ? 'warn' : ''}`}><span className="num">{r(w.check_measured)}%</span><span>{L.gChecked}</span></div>
        {!limited && <div className={w.financial - w.check_measured >= 15 ? 'warn' : ''}><span className="num">{r(w.financial)}%</span><span>{L.gPaid}</span></div>}
      </div>
      <p className={`verdict ${verdict.ok ? 'ok' : 'bad'}`}>{verdict.text}</p>
    </section>
  )
}

/** Server reasons, grouped into a few plain lines; the exact list is one tap away. */
function plainReasons(items, L) {
  const n = (codes) => items.filter(b => codes.includes(b.code)).length
  const out = []
  const add = (k, c) => { if (c) out.push(L.why[k](c)) }
  add('status', n(['STATUS']))
  add('unfinished', n(['STAGE_INCOMPLETE', 'STAGE_NOT_MEASURED']))
  add('remeasure', n(['NOT_CHECK_MEASURED']))
  add('photos', n(['EVIDENCE_MISSING']))
  add('tests', n(['TEST_MISSING']))
  add('failed', n(['TEST_FAILED']))
  add('open', n(['OPEN_ISSUES']))
  add('usable', n(['CHECK_NOT_PASSED', 'CHECK_BAD_EVIDENCE', 'NO_CHECKLIST']))
  return out
}
function Blockers({ title, items }) {
  const { L, lang } = useT()
  const lines = plainReasons(items, L)
  return (
    <div className="blockers" role="status">
      <b>{title}</b>
      <ul>{lines.map((t, i) => <li key={i}>{t}</li>)}</ul>
      <details className="more"><summary>{L.seeDetails}</summary>
        <ul>{items.map((b, i) => <li key={i}>{lang === 'hi' ? b.message_hi : b.message}</li>)}</ul>
      </details>
    </div>
  )
}

/** Can this work be certified? Only AE / EE / DM / DDC see this; only the EE presses the button. */
function Readiness({ w, canCertify, onDone }) {
  const { L } = useT()
  const { user, setToast } = useApp()
  const [why, setWhy] = useState('')
  const [returning, setReturning] = useState(false)
  const [busy, setBusy] = useState(false)
  const b = w.certification.blockers
  if (!['AE', 'EE', 'DM', 'DDC'].includes(user.role)) return null
  async function certify() {
    if (!window.confirm(L.confirmCertify)) return
    setBusy(true)
    try { await api.post(`/works/${w.id}/certify`, {}); onDone(L.certified) } catch (e) { setToast(e.message) } finally { setBusy(false) }
  }
  async function giveBack(e) {
    e.preventDefault(); setBusy(true)
    try { await api.post(`/works/${w.id}/return-claim`, { reason: why }); onDone(L.returned) } catch (ex) { setToast(ex.message) } finally { setBusy(false) }
  }
  return (
    <div className="readiness">
      <h3>{L.readyTitle}</h3>
      {b.length === 0 ? <p className="ok">{L.readyOk}</p> : <Blockers title={L.notYet} items={b} />}
      {canCertify && b.length === 0 && <button className="btn full" disabled={busy || !w.can_certify} onClick={certify}>{L.certify}</button>}
      {['AE', 'EE'].includes(user.role) && !returning && b.length > 0 && <button className="linkbtn" onClick={() => setReturning(true)}>{L.returnClaim}</button>}
      {returning && (
        <form className="form" onSubmit={giveBack}>
          <div className="field"><label htmlFor="rw">{L.returnWhy}</label><textarea id="rw" value={why} onChange={e => setWhy(e.target.value)} /></div>
          <div className="btnrow"><button className="btn" disabled={busy || why.trim().length < 10}>{L.returnClaim}</button><button type="button" className="btn secondary" onClick={() => setReturning(false)}>{L.cancel}</button></div>
        </form>
      )}
    </div>
  )
}

/** Money: two numbers everyone understands; the step-by-step bill trail for those who process bills. */
function FinancePanel({ w, onDone }) {
  const { L, lakh } = useT()
  const { user } = useApp()
  const f = w.finance
  const skipped = f.authorized_lakh - f.checked_lakh
  return (
    <section className="panel">
      <header className="panel-h"><h2>{L.finTitle}</h2></header>
      <div className="panel-b">
        <div className="money2">
          <div><span>{L.billsRaised}</span><b className="num">{lakh(f.submitted_lakh.toFixed(1))}</b></div>
          <div className="paid"><span>{L.actuallyPaid}</span><b className="num">{lakh(f.paid_lakh.toFixed(1))}</b><small>{L.ofSanction(Math.round(f.paid_pct))}</small></div>
        </div>
        {skipped > 0.01 && <p className="small warntext">{L.finSkip(lakh(skipped.toFixed(1)))}</p>}
        {f.sources.map(src => <p key={src} className="small muted">{L.finSource[src] || src}</p>)}
        <details className="more"><summary>{L.billSteps}</summary>
          <ol className="pipeline">
            {[['submitted', f.submitted_lakh], ['checked', f.checked_lakh], ['authorized', f.authorized_lakh], ['paid', f.paid_lakh]].map(([k, v]) =>
              <li key={k} className={k === 'paid' ? 'paid' : ''}><span>{L.finStages[k]}</span><b className="num">{lakh(v.toFixed(1))}</b></li>)}
          </ol>
          {f.liability_lakh > 0 && <p className="small">{L.finStages.liability}: <b>{lakh(f.liability_lakh.toFixed(1))}</b></p>}
        </details>
        {['CONTRACTOR', 'JE'].includes(user.role) && <SubmitBill w={w} onDone={onDone} />}
      </div>
    </section>
  )
}

function SubmitBill({ w, onDone }) {
  const { L, date } = useT()
  const { setToast } = useApp()
  const billed = new Set(w.bills.flatMap(b => b.mb_ids))
  const free = w.stages.flatMap(s => s.measurements.map(m => ({ ...m, stage: s.name, unit: s.unit }))).filter(m => !billed.has(m.id))
  const [open, setOpen] = useState(false)
  const [pick, setPick] = useState([])
  const [amt, setAmt] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault(); setBusy(true)
    try { await api.post(`/works/${w.id}/bills`, { amount_lakh: Number(amt), mb_ids: pick }); setOpen(false); onDone(L.billDone) } catch (ex) { setToast(ex.message) } finally { setBusy(false) }
  }
  if (!open) return <button className="btn secondary" onClick={() => setOpen(true)} disabled={!free.length}>{free.length ? L.submitBill : L.noFreeMb}</button>
  return (
    <form className="form" onSubmit={submit}>
      <fieldset className="field"><legend>{L.billMbs}</legend>
        {free.map(m => <label key={m.id} className="check"><input type="checkbox" checked={pick.includes(m.id)} onChange={e => setPick(e.target.checked ? [...pick, m.id] : pick.filter(x => x !== m.id))} /> {m.stage}: {num(m.qty)} {m.unit}, {date(m.entry_date)}</label>)}
      </fieldset>
      <div className="field"><label htmlFor="ba">{L.billAmount}</label><input id="ba" type="number" step="0.01" min="0" inputMode="decimal" value={amt} onChange={e => setAmt(e.target.value)} /></div>
      <div className="btnrow"><button className="btn" disabled={busy || !pick.length || !(Number(amt) > 0)}>{L.submitBill}</button><button type="button" className="btn secondary" onClick={() => setOpen(false)}>{L.cancel}</button></div>
    </form>
  )
}

function BillAction({ w, b, onDone }) {
  const { L } = useT()
  const { user, setToast } = useApp()
  const [paying, setPaying] = useState(false)
  const [ref, setRef] = useState('')
  const [amt, setAmt] = useState(String(b.amount_lakh))
  const [busy, setBusy] = useState(false)
  const post = async (path, body) => {
    setBusy(true)
    try { await api.post(path, body); onDone(L.billDone) } catch (e) { setToast(e.message) } finally { setBusy(false) }
  }
  if (b.status === 'SUBMITTED' && user.role === 'AE') return <button className="btn secondary sm" disabled={busy} onClick={() => post(`/bills/${b.id}/check`)}>{L.billCheck}</button>
  if (b.status === 'CHECKED' && user.role === 'EE' && w.people.ee?.id === user.id) return <button className="btn secondary sm" disabled={busy} onClick={() => post(`/bills/${b.id}/authorize`)}>{L.billAuthorize}</button>
  if (b.status === 'AUTHORIZED' && ['EE', 'DDC'].includes(user.role)) {
    if (!paying) return <button className="btn secondary sm" onClick={() => setPaying(true)}>{L.billPay}</button>
    return (
      <form className="form" onSubmit={e => { e.preventDefault(); post(`/bills/${b.id}/payment`, { paid_lakh: Number(amt), payment_ref: ref }) }}>
        <div className="field"><label htmlFor={`pa${b.id}`}>{L.payAmt}</label><input id={`pa${b.id}`} type="number" step="0.01" value={amt} onChange={e => setAmt(e.target.value)} /></div>
        <div className="field"><label htmlFor={`pr${b.id}`}>{L.payRef}</label><input id={`pr${b.id}`} value={ref} onChange={e => setRef(e.target.value)} /></div>
        <p className="small muted">{L.finSource.manual_entry}</p>
        <div className="btnrow"><button className="btn sm" disabled={busy || ref.trim().length < 4}>{L.billPay}</button><button type="button" className="btn secondary sm" onClick={() => setPaying(false)}>{L.cancel}</button></div>
      </form>
    )
  }
  return null
}

function Revisions({ w, onDone }) {
  const { L, date, term } = useT()
  const { user, setToast } = useApp()
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ stage_id: '', new_qty: '', reason: '', order_ref: '' })
  const [busy, setBusy] = useState(false)
  const canRevise = user.role === 'EE' && w.people.ee?.id === user.id && w.status !== 'USABLE_VERIFIED'
  if (w.access.level === 'limited' || (!w.revisions.length && !canRevise)) return null  // nothing to show: no panel
  async function submit(e) {
    e.preventDefault(); setBusy(true)
    try { await api.post(`/works/${w.id}/revisions`, { ...f, stage_id: Number(f.stage_id), new_qty: Number(f.new_qty) }); setOpen(false); onDone(L.revSaved) }
    catch (ex) { setToast(ex.message) } finally { setBusy(false) }
  }
  return (
    <section className="panel">
      <header className="panel-h"><h2>{L.revTitle}</h2>{canRevise && !open && <button className="btn secondary sm" onClick={() => setOpen(true)}>{L.revAdd}</button>}</header>
      <div className="panel-b">
        {w.revisions.length === 0 ? <p className="small muted">{L.revNone}</p> : (
          <ul className="plainlist">{w.revisions.map(r => (
            <li key={r.id}><b>{L.revRow(term('stage', r.stage_name), num(r.old_qty), num(r.new_qty), w.stages.find(s => s.id === r.stage_id)?.unit || '')}</b>
              <small className="block muted">{r.reason} ({r.order_ref}, {date(r.approved_on)})</small></li>
          ))}</ul>
        )}
        {open && (
          <form className="form" onSubmit={submit}>
            <div className="form-grid">
              <div className="field"><label htmlFor="rs">{L.revWhich}</label>
                <select id="rs" value={f.stage_id} onChange={e => setF({ ...f, stage_id: e.target.value })}><option value="">{L.choose}</option>{w.stages.map(s => <option key={s.id} value={s.id}>{term('stage', s.name)} ({num(s.qty_sanctioned)} {s.unit})</option>)}</select></div>
              <div className="field"><label htmlFor="rq">{L.revQty}</label><input id="rq" type="number" step="0.001" inputMode="decimal" value={f.new_qty} onChange={e => setF({ ...f, new_qty: e.target.value })} /></div>
            </div>
            <div className="field"><label htmlFor="rr">{L.revReason}</label><textarea id="rr" value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} /></div>
            <div className="field"><label htmlFor="ro">{L.revOrder}</label><input id="ro" value={f.order_ref} onChange={e => setF({ ...f, order_ref: e.target.value })} /></div>
            <div className="btnrow"><button className="btn" disabled={busy || !f.stage_id || f.reason.trim().length < 10 || f.order_ref.trim().length < 3}>{L.save}</button><button type="button" className="btn secondary" onClick={() => setOpen(false)}>{L.cancel}</button></div>
          </form>
        )}
      </div>
    </section>
  )
}

/** Who decided what, folded away until someone asks. */
function AuditPanel({ w }) {
  const { L, dateTime, role } = useT()
  return (
    <details className="panel historybox">
      <summary className="panel-h"><h2>{L.auditTitle}</h2><span className="small muted">{L.items(w.audit.length)}</span></summary>
      <div className="panel-b">
        <p className="small muted">{L.auditSub}</p>
        <ol className="timeline">{[...w.audit].reverse().slice(0, 15).map(a => (
          <li key={a.id}><b>{L.auditAct[`${a.entity}.${a.action}`] || a.action.replace(/_/g, ' ')}</b> <span className="when">{dateTime(a.at)}, {role[a.actor_role] || a.actor_role}</span>
            {a.reason && <div className="small">{a.reason}</div>}</li>
        ))}</ol>
      </div>
    </details>
  )
}

function NoAccess() {
  const { L } = useT()
  return (
    <main className="page">
      <section className="panel noaccess">
        <div className="panel-b na-body">
          <div aria-hidden="true" style={{ color: 'var(--board)' }}>{Icon.lock(40)}</div>
          <h1>{L.noAccessTitle}</h1>
          <p className="muted">{L.noAccessSub}</p>
          <div className="na-actions">
            <Link className="btn" to="/">{L.backTasks}</Link>
            <Link className="btn secondary" to="/public/find">{L.noAccessPublic}</Link>
          </div>
        </div>
      </section>
    </main>
  )
}
