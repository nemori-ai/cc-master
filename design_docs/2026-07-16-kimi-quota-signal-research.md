# kimi-code 配额用量信号调研 + ccm quota collector v1 接入方案

调研日期：2026-07-16。任务：K9（goal r1）。工作树：`/data/qiwei/repos/cc-master-wt/kimi`（`feat/kimi-code-harness`）。

> **一句话结论**：kimi-code 的 `/usage` 有明确上游 API 源——`GET https://api.kimi.com/coding/v1/usages`（`Authorization: Bearer <OAuth access_token>`），返回 5h / 周 两档滚动配额窗口 + booster 钱包余额；**推翻** `design_docs/harnesses/kimi-code.md` §10「worker driver 拿不到配额信号 → unsupported」的旧结论。**v1 推荐路线 = 直连 `/usages` API 轮询 collector**（对标现有 `cursor-agent-dashboard` collector，非 claude 的 statusline sidecar——kimi 没有可脚本化的 statusline 钩子）。

> **2026-07-20 owner 授权变更（取代本文旧的 observe-only 建议）**：ccm 现在获准在
> stored `access_token` 过期时使用 `refresh_token` 主动刷新。实现必须对凭证文件使用跨进程
> advisory lock，锁内重读并跳过重复刷新；仅在仍过期时调用 §1.2 的 OAuth endpoint，成功后
> 以同目录临时文件 + `rename` 原子写回轮换后的 token pair，并保留原文件权限。刷新失败不得
> 改写凭证，usage 干净降级并提示 `kimi login`。`CCM_KIMI_AUTO_REFRESH` 默认开启，允许显式
> 关闭回退到本文原先的只读行为。本文 §4/§6 中“collector 不能刷新”的判断是当时未获 mutation
> 授权下的历史结论，不再约束 2026-07-20 之后的 ccm 实现。

---

## 0. 证据等级

- **[src]**：kimi-code 开源仓库（`github.com/MoonshotAI/kimi-code`，MIT，浅 clone 到 `/tmp/kimi-code-src`，`pushed 2026-07-16`）的**生产源码 + 单测 fixture**——比对二进制做 `strings` 更强，是响应 schema 的权威源。
- **[tested]**：本机实测（curl / 凭证结构 probe），可复现命令随文。
- **[blocked]**：受只读约束 / auto-mode classifier 拦截而未做，附原因。

---

## 1. 路线 1 —— 开源考古结论（endpoint / auth / schema）[src]

### 1.1 `/usage` TUI 命令的上游

kimi TUI 的 `/usage` 面板（`apps/kimi-code/src/tui/components/messages/usage-panel.ts` 的 `buildManagedUsageSection`）由 **`packages/oauth/src/managed-usage.ts`** 拉取并解析。该模块就是全部答案。

- **Endpoint**：`GET {base_url}/usages`
  - `base_url` = config `providers."managed:kimi-code".base_url` = **`https://api.kimi.com/coding/v1`**（可用环境变量 `KIMI_CODE_BASE_URL` 覆写；模块内 `kimiCodeUsageUrl()` 拼 `/usages`）。
  - **完整 URL：`https://api.kimi.com/coding/v1/usages`**。
- **HTTP 头**（`fetchManagedUsage`，单测断言**只带这两个头**、无 `User-Agent`、无 `X-Msh-*`）：
  - `Authorization: Bearer <access_token>`
  - `Accept: application/json`
- **超时**：默认 8000ms，`AbortController`。
- **错误映射**：`401`→ 授权失败（提示 `/login`）；`404`→ usage endpoint 不可用（"Try Kimi For Coding"）；其他 → `HTTP <status>`。

### 1.2 凭证 / auth 依赖 [src + tested]

- **token 源**：OAuth **access_token**，落盘 `~/.kimi-code/credentials/kimi-code.json`。
- **文件 wire 格式**（snake_case，`packages/oauth/src/types.ts` `TokenInfoWire` + 本机实测一致）：
  ```
  { access_token, refresh_token, expires_at, scope, token_type, expires_in }
  ```
  - `access_token` / `refresh_token`：JWT（本机实测 access 长 677 字符）。
  - `expires_at`：**epoch 秒**（access_token 失效时刻）。
  - `token_type`："Bearer"；`scope`："kimi-code"。
