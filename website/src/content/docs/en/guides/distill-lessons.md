---
title: Distill lessons into assets
description: Retro reads a board and lists candidate lessons; distill turns the approved ones into real project assets — through a PR, never silently.
section: guides
order: 6
deeper:
  - label: distilling-lessons-into-assets SKILL.md — the routing judgment
    url: https://github.com/nemori-ai/cc-master/blob/main/plugin/src/skills/distilling-lessons-into-assets/canonical/SKILL.md
  - label: ADR-027 — the two-stage retro/distill split
    url: https://github.com/nemori-ai/cc-master/blob/main/adrs/ADR-027-distill-stage2-and-eighth-skill.md
---

An orchestration ends; the lessons evaporate — unless you distill them. cc-master splits this into two strict stages: **retro is read-only** (it can never hurt anything), **distill is the writable stage** (and therefore gated by your explicit approval and a PR).

## Stage 1 — retro: read the board, list candidates

```
/cc-master:retro          # Codex: $cc-master-retro · Cursor: /retro · kimi-code: cc-master:retro
```

Run it against an in-progress **or** archived board. It reads the goal, the audit log, judgment calls, and task terminal states — never GitHub, never writes back to the board — and writes one `*.retro.md` into the *orchestrated project* (`design_docs/retros/` if that exists, else `.cc-master-retros/`). The document has seven fixed sections: what happened, scheduling and estimate quality, HITL cost, mechanisms that proved themselves, the pits that were stepped into, and a **candidate lessons** list. Each candidate carries a suggested asset type, a suggested location, its evidence (task ids, log entries, judgment-call ids), and a draft wording. Retro proposes; it never disposes.

## Stage 2 — distill: route candidates into assets

```
/cc-master:distill <retro-path...>     # one or many retros at once
```

Distill consumes retro **files** — it never reconnects to the board or calls `ccm` — and lands each approved candidate as a real asset in the target project:

| Asset | Right home for | Wrong home for |
|---|---|---|
| **Discipline doc** (AGENTS.md, design docs) | durable facts, project-specific red lines and conventions | reusable judgment — it gets missed in linear prose |
| **Skill** | judgment or methodology that transfers across tasks | one-off facts; pure deterministic shapes |
| **Workflow** | deterministic orchestration structure | decision points that need live judgment |
| **Subagent** | a recurring specialized role with its own persona/tools | one-off delegation |

The routing tree is three questions: fact or judgment? → if judgment, is it a deterministic shape? → if not, does it need a persona? The top anti-pattern the skill exists to block: *"this lesson feels important, so it must deserve a skill"* — importance is not reusability.

## How a distill run goes

1. **Plan in one pass.** Distill dedupes and merges candidates across all given retros, probes the target project's structure (does it have skills? agents? contribution conventions?), and renders a single structured plan: target file per change, merged sources, evidence per change, plus any conflicts or downgrades flagged honestly.
2. **You approve — once.** The plan is the only mandatory breakpoint. Approve all, approve some, send it back. Nothing is written before this.
3. **Execute per target file.** Each change unit reads the existing file first and matches its voice, then lands the candidate.
4. **Collect via PR.** Git projects get a feature branch, one commit per target file, and a PR whose body is the full plan. Non-git projects (or `--apply draft`) get a `.cc-master-distill-drafts/` directory of proposed files for manual adoption. There is no third "just edit it quietly" path.

## The one hard rule: evidence fidelity

Between the candidate draft and the written asset, **no rewording may generalize beyond the evidence**. When the wording wants to run ahead of what the board actually proved, narrow it back — keep the scenario qualifiers — and mark it ("narrowed: original draft over-generalized"). And a candidate is never silently dropped: if its home is uncertain or the project lacks the infrastructure, it lands in the lowest-cost fallback (a discipline-doc pointer) explicitly marked for human re-judgment. A lesson judged shallow and corrected by a human beats a lesson that vanished.

## When not to distill

- The retro's candidates are thin, single-incident, or weakly evidenced — let them accumulate across retros; one more retro often merges or kills them naturally.
- The "lesson" is really a task-level fix — fix the thing, don't write a rule about it.
- You are deciding whether a capability deserves to be a skill at all — that is a governance decision for the project's own skill conventions, not what this command routes.
