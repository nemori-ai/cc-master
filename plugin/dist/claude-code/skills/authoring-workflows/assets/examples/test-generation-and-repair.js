export const meta = {
  name: 'test-generation-and-repair',
  description: 'Generate tests for each module, then self-repair every failing suite to green with a bounded attempt cap.',
  phases: [{ title: 'Generate' }, { title: 'Repair' }],
}
const GATE = { type: 'object', properties: { pass: { type: 'boolean' }, diagnostics: { type: 'string' } }, required: ['pass'] }
const MAX_ATTEMPTS = 3

const modules = args ?? ['MODULE_A', 'MODULE_B', 'MODULE_C']
// pipeline (streaming): stage 1 generates a suite per module; stage 2 runs that module's own
// self-repair loop — module A can be repairing while module B is still generating.
const out = await pipeline(modules,
  (mod) => agent(`Generate a test suite for ${mod}. Write the test file, then run it once. Return diagnostics.`,
    { label: `gen:${mod}`, phase: 'Generate' }).then((tests) => ({ mod, tests })),
  async (gen) => {
    let diagnostics = ''
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const gate = await agent(
        `Run the test suite for ${gen.mod}.${diagnostics ? `\nIt failed last time — fix the suite (or the module) for:\n${diagnostics}` : ''}\nReturn pass + diagnostics.`,
        { label: `repair:${gen.mod}#${attempt}`, phase: 'Repair', schema: GATE })
      if (gate.pass) return { mod: gen.mod, attempts: attempt, green: true }
      diagnostics = gate.diagnostics ?? ''
      log(`${gen.mod}: attempt ${attempt} red; retrying`)
    }
    return { mod: gen.mod, attempts: MAX_ATTEMPTS, green: false }
  },
)
return out.filter(Boolean)
