let currentUser = null
let token = null  // pilot mode: signed session token from /api/auth/login (kept in memory only)
export function setApiUser(id) { currentUser = id }
export function setToken(t) { token = t }

/** Server errors carry a message, and for blocked certification / claims, the list of unmet conditions. */
export function apiError(detail, status) {
  const d = typeof detail === 'object' && detail !== null && !Array.isArray(detail) ? detail : null
  const text = d ? d.message : Array.isArray(detail) ? detail.map(x => x.msg).join('; ') : detail
  return Object.assign(new Error(text || `Request failed (${status})`), { status, blockers: d?.blockers || null })
}

async function handle(r) {
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw apiError(body.detail, r.status)
  return body
}

function headers(extra = {}) {
  const h = { ...extra }
  if (token) h.Authorization = `Bearer ${token}`
  else if (currentUser) h['X-User'] = String(currentUser)
  return h
}

export const DEMO = import.meta.env.VITE_DEMO === '1'

async function demoCall(method, path, body) {
  const { handle: run } = await import('./demo/engine.js')
  try {
    // copy so the engine never shares objects with React state
    return structuredClone(await run(method, path, body, currentUser))
  } catch (e) { throw apiError(e.extra || e.message, e.status) }
}

const live = {
  get: (path) => fetch(`/api${path}`, { headers: headers() }).then(handle),
  post: (path, json) => fetch(`/api${path}`, {
    method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(json ?? {}),
  }).then(handle),
  form: (path, data) => {
    const fd = new FormData()
    Object.entries(data).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') fd.append(k, v) })
    return fetch(`/api${path}`, { method: 'POST', headers: headers(), body: fd }).then(handle)
  },
}

const demo = {
  get: (path) => demoCall('GET', path),
  post: (path, json) => demoCall('POST', path, json ?? {}),
  form: (path, data) => demoCall('POST', path, Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined && v !== null && v !== ''))),
}

export const api = DEMO ? demo : live

export const fmtDate = (s) => s ? new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
export const fmtDateTime = (s) => s ? new Date(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—'
export const lakh = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 1 })} lakh`

export const WORK_STATUS = {
  SANCTIONED: 'Not started',
  IN_PROGRESS: 'In progress',
  REPORTED_COMPLETE: 'Claimed complete',
  USABLE_VERIFIED: 'Certified usable',
}

export const ACTION_LABEL = {
  acknowledge: 'Acknowledge',
  examine: 'Start examination',
  verify: 'Record verified defect',
  reject: 'Record as not substantiated',
  assign: 'Assign action',
  rectified: 'Report rectified',
  close: 'Verify and close',
  reopen: 'Reopen: not satisfactory',
}

export const ACTION_DONE = {
  acknowledge: 'Acknowledged',
  examine: 'Examination started',
  verify: 'Verified defect recorded',
  reject: 'Recorded as not substantiated',
  assign: 'Action assigned',
  rectified: 'Rectification reported',
  close: 'Verified and closed',
  reopen: 'Reopened',
}
