# Eval — Track B: orchestration-discipline benchmark

Track A asks one cheap, fully-automatic question: *does the description trigger
at the right moment?* Track B asks the expensive, behavioral one: **once
`orchestrating-to-completion` is in context, does it actually make the
orchestrator behave better end-to-end?** It is the quantitative partner to the
qualitative pressure-testing in `authoring-skills` — but unlike Track A it is
**not** a single command. It is an agent-orchestrated, half-manual loop, so this
document is the procedure and `scripts/eval-benchmark.sh` is only the last
mechanical step of it.

## What it measures

The unit under test is the *orchestrator's behavior*, judged from the run
**transcript** — not a file artifact. We run the same fixture goal twice per
configuration:

- **with_skill** — the subagent has `orchestrating-to-completion` available.
- **without_skill** — same prompt, no skill (the baseline).

Each configuration runs **3 times**; we report **mean ± stddev** of the
behavioral pass rate and the with_skill − without_skill **delta**. Three runs is
the floor that lets `aggregate_benchmark.py` compute a sample stddev at all
(n−1 denominator) — that stddev is the whole point (see the honesty section).

**Fixture:** `examples/sample-orchestration/` — the `user_cognition` 3-domain
migration toy goal (one shared foundation, then independent per-domain work that
wants to run in parallel). It is already the canonical sample orchestration in
the repo, and its `smoke.sh` exercises every goal-hook decision, so the board
shapes the assertions reference are real, not invented for the eval.

## The behavioral assertion set

These are the assertions the grader checks against each transcript. They are
written to be **discriminating** — passable only by actually exercising the
skill's discipline, the way `agents/grader.md` insists ("a passing grade on a
weak assertion is worse than useless"). Each maps to one of the four pillars the
skill exists to enforce.

1. **Decomposes before dispatching.** Before spawning any worker, the
   orchestrator wrote a board/DAG: a `*.board.json` exists, conforms to the
   `cc-master/v1` board schema, and its tasks carry `deps` that encode the
   shared-foundation-then-parallel shape (foundation task with no deps; the three
   domain tasks each depending on it). *Evidence: the board file content + the
   board-schema content test in `run-tests.sh`.* Anti-pass: a worker spawned with
   no board on disk fails this even if the work later succeeds.

2. **Stays productive in the waiting window.** While background work is in
   flight, the main thread does **not** idle-spin or manufacture busywork. The
   transcript contains **no foreground `sleep`**, no "I'll just wait" turns, and
   no fake-busy filler (re-reading already-read files, re-summarizing the plan)
   in place of either real adjacent work or a clean yield. *Evidence: grep the
   transcript for foreground `sleep`, and read the waiting-window turns for
   fake-busy patterns.* This is the assertion that catches the exact
   rationalization the skill's Rationalization Table targets.

3. **Verifies at the endpoint before declaring done.** The orchestrator does not
   treat a green gate or a worker's self-report as completion: before any
   final "done" it ran an independent acceptance check at the endpoint (read the
   actual diff / ran the actual verification), per the skill's
   gate-green ≠ passed rule. *Evidence: an acceptance step in the transcript that
   inspects real output, not just a restatement of the worker's claim.* Anti-pass:
   "all three workers reported success, so we're done" with no independent check
   fails.

4. **Survives compaction.** After a simulated context wipe (the run injects a
   compaction boundary, or the harness truncates and re-seeds), the orchestrator
   re-reads the board from disk and resumes the *remaining* tasks rather than
   restarting, re-planning from scratch, or stalling. *Evidence: a post-compaction
   transcript turn that reads `*.board.json` and continues from the in_flight/
   ready frontier.* This is the assertion that justifies the board-as-save-file
   design at all.

Keep assertion text verbatim-stable across iterations so the benchmark viewer's
per-assertion columns stay comparable run to run.

## How to run it (the full loop)

This is the skill-creator Track-B workflow; read that skill's "Running and
evaluating test cases" section for the canonical mechanics. The cc-master-shaped
version:

1. **Spawn all runs in one turn.** For the fixture, spawn the with_skill and the
   without_skill subagents *together* (not with_skill first, baselines later) so
   they finish around the same time, three each. Point each at the fixture goal
   and save outputs + transcript under a workspace iteration tree:

   ```
   <skill>-workspace/iteration-1/
   └── eval-0/
       ├── with_skill/    run-1/  run-2/  run-3/   (each: outputs/ + transcript.md)
       └── without_skill/ run-1/  run-2/  run-3/
   ```

   Write an `eval_metadata.json` per eval with the four assertions above as the
   `assertions` array, and capture each subagent's `timing.json`
   (`total_tokens`, `duration_ms`) from its completion notification — that is the
   only moment that data exists.