- **短寿命**：本机 probe 时 access_token **已过期约 15 分钟**（`expires_at < now`）。token 生命周期短，是 collector 新鲜度的核心约束（见 §4.1）。
- **刷新机制**（`packages/oauth/src/oauth.ts` `refreshAccessToken`）：
  - `POST https://auth.kimi.com/api/oauth/token`（host 可用 `KIMI_CODE_OAUTH_HOST` / `KIMI_OAUTH_HOST` 覆写）
  - `Content-Type: application/x-www-form-urlencoded`，body：`client_id=17e5f671-d194-4dfb-9706-5516cb48c098` + `grant_type=refresh_token` + `refresh_token=<...>`
  - 返回新的 `{access_token, refresh_token, expires_in, scope?, token_type?}`；`expires_at = floor(now/1000) + expires_in`。
  - **⚠️ 刷新会返回新的 refresh_token（疑似轮换）并要求写回凭证文件——属 mutation，collector 不应做**（见 §4.1 与 §6）。

### 1.3 响应 schema [src]

`parseManagedUsagePayload` + `managed-usage.test.ts` fixture 给出的真实形状（解析器**刻意宽松**以容忍字段拼写漂移）：

```jsonc
{
  // 顶层周配额摘要（解析为 summary，默认 label "Weekly limit"）
  "usage": {
    "name": "Weekly limit",     // 或 title；缺省用默认 label
    "used": 40,                 // 或 remaining（则 used = limit - remaining）
    "limit": 1000,
    "resetAt": "<ISO8601>"      // 或 reset_at / reset_time / resetTime；或 reset_in/resetIn/ttl(秒)
  },
  // 滚动窗口明细数组（解析为 limits[]）
  "limits": [
    {
      "detail": { "used": 1, "limit": 100, "name": "?" },   // 缺 detail 时字段落在 item 顶层
      "window": { "duration": 300, "timeUnit": "MINUTE" }   // 300min → label "5h limit"
    },
    {
      "detail": { "used": 2, "limit": 50 },
      "window": { "duration": 24, "timeUnit": "HOUR" }      // → label "24h limit"
    }
  ],
  // 按量付费钱包（可选；解析为 extraUsage）
  "boosterWallet": {
    "balance": { "type": "BOOSTER", "amount": "20000000000", "amountLeft": "10000000000" }, // 定点数 /1e6 → cents
    "monthlyChargeLimitEnabled": true,
    "monthlyChargeLimit": { "currency": "USD", "priceInCents": "20000" },
    "monthlyUsed": { "currency": "USD", "priceInCents": "5000" }
  }
}
```

**窗口标签推导**（`limitLabel`）：`timeUnit` MINUTE 且 `duration%60==0` → `<h>h limit`；HOUR → `<n>h limit`；DAY → `<n>d limit`。即 kimi 至少暴露 **5h 滚动窗** + **周配额**（`usage` 摘要），可能另有 **24h 窗**。

**结论**：kimi 配额模型 = 5h/周 **滚动窗口**（同 Claude/Codex 家族，`used`+`limit`+`resetAt`），**非** Cursor 的单一 billing-cycle。这正好落进 ccm 现成的 `five_hour` / `seven_day` 窗口枚举（§3）。

### 1.4 隐藏 CLI 面 / server 面 [src]

- **无 headless `kimi usage` 子命令**（`kimi --help` 落根 help 无此项；`strings` 亦无——`kimi-code.md` §10 已证）。ACP builtin `usage`（`packages/acp-adapter/src/builtin-commands.ts`）description 是 "Show session **token** usage"——只是**会话级 token 计数**，不是账户配额。
- `/usages` 端点是**唯一**的账户配额上游；`/usage` TUI 面板、`status-panel` 均复用它。

---

## 2. 路线 2 —— 本机验证 [tested / blocked]

### 2.1 凭证形态 [tested]
本机 `~/.kimi-code/credentials/kimi-code.json` 字段与 §1.2 wire 格式**逐一吻合**；access_token 已过期（`expires_at < now` 约 934 秒）。**凭证值未写入本报告**（仅记形态 / 字段名）。

### 2.2 端点 liveness 实证 [tested]
用本机（过期）access_token curl `/usages`（只读，1 次）：
```bash
curl -sS -H "Authorization: Bearer <expired>" -H "Accept: application/json" \
  https://api.kimi.com/coding/v1/usages
# → HTTP 401
# {"code":"unauthenticated","details":[{"...":"REASON_INVALID_AUTH_TOKEN",...}]}
```
**证实**：① 端点在线；② Bearer OAuth 鉴权机制为真；③ 401 错误语义与 `managed-usage.ts` 处理逻辑对得上。

