---
name: cc-master-skillsmith
description: 'Use when creating, editing, or reviewing a cc-master skill — especially a discipline-enforcing one (orchestrating-to-completion, authoring-workflows, this skill) whose rules an agent could rationalize away under pressure. Triggers: 新建/修改/审查本仓 skill、加 Rationalization Table / Red Flags / 决策程序、改 SKILL.md 的纪律段或 description；or when you catch yourself about to write skill prose without first watching an agent fail. Covers the TDD-for-skills loop: failing pressure baseline first, then write/edit, then close loopholes.'
---

# cc-master-skillsmith — TDD for cc-master skill discipline

> **This is a project-internal dev tool, not a distributed plugin skill.** It lives in
> `.claude/skills/` (used by cc-master's own contributors), NOT in `skills/` (which ships to
> plugin users). End users installing cc-master never see it; it exists only to forge *this repo's*
> skills.

This is the meta-skill: how cc-master writes and edits its own skills. It exists
because a skill that *enforces discipline* — "the conductor never plays an
instrument," "no production code without a failing test," "trust only the
endpoint, not a green gate" — is itself a piece of behavior under test. You cannot
know whether the prose actually changes an agent's behavior until you have watched
an agent **fail without it**.

**Writing a discipline skill IS test-driven development applied to prose.** The
pressure scenario is the test. The agent's verbatim rationalization is the failing
output. The skill section that kills that rationalization is the production code.

> **REQUIRED BACKGROUND:** This skill adapts the RED-GREEN-REFACTOR cycle from
> `superpowers:test-driven-development` and the subagent pressure-testing format
> from `superpowers:writing-skills`. If you have not internalized those, read them
> first — this skill assumes them and only adds the cc-master-specific contract.

---

## The Iron Law

```
NO DISCIPLINE SKILL — NEW OR EDITED — WITHOUT A FAILING PRESSURE BASELINE FIRST
```

The same Iron Law as TDD, mapped onto prose. Before you write or change a rule
that an agent could rationalize away, you must first run a **pressure scenario
through a subagent that does NOT have the skill** (or does not have the new
section) and watch it choose the wrong thing. No recorded failure → no skill edit.

Wrote the skill section before running the baseline? Delete it. Start over from
the baseline.

**No exceptions:**
- Not for "the rule is obviously right."
- Not for "I'm just adding one Rationalization Table row."
- Not for "it's only a wording tweak to a discipline section."
- Don't keep the unbaselined draft "as a reference" while you run the scenario —
  you will adapt it, and that is writing-after. Delete means delete.

**Violating the letter of the Iron Law is violating its spirit.** "I know what
agents would say, so I'll skip the baseline and just write the counters" is the
exact rationalization this skill forbids. You don't know what they'll say. You
*think* you do. The baseline is how you find out you were wrong.

### What this does and does NOT gate

This Iron Law gates **judgment-bearing, discipline-enforcing prose** — rules an
agent under pressure could talk itself out of. It does **not** gate:

- Pure reference/how-to content (API signatures, the workflow paradigm tree, a
  TOC, a fixed-format table). Those are validated by use, not by pressure. If a
  constraint is mechanically checkable (regex, `plugin validate`, a test), automate
  it — don't write a rule and pressure-test it.
- Mechanical edits with no behavioral claim (fix a dead link, rename a file in an
  index, update a count). The content contract (below) catches structural breakage.

If you are unsure whether an edit is "discipline" or "reference": does the edit
make a claim about *what an agent should choose when it's tempted not to*? If yes,
it's discipline — baseline it.

---

## The loop (RED → GREEN → REFACTOR)

| Phase | What you do | cc-master artifact |
|-------|-------------|--------------------|
| **RED** | Run a 3-pressure scenario through a subagent **without** the skill/section. | Verbatim rationalizations captured. |
| **Verify RED** | Confirm the agent actually chose wrong and *why* (the excuse). | The excuse text — copied word-for-word. |
| **GREEN** | Write the minimal skill prose that kills exactly those excuses. | New/edited SKILL.md section + a Rationalization Table row per excuse. |
| **Verify GREEN** | Re-run the same scenario **with** the skill. Agent now complies. | Agent cites the section, picks the right option. |
| **REFACTOR** | New rationalization surfaced? Add a counter + table row. Re-run. | Loophole closed, still GREEN. |

The full pressure-scenario recipe (the three pressures, the fixed prompt
scaffold, how to capture excuses, how to back-fill the table) lives in
[`references/pressure-testing.md`](references/pressure-testing.md). Read it before
you run your first baseline.

### The three pressures (always combine 3+)

A single pressure is academic — the agent just recites the rule. Real failures
need **time pressure + sunk cost + exhaustion** stacked together, forcing an
explicit A/B/C choice with no "I'd ask the user" escape hatch. The recipe file
has the exact wording; the short version:

