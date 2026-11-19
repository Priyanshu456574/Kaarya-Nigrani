import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useLang } from '../i18n'
import KhagariaMap from '../components/KhagariaMap'
import CitTop from './CitTop'

const BLOCKS = ['Alauli', 'Beldaur', 'Chautham', 'Gogri', 'Khagaria', 'Mansi', 'Parbatta']
const BLOCK_HI = { Alauli: 'अलौली', Beldaur: 'बेलदौर', Chautham: 'चौथम', Gogri: 'गोगरी', Khagaria: 'खगड़िया', Mansi: 'मानसी', Parbatta: 'परबत्ता' }

/** Step one for residents: pick your block, then the work. Remembers the block for next time. */
export default function PublicFind() {
  const { lang, t, toggle } = useLang()
  const [params] = useSearchParams()
  const report = params.get('then') === 'report'
  const [works, setWorks] = useState([])
  const [block, setBlockState] = useState(() => { try { return localStorage.getItem('kn-block') || '' } catch { return '' } })
  const [q, setQ] = useState('')
  const [map, setMap] = useState(false)
  useEffect(() => { api.get('/public/works').then(setWorks) }, [])
  const setBlock = (b) => { setBlockState(b); try { localStorage.setItem('kn-block', b) } catch { /* storage unavailable */ } }
  const list = useMemo(() => works.filter(w => (!block || w.block === block) &&
    (!q || `${w.name} ${w.village} ${w.code}`.toLowerCase().includes(q.toLowerCase()))), [works, block, q])
  const bname = (b) => lang === 'hi' ? BLOCK_HI[b] : b

  return (
    <div className="cit" lang={lang}>
      <CitTop t={t} toggle={toggle} />
      <section className="cit-sec">
        <Link to="/public" className="small">{t.home}</Link>
        <h1 className="cit-q">{t.pickBlock}</h1>
        <div className="blockgrid" role="group" aria-label={t.pickBlock}>
          {BLOCKS.map(b => <button key={b} className={`blockbtn ${block === b ? 'on' : ''}`} onClick={() => setBlock(block === b ? '' : b)} aria-pressed={block === b}>{bname(b)}</button>)}
        </div>
      </section>
      {block && (
        <section className="cit-sec">
          <div className="find-head">
            <h2>{report ? t.pickWork : t.worksIn(bname(block))}</h2>
            <button className="linkbtn" onClick={() => setMap(!map)}>{map ? t.hideMap : t.onMap}</button>
          </div>
          {map && <div className="citmap"><KhagariaMap works={list.map(w => ({ ...w, id: null }))} height={260} selectedBlock={block} /></div>}
          {list.length > 6 && <input className="citsearch" value={q} onChange={e => setQ(e.target.value)} placeholder={t.search} aria-label={t.search} />}
          <ul className="worklist-cit">
            {list.map(w => (
              <li key={w.code}>
                <Link to={`/w/${w.qr_token}${report ? '?report=1' : ''}`}>
                  <b>{w.name}</b>
                  <span className="muted small">{w.village}. {t.wstatus[w.status]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
