export const meta = {
  name: 'migrate-discover-transform-verify',
  description: 'Discover every migration site, transform each in an isolated worktree, verify with a gate.',
  phases: [{ title: 'Discover' }, { title: 'Transform' }, { title: 'Verify' }],
}
const SITES = { type: 'object', properties: { sites: { type: 'array', items: { type: 'string' } } }, required: ['sites'] }
const VERIFY = { type: 'object', properties: { pass: { type: 'boolean' }, notes: { type: 'string' } }, required: ['pass'] }

const found = await agent('Enumerate every file/site that needs the <MIGRATION>. Return sites[].', { phase: 'Discover', schema: SITES })
// pipeline: each site transforms in its OWN worktree (parallel edits won't conflict), then verifies.
const out = await pipeline(found.sites ?? [],
  (site) => agent(`Apply <MIGRATION> to ${site}. Commit in your worktree.`, { phase: 'Transform', isolation: 'worktree' }),
  (prev, site) => agent(`Verify the <MIGRATION> at ${site} (run the gate). Return pass.\n${JSON.stringify(prev)}`,
    { phase: 'Verify', schema: VERIFY }).then((v) => ({ site, ...v })))
return out.filter(Boolean)
