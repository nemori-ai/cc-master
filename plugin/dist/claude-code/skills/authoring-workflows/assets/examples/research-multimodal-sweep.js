export const meta = {
  name: 'research-multimodal-sweep',
  description: 'Sweep a question from several search angles, dedup, deep-read, then critique for completeness.',
  phases: [{ title: 'Sweep' }, { title: 'Deep-read' }, { title: 'Critique' }],
}
const ANGLES = ['by keyword/grep', 'by entity/symbol', 'by structure/architecture', 'by history/changelog']
const HITS = { type: 'object', properties: { hits: { type: 'array', items: { type: 'string' } } }, required: ['hits'] }

// barrier IS correct here: we must dedup across ALL angles before the expensive deep-read.
const swept = await parallel(ANGLES.map((a) => () =>
  agent(`Research <QUESTION> ${a}. Return concrete source refs as hits[].`, { phase: 'Sweep', schema: HITS })))
const deduped = [...new Set(swept.filter(Boolean).flatMap((r) => r.hits ?? []))]
const reads = await pipeline(deduped,
  (ref) => agent(`Deep-read ${ref} and extract what answers <QUESTION>.`, { phase: 'Deep-read' }))
const critique = await agent(
  `Given these findings for <QUESTION>, what is MISSING — an angle not swept, a claim unverified, a source unread?\n${JSON.stringify(reads.filter(Boolean))}`,
  { phase: 'Critique' })
return { findings: reads.filter(Boolean), gaps: critique }
