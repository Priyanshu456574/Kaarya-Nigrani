// Runs the in-browser demo engine under Node for the parity check (scripts/parity.py). One JSON request per line.
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { handle } from '../src/demo/engine.js'

const rl = createInterface({ input: process.stdin })
for await (const line of rl) {
  const { m, p, b, u, files } = JSON.parse(line)
  const body = { ...(b || {}) }
  for (const [k, f] of Object.entries(files || {})) body[k] = new Blob([readFileSync(f)])
  try {
    const out = await handle(m, p, body, u)
    process.stdout.write(JSON.stringify({ status: 200, body: out }) + '\n')
  } catch (e) {
    process.stdout.write(JSON.stringify({ status: e.status || 500, body: { detail: e.extra || e.message } }) + '\n')
  }
}
