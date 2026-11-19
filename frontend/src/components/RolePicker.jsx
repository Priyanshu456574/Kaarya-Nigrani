import { useApp } from '../App'
import { ROLE_NAMES, useT } from '../strings'

export const ROLE_NAME = ROLE_NAMES.en
const GROUPS = {
  en: ['District office', 'Rural Works Department', 'Building Construction Department', 'Nagar Parishad Khagaria', 'Revenue and block offices', 'Contractors'],
  hi: ['जिला कार्यालय', 'ग्रामीण कार्य विभाग', 'भवन निर्माण विभाग', 'नगर परिषद खगड़िया', 'राजस्व व प्रखंड कार्यालय', 'संवेदक'],
}
const TESTS = [
  o => ['DM', 'DDC'].includes(o.role), o => o.department === 'RWD', o => o.department === 'BCD',
  o => o.department === 'Nagar Parishad', o => ['CO', 'BDO'].includes(o.role), o => o.role === 'CONTRACTOR',
]
const ORDER = ['DM', 'DDC', 'EE', 'AE', 'JE', 'CO', 'BDO', 'CONTRACTOR']
const DEPT_HI = { RWD: 'ग्रामीण कार्य विभाग', BCD: 'भवन निर्माण विभाग', 'Nagar Parishad': 'नगर परिषद', Revenue: 'राजस्व', 'Rural Development': 'ग्रामीण विकास' }
const initials = (n) => n.replace(/^(Er\.|M\/s)\s*/, '').split(/\s+/).map(s => s[0]).slice(0, 2).join('')

export function describe(o, lang = 'en') {
  const r = ROLE_NAMES[lang]
  if (o.role === 'CONTRACTOR') return r.CONTRACTOR
  if (['DM', 'DDC'].includes(o.role)) return r[o.role]
  const dept = lang === 'hi' ? (DEPT_HI[o.department] || o.department) : o.department
  return `${r[o.role]}, ${dept}${o.block ? `, ${o.block}` : ''}`
}

/** Shows who you are acting as; the native select underneath keeps it accessible and phone-friendly. */
export default function RolePicker() {
  const { meta, user, setUserId } = useApp()
  const { L, lang, role } = useT()
  return (
    <label className="rolepick">
      <span className="avatar" aria-hidden="true">{initials(user.name)}</span>
      <span className="who">
        <small>{L.actingAs}</small>
        <b>{user.role === 'DM' ? role.DM : user.name.replace('Er. ', '')}</b>
        <span>{user.role === 'DM' ? (lang === 'hi' ? 'खगड़िया' : 'Khagaria') : describe(user, lang)}</span>
      </span>
      <span className="chev" aria-hidden="true">▾</span>
      <select value={user.id} onChange={e => setUserId(Number(e.target.value))} aria-label={L.actingAs}>
        {GROUPS[lang].map((label, gi) => (
          <optgroup key={label} label={label}>
            {meta.officers.filter(TESTS[gi]).sort((a, b) => ORDER.indexOf(a.role) - ORDER.indexOf(b.role)).map(o => (
              <option key={o.id} value={o.id}>{o.name}: {describe(o, lang)}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  )
}