### 2.3 200 成功 schema 实测 —— 未做 [blocked]
计划「刷新 token → 拉 200 → 写回凭证保登录」，被 **auto-mode classifier 拦截**（正确判定：刷新会**轮换 refresh_token 并覆写凭证文件**，违反本任务「只读 / 不动配置」硬约束）。脚本**在执行前即被拒、从未运行**——**凭证文件全程零改动，无备份产生**。
- 影响：无本机 200 样本。但**响应 schema 由 §1.3 生产解析器 + 单测 fixture 权威确定**，200 实测仅是「确认本账户套餐的字段大小写」的边际验证，不影响 v1 方案。

### 2.4 statusline 定制口 —— 不存在 [src]
kimi **没有** Claude Code 式的**用户可脚本化** `statusLine.command` 钩子：
- `~/.kimi-code/tui.toml` 仅 `theme` / `notifications` / `editor` / `upgrade`，无 statusline 命令字段。
- 源码里的 "StatusLine/status bar" 全是 TUI **内部渲染**（`agent-swarm-progress.ts`），非外部命令注入点；`grep statusLine.command` 全仓零命中。
- **⇒ 对标 claude 的「statusline 捕获 sidecar」路线对 kimi 不可行**（见 §4 路线 B）。这与 ccm 对 Cursor 的既有判定同型（`harnesses/cursor.ts`：`externalStatusline.supported=false`）。

---

## 3. 路线 3 —— ccm 现有 collector 合同对标 [src]

ccm 机器级配额 collector 的合同（`ccm/apps/cli/src/machine-wide-quota.ts` + `harnesses/`）：

**collector target 形状**（`MachineQuotaTarget`）：
```
{ harnessId, surfaceId, providerId, bucketId,
  windowName: 'five_hour'|'seven_day'|'billing_period',   // 固定枚举
  durationSec, collectorId, sourceSchema, authSource, defaultCollectorHarness }
```
现有三家 collector：

| collectorId | kind | 窗口 | auth 源 | 取数机制 |
|---|---|---|---|---|
| `codex-app-server` | app-server | seven_day | codex-cli-current-login | app-server rateLimits |
| `claude-statusline-sidecar` | statusline-sidecar | five_hour + seven_day | claude-cli-current-login | statusline 钩子写 sidecar 文件 |
| `cursor-agent-dashboard` | dashboard-api | billing_period | cursor-agent-current-login | **鉴权 REST 轮询**（`cursor-usage.ts`）|

**collector 输出信号**（`@ccm/engine` `UsageSignal` / `WindowSignal`）：
```
UsageSignal { five_hour?, seven_day?, billing_period?: WindowSignal|null, captured_at?: epoch秒 }
WindowSignal { used_percentage?: 0-100, resets_at?: epoch秒 }
```
**取数落点**：`HarnessAdapter.readCurrentUsage(env)`（`harnesses/<host>.ts`）→ 具体 fetch 在 `<host>-usage.ts`。**kimi 的 `/usages` 与 `cursor-usage.ts` 同型**（鉴权 REST 轮询 → dashboard-api），是最接近的模板；但 kimi auth 更简单（读明文 JSON 文件 vs Cursor 读 `state.vscdb` sqlite）。

**现状**：ccm `KNOWN_ADAPTERS = [codex, cursor, claude-code]`，**无 kimi adapter**（`grep kimi ccm/ → 零命中`）。故 kimi 配额接入 = **新增一个 harness adapter**（不止一个 collector 函数）。

---

## 4. 路线 4 —— v1 collector 方案（按可行性排序）

### 路线 A —— 直连 `/usages` API 轮询 collector 【✅ 推荐 v1】
对标 `cursor-agent-dashboard`：读**已存**的 OAuth token（只读）→ `GET /usages` → 解析 → 映射 `UsageSignal`。

