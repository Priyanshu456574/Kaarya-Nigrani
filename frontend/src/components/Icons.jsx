/* Simple line icons for resident screens, so choices are recognisable without reading. */
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' }

export const Icon = {
  report: (s = 36) => <svg width={s} height={s} viewBox="0 0 32 32" aria-hidden="true"><path {...P} d="M16 4l13 23H3z" /><path {...P} d="M16 13v7M16 24v.5" /></svg>,
  track: (s = 36) => <svg width={s} height={s} viewBox="0 0 32 32" aria-hidden="true"><circle {...P} cx="14" cy="14" r="9" /><path {...P} d="M21 21l7 7M10 14l3 3 5-6" /></svg>,
  works: (s = 36) => <svg width={s} height={s} viewBox="0 0 32 32" aria-hidden="true"><path {...P} d="M4 28h24M7 28V14l9-8 9 8v14" /><path {...P} d="M13 28v-8h6v8" /></svg>,
  quality: (s = 32) => <svg width={s} height={s} viewBox="0 0 32 32" aria-hidden="true"><path {...P} d="M3 24h26M6 24l4-10h12l4 10" /><path {...P} d="M15 14l2 4-3 2 2 4" /></svg>,
  usability: (s = 32) => <svg width={s} height={s} viewBox="0 0 32 32" aria-hidden="true"><path {...P} d="M3 26h12M17 26h12" /><path {...P} d="M15 26c0-4 2-4 2 0" /><path {...P} d="M6 20h20" strokeDasharray="3 3" /></svg>,
  safety: (s = 32) => <svg width={s} height={s} viewBox="0 0 32 32" aria-hidden="true"><path {...P} d="M5 27h22M8 27V12h16v15" /><path {...P} d="M8 17l16-5M8 22l16-5" /></svg>,
  delay: (s = 32) => <svg width={s} height={s} viewBox="0 0 32 32" aria-hidden="true"><circle {...P} cx="16" cy="16" r="12" /><path {...P} d="M13 11v10M19 11v10" /></svg>,
  mic: (s = 28) => <svg width={s} height={s} viewBox="0 0 32 32" aria-hidden="true"><rect {...P} x="11" y="3" width="10" height="17" rx="5" /><path {...P} d="M6 15a10 10 0 0020 0M16 25v4" /></svg>,
  phone: (s = 22) => <svg width={s} height={s} viewBox="0 0 32 32" aria-hidden="true"><rect {...P} x="9" y="3" width="14" height="26" rx="3" /><path {...P} d="M14 25h4" /></svg>,
  people: (s = 22) => <svg width={s} height={s} viewBox="0 0 32 32" aria-hidden="true"><circle {...P} cx="11" cy="11" r="4" /><circle {...P} cx="22" cy="12" r="3" /><path {...P} d="M4 26c0-5 3-8 7-8s7 3 7 8M18 26c0-3 2-6 5-6s5 3 5 6" /></svg>,
  lock: (s = 18) => <svg width={s} height={s} viewBox="0 0 32 32" aria-hidden="true"><rect {...P} x="7" y="14" width="18" height="14" rx="2.5" /><path {...P} d="M11 14v-4a5 5 0 0 1 10 0v4" /></svg>,
  chat: (s = 22) => <svg width={s} height={s} viewBox="0 0 32 32" aria-hidden="true"><path {...P} d="M5 6h22v16H13l-6 5v-5H5z" /></svg>,
}
