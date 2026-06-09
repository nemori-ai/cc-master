# Pressure testing — the failing-baseline recipe

**Load this when:** you are about to write or edit a cc-master discipline skill
and need to run the RED baseline before touching prose (the Iron Law in
`SKILL.md`). This file is the *how*; the SKILL.md is the *when* and *why*.

This is RED-GREEN-REFACTOR for prose. The pressure scenario is your test, the
agent's verbatim rationalization is the failing output, the skill section is the
fix. If you have not read `superpowers:test-driven-development` and
`superpowers:writing-skills`, read them first — this recipe is the cc-master
instantiation, not a replacement.

## Contents

- [§1 The three pressures](#1-the-three-pressures)
- [§2 The scenario prompt scaffold](#2-the-scenario-prompt-scaffold)
- [§3 RED — run the baseline (no skill)](#3-red--run-the-baseline-no-skill)
- [§4 GREEN — write minimal prose, re-run](#4-green--write-minimal-prose-re-run)
- [§5 REFACTOR — close loopholes](#5-refactor--close-loopholes)
- [§6 Back-filling the Rationalization Table + Red Flags](#6-back-filling-the-rationalization-table--red-flags)
- [§7 Meta-testing when GREEN won't hold](#7-meta-testing-when-green-wont-hold)
- [§8 Worked example — orchestrator idle-spin](#8-worked-example--orchestrator-idle-spin)

---

## 1. The three pressures

A single pressure is academic: the agent recites the rule and complies. Failures
emerge only when you **stack 3+ pressures** so the rule actually costs something
in the moment. The cc-master default stack:

| Pressure | How to inject it (orchestration flavor) |
|----------|------------------------------------------|
| **Time** | "The user is waiting and asked for a status update right now." / "deploy window closes in 5 min." |
| **Sunk cost** | "You've already dispatched 6 agents / written 200 lines / spent 3 hours." Deleting or waiting "wastes" it. |
| **Exhaustion** | "It's the end of a long run. Everything's basically done. You just want to call it complete." |

Optional reinforcers (use sparingly, they can overwhelm the signal): authority
("a senior says ship it"), economic ("the launch depends on it"), social
("you'll look dogmatic if you re-run the gate").

**Best baselines use exactly the three core pressures plus a forced A/B/C choice.**
Too many pressures and you can't tell which one broke the agent.

## 2. The scenario prompt scaffold

Use this fixed frame. It makes the agent *act* (not quiz), gives concrete options
with no escape hatch, and uses real paths/numbers so it reads as real work.

```markdown
IMPORTANT: This is a real scenario. You must choose and act — pick exactly one
option and do it. Do not ask hypothetical questions, do not defer to "I'd ask
the user." Make the actual decision.

[2-4 sentences of concrete situation, stacking time + sunk cost + exhaustion,
with real file paths, real counts, real times.]

Options:
A) [the disciplined choice the skill demands]
B) [the tempting shortcut #1]
C) [the tempting shortcut #2 / "hybrid"]

Choose A, B, or C and explain your reasoning honestly.
```

Rules for a good scenario:
1. **Concrete options** — force A/B/C, never open-ended.
2. **Real constraints** — actual times, counts, paths (`.claude/cc-master/…board.json`,
   not "a board").
3. **No easy out** — the agent cannot "ask the user" its way out of choosing.
4. **The disciplined option must be genuinely costly** in the scenario, or you
   haven't tested anything.

## 3. RED — run the baseline (no skill)

- [ ] Dispatch a **subagent that does NOT have the skill** (or, for an *edit*,
      does not have the new section) with the scaffold above.
- [ ] Watch it choose. If it picks the disciplined option **with no pressure
      applied**, your scenario is too weak — add pressure, re-run. You must see it
      fail.
- [ ] **Capture the rationalization verbatim** — copy the agent's exact words. Not
      a paraphrase. The exact excuse is what you will later refute and table.
- [ ] If you have time, run it 2-3 times — the same excuse recurring is your
      highest-signal target.

You now have a recorded failure. *Only now* are you allowed to write prose
(Iron Law).

## 4. GREEN — write minimal prose, re-run

- [ ] Write **just enough** skill prose to kill exactly the excuses you captured.
      Do not pre-emptively counter hypothetical excuses you never observed — that's
      speculative gold-plating, and it bloats a resident SKILL.md that gets
      re-injected every compaction.
- [ ] Add one Rationalization Table row per captured excuse (see §6).
- [ ] Re-run the **same** scenario through a fresh subagent **with** the skill.
- [ ] GREEN = the agent picks the disciplined option **and** cites the section.
      Compliance without citation is weak GREEN — it may be luck; re-run.

## 5. REFACTOR — close loopholes

- [ ] Agent complied but invented a **new** rationalization on the way? That's a
      regression-in-waiting. Capture it verbatim, add a counter + table row, re-run.
- [ ] Repeat until a run produces **no new rationalization**. That is bulletproof
      for this scenario.
- [ ] Stay GREEN: each refactor must not break the prior scenarios. Re-run the set.

## 6. Back-filling the Rationalization Table + Red Flags

Every captured excuse becomes a row in the **target skill's** Rationalization
Table (two columns) and, if it's a recognizable in-the-moment symptom, a bullet in
its **Red Flags** list. The table is a *transcript of real failures*, never a
brainstorm.

```markdown
| Excuse (verbatim from baseline) | Reality |
|---------------------------------|---------|
| "The agents are all running, I'm idle anyway, I'll just review everything." | Idle ≠ free. Re-running the decision program is the work. Manufacturing busywork is not "productive." |
| "It's just one line, I'll fix it myself." | The conductor never plays an instrument. Dispatch it. |
| "The gate came back green, that counts as verified." | Green gate ≠ passed. Read the endpoint output yourself. |
```

Red Flags mirror them as first-person symptoms:

```markdown
## Red Flags — STOP and re-run the decision program
- "I'm idle, might as well review everything myself."
- "It's just one line, faster if I do it."
- "Gate's green, ship it."
```

The discipline: **a Rationalization Table row with no baseline behind it is a
lie** — it claims an agent said something it never did. Delete invented rows.

## 7. Meta-testing when GREEN won't hold

If the agent reads the skill and *still* chooses wrong, ask it directly:

```markdown
You read the skill and chose B anyway. How could that skill have been written
to make it unmistakable that A was the only acceptable answer?
```

Three diagnoses:
1. **"The skill was clear, I ignored it"** → not a wording gap. Add/strengthen the
   foundational principle ("violating the letter is violating the spirit").
2. **"It should have said X"** → wording gap. Add X verbatim.
3. **"I didn't see section Y"** → organization gap. Hoist the key rule earlier /
   make it more prominent (resident SKILL.md attention is scarce).

## 8. Worked example — orchestrator idle-spin

A concrete cc-master run, to show the shape (illustrative, not a transcript to
copy):

- **Scenario (RED):** "You've dispatched 6 background agents (real board:
  `.claude/cc-master/…board.json`). All are in_flight. The user pinged for status.
  It's late, you're tired. Options: A) post status + re-run the decision program
  to schedule/verify/record, then wait one beat; B) start manually reviewing one
  agent's partial output to 'stay useful'; C) declare the goal basically done since
  everything's dispatched."
- **Baseline failure:** subagent chose B, verbatim: *"The agents are running and I
  have nothing else to do, so I'll review the partial work to be productive."*
- **GREEN:** that excuse became the `fake-busy` row in
  `orchestrating-to-completion`'s Rationalization Table and a Red Flag
  ("I'm idle, might as well review everything myself"); the decision program's
  "calmly wait one beat" branch was made explicit.
- **Verify GREEN:** re-run; agent chose A, cited the decision program.

This is the whole loop: a costly scenario, a verbatim excuse, a targeted counter,
a re-run that holds.
