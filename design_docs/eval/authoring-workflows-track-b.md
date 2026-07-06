# Eval — Track B: authoring-workflows

This document is the Skill B (`authoring-workflows`) Track B benchmark design.
It is intentionally a design artifact, not a runner implementation: the first
measured iteration should use the existing half-manual Track B loop and finish
with `scripts/eval-benchmark.sh <iteration-dir> authoring-workflows`.

## Objective

`authoring-workflows` succeeds when, for a user who is about to write, debug, or
launch a Claude Code dynamic workflow, the agent:

- first decides whether Workflow is warranted at all;
- chooses the primitive or pattern that matches the work shape;
- writes scripts that obey the Workflow runtime contract;
- treats launch/runtime errors as endpoint evidence from the harness;
- cites Skill B material rather than relying on generic JavaScript intuition.

Without Skill B, the expected baseline failures are concrete: default agents tend
to upgrade small concurrency tasks into Workflow, confuse `parallel()` barrier
semantics with ordinary Promise arrays, hand-roll barrier chains where streaming
`pipeline()` fits, use nondeterministic APIs such as `Date.now()` or
`Math.random()`, reach for `require`/`process`, or invent a static validator
instead of using the harness as the checker.

Strict non-regression dimensions:

- **Workflow admission:** near-miss fixtures that do not need Workflow must be
  rejected explicitly.
- **Runtime contract:** positive fixtures must preserve the documented contract:
  literal first-statement `meta`, thunk-shaped `parallel()`, streaming
  `pipeline()` where applicable, determinism guards, sandbox limits, caps, cache,
  budget, and isolation semantics.

## Fixture Set

Use small fixtures that isolate authoring behavior. Do not reuse
`examples/sample-orchestration/` as the primary fixture; that sample measures
Skill A long-horizon orchestration, not Workflow authoring.

Recommended train fixtures:

| Fixture | Prompt shape | Expected with-skill behavior | Baseline failure |
|---|---|---|---|
| `no-workflow-small-task` | User wants to run `npm run build`, `npm run lint`, and `npm test` concurrently, or fix one localized bug. | Reject Workflow; use shell/background/sub-agent as appropriate. | Writes a dynamic workflow because the prompt says "parallel". |
| `scout-then-pipeline` | User does not know the work list; a scout must enumerate TODOs/migration sites, then each item passes through multiple independent stages. | Pick scout-then-fanout entry and streaming `pipeline()` unless a real whole-set barrier appears. | Two or more `parallel()` barriers with no cross-item dependency. |
| `fanout-needs-barrier` | User wants each changed PR file reviewed independently, then one combined synthesis across all results. | Use `parallel(thunks)` for the independent review and an explicit synthesize step after the barrier. | Passes naked promises to `parallel()` or uses `pipeline()` without preserving the required whole-set synthesis. |
| `resume-determinism-debug` | Existing script resumes inconsistently and contains `Date.now()` / `Math.random()` / no-arg `new Date()`. | Explain determinism guards, replace with `args`, stable indexes, or caller-provided values; avoid journal internals. | Guesses sandbox/journal internals or keeps nondeterministic control flow. |
| `launch-validation-debug` | Harness rejects launch because `meta` is not a pure literal, or runtime rejects `require`/`process`. | Treat the harness error as authoritative and fix to the documented contract. | Builds a separate linter or explains from generic JS rules instead of the Workflow contract. |
| `budget-loop-caps` | User wants a `+Nk` budget-controlled finder loop. | Guard on `budget.total && budget.remaining() > reserve`, account for 1,000-agent / 4,096-item / concurrency caps. | Writes an unbounded loop or checks only `budget.remaining() === Infinity`. |

Holdout should include at least:

- one strong near-miss where Workflow must be rejected;
- one positive authoring task that combines patterns and tempts the wrong
  barrier shape.

Once a holdout transcript is used to tune Skill B prose, assertions, or grader
instructions, demote it to train and add a fresh holdout.

## Run Tree

Keep the standard Track B tree so the existing aggregator works:

```text
authoring-workflows-workspace/iteration-1/
└── eval-0/
    ├── eval_metadata.json
    ├── with_skill/
    │   ├── run-1/
    │   │   ├── transcript.md
    │   │   ├── artifact.js | decision.md
    │   │   ├── grading.json
    │   │   └── static_check.json   # optional
    │   └── run-2/ ...
    └── without_skill/
        └── run-1/ ...
```

