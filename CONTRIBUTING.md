# Contributing to cc-master

Thanks for wanting to make cc-master better. This guide covers the dev loop and
the design invariants you must not break.

> 中文读者：术语保留英文，正文中英混排即可。下面所有命令对中英用户一致。

## Dev setup

cc-master is a Claude Code plugin — no build step, no package install. You run it
straight from a live clone.

```bash
git clone https://github.com/nemori-ai/cc-master.git
cd cc-master
claude --plugin-dir .          # start a local session against the live repo
```

`--plugin-dir` loads the plugin from the working tree with **no cache**, so every
edit you make takes effect on the next session — this is the fastest dogfood loop.
(The marketplace + `enabledPlugins` install path *does* cache; don't use it while
developing — see [README](README.md#install).)

Requirements: **Node 22+** and **bash**. That's it.

## Before you open a PR

Run both checks. They are the same two gates the maintainers run:

```bash
./run-tests.sh                 # hook tests (bash) + content contract (Node 22+)
claude plugin validate .       # validates the plugin manifest, skills, commands
```

`run-tests.sh` must end with `ALL TESTS PASSED`, and `claude plugin validate .`
must report no errors. The harness is the authoritative validator for workflow
scripts — there is intentionally no separate workflow linter to maintain
(see [`skills/authoring-workflows/SKILL.md`](skills/authoring-workflows/SKILL.md) §3).

If your change is behavioral, also **dogfood it**: start a real orchestration with
`/cc-master:as-master-orchestrator <goal>` and confirm the change works against the
live plugin runtime. Several past bugs were invisible to the test suite and only
surfaced under a real session.

## Design invariants — do not break these

The six load-bearing design red lines (hooks use bash + node/JS — ADR-006 · stable board narrow
waist · two non-overlapping skills · the conductor never plays an instrument ·
ship-anywhere · every hook dormant-until-armed — ADR-007) have a **single source of truth in [`AGENTS.md` §3](AGENTS.md#3-non-negotiable-红线ssot-在此)** —
each with its decision-record link and a PR/CI grep checkpoint. Read it before
opening a PR; a PR that violates one will be sent back.

## Style & conventions

- Match the surrounding prose voice (second-person, direct) in skills and commands.
- Keep `README.md` and `README_zh.md` in sync when you touch user-facing docs.
- Add a `## [Unreleased]` entry to [`CHANGELOG.md`](CHANGELOG.md) for any
  user-visible change.
- Don't commit a real runtime board; `.claude/cc-master/` is gitignored.

## Reporting bugs / requesting features

Use the issue templates under `.github/ISSUE_TEMPLATE/`. For anything security-
sensitive, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
