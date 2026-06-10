# Cost & pacing — model tiers and usage-aware throttling

> **What this is — and what it is *not*.** Reference knowledge the orchestrator lacks by
> default: the four model tiers and their relative cost, why the main thread stays on one
> model, and how to pace a long-horizon run against the 5h/7d quota window. It is
> **informational, not a red line.** Subagent pressure baselines (model-tiering ×6,
> usage-pacing ×2, zero failures) showed agents already *derive* the right tiering/pacing
> from lens 2 (concentrate resources on the critical chain) and lens 5 (work within
> capacity). What they were missing is the concrete facts below — tier positioning + cost,
> the cache cost of switching the main model, and the quota-window signal source. So slot
> these into the per-node contract from `decomposition.md`; do **not** treat them as a
> separate discipline or add red lines for them (the baselines proved none are needed —
> §6 TDD-for-skills Iron Law forbids fabricating a rule agents won't violate).

## TOC
- [Model tiers](#model-tiers)
- [Per-node model selection](#per-node-model-selection)
- [Why the main thread stays on one model](#why-the-main-thread-stays-on-one-model)
- [Sensing the 5h/7d quota window](#sensing-the-5h7d-quota-window)
- [Pacing levers](#pacing-levers)

---

## Model tiers

| Tier | Model ID | $/1M in·out | Relative output cost | Use for |
|---|---|---|---|---|
| Fable 5 | `claude-fable-5` | $10 · $50 | **10×** | 最难的开放推理 / 创意 / 叙事 |
| Opus 4.8 | `claude-opus-4-8` | $5 · $25 | **5×** | 旗舰推理 · agentic · 临界路径难活 · 端点验收 |
| Sonnet 4.6 | `claude-sonnet-4-6` | $3 · $15 | **3×** | 平衡主力:常规实现 / review |
| Haiku 4.5 | `claude-haiku-4-5` | $1 · $5 | **1×** | 快 & 便宜:机械活(跑测试 / grep / 格式化 / 改名),200K context |

Output dominates orchestration spend (agents emit far more than they read), so the
**relative output multiplier** — Haiku 1× / Sonnet 3× / Opus 5× / Fable 10× — is the number
to pace against: one Opus leaf ≈ five Haiku leaves; one Fable leaf ≈ ten.

`effort` is the orthogonal dial (`output_config: {effort: …}`): `low` for subagents / simple
leaves, `high`/`xhigh` for intelligence-sensitive work. Lower effort = fewer tool calls +
less preamble — a real token lever, see `dispatch.md` admission control.

## Per-node model selection

Extend the per-node contract from `decomposition.md` with a **model** field, set by task
*difficulty* — not by whatever the main thread happens to run on:

- **机械 / 可机械检查** (跑测试套件、grep 定位、批量格式化、改变量名) → **Haiku**. No reasoning needed.
- **常规实现 / review** → **Sonnet**. The workhorse.
- **难 / correctness-critical / 临界路径** (选型架构、复杂并发 bug 根因、端点验收一段关键 diff) →
  **Opus**;最难的开放推理 / 创意 → **Fable**.

Concentrate the strong tiers on the critical chain (lens 2); give high-float mechanical work
the cheap tiers and let it run in the gaps (`decomposition.md` "Resource decision"). The
workflow-side analogue — escalating model tier *inside* a script as a stage gets harder — is
`staged-escalation.js` in SKILL B's examples (`agent({model})`); there the model literal is
part of the resume cache key, so keep it a literal.

## Why the main thread stays on one model

省钱在 leaf 配便宜模型,**不在中途切主线模型**. Switching the main conversation's model
mid-session is a false economy on three counts:

- **It throws away the entire prompt cache.** KV caches are not interchangeable across models
  — switch and the whole cached prefix re-bills as fresh input on the next turn.
- **It is doubly costly here.** cc-master's `SessionStart` hook re-injects the *full* SKILL A
  text after every compaction — a large, stable, cacheable prefix. Switching models forfeits
  exactly that cache.
- **It risks board continuity.** A model switch can ride a compaction / session boundary, and
  `owner.session_id` is the board's continuity anchor (see `board.md`).

Official Claude Code guidance is the same: keep the main conversation on one model; use a
*subagent* for side tasks that can run on a cheaper model. The lever is **per-leaf model
choice** — not `/model` on the main thread.

## Sensing the 5h/7d quota window

A Pro/Max subscription meters usage in a **5-hour rolling window** and a **7-day window**.
For a >24h goal those windows — not context% — are the binding capacity constraint (lens 5).
Three ways to read them, in ship-anywhere order:

1. **`scripts/cc-usage.sh`** — the out-of-band signal source this repo ships (system python3
   parses local `~/.claude/projects/**/*.jsonl`, zero network / deps; **NOT a hook**, runs on
   the main thread at a pacing decision point, like `codex-review.sh`). Emits
   `five_hour{used_tokens, window_remaining_min, burn_rate_per_min}` + `seven_day{used_tokens}`.
2. **`npx ccusage blocks --json`** — community tool, more accurate, carries an official burn
   rate; `cc-usage.sh` uses it as an optional accelerator when present.
3. **Status-line stdin** `rate_limits.{five_hour,seven_day}.used_percentage` — Pro/Max only,
   reachable **only** from a status-line script (not the JSONL). So `cc-usage.sh` does *not*
   emit context% / `used_percentage` — that one is status-line-only.

**Burn-rate wall prediction.** Will the current window survive the next batch?
`used_tokens + burn_rate_per_min × window_remaining_min` vs your plan ceiling. If that crosses
the ceiling before `window_remaining_min` elapses, you'll hit the wall mid-flight — pace now.

Honest scope: 5h/7d are *subscription* concepts; exact plan ceilings aren't officially
published (the community back-derives them), so `cc-usage.sh` emits absolute `used_tokens` +
burn rate and leaves the %-of-plan conversion to the caller. API-key users have no rolling
window — they pace on cumulative token spend instead.

## Pacing levers

When the burn-rate wall is imminent, **throttle without stopping** — 机械活仍可推进,全停是把
可用配额浪费掉 (lens 4);顶满会半截撞墙停摆 (lens 5). Four levers, roughly in order:

1. **Lower WIP** — fewer concurrent leaves in flight (Little's Law; `dispatch.md` admission control).
2. **Lower effort** — `high` → `low` on leaves that tolerate it.
3. **Downgrade model** — the main execution lever; route token-heavy work to a cheaper tier.
   This is where tiering and pacing mesh: **model downgrade *is* a pacing move.**
4. **Defer high-float work** — push non-critical token-heavy leaves to the next window; record
   on the board as `blocked_on: "quota-reset"` so they re-trigger when the window refreshes (a
   deferred decision the step-6 ledger keeps resumable).

Target ~75% utilization of the window, not 100% — leave headroom so a late critical task isn't
starved (lens 5).
