# governing-skill-knowledge — Round-1 admission evidence (REJECTED / DELETE)

Status: **DELETE** under fair baseline Counterfactual Probe A/B.
Date: 2026-07-24. Runtime portfolio remains 8. Dev/meta inventory remains the real on-disk 9
(`.claude/skills/*`), without a standalone governance meta-skill.

## Verdict

| Probe | Strength | Fair reading |
|---|---|---|
| A (without this skill, can an agent still do the job from formal docs + CLI?) | **weak** | `design_docs/skill-knowledge-graph/specification.md` + `cli-contract.md` + `node scripts/skill-knowledge.mjs change|check|contract` already expose health, typed ops, and witness envelopes. A dedicated skill body does not add a non-substitutable capability plane. |
| B (with this skill, does pressure/Track B show independent strict pass?) | **weak** | Round-1 with-skill Track B did not achieve independent strict green; pressure forward remained `not_achieved` / `candidate_does_not_pass`. No holdout_verdict improvement claim is warranted. |
| Combined | **weak × weak = DELETE** | Portfolio curating rule: do not admit a meta-skill whose absence is already covered by formal SSOT and whose presence does not clear behavioral gates. |

## What stays (without the skill)

- Formal maintainer journey: specification + schemas + CLI contract + change transactions.
- Core product tests for typed `change begin→validate→apply`, coverage, and witnesses.
- Root `AGENTS.md` navigation to the formal docs/CLI (no skill router).

## What was removed

- `.claude/skills/governing-skill-knowledge/` and its `.agents/skills/` projection.
- Skill-local eval fixtures that only proved inventory/wording of the candidate skill.
- Sibling meta-skill cross-pointers that routed graph governance exclusively through this candidate.

## Non-claims

This DELETE is not a claim that skill-knowledge governance is unnecessary. It is a claim that
governance already has a formal SSOT + toolkit, and a tenth meta-skill failed fair admission.
