# cc-master

A ship-anywhere Claude Code plugin that turns any main-session agent into a long-horizon **master orchestrator**. Point it at a goal that spans more than 24 hours of work and it picks the right dynamic-workflow paradigm, writes stable parallel scripts, and keeps the main thread productively advancing — dispatching background work and using idle windows with initiative — while surviving repeated context compaction and cross-session resume.

## Install

```bash
git clone https://github.com/nemori-ai/cc-master.git
ln -s "$(pwd)/cc-master" ~/.claude/plugins/cc-master
```

Then restart Claude Code (or run `/reload-plugins`) so the plugin is discovered.

## Usage

```
/cc-master:as-master-orchestrator <goal>   # bootstrap a board and become the orchestrator
/cc-master:status                          # render the board summary + validate the narrow waist
/cc-master:stop                            # archive the board and stand down (board is kept, not deleted)
```

## The 3 background mechanisms it teaches

cc-master coaches the orchestrator to advance the main thread without idling, using three reliably ship-anywhere mechanisms:

1. **Background shell** — long-running commands launched detached so the main thread keeps moving.
2. **Sub-agent (`run_in_background`)** — independent tasks dispatched to background sub-agents and integrated on completion.
3. **Workflow** — dynamic-workflow scripts (fan-out / pipeline / loop) for structured parallel orchestration.

It deliberately does **not** use **agent-teams** or **scheduled routines**: neither is reliably ship-anywhere, so they are out of scope by design.

## Learn more

- [`docs/spec.md`](docs/spec.md) — the full specification.
- [`docs/research/`](docs/research/) — the research behind the dynamic-workflow paradigms.
