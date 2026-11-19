/* In-browser port of the backend (workflow.py, flags.py, geo.py, main.py) so the demo runs with no server.
   Same rules, same data. State lives in memory; reloading the page resets the demo. */
import snapshot from './snapshot.json'
import MEDIA from './media.json'
import TERMS from '../../../shared/terms_hi.json'

const hi = (kind, text) => TERMS[kind]?.[text] ?? text

// ---------- dates (snapshot is shifted so its "today" becomes the real today) ----------
const DAY = 864e5
const isoDay = (d) => { const z = new Date(d); return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, '0')}-${String(z.getDate()).padStart(2, '0')}` }
const parseDay = (s) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d) }
const TODAY = isoDay(new Date())
const days = (a, b) => Math.round((parseDay(b) - parseDay(a)) / DAY) // b - a
const addDays = (s, n) => isoDay(parseDay(s).getTime() + n * DAY)
const nowStamp = () => { const d = new Date(); return `${isoDay(d)}T${d.toTimeString().slice(0, 8)}` }
const SHIFT = days(snapshot.today, TODAY)
const DATE_RE = /^\d{4}-\d{2}-\d{2}/
const shift = (v) => (typeof v === 'string' && DATE_RE.test(v) && SHIFT) ? addDays(v.slice(0, 10), SHIFT) + v.slice(10) : v
const clone = (rows) => rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, shift(v)])))

const TABLES = ['officers', 'works', 'stages', 'reports', 'evidence', 'issues', 'events', 'checklist', 'measurements', 'bills', 'tests',
  'extensions', 'postchecks', 'inspections', 'votes', 'notifications', 'revisions', 'audit', 'supports']
let db, nextId
export function reset() {
  db = Object.fromEntries(TABLES.map(k => [k, clone(snapshot[k] || [])]))
  for (const w of db.works) w.line = w.alignment ? JSON.parse(w.alignment) : null
  for (const b of db.bills) b.mb = JSON.parse(b.mb_ids)
  nextId = Object.fromEntries(TABLES.map(k => [k, Math.max(0, ...db[k].map(r => r.id)) + 1]))
}
reset()
const insert = (table, row) => { row.id = nextId[table]++; db[table].push(row); return row }
const byId = (table, id) => db[table].find(r => r.id === id)
const round1 = (x) => Math.round(x * 10) / 10
const g = (x) => String(+x.toFixed(3))
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dmy = (s) => { const d = parseDay(s); return `${String(d.getDate()).padStart(2, '0')} ${MON[d.getMonth()]} ${d.getFullYear()}` }

// ---------- geometry ----------
const M_LAT = 110570
const mLng = (lat) => 111320 * Math.cos(lat * Math.PI / 180)
function project(line, lat, lng) {
  const lat0 = line[0][0], lng0 = line[0][1], mx = mLng(lat0)
  const px = (lng - lng0) * mx, py = (lat - lat0) * M_LAT
  let best = [0, Infinity], run = 0
  for (let i = 0; i < line.length - 1; i++) {
    const ax = (line[i][1] - lng0) * mx, ay = (line[i][0] - lat0) * M_LAT
    const bx = (line[i + 1][1] - lng0) * mx, by = (line[i + 1][0] - lat0) * M_LAT
    const dx = bx - ax, dy = by - ay, seg = Math.hypot(dx, dy) || 1e-9
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (seg * seg)))
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
    if (d < best[1]) best = [(run + t * seg) / 1000, d]
    run += seg
  }
  return [Math.round(best[0] * 1000) / 1000, Math.round(best[1] * 10) / 10]
}
const BIN = 0.5
function bins(L) {
  const n = Math.max(1, Math.ceil(L / BIN - 1e-9))
  return Array.from({ length: n }, (_, i) => [+(i * BIN).toFixed(3), +Math.min((i + 1) * BIN, L).toFixed(3)])
}
function mergeRanges(rs) {
  const out = []
  for (const [a, b] of [...rs].sort((x, y) => x[0] - y[0] || x[1] - y[1])) {
    if (out.length && Math.abs(out[out.length - 1][1] - a) < 1e-6) out[out.length - 1][1] = b
    else out.push([a, b])
  }
  return out
}
const fmtRanges = (rs) => rs.map(([a, b]) => `${a.toFixed(1)}–${b.toFixed(1)}`).join(', ')

// ---------- workflow ----------
const OPEN_VERIFIED = new Set(['VERIFIED', 'ACTION_ASSIGNED', 'RECTIFIED'])
const OPEN_UNVERIFIED = new Set(['REPORTED', 'ACKNOWLEDGED', 'UNDER_EXAMINATION', 'APPEALED'])
const TERMINAL = new Set(['CLOSED', 'NOT_SUBSTANTIATED'])
const STATUS_LABEL = {
  REPORTED: 'Reported (not yet verified)', ACKNOWLEDGED: 'Acknowledged', UNDER_EXAMINATION: 'Under technical examination',
  VERIFIED: 'Verified defect', NOT_SUBSTANTIATED: 'Examined: not substantiated', ACTION_ASSIGNED: 'Action assigned',
  RECTIFIED: 'Repair submitted, awaiting independent re-inspection', CLOSED: 'Closed after independent re-inspection',
  APPEALED: "Reopened on the resident's appeal",
}
const DELAY_REASONS = {
  LAND: 'Land / encroachment', UTILITY: 'Utility shifting', FUNDS: 'Fund release pending', CONTRACTOR: 'Contractor capacity',
  DESIGN_CHANGE: 'Design change / revised estimate', FLOOD_SEASON: 'Flood / monsoon', MATERIAL: 'Material shortage', OTHER: 'Other',
}
const ENGINEERS = ['JE', 'AE', 'EE'], TECHNICAL = ['AE', 'EE']
const RULES = {
  acknowledge: { from: ['REPORTED'], to: 'ACKNOWLEDGED', roles: ENGINEERS },
  examine: { from: ['ACKNOWLEDGED', 'APPEALED'], to: 'UNDER_EXAMINATION', roles: ENGINEERS },
  verify: { from: ['UNDER_EXAMINATION'], to: 'VERIFIED', roles: TECHNICAL, evidence: true, note: true },
  reject: { from: ['UNDER_EXAMINATION'], to: 'NOT_SUBSTANTIATED', roles: TECHNICAL, evidence: true, note: true },
  assign: { from: ['VERIFIED'], to: 'ACTION_ASSIGNED', roles: [...TECHNICAL, 'DM', 'DDC'], owner: true },
  rectified: { from: ['ACTION_ASSIGNED'], to: 'RECTIFIED', roles: ['JE', 'CONTRACTOR', 'CO', 'BDO'], evidence: true },
  close: { from: ['RECTIFIED'], to: 'CLOSED', roles: TECHNICAL, evidence: true },
  reopen: { from: ['RECTIFIED'], to: 'ACTION_ASSIGNED', roles: TECHNICAL, evidence: true, note: true },
  direct: { from: ['ACTION_ASSIGNED'], to: 'ACTION_ASSIGNED', roles: ['DM', 'DDC'], note: true },
}
const EVIDENCE_PURPOSES = {
  verify: ['inspection', 'test_report', 'reinspection'], reject: ['inspection', 'reinspection'],
  rectified: ['rectification', 'progress', 'completion', 'document'], close: ['reinspection', 'inspection'], reopen: ['reinspection', 'inspection'],
}
const MAX_APPEALS = 2, APPEAL_DAYS = 30
class ApiError extends Error { constructor(message, status = 400, extra = null) { super(message); this.status = status; this.extra = extra } }

// ---------- evidence validator (mirror of backend/app/evidence.py) ----------
function requireEvidence(evidenceId, work, { purposes, actor = null, byActor = false, roles = null, stageId = null, notIds = [], notLike = [], after = null, what = 'this step' }) {
  if (evidenceId == null || evidenceId === '') throw new ApiError(`Attach evidence for ${what}`)
  const ev = byId('evidence', Number(evidenceId))
  if (!ev) throw new ApiError(`Evidence ${evidenceId} does not exist`)
  if (ev.work_id !== work.id) throw new ApiError('That evidence belongs to another work')
  if (ev.source !== 'officer' || ev.purpose === 'citizen_report') throw new ApiError("A resident's upload is an allegation, not engineering verification")
  if (!purposes.includes(ev.purpose)) throw new ApiError(`Evidence filed as '${ev.purpose}' cannot support ${what}`)
  if (stageId != null && ev.stage_id != null && ev.stage_id !== stageId) throw new ApiError('That evidence is filed under a different stage')
  if (byActor && actor && ev.uploaded_by !== actor.id) throw new ApiError(`For ${what} you must attach evidence you captured yourself`)
  if (roles) { const up = ev.uploaded_by ? byId('officers', ev.uploaded_by) : null; if (!up || !roles.includes(up.role)) throw new ApiError(`Evidence for ${what} must come from ${[...roles].sort().join(' / ')}`) }
  if (notIds.includes(ev.id)) throw new ApiError('The same evidence cannot be reused for an independent check')
  for (const o of notLike) {
    if (!o) continue
    if (ev.sha256 && o.sha256 && ev.sha256 === o.sha256) throw new ApiError('This is the same file as the earlier evidence; take a fresh photo on site')
    if (ev.phash && o.phash && hamming(ev.phash, o.phash) <= PHASH_MAX) throw new ApiError('This photo is (near-)identical to the earlier evidence; take a fresh photo on site')
  }
  if (after && ev.uploaded_at && ev.uploaded_at < after) throw new ApiError(`Evidence for ${what} must be captured after the previous step`)
  return ev
}
const lastEvent = (issue, action) => db.events.filter(e => e.issue_id === issue.id && e.action === action).sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id)[0] || null

function availableActions(issue, officer) {
  if (!officer) return []
  const out = []
  for (const [name, r] of Object.entries(RULES)) {
    if (!r.from.includes(issue.status)) continue
    if (name === 'rectified') { if (officer.id !== issue.owner_id && !['JE', 'CONTRACTOR'].includes(officer.role)) continue }
    else if (!r.roles.includes(officer.role)) continue
    if ((name === 'close' || name === 'reopen') && officer.id === issue.rectified_by) continue
    if (issue.appeals && officer.id === issue.decided_by && ['examine', 'verify', 'reject'].includes(name)) continue
    out.push(name)
  }
  return out
}
function log(issue, action, actor, from, to, note = '', evidence_id = null) {
  insert('events', { issue_id: issue.id, at: nowStamp(), actor_id: actor?.id ?? null, actor_label: actor ? `${actor.role} ${actor.name}` : 'Resident',
    action, from_status: from, to_status: to, note, evidence_id })
}
function transition(issue, action, actor, { note = '', evidence_id = null, owner_id = null, due_date = null, expected_status = null } = {}) {
  const rule = RULES[action]
  if (!rule) throw new ApiError(`Unknown action '${action}'`)
  if (expected_status && issue.status !== expected_status) throw new ApiError(`This issue changed to '${STATUS_LABEL[issue.status]}' since you opened it; refresh and try again`, 409)
  if (!availableActions(issue, actor).includes(action)) {
    if (!rule.from.includes(issue.status)) throw new ApiError(`Cannot '${action}' an issue that is ${issue.status}`, 409)
    if ((action === 'close' || action === 'reopen') && actor.id === issue.rectified_by) throw new ApiError('The person who reported the repair cannot re-inspect it', 403)
    throw new ApiError(`${actor.role} is not permitted to '${action}' this issue`, 403)
  }
  if (rule.note && !note.trim()) throw new ApiError('A written note/finding is required for this step')
  const work = byId('works', issue.work_id)
  if (rule.evidence) {
    const kw = { purposes: EVIDENCE_PURPOSES[action], actor, what: `'${action}'` }
    if (action === 'verify' || action === 'reject') kw.roles = ENGINEERS
    if (action === 'close' || action === 'reopen') {
      const rect = lastEvent(issue, 'rectified'), rectEv = rect?.evidence_id ? byId('evidence', rect.evidence_id) : null
      if (rectEv && rectEv.uploaded_by === actor.id) throw new ApiError('You supplied the repair evidence, so another officer must re-inspect it', 403)
      Object.assign(kw, { byActor: true, roles: TECHNICAL, notIds: rectEv ? [rectEv.id] : [], notLike: [rectEv], after: rect?.at ?? null, what: 'the re-inspection after repair' })
    }
    if (action === 'rectified' && actor.role === 'CONTRACTOR') kw.byActor = true
    const ev = requireEvidence(evidence_id, work, kw)
    ev.issue_id = issue.id
  }
  if (action === 'acknowledge') { issue.owner_id = owner_id || work.ae_id; issue.due_date = due_date || addDays(TODAY, 7) }
  else if (action === 'examine') issue.owner_id = TECHNICAL.includes(actor.role) ? actor.id : (issue.owner_id || work.ae_id)
  else if (action === 'verify') { issue.finding = note; issue.owner_id = work.ee_id; issue.due_date = addDays(TODAY, 3) }
  else if (action === 'reject') { issue.finding = note; issue.owner_id = null; issue.due_date = null; issue.decided_by = actor.id; issue.closed_at = nowStamp() }
  else if (action === 'assign') {
    if (!owner_id || !due_date) throw new ApiError('Assigning action needs an owner and a due date')
    const owner = byId('officers', Number(owner_id))
    if (!owner) throw new ApiError('Unknown owner')
    if (owner.role === 'CONTRACTOR' && owner.id !== work.contractor_id) throw new ApiError("Repairs can only be assigned to this work's own contractor")
    if (TODAY > due_date) throw new ApiError('The due date cannot be in the past')
    issue.owner_id = owner.id; issue.due_date = due_date; issue.rectified_by = null
  } else if (action === 'reopen') {
    const fixer = lastEvent(issue, 'rectified')
    issue.owner_id = fixer?.actor_id || work.contractor_id || work.je_id; issue.due_date = due_date || addDays(TODAY, 10); issue.rectified_by = null
  } else if (action === 'direct') {
    if (!due_date || due_date <= TODAY) throw new ApiError('Give the new deadline (a future date)')
    if (owner_id) { if (!byId('officers', Number(owner_id))) throw new ApiError('Unknown owner'); issue.owner_id = Number(owner_id) }
    issue.due_date = due_date
  } else if (action === 'rectified') { issue.rectified_by = actor.id; issue.owner_id = work.ae_id !== actor.id ? work.ae_id : work.ee_id; issue.due_date = addDays(TODAY, 5) }
  else if (action === 'close') { issue.owner_id = null; issue.due_date = null; issue.decided_by = actor.id; issue.closed_at = nowStamp() }
  const from = issue.status
  issue.status = rule.to
  log(issue, action, actor, from, issue.status, note, evidence_id == null || evidence_id === '' ? null : Number(evidence_id))
  notifyStatus(issue)
  return issue
}
function appeal(issue, reason) {
  if (issue.source !== 'citizen') throw new ApiError('Only resident reports can be appealed', 404)
  if (!TERMINAL.has(issue.status)) throw new ApiError('This report is still open; an appeal is only for a closed decision', 409)
  if ((reason || '').trim().length < 10) throw new ApiError('Tell us in a sentence what is still wrong')
  if ((issue.appeals || 0) >= MAX_APPEALS) throw new ApiError('This report has already been appealed the maximum number of times; contact the district office', 409)
  if (issue.closed_at && days(issue.closed_at.slice(0, 10), TODAY) > APPEAL_DAYS) throw new ApiError(`Appeals must be made within ${APPEAL_DAYS} days of the decision`, 409)
  const work = byId('works', issue.work_id), from = issue.status
  issue.status = 'APPEALED'; issue.appeals = (issue.appeals || 0) + 1; issue.owner_id = work.ee_id; issue.due_date = addDays(TODAY, 7)
  log(issue, 'appeal', null, from, 'APPEALED', reason.trim().slice(0, 1000), null)
  notifyStatus(issue)
  return issue
}

// ---------- SMS to residents (simulated) ----------
const SMS = {
  REPORTED: ['Your report {t} on {w} is registered. The Junior Engineer will look at it within 3 days.', '{w} पर आपकी शिकायत {t} दर्ज हो गई है। कनीय अभियंता 3 दिनों में देखेंगे।'],
  ACKNOWLEDGED: ['{t}: the engineer has seen your report and will examine it on site.', '{t}: अभियंता ने आपकी शिकायत देख ली है, स्थल पर जाँच होगी।'],
  UNDER_EXAMINATION: ['{t}: technical examination has started.', '{t}: तकनीकी जाँच शुरू हो गई है।'],
  VERIFIED: ['{t}: the engineer confirmed the problem. A repair will be assigned.', '{t}: अभियंता ने समस्या सही पाई। मरम्मत का काम सौंपा जाएगा।'],
  NOT_SUBSTANTIATED: ['{t}: on inspection the problem was not confirmed. You can see the reason on the tracking page.', '{t}: जाँच में समस्या की पुष्टि नहीं हुई। कारण ट्रैकिंग पेज पर देखें।'],
  ACTION_ASSIGNED: ['{t}: repair assigned, to be done by {d}.', '{t}: मरम्मत सौंपी गई, {d} तक पूरी होनी है।'],
  RECTIFIED: ['{t}: repair reported done. The engineer will check it.', '{t}: मरम्मत पूरी बताई गई। अभियंता इसकी जाँच करेंगे।'],
  CLOSED: ['{t}: repair checked and closed. Thank you for reporting.', '{t}: मरम्मत की जाँच कर मामला बंद। सूचना देने के लिए धन्यवाद।'],
  APPEALED: ['{t}: your appeal is registered. A different officer will examine it.', '{t}: आपकी अपील दर्ज हुई। कोई दूसरा अधिकारी इसकी जाँच करेगा।'],
}
const fill = (s, v) => s.replace('{t}', v.t).replace('{w}', v.w).replace('{d}', v.d)
function recipients(issue) {
  const phones = issue.complainant_phone ? [issue.complainant_phone] : []
  for (const n of db.notifications.filter(n => n.ticket === issue.ticket)) if (!phones.includes(n.phone)) phones.push(n.phone)
  return phones
}
const sendSms = (ticket, phone, en, hn) => insert('notifications', { ticket, phone, text: 'Kaarya Nigrani: ' + en, text_hi: 'कार्य निगरानी: ' + hn, sent_at: nowStamp() })
function notifyStatus(issue) {
  if (issue.source !== 'citizen' || !SMS[issue.status]) return
  const w = byId('works', issue.work_id), v = { t: issue.ticket, w: w.name, d: issue.due_date ? dmy(issue.due_date) : '' }
  for (const ph of recipients(issue)) sendSms(issue.ticket, ph, fill(SMS[issue.status][0], v), fill(SMS[issue.status][1], v))
}
function randomKey() {
  const b = new Uint8Array(9); (globalThis.crypto || {}).getRandomValues?.(b)
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const mask = (phone) => { const d = phone.replace(/\D/g, ''); return d.length >= 6 ? `${d.slice(0, 2)}XXXXXX${d.slice(-2)}` : 'XXXX' }
function createIssue({ work, actor, source, category, title, description = '', stage_id = null, reason_code = null,
  evidence_id = null, owner_id = null, due_date = null, complainant_name = null, complainant_phone = null }) {
  if (category === 'delay' && !DELAY_REASONS[reason_code]) throw new ApiError('Delay issues need a valid reason code')
  if (!['quality', 'usability', 'delay', 'safety'].includes(category)) throw new ApiError('Unknown category')
  if (!(title || '').trim()) throw new ApiError('Give the issue a short title')
  evidence_id = evidence_id == null || evidence_id === '' ? null : Number(evidence_id)
  if (evidence_id != null && actor) requireEvidence(evidence_id, work, { purposes: ['inspection', 'test_report', 'reinspection', 'progress'], roles: [...ENGINEERS, 'CO', 'BDO'], what: 'this finding' })
  let status = 'REPORTED', finding = null
  if (actor && TECHNICAL.includes(actor.role) && evidence_id != null) { status = 'VERIFIED'; finding = description }
  else if (actor && category === 'delay' && ENGINEERS.includes(actor.role)) status = 'VERIFIED'
  const issue = insert('issues', {
    ticket: `KGR-${TODAY.slice(0, 4)}-${String(nextId.issues).padStart(4, '0')}`, work_id: work.id, stage_id, source, category,
    reason_code, title, description, status, finding, created_at: nowStamp(), complainant_name, complainant_phone, owner_id, due_date, rectified_by: null,
    track_key: source === 'citizen' ? randomKey() : null, decided_by: null, appeals: 0, closed_at: null, supporters: 0,
  })
  if (status === 'VERIFIED' && owner_id == null) { issue.owner_id = work.ee_id; issue.due_date = addDays(TODAY, 3) }
  if (status === 'REPORTED') { issue.owner_id = work.je_id; issue.due_date = addDays(TODAY, 3) }
  if (evidence_id != null) { const ev = byId('evidence', evidence_id); if (ev) ev.issue_id = issue.id }
  log(issue, 'create', actor, null, status, description, evidence_id)
  return issue
}
function escalation(issue, work, today = TODAY) {
  if (TERMINAL.has(issue.status) || !issue.due_date || issue.due_date >= today) return { days: 0, level: 0, to: null }
  const d = days(issue.due_date, today)
  const owner = issue.owner_id ? byId('officers', issue.owner_id) : null
  const ddc = db.officers.find(o => o.role === 'DDC')
  if (d <= 7 || !owner) return { days: d, level: 1, to: null }
  const sup = { JE: work.ae_id, AE: work.ee_id, CONTRACTOR: work.ee_id }[owner.role]
  if (d <= 14 && sup) return { days: d, level: 2, to: byId('officers', sup) }
  return { days: d, level: 3, to: ddc }
}

// ---------- flags ----------
const SLIP_WARN = 15, SLIP_HIGH = 30, FIN_GAP = 15, STALE_DAYS = 21, ACK_DAYS = 3, REPEAT_N = 3, REPEAT_WINDOW = 60, PHASH_MAX = 4, TEST_DUE_PCT = 50
const HOLDS = { 'Granular sub-base / WBM': 'Earthwork & subgrade', 'Bituminous surface': 'Granular sub-base / WBM', 'Masonry / RCC walls': 'PCC bed',
  'Cover slabs': 'Masonry / RCC walls', Superstructure: 'Foundation', Roofing: 'Superstructure', 'Barrel / slab': 'Foundation' }
function holdPending(stages, tests, stage) {
  const pre = stages.find(s => s.name === HOLDS[stage.name])
  if (!pre) return [null, []]
  return [pre, tests.filter(t => t.stage_id === pre.id && t.passed !== true)]
}
function plannedFraction(s, today) {
  if (today <= s.planned_start) return 0
  if (today >= s.planned_end) return 1
  return days(s.planned_start, today) / (days(s.planned_start, s.planned_end) || 1)
}
const plannedProgress = (stages, today) => round1(stages.reduce((a, s) => a + s.weight * plannedFraction(s, today), 0))
function planDate(work, d) {
  if (!work?.revised_end || work.revised_end <= work.planned_end || d <= work.start_date) return d
  const orig = days(work.start_date, work.planned_end) || 1, nw = days(work.start_date, work.revised_end) || 1
  return addDays(work.start_date, Math.round(days(work.start_date, d) * orig / nw))
}
const dueDate = (w) => w.revised_end || w.planned_end
const actualProgress = (stages) => round1(stages.reduce((a, s) => a + s.weight * s.progress / 100, 0))
function sCurve(stages, start, end, points = 12, work = null) {
  const span = Math.max(days(start, end), 1)
  return Array.from({ length: points + 1 }, (_, i) => { const d = addDays(start, Math.round(span * i / points)); return { date: d, planned: plannedProgress(stages, work ? planDate(work, d) : d) } })
}
const POP = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4]
const hamming = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) n += POP[parseInt(a[i], 16) ^ parseInt(b[i], 16)]; return n }
function dupIndex() {
  const evs = db.evidence.filter(e => e.phash), code = Object.fromEntries(db.works.map(w => [w.id, w.code])), dup = {}
  for (let i = 0; i < evs.length; i++) for (let j = i + 1; j < evs.length; j++) {
    const a = evs[i], b = evs[j]
    if (a.work_id !== b.work_id && hamming(a.phash, b.phash) <= PHASH_MAX) { (dup[a.id] ||= new Set()).add(code[b.work_id]); (dup[b.id] ||= new Set()).add(code[a.work_id]) }
  }
  return dup
}
function specText(t, inHindi = false) {
  if (t.kind === 'passfail') return inHindi ? 'पास होना आवश्यक' : 'must pass'
  if (t.spec_min != null && t.spec_max != null) return `${g(t.spec_min)}–${g(t.spec_max)} ${t.unit}`
  if (t.spec_min != null) return inHindi ? `न्यूनतम ${g(t.spec_min)} ${t.unit}` : `min ${g(t.spec_min)} ${t.unit}`
  return inHindi ? `अधिकतम ${g(t.spec_max)} ${t.unit}` : `max ${g(t.spec_max)} ${t.unit}`
}
const evaluateTest = (t, r) => t.kind === 'passfail' ? r >= 1 : (t.spec_min == null || r >= t.spec_min) && (t.spec_max == null || r <= t.spec_max)

function stageCoverage(stage, officerEv, mbs, L) {
  if (!stage.linear || !L || stage.qty_executed <= 0) return [officerEv.some(e => e.stage_id === stage.id) ? 1 : 0, [], []]
  const executed = mergeRanges(mbs.filter(m => m.stage_id === stage.id && m.ch_from != null).map(m => [m.ch_from, m.ch_to]))
  const pts = officerEv.filter(e => e.stage_id === stage.id && e.chainage_km != null).map(e => e.chainage_km)
  let total = 0, covered = 0
  const gaps = []
  for (const [a, b] of bins(L)) {
    const pieces = executed.filter(([x, y]) => Math.min(b, y) > Math.max(a, x) + 1e-6).map(([x, y]) => [Math.max(a, x), Math.min(b, y)])
    if (!pieces.length) continue
    const overlap = pieces.reduce((s, [x, y]) => s + y - x, 0)
    total += overlap
    if (pts.some(p => a - 1e-6 <= p && p <= b + 1e-6)) covered += overlap
    else gaps.push(...pieces)
  }
  return [total ? covered / total : 0, mergeRanges(gaps), executed]
}

const flag = (code, severity, message, message_hi, role, owner_id = null) => ({ code, severity, message, message_hi, next_action_by: role, owner_id })

function workFlags(work, today, dup) {
  const stages = db.stages.filter(s => s.work_id === work.id).sort((a, b) => a.seq - b.seq)
  const evidence = db.evidence.filter(e => e.work_id === work.id)
  const issues = db.issues.filter(i => i.work_id === work.id)
  const checklist = db.checklist.filter(c => c.work_id === work.id)
  const mbs = db.measurements.filter(m => m.work_id === work.id)
  const bills = db.bills.filter(b => b.work_id === work.id)
  const tests = db.tests.filter(t => t.work_id === work.id)
  const planned = plannedProgress(stages, planDate(work, today)), actual = actualProgress(stages)
  const financial = paidPct(bills, work.sanctioned_lakh)
  const check_measured = checkMeasured(stages, mbs)
  const lastRep = db.reports.filter(r => r.work_id === work.id).sort((a, b) => b.report_date.localeCompare(a.report_date) || b.id - a.id)[0]
  const reported = lastRep ? lastRep.physical_pct : 0
  const officerEv = evidence.filter(e => e.source === 'officer')
  const flags = [], coverage = {}
  const active = ['SANCTIONED', 'IN_PROGRESS'].includes(work.status)

  let evidenced = 0
  for (const s of stages) {
    const [frac, gaps, executed] = stageCoverage(s, officerEv, mbs, work.length_km)
    coverage[s.id] = { covered: Math.round(frac * 1000) / 1000, gaps, executed }
    evidenced += s.weight * s.progress / 100 * frac
    const sh = hi('stage', s.name)
    if (s.progress > 0 && frac === 0) flags.push(flag('STAGE_NO_EVIDENCE', 2, `Stage '${s.name}' reported ${Math.round(s.progress)}% done with no site evidence.`, `चरण '${sh}' ${Math.round(s.progress)}% पूरा बताया गया, पर कोई साइट साक्ष्य नहीं।`, 'JE'))
    else if (gaps.length) flags.push(flag('EVIDENCE_GAP', 2, `'${s.name}': no site photo for km ${fmtRanges(gaps)} of the measured stretch.`, `'${sh}': मापे गए हिस्से में किमी ${fmtRanges(gaps)} की कोई साइट फोटो नहीं।`, 'JE'))
  }
  evidenced = round1(evidenced)

  if (active) {
    const slip = planned - actual
    if (slip >= SLIP_WARN) {
      const d = issues.find(i => i.category === 'delay' && !TERMINAL.has(i.status))
      const holder = d?.owner_id ? byId('officers', d.owner_id) : null
      flags.push(flag('SCHEDULE_SLIP', slip >= SLIP_HIGH ? 3 : 2,
        `Behind plan by ${Math.round(slip)} points (planned ${Math.round(planned)}%, actual ${Math.round(actual)}%).` + (d ? ` Recorded hold-up: ${d.title}.` : ' No hold-up reason recorded.'),
        `योजना से ${Math.round(slip)} अंक पीछे (नियोजित ${Math.round(planned)}%, वास्तविक ${Math.round(actual)}%)।` + (d ? ` दर्ज बाधा: ${hi('reason', d.reason_code)}।` : ' कोई बाधा कारण दर्ज नहीं।'),
        holder ? holder.role : 'JE', holder?.id))
    }
    if (today > dueDate(work)) {
      const n = days(dueDate(work), today), ext = work.revised_end ? ' (after time extension)' : '', exh = work.revised_end ? ' (समय-वृद्धि के बाद भी)' : ''
      flags.push(flag('PAST_DEADLINE', 3, `Past scheduled completion by ${n} days${ext}.`, `निर्धारित समाप्ति तिथि से ${n} दिन अधिक हो गए${exh}।`, 'EE'))
    }
    const last = officerEv.map(e => e.captured_at.slice(0, 10)).sort().pop()
    if (days(work.start_date, today) > STALE_DAYS && (!last || days(last, today) > STALE_DAYS)) {
      if (!last) flags.push(flag('STALE_EVIDENCE', 1, 'In progress but no site evidence ever uploaded.', 'काम चल रहा है, पर अब तक कोई साइट साक्ष्य नहीं।', 'JE'))
      else { const n = days(last, today); flags.push(flag('STALE_EVIDENCE', 1, `In progress but no site evidence for ${n} days.`, `काम चल रहा है, पर ${n} दिनों से कोई साइट साक्ष्य नहीं।`, 'JE')) }
    }
  }
  if (financial - evidenced >= FIN_GAP) {
    const same = Math.round(evidenced) === Math.round(actual)
    flags.push(flag('FIN_AHEAD', 3,
      `${Math.round(financial)}% of the money is paid, but only ${Math.round(evidenced)}% of the work ` + (same ? 'is done.' : `has site photos (reported ${Math.round(actual)}%).`),
      `स्वीकृत राशि का ${Math.round(financial)}% भुगतान हो चुका है, पर केवल ${Math.round(evidenced)}% काम ` + (same ? 'हुआ है।' : `का साइट साक्ष्य है (बताया गया ${Math.round(actual)}%)।`), 'EE'))
  }
  const unchecked = new Set(mbs.filter(m => m.checked_by == null).map(m => m.id))
  const bad = bills.filter(b => ['AUTHORIZED', 'PAID'].includes(b.status) && b.mb.some(id => unchecked.has(id)))
  if (bad.length) {
    const nos = bad.map(b => b.bill_no).join(', '), amt = bad.reduce((a, b) => a + b.amount_lakh, 0).toFixed(1)
    flags.push(flag('BILL_UNCHECKED', 3, `${bad.length === 1 ? 'Bill' : 'Bills'} ${nos} (₹${amt} lakh) paid before the AE re-measured the work.`,
      `आरए बिल ${nos} (₹${amt} लाख) का भुगतान उन मापों पर हुआ जिनकी सहायक अभियंता ने जाँच-माप नहीं की।`, 'AE'))
  }
  for (const t of tests) {
    const s = stages.find(x => x.id === t.stage_id)
    if (t.passed === false) {
      const linked = t.issue_id ? byId('issues', t.issue_id) : null
      if (!linked || !TERMINAL.has(linked.status)) flags.push(flag('TEST_FAILED', 3, `${t.name} on '${s.name}' failed: ${g(t.result)} ${t.unit} against ${specText(t)}.`,
        `'${hi('stage', s.name)}' पर ${hi('test', t.name)} विफल: ${g(t.result)} ${t.unit}, मानक ${specText(t, true)}।`, 'EE'))
    }
  }
  for (const s of stages) {
    const missing = tests.filter(t => t.stage_id === s.id && t.result == null)
    if (missing.length && s.progress >= TEST_DUE_PCT) flags.push(flag('TESTS_MISSING', 2,
      `'${s.name}' is ${Math.round(s.progress)}% done but required tests are not on record: ${missing.map(t => t.name).join(', ')}.`,
      `'${hi('stage', s.name)}' ${Math.round(s.progress)}% पूरा, पर आवश्यक परीक्षण दर्ज नहीं: ${missing.map(t => hi('test', t.name)).join(', ')}।`, 'JE'))
  }
  for (const s of stages) {
    const [pre, pending] = holdPending(stages, tests, s)
    if (s.qty_executed > 0 && pending.length) flags.push(flag('HOLD_BYPASSED', 3, `'${s.name}' was started before the tests on '${pre.name}' were passed.`,
      `होल्ड पॉइंट का उल्लंघन: '${hi('stage', pre.name)}' के परीक्षण पास होने से पहले '${hi('stage', s.name)}' की माप दर्ज हुई।`, 'AE'))
  }
  for (const i of issues) {
    const age = days(i.created_at.slice(0, 10), today)
    if (i.source === 'citizen' && i.status === 'REPORTED' && age > ACK_DAYS) flags.push(flag('UNACKED_REPORTS', 2, `Resident report ${i.ticket} unacknowledged for ${age} days.`, `निवासी की शिकायत ${i.ticket} ${age} दिनों से स्वीकार नहीं की गई।`, 'JE'))
    else if (!TERMINAL.has(i.status) && i.due_date && i.due_date < today) {
      const esc = escalation(i, work, today)
      const owner = esc.to || (i.owner_id ? byId('officers', i.owner_id) : null)
      let en = `${i.ticket} '${i.title}' overdue by ${esc.days} days.`, hn = `${i.ticket} '${i.title}' ${esc.days} दिन से लंबित।`
      if (esc.to) { en += ` Escalated to ${owner.role} ${owner.name}.`; hn += ` ${hi('role', owner.role)} ${owner.name} तक बढ़ाया गया।` }
      flags.push(flag('OVERDUE_ACTION', 2, en, hn, owner ? owner.role : 'EE', owner?.id))
    }
  }
  const recent = issues.filter(i => i.source === 'citizen' && days(i.created_at.slice(0, 10), today) <= REPEAT_WINDOW)
  if (recent.length >= REPEAT_N) flags.push(flag('REPEAT_COMPLAINTS', 2, `${recent.length} resident reports in the last ${REPEAT_WINDOW} days.`, `पिछले ${REPEAT_WINDOW} दिनों में ${recent.length} निवासी शिकायतें।`, 'AE'))
  if (work.status === 'REPORTED_COMPLETE') {
    const unchk = checklist.filter(c => c.passed !== true).map(c => c.item)
    const defects = issues.filter(i => OPEN_VERIFIED.has(i.status))
    const reports = issues.filter(i => !TERMINAL.has(i.status) && !OPEN_VERIFIED.has(i.status))
    if (unchk.length || defects.length || reports.length) {
      const en = [], hn = []
      if (unchk.length) { en.push(`usability items not passed: ${unchk.join(', ')}`); hn.push(`उपयोगिता जाँच बाकी: ${unchk.map(c => hi('check', c)).join(', ')}`) }
      if (defects.length) { en.push(`${defects.length} verified defect(s) open`); hn.push(`${defects.length} सत्यापित दोष खुले`) }
      if (reports.length) { en.push(`${reports.length} resident report(s) not yet examined`); hn.push(`${reports.length} निवासी शिकायतों की जाँच बाकी`) }
      flags.push(flag('COMPLETE_NOT_USABLE', 3, `Claimed complete, but ${en.join('; ')}.`, `पूरा बताया गया, पर ${hn.join('; ')}।`, 'EE'))
    }
  }
  for (const pc of db.postchecks.filter(x => x.work_id === work.id)) {
    if (!pc.done_on && pc.due_date < today) {
      const n = days(pc.due_date, today)
      flags.push(flag('POSTCHECK_OVERDUE', 2, `Post-monsoon re-check was due ${dmy(pc.due_date)} and is ${n} days late.`, `मानसून बाद की पुनः जाँच ${dmy(pc.due_date)} तक होनी थी, ${n} दिन देर।`, 'AE'))
    } else if (pc.done_on && pc.passed === false) flags.push(flag('POSTCHECK_FAILED', 3, `Post-monsoon re-check found problems: ${pc.note}`, `मानसून बाद की जाँच में समस्या मिली: ${pc.note}`, 'EE'))
  }
  if (work.status === 'USABLE_VERIFIED') {
    const recent = db.votes.filter(v => v.work_id === work.id && days(v.at.slice(0, 10), today) <= 90)
    const no = recent.filter(v => !v.usable).length
    if (no >= 2 && no / recent.length >= 0.2) flags.push(flag('RESIDENTS_NOT_USABLE', 2, `${no} of ${recent.length} residents say this work is not usable for them (last 90 days).`,
      `पिछले 90 दिनों में ${recent.length} में से ${no} निवासियों ने कहा कि यह कार्य उनके काम का नहीं।`, 'AE'))
  }
  for (const e of evidence) {
    if (dup[e.id]) { const c = [...dup[e.id]].sort().join(', '); flags.push(flag('DUPLICATE_PHOTO', 3, `Photo '${e.caption}' matches a photo filed under ${c}.`, `फोटो '${e.caption}' कार्य ${c} में लगी फोटो से मेल खाती है।`, 'AE')) }
    if (e.source === 'officer' && e.in_geofence === false) flags.push(flag('OUTSIDE_SITE', 2, `Photo '${e.caption}' was geotagged outside the work site.`, `फोटो '${e.caption}' कार्य स्थल से बाहर जियोटैग हुई।`, 'AE'))
  }
  const byRole = { JE: work.je_id, AE: work.ae_id, EE: work.ee_id }
  for (const f of flags) { const oid = f.owner_id || byRole[f.next_action_by]; delete f.owner_id; f.next_person = oid ? byId('officers', oid)?.name : null }
  flags.sort((a, b) => b.severity - a.severity)
  return { planned, actual, evidenced, financial, reported, check_measured, flags, score: flags.reduce((a, f) => a + f.severity, 0), coverage }
}
function checkMeasured(stages, mbs) {
  let tot = 0
  for (const s of stages) {
    const chk = mbs.filter(m => m.stage_id === s.id && m.checked_by != null).reduce((a, m) => a + m.qty, 0)
    tot += s.weight * Math.min(1, s.qty_sanctioned ? chk / s.qty_sanctioned : 0)
  }
  return round1(tot)
}
function paidPct(bills, sanctioned) {
  const paid = bills.filter(b => b.status === 'PAID').reduce((a, b) => a + (b.paid_lakh || 0), 0)
  return paid && sanctioned ? round1(Math.min(100, paid / sanctioned * 100)) : 0
}

// ---------- certification eligibility (mirror of backend/app/certification.py) ----------
const CHECKLIST_PURPOSES = ['inspection', 'completion', 'reinspection']
const blk = (code, message, message_hi, extra = {}) => ({ code, message, message_hi, ...extra })
const r2 = (x) => Math.round(x * 100) / 100
const short = (done, req) => r2(done) < r2(req)
function claimBlockers(work) {
  const stages = db.stages.filter(s => s.work_id === work.id).sort((a, b) => a.seq - b.seq), out = []
  if (work.status !== 'IN_PROGRESS') out.push(blk('STATUS', `Work is ${work.status}; only a work in progress can be claimed complete.`, 'केवल चालू कार्य को पूरा बताया जा सकता है।'))
  for (const s of stages) if (short(s.qty_executed, s.qty_sanctioned)) out.push(blk('STAGE_NOT_MEASURED', `'${s.name}': ${g(s.qty_executed)} of ${g(s.qty_sanctioned)} ${s.unit} measured.`, `'${hi('stage', s.name)}': ${g(s.qty_sanctioned)} में से ${g(s.qty_executed)} ${s.unit} मापा गया।`, { stage_id: s.id }))
  return out
}
function certBlockers(work, actor = null, checkStatus = true) {
  const stages = db.stages.filter(s => s.work_id === work.id).sort((a, b) => a.seq - b.seq)
  const mbs = db.measurements.filter(m => m.work_id === work.id), tests = db.tests.filter(t => t.work_id === work.id)
  const issues = db.issues.filter(i => i.work_id === work.id), items = db.checklist.filter(c => c.work_id === work.id).sort((a, b) => a.id - b.id)
  const officerEv = db.evidence.filter(e => e.work_id === work.id && e.source === 'officer'), out = []
  if (checkStatus && work.status !== 'REPORTED_COMPLETE') out.push(blk('STATUS', work.status === 'IN_PROGRESS' ? 'The JE has not claimed this work complete.' : `Work is ${work.status}.`, 'कनीय अभियंता ने कार्य पूरा नहीं बताया है।'))
  if (actor && (actor.role !== 'EE' || work.ee_id !== actor.id)) out.push(blk('AUTHORITY', 'Only the Executive Engineer in charge of this work can certify it.', 'केवल इस कार्य के प्रभारी कार्यपालक अभियंता प्रमाणित कर सकते हैं।'))
  for (const s of stages) {
    const sh = hi('stage', s.name)
    if (short(s.qty_executed, s.qty_sanctioned)) out.push(blk('STAGE_INCOMPLETE', `'${s.name}': ${g(s.qty_executed)} of ${g(s.qty_sanctioned)} ${s.unit} measured.`, `'${sh}': ${g(s.qty_sanctioned)} में से ${g(s.qty_executed)} ${s.unit} मापा गया।`, { stage_id: s.id }))
    const chk = mbs.filter(m => m.stage_id === s.id && m.checked_by != null).reduce((a, m) => a + m.qty, 0)
    if (short(chk, s.qty_sanctioned) && !short(s.qty_executed, s.qty_sanctioned)) out.push(blk('NOT_CHECK_MEASURED', `'${s.name}': only ${g(chk)} of ${g(s.qty_sanctioned)} ${s.unit} check-measured by the AE.`, `'${sh}': ${g(s.qty_sanctioned)} में से केवल ${g(chk)} ${s.unit} की जाँच-माप हुई।`, { stage_id: s.id }))
    const [frac, gaps] = stageCoverage(s, officerEv, mbs, work.length_km)
    if (s.qty_executed > 0 && (frac === 0 || gaps.length)) out.push(blk('EVIDENCE_MISSING', `'${s.name}': site evidence missing` + (gaps.length ? ' for part of the measured stretch.' : '.'), `'${sh}': साइट साक्ष्य नहीं` + (gaps.length ? ' (मापे गए हिस्से के कुछ भाग)।' : '।'), { stage_id: s.id }))
  }
  for (const t of tests) {
    if (t.result == null) out.push(blk('TEST_MISSING', `Required test not on record: ${t.name}.`, `आवश्यक परीक्षण दर्ज नहीं: ${hi('test', t.name)}।`, { test_id: t.id }))
    else if (t.passed !== true) out.push(blk('TEST_FAILED', `${t.name} does not meet specification; retest after rectification.`, `${hi('test', t.name)} मानक पर खरा नहीं; सुधार के बाद पुनः परीक्षण करें।`, { test_id: t.id }))
  }
  const open = issues.filter(i => !TERMINAL.has(i.status))
  if (open.length) out.push(blk('OPEN_ISSUES', `${open.length} issue(s) still open: ${open.slice(0, 5).map(i => i.ticket).join(', ')}.`, `${open.length} मामले अभी खुले हैं।`))
  if (!items.length) out.push(blk('NO_CHECKLIST', 'No usability checklist for this work.', 'उपयोगिता जाँच-सूची नहीं है।'))
  for (const c of items) {
    if (c.passed !== true) { out.push(blk('CHECK_NOT_PASSED', `Usability not passed: ${c.item}.`, `उपयोगिता जाँच बाकी: ${hi('check', c.item)}।`, { item_id: c.id })); continue }
    const ev = c.evidence_id ? byId('evidence', c.evidence_id) : null, up = ev?.uploaded_by ? byId('officers', ev.uploaded_by) : null
    if (!ev || ev.work_id !== work.id || ev.source !== 'officer' || !up || !TECHNICAL.includes(up.role)) out.push(blk('CHECK_BAD_EVIDENCE', `Usability item '${c.item}' has no valid AE/EE evidence on this work.`, `उपयोगिता बिंदु '${hi('check', c.item)}' का वैध साक्ष्य नहीं।`, { item_id: c.id }))
  }
  return out
}
function financialStatus(work) {
  const bills = db.bills.filter(b => b.work_id === work.id)
  const sum = (st) => r2(bills.filter(b => st.includes(b.status)).reduce((a, b) => a + b.amount_lakh, 0))
  const paid = r2(bills.filter(b => b.status === 'PAID').reduce((a, b) => a + (b.paid_lakh || 0), 0))
  const by = (f) => r2(bills.filter(b => b[f] != null).reduce((a, b) => a + b.amount_lakh, 0))
  return { sanctioned_lakh: work.sanctioned_lakh, submitted_lakh: sum(['SUBMITTED', 'CHECKED', 'AUTHORIZED', 'PAID']), checked_lakh: by('checked_by'),
    authorized_lakh: by('authorized_by'), paid_lakh: paid, liability_lakh: sum(['CHECKED', 'AUTHORIZED']), pending_check_lakh: sum(['SUBMITTED']),
    paid_pct: work.sanctioned_lakh ? round1(Math.min(100, paid / work.sanctioned_lakh * 100)) : 0, verified_source: false,
    sources: [...new Set(bills.map(b => b.payment_source).filter(Boolean))].sort() }
}
function readiness(work) {
  const b = certBlockers(work)
  return { eligible: !b.length, blockers: b, claim_blockers: work.status === 'IN_PROGRESS' ? claimBlockers(work) : [],
    scope_revised: db.revisions.some(r => r.work_id === work.id), financial: financialStatus(work) }
}
function auditRecord(work_id, entity, entity_id, action, actor, before = {}, after = {}, reason = '', evidence_id = null) {
  insert('audit', { work_id, entity, entity_id, action, actor_id: actor?.id ?? null, actor_role: actor?.role ?? null,
    before: JSON.stringify(before), after: JSON.stringify(after), reason, evidence_id, at: nowStamp() })
}
const auditHistory = (work_id) => db.audit.filter(a => a.work_id === work_id).sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id)
  .map(a => ({ id: a.id, entity: a.entity, entity_id: a.entity_id, action: a.action, actor_id: a.actor_id, actor_role: a.actor_role,
    before: JSON.parse(a.before || '{}'), after: JSON.parse(a.after || '{}'), reason: a.reason, evidence_id: a.evidence_id, at: a.at }))

// ---------- views ----------
const brief = (id) => { const o = id ? byId('officers', id) : null; return o ? { id: o.id, name: o.name, role: o.role, department: o.department } : null }
const evDict = (e, pub = false) => ({
  id: e.id, stage_id: e.stage_id, issue_id: e.issue_id, kind: e.kind, caption: e.caption, url: e.dataUrl || (e.file ? (MEDIA[e.file] ?? `media/${e.file}`) : null),
  captured_at: e.captured_at, source: e.source, in_geofence: e.in_geofence, chainage_km: e.chainage_km ?? null, purpose: e.purpose, coord_source: e.coord_source,
  ...(pub ? {} : { lat: e.lat, lng: e.lng, uploaded_by: e.uploaded_by, uploader_role: e.uploader_role, uploaded_at: e.uploaded_at || null, sha256: e.sha256 || null }),
})
function issueDict(i, viewer, pub = false, showPerson = true) {
  const events = db.events.filter(e => e.issue_id === i.id).sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id)
  const d = {
    id: i.id, ticket: i.ticket, work_id: i.work_id, stage_id: i.stage_id, source: i.source, category: i.category, reason_code: i.reason_code,
    reason_label: i.reason_code ? DELAY_REASONS[i.reason_code] : null, reason_label_hi: i.reason_code ? hi('reason', i.reason_code) : null,
    title: i.title, description: i.description, status: i.status, status_label: STATUS_LABEL[i.status],
    verified: OPEN_VERIFIED.has(i.status) || i.status === 'CLOSED', finding: i.finding, created_at: i.created_at, due_date: i.due_date,
    appealable: !!(i.source === 'citizen' && TERMINAL.has(i.status) && (i.appeals || 0) < MAX_APPEALS && (!i.closed_at || days(i.closed_at.slice(0, 10), TODAY) <= APPEAL_DAYS)),
    supporters: i.supporters || 0, appeals: i.appeals || 0, voice: (pub || !showPerson) ? null : (db.evidence.find(e => e.issue_id === i.id && e.kind === 'voice')?.dataUrl ?? null),
    overdue: !!(i.due_date && i.due_date < TODAY && !TERMINAL.has(i.status)),
    events: events.map(e => ({ at: e.at, action: e.action, to_status: e.to_status, to_label: STATUS_LABEL[e.to_status], note: e.note,
      evidence_id: e.evidence_id, actor: pub && e.actor_id ? e.actor_label.split(' ')[0] : e.actor_label })),
  }
  if (pub) d.owner_role = i.owner_id ? brief(i.owner_id).role : null
  else {
    const esc = escalation(i, byId('works', i.work_id))
    Object.assign(d, { owner: brief(i.owner_id), complainant_name: showPerson ? i.complainant_name : null, complainant_phone: showPerson ? i.complainant_phone : null,
      actions: availableActions(i, viewer), overdue_days: esc.days, escalated_to: esc.to ? brief(esc.to.id) : null })
  }
  return d
}
function workSummary(w, dup, viewer = null, lvl = 'full') {
  const f = workFlags(w, TODAY, dup)
  if (viewer) { f.flags = visibleFlags(viewer, lvl, f.flags); f.score = f.flags.reduce((a, x) => a + x.severity, 0) }
  const issues = db.issues.filter(i => i.work_id === w.id)
  return {
    id: w.id, code: w.code, name: w.name, work_type: w.work_type, department: w.department, scheme: w.scheme, block: w.block,
    village: w.village, lat: w.lat, lng: w.lng, status: w.status, sanctioned_lakh: w.sanctioned_lakh, planned_end: w.planned_end,
    revised_end: w.revised_end || null, due_date: dueDate(w), qr_token: w.qr_token, je: brief(w.je_id), planned: f.planned, actual: f.actual, evidenced: f.evidenced, financial: f.financial,
    reported: f.reported, check_measured: f.check_measured,
    flags: f.flags, score: f.score, length_km: w.length_km, line: w.line, _coverage: f.coverage,
    open_reported: issues.filter(i => OPEN_UNVERIFIED.has(i.status)).length, open_verified: issues.filter(i => OPEN_VERIFIED.has(i.status)).length,
  }
}
const getWork = (id) => { const w = byId('works', Number(id)); if (!w) throw new ApiError('Work not found', 404); return w }

// ---------- access: facts are public, work is need-to-know (mirrors backend/app/access.py) ----------
const DISTRICT = new Set(['DM', 'DDC']), INTERNAL = new Set(['DM', 'DDC', 'EE', 'AE']), HANDLERS = new Set(['DM', 'DDC', 'EE', 'AE', 'JE'])
const SUSPICION_FLAGS = new Set(['DUPLICATE_PHOTO', 'OUTSIDE_SITE', 'BILL_UNCHECKED', 'FIN_AHEAD', 'HOLD_BYPASSED'])
const CONTRACTOR_FLAGS = new Set(['SCHEDULE_SLIP', 'PAST_DEADLINE', 'TEST_FAILED', 'POSTCHECK_FAILED', 'COMPLETE_NOT_USABLE'])
const LIMITED_FLAGS = new Set(['SCHEDULE_SLIP', 'PAST_DEADLINE'])
const TABS = { full: ['overview', 'issues', 'work', 'money'], contractor: ['overview', 'issues', 'work', 'money'], limited: ['overview', 'issues'] }
function actedOn(me, w) {
  const issues = db.issues.filter(i => i.work_id === w.id)
  if (issues.some(i => i.owner_id === me.id)) return true
  const ids = new Set(issues.map(i => i.id))
  return db.events.some(e => e.actor_id === me.id && ids.has(e.issue_id))
}
function accessLevel(me, w) {
  if (!me) return null
  if (DISTRICT.has(me.role)) return 'full'
  if (me.role === 'EE' && (w.ee_id === me.id || w.department === me.department)) return 'full'
  if (me.role === 'AE' && w.ae_id === me.id) return 'full'
  if (me.role === 'JE' && w.je_id === me.id) return 'full'
  if (me.role === 'CONTRACTOR' && w.contractor_id === me.id) return 'contractor'
  if ((me.role === 'CO' || me.role === 'BDO') && actedOn(me, w)) return 'limited'
  return null
}
const scopeLabel = (me) => ({ DM: 'district', DDC: 'district', EE: 'department' })[me.role] || 'own'
function visibleFlags(me, lvl, flags) {
  if (lvl === 'contractor') return flags.filter(f => CONTRACTOR_FLAGS.has(f.code))
  if (lvl === 'limited') return flags.filter(f => LIMITED_FLAGS.has(f.code))
  if (INTERNAL.has(me.role)) return flags
  return flags.filter(f => !SUSPICION_FLAGS.has(f.code))
}
const seesComplainant = (me, lvl) => lvl === 'full' && HANDLERS.has(me.role)
const seesInspection = (me, w, done) => DISTRICT.has(me.role) || (me.role === 'AE' && w.ae_id === me.id) || (done && (me.role === 'EE' || me.role === 'JE'))
function issueVisible(me, lvl, i) {
  if (lvl === 'full') return true
  const mine = i.owner_id === me.id || i.rectified_by === me.id || db.events.some(e => e.issue_id === i.id && e.actor_id === me.id)
  if (lvl === 'contractor') return mine && !OPEN_UNVERIFIED.has(i.status)
  return mine
}
function workFor(me, id, allow = ['full']) {
  const w = getWork(id), lvl = accessLevel(me, w)
  if (!lvl) throw new ApiError('This work is not one of your responsibilities', 403)
  if (!allow.includes(lvl)) throw new ApiError('Your role cannot do this on this work', 403)
  return w
}

function workDetail(id, viewer) {
  requireOfficer(viewer)
  const w = workFor(viewer, id, ['full', 'contractor', 'limited']), lvl = accessLevel(viewer, w)
  const s = workSummary(w, dupIndex(), viewer, lvl)
  const coverage = s._coverage; delete s._coverage
  const stages = db.stages.filter(x => x.work_id === w.id).sort((a, b) => a.seq - b.seq)
  const evidence = db.evidence.filter(e => e.work_id === w.id && (lvl === 'full' || e.source === 'officer')).sort((a, b) => b.captured_at.localeCompare(a.captured_at))
  const reports = db.reports.filter(r => r.work_id === w.id).sort((a, b) => a.report_date.localeCompare(b.report_date) || a.id - b.id)
  const issues = db.issues.filter(i => i.work_id === w.id).sort((a, b) => b.created_at.localeCompare(a.created_at))
  const checklist = db.checklist.filter(c => c.work_id === w.id).sort((a, b) => a.id - b.id)
  const mbs = db.measurements.filter(m => m.work_id === w.id).sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.id - b.id)
  const tests = db.tests.filter(t => t.work_id === w.id).sort((a, b) => a.id - b.id)
  const bills = db.bills.filter(b => b.work_id === w.id).sort((a, b) => a.bill_no - b.bill_no)
  const unchecked = new Set(mbs.filter(m => m.checked_by == null).map(m => m.id))
  const ready = readiness(w)
  const canCertify = ready.eligible && viewer.role === 'EE' && w.ee_id === viewer.id
  const showPerson = seesComplainant(viewer, lvl), limited = lvl === 'limited'
  const pick = weeklyPicks().find(x => x.work.id === w.id)
  return {
    access: { level: lvl, tabs: TABS[lvl], complainant: showPerson },
    ...s, geofence_m: w.geofence_m, start_date: w.start_date, completion_claimed_on: w.completion_claimed_on,
    people: Object.fromEntries(['je', 'ae', 'ee', 'contractor'].map(k => [k, brief(w[`${k}_id`])])),
    stages: stages.map(st => {
      const [pre, pending] = holdPending(stages, tests, st)
      return {
        ...st, evidence_count: evidence.filter(e => e.stage_id === st.id && e.source === 'officer').length,
        covered: coverage[st.id].covered, gaps: coverage[st.id].gaps, executed: coverage[st.id].executed,
        hold: pending.length ? { stage: pre.name, stage_hi: hi('stage', pre.name), tests: pending.map(t => t.name), tests_hi: pending.map(t => hi('test', t.name)) } : null,
        measurements: limited ? [] : mbs.filter(m => m.stage_id === st.id).map(m => ({ ...m, recorded_by_name: brief(m.recorded_by)?.name, checked_by_name: brief(m.checked_by)?.name ?? null })),
        tests: limited ? [] : tests.filter(t => t.stage_id === st.id).map(t => ({ ...t, spec: specText(t), spec_hi: specText(t, true) })),
      }
    }),
    bills: (limited ? [] : bills).map(b => { const { mb, ...rest } = b; return { ...rest, mb_ids: mb, unchecked: mb.some(x => unchecked.has(x)) } }),
    finance: limited ? null : ready.financial,
    certification: { eligible: ready.eligible, blockers: ready.blockers, claim_blockers: ready.claim_blockers },
    revisions: db.revisions.filter(r => r.work_id === w.id).sort((a, b) => a.id - b.id).map(r => ({ ...r, approved_by_name: brief(r.approved_by)?.name, stage_name: byId('stages', r.stage_id).name })),
    audit: INTERNAL.has(viewer.role) ? auditHistory(w.id) : null,
    sanction: { sanctioned_lakh: w.sanctioned_lakh, start_date: w.start_date, planned_end: w.planned_end, revised_end: w.revised_end || null, scheme: w.scheme,
      stages: stages.map(st => ({ id: st.id, name: st.name, unit: st.unit, qty_sanctioned: st.qty_sanctioned, qty_original: st.qty_original ?? st.qty_sanctioned })) },
    evidence: evidence.map(e => ({ ...evDict(e), ...(INTERNAL.has(viewer.role) ? {} : { in_geofence: null }) })), reports: reports.map(r => ({ ...r })), curve: sCurve(stages, w.start_date, dueDate(w), 12, w),
    extensions: db.extensions.filter(x => x.work_id === w.id).sort((a, b) => a.approved_on.localeCompare(b.approved_on))
      .map(x => ({ ...x, approved_by_name: brief(x.approved_by)?.name, reason_label: DELAY_REASONS[x.reason_code], reason_label_hi: hi('reason', x.reason_code) })),
    postchecks: db.postchecks.filter(x => x.work_id === w.id).sort((a, b) => a.due_date.localeCompare(b.due_date)).map(x => ({ ...x })),
    votes: { yes: db.votes.filter(v => v.work_id === w.id && v.usable).length, no: db.votes.filter(v => v.work_id === w.id && !v.usable).length },
    certified_on: w.certified_on || null, dlp_end: w.dlp_end || null,
    inspection: (() => { const p = pick && seesInspection(viewer, w, !!pick.done) ? pick : null; return p ? { reason: p.reason, week: p.week, due: p.due, assigned_to: brief(p.assigned_to), done: p.done ? { outcome: p.done.outcome, note: p.done.note, on: p.done.done_on } : null } : null })(),
    issues: issues.filter(i => issueVisible(viewer, lvl, i)).map(i => issueDict(i, viewer, false, showPerson)), checklist: checklist.map(c => ({ ...c })), can_certify: canCertify,
  }
}

function haversine(lat1, lng1, lat2, lng2) {
  const r = 6371000, p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180, dp = p2 - p1, dl = (lng2 - lng1) * Math.PI / 180
  return 2 * r * Math.asin(Math.sqrt(Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2))
}
const PURPOSES = ['progress', 'inspection', 'reinspection', 'rectification', 'test_report', 'completion', 'citizen_report', 'document']
const LIMITS = { image: 8 * 1024 * 1024, audio: 5 * 1024 * 1024, doc: 10 * 1024 * 1024 }
function sniff(b) {
  const at = (i, ...xs) => xs.every((x, k) => b[i + k] === x)
  if (at(0, 0xff, 0xd8, 0xff)) return ['image/jpeg', 'image']
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return ['image/png', 'image']
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return ['image/webp', 'image']
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return ['audio/webm', 'audio']
  if (at(0, 0x4f, 0x67, 0x67, 0x53)) return ['audio/ogg', 'audio']
  if (at(0, 0x49, 0x44, 0x33) || at(0, 0xff, 0xfb)) return ['audio/mpeg', 'audio']
  if (at(4, 0x66, 0x74, 0x79, 0x70)) return ['audio/mp4', 'audio']
  if (at(0, 0x25, 0x50, 0x44, 0x46, 0x2d)) return ['application/pdf', 'doc']
  return null
}
async function readUpload(file, allowed) {
  const buf = new Uint8Array(await file.arrayBuffer())
  if (!buf.length) throw new ApiError('The file is empty')
  const t = sniff(buf)
  if (!t || !allowed.includes(t[1])) throw new ApiError('File type not allowed. Use a JPG, PNG or WebP photo' + (allowed.includes('audio') ? ', a voice recording' : '') + (allowed.includes('doc') ? ' or a PDF' : ''))
  if (buf.length > LIMITS[t[1]]) throw new ApiError(`File too large (limit ${LIMITS[t[1]] / 1048576} MB)`, 413)
  const digest = globalThis.crypto?.subtle ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map(x => x.toString(16).padStart(2, '0')).join('') : null
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return { dataUrl: `data:${t[0]};base64,${btoa(bin)}`, mime: t[0], sha256: digest }
}
async function saveEvidence(w, { file, kind = 'photo', caption = '', stage_id, lat, lng, uploaded_by = null, source = 'officer', purpose = null, allowed = ['image'] }) {
  stage_id = stage_id ? Number(stage_id) : null
  purpose = purpose || (source === 'citizen' ? 'citizen_report' : kind === 'test_report' ? 'test_report' : 'progress')
  if (!PURPOSES.includes(purpose) || (source === 'officer' && purpose === 'citizen_report')) throw new ApiError('Unknown evidence purpose')
  if (stage_id) { const st = byId('stages', stage_id); if (!st || st.work_id !== w.id) throw new ApiError('Stage does not belong to this work') }
  const up = uploaded_by ? byId('officers', uploaded_by) : null
  const hasGeo = lat != null && lat !== '' && lng != null && lng !== ''
  const ev = { work_id: w.id, stage_id, issue_id: null, kind, caption: String(caption).slice(0, 200), file: null, lat: hasGeo ? Number(lat) : null,
    lng: hasGeo ? Number(lng) : null, captured_at: nowStamp(), uploaded_at: nowStamp(), uploaded_by, uploader_role: up ? up.role : 'RESIDENT', source, purpose,
    coord_source: hasGeo ? 'device_claimed' : 'none', phash: null, sha256: null, mime: null, in_geofence: null, chainage_km: null }
  if (file instanceof Blob) Object.assign(ev, await readUpload(file, allowed))
  ev.public = source === 'officer' && kind === 'photo' && ['progress', 'completion'].includes(purpose)
  if (ev.lat != null && ev.lng != null) {
    if (w.line) { const [ch, off] = project(w.line, ev.lat, ev.lng); ev.chainage_km = ch; ev.in_geofence = off <= w.geofence_m }
    else ev.in_geofence = haversine(ev.lat, ev.lng, w.lat, w.lng) <= w.geofence_m
  }
  return insert('evidence', ev)
}
function refreshReport(w, me) {
  const stages = db.stages.filter(s => s.work_id === w.id), bills = db.bills.filter(b => b.work_id === w.id)
  insert('reports', { work_id: w.id, report_date: TODAY, physical_pct: actualProgress(stages),
    financial_pct: round1(bills.filter(b => b.status === 'PAID').reduce((a, b) => a + (b.paid_lakh || 0), 0) / w.sanctioned_lakh * 100), note: 'Measured progress (measurement book)', reported_by: me.id })
}
const requireOfficer = (v) => { if (!v) throw new ApiError('Officer login required', 401); return v }

// ---------- weekly surprise inspections + task lists (mirror of extras.py) ----------
function fnv1a(s) {
  let h = 0x811C9DC5
  for (const b of new TextEncoder().encode(s)) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0 }
  return h >>> 0
}
function isoWeek(s) {
  const d = parseDay(s), dayNum = (d.getDay() + 6) % 7
  const thu = new Date(d); thu.setDate(d.getDate() - dayNum + 3)
  const jan4 = new Date(thu.getFullYear(), 0, 4)
  const week = 1 + Math.round(((thu - jan4) / DAY - 3 + ((jan4.getDay() + 6) % 7)) / 7)
  return `${thu.getFullYear()}-W${String(week).padStart(2, '0')}`
}
function weeklyPicks(scores) {
  const week = isoWeek(TODAY), dayNum = (parseDay(TODAY).getDay() + 6) % 7, sunday = addDays(TODAY, 6 - dayNum)
  const works = db.works.filter(w => ['IN_PROGRESS', 'REPORTED_COMPLETE'].includes(w.status))
  if (!scores) { const dup = dupIndex(); scores = Object.fromEntries(works.map(w => [w.id, workFlags(w, TODAY, dup).score])) }
  const byRisk = [...works].sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0) || a.code.localeCompare(b.code)).slice(0, 2)
  const rest = works.filter(w => !byRisk.includes(w))
  const rnd = rest.length ? rest.reduce((m, w) => (fnv1a(`${week}|${w.code}`) < fnv1a(`${week}|${m.code}`) ? w : m)) : null
  return [...byRisk.map(w => [w, 'risk']), ...(rnd ? [[rnd, 'random']] : [])].map(([w, reason]) => ({
    work: w, reason, week, due: sunday, assigned_to: w.ae_id, done: db.inspections.find(x => x.work_id === w.id && x.week === week) || null,
  }))
}
const FLAG_TASK = {
  STAGE_NO_EVIDENCE: ['Add site photos', 'साइट फोटो जोड़ें', 'work'], EVIDENCE_GAP: ['Add site photos for the missing stretch', 'छूटे हिस्से की साइट फोटो जोड़ें', 'work'],
  STALE_EVIDENCE: ['Upload a current site photo', 'ताज़ा साइट फोटो डालें', 'work'], TESTS_MISSING: ['Record the required tests', 'आवश्यक परीक्षण दर्ज करें', 'work'],
  BILL_UNCHECKED: ['Check-measure before the next payment', 'अगले भुगतान से पहले जाँच-माप करें', 'work'], HOLD_BYPASSED: ['Look into a hold-point breach', 'होल्ड पॉइंट उल्लंघन देखें', 'work'],
  FIN_AHEAD: ['Review payments against evidence', 'भुगतान बनाम साक्ष्य की समीक्षा करें', 'money'], SCHEDULE_SLIP: ['Record why the work is behind', 'काम पीछे क्यों है, दर्ज करें', 'issues'],
  PAST_DEADLINE: ['Decide: time extension or action on contractor', 'निर्णय लें: समय-वृद्धि या संवेदक पर कार्रवाई', 'overview'],
  COMPLETE_NOT_USABLE: ['Finish the usability check', 'उपयोगिता जाँच पूरी करें', 'overview'], REPEAT_COMPLAINTS: ['Look at repeated complaints', 'बार-बार की शिकायतें देखें', 'issues'],
  DUPLICATE_PHOTO: ['Check a photo used on two works', 'दो कार्यों में लगी एक ही फोटो जाँचें', 'work'], OUTSIDE_SITE: ['Check a photo taken away from the site', 'स्थल से बाहर ली गई फोटो जाँचें', 'work'],
  POSTCHECK_OVERDUE: ['Do the post-monsoon re-check', 'मानसून बाद की पुनः जाँच करें', 'overview'], POSTCHECK_FAILED: ['Get defects repaired under liability', 'दायित्व अवधि में दोष ठीक कराएँ', 'overview'],
  RESIDENTS_NOT_USABLE: ['Residents say it is not usable: inspect', 'निवासी कहते हैं उपयोग योग्य नहीं: जाँच करें', 'overview'],
}
const SKIP_FLAGS = new Set(['UNACKED_REPORTS', 'OVERDUE_ACTION', 'TEST_FAILED'])
const ISSUE_TASK = {
  REPORTED: ['Acknowledge a resident report', 'निवासी की शिकायत स्वीकार करें'], ACKNOWLEDGED: ['Examine on site', 'स्थल पर जाँच करें'],
  UNDER_EXAMINATION: ['Record your finding', 'जाँच का निष्कर्ष दर्ज करें'], VERIFIED: ['Assign the repair', 'मरम्मत सौंपें'],
  ACTION_ASSIGNED: ['Fix and report the repair', 'मरम्मत कर सूचना दें'], RECTIFIED: ['Check the repair and close', 'मरम्मत जाँचकर बंद करें'],
}
const PRIORITY = { 3: 'urgent', 2: 'week', 1: 'later' }, PORDER = { urgent: 0, week: 1, later: 2 }
const wb = (w) => ({ id: w.id, code: w.code, name: w.name, block: w.block })
function tasksFor(me) {
  const tasks = [], seen = new Set()
  const add = (t) => { const k = `${t.work.id}|${t.title}|${t.focus}`; if (!seen.has(k)) { seen.add(k); tasks.push(t) } }
  const dup = dupIndex()
  const fl = Object.fromEntries(db.works.map(w => [w.id, workFlags(w, TODAY, dup)]))
  for (const i of db.issues) {
    if (TERMINAL.has(i.status)) continue
    const w = byId('works', i.work_id), esc = escalation(i, w)
    const mine = i.owner_id === me.id && availableActions(i, me).length > 0
    const escMe = esc.to && esc.to.id === me.id
    if (!(mine || escMe)) continue
    let title
    if (escMe && !mine) title = ['Escalated to you: follow up', 'आप तक बढ़ाया गया: आगे बढ़ाएँ']
    else if (i.status === 'ACTION_ASSIGNED' && i.category === 'delay') title = ['Resolve the hold-up', 'बाधा दूर करें']
    else title = ISSUE_TASK[i.status]
    const ex = i.supporters ? ` (and ${i.supporters} more residents)` : '', exh = i.supporters ? ` (और ${i.supporters} निवासी)` : ''
    const overdue = !!(i.due_date && i.due_date < TODAY)
    add({ kind: 'issue', priority: overdue || escMe ? 'urgent' : 'week', work: wb(w), title: title[0], title_hi: title[1],
      detail: `${i.ticket}: ${i.title}${ex}`, detail_hi: `${i.ticket}: ${i.title}${exh}`, tab: 'issues', focus: `issue-${i.id}`, due_date: i.due_date || null, overdue_days: esc.days })
  }
  const openDelay = new Set(db.issues.filter(i => i.category === 'delay' && !TERMINAL.has(i.status)).map(i => i.work_id))
  for (const w of db.works) {
    for (const f of fl[w.id].flags) {
      if (SKIP_FLAGS.has(f.code) || f.next_person !== me.name || !FLAG_TASK[f.code]) continue
      if (f.code === 'SCHEDULE_SLIP' && openDelay.has(w.id)) continue
      const [en, hn, tab] = FLAG_TASK[f.code]
      add({ kind: 'flag', code: f.code, priority: PRIORITY[f.severity], work: wb(w), title: en, title_hi: hn, detail: f.message, detail_hi: f.message_hi, tab, focus: null, due_date: null, overdue_days: 0 })
    }
  }
  for (const pk of weeklyPicks(Object.fromEntries(Object.entries(fl).map(([k, v]) => [k, v.score])))) {
    if (pk.assigned_to === me.id && !pk.done) {
      const why = pk.reason === 'risk' ? 'picked because of its open flags' : 'picked at random this week'
      const whyh = pk.reason === 'risk' ? 'खुले चिह्नों के कारण चुना गया' : 'इस सप्ताह बिना क्रम चुना गया'
      add({ kind: 'inspection', priority: 'week', work: wb(pk.work), title: 'Surprise inspection this week', title_hi: 'इस सप्ताह औचक निरीक्षण',
        detail: `Visit without notice and record what you find. This work was ${why}.`, detail_hi: `बिना सूचना जाएँ और जो मिले दर्ज करें। यह कार्य ${whyh}।`,
        tab: 'overview', focus: 'inspection', due_date: pk.due, overdue_days: 0 })
    }
  }
  return tasks.sort((a, b) => PORDER[a.priority] - PORDER[b.priority] || (b.overdue_days || 0) - (a.overdue_days || 0) || a.work.code.localeCompare(b.work.code))
}
function certifyDates(w, on) {
  w.certified_on = on
  const d = parseDay(on)
  w.dlp_end = isoDay(new Date(d.getFullYear() + 5, d.getMonth(), Math.min(d.getDate(), 28)))
  const year = on < `${d.getFullYear()}-06-15` ? d.getFullYear() : d.getFullYear() + 1
  insert('postchecks', { work_id: w.id, kind: 'post_monsoon', due_date: `${year}-10-31`, done_on: null, done_by: null, passed: null, note: '', evidence_id: null })
}
const evidenceOk = (workId, id, me) => requireEvidence(id, getWork(workId), { purposes: ['inspection', 'reinspection'], actor: me, byActor: !!me, roles: [...TECHNICAL, 'DM', 'DDC'], what: 'an inspection' })
const UPLOAD_PURPOSES = {
  full: { JE: ['progress', 'inspection', 'rectification', 'test_report', 'completion', 'document'], AE: ['progress', 'inspection', 'reinspection', 'test_report', 'completion', 'document'],
    EE: ['progress', 'inspection', 'reinspection', 'test_report', 'completion', 'document'], DM: ['inspection', 'reinspection', 'document'], DDC: ['inspection', 'reinspection', 'document'] },
  contractor: { CONTRACTOR: ['progress', 'rectification', 'completion', 'document'] },
  limited: { CO: ['document', 'progress'], BDO: ['document', 'progress'] },
}
const blocked = (message, items) => { throw new ApiError(message, 409, { message, blockers: items }) }
function validPhone(phone) {
  if (!phone) return null
  const d = String(phone).replace(/\D/g, '')
  if (d.length < 10 || d.length > 12) throw new ApiError('Enter a 10-digit mobile number')
  return d.slice(-10)
}
const voterId = (phone) => phone ? `phone:${phone}` : 'device:this-browser'
function trackedIssue(ticket, key) {
  const i = db.issues.find(x => x.ticket === String(ticket).toUpperCase().trim())
  if (!i || i.source !== 'citizen' || !key || i.track_key !== String(key).trim()) throw new ApiError('Ticket not found. Check the ticket number and the tracking code from your SMS.', 404)
  return i
}
function decisionsFor(works, issues) {
  const out = [], byW = Object.fromEntries(works.map(w => [w.id, w]))
  for (const i of issues) {
    const esc = escalation(i, byId('works', i.work_id))
    if (esc.level >= 2 || (i.category === 'delay' && !TERMINAL.has(i.status) && esc.level >= 1)) {
      const w = byW[i.work_id], delay = i.category === 'delay'
      const notes = db.events.filter(e => e.issue_id === i.id && e.note).sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id)
      out.push({ kind: 'escalation', severity: 3, work: { id: w.id, code: w.code, name: w.name },
        decision: delay ? 'Hold-up past its deadline: decide' : "Overdue action: decide on the owner's next step",
        decision_hi: delay ? 'बाधा समय-सीमा पार: निर्णय लें' : 'लंबित कार्रवाई: अगले कदम पर निर्णय लें',
        why: `${i.ticket}: ${i.title}`, owner: brief(i.owner_id), escalated_to: esc.to ? brief(esc.to.id) : null, level: esc.level,
        age_days: days(i.created_at.slice(0, 10), TODAY), due_date: i.due_date || null, overdue_days: esc.days,
        last_action: notes.length ? notes[notes.length - 1].note : '', tab: 'issues', focus: `issue-${i.id}` })
    }
  }
  for (const w of works) for (const f of w.flags) {
    if (f.severity < 3 || f.code === 'OVERDUE_ACTION' || !FLAG_TASK[f.code]) continue
    const [en, hn, tab] = FLAG_TASK[f.code]
    out.push({ kind: 'flag', code: f.code, severity: 3, work: { id: w.id, code: w.code, name: w.name }, decision: en, decision_hi: hn, why: f.message, why_hi: f.message_hi,
      owner: { role: f.next_action_by, name: f.next_person }, escalated_to: null, level: 0, age_days: null, due_date: null, overdue_days: 0, last_action: '', tab, focus: null })
  }
  return out.sort((a, b) => b.level - a.level || (b.overdue_days || 0) - (a.overdue_days || 0) || a.work.code.localeCompare(b.work.code)).slice(0, 12)
}

// ---------- router ----------
export async function handle(method, path, body, userId) {
  const viewer = userId ? byId('officers', Number(userId)) : null
  const [p, qs] = path.split('?')
  const q = new URLSearchParams(qs || '')
  let m
  if (method === 'GET') {
    if (p === '/meta') return {
      mode: 'demo', today: TODAY, officers: [...db.officers].sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name)),
      delay_reasons: DELAY_REASONS, status_labels: STATUS_LABEL,
      blocks: [...new Set(db.works.map(w => w.block))].sort(), departments: [...new Set(db.works.map(w => w.department))].sort(),
    }
    if (p === '/dashboard') {
      const me = requireOfficer(viewer), dup = dupIndex()
      const levels = Object.fromEntries(db.works.map(w => [w.id, accessLevel(me, w)]))
      const works = db.works.filter(w => levels[w.id]).map(w => { const s = workSummary(w, dup, me, levels[w.id]); delete s._coverage; return s })
      const byW = Object.fromEntries(works.map(w => [w.id, w]))
      const blocks = {}
      for (const w of works) {
        const b = (blocks[w.block] ||= { block: w.block, works: 0, flagged: 0, sanctioned_lakh: 0 })
        b.works++; b.flagged += w.flags.length ? 1 : 0; b.sanctioned_lakh = round1(b.sanctioned_lakh + w.sanctioned_lakh)
      }
      const is = db.issues.filter(i => byW[i.work_id]), holdups = {}, escalated = []
      for (const i of is) {
        if (i.category === 'delay' && !TERMINAL.has(i.status)) {
          const h = (holdups[i.reason_code] ||= { reason: i.reason_code, label: DELAY_REASONS[i.reason_code], label_hi: hi('reason', i.reason_code), works: [], sanctioned_lakh: 0, overdue: 0 })
          const w = byW[i.work_id]
          h.works.push({ id: w.id, code: w.code, name: w.name }); h.sanctioned_lakh = round1(h.sanctioned_lakh + w.sanctioned_lakh)
          if (i.due_date && i.due_date < TODAY) h.overdue++
        }
        const esc = escalation(i, byId('works', i.work_id))
        if (esc.to) escalated.push({ ticket: i.ticket, title: i.title, work_id: i.work_id, days: esc.days, to: brief(esc.to.id), owner: brief(i.owner_id) })
      }
      return {
        today: TODAY,
        totals: {
          works: works.length, sanctioned_lakh: round1(works.reduce((a, w) => a + w.sanctioned_lakh, 0)),
          behind_schedule: works.filter(w => w.flags.some(f => ['SCHEDULE_SLIP', 'PAST_DEADLINE'].includes(f.code))).length,
          complete_not_usable: works.filter(w => w.flags.some(f => f.code === 'COMPLETE_NOT_USABLE')).length,
          usable_verified: works.filter(w => w.status === 'USABLE_VERIFIED').length,
          open_reported: is.filter(i => OPEN_UNVERIFIED.has(i.status)).length, open_verified: is.filter(i => OPEN_VERIFIED.has(i.status)).length,
          overdue_actions: is.filter(i => i.due_date && i.due_date < TODAY && !TERMINAL.has(i.status)).length,
          needs_decision: works.filter(w => w.flags.some(f => f.severity === 3)).length, escalated: escalated.length,
        },
        scope: scopeLabel(me),
        inspections: DISTRICT.has(me.role) ? weeklyPicks().map(pk => ({
          work: { id: pk.work.id, code: pk.work.code, name: pk.work.name }, reason: pk.reason, week: pk.week, due: pk.due,
          assigned_to: brief(pk.assigned_to), done: pk.done ? { outcome: pk.done.outcome, on: pk.done.done_on } : null })) : null,
        intervention: works.filter(w => w.flags.length).sort((a, b) => b.score - a.score || a.code.localeCompare(b.code)).slice(0, 10),
        decisions: decisionsFor(works, is),
        holdups: Object.values(holdups).sort((a, b) => b.sanctioned_lakh - a.sanctioned_lakh), escalated: escalated.sort((a, b) => b.days - a.days),
        works: works.sort((a, b) => a.code.localeCompare(b.code)), blocks: Object.values(blocks).sort((a, b) => a.block.localeCompare(b.block)),
      }
    }
    if ((m = p.match(/^\/works\/(\d+)$/))) return workDetail(m[1], viewer)
    if (p === '/tasks') return tasksFor(requireOfficer(viewer))
    if ((m = p.match(/^\/works\/(\d+)\/certification$/))) { const me = requireOfficer(viewer); return readiness(workFor(me, m[1], ['full', 'contractor'])) }
    if (p === '/issues') {
      requireOfficer(viewer)
      const levels = Object.fromEntries(db.works.map(w => [w.id, accessLevel(viewer, w)]))
      let rows = [...db.issues].sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'))
        .filter(i => levels[i.work_id] && issueVisible(viewer, levels[i.work_id], i))
      if (q.get('open_only') !== 'false') rows = rows.filter(i => !TERMINAL.has(i.status))
      if (q.get('mine') === 'true' && viewer) rows = rows.filter(i => i.owner_id === viewer.id || escalation(i, byId('works', i.work_id)).to?.id === viewer.id)
      return rows.map(i => { const w = byId('works', i.work_id); return { ...issueDict(i, viewer, false, seesComplainant(viewer, levels[i.work_id])), work: { id: w.id, code: w.code, name: w.name } } })
    }
    if (p === '/public/works') return [...db.works].sort((a, b) => a.block.localeCompare(b.block) || a.name.localeCompare(b.name))
      .map(w => ({ qr_token: w.qr_token, code: w.code, name: w.name, block: w.block, village: w.village, work_type: w.work_type, status: w.status, lat: w.lat, lng: w.lng }))
    if ((m = p.match(/^\/public\/works\/([\w-]+)$/))) {
      const w = db.works.find(x => x.qr_token === m[1]); if (!w) throw new ApiError('Work not found', 404)
      const stages = db.stages.filter(s => s.work_id === w.id).sort((a, b) => a.seq - b.seq)
      return {
        qr_token: w.qr_token, code: w.code, name: w.name, work_type: w.work_type, department: w.department, scheme: w.scheme,
        block: w.block, village: w.village, lat: w.lat, lng: w.lng, status: w.status, sanctioned_lakh: w.sanctioned_lakh,
        start_date: w.start_date, planned_end: w.planned_end, progress: actualProgress(stages),
        check_measured: checkMeasured(stages, db.measurements.filter(x => x.work_id === w.id)),
        revised_end: w.revised_end || null, due_date: dueDate(w), certified_on: w.certified_on || null, dlp_end: w.dlp_end || null,
        votes: { yes: db.votes.filter(v => v.work_id === w.id && v.usable).length, no: db.votes.filter(v => v.work_id === w.id && !v.usable).length },
        stages: stages.map(s => ({ name: s.name, progress: s.progress })),
        reports: db.issues.filter(i => i.work_id === w.id && i.source === 'citizen').sort((a, b) => b.created_at.localeCompare(a.created_at)).map(i => issueDict(i, null, true)),
      }
    }
    if ((m = p.match(/^\/public\/track\/([\w-]+)$/))) {
      const i = trackedIssue(m[1], q.get('key'))
      const w = byId('works', i.work_id)
      return { issue: issueDict(i, null, true), work: { name: w.name, qr_token: w.qr_token, block: w.block },
        sms: db.notifications.filter(n => n.ticket === i.ticket).sort((a, b) => a.sent_at.localeCompare(b.sent_at)).map(n => ({ to: mask(n.phone), text: n.text, text_hi: n.text_hi, at: n.sent_at })) }
    }
  }
  if (method === 'POST') {
    if ((m = p.match(/^\/works\/(\d+)\/measurements$/))) {
      const me = requireOfficer(viewer), w = workFor(me, m[1])
      if (me.role !== 'JE') throw new ApiError('Measurements are recorded by the JE', 403)
      const st = byId('stages', Number(body.stage_id)); if (!st || st.work_id !== w.id) throw new ApiError('Stage does not belong to this work')
      const stages = db.stages.filter(s => s.work_id === w.id), tests = db.tests.filter(t => t.work_id === w.id)
      const [pre, pending] = holdPending(stages, tests, st)
      if (pending.length) throw new ApiError(`Hold point: '${pre.name}' must pass ${pending.map(t => t.name).join(', ')} before '${st.name}' can be measured.`, 409)
      const qty = Number(body.qty)
      if (!(qty > 0)) throw new ApiError('Quantity must be more than zero')
      if (st.qty_executed + qty > st.qty_sanctioned + 1e-6) throw new ApiError(`Only ${g(st.qty_sanctioned - st.qty_executed)} ${st.unit} remain in the sanctioned quantity`)
      const chF = body.ch_from === '' || body.ch_from == null ? null : Number(body.ch_from), chT = body.ch_to === '' || body.ch_to == null ? null : Number(body.ch_to)
      if (st.linear && (chF == null || chT == null || chT <= chF || chT > (w.length_km || 0) + 1e-6)) throw new ApiError(`Give the chainage from and to (km, within 0–${g(w.length_km)})`)
      const mb = insert('measurements', { work_id: w.id, stage_id: st.id, entry_date: TODAY, qty, ch_from: chF, ch_to: chT, recorded_by: me.id, checked_by: null, checked_on: null })
      auditRecord(w.id, 'measurement', mb.id, 'record', me, {}, { stage: st.name, qty, ch_from: chF, ch_to: chT })
      st.qty_executed = Math.round((st.qty_executed + qty) * 1000) / 1000
      st.progress = round1(Math.min(100, st.qty_executed / st.qty_sanctioned * 100))
      if (st.progress >= 100 && !st.completed_on) st.completed_on = TODAY
      if (w.status === 'SANCTIONED') w.status = 'IN_PROGRESS'
      refreshReport(w, me)
      return { ok: true }
    }
    if ((m = p.match(/^\/measurements\/(\d+)\/check$/))) {
      const me = requireOfficer(viewer), mb = byId('measurements', Number(m[1]))
      if (!mb) throw new ApiError('Measurement not found', 404)
      if (!TECHNICAL.includes(me.role)) throw new ApiError('Check-measurement is done by the AE or EE', 403)
      workFor(me, mb.work_id)
      if (mb.recorded_by === me.id) throw new ApiError('The officer who recorded a measurement cannot check it', 403)
      if (mb.checked_by != null) throw new ApiError('Already check-measured', 409)
      mb.checked_by = me.id; mb.checked_on = TODAY
      auditRecord(mb.work_id, 'measurement', mb.id, 'check_measure', me, {}, { qty: mb.qty })
      return { ok: true }
    }
    if ((m = p.match(/^\/tests\/(\d+)$/))) {
      const me = requireOfficer(viewer), t = byId('tests', Number(m[1]))
      if (!t) throw new ApiError('Test not found', 404)
      if (!ENGINEERS.includes(me.role)) throw new ApiError('Tests are recorded by engineers', 403)
      const w = workFor(me, t.work_id)
      const result = Number(body.result)
      if (body.result === '' || body.result == null || !Number.isFinite(result)) throw new ApiError('Enter the test result')
      const ev = requireEvidence(body.evidence_id, w, { purposes: ['test_report', 'inspection'], roles: ENGINEERS, stageId: t.stage_id, what: 'a test result' })
      const reason = (body.reason || '').trim()
      let before = null
      if (t.result != null) {
        if (!reason) throw new ApiError('A result is already on record. Say why you are entering a retest or correction.')
        if (ev.id === t.evidence_id) throw new ApiError('A retest needs its own test report, not the earlier one')
        before = { result: t.result, passed: t.passed, tested_on: t.tested_on, tested_by: t.tested_by, evidence_id: t.evidence_id }
      }
      Object.assign(t, { result, passed: evaluateTest(t, result), chainage_km: body.chainage_km === '' || body.chainage_km == null ? null : Number(body.chainage_km),
        lab: body.lab || 'Field test', evidence_id: ev.id, tested_on: TODAY, tested_by: me.id })
      auditRecord(w.id, 'test', t.id, before ? 'retest' : 'record', me, before || {}, { result: t.result, passed: t.passed, evidence_id: ev.id }, reason, ev.id)
      let raised = null
      if (!t.passed) {
        const st = byId('stages', t.stage_id)
        const where = t.chainage_km != null ? ` at km ${g(t.chainage_km)}` : ''
        raised = createIssue({ work: w, actor: me.role === 'JE' ? null : me, source: 'inspection', category: 'quality',
          title: `${t.name} failed${where}: ${g(result)} ${t.unit} against ${specText(t)}`,
          description: `${t.name} on '${st.name}'${where}: ${g(result)} ${t.unit} against ${specText(t)}. Raised automatically from the test register.`, stage_id: t.stage_id })
        if (raised.status === 'REPORTED') {
          raised.status = 'VERIFIED'; raised.finding = raised.description; raised.owner_id = w.ee_id
          log(raised, 'verify', me, 'REPORTED', 'VERIFIED', 'Failed test result on record.', ev.id)
        }
        t.issue_id = raised.id
      }
      return { ok: true, passed: t.passed, issue: raised?.ticket ?? null }
    }
    if ((m = p.match(/^\/works\/(\d+)\/evidence$/))) {
      const me = requireOfficer(viewer), w = workFor(me, m[1], ['full', 'contractor', 'limited']), lvl = accessLevel(me, w)
      const kind = body.kind || 'photo'
      if (!['photo', 'test_report', 'document'].includes(kind)) throw new ApiError('Unknown evidence kind')
      const purpose = body.purpose || (kind === 'test_report' ? 'test_report' : 'progress')
      if (!(UPLOAD_PURPOSES[lvl]?.[me.role] || []).includes(purpose)) throw new ApiError(`Your role cannot file evidence as '${purpose}' on this work`, 403)
      if (!(body.file instanceof Blob)) throw new ApiError('Attach a photo or document')
      return evDict(await saveEvidence(w, { ...body, kind, purpose, uploaded_by: me.id, source: 'officer',
        allowed: ['test_report', 'document'].includes(purpose) ? ['image', 'doc'] : ['image'] }))
    }
    if ((m = p.match(/^\/works\/(\d+)\/issues$/))) {
      const me = requireOfficer(viewer), w = workFor(me, m[1], ['full', 'limited'])
      return issueDict(createIssue({ work: w, actor: me, source: TECHNICAL.includes(me.role) && body.evidence_id ? 'inspection' : 'officer', ...body }), me)
    }
    if ((m = p.match(/^\/issues\/(\d+)\/actions$/))) {
      const me = requireOfficer(viewer), i = byId('issues', Number(m[1]))
      if (!i) throw new ApiError('Issue not found', 404)
      const iw = byId('works', i.work_id), lvl = accessLevel(me, iw)
      if (escalation(i, iw).to?.id !== me.id && (!lvl || !issueVisible(me, lvl, i))) throw new ApiError('This issue is not one of your responsibilities', 403)
      transition(i, body.action, me, { note: body.note || '', evidence_id: body.evidence_id ?? null, owner_id: body.owner_id ?? null, due_date: body.due_date ?? null, expected_status: body.expected_status ?? null })
      return issueDict(i, me, false, seesComplainant(me, lvl))
    }
    if ((m = p.match(/^\/works\/(\d+)\/claim-complete$/))) {
      const me = requireOfficer(viewer), w = workFor(me, m[1])
      if (me.role !== 'JE' || w.je_id !== me.id) throw new ApiError('Completion is claimed by the JE of this work', 403)
      const b = claimBlockers(w)
      if (b.length) blocked('Cannot claim completion yet', b)
      w.status = 'REPORTED_COMPLETE'; w.completion_claimed_on = TODAY
      auditRecord(w.id, 'work', w.id, 'claim_complete', me, { status: 'IN_PROGRESS' }, { status: w.status })
      return { ok: true }
    }
    if ((m = p.match(/^\/works\/(\d+)\/return-claim$/))) {
      const me = requireOfficer(viewer), w = workFor(me, m[1])
      if (!TECHNICAL.includes(me.role)) throw new ApiError('Only the AE or EE can return a completion claim', 403)
      if (w.status !== 'REPORTED_COMPLETE') throw new ApiError('There is no pending completion claim', 409)
      const reason = (body.reason || '').trim()
      if (reason.length < 10) throw new ApiError('Write why the claim is being returned')
      w.status = 'IN_PROGRESS'; w.completion_claimed_on = null
      auditRecord(w.id, 'work', w.id, 'return_claim', me, { status: 'REPORTED_COMPLETE' }, { status: 'IN_PROGRESS' }, reason)
      return { ok: true }
    }
    if ((m = p.match(/^\/works\/(\d+)\/checklist\/(\d+)$/))) {
      const me = requireOfficer(viewer), w = workFor(me, m[1])
      if (!TECHNICAL.includes(me.role)) throw new ApiError('Usability is checked by AE/EE', 403)
      const c = byId('checklist', Number(m[2])); if (!c || c.work_id !== Number(m[1])) throw new ApiError('Checklist item not found', 404)
      if (!['REPORTED_COMPLETE', 'USABLE_VERIFIED'].includes(w.status) && body.passed) throw new ApiError('Usability is checked after the JE claims the work complete', 409)
      let ev = null
      if (body.passed) ev = requireEvidence(body.evidence_id, w, { purposes: CHECKLIST_PURPOSES, actor: me, byActor: true, roles: TECHNICAL, what: 'a usability check' })
      else if (!(body.note || '').trim() && body.evidence_id == null) throw new ApiError('Say what failed')
      const before = { passed: c.passed, evidence_id: c.evidence_id, verified_by: c.verified_by }
      Object.assign(c, { passed: !!body.passed, evidence_id: ev ? ev.id : null, verified_by: me.id, verified_on: TODAY })
      auditRecord(w.id, 'checklist', c.id, 'check', me, before, { passed: c.passed, evidence_id: c.evidence_id }, (body.note || '').trim(), c.evidence_id)
      return { ...c }
    }
    if ((m = p.match(/^\/works\/(\d+)\/certify$/))) {
      const me = requireOfficer(viewer), w = workFor(me, m[1])
      if (me.role !== 'EE') throw new ApiError('Only the EE certifies a work as usable', 403)
      const b = certBlockers(w, me)
      if (b.length) blocked('Cannot certify yet', b)
      w.status = 'USABLE_VERIFIED'
      certifyDates(w, TODAY)
      auditRecord(w.id, 'work', w.id, 'certify', me, { status: 'REPORTED_COMPLETE' }, { status: w.status, dlp_end: w.dlp_end }, 'All certification conditions met')
      return { ok: true }
    }
    if ((m = p.match(/^\/works\/(\d+)\/bills$/))) {
      const me = requireOfficer(viewer), w = workFor(me, m[1], ['contractor', 'full'])
      if (!['CONTRACTOR', 'JE'].includes(me.role)) throw new ApiError('Bills are submitted by the contractor (or the JE on their behalf)', 403)
      const amt = Number(body.amount_lakh), ids = (body.mb_ids || []).map(Number)
      if (!(amt > 0)) throw new ApiError('Enter the bill amount', 422)
      if (!ids.length) throw new ApiError('A bill must cite the measurement-book entries it pays for')
      if (ids.some(i => { const x = byId('measurements', i); return !x || x.work_id !== w.id })) throw new ApiError('Every measurement entry must belong to this work')
      const wb2 = db.bills.filter(b => b.work_id === w.id), billed = new Set(wb2.flatMap(b => b.mb))
      if (ids.some(i => billed.has(i))) throw new ApiError('Some of these measurement entries are already billed', 409)
      if (wb2.reduce((a, b) => a + b.amount_lakh, 0) + amt > w.sanctioned_lakh + 1e-6) throw new ApiError('Bills would exceed the sanctioned amount; a revised sanction is needed first')
      const b = insert('bills', { work_id: w.id, bill_no: Math.max(0, ...wb2.map(x => x.bill_no)) + 1, bill_date: TODAY, amount_lakh: r2(amt), mb_ids: JSON.stringify([...new Set(ids)].sort((a, c) => a - c)),
        mb: [...new Set(ids)].sort((a, c) => a - c), status: 'SUBMITTED', submitted_by: me.id, checked_by: null, checked_on: null, authorized_by: null, authorized_on: null,
        paid_on: null, paid_lakh: null, payment_ref: null, payment_source: null, recorded_by: null })
      auditRecord(w.id, 'bill', b.id, 'submit', me, {}, { amount_lakh: b.amount_lakh, mb_ids: ids })
      return { ...b }
    }
    if ((m = p.match(/^\/bills\/(\d+)\/(check|authorize|payment)$/))) {
      const me = requireOfficer(viewer), b = byId('bills', Number(m[1]))
      if (!b) throw new ApiError('Bill not found', 404)
      const w = workFor(me, b.work_id), step = m[2]
      if (step === 'check') {
        if (me.role !== 'AE') throw new ApiError('Bills are checked by the AE', 403)
        if (b.status !== 'SUBMITTED') throw new ApiError(`Bill is already ${b.status}`, 409)
        const un = b.mb.map(i => byId('measurements', i)).filter(x => x.checked_by == null)
        if (un.length) throw new ApiError(`Check-measure the ${un.length} measurement entr${un.length === 1 ? 'y' : 'ies'} this bill pays for first`, 409)
        Object.assign(b, { status: 'CHECKED', checked_by: me.id, checked_on: TODAY })
        auditRecord(w.id, 'bill', b.id, 'check', me, { status: 'SUBMITTED' }, { status: b.status })
      } else if (step === 'authorize') {
        if (me.role !== 'EE' || w.ee_id !== me.id) throw new ApiError('Payment is authorised by the EE of this work', 403)
        if (b.status !== 'CHECKED') throw new ApiError(b.status === 'SUBMITTED' ? 'Only a bill checked by the AE can be authorised' : `Bill is already ${b.status}`, 409)
        Object.assign(b, { status: 'AUTHORIZED', authorized_by: me.id, authorized_on: TODAY })
        auditRecord(w.id, 'bill', b.id, 'authorize', me, { status: 'CHECKED' }, { status: b.status })
      } else {
        if (!['EE', 'DDC'].includes(me.role)) throw new ApiError('Payments are recorded by the EE (drawing officer) or the DDC', 403)
        if (b.status !== 'AUTHORIZED') throw new ApiError(['SUBMITTED', 'CHECKED'].includes(b.status) ? 'Only an authorised bill can be recorded as paid' : 'Payment already recorded', 409)
        const amt = Number(body.paid_lakh), ref = (body.payment_ref || '').trim()
        if (!(amt > 0) || ref.length < 4) throw new ApiError('Enter the amount paid and the treasury / PFMS reference', 422)
        if (amt > b.amount_lakh + 1e-6) throw new ApiError('Payment cannot exceed the bill amount')
        if (body.paid_on && body.paid_on > TODAY) throw new ApiError('Payment date cannot be in the future')
        Object.assign(b, { status: 'PAID', paid_lakh: r2(amt), payment_ref: ref, paid_on: body.paid_on || TODAY, payment_source: 'manual_entry', recorded_by: me.id })
        auditRecord(w.id, 'bill', b.id, 'record_payment', me, { status: 'AUTHORIZED' }, { status: 'PAID', paid_lakh: b.paid_lakh, ref, source: 'manual_entry' })
        refreshReport(w, me)
      }
      const { mb, ...rest } = b
      return { ...rest, mb_ids: mb }
    }
    if ((m = p.match(/^\/works\/(\d+)\/revisions$/))) {
      const me = requireOfficer(viewer), w = workFor(me, m[1])
      if (me.role !== 'EE' || w.ee_id !== me.id) throw new ApiError('Scope revisions are approved by the EE of this work', 403)
      const reason = (body.reason || '').trim(), ref = (body.order_ref || '').trim(), q2 = Number(body.new_qty)
      if (reason.length < 10 || ref.length < 3 || !(q2 > 0)) throw new ApiError('Give the new quantity, the reason and the sanction order reference', 422)
      const st = byId('stages', Number(body.stage_id)); if (!st || st.work_id !== w.id) throw new ApiError('Stage does not belong to this work')
      if (w.status === 'USABLE_VERIFIED') throw new ApiError('The work is already certified', 409)
      if (q2 + 1e-6 < st.qty_executed) throw new ApiError(`${g(st.qty_executed)} ${st.unit} is already measured; the revised quantity cannot be lower`)
      if (Math.abs(q2 - st.qty_sanctioned) < 1e-9) throw new ApiError('The new quantity is the same as the current one')
      if (st.qty_original == null) st.qty_original = st.qty_sanctioned
      insert('revisions', { work_id: w.id, stage_id: st.id, old_qty: st.qty_sanctioned, new_qty: q2, reason, order_ref: ref, approved_by: me.id, approved_on: TODAY })
      auditRecord(w.id, 'stage', st.id, 'scope_revision', me, { qty_sanctioned: st.qty_sanctioned }, { qty_sanctioned: q2, order_ref: ref }, reason)
      st.qty_sanctioned = q2; st.progress = round1(Math.min(100, st.qty_executed / q2 * 100)); if (st.progress < 100) st.completed_on = null
      return { ok: true }
    }
    if ((m = p.match(/^\/public\/works\/([\w-]+)\/reports$/))) {
      const w = db.works.find(x => x.qr_token === m[1]); if (!w) throw new ApiError('Work not found', 404)
      const { category, description = '', name, phone, lat, lng, file, voice } = body
      if (!['quality', 'usability', 'delay', 'safety'].includes(category)) throw new ApiError('Unknown category')
      const ph = validPhone(phone)
      if (description.trim().length < 5 && !(voice instanceof Blob)) throw new ApiError('Please describe the problem, or record a voice note')
      const evIds = []
      if (file instanceof Blob) evIds.push((await saveEvidence(w, { file, kind: 'photo', caption: 'Resident photo', lat, lng, source: 'citizen' })).id)
      if (voice instanceof Blob) evIds.push((await saveEvidence(w, { file: voice, kind: 'voice', caption: 'Resident voice note', source: 'citizen', allowed: ['audio'] })).id)
      const text = description.trim()
      const i = createIssue({ work: w, actor: null, source: 'citizen', category: category === 'delay' ? 'usability' : category,
        title: text ? text.split('\n')[0].slice(0, 80) : 'Voice report (listen to the recording)', description: text, evidence_id: evIds[0] ?? null,
        complainant_name: name || null, complainant_phone: ph })
      i.supporters = 0
      for (const x of evIds.slice(1)) byId('evidence', x).issue_id = i.id
      notifyStatus(i)
      return { ticket: i.ticket, track_key: i.track_key, status_label: STATUS_LABEL[i.status],
        sms: db.notifications.filter(n => n.ticket === i.ticket).map(n => ({ to: mask(n.phone), text: n.text, text_hi: n.text_hi })) }
    }
    if ((m = p.match(/^\/public\/issues\/([\w-]+)\/support$/))) {
      const i = db.issues.find(x => x.ticket === m[1].toUpperCase().trim())
      if (!i || i.source !== 'citizen' || TERMINAL.has(i.status)) throw new ApiError('Open report not found', 404)
      const ph = validPhone(body.phone), voter = voterId(ph)
      if (db.supports.some(x => x.issue_id === i.id && x.voter === voter)) throw new ApiError('You have already added your voice to this report', 409)
      insert('supports', { issue_id: i.id, voter, at: nowStamp() })
      i.supporters = (i.supporters || 0) + 1
      body.phone = ph
      let sms = []
      if (body.phone) {
        const en = `You have been added to report ${i.ticket}. You will get an SMS at every step.`, hn = `आपको शिकायत ${i.ticket} से जोड़ दिया गया है। हर कदम पर SMS मिलेगा।`
        sendSms(i.ticket, body.phone, en, hn)
        sms = [{ to: mask(body.phone), text: 'Kaarya Nigrani: ' + en, text_hi: 'कार्य निगरानी: ' + hn }]
      }
      return { ticket: i.ticket, supporters: i.supporters, sms }
    }
    if ((m = p.match(/^\/public\/works\/([\w-]+)\/usable$/))) {
      const w = db.works.find(x => x.qr_token === m[1]); if (!w) throw new ApiError('Work not found', 404)
      const voter = voterId(validPhone(body.phone)), v = db.votes.find(x => x.work_id === w.id && x.voter === voter)
      if (v) { v.usable = !!body.usable; v.at = nowStamp(); return { ok: true, updated: true } }
      insert('votes', { work_id: w.id, usable: !!body.usable, at: nowStamp(), voter })
      return { ok: true, updated: false }
    }
    if ((m = p.match(/^\/public\/track\/([\w-]+)\/appeal$/))) {
      const i = trackedIssue(m[1], body.key)
      appeal(i, body.reason || '')
      return { ok: true, status_label: STATUS_LABEL[i.status] }
    }
    if ((m = p.match(/^\/works\/(\d+)\/extensions$/))) {
      const me = requireOfficer(viewer), w = workFor(me, m[1])
      if (me.role !== 'EE') throw new ApiError('Time extensions are approved by the EE', 403)
      if (!DELAY_REASONS[body.reason_code]) throw new ApiError('Choose the reason for the extension')
      if (!body.new_end || body.new_end <= dueDate(w)) throw new ApiError('The new date must be after the current due date')
      if (!(body.note || '').trim()) throw new ApiError('Write why the extension is justified')
      insert('extensions', { work_id: w.id, old_end: dueDate(w), new_end: body.new_end, reason_code: body.reason_code, note: body.note.trim(), approved_by: me.id, approved_on: TODAY })
      auditRecord(w.id, 'work', w.id, 'time_extension', me, { due: dueDate(w) }, { due: body.new_end }, body.note.trim())
      w.revised_end = body.new_end
      return { ok: true }
    }
    if ((m = p.match(/^\/postchecks\/(\d+)$/))) {
      const me = requireOfficer(viewer), pc = byId('postchecks', Number(m[1]))
      if (!pc) throw new ApiError('Check not found', 404)
      if (!TECHNICAL.includes(me.role)) throw new ApiError('Re-checks are done by the AE or EE', 403)
      workFor(me, pc.work_id)
      evidenceOk(pc.work_id, body.evidence_id, me)
      if (pc.done_on) throw new ApiError('This re-check is already recorded', 409)
      if (!body.passed && !(body.note || '').trim()) throw new ApiError('Describe what is wrong')
      Object.assign(pc, { done_on: TODAY, done_by: me.id, passed: !!body.passed, note: (body.note || '').trim(), evidence_id: Number(body.evidence_id) })
      if (!body.passed) {
        const w = getWork(pc.work_id)
        createIssue({ work: w, actor: me, source: 'inspection', category: 'quality', title: `Post-monsoon re-check: ${pc.note.slice(0, 60)}`,
          description: pc.note + (w.dlp_end ? ` Repair is the contractor's duty under the defect liability period (until ${dmy(w.dlp_end)}).` : ''), evidence_id: pc.evidence_id })
      }
      return { ok: true }
    }
    if ((m = p.match(/^\/works\/(\d+)\/inspection$/))) {
      const me = requireOfficer(viewer), w = workFor(me, m[1])
      if (!TECHNICAL.includes(me.role)) throw new ApiError('Surprise inspections are done by the AE or EE', 403)
      if (!['ok', 'issues'].includes(body.outcome)) throw new ApiError('Choose what you found')
      evidenceOk(w.id, body.evidence_id, me)
      if (db.inspections.some(x => x.work_id === w.id && x.week === isoWeek(TODAY))) throw new ApiError("This week's inspection of this work is already recorded", 409)
      const note = (body.note || '').trim()
      if (body.outcome === 'issues' && !note) throw new ApiError('Describe what you found')
      insert('inspections', { work_id: w.id, week: isoWeek(TODAY), done_on: TODAY, done_by: me.id, outcome: body.outcome, note, evidence_id: Number(body.evidence_id) })
      if (body.outcome === 'issues') createIssue({ work: w, actor: me, source: 'inspection', category: 'quality', title: `Surprise inspection: ${note.slice(0, 60)}`, description: note, evidence_id: Number(body.evidence_id) })
      return { ok: true }
    }
    if (p === '/demo/reset') { reset(); return { ok: true } }
    if (p === '/auth/login') throw new ApiError('The synthetic demo uses the persona switcher, not passwords')
  }
  throw new ApiError(`No route for ${method} ${p}`, 404)
}
