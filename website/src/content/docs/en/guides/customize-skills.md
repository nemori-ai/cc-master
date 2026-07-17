---
title: Customize the skills
description: Eight distributed skills decide how every orchestration thinks — edit the canonical source, re-project, and pressure-test the change.
section: guides
order: 1
deeper:
  - label: cc-master-skillsmith — the skill-authoring meta-skill (TDD for skills)
    url: https://github.com/nemori-ai/cc-master/blob/main/.claude/skills/cc-master-skillsmith/SKILL.md
  - label: AGENTS.md — repo conventions and the six red lines
    url: https://github.com/nemori-ai/cc-master/blob/main/AGENTS.md
  - label: scripts/sync-plugin-dist.sh — the source-to-adapter projector
    url: https://github.com/nemori-ai/cc-master/blob/main/scripts/sync-plugin-dist.sh
---

The plugin's behavior is not hard-coded — it is **taught** by eight skills injected into the agent's context. To change how every orchestration on your team breaks down work, paces quota, or verifies results, you edit skill prose. That makes skills the highest-leverage customization point in the project.

## The eight skills

| Skill | Owns |
|---|---|
| `master-orchestrator-guide` | Orchestrator identity and decisions: dispatch, resume, verification, account-switch authority, DAG scheduling |
| `slicing-goals-into-dags` | How to slice a goal into thin, parallelizable, verifiable increments |
| `using-ccm` | The `ccm` operations manual: command surface, board model, field values, all lint rules |
| `pacing-and-estimation` | How to consume quota/estimate advisories — verdicts, model tiers, honesty fields |
| `authoring-workflows` | How to write deterministic workflow scripts (on hosts that support them) |
| `dev-as-ml-loop` | The execution-side loop: optimize one task to acceptance like an ML process |
| `engineering-with-craft` | Engineering craft: DDD/OOP/SDD/TDD roots and red lines |
| `distilling-lessons-into-assets` | How lessons route into discipline docs, skills, workflows, or subagents |

Each owns one plane and never overlaps another — decisions live in the guide, mechanisms in `using-ccm`, and so on. Keep that boundary when you edit: a paragraph pasted into the wrong skill creates a second source of truth.

## Where to edit

Edit the **canonical source**, never the generated adapter output:

```
plugin/src/skills/<skill>/canonical/SKILL.md        # main file — keep it lean
plugin/src/skills/<skill>/canonical/references/     # depth lives here
plugin/src/skills/<skill>/adapters/<host>/strategy.yaml  # per-host projection
```

`plugin/dist/<host>/` is generated. Put new long-form material in `references/` and link it from the main file — the guide skill is re-injected after every compaction, so every line you add to it costs context on every turn.

## Writing discipline

- **Talk to the agent, not about the document.** Second person, imperative, agent-as-actor. No maintainer asides, no "this file is the soul of X," no design rationale commentary.
- **Self-contained.** A skill may only reference files inside the distributed plugin. No repo docs, no ADR paths, no internal codenames — the reader is an agent on a user's machine, not a cc-master developer.
- **The `description` frontmatter is a router, not a summary.** It decides whether the skill triggers at all: when to use, triggers, do-not-use boundaries. Quote the whole value in single quotes — YAML chokes on embedded colons otherwise.
- **One fact, one home.** If the same rule appears in two skills, one of them must become a pointer.

## Test the prose, not just the structure

Structural checks (frontmatter, routing density, self-containment) run in CI — but a **discipline-bearing** paragraph (a rule an agent could rationalize away under pressure) needs a behavioral check first. The repo's practice is a **pressure baseline**: before writing the rule, run a subagent under time/sunk-cost/exhaustion pressure *without* the rule and watch it choose wrong; then write the rule that closes the specific rationalization you observed. Skip this and you are writing prose that sounds right and holds nothing.

## Regenerate and verify

```bash
bash scripts/sync-plugin-dist.sh                  # re-project the Claude Code adapter
bash scripts/sync-plugin-dist.sh --host codex     # …and any other hosts you ship
bash scripts/check-plugin-dist-sync.sh            # must show no diff after regenerating
bash run-tests.sh                                 # hooks + content contract
```

Commit the regenerated `plugin/dist/` in the same commit as your source change. If you changed any `description`, run the trigger-accuracy eval (`bash scripts/eval-trigger.sh`) before and after to confirm you did not break routing.
