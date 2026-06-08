export const meta = {
  name: 'staged-escalation',
  description: 'Try each item with a cheap pass first; escalate to the strong model only where the cheap pass returned low confidence.',
  phases: [{ title: 'Cheap pass' }, { title: 'Escalate' }],
}
const CHEAP = { type: 'object', properties: { answer: { type: 'string' }, confidence: { type: 'number' } }, required: ['answer', 'confidence'] }
const STRONG_MODEL = 'claude-opus-4-8' // model is part of the cache key — keep it a literal so resume is stable.
const THRESHOLD = 0.8

const items = args ?? ['ITEM_A', 'ITEM_B', 'ITEM_C']
// pipeline: stage 2 SHORT-CIRCUITS when the cheap pass already cleared the threshold (no strong-model spend).
const out = await pipeline(items,
  (it) => agent(`Answer for ${it}. Return answer + confidence (0-1).`, { label: 'cheap', phase: 'Cheap pass', schema: CHEAP })
    .then((r) => ({ item: it, ...r })),
  (prev, it) => prev.confidence >= THRESHOLD
    ? { ...prev, escalated: false }
    : agent(`The cheap pass was low-confidence (${prev.confidence}) for ${it}. Re-answer carefully.\nPREVIOUS:\n${prev.answer}`,
        { label: 'escalate', phase: 'Escalate', model: STRONG_MODEL, schema: CHEAP })
        .then((r) => ({ item: it, ...r, escalated: true })),
)
return out.filter(Boolean)