- **可得字段**：`five_hour.{used_percentage,resets_at}` + `seven_day.{used_percentage,resets_at}`（周摘要）。（24h 窗、booster 钱包余额无 UsageSignal 槽位——v1 丢弃或仅作 advisory metadata，见 §5。）
- **freshness**：**poll-on-demand，新鲜度 = 存储 token 有效期**。token 有效时拉到实时值；token 过期时**读凭证 `expires_at` 预判、跳过必失败的 HTTP、干净报 `unknown`**（reason：kimi token 过期，需运行 kimi 刷新）。**kimi 作 origin host 活跃编排时 token 持续新鲜**（kimi 每次 managed 调用前 `ensureFresh`）——正是最需要配速的时刻可用。此新鲜度特性与 claude sidecar「数据新鲜度 = 上次 statusline 渲染」同级、可接受。
- **auth 依赖**：`~/.kimi-code/credentials/kimi-code.json` 的 access_token（只读）；可选 env 覆写 `CCM_KIMI_ACCESS_TOKEN` / `CCM_KIMI_API_BASE` / `CCM_KIMI_USAGE_TIMEOUT_MS`（镜像 `CCM_CURSOR_*`）。**collector 绝不刷新/写回 token**（保持 ccm 对各 host 一贯的 observe-only 立场，同 cursor「account mutation forbidden」）。
- **实现落点（ccm 侧）**：见 §7。
- **工作量**：**S–M（约 1 个专注日）**。解析器可从 kimi-code MIT 源 `managed-usage.ts` 近乎逐字移植（附版权归属）；sync-HTTP worker 桥从 `cursor-usage.ts` 复制；adapter 样板照 `cursor.ts`。风险低（近似克隆 + 更简单的 auth）。

### 路线 B —— statusline 捕获 sidecar（对标 claude）【❌ 不可行】
Claude sidecar 靠用户配置 `statusLine.command` 每次渲染跑脚本写 sidecar。**kimi 无此外部钩子**（§2.4）——无处注入捕获脚本。**明确排除**。（注：任务背景假设「最差走 statusline 定制」，但实测 kimi 缺这个钩子；kimi 的正解是路线 A 直连 API，比 sidecar 更直接。）

### 路线 C —— session JSONL token 累计推算【⚠️ 降级估算，仅兜底】
kimi 在 session state 记 per-model `TokenUsage`（`packages/agent-core-v2/.../usage/usageOps.ts` `UsageModel`；`/usage` 面板的 `buildSessionUsageSection` 即渲染它）。collector 可跨 session 在滚动窗内累加 token。
- **缺陷**：产出的是**原始 token 计数、非服务端权威 5h/7d 配额 %**；无 reset 边界；看不到其他 surface（web / IDE）的消耗；本机抽样的 fresh session `wire.jsonl` 尚未落 token 明细（仅 metadata/config 行）。
- **定位**：严格劣于 A 的**估算兜底**，仅当 A 的 token 新鲜度缺口不可接受、且接受「估算而非权威」语义时才考虑。v1 不做。

**推荐：路线 A**。理由：① 有权威服务端 5h/周 配额 %（配速真正需要的信号）；② 是现有 cursor collector 的近似克隆，架构零新概念、复用 dashboard-api kind；③ auth 比 cursor 更简单（明文 JSON）；④ 解析器可从 MIT 上游直接移植。

---

## 5. kimi `/usages` → ccm `UsageSignal` 字段映射

| kimi `/usages` | ccm `UsageSignal` | 备注 |
|---|---|---|
| `limits[]` 中 `window.duration=300 MINUTE`（"5h limit"）| `five_hour.used_percentage = detail.used / detail.limit * 100`；`five_hour.resets_at = epoch(resetAt)` | 5h 滚动窗 |
| `usage`（"Weekly limit"，`used`/`limit`/`resetAt`）| `seven_day.used_percentage = used/limit*100`；`seven_day.resets_at = epoch(resetAt)` | 周配额摘要 |
| `limits[]` 中 24h/DAY 窗 | —（无槽位）| v1 丢弃；如需可议扩 `WindowSignal` |
| `boosterWallet.balance.amountLeft` | —（非窗口配额）| 按量付费余额；v1 忽略或仅作 advisory metadata |
| — | `captured_at = floor(now/1000)` | collector 拉取时刻 |
| `used` 缺失时 `remaining` | `used = limit - remaining` | 解析器已内建兜底 |

target 建议值（两条）：
```
harnessId: 'kimi-code', surfaceId: 'kimi-cli', providerId: 'moonshot',
collectorId: 'kimi-usages-api', sourceSchema: 'kimi-code/usages/v1',
authSource: 'kimi-code-current-login', defaultCollectorHarness: 'kimi-code',
windowName: 'five_hour'(durationSec 18000) / 'seven_day'(durationSec 604800)
```

---

## 6. 不可行 / 风险清单（诚实声明）

