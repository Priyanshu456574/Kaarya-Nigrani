import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { NavLink, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { api, DEMO, setApiUser, setToken } from './api'
import Dashboard from './pages/Dashboard'
import WorkDetail from './pages/WorkDetail'
import Tasks from './pages/Tasks'
import PublicFind from './pages/PublicFind'
import PublicHome from './pages/PublicHome'
import PublicWork from './pages/PublicWork'
import Track from './pages/Track'
import RolePicker from './components/RolePicker'
import DemoGuide from './components/DemoGuide'
import { LangContext, useLangState } from './i18n'
import { useT } from './strings'

const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)

function readUser() {
  try { return Number(localStorage.getItem('kn-user')) || null } catch { return null }
}

export default function App() {
  const [meta, setMeta] = useState(null)
  const [userId, setUserId] = useState(readUser)
  const [toast, setToast] = useState(null)
  const [lastTicket, setLastTicket] = useState(null)
  const [session, setSession] = useState(null)  // pilot mode only; token is kept in memory, never in storage
  const loc = useLocation()
  const isPublic = loc.pathname.startsWith('/w/') || loc.pathname.startsWith('/track') || loc.pathname.startsWith('/public')

  useEffect(() => { api.get('/meta').then(setMeta) }, [session])
  useEffect(() => {
    if (!meta) return
    if (meta.mode === 'pilot') { setUserId(session?.officer.id ?? null); return }
    const valid = meta.officers.find(o => o.id === userId)
    setUserId(valid ? userId : meta.officers.find(o => o.role === 'DM')?.id)
  }, [meta])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    try { if (userId) localStorage.setItem('kn-user', String(userId)) } catch { /* storage unavailable */ }
  }, [userId])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3200); return () => clearTimeout(t) }, [toast])
  useEffect(() => { window.scrollTo(0, 0) }, [loc.pathname])

  const langState = useLangState(isPublic)
  const user = meta?.officers.find(o => o.id === userId)
  const signOut = () => { setToken(null); setSession(null); setUserId(null) }
  const value = useMemo(() => ({ meta, user, setUserId, setToast, lastTicket, setLastTicket, signOut }), [meta, user, lastTicket])
  setApiUser(isPublic || meta?.mode === 'pilot' ? null : userId)
  if (meta?.mode === 'pilot' && !isPublic && !session) return <LangContext.Provider value={langState}><Login onLogin={(r) => { setToken(r.token); setSession(r) }} /></LangContext.Provider>
  if (!meta || (!isPublic && !user)) return <div className="page muted">Loading…</div>

  return (
    <LangContext.Provider value={langState}>
    <Ctx.Provider value={value}>
      {isPublic ? (
        <>
          {DEMO && <ResidentStrip />}
          <Routes>
            <Route path="/public" element={<PublicHome />} />
            <Route path="/public/find" element={<PublicFind />} />
            <Route path="/w/:qr" element={<PublicWork />} />
            <Route path="/track" element={<Track />} />
            <Route path="/track/:ticket" element={<Track />} />
          </Routes>
        </>
      ) : (
        <OfficerShell userId={userId} />
      )}
      {DEMO && <DemoGuide />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </Ctx.Provider>
    </LangContext.Provider>
  )
}

function Login({ onLogin }) {
  const { L } = useT()
  const [id, setId] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr('')
    try { onLogin(await api.post('/auth/login', { officer_id: Number(id), password: pw })) } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  return (
    <main className="page login">
      <form className="panel form" onSubmit={submit}>
        <h1>{L.loginTitle}</h1>
        <div className="field"><label htmlFor="lid">{L.loginId}</label><input id="lid" inputMode="numeric" autoComplete="username" value={id} onChange={e => setId(e.target.value)} /></div>
        <div className="field"><label htmlFor="lpw">{L.loginPw}</label><input id="lpw" type="password" autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} /></div>
        {err && <p className="error" role="alert">{err}</p>}
        <button className="btn" disabled={busy || !id || !pw}>{L.loginBtn}</button>
        <p className="small muted">{L.loginNote}</p>
      </form>
    </main>
  )
}

function OfficerShell({ userId }) {
  const { L, lang, setLang } = useT()
  const { user, meta, signOut } = useApp()
  const isDistrict = ['DM'].includes(user.role)
  const [count, setCount] = useState(null)
  const loc = useLocation()
  useEffect(() => { if (!isDistrict) api.get('/tasks').then(ts => setCount(ts.length)).catch(() => {}) }, [userId, loc.pathname, isDistrict])
  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <Link to="/" className="brand"><BoardIcon /><span>Kaarya Nigrani<small>{L.brandSub}</small></span></Link>
          <nav className="topnav" aria-label="Main">
            {!isDistrict && <NavLink to="/" end>{L.navTasks}{count ? <span className="navcount">{count}</span> : null}</NavLink>}
            <NavLink to={isDistrict ? '/' : '/review'} end>{L.navWorksScope[{ DM: 'district', DDC: 'district', EE: 'department' }[user.role] || 'own']}</NavLink>
            {DEMO ? <NavLink to="/public">{L.navResident}</NavLink> : <a href="/public" target="_blank" rel="noreferrer">{L.navResident}</a>}
          </nav>
          <button className="langswitch" onClick={() => setLang(lang === 'hi' ? 'en' : 'hi')} aria-label={L.langLabel} lang={lang === 'hi' ? 'en' : 'hi'}>
            <span aria-hidden="true">अ/A</span>{L.langBtn}
          </button>
          {meta.mode === 'pilot' ? <button className="btn secondary sm" onClick={signOut}>{L.logout}</button> : <RolePicker />}
        </div>
      </header>
      {meta.mode !== 'pilot' && <div className="demobanner" role="note">{L.demoBanner}</div>}
      <Routes key={userId}>
        <Route path="/" element={isDistrict ? <Dashboard /> : <Tasks />} />
        <Route path="/review" element={<Dashboard />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/my" element={<Navigate to="/" replace />} />
        <Route path="/works/:id" element={<WorkDetail />} />
      </Routes>
    </>
  )
}

function ResidentStrip() {
  const { lang } = useT()
  return (
    <div className="demostrip">
      <span>{lang === 'hi' ? 'नागरिक दृश्य। असल में निवासी साइट बोर्ड पर लगा QR कोड स्कैन करके यहाँ पहुँचते हैं।' : 'Resident view. In real use, residents reach this page by scanning the QR code on the site board.'}</span>
      <Link to="/">{lang === 'hi' ? 'अधिकारी दृश्य पर लौटें' : 'Back to officer view'}</Link>
    </div>
  )
}

function BoardIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 64 64" aria-hidden="true">
      <rect x="10" y="12" width="44" height="28" rx="3" fill="none" stroke="#fff" strokeWidth="4" />
      <path d="M22 40v14M42 40v14" stroke="#fff" strokeWidth="4" />
      <path d="M17 32l9-8 8 6 12-11" fill="none" stroke="#E8B931" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
