export const meta = {
  name: 'full', description: 'exercises all clean paths',
  phases: [{ title: 'Find' }, { title: 'Verify' }],
}
const items = args ?? []
const out = await pipeline(items,
  (it) => agent(`find in ${it}`, { phase: 'Find' }),
  (r) => parallel((r.hits ?? []).map((h) => () => agent(`verify ${h}`, { phase: 'Verify' }))),
)
log(`done ${out.length}`)
return out
