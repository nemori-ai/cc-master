export const meta = {
  name: 'dep-upgrade-sweep',
  description: 'Discover outdated deps, upgrade each in an isolated worktree, verify with a gate — keep only the green bumps.',
  phases: [{ title: 'Discover' }, { title: 'Upgrade' }, { title: 'Verify' }],
}
const DEPS = { type: 'object', properties: { deps: { type: 'array', items: { type: 'object',
  properties: { name: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } },
  required: ['name', 'to'] } } }, required: ['deps'] }
const VERIFY = { type: 'object', properties: { pass: { type: 'boolean' }, notes: { type: 'string' } }, required: ['pass'] }

// discover → transform → verify. worktree isolation is required: each upgrade edits the lockfile,
// so concurrent bumps in one tree would collide. Each gets its own worktree.
const found = await agent('List every outdated direct dependency with its current + latest version. Return deps[].', { phase: 'Discover', schema: DEPS })
const out = await pipeline(found?.deps ?? [],
  (dep) => agent(`Upgrade ${dep.name} to ${dep.to} (update manifest + lockfile, install). Commit in your worktree.`,
    { label: `bump:${dep.name}`, phase: 'Upgrade', isolation: 'worktree' }).then(() => dep),
  (dep) => agent(`Run the build + test gate after bumping ${dep.name} to ${dep.to}. Return pass + notes.`,
    { label: `verify:${dep.name}`, phase: 'Verify', schema: VERIFY }).then((v) => ({ ...dep, ...v })))
const results = out.filter(Boolean)
log(`green: ${results.filter((d) => d.pass).length}/${results.length}`)
return results
