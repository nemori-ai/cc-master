# Eval — Track A: trigger accuracy

Track A measures one thing: **does a skill's `description` cause Claude to read
the skill exactly when it should, and stay out of the way when it shouldn't?**
The skill body, references, and templates are irrelevant here — only the
frontmatter `description` is under test, because that is the single string
Claude sees when deciding whether to invoke the skill.

This is the cheap-cheap quantitative gate that pairs with the qualitative
pressure-testing in `cc-master-skillsmith`. Track B (behavioral benchmark) is a
separate, heavier loop documented elsewhere.

## What it does

For each `{query, should_trigger}` pair, the harness creates a throwaway command
file from the skill's real description, runs `claude -p <query>`, and watches the
stream for whether Claude reaches for that skill (a `Skill`/`Read` of the skill).
Each query runs N times (`--runs-per-query 3`); a query *passes* when its trigger
rate lands on the right side of the 0.5 threshold for its `should_trigger` label.
The script reuses skill-creator's `scripts.run_eval` verbatim — cc-master owns no
eval logic, only the eval sets and a thin path-resolving wrapper.

## Dependencies

- **uv** (resolves a transient Python 3.12 toolchain — `uv run --python 3.12`).
- **Python 3.12** (pulled by uv; the system 3.9 is enough only for JSON validation,
  not for running the eval).
- **`claude` CLI, logged in.** No API key required — `run_eval` shells out to
  `claude -p` under your existing session authentication.
- **skill-creator** present in the plugin cache at
  `~/.claude/plugins/cache/claude-plugins-official/skill-creator/unknown/skills/skill-creator`
  (the wrapper `cd`s there so the `scripts.` package resolves).

## Usage

```bash
scripts/eval-trigger.sh orchestrating-to-completion
scripts/eval-trigger.sh authoring-workflows
```

Output is the per-query PASS/FAIL table (to stderr) plus a JSON summary (to
stdout) with `passed`/`failed`/`total`. Each eval set lives next to its skill:
`skills/<skill>/evals/trigger.json`.

This run consumes real tokens and time (one `claude -p` per query per run). Do
not run it casually — run it deliberately, around a description change.

## The ceiling — what Track A can and cannot tell you

The accuracy number has a built-in ceiling that has **nothing to do with your
description**: a trivial, substance-free query simply never triggers any skill,
no matter how good the description is. So 100% is not the target, and a handful
of "missed" negatives may just be the harness floor.

The corollary is a rule for writing eval sets: **queries must be substantive.**
A negative like "write a fibonacci function" tests nothing — it would never
trigger anyway. The valuable negatives are *near-misses*: queries that share
keywords or shape with the skill but genuinely belong elsewhere (e.g. shell-level
parallelism that is **not** a dynamic workflow, or pure long-horizon coordination
that belongs to `orchestrating-to-completion` rather than `authoring-workflows`).
Read the numbers as **direction, not verdict** — they tell you whether a change
helped or hurt, not whether the skill is "done".

### Measured floor warning (2026-06-10): recall can be a flat 0 in a loaded environment

A real measurement on this machine: `authoring-workflows`, 28 queries × 3 runs,
**every positive scored trigger_rate 0.0** (and every negative trivially passed).
Root-caused via minimal repro, NOT a description problem — three stacked causes:

1. `run_eval`'s `find_project_root()` walks up from the skill-creator cache dir
   and lands on `$HOME`, so `claude -p` runs with the user's FULL global stack
   (global CLAUDE.md, all plugins, ~100 competing skills) as context noise.
2. The current default model answers advice-shaped queries ("pipeline or
   parallel?") directly from knowledge — it never invokes a stub command whose
   body is just the description. Reproduced with `--bare` (hermetic, no plugins,
   no global CLAUDE.md): still **zero** tool calls.
3. The detector bails on the FIRST tool_use block — any unrelated first tool
   (TodoWrite, a different Skill) is an instant False.

Consequence: when both the before AND after runs sit on this floor, the
comparison carries no information — record the numbers, say so explicitly, and
fall back to qualitative review of the description diff (semantic-equivalence
edits can proceed; semantic changes should wait for a working harness or an
isolated eval environment). Do not tune a description against a dead channel.

## When to run

- **Mandatory whenever you change a skill's `description`.** Run the eval before
  and after the change and compare accuracy; a description edit that drops trigger
  recall or invites false positives must be caught here, not in production.
- Optionally when adding a new sibling skill whose description could compete for
  the same queries (cross-skill collision is the failure mode the near-miss
  negatives are designed to surface).

Not part of `bash run-tests.sh` — it is an out-of-band, token-spending check run
deliberately at description-change time, the same way `scripts/codex-review.sh`
is an out-of-band reviewer rather than a hook.
