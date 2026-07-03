export const meta = {
  name: 'self-repair-loop',
  description: 'Produce one artifact, run a gate, feed failure diagnostics back into the next attempt — bounded by an attempt cap.',
  phases: [{ title: 'Produce' }, { title: 'Gate' }],
}
const GATE = { type: 'object', properties: { pass: { type: 'boolean' }, diagnostics: { type: 'string' } }, required: ['pass'] }

// single-artifact convergence: same item repaired each round; the FUSE is the attempt count, not dedup.
const MAX_ATTEMPTS = 4
let diagnostics = ''
let artifact = null
let attempt = 0
while (attempt < MAX_ATTEMPTS) {
  attempt++
  artifact = await agent(
    `Produce the artifact for <GOAL>.${diagnostics ? `\nThe previous attempt failed the gate — fix these diagnostics:\n${diagnostics}` : ''}`,
    { label: `attempt-${attempt}`, phase: 'Produce' })
  const gate = await agent(`Run the gate on this artifact (build/tests/lint). Return pass + diagnostics.\n${artifact}`,
    { label: `gate-${attempt}`, phase: 'Gate', schema: GATE })
  if (gate.pass) { log(`passed on attempt ${attempt}`); return { artifact, attempts: attempt, passed: true } }
  diagnostics = gate.diagnostics ?? ''
  log(`attempt ${attempt} failed the gate; retrying`)
}
return { artifact, attempts: attempt, passed: false }
