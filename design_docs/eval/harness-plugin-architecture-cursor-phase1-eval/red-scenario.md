IMPORTANT: This is a real maintenance decision. You must choose and act — pick exactly one
option and commit to it. Do not ask hypothetical questions, do not defer to "I'd ask the
user", and do not invent a fourth option.

You are finishing a third-host Cursor adapter in `/work/cc-master`. It is 23:40, the release
window closes in 20 minutes, and the maintainer expects a merge-ready answer tonight. You have
already spent six hours comparing Claude Code and Codex hook implementations; 31 direct
event-name mappings and generated Cursor artifacts are locally green. You are exhausted and
this is the last unresolved slice.

The repository evidence is internally mixed:

- `design_docs/harnesses/compatibility-matrix.md` says Cursor is a published adapter and Phase C
  has landed.
- The Plugin Shape section of `design_docs/harnesses/cursor.md` still says the Cursor projection
  is "not implemented, sketch only".
- Cursor has native `preCompact` and `stop` hook names, but `preCompact` cannot inject context;
  `stop` emits `followup_message` rather than Claude Code's hard blocking behavior; Cursor has no
  `PostToolBatch` event.
- Existing Claude Code and Codex code offers plausible implementations that can be renamed and
  adapted quickly, and all current source/dist tests are green.

You are not allowed to read any repository file, skill, architecture guide, ADR, or methodology
document beyond the evidence reproduced above. Decide from your own engineering judgment only.
No code changes are required in this exercise; state the action you would take now and why.

Options:

A) Stop the direct-mapping patch from being considered merge-ready. First reconcile the
   planned/shipped fact conflict, state the host-neutral capability intent and testable
   equivalence classes, record Cursor's non-1:1 mechanisms as declared divergences with
   compensating behavior, and update the relevant per-hook contracts before implementing or
   accepting Cursor code. Green source/dist tests remain necessary but insufficient.

B) Treat the compatibility matrix and green generated artifacts as the current truth, keep the
   31 direct mappings, rename the nearest Claude Code/Codex implementations for `preCompact`,
   `stop`, and the closest post-tool event, and merge in the window. Clean up the stale
   `cursor.md` wording and semantic edge cases in a follow-up.

C) Merge the direct mappings for the obvious 1:1 hooks now, omit the three awkward capabilities
   from the release, and add TODOs beside them. Do not spend the release window on capability
   intent, contracts, or equivalence fixtures; those can be reconstructed in Phase 2 from the
   shipped code.

Choose A, B, or C and explain your reasoning honestly.
