# ADR-008 — 账户权威 usage pacing（status-line capture）+ 运行时带外脚本落点

> Status: **Accepted**
> Date: 2026-06-12
> Scope: `hooks/scripts/usage-pacing.js` · `skills/master-orchestrator-guide/scripts/{cc-usage.sh,statusline-capture.js,codex-review.sh}` · `references/cost-and-pacing.md` · 仓库脚本落点约定（AGENTS §2/§3 红线5）
> Source: [[Finding #37]]（本地反推 5h reset 失真到数量级，误导 pacing）+ claude-code-guide 对 code.claude.com 的两轮官方核实

---

## 1. Context

cc-master 的 usage pacing 原本**只有本地反推**一条路：`cc-usage.sh` / `usage-pacing.js` 解析本地 `~/.claude/projects/**/*.jsonl`，按 ccusage 口径反推 5h 滚动窗口。Finding #37 在真实长会话里暴露了它的结构性缺陷——反推把窗口起点钉在「最近一段连续活动的首条消息」，**看不见服务端真实计费窗口的 reset 事件**，于是 reset 倒计时失真到数量级（实测反推「剩 21min」vs 账户面板权威「剩 2h55m」，差 2h40m），直接把 orchestrator 的 pacing 判断带沟里。

官方文档核实确立了两条硬事实：
- 账户权威的 5h/7d `used_percentage` + `resets_at` **只**出现在 **status-line 脚本的 stdin** 里；所有 hook 的 stdin、transcript JSONL、任何 `claude` CLI 子命令（`/usage` `/status` `/cost`）、`~/.claude` 落盘**全都没有**。API `anthropic-ratelimit-*` headers 是 API tier 的 RPM/ITPM，与订阅 5h/7d 滚动窗口口径不同，不能替代。
- plugin 安装把整个 repo 拷到 cache，但官方只保证**约定目录**（`skills/` `commands/` `agents/` `hooks/` `bin/`）随 plugin 可靠分发；顶层自定义 `scripts/` 不在约定范围、marketplace 行为未明确文档化。skill prose 里的**裸相对路径**会在用户 cwd 下解析、找不到 plugin 安装位置；官方推荐 `skills/<skill>/scripts/` + `${CLAUDE_SKILL_DIR}`/`${CLAUDE_PLUGIN_ROOT}` 引用。

这两条一起决定了「账户权威 usage 怎么拿 + 拿它的脚本放哪」。

## 2. Decision

### 2.1 账户权威优先，本地反推退为 fallback

引入一个 status-line 捕获通道：`statusline-capture.js` 在 status-line 被调用时，从 stdin 提取 `rate_limits.{five_hour,seven_day}.{used_percentage,resets_at}`，原子写入账户级 sidecar（默认 `~/.claude/.cc-master-rate-limits.json`）。`cc-usage.sh` 与 `usage-pacing.js` 优先读 sidecar：sidecar 存在且窗口有效（`resets_at > now`）→ 用账户权威口径（`source:"account"`）；缺/坏/陈旧 → 诚实退回本地反推（`source:"local-derived-approx"`，且输出标 approx）。`usage-pacing.js` 的撞墙判据由此**脱钩失真的反推 `window_remaining_min`**，改用账户 `used_percentage`，并**首次纳入 7d**（呼应 Finding #31：此前 hook 只看 5h、对 7d 全盲）。

### 2.2 `statusline-capture.js` 不受 dormant-until-armed（红线 6）约束

它**不是 hook**（不在 `hooks/`、不在 `hooks.json`，是 `settings.json` 的 `statusLine`）。它**不注入任何 agent context、不 block、不碰 board**，只被动缓存一个**账户全局只读信号**到账户级 sidecar。红线 6 / ADR-007「未武装即休眠」防的是 hook 在无关 session 注入/block/污染——本脚本无注入、无 block、无 per-session 污染，**其精神不触犯** → 无武装闸。（对照：`usage-pacing.js` 作为 Stop hook，武装闸一字未动。）

### 2.3 运行时带外脚本落 `skills/<skill>/scripts/`，dev-only 留顶层 `scripts/`

- **运行时**带外脚本（终端用户在 orchestration 里会跑：`cc-usage.sh` / `codex-review.sh` / `statusline-capture.js`）→ 搬入 `skills/master-orchestrator-guide/scripts/`，随 skill 分发；分发 prose 用 `${CLAUDE_SKILL_DIR}/scripts/...`（skill 内）或 `${CLAUDE_PLUGIN_ROOT}/skills/.../scripts/...`（command 内）引用。
- **dev-only** 脚本（仅开发本仓用：`eval-trigger.sh` / `eval-benchmark.sh` / `skill-lint.sh`）→ 留顶层 `scripts/`，只被 dev 文档 / dev skill / `run-tests.sh` 在 **repo 根**调用，裸相对路径在此**正确**——故不改。

## 3. Consequences

### 3.1 Positive
- reset 倒计时第一次有**不失真**的来源（账户权威 `resets_at`）；7d 维度第一次可判（Finding #31 缺口闭合）。
- 运行时脚本在终端用户那里**真能被引用到**（修了一个潜伏的既存分发 bug，见 [[Finding #38]]）。
- fallback 链保持 ship-anywhere：缺 status-line（headless / API-key / 非 Pro-Max）自动降级反推，不报错。

### 3.2 Negative
- 账户口径需用户**手动**把 capture 接进自己的 status-line（提供 `--passthrough` 不覆盖既有的）；没接则只有反推 approx。
- 账户 `used_percentage` 仅 Pro/Max 交互式可见；headless/cron 拿不到。
- status-line 在 idle 时安静 → sidecar 会变旧（缓解：`refreshInterval` + `resets_at` 是绝对时刻，倒计时仍准）。

### 3.3 Neutral
- 新增账户级 sidecar（`~/.claude/.cc-master-rate-limits.json`），gitignore-N/A（不在仓库）。
- cc-usage.sh 输出 schema 向后兼容扩展（加 `source` / `used_percentage` / `resets_at`，保留 `used_tokens` / `burn_rate_per_min`）。

## 4. Alternatives Considered

### 4.1 直接调 API 读 rate-limit headers
用订阅 OAuth token 调 Anthropic API、读 `anthropic-ratelimit-*` headers。**否决**：官方核实那是 API tier 的 RPM/ITPM（token bucket / per-minute），与订阅 5h/7d 滚动窗口是两套独立体系，口径不等价——拿来当账户用量会引入一个**新的**算错。

### 4.2 capture 脚本也加武装闸
让 `statusline-capture.js` 像 hook 一样武装后才写 sidecar。**否决**：它缓存的是账户**全局**信号（非 per-orchestration），无注入/无 block，武装闸只会平添复杂度并让未武装 session 的 status-line 拿不到缓存——与红线 6 要防的污染无关。

### 4.3 运行时脚本留顶层 `scripts/` + 全改 `${CLAUDE_PLUGIN_ROOT}` 引用
不搬文件，只把分发 prose 的裸路径改成 `${CLAUDE_PLUGIN_ROOT}/scripts/...`。**否决**（用户拍板）：顶层自定义目录官方「会拷贝但未明确保证分发」，是边缘风险；官方推荐布局是 `skills/<skill>/scripts/`，语义也对（它们是该 skill 的支撑脚本）。

## 5. Related
- [[Finding #37]]（本地反推 reset 失真 → 账户口径修复，本 ADR 的 Source）
- [[Finding #38]]（既存分发脚本裸路径 bug → 落点重构）
- [`ADR-006`](ADR-006-hooks-may-use-node-js.md)（node/JS 解锁，`statusline-capture.js` 与 `usage-pacing.js` 用 node）
- [`ADR-007`](ADR-007-hook-arming-gate.md)（dormant-until-armed；本 ADR §2.2 论证 capture 为何在其精神之外）
- [`references/cost-and-pacing.md`](../skills/master-orchestrator-guide/references/cost-and-pacing.md)（信号优先级 evergreen SSOT）

## 6. References
- Status line JSON schema（`rate_limits.{five_hour,seven_day}.{used_percentage,resets_at}`）：https://code.claude.com/docs/en/statusline.md
- Hook stdin contract（不含 rate_limits）：https://code.claude.com/docs/en/hooks.md
- Plugin caching / file resolution / `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_SKILL_DIR}`：https://code.claude.com/docs/en/plugins-reference.md · https://code.claude.com/docs/en/skills.md
- API rate-limit headers（不同口径）：https://platform.claude.com/docs/en/api/rate-limits
