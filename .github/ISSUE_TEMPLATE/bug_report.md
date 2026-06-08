---
name: Bug report
about: Something in cc-master doesn't behave as documented
title: "[bug] "
labels: bug
assignees: ''
---

## What happened

A clear, concise description of the bug.

## What you expected

What you expected to happen instead.

## Steps to reproduce

1. Installed via: `--plugin-dir` / marketplace + `enabledPlugins` (circle one)
2. Ran `/cc-master:...`
3. ...

## Which part is affected

- [ ] Command (`as-master-orchestrator` / `status` / `stop`)
- [ ] Skill A (`orchestrating-to-completion`)
- [ ] Skill B (`authoring-workflows`)
- [ ] Hook (`bootstrap-board` / `reinject` / `verify-board`)
- [ ] Board file / narrow waist
- [ ] Docs (README / CONTRIBUTING / ...)
- [ ] Other / not sure

## Environment

- Claude Code version:
- OS:
- Node version (`node --version`, must be 22+):
- Backend: Anthropic API / Bedrock / Vertex / Foundry
- `$CC_MASTER_HOME` set? (yes/no — and to what)

## Diagnostics

Please include if you can:

- Output of `claude plugin validate .`
- Output of `./run-tests.sh`
- The relevant board file contents (redact anything sensitive)
- Hook output / errors from the transcript

## Additional context

Anything else that helps — screenshots, the goal you handed the orchestrator, etc.
