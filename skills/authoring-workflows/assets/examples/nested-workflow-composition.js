export const meta = {
  name: 'nested-workflow-composition',
  description: 'Compose saved/file workflows as sub-steps via workflow(): audit each module with a reusable child run, degrade gracefully when a child is missing or fails.',
  phases: [{ title: 'Scope' }, { title: 'Audit' }, { title: 'Synthesize' }],
}
const MODULES = { type: 'object', properties: { modules: { type: 'array', items: { type: 'object',
  properties: { path: { type: 'string' }, risk: { type: 'string', enum: ['high', 'medium', 'low'] } },
  required: ['path', 'risk'] } } }, required: ['modules'] }
const SUMMARY = { type: 'object', properties: { verdict: { type: 'string' }, top_issues: { type: 'array', items: { type: 'string' } } }, required: ['verdict', 'top_issues'] }

// workflow() composes a whole child run as ONE step of this script: the child shares this run's
// concurrency cap, agent counter, abort signal, and token budget — its agents show under a
// "▸ name" group, its tokens count toward budget.spent(). Nesting is ONE level: a child that
// itself calls workflow() throws, so keep children leaf-shaped (pure agent()/pipeline() scripts).
const scoped = await agent('List the source modules of this repo worth a security audit. Return modules[] with path + risk (high/medium/low).',
  { phase: 'Scope', schema: MODULES })

// Reuse a saved child per high-risk module. workflow() THROWS on unknown name / unreadable
// scriptPath / child syntax error — catch per item so one broken child degrades that module
// to an inline single-agent fallback instead of killing the whole parent run.
const audits = await pipeline((scoped?.modules ?? []).filter((m) => m.risk !== 'low'),
  (m) => workflow('security-audit-module', { target: m.path })   // child's `args` = {target}
    .catch(() => agent(`Audit ${m.path} for injection, authz bypass, and unsafe deserialization. Return findings as plain text.`,
      { label: `fallback:${m.path}`, phase: 'Audit' }))
    .then((r) => ({ module: m.path, report: r })))

const done = audits.filter(Boolean)
log(`audited ${done.length}/${(scoped?.modules ?? []).length} modules (low-risk skipped — saying so beats silent truncation)`)
const summary = await agent(`Synthesize one verdict from these per-module audit reports:\n${JSON.stringify(done)}`,
  { phase: 'Synthesize', schema: SUMMARY })
return { perModule: done, ...summary }
