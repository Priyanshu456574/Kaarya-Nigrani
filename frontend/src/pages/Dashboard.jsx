import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useApp } from '../App'
import { WorkTag } from '../components/Tags'
import KhagariaMap, { MapLegend } from '../components/KhagariaMap'
import { useT } from '../strings'

/** The DM's review: a short agenda first, everything else on request. */
export default function Dashboard() {
  const { setToast } = useApp()
  const { L, lang, date, lakh, msg, role, workStatus } = useT()
  const [d, setD] = useState(null)
  const [block, setBlock] = useState('')
  const [q, setQ] = useState('')
  const [allAgenda, setAllAgenda] = useState(false)
  const [showWorks, setShowWorks] = useState(false)

  useEffect(() => { api.get('/dashboard').then(x => { setD(x); if (x.scope !== 'district') setShowWorks(true) }) }, [])

  const works = useMemo(() => (d?.works || []).filter(w =>
    (!block || w.block === block) && (!q || `${w.code} ${w.name} ${w.village}`.toLowerCase().includes(q.toLowerCase()))), [d, block, q])
  const agenda = useMemo(() => works.filter(w => w.flags.length).sort((a, b) => b.score - a.score || a.code.localeCompare(b.code)), [works])

  if (!d) return <div className="page muted">{L.loading}</div>
  const t = d.totals
  const district = d.scope === 'district', K = district ? L.kpi2 : L.kpiOwn
  const tiles = [
    { n: t.needs_decision, l: K.decide, k: 'bad' },
    { n: t.escalated, l: K.escalated, k: 'bad' },
    { n: t.open_reported, l: K.waiting, k: 'claim' },
    { n: t.usable_verified, l: K.usable, k: 'good' },
  ]
  const title = district ? L.reviewTitle : d.scope === 'department' ? L.scopeTitle.department(d.works[0]?.department || '') : L.scopeTitle.own
  const sub = district ? L.reviewSub(t.works, lakh(t.sanctioned_lakh), date(d.today)) : L.scopeSub[d.scope](t.works)
  if (!d.works.length) return (
    <main className="page"><div className="pagehead"><div><h1>{title}</h1></div></div>
      <section className="panel"><div className="panel-b empty-big"><p><b>{L.noWorks}</b></p><p className="muted">{L.noWorksSub}</p></div></section></main>)
  const shown = allAgenda ? agenda : agenda.slice(0, 5)

  async function copySummary() {
    const lines = [
      `${title}, ${date(d.today)}`, '',
      ...tiles.map(x => `${x.l}: ${x.n}`), '',
      `${L.agenda}:`,
      ...agenda.slice(0, 5).map((w, i) => `${i + 1}. ${w.name} (${w.code}). ${msg(w.flags[0])} ${L.nextAction}: ${role[w.flags[0].next_action_by] || w.flags[0].next_action_by}${w.flags[0].next_person ? `, ${w.flags[0].next_person}` : ''}.`), '',
      `${L.holdups}:`, ...(d.holdups.length ? d.holdups.map(h => `- ${lang === 'hi' ? h.label_hi : h.label}: ${h.works.map(w => w.code).join(', ')} (${lakh(h.sanctioned_lakh)})`) : [`- ${L.noHoldups}`]), '',
      `${L.escalated}:`, ...(d.escalated.length ? d.escalated.map(e => `- ${e.ticket} ${e.title}: ${e.days}, ${role[e.to.role]} ${e.to.name}`) : [`- ${L.noEsc}`]), '',
      ...(d.inspections ? [`${L.inspTitle}:`] : []), ...(d.inspections || []).map(p => `- ${p.work.code} ${p.work.name} (${p.reason === 'risk' ? L.inspRisk : L.inspRandom}), ${p.assigned_to?.name}`),
    ].join('\n')
    try { await navigator.clipboard.writeText(lines); setToast(L.copied) }
    catch { setToast(lang === 'hi' ? 'कॉपी नहीं हो सका' : 'Could not copy to the clipboard') }
  }

  return (
    <main className="page">
      <div className="pagehead">
        <div>
          <h1>{title}</h1>
          <p className="muted">{sub}</p>
        </div>
        {d.scope !== 'own' && <button className="btn secondary" onClick={copySummary}>{L.copySummary}</button>}
      </div>

      <section className="kpis four" aria-label="District totals">
        {tiles.map(x => <div key={x.l} className={`kpi ${x.k}`}><span className="num">{x.n}</span><span className="lbl">{x.l}</span></div>)}
      </section>

      <div className="chips" role="group" aria-label={L.allBlocks}>
        <button className={`chip ${!block ? 'on' : ''}`} onClick={() => setBlock('')}>{L.allBlocks}</button>
        {d.blocks.map(b => (
          <button key={b.block} className={`chip ${block === b.block ? 'on' : ''}`} onClick={() => setBlock(block === b.block ? '' : b.block)} aria-pressed={block === b.block}>
            {b.block}{b.flagged > 0 && <span className="chipflag">{b.flagged}</span>}
          </button>
        ))}
      </div>

      <div className="dash-grid">
        <section className="panel">
          <header className="panel-h"><div><h2>{L.agenda}</h2><p className="small muted">{L.agendaSub}</p></div></header>
          {agenda.length === 0 && <p className="panel-b muted">{L.noneFlagged}</p>}
          <ol className="agenda">
            {shown.map((w, i) => {
              const top = w.flags[0]
              return (
                <li key={w.id}>
                  <Link className="agenda-row" to={`/works/${w.id}`}>
                    <span className="rank">{i + 1}</span>
                    <div className="agenda-main">
                      <div className="agenda-title"><span>{w.name}</span></div>
                      <p className={`topflag s${top.severity}`}>{msg(top)}</p>
                      <div className="meta">{w.block} {L.block}{w.flags.length > 1 ? `, ${L.moreIssues(w.flags.length - 1)}` : ''}</div>
                    </div>
                    <div className="owner-chip">
                      <small>{L.nextAction}</small>
                      <b>{role[top.next_action_by] || top.next_action_by}</b>
                      <span>{top.next_person?.replace('Er. ', '')}</span>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ol>
          {agenda.length > 5 && <div className="showall"><button className="btn secondary" onClick={() => setAllAgenda(!allAgenda)}>{allAgenda ? L.showTop : L.showAgenda(agenda.length)}</button></div>}
        </section>

        <section className="panel mappanel">
          <header className="panel-h"><h2>{L.district}</h2><span className="small muted">{block ? L.blockSelected(block) : L.clickBlock}</span></header>
          <KhagariaMap works={works} height={420} selectedBlock={block} onBlockClick={(b) => setBlock(block === b ? '' : b)} />
          <MapLegend />
        </section>
      </div>

      {d.scope !== 'own' && <div style={{ marginTop: 24 }}><Decisions items={d.decisions || []} /></div>}

      <div className={d.inspections ? 'three-col' : 'two-col'}>
        <section className="panel">
          <header className="panel-h"><div><h2>{L.holdups}</h2><p className="small muted">{L.holdupsSub}</p></div></header>
          <div className="panel-b">
            {d.holdups.length === 0 && <p className="empty">{L.noHoldups}</p>}
            <ul className="holdups">
              {d.holdups.map(h => (
                <li key={h.reason}>
                  <div className="hu-head"><b>{lang === 'hi' ? h.label_hi : h.label}</b><span className="num">{lakh(h.sanctioned_lakh)}</span></div>
                  <div className="small muted">{L.holdupWorks(h.works.length)}{h.overdue ? `, ${L.holdupOverdue(h.overdue)}` : ''}</div>
                  <div className="hu-works">{h.works.map(w => <Link key={w.id} to={`/works/${w.id}`}>{w.name}</Link>)}</div>
                </li>
              ))}
            </ul>
          </div>
        </section>
        <section className="panel">
          <header className="panel-h"><div><h2>{L.escalated}</h2><p className="small muted">{L.escalatedSub}</p></div></header>
          <div className="panel-b">
            {d.escalated.length === 0 && <p className="empty">{L.noEsc}</p>}
            <ul className="holdups">
              {d.escalated.map(e => (
                <li key={e.ticket}>
                  <Link to={`/works/${e.work_id}?tab=issues`}><b>{e.title}</b></Link>
                  <div className="small"><span className="esc-to">{L.escRow(e.ticket, e.days)}</span></div>
                  <div className="small muted">{role[e.to.role]}, {e.to.name}{e.owner ? `. ${L.escFrom(role[e.owner.role], e.owner.name)}` : ''}</div>
                </li>
              ))}
            </ul>
          </div>
        </section>
        {d.inspections && <section className="panel">
          <header className="panel-h"><div><h2>{L.inspTitle}</h2><p className="small muted">{L.inspSub}</p></div></header>
          <div className="panel-b">
            <ul className="holdups">
              {d.inspections.map(p => (
                <li key={p.work.id}>
                  <Link to={`/works/${p.work.id}`}><b>{p.work.name}</b></Link>
                  <div className="small muted">{p.reason === 'risk' ? L.inspRisk : L.inspRandom}, {role.AE} {p.assigned_to?.name.replace('Er. ', '')}</div>
                  <div className="small">{p.done ? <span className={`tag ${p.done.outcome === 'ok' ? 'done' : 'defect'} sm`}>{p.done.outcome === 'ok' ? L.inspDoneOk : L.inspDoneIssues}</span>
                    : <span className="tag claim sm">{L.inspPending}, {L.dueBy(date(p.due))}</span>}</div>
                </li>
              ))}
            </ul>
          </div>
        </section>}
      </div>

      <section className="panel" style={{ marginTop: 24 }}>
        <header className="panel-h">
          <h2>{d.scope === 'own' ? L.myWorks : L.allWorks}</h2>
          <button className="btn secondary" onClick={() => setShowWorks(!showWorks)} aria-expanded={showWorks}>{showWorks ? L.hideAll : L.browseAll}</button>
        </header>
        {showWorks && <>
          <div className="panel-b filters" style={{ paddingBottom: 12 }}>
            <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={L.search} aria-label={L.search} />
          </div>
          <div className="worklist" role="table" aria-label={L.allWorks}>
            <div className="wl-row wl-head" role="row">
              <span role="columnheader">{L.colWork}</span><span role="columnheader">{L.colStatus}</span>
              <span role="columnheader">{L.colProg}</span><span role="columnheader" className="r">{L.colPaid}</span><span role="columnheader" className="r">{L.colFlags}</span>
            </div>
            {works.map(w => (
              <Link key={w.id} to={`/works/${w.id}`} className="wl-row" role="row">
                <span role="cell" className="wl-name"><b>{w.name}</b><small>{w.code}, {w.block}, {L.due} {date(w.due_date)}</small></span>
                <span role="cell"><WorkTag status={w.status} /></span>
                <span role="cell" className="wl-prog">
                  <span className="pbar" aria-label={`${workStatus[w.status]}: ${L.ofPlanned(Math.round(w.actual), Math.round(w.planned))}`}>
                    <span className="pbar-act" style={{ width: `${w.actual}%` }} />
                    <span className="pbar-plan" style={{ left: `${Math.min(w.planned, 100)}%` }} />
                  </span>
                  <small className="num">{L.ofPlanned(Math.round(w.actual), Math.round(w.planned))}</small>
                </span>
                <span role="cell" className="r num wl-paid"><small className="mobile-only">{L.colPaid} </small>{Math.round(w.financial)}%</span>
                <span role="cell" className={`r num wl-flags ${w.flags.length ? 'has' : ''}`}>{w.flags.length ? <>{w.flags.length}<small className="mobile-only"> {L.colFlags}</small></> : '—'}</span>
              </Link>
            ))}
          </div>
        </>}
      </section>
    </main>
  )
}

/** The DM's first question: what needs my intervention today. One line each; the evidence is one tap away. */
function Decisions({ items }) {
  const { L, lang, role } = useT()
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, 3)
  const who = (o) => o ? `${role[o.role] || o.role}${o.name ? ` ${o.name.replace('Er. ', '')}` : ''}` : ''
  return (
    <section className="panel decisions" aria-labelledby="dec-h">
      <header className="panel-h"><h2 id="dec-h">{L.decisions}</h2>{items.length > 0 && <span className="small muted">{L.items(items.length)}</span>}</header>
      {items.length === 0 ? <p className="empty">{L.noDecisions}</p> : (
        <ol className="declist">
          {shown.map((x, i) => (
            <li key={i} className={x.overdue_days > 0 ? 'dec-late' : ''}>
              <div className="dec-main">
                <b>{lang === 'hi' ? x.decision_hi : x.decision}</b>
                <span>{x.work.name}</span>
                <span className="small muted">
                  {x.escalated_to ? L.dNowWith(who(x.escalated_to), who(x.owner)) : L.dWith(who(x.owner))}
                  {x.overdue_days > 0 && <> · <span className="overdue">{L.dOverdue(x.overdue_days)}</span></>}
                </span>
              </div>
              <Link className="btn secondary sm" to={`/works/${x.work.id}?tab=${x.tab}${x.focus ? `&focus=${x.focus}` : ''}`}>{L.open}</Link>
            </li>
          ))}
        </ol>
      )}
      {items.length > 3 && <div className="showall tight"><button className="linkbtn" onClick={() => setAll(!all)}>{all ? L.fewerFlags : L.moreFlags(items.length - 3)}</button></div>}
    </section>
  )
}
