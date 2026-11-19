import { useMemo, useRef, useState } from 'react'
import { useT } from '../strings'

const W = 640, H = 240, M = { l: 36, r: 84, t: 14, b: 28 }
const BLUE = '#2457C5', AMBER = '#B7791F', PLAN = '#7B8494'

/** Planned S-curve (reference, dashed) vs reported physical and financial progress. One % axis. */
export default function ProgressChart({ curve, reports, start, end, today }) {
  const { lang, date: fmtDate } = useT()
  const tx = lang === 'hi' ? { today: 'आज', phys: 'काम', paid: 'भुगतान', planned: 'नियोजित', physL: 'वास्तविक प्रगति', paidL: 'भुगतान', lc: 'hi-IN' } : { today: 'Today', phys: 'Physical', paid: 'Paid', planned: 'Planned', physL: 'Physical progress', paidL: 'Payments made', lc: 'en-IN' }
  const ref = useRef(null)
  const [hover, setHover] = useState(null)
  const t0 = new Date(start).getTime()
  const t1 = Math.max(new Date(end).getTime(), new Date(today).getTime())
  const x = (d) => M.l + ((new Date(d).getTime() - t0) / (t1 - t0 || 1)) * (W - M.l - M.r)
  const y = (v) => M.t + (1 - v / 100) * (H - M.t - M.b)
  const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('')

  const planPts = curve.map(c => [x(c.date), y(c.planned)])
  const phys = [[x(start), y(0)], ...reports.map(r => [x(r.report_date), y(r.physical_pct)])]
  const fin = [[x(start), y(0)], ...reports.map(r => [x(r.report_date), y(r.financial_pct)])]
  const last = reports[reports.length - 1]

  const months = useMemo(() => {
    const out = []
    const d = new Date(t0); d.setDate(1); d.setMonth(d.getMonth() + 1)
    const span = (t1 - t0) / 864e5
    const step = span > 300 ? 3 : span > 150 ? 2 : 1
    while (d.getTime() <= t1) { out.push(new Date(d)); d.setMonth(d.getMonth() + step) }
    return out
  }, [t0, t1])

  function planAt(date) {
    const t = new Date(date).getTime()
    let prev = curve[0]
    for (const c of curve) {
      if (new Date(c.date).getTime() >= t) {
        const a = new Date(prev.date).getTime(), b = new Date(c.date).getTime()
        return b === a ? c.planned : prev.planned + (c.planned - prev.planned) * (t - a) / (b - a)
      }
      prev = c
    }
    return curve[curve.length - 1].planned
  }

  function onMove(e) {
    if (!reports.length) return
    const box = ref.current.getBoundingClientRect()
    const px = (e.clientX - box.left) * (W / box.width)
    let best = reports[0]
    for (const r of reports) if (Math.abs(x(r.report_date) - px) < Math.abs(x(best.report_date) - px)) best = r
    setHover({ r: best, left: (x(best.report_date) / W) * box.width })
  }

  const labelY = (v, other) => {
    let yy = y(v)
    if (other !== undefined && Math.abs(y(v) - y(other)) < 14) yy += y(v) > y(other) ? 7 : -7
    return yy + 4
  }

  return (
    <div style={{ position: 'relative' }}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="chart" role="img"
        aria-label={`Planned versus actual progress. Latest: physical ${last?.physical_pct ?? 0}%, financial ${last?.financial_pct ?? 0}%.`}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {[0, 25, 50, 75, 100].map(v => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke="#E7EBF0" />
            <text x={M.l - 8} y={y(v) + 4} textAnchor="end">{v}%</text>
          </g>
        ))}
        {months.map(m => <text key={m.toISOString()} x={x(m)} y={H - 8} textAnchor="middle">{m.toLocaleDateString(tx.lc, { month: 'short' })}</text>)}
        <line x1={x(today)} x2={x(today)} y1={M.t} y2={H - M.b} stroke="#17202B" strokeDasharray="2 3" />
        <text x={x(today) - 5} y={H - M.b - 6} textAnchor="end" className="lbl-strong">{tx.today}</text>
        <path d={path(planPts)} fill="none" stroke={PLAN} strokeWidth="2" strokeDasharray="6 4" />
        <path d={path(fin)} fill="none" stroke={AMBER} strokeWidth="2" strokeLinejoin="round" />
        <path d={path(phys)} fill="none" stroke={BLUE} strokeWidth="2" strokeLinejoin="round" />
        {reports.map(r => <circle key={r.id} cx={x(r.report_date)} cy={y(r.physical_pct)} r="4" fill={BLUE} stroke="#fff" strokeWidth="2" />)}
        {last && <>
          <text x={x(last.report_date) + 8} y={labelY(last.physical_pct, last.financial_pct)} className="lbl-strong">{tx.phys} {Math.round(last.physical_pct)}%</text>
          <text x={x(last.report_date) + 8} y={labelY(last.financial_pct, last.physical_pct)}>{tx.paid} {Math.round(last.financial_pct)}%</text>
        </>}
        {hover && <line x1={x(hover.r.report_date)} x2={x(hover.r.report_date)} y1={M.t} y2={H - M.b} stroke="#4A5565" strokeWidth="1" />}
      </svg>
      {hover && (
        <div className="charttip" style={{ left: Math.min(hover.left + 12, 420), top: 16 }}>
          <b>{fmtDate(hover.r.report_date)}</b><br />
          {tx.planned} {Math.round(planAt(hover.r.report_date))}%, {tx.phys} {Math.round(hover.r.physical_pct)}%, {tx.paid} {Math.round(hover.r.financial_pct)}%
        </div>
      )}
      <div className="legend" style={{ marginTop: 6 }}>
        <span><i className="dash" style={{ borderColor: PLAN }} />{tx.planned}</span>
        <span><i style={{ borderColor: BLUE }} />{tx.physL}</span>
        <span><i style={{ borderColor: AMBER }} />{tx.paidL}</span>
      </div>
    </div>
  )
}
