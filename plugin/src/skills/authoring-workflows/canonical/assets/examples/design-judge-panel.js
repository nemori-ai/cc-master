export const meta = {
  name: 'design-judge-panel',
  description: 'Generate N independent design approaches, score with a judge panel, synthesize from the winner.',
  phases: [{ title: 'Propose' }, { title: 'Judge' }, { title: 'Synthesize' }],
}
const ANGLES = ['MVP-first (smallest shippable)', 'risk-first (de-risk the unknowns)', 'user-first (best UX regardless of cost)']
const PROPOSAL = { type: 'object', properties: { summary: { type: 'string' }, tradeoffs: { type: 'string' } }, required: ['summary'] }
const SCORE = { type: 'object', properties: { score: { type: 'number' }, rationale: { type: 'string' } }, required: ['score'] }

const proposals = await parallel(ANGLES.map((a) => () =>
  agent(`Design an approach to <GOAL> from this angle: ${a}. Return summary + tradeoffs.`, { phase: 'Propose', schema: PROPOSAL })
    .then((p) => ({ angle: a, ...p }))))
const scored = await parallel(proposals.filter(Boolean).map((p) => () =>
  agent(`Score this approach 0-10 for <GOAL>:\n${JSON.stringify(p)}`, { phase: 'Judge', schema: SCORE })
    .then((s) => ({ ...p, score: s.score }))))
const ranked = scored.filter(Boolean).sort((a, b) => b.score - a.score)
const winner = ranked[0]
const synthesis = await agent(
  `Synthesize a final design for <GOAL> based primarily on the winner, grafting the best ideas from runners-up.\nWINNER:\n${JSON.stringify(winner)}\nOTHERS:\n${JSON.stringify(ranked.slice(1))}`,
  { phase: 'Synthesize' })
return { winner, synthesis }
