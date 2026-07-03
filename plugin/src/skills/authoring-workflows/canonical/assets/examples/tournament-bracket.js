export const meta = {
  name: 'tournament-bracket',
  description: 'Pick a single winner from many candidates by pairwise elimination — relative comparison, not absolute scoring.',
  phases: [{ title: 'Seed' }, { title: 'Bracket' }],
}
const CANDIDATES = { type: 'object', properties: { candidates: { type: 'array', items: { type: 'string' } } }, required: ['candidates'] }
const DUEL = { type: 'object', properties: { winnerIndex: { type: 'number' }, why: { type: 'string' } }, required: ['winnerIndex'] }

const seed = await agent('Generate diverse candidate solutions to <GOAL>. Return candidates[].', { phase: 'Seed', schema: CANDIDATES })
// each round is a parallel() over pairs; the loop over rounds is a plain while (field.length > 1).
let field = seed?.candidates ?? []
let round = 0
while (field.length > 1) {
  round++
  const odd = field.length % 2 === 1 ? field[field.length - 1] : null // a lone candidate gets a bye
  const pairs = []
  for (let i = 0; i + 1 < field.length; i += 2) pairs.push([field[i], field[i + 1]])
  log(`round ${round}: ${pairs.length} duels${odd ? ' + 1 bye' : ''}`)
  const winners = await parallel(pairs.map((pair) => () =>
    agent(`Compare these two candidates for <GOAL> and pick the better. Return winnerIndex (0 or 1).\nA:\n${pair[0]}\nB:\n${pair[1]}`,
      { label: `r${round}-duel`, phase: 'Bracket', schema: DUEL })
      .then((d) => pair[d.winnerIndex === 1 ? 1 : 0])))
  field = winners.filter(Boolean)
  if (odd) field.push(odd)
}
return { winner: field[0], rounds: round }
