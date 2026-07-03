export const meta = {
  name: 'review-adversarial-verify',
  description: 'Review changed code across dimensions; adversarially verify each finding before reporting.',
  phases: [{ title: 'Review' }, { title: 'Verify' }],
}
const DIMENSIONS = [
  { key: 'bugs', prompt: 'Find correctness bugs in the changed files. Return findings[].' },
  { key: 'security', prompt: 'Find security issues in the changed files. Return findings[].' },
  { key: 'perf', prompt: 'Find performance regressions in the changed files. Return findings[].' },
]
const FINDINGS = { type: 'object', properties: { findings: { type: 'array', items: { type: 'object',
  properties: { title: { type: 'string' }, file: { type: 'string' }, detail: { type: 'string' } },
  required: ['title', 'file'] } } }, required: ['findings'] }
const VERDICT = { type: 'object', properties: { isReal: { type: 'boolean' }, why: { type: 'string' } }, required: ['isReal'] }

const results = await pipeline(DIMENSIONS,
  (d) => agent(d.prompt, { label: `review:${d.key}`, phase: 'Review', schema: FINDINGS }),
  (review, d) => parallel((review.findings ?? []).map((f) => () =>
    agent(`Adversarially verify this ${d.key} finding — try to REFUTE it. Default isReal=false if unsure:\n${JSON.stringify(f)}`,
      { label: `verify:${f.file}`, phase: 'Verify', schema: VERDICT })
      .then((v) => ({ ...f, dimension: d.key, verdict: v })))),
)
return results.flat().filter(Boolean).filter((f) => f.verdict?.isReal)