1. **statusline sidecar 路线（B）不可行**——kimi 无用户可脚本化 statusline 命令钩子（§2.4）。
2. **collector 不能刷新/轮换 token**——刷新会写回并疑似轮换 refresh_token，属 mutation，违反 ccm observe-only 立场，且并发 kimi 运行时可能互相踩踏令用户掉登录。⇒ collector 只读存储 token，过期即降级 `unknown`（不自愈）。
3. **token 短寿命 → 有覆盖盲区**——kimi 闲置 / 未运行时存储 token 迅速过期，此时机器级后台轮询拿不到实时配额（报 `unknown`）。活跃编排期无此问题。若盲区不可接受，才退路线 C 估算（劣化语义）。
4. **24h 窗 + booster 钱包余额无 UsageSignal 槽位**——v1 丢弃；不硬凑进 5h/7d/billing_period。
5. **200 成功 schema 未本机实测**（§2.3）——schema 靠上游源码 + 单测权威确定；上线前建议在一次真实 kimi 活跃 session（token 新鲜）下补一次 `/usages` 200 抓取校验字段大小写。
6. **kimi 成为已知 harness 的连锁面**——新增 adapter 会波及 N-host capability parity / hook parity 矩阵（ADR-031）与 `ccm quota status --machine-wide` 输出、`using-ccm` 文档锁步（AGENTS §6）；属 K5 实现任务的范围，本调研不展开。

---

## 7. 给 K5 任务书的实现落点（ccm 侧）

| 动作 | 文件 | 内容 |
|---|---|---|
| 新增 | `ccm/apps/cli/src/kimi-usage.ts` | token 发现（读 `~/.kimi-code/credentials/kimi-code.json` + env `CCM_KIMI_ACCESS_TOKEN`；先判 `expires_at` 再决定是否发请求）+ sync-HTTP（Worker+Atomics，复制 `cursor-usage.ts`）+ 移植 `managed-usage.ts` 的 `parseManagedUsagePayload`（MIT，附归属）→ 映射 `UsageSignal`。零 npm 依赖，fail-open→null。|
| 新增 | `ccm/apps/cli/src/harnesses/kimi-code.ts` | `HarnessAdapter{ id:'kimi-code', usageSource:()=>({kind:'dashboard-api',pollable:true,quotaModel:'rolling'}), inspectInstallation(探测 ~/.kimi-code + kimi bin via probeExecutable), detect(env)(KIMI_CODE_* env), readCurrentUsage→readKimiUsageSignal, session/sessionStoreRoots(最小), accountPool/externalStatusline: unsupported, ... }`（照 `cursor.ts` 样板，去掉 account pool）。|
| 编辑 | `ccm/apps/cli/src/harnesses/registry.ts` | `KNOWN_ADAPTERS` 加入 `kimiCodeAdapter`（注意探测优先级顺序）。|
| 编辑 | `ccm/apps/cli/src/machine-wide-quota.ts` | `TARGETS` 追加 kimi 两条（five_hour + seven_day，值见 §5）。|
| 编辑 | `ccm/apps/cli/src/harnesses/types.ts` | source 联合类型加 `'kimi-usages-api'`（+ authSource 字面量）；`UsageSourceKind` 复用 `'dashboard-api'`（无需新 kind）。|
| 新增 | 测试 | 镜像 `cursor-usage` 单测（解析 + 映射 + fail-open）+ machine-wide-quota target 测试；一份真实 `/usages` 200 fixture（脱敏）。|
| 锁步 | `using-ccm` 文档 / parity 矩阵 | 按 AGENTS §6 / ADR-031 检查 `ccm quota status --machine-wide` 输出与文档同步。|

**验收信号**：kimi 活跃 session（token 新鲜）下 `ccm quota status --machine-wide --json` 出现 `harness_id: kimi-code` 的 five_hour/seven_day 决策、`used_percentage` 与 TUI `/usage` 面板一致；kimi 未运行 / token 过期时该源干净报 `unknown`（不崩、不误报）。

---

## 附：复现命令基线

```bash
# 开源考古（响应 schema 权威源）
git clone --depth 1 https://github.com/MoonshotAI/kimi-code.git
sed -n '1,60p' packages/oauth/src/managed-usage.ts        # endpoint + parser
cat packages/oauth/test/managed-usage.test.ts             # schema fixture
grep -n clientId packages/oauth/src/constants.ts          # oauth client_id + host

# 端点 liveness（只读，token 已过期 → 401）
curl -sS -H "Authorization: Bearer <access_token>" -H "Accept: application/json" \
  https://api.kimi.com/coding/v1/usages
```