- **Time** — deploy window closing, user waiting, deadline now.
- **Sunk cost** — hours/lines already invested; deleting "feels wasteful."
- **Exhaustion** — end of a long run, "just want this done."

Then capture the agent's excuse **verbatim** and back-fill it into the target
skill's **Rationalization Table** (excuse → reality, two columns) and **Red Flags**
list. The table is not invented from your imagination — it is a transcript of real
failures. That is the whole point of the baseline.

---

## How this relates to eval (qualitative vs quantitative)

cc-master tests its skills along two complementary axes. Do not conflate them.

| | This skill (pressure baseline) | Eval (`design_docs/eval/`) |
|---|---|---|
| **Kind** | Qualitative — surfaces *which* rationalizations exist | Quantitative — scores trigger/behavior rates |
| **Output** | Verbatim excuses → Rationalization Table rows | precision/recall numbers, mean±stddev |
| **Answers** | "What loophole must the prose close?" | "Did the change help or hurt, by how much?" |
| **When** | Before writing/editing any discipline rule | Track A on every `description` change; Track B around behavioral changes |

- **Track A — trigger accuracy** (`design_docs/eval/README.md`): does the
  `description` make Claude read the skill exactly when it should. Run before/after
  any `description` edit. Pressure baselines test the *body*; Track A tests the
  *frontmatter trigger*.
- **Track B — behavioral benchmark** (`design_docs/eval/track-b-benchmark.md`):
  with-skill vs without-skill behavioral assertions over transcripts, with codex
  as a second grader. The pressure baseline finds the loophole; Track B measures
  whether closing it moved the aggregate behavior.

The flow is: **pressure baseline (find the loophole, qualitative) → write/edit
prose → eval (confirm it helped, quantitative).** They are sequential, not
substitutes — a green Track-A number with no pressure baseline means you optimized
a trigger for a body you never tested under stress.

---

## The content contract is the authoritative structure gate

Behavior is yours to baseline; **structure is the harness's to enforce.** Do not
hand-check what the gates check.

```bash
./run-tests.sh                 # node "content" suite asserts every SKILL.md under BOTH
                               # skills/ (distributed) AND .claude/skills/ (project-internal,
                               # incl. THIS skill) has YAML frontmatter with name + description
claude plugin validate .       # validates the plugin manifest, distributed skills, commands
```

`run-tests.sh` must end with `ALL TESTS PASSED`. The content suite iterates both `skills/*/SKILL.md`
and `.claude/skills/*/SKILL.md`, so this very skill is under the same structure gate it preaches —
ship the frontmatter correctly and it passes. `claude plugin validate .` validates the *distributed*
plugin (manifest + `skills/` + commands); it does **not** see `.claude/skills/` (those are not part of
the shipped plugin), which is exactly why the content suite covers them.

### Frontmatter YAML quoting (Finding #1, blood-and-tears)

A `description` containing a `:` or `"` **must be quoted**, or the YAML parser
mis-reads it and `plugin validate` / the content test fail in non-obvious ways.
Wrap the whole value in single quotes (as this skill's own frontmatter does).
This is the single most common skill-authoring footgun in this repo — see
AGENTS.md §6. When in doubt, quote.

---

## Pointers

- **`references/pressure-testing.md`** — the full recipe: three-pressure scenario
  template, the fixed real-scenario prompt scaffold, capturing rationalizations
  verbatim, meta-testing when GREEN won't hold, and back-filling the
  Rationalization Table / Red Flags of the target skill.
- **`superpowers:test-driven-development`** — the RED-GREEN-REFACTOR cycle and the
  Iron Law this skill is modeled on. REQUIRED background.
- **`superpowers:writing-skills`** — the general (non-cc-master) skill-authoring
  discipline, the TDD↔skill mapping table, and the subagent testing methodology.
- **`skill-creator`** — the official Anthropic skill for scaffolding a skill,
  optimizing a `description`, and running evals. Use it to *create the files and
  run Track A/B*; use **this** skill to know *when you are allowed to write the
  discipline prose at all* (the pressure-baseline gate).
- **`design_docs/eval/README.md`** + **`design_docs/eval/track-b-benchmark.md`** —
  the quantitative half (Track A trigger accuracy, Track B behavioral benchmark).
- **`AGENTS.md` §6** — skill creation/maintenance discipline at the repo level
  (two-skills non-overlap, the YAML-quoting anti-pattern, content-contract pointer).

---

## Red Flags — STOP, you skipped the baseline

- About to write a discipline rule and you have **no captured failure** for it.
- "I'll baseline it later / after I draft the prose."
- "I already know what agents would rationalize."
- Adding a Rationalization Table row you **invented** rather than transcribed.
- Editing a discipline section's wording without re-running the scenario.
- "It's just a small wording change, the Iron Law doesn't really apply here."
- Treating a green Track-A eval as proof the *body* works (it only tests the trigger).

**All of these mean: stop. Run the pressure baseline through a subagent first.
Then write.**
