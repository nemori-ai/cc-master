# 四 harness usage/quota 余额查询 review + 修复（2026-07-20）

> 任务：四 harness（claude-code / codex / cursor / kimi-code）账号用量余额查询都不许 unknown（unknown=bug）；多命令空间查余额应共享同一底层实现。本机四 harness 均已登录。
> 单独成篇（非 `dogfood-findings.md`）以避开并行 agent 对该台账的并发编辑；由 orchestrator 决定是否并入台账。

## 1. 现状盘点（修前 → 修后，freshly-built `ccm.cjs` 实测）

| harness | 修前 `ccm usage show --harness <h>` | 根因 | 修后 |
|---|---|---|---|
| claude-code | ✅ available（account 权威 5h/7d） | — | ✅ 5h=12% 7d=47% |
| codex | ✅ available（7d only；5h=null） | codex 配额模型只有 7d 滚动窗，5h=null 是**正确表示**、非 unknown | ✅ 7d=0% |
| cursor | ❌ available:false（unavailable） | `cursorAdapter.readCurrentUsage` 硬编码只读 `cursor-ide-plugin` surface（token 在 `state.vscdb`，本机读不到）；而同一订阅的 `cursor-agent-cli` surface（token 在 `auth.json`）能读到 22.76%。裸 `--harness cursor` 从不回退到能读到的 surface | ✅ bp=22.8% |
| kimi-code | ❌ available:false（"MVP no signal"） | `kimiCodeAdapter.readCurrentUsage` 硬编码返回 unavailable——`/coding/v1/usages` collector 从未接入（研究结论 `2026-07-16-kimi-quota-signal-research.md` 早已给出完整实现方案，但未落地） | ✅ 5h=3% 7d=6% |

**结论**：两个真 bug（cursor / kimi）均已修复并对**真实 endpoint 实测通过**（非仅 fixture）。codex 的 `5h=null` 不是 bug。

## 2. 根因 + 修复

### 2.1 cursor：`--harness cursor` 只读 ide surface（unavailable）→ 回退到 agent surface
- **文件**：`ccm/apps/cli/src/harnesses/cursor.ts` `readCurrentUsage`。
- **修**：改为先读 `cursor-agent-cli`（自包含 `auth.json`、机器可靠 reader），无信号再回退 `cursor-ide-plugin`，返回第一个有 live signal 的 surface。cursor 的 billing-period 是同一 first-party 订阅，两 surface 观察同一 pool、只差 token 存储位置，故用哪个 surface 报都语义正确。
- **不动** `readCurrentUsageForSurface`（machine-wide 逐 surface 分列读依赖它）。
- **实测**：`ccm --harness cursor usage show` 从 unavailable → bp=22.76%；`--harness cursor-agent` 无回归。

### 2.2 kimi-code：接入 `/coding/v1/usages` 只读 collector
- **新增**：`ccm/apps/cli/src/kimi-usage.ts`——读 `$KIMI_CODE_HOME/credentials/kimi-code.json` 的 `access_token`（**只读**，先判 `expires_at` 跳过必失败的 HTTP）→ `GET {base}/usages`（Bearer + Accept:json，Worker+Atomics 同步桥、复制 `cursor-usage.ts` 模式、零 npm 依赖、fail-open→null）→ 解析 `usage`（周）+ `limits[]`（5h 窗）→ `UsageSignal.{seven_day,five_hour}`。
- **改**：`harnesses/kimi-code.ts` `readCurrentUsage` → `readKimiUsageSignal`；`usageSource.pollable` false→true；token 过期/缺失时经 `describeKimiUsageUnavailable` 出诚实降级理由（**绝不刷新/轮换凭证**——研究 §6.2 红线）。
- **实测捕获的真 schema 修正**：live `/usages` 的 `timeUnit` 是 protobuf-enum 形态 `TIME_UNIT_MINUTE`（研究 fixture 写的是裸 `MINUTE`），`limits[]` 字段是**平铺**（无嵌套 `detail`）。`windowMinutes` 已加 `TIME_UNIT_` 前缀归一化；parser 已兼容平铺形。修正后 5h 窗也正确解析（5h=3%）。
- **测试**：`test/kimi-usage.test.ts`（解析 / remaining→used / reset_in / 空载 null / 过期跳 HTTP / 缺凭证降级 / **live enum-prefixed timeUnit 形态**）。

