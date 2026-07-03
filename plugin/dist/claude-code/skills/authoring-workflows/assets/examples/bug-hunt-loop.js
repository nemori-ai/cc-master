export const meta = {
  name: 'bug-hunt-loop',
  description: 'Hunt bugs repo-wide until K dry rounds, then adversarially verify each survivor before reporting.',
  phases: [{ title: 'Hunt' }, { title: 'Verify' }],
}
const BUGS = { type: 'object', properties: { bugs: { type: 'array', items: { type: 'object',
  properties: { id: { type: 'string' }, file: { type: 'string' }, detail: { type: 'string' } },
  required: ['id', 'file'] } } }, required: ['bugs'] }
const VERDICT = { type: 'object', properties: { isReal: { type: 'boolean' }, why: { type: 'string' } }, required: ['isReal'] }

// loop-until-dry: counters miss the tail; stop after DRY_LIMIT rounds that surface nothing new.
// dedup against `seen` (not a confirmed set) so rejected bugs don't reappear every round.
const DRY_LIMIT = 2
const seen = new Set(), found = []
let dry = 0
while (dry < DRY_LIMIT) {
  const r = await agent(`Hunt for bugs anywhere in the repo NOT already in this seen set: ${JSON.stringify([...seen])}. Return bugs[].`,
    { label: `hunt#${found.length}`, phase: 'Hunt', schema: BUGS })
  const fresh = (r?.bugs ?? []).filter((b) => !seen.has(b.id))
  if (fresh.length === 0) { dry++; continue }
  dry = 0
  fresh.forEach((b) => { seen.add(b.id); found.push(b) })
  log(`+${fresh.length} bugs (total ${found.length})`)
}
// adversarial verify: each survivor must withstand a skeptic. Default isReal=false if unsure.
const verified = await parallel(found.map((b) => () =>
  agent(`Try to REFUTE this bug — prove it is NOT real. Default isReal=false if evidence is thin:\n${JSON.stringify(b)}`,
    { label: `verify:${b.file}`, phase: 'Verify', schema: VERDICT }).then((v) => ({ ...b, verdict: v }))))
return verified.filter(Boolean).filter((b) => b.verdict?.isReal)
