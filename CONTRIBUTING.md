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

These constraints are load-bearing. A PR that violates one will be sent back.

1. **Hooks are pure bash. No `jq`, no `node`, no other runtime.**
   Hooks run in a shell that is blind to agent context and must work everywhere
   cc-master ships (including Bedrock / Vertex / Foundry). Parse JSON with shell
   tools, not interpreters. Keep them deterministic and dependency-free.

2. **Keep the board's narrow waist stable.**
   The board is the single source of truth and the only state a hook can read.
   Only a small, fixed set of fields are hook-dependent (the "narrow waist").
   Changing their names, shapes, or semantics breaks the hooks silently. If you
   must touch the waist, update every hook and its tests in the same PR, and call
   it out explicitly in the PR description.

3. **The two skills stay self-contained and non-overlapping.**
   - **Skill A (`orchestrating-to-completion`)** = main-thread orchestration: the
     method the orchestrator runs (decompose, dispatch-on-ready, productive idle
     windows, endpoint verification).
   - **Skill B (`authoring-workflows`)** = inside-the-script authoring: how to
     write dynamic-workflow scripts.

   Don't let responsibilities bleed across the two, and don't duplicate guidance
   between them. If a piece of advice belongs to "what the orchestrator does," it
   goes in A; if it belongs to "how a workflow script is written," it goes in B.

4. **The conductor never plays an instrument.**
   The orchestrator coordinates; it does not do the unit work by hand. Any change
   that nudges the main thread toward doing the work directly is going the wrong way.

5. **Stay ship-anywhere.**
   The supported background mechanisms are background shell, sub-agent
   (`run_in_background`), and workflow. Agent-teams and scheduled routines are
   out of scope by design (not reliably available everywhere). Don't add a
   dependency that breaks on Bedrock / Vertex / Foundry.

## Style & conventions

- Match the surrounding prose voice (second-person, direct) in skills and commands.
- Keep `README.md` and `README_zh.md` in sync when you touch user-facing docs.
- Add a `## [Unreleased]` entry to [`CHANGELOG.md`](CHANGELOG.md) for any
  user-visible change.
- Don't commit a real runtime board; `.claude/cc-master/` is gitignored.

## Reporting bugs / requesting features

Use the issue templates under `.github/ISSUE_TEMPLATE/`. For anything security-
sensitive, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