### 2.3 凭证只读纪律（守）
kimi access_token 短寿命（本机观测 ~几百秒），仅活跃 kimi session 期间由 kimi 自身刷新。collector **只读**、过期即诚实降级 `unavailable`，**从不刷新/写回凭证**。全程零凭证改动。

## 3. 多命令空间共享实现 review

**查 harness 账号余额的命令空间**：`ccm usage show/advise`、`ccm quota status --machine-wide`、`ccm monitor`、`ccm coordination`（+ `ccm provider facts` = 静态 model/pricing 目录，**非** live 余额，属另一 domain）。

**结论：底层 fetch 不重复——已收敛。** 每个 harness 的余额读取是**单一实现**（`cursor-usage.ts` / `codex-rate-limits.ts` / `kimi-usage.ts`〔本次新增〕/ claude statusline sidecar），统一经 `HarnessAdapter.readCurrentUsage[ForSurface]` 接口消费。所有命令空间最终都 bottom out 到这里，无重复 HTTP/解析实现。共享**派发边界**是 `DEFAULT_MACHINE_QUOTA_COLLECTORS.collect`（`router.ts`），被 quota-status / monitor / usage 的 cursor-agent 路径共用。

**一处真分叉（建议收敛·非本次修）**：`ccm usage show`（非 cursor-agent）**直接**调 `adapter.readCurrentUsage`、绕过 collector 边界；而 cursor-agent 路径经 `usage.ts` 里 `cursorAgentRequested` / `projectMachineReading` / `readSharedCurrentUsageSignal` 一套**专属 plumbing** 桥回 machine-wide 缓存。这套专属桥是当初为补 `--harness cursor` 不工作而加的；**cursor adapter 修好后（§2.1），裸 `--harness cursor` 已直接返回 agent 读数，此桥对常见路径部分冗余**。建议后续把所有 `ccm usage show --harness <h>` 统一走 collector 边界、删掉 cursor-agent 专属桥——但这会改 claude/codex 的读路径行为，需独立 dogfood + PR，本次不动。

## 4. 待协调 / 有意不做（诚实记录）

1. **kimi 未进 `ccm quota status --machine-wide` 扫描**：`machine-wide-quota.ts` `TARGETS` 无 kimi 条目，故 machine-wide 命令空间看不到 kimi（`ccm usage --harness kimi-code` 已可）。补 kimi 两条 target（5h+7d，值见研究 §5，已用 live schema 校验）会**级联** ADR-031 N-host parity 矩阵 + `using-ccm` command-catalog 文档锁步（§6）+ `machine-wide-quota.test.ts` 的 fake collector/delta 断言——属 reviewer-gated cascade，超出本次「聚焦、可自证、绿」的修复范围，**留作独立 follow-up**。
2. **machine-wide 的 decision=unknown/hard-stale**：观测到 machine-wide `readings` 新鲜（cursor 22.76% / claude 0%/45%）但 `decisions` 报 hard-stale——这是 admission-store 决策层的持久化新鲜度，**非 usage-read 层 bug**（读数携带余额、且新鲜）。不在本任务修复面。
3. **codex machine-wide 偶发 `used_percentage:null`**：瞬态（codex app-server 时延）；`ccm usage show --harness codex` 连续三次稳定 7d=0%。非稳定 bug。
4. **未碰**（并行 worker-run subagent 的 turf）：`worker-process.ts` 及 worker 启动 driver。本次仅动 usage/quota 相关文件。

## 5. 自证
- `pnpm -C ccm typecheck` ✅ · `pnpm -C ccm lint` ✅ · `pnpm -C ccm test` ✅（1493 pass / 0 fail / 67 skip）。
- 四 harness `ccm usage show` 均 `available=true`、零 unknown（freshly-built `bin/ccm.cjs` 实测）。
