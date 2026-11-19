// Browser checks of the main journeys. Usage: node e2e/journeys.mjs <base-url> [demo]
// live: base = http://localhost:8000 (FastAPI serving the built app); demo: base = static dist-demo URL (hash routes)
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')  // uses the globally installed Playwright

const BASE = process.argv[2] || 'http://localhost:8000'
const DEMO = process.argv[3] === 'demo'
const R = (p) => DEMO ? `${BASE}/#${p}` : `${BASE}${p}`
const results = []
const ok = (name, cond, extra = '') => { results.push([cond ? 'PASS' : 'FAIL', name, extra]); return cond }

const browser = await chromium.launch()
async function page(width = 1280, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height } })
  const p = await ctx.newPage()
  p.errors = []
  p.on('pageerror', e => p.errors.push(String(e)))
  p.on('console', m => { if (m.type() === 'error' && !/favicon|tile\.openstreetmap|Failed to load resource/.test(m.text())) p.errors.push(m.text()) })
  return p
}
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
async function asUser(p, id) { await p.goto(R('/')); await p.evaluate(i => localStorage.setItem('kn-user', String(i)), id); }

// discover ids through the UI's own API layer
const p0 = await page()
await p0.goto(R('/'))
await p0.waitForSelector('h1', { timeout: 20000 })
const meta = await p0.evaluate(async (demo) => {
  if (demo) return null
  return (await fetch('/api/meta')).json()
}, DEMO)
const officers = meta?.officers  // demo mode: persona-specific checks are covered by scripts/parity.py instead
const byRole = (r, part = '') => officers?.find(o => o.role === r && o.name.includes(part))?.id

// 1. DM decision room
ok('DM sees the decision queue', await p0.getByRole('heading', { name: 'Needs your decision today' }).isVisible())
ok('decision queue names the CO hold-up', (await p0.locator('.declist').innerText()).includes('Alauli – Hardiya'))
ok('demo banner says data is synthetic', await p0.locator('.demobanner').isVisible())
await p0.screenshot({ path: 'e2e/out-dm.png', fullPage: false })

// 2. GOG-R-014: approved / reported / verified and certification blocked with reasons
await p0.locator('.declist li', { hasText: 'Gogri Bazaar' }).first().locator('a').click()
await p0.waitForSelector('.tabs')
await p0.getByRole('tab', { name: /Overview/ }).click()
await p0.waitForSelector('.verdict')
const layers = await p0.locator('.figures4').innerText() + ' ' + await p0.locator('.verdict').innerText()
ok('reported and engineer-checked shown side by side', /reported done/i.test(layers) && /checked by engineer/i.test(layers))
ok('one plain sentence explains the gap', /engineer has checked only 75%/.test(layers), layers.replace(/\n/g, ' | ').slice(0, 160))
const ready = await p0.locator('.readiness').innerText()
ok('certification blocked, reasons in plain words', /Not yet/.test(ready) && /re-measured/.test(ready))
await p0.getByRole('tab', { name: /Money/ }).click()
const money = await p0.locator('.money2').innerText()
ok('money tab separates bills from payments', /Bills raised/.test(money) && /Actually paid/.test(money))
ok('sample payments labelled', await p0.getByText(/Sample payment records/).isVisible())
await p0.screenshot({ path: 'e2e/out-gog-money.png' })

// 3. Hindi
await p0.getByRole('tab', { name: /Overview/ }).click()
await p0.waitForSelector('.verdict')
await p0.locator('.langswitch').click()
ok('Hindi labels render', /अभियंता ने जाँचा/.test(await p0.locator('.figures4').innerText()))
await p0.locator('.langswitch').click()

// 4. contractor view: no audit, no suspicion flags, own works only
if (!DEMO) {
  await asUser(p0, byRole('CONTRACTOR', 'Kosi'))
  const kd = await (await fetch(`${BASE}/api/dashboard`, { headers: { 'X-User': String(byRole('CONTRACTOR', 'Kosi')) } })).json()
  ok('contractor does not see ALA-R-007', !kd.works.some(w => w.code === 'ALA-R-007'))
  await p0.goto(R(`/works/${kd.works.find(w => w.code === 'GOG-R-014').id}`))
  await p0.waitForSelector('.verdict')
  await p0.getByRole('tab', { name: /Money/ }).click()
  ok('contractor has no decision history', !(await p0.getByText('History of decisions').count()))
  // JE of ALA-D-002 cannot claim completion at 41%
  const ala = (await (await fetch(`${BASE}/api/dashboard`, { headers: { 'X-User': String(byRole('DM')) } })).json()).works.find(w => w.code === 'ALA-D-002')
  const det = await (await fetch(`${BASE}/api/works/${ala.id}`, { headers: { 'X-User': String(byRole('DM')) } })).json()
  await asUser(p0, det.people.je.id)
  await p0.goto(R(`/works/${ala.id}`))
  await p0.waitForSelector('.verdict')
  const claimBtn = p0.getByRole('button', { name: 'Claim completion' })
  ok('JE claim button disabled at 41%', await claimBtn.isDisabled())
  ok('JE sees why the claim is blocked', await p0.getByText('You can report it complete once this is done:').isVisible())
  await p0.screenshot({ path: 'e2e/out-je-claim.png' })

  // 5. resident: report, private tracking, appeal of a closed report
  const pub = await (await fetch(`${BASE}/api/public/works`)).json()
  const gog = pub.find(w => w.code === 'GOG-R-014')
  const fd = new FormData(); fd.append('category', 'quality'); fd.append('description', 'Cracks near the school gate')
  const rep = await (await fetch(`${BASE}/api/public/works/${gog.qr_token}/reports`, { method: 'POST', body: fd })).json()
  const rp = await page(360, 760)
  await rp.goto(R(`/track/${rep.ticket}`))
  await rp.waitForSelector('.trackform')
  ok('ticket alone does not open tracking', !(await rp.locator('.timeline').count()))
  await rp.goto(R(`/track/${rep.ticket}?k=${encodeURIComponent(rep.track_key)}`))
  await rp.waitForSelector('.timeline')
  ok('ticket + code opens tracking', (await rp.locator('.timeline li').count()) >= 1 && (await rp.locator('.cit').innerText()).includes(rep.ticket))
  ok('resident track page fits 360px', await noOverflow(rp))
  await rp.screenshot({ path: 'e2e/out-track-360.png', fullPage: true })
  rp.errors.length && ok('resident page console clean', false, rp.errors.join(' | '))
}

// 6. mobile widths for officer pages
const m = await page(360, 760)
await m.goto(R('/'))
await m.waitForSelector('h1')
ok('dashboard fits 360px', await noOverflow(m))
await m.locator('.declist li', { hasText: 'Gogri Bazaar' }).first().locator('a').click()
await m.waitForSelector('.tabs')
await m.getByRole('tab', { name: /Overview/ }).click()
await m.waitForSelector('.verdict')
ok('work page fits 360px', await noOverflow(m))
await m.getByRole('tab', { name: /Money/ }).click()
ok('money tab fits 360px', await noOverflow(m))
await m.screenshot({ path: 'e2e/out-work-360.png', fullPage: true })

for (const p of [p0, m]) if (p.errors.length) ok('officer pages console clean', false, p.errors.slice(0, 3).join(' | '))
await browser.close()
for (const [s, n, e] of results) console.log(s, n, e ? `(${e})` : '')
const failed = results.filter(r => r[0] === 'FAIL').length
console.log(`${results.length - failed}/${results.length} checks passed`)
process.exit(failed ? 1 : 0)
