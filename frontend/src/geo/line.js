/* Chainage helpers for drawing alignments (mirror of backend geo.py). */
const M_LAT = 110570
const mLng = (lat) => 111320 * Math.cos(lat * Math.PI / 180)
const segLen = (a, b) => Math.hypot((b[1] - a[1]) * mLng(a[0]), (b[0] - a[0]) * M_LAT) / 1000

/** The part of a polyline between two chainages (km). */
export function sliceLine(line, from, to) {
  const out = []
  let run = 0
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1], L = segLen(a, b)
    const s0 = run, s1 = run + L
    if (s1 >= from && s0 <= to) {
      const t0 = Math.max(0, (from - s0) / (L || 1)), t1 = Math.min(1, (to - s0) / (L || 1))
      const p = (t) => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
      if (!out.length) out.push(p(t0))
      out.push(p(t1))
    }
    run = s1
  }
  return out
}
