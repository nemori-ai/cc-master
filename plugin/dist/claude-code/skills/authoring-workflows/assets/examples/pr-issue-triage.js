export const meta = {
  name: 'pr-issue-triage',
  description: 'Scout open PRs/issues, fan out a classifier over each, then judge the batch into a prioritized queue.',
  phases: [{ title: 'Scout' }, { title: 'Classify' }, { title: 'Judge' }],
}
const ITEMS = { type: 'object', properties: { items: { type: 'array', items: { type: 'string' } } }, required: ['items'] }
const LABEL = { type: 'object', properties: { category: { type: 'string' }, severity: { type: 'string' },
  effort: { type: 'string' }, summary: { type: 'string' } }, required: ['category', 'severity'] }
const QUEUE = { type: 'object', properties: { order: { type: 'array', items: { type: 'string' } }, rationale: { type: 'string' } }, required: ['order'] }

// scout-then-fanout entry shape: one scout enumerates the work-list we don't know up front.
const scout = await agent('List every open PR and issue (number + title). Return items[].', { phase: 'Scout', schema: ITEMS })
// fan-out: classifications are independent, and the judge below needs the WHOLE batch to rank — so barrier.
const classified = await parallel((scout?.items ?? []).map((it) => () =>
  agent(`Classify this PR/issue — category (bug/feature/docs/chore), severity, effort, one-line summary:\n${it}`,
    { label: `classify:${it.slice(0, 24)}`, phase: 'Classify', schema: LABEL }).then((c) => ({ item: it, ...c }))))
const batch = classified.filter(Boolean)
// judge over the whole batch: relative prioritization needs every item's labels at once.
const queue = await agent(`Order this triaged batch into a prioritized work queue. Return order[] (by item) + rationale.\n${JSON.stringify(batch)}`,
  { phase: 'Judge', schema: QUEUE })
return { triaged: batch, queue }
