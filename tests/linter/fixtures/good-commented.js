export const meta = { name: 'commented', description: 'forbidden patterns appear only in comments; the code itself is clean' }
// Regression guard: these comments mention Date.now(), Math.random(), new Date(), and
// require('fs') — all inside comments, so the linter must NOT flag them as violations.
// SHAPE doc: parallel([badPromise]) here is documentation, not a real bare-promise call.
const items = args ?? ['a', 'b']
const out = await parallel(items.map((it) => () => agent(`do ${it}`)))
return out