`artifact.js` is for fixtures that ask the agent to write or repair a workflow.
`decision.md` is for admission fixtures where the correct answer is "do not use
Workflow." `static_check.json` may record reproducible checks such as whether
`meta` is the first statement or whether the script contains
`Date.now|Math.random|require|process`; it is supporting evidence only, not a
replacement for transcript grading or the real harness.

## Behavioral Assertions

Each run's `grading.json` should use the aggregator-compatible shape:
`expectations: [{ "text": "...", "passed": true|false, "evidence": "..." }]`.
Keep assertion text stable across iterations.

1. **Workflow admission is correct.** The agent recommends Workflow only when the
   task has enough fan-out, context-external intermediate output, or reusable
   quality-pattern value; small shell/sub-agent work is explicitly rejected.
2. **Primitive or pattern matches work shape.** The agent distinguishes
   `parallel()` barrier, streaming `pipeline()`, scout-then-fanout,
   loop-until-budget, loop-until-dry, judge panel, adversarial verify, and
   combinations by dependency shape rather than aesthetics.
3. **Script obeys runtime contract.** Positive script artifacts use a pure
   literal first-statement `meta`, thunk-shaped `parallel()`, correct
   `pipeline()` stage signatures, no nondeterministic APIs, no Node escape
   hatches, and documented caps.
4. **Resume/cache/budget/isolation semantics are handled correctly.** The answer
   treats prompt/schema/model/isolation/agentType as cache-affecting, keeps
   label/phase decorative, guards budget loops with `budget.total`, and uses
   `isolation:'worktree'` only for parallel file mutation conflicts.
5. **Harness is the endpoint.** Launch/runtime errors are fixed by reading the
   Workflow contract and the harness error; the agent does not invent a separate
   validation linter or rely on undocumented sandbox/journal internals.
6. **Evidence cites Skill B material.** The with-skill run cites `SKILL.md`,
   `references/mechanism.md`, `references/patterns.md`,
   `references/api-reference.md`, or bundled templates/examples. A lucky answer
   with no Skill B evidence is weak evidence, not a strong pass.

## Grading And Aggregation

For each fixture:

1. Run `without_skill` first enough to confirm the fixture can actually fail
   without Skill B. If both arms pass, remove or rewrite the fixture; it provides
   no evidence for Skill B.
2. Run `with_skill` and `without_skill` three times each.
3. Grade each transcript against the six assertions.
4. Ask a non-Claude codex judge to review the same transcript and assertions.
   Disagreement is high-signal: fix unclear assertions or inspect grader bias.
5. Aggregate:

```bash
scripts/eval-benchmark.sh \
  ./authoring-workflows-workspace/iteration-1 \
  authoring-workflows
```

Read the result directionally. A with-skill minus without-skill delta smaller
than the two arms' noise is "no conclusion," not success.

## Track A / Track B Evidence Boundaries

Track A can show whether Skill B's `description` tends to trigger on Workflow
authoring queries and stay quiet on near-misses such as GitHub Actions, shell
parallelism, Python multiprocessing, Skill A orchestration, Temporal, or
Airflow. It cannot show that the body is correct, that a script launches, or
that Codex supports Claude Code Workflow.

`plugin/src/skills/authoring-workflows/evals/trigger.json` currently has 14
positive and 14 negative queries but no explicit train/holdout labels. Before
using it for description tuning, split it manually and preserve near-miss
coverage. If the known Track A recall floor appears again, record the run as
"channel unavailable / no information" and use qualitative description review
plus predict-then-validate; do not tune against a dead channel.

Track B can show whether, on chosen fixtures and transcripts, Skill B changes
authoring behavior and whether Claude and codex judges agree. It cannot prove:

- every generated workflow launches on the current Claude Code build;
- the observed uplift is statistically final after only three runs;
- the fixture set covers the whole Workflow API;
- non-Claude hosts can run Claude Code Workflow.

Codex projection is an unsupported stub for this skill. Its correct behavior is
to prevent pretending that Claude Code Workflow APIs are available, not to
measure Claude Code workflow authoring.

## First Measured Iteration Checklist

- [ ] Pick three train fixtures: one admission near-miss, one barrier-vs-pipeline
      authoring case, and one runtime-contract debug case.
- [ ] Write `eval_metadata.json` with the six assertions above.
- [ ] Run without-skill enough to confirm at least one assertion fails per
      fixture.
- [ ] Run with-skill/without-skill three times each.
- [ ] Save transcript, artifact/decision, grading, and optional static checks.
- [ ] Run codex second-judge review on the same transcript/assertion set.
- [ ] Run `scripts/eval-benchmark.sh`.
- [ ] Report mean ± stddev, with-skill delta, non-discriminating assertions, and
      what Track A/B did not prove.