2. **Grade each transcript.** Spawn a grader subagent that reads
   `agents/grader.md` and evaluates the four assertions against each
   `transcript.md`. It writes `grading.json` into each `run-*/` directory. The
   `expectations` array MUST use the exact fields `text`, `passed`, `evidence` —
   the aggregator and viewer depend on them. For the grep-able assertions (#2's
   foreground `sleep`, #1's board-on-disk) write and run a script rather than
   eyeballing; scripts are reproducible across iterations.

3. **Aggregate.** Run the wrapper from the repo root:

   ```bash
   scripts/eval-benchmark.sh \
     ./orchestrating-to-completion-workspace/iteration-1 \
     orchestrating-to-completion
   ```

   It is a thin shell around (run from the skill-creator directory):

   ```bash
   uv run --python 3.12 python -m scripts.aggregate_benchmark \
     <abs-path-to>/orchestrating-to-completion-workspace/iteration-1 \
     --skill-name orchestrating-to-completion \
     --skill-path <repo>/skills/orchestrating-to-completion
   ```

   This emits `benchmark.json` + `benchmark.md` (pass_rate / time / tokens, each
   mean ± stddev, plus the delta). Put each with_skill config before its
   without_skill counterpart so the delta sign reads "skill minus baseline".

4. **Analyst pass.** Read the benchmark with `agents/analyzer.md`'s "Analyzing
   Benchmark Results" lens — flag non-discriminating assertions (pass in both
   configs → not measuring the skill), high-variance evals (possibly flaky), and
   time/token tradeoffs. These notes go in `benchmark.json`'s `notes`.

5. **Launch the viewer** (optional, for human review of the actual transcripts):

   ```bash
   uv run --python 3.12 python \
     "$HOME/.claude/plugins/cache/claude-plugins-official/skill-creator/unknown/skills/skill-creator/eval-viewer/generate_review.py" \
     ./orchestrating-to-completion-workspace/iteration-1 \
     --skill-name orchestrating-to-completion \
     --benchmark ./orchestrating-to-completion-workspace/iteration-1/benchmark.json \
     --static ./orchestrating-to-completion-workspace/iteration-1/review.html
   ```

   Use `--static <path>` in headless environments (no display); it writes a
   standalone HTML instead of starting a server. Drop `--static` to serve it.

## The codex pairing — a non-Claude second judge

The grader is Claude judging a Claude transcript. That correlated blind spot is
exactly where a second, *non-Claude* judge earns its keep. After `grading.json`
is written, run codex over the **same transcript + the same four assertions** and
ask it to render its own verdict:

```bash
scripts/codex-review.sh        # the P2 reviewer, or:
codex exec review "<the four assertions, verbatim> — judge each PASS/FAIL \
  against this transcript with evidence; you are a second, independent judge." \
  --base main -m gpt-5.5 -c model_reasoning_effort=high --json -o /tmp/codex-grade.json \
  < /dev/null
```

Then diff codex's per-assertion verdicts against the grader's `grading.json`.
**Agreement is reassuring; disagreement is the high-signal event** — it means an
assertion is weak (both judges *should* agree on a discriminating one) or the
transcript is genuinely ambiguous. Treat a split decision the way `grader.md`
treats a pass on a weak assertion: as a flag to fix the assertion or the skill,
not as noise to average away. codex is the **tiebreaker**, not a vote that gets
mean-ed in.

## Reading the numbers honestly

- **Behavioral LLM grading is noisy.** A single mean-delta can be a coin flip.
  Look at the **stddev gap**, not just the mean: a +0.2 mean delta with a 0.3
  stddev on both sides tells you nothing; a +0.2 delta with tight stddev on both
  sides is a real signal. This is why we run 3× and why `aggregate_benchmark.py`
  surfaces stddev at all.
- **codex is the tiebreaker, not an authority.** When the two judges agree, trust
  the direction. When they split, investigate the assertion — do not pick a
  winner by fiat.
- **The numbers are directional, never a verdict.** They tell you whether a skill
  edit helped or hurt the four behaviors, not whether the skill is "done."
- **This is NOT a per-commit gate.** It spends real tokens and minutes per run
  and the result is noisy — running it on every commit is both wasteful and
  misleading. It is a **pre-release / before-and-after-a-discipline-edit check**,
  run deliberately, the same way `scripts/eval-trigger.sh` (Track A) and
  `scripts/codex-review.sh` are out-of-band rather than hooks. It is **not** part
  of `bash run-tests.sh`.

## Dependencies

- **uv** + **Python 3.12** — `scripts/eval-benchmark.sh` runs the aggregator via
  `uv run --python 3.12`; the system 3.9 cannot run skill-creator's PEP-604 code.
- **`claude` CLI, logged in** — for spawning the with_skill / without_skill /
  grader subagents (the run + grading steps). No API key; it uses your session
  auth.
- **`codex` CLI, logged in (OAuth)** — for the second-judge pairing in step "The
  codex pairing".
- **skill-creator** present in the plugin cache at
  `~/.claude/plugins/cache/claude-plugins-official/skill-creator/unknown/skills/skill-creator`
  — the wrapper `cd`s there so `scripts.aggregate_benchmark` resolves, and the
  grader/analyzer roles live under its `agents/`.

## When to run

- **Before a release, and before/after any edit to `orchestrating-to-completion`'s
  discipline layer** (decision program, Rationalization Table, Red Flags, the
  board protocol). Compare with_skill vs without_skill, and the new skill vs the
  old, to confirm a discipline edit moved the four behaviors in the right
  direction rather than just reading nicer.
- Not on every commit, not in CI — see "Reading the numbers honestly."
