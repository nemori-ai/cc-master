# cc-master

[![plugin](https://img.shields.io/badge/plugin-v0.20.1-0A7EA4)](https://github.com/nemori-ai/cc-master/releases/tag/v0.20.1)
[![ccm](https://img.shields.io/badge/ccm-v0.21.0-111827)](https://github.com/nemori-ai/cc-master/releases/tag/ccm-v0.21.0)
[![harness](https://img.shields.io/badge/harness-Claude%20Code%20%7C%20Codex%20%7C%20Cursor%20%7C%20Kimi-4B5563)](design_docs/harnesses/)
[![ccm CI](https://img.shields.io/github/actions/workflow/status/nemori-ai/cc-master/ccm-ci.yml?branch=main&label=ccm%20CI)](https://github.com/nemori-ai/cc-master/actions/workflows/ccm-ci.yml)
[![license](https://img.shields.io/github/license/nemori-ai/cc-master)](LICENSE)

> 中文见 [README_zh.md](README_zh.md) · Website: [cc-master.vibecoding.icu](https://cc-master.vibecoding.icu)

**Give it a big goal — and a budget. Then go do something else.**

cc-master turns the main agent of any supported coding-agent session into a **master orchestrator** — a project lead for long-running work. It decomposes your goal into a dependency graph, runs the independent pieces in parallel, paces quota against your real limits, keeps a durable plan that survives context resets and session handoffs, and knows exactly when to stop and ask you. You bring the idea and make the handful of calls that truly need you.

**Is this you?** You have ideas but aren't an engineer — you can't babysit a multi-day build to the finish. Or you're an engineer who'd rather solve the hard problem than manage breakdown, scheduling, and accounting. Or you lead a team and want to be ten of yourself. Three different people, one missing piece: **a mind that can manage the thing to the finish — and do the math.**

```
/cc-master:as-master-orchestrator turn my idea into something that works
```

One line starts a durable plan. The orchestrator can keep several workers moving at once and comes back with a decision package only when judgment is genuinely yours.

---

## One orchestrator, one engine, every harness

![cc-master architecture: any harness session's main agent is initialized into a master orchestrator, which commands the ccm engine over a process boundary](docs/images/architecture.svg)

cc-master works with **Claude Code, Codex, Cursor, and kimi-code** — the same soul, projected into each harness. It is built from three pieces:

- **The cc-master plugin** is a thin projection — commands, skills, hooks — that initializes the session's main agent into the orchestrator role. One semantic source is projected into per-harness adapters; only genuine host-native differences live in them.
- **`ccm` is the engine**: an independently installed CLI (plus the `@ccm/engine` library) that owns the board, goal contracts, quota posture, Monte-Carlo estimation, the cross-harness worker pool, and the agent registry. The plugin reaches it over a **process boundary** — shell + JSON, never imports — which is what keeps every harness equal.
- **`ccm web-viewer`** is read-only mission control for every board on the machine: the graph, the critical path, the decisions waiting on you, the agents in flight.

The upshot: the orchestrator's origin harness decides *where it sits* — not *what it can command*. The whole machine, every agent CLI on it, becomes the worker pool.

---

## A new human ↔ agent interaction paradigm

cc-master is also an exploration of how people and coding agents should share attention and judgment.

- **Attention, reallocated.** There is no neutral injection — every token in an agent's context steers the next one. So every message the system sends the agent is labeled by *who decides* and *how hard it should pull*: `<ambient>` background, `<advisory>` advice with an explicit strength, `<directive>` gates that carry their own *why*. Most traffic is advisory; directives are kept rare on purpose.
- **Judgment stays layered.** Taste, direction, irreversible calls — the calls only you can make stay yours. When a decision is genuinely yours, it arrives as a prepared **decision package**: context, options, tradeoffs, and a freshness check, so you decide once, at your convenience, against accurate and current evidence.
- **Explainable by construction.** The board is the plan, the memory, and the audit trail — any fresh session can pick it up and resume. The viewer renders it read-only. High-leverage calls get independently verified by a model of a *different family*. And wrapping up requires written evidence, path by path — "looks done" cannot close a run.

The aim is not "make a wish and the AI does it all." It is: **your attention goes only where it is actually worth spending.**

---

## The evolution: from a workflow plugin to a meta-harness

![the cc-master evolution timeline: plugin era, engine era, meta-harness era](docs/images/evolution.svg)

- **Act I — the plugin era** *(2026-06 · v0.1–v0.9)*. cc-master began as a Claude Code plugin that taught agents to write dynamic workflows. The inventions that lasted: the **board** as a durable plan, hooks that **sleep until armed**, cross-session resume, and the first pacing.
- **Act II — the engine era** *(2026-06/07 · v0.10–v0.11)*. Board logic left the plugin and became **`ccm`** — one binary, the single source of truth — then grew an OR/ML estimation & pacing engine: Monte-Carlo ship-date forecasts, EVM, conformal calibration, all hand-rolled with zero new dependencies. Plugin and engine now ship on **two independent version lines**.
- **Act III — the meta-harness era** *(2026-07 · v0.12 →)*. A source-to-adapter architecture projected the same soul into **Codex, Cursor, and kimi-code**, with N-host capability parity enforced as a mechanism, not a promise. With `ccm worker`, the orchestrator discovers, launches, and observes headless Claude Code, Codex, and Cursor Agent CLIs — the machine itself becomes the worker pool. For us, cc-master has become the **meta-harness of our own harness**.

---

## What it actually does for you

Hand a big job to a plain AI and you'll find out fast: it loses the plot mid-conversation, it can only do one thing at a time, it might burn your whole month's quota in one go, and it either pesters you every three sentences or quietly goes off the rails — then tells you it's "basically done" when it isn't. cc-master takes all of that off your hands:

- **🧩 Break it down, put a crew on it.** Your goal becomes a contract, then a dependency graph. The ones that can run at once, do — and it works out **which chain decides when the whole thing finishes** (the critical path) and leans on that.
- **🌐 Use the whole machine as a worker pool.** The orchestrator is not confined to its origin harness: it can inventory the agent CLIs installed on the machine, inspect their real capabilities, and explicitly run session-bound workers through `ccm worker` — then independently verify what comes back.
- **🔮 It tells you when you'll finish before it starts.** Thousands of simulations give you odds — *"50% chance Wednesday, 95% chance Friday"* — and flag which step is most likely to slip. That used to be a project manager with a spreadsheet for an afternoon.
- **💰 It manages limits instead of ignoring them.** Cached machine-wide quota posture and per-harness usage advice set the pace: Claude Code's 5h/7d windows, Codex's 7-day ceiling, Cursor's billing period — and where a harness exposes no signal at all, it stays honest about that instead of inventing certainty. On Claude Code, an *authorized* account pool can switch accounts; other harnesses never auto-switch.
- **🧠 It keeps a durable ledger.** The board records the goal revision, tasks, decisions, and registered agents across context resets and explicit session handoffs. A resume reconciles live evidence rather than trusting memory.
- **🏁 Done means done.** Before it wraps, it checks the current Goal Contract point by point: is every piece actually done and independently verified, did it ask you everything it should have, did anything quietly die in the background.

---

## Watch it work, start to finish

> You drop one line: **"Internationalize my app to 6 locales."** Then you go to sleep.

- **It figures out the order first**: strings must be extracted and the framework wired before any language can start — so it builds the groundwork, then fans out all 6 locales **at once**.
- **Groundwork gets the steadier model; the translations get the cheap one** — saving money without cutting quality.
- Halfway through, **a question only you can answer comes up**: *"Product terms — translate them, or keep them in English?"* It packages the context, options, and tradeoffs, **notes it for you, and every other locale keeps moving**.
- **When you come back**, the board shows what finished, what was independently checked, and whether your product-term decision is still blocking acceptance.

![the live plan: dependency graph with the critical path in amber](docs/images/viewer-graph-dark.png)

Start to finish, you said one sentence and made one decision. When the call is genuinely yours, it comes prepared:

![a decision package in the viewer: question, context, options, tradeoffs](docs/images/viewer-decision-card.png)

---

## When **not** to use it

A one-or-two-line fix you can knock out in ten minutes? Just do it — don't bring in the "project lead," that's overkill and it'll be slower. **This is built for the kind of goal that's too big for one person to track, takes days, and runs many threads at once.** The bigger, messier, and longer the job, the more it's worth.

---

## Get started

One command installs both pieces — the `ccm` engine and the cc-master plugin. The two **version independently**: the plugin ships under bare `vX.Y.Z` tags, `ccm` under `ccm-vX.Y.Z` tags, on separate release tracks. The installer resolves the latest of each line:

```bash
# install the latest of each line (plugin + ccm)
curl -fsSL https://raw.githubusercontent.com/nemori-ai/cc-master/main/install.sh | bash

# …or pin a specific version of either line — each flag is optional and
# independent; whichever you omit resolves to the latest of that line:
curl -fsSL https://raw.githubusercontent.com/nemori-ai/cc-master/main/install.sh | bash -s -- \
  --ccm-version ccm-v0.21.0 --plugin-version v0.20.1

# target a harness explicitly, or fan out to every installed supported harness:
curl -fsSL https://raw.githubusercontent.com/nemori-ai/cc-master/main/install.sh | bash -s -- --harness claude-code
curl -fsSL https://raw.githubusercontent.com/nemori-ai/cc-master/main/install.sh | bash -s -- --harness kimi-code
curl -fsSL https://raw.githubusercontent.com/nemori-ai/cc-master/main/install.sh | bash -s -- --all-harnesses
```

The installer detects your OS and architecture, downloads the right `ccm` binary, verifies every asset against the release's `SHA256SUMS` (a missing entry or digest mismatch stops the install), then distributes the matching adapter to each supported harness it finds. It requires **Node.js 22 or newer**, `unzip`, and a SHA256 tool. The `ccm` engine is a **hard prerequisite** — without it the plugin won't start an orchestration — which is exactly why the installer puts it in place first.

Then hand it a goal, from your harness:

```
# Claude Code
/cc-master:as-master-orchestrator <your goal>

# Codex
$cc-master-as-master-orchestrator <your goal>

# Cursor (Agent chat slash command)
/as-master-orchestrator <your goal>

# kimi-code (namespaced plugin command)
cc-master:as-master-orchestrator <your goal>
```

> **Moved your harness config?** `CLAUDE_CONFIG_DIR` still controls Claude Code's own settings and credentials. cc-master's runtime state is harness-neutral: boards, goal briefs, the account registry, and the quota sidecar live under `${CC_MASTER_HOME:-$HOME/.cc_master}`.

---

## Everyday use

The handful of commands you'll actually type. The in-session entrypoints are harness-specific; `ccm …` always runs in your **terminal**.

| You want | Command |
|---|---|
| Start / resume an orchestration | your harness's `as-master-orchestrator <goal>` or `… --resume` |
| See the live plan in a browser | `ccm web-viewer open` |
| One-screen status | `ccm status-report show` |
| Inventory the machine's agent CLIs | `ccm harness list --machine-wide --json` |
| Read cached quota posture | `ccm quota status --machine-wide --json` |
| Model role for a task kind | `ccm model-policy show --task <kind> --json` |
| Inspect / run a headless worker | `ccm worker help --harness <id>` · `ccm worker run --harness <id> --cwd <repo> -- <argv…>` |
| A decision is waiting on you | your harness's `discuss <decision>` |
| Wrap up and archive the board | your harness's `stop` (kimi-code: `cc-master:stop`) |
| Move the run to a fresh session | your harness's `handoff-to-new-session`, then `--resume` there |
| Retrospective → lessons | your harness's `retro`, then `distill <retro-path…>` |
| Account pool (Claude Code only) | `ccm account add\|list\|switch <email>` — token-blind, policy-gated |

> The full command surface is in the [command catalog](plugin/src/skills/using-ccm/canonical/references/command-catalog.md); what's shipped vs. still on the way is in the [Feature Manual](design_docs/feature-manual.md).

---

## Go deeper

- **Everything it can do, with honest status** → [Feature Manual](design_docs/feature-manual.md)
- **Cross-harness current / partial / target boundary** → [Capability model](design_docs/cross-harness-orchestration-capability-model.md)
- **Full design spec** → [`design_docs/spec.md`](design_docs/spec.md)
- **Architecture decisions (ADRs)** → [`adrs/`](adrs/)
- **Website** → [cc-master.vibecoding.icu](https://cc-master.vibecoding.icu)（源码 [`website/`](website/)）

### For contributors

The source of truth is `plugin/src`; `plugin/dist/<host>` is generated — don't edit it. Skills use SAP (`canonical/` + `adapters/<host>/strategy.yaml`), hooks use PHIP (`_manifest/`, `_hosts/<host>/`, `implementations/<host>/`). Regenerate and verify with:

```bash
bash scripts/sync-plugin-dist.sh                  # one host per --host flag
bash scripts/check-plugin-dist-sync.sh            # dist must match src
bash scripts/sync-codex-skills.sh                 # .claude/skills → .agents/skills
bash run-tests.sh                                 # hook + content contracts
```

Contributors start at [`AGENTS.md`](AGENTS.md); harness compatibility notes live in [`design_docs/harnesses/`](design_docs/harnesses/).

---

## Acknowledgements · License

Standing on the shoulders of those who came before: [Claude Code](https://code.claude.com/docs/en/workflows) (Anthropic), [claude-code-workflow-creator](https://github.com/ray-amjad/claude-code-workflow-creator), [superpowers](https://github.com/obra/superpowers), [claude-code-workflow-orchestration](https://github.com/barkain/claude-code-workflow-orchestration).

[MIT](LICENSE) © 2026 cc-master contributors
