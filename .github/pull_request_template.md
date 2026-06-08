## What this changes

A short description of the change and why.

Closes #

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Docs only
- [ ] Refactor / internal (no user-visible change)

## Verification

- [ ] `./run-tests.sh` passes (ends with `ALL TESTS PASSED`)
- [ ] `claude plugin validate .` reports no errors
- [ ] Dogfooded against the live plugin via `--plugin-dir .` (for behavioral changes)

Paste the relevant output if helpful:

```
# ./run-tests.sh
# claude plugin validate .
```

## Design invariants (confirm none are broken — see CONTRIBUTING.md)

- [ ] Hooks remain **pure bash**, no `jq` / `node` / other runtime
- [ ] Board **narrow waist** unchanged — or, if changed, every hook + test updated in this PR
- [ ] **Skill A / Skill B** stay self-contained and non-overlapping
- [ ] Change is **ship-anywhere** (no agent-teams / scheduled-routines dependency)
- [ ] The conductor still never does unit work by hand

## Docs

- [ ] Updated `README.md` / `README_zh.md` if user-facing behavior changed (kept in sync)
- [ ] Added a `## [Unreleased]` entry to `CHANGELOG.md` for any user-visible change

## Notes for reviewers

Anything reviewers should pay special attention to.
