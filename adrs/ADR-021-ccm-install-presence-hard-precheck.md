# ADR-021 — ccm 硬前置：bootstrap install-presence 硬查 vs 运行时软降级边界

> Status: **Accepted**（方向经用户拍板·2026-06-30）
> Date: 2026-06-30
> Scope: 把 `ccm`（ADR-014 的主机安装前置）从「可选 + 运行时静默降级才暴露」**提升到「ARM 入口 fail-loud 硬前置」**——`bootstrap-board.sh` 在触发门之后、建板之前硬查 `ccm` install presence（`command -v ccm`·`CCM_BIN` 覆写则 `[ -x "$CCM_BIN" ]`）；缺则**拒绝 arm**（不建 board）+ 注一条 `<directive source="bootstrap">` agent-relay 安装提醒 + `exit 0`（不 `decision:block`）。同时框定它与**运行时 hook 软降级**（既有·不动）的边界：bootstrap 硬查管「装没装」（二元·install presence·用户可修），运行时软降级管「装了但这一下没响应」（瞬态·鲁棒性·不让一次抽风崩掉长程编排）。**纯 bash `command -v`（红线1 floor·不 spawn ccm·不需 node）·窄腰无关（缺 ccm 路径根本不建板·红线2）·dormant-until-armed 不破（不建板→不武装→运行时 hook 继续休眠·红线6）·不破 ship-anywhere（ADR-014 已把 ccm 定为主机前置·本 ADR 只把既定前置提前 fail-loud·不新增依赖）。**
> Source: `design_docs/plans/2026-06-29-hooks-enhancements-v2.md` §3（④ bootstrap ccm 依赖校验·用户已拍「拒 arm + 立 ADR + 改 README 硬前置」三决策）。
> Co-signed: user (owner)

---

## 1. Context

ADR-014 把 board 引擎解耦为独立安装的 `ccm`（per-OS Node SEA 二进制 + `@ccm/engine`），plugin 降为消费方之一，**`ccm` 成为主机安装前置（诚实记账）**。board v2 的写入关卡（ADR-013）进一步要求 agent **一律经 ccm 写 board**——SKILL A 已退役「整文件 Write」，没有 ccm 就写不动 board。

但这条硬前置依赖的缺失，此前**只在运行时静默暴露**：运行时 hook（board-lint / verify-board / usage-pacing / identity-nudge）对 ccm 缺失全部优雅降级静默。于是一个**装了 plugin 但没装 ccm 的用户**起一场 orchestration 时——`bootstrap-board.sh`（纯 bash·不需 ccm）照样把 board 创建出来，agent 随后想用 ccm 操作 board 却全部静默失败 / 降级，体验是「一切看起来在跑、实则瘸腿」（phantom orchestration）。

**这是个起点盲区**：硬前置依赖缺失，却没有任何一处在起点响亮告诉用户。把它留到运行时才（静默地）暴露，违背 fail-loud 原则——「从来没装 ccm」是用户**能且应当修**的确定性环境缺陷，该在 ARM 入口就响亮拦下。

## 2. Decision

在 `bootstrap-board.sh` 的 **ARM 入口**（触发门之后、确认确实是 as-master-orchestrator 点火；建板之前）加一道 **install-presence 硬查**。缺 ccm → **拒绝 arm**。

### 2.1 怎么查（纯 bash·红线1 floor）

`command -v ccm >/dev/null 2>&1`（POSIX·零依赖·**不 spawn ccm 本身**——只判「在不在 PATH」，不需 ccm 能跑）。`CCM_BIN` 覆写（绝对路径·与 node hook 同口径）则 `[ -x "$CCM_BIN" ]`。bootstrap 仍是 ship-anywhere 的 ARM floor（纯 bash·不需 node）。

### 2.2 缺 ccm → 拒 arm（不建 board）+ directive agent-relay + exit 0

**姿态 = 拒 arm（用户已拍）**，不用 arm-but-warn：
- **不建 board 的理由**：board v2 写入关卡要求 agent 一律经 ccm 写 board。没 ccm，agent 拿到一块 board 也**无法正确操作它**（写不动·只能裸 Write 绕过关卡·破 v2 数据完整性）。建一块「能创建、不能操作」的 board = phantom orchestration，**比不建更坏**（用户以为起来了）。故拒 arm 比 arm-but-warn 更干净。
- **信息怎么到达用户**：要提醒的是**用户**（去装 ccm），但 hook 的注入信道（additionalContext）进的是 **agent** context；UserPromptSubmit 是可阻断事件，`exit 2` 的 stderr 也只给 agent 不给用户——**没有从 bootstrap 直达用户的纯净信道**。唯一可靠路径是 **agent-relay**：注一条 `<directive source="bootstrap">` 明确指令 agent「ccm 未安装·请立即转告用户安装·在用户确认装好前不要继续编排」，由 agent 转告用户。ccm-缺失是**硬前置依赖未满足**（系统级硬约束），故是 **directive** 而非 advisory（ADR-018 directive 留给硬约束·内含 why 让 agent 带理解地遵从·P5）。bootstrap 是 bash·不能 require node 的 `directive()` wrapper，故直接手写 `<directive source="bootstrap">…</directive>` 标签字符串（标签只是文本·§13 作者侧纪律照样满足·source 必填）。
- **退出形态 = exit 0（不 block）**：注入 directive 后 `exit 0`，**绝不 `decision:block`**——block 会让 agent 收不到 directive、无法主动 relay。此路不创建 board，故本 session 不武装任何 hook（无 active 板 → 所有 runtime hook 继续休眠·dormant-until-armed 自然成立·红线6）。
- **幂等·可重试**：用户装好 ccm 后重跑命令 → `command -v ccm` 通过 → 正常 fresh-arm 建板。

## 3. Consequences

### 3.1 硬查 vs 软降级的边界（关键收口·这条边界正是本 ADR 该框的「为什么 X 不 Y」）

| 维度 | bootstrap 硬查（本 ADR·新增） | 运行时 hook 软降级（既有·**绝不动**） |
|---|---|---|
| 判据 | **装没装**（`command -v ccm`·二元 install presence） | **临时可不可用**（spawn 失败 / ENOENT / 超时 / 非 0·瞬态） |
| 时机 | 一次性·ARM 入口（UserPromptSubmit 点火那一刻） | 每回合·运行时（各 hook body 内 spawn ccm 时） |
| 处置 | **fail-loud + 拒 arm**（directive 提醒用户去装·不建 board） | **静默降级**（board-lint/verify-board 静默放行·usage-pacing 退本地反推·identity/critpath-nudge 不注入·绝不 block） |
| 面向 | **用户**（去装这个前置·能修） | **agent / 流程**（不让一次瞬态 ccm 抽风崩掉整场长程编排） |
| 为什么不同 | 没装 = 用户能且应当修的环境缺陷·该在起点响亮拦 | 装了但偶发抽风（PATH 抖动 / 二进制升级中 / lock 争用）= 不该让长程 orchestration 因一次瞬态失败停摆 |

**边界一句话**：**「从来没装」是用户的环境责任·起点硬拦；「装了但这一下没响应」是鲁棒性问题·运行时软扛。** 两者不矛盾、不互相删除——本 ADR **只在 bootstrap 加一道 install-presence 硬闸**，**绝不动**运行时 hook 的 graceful-degrade（那些 degrade 是长程存活的安全网·删了会让一次 ccm 瞬态抽风崩掉整场编排·违 ship-anywhere 精神）。

### 3.2 红线核对

- **红线1**：纯 bash `command -v`（+ 可选 `[ -x "$CCM_BIN" ]`）·零 jq/python/node·directive 标签纯字符串拼接。bootstrap 仍 bash floor。
- **红线2**：不读 / 不写任何 board 字段（缺 ccm 路径根本不建板）。窄腰无关。
- **红线4**：directive 是面向「硬前置缺失」的合法系统级闸（ADR-018 directive 留给硬约束·这正是其一）·指挥不演奏无关。
- **红线6（dormant-until-armed）**：缺 ccm → 不建 board → 不武装 → 所有 runtime hook 继续休眠（自然成立）。bootstrap 仍是唯一豁免的 ARM 动作（它就是 ARM 本身·此路是「ARM 前置未满足→拒 ARM」）。
- **ship-anywhere（红线5）**：ADR-014 已把 ccm 定为主机安装前置（诚实记账）；本 ADR 只把这条「已经存在的前置」从「运行时静默降级才暴露」**提前到 ARM 入口 fail-loud**，**没有新增任何依赖**。ccm 是 node 应用 / per-OS SEA 二进制，跑在任何能跑 Claude Code 的 OS 主机上（与 Bedrock/Vertex/Foundry 这类模型后端正交·同 ADR-006「node 之于 hook」的宿主/后端之分）。「提醒用户装 ccm」≠「加一个在某后端会断的依赖」。

### 3.3 user-facing 影响

README / README_zh 安装段把 ccm 从「建议装」改为「**必须先装**」（硬前置·两份同步）。这是把既定事实（ADR-014 已让 ccm 成为前置）对外诚实化，非新增约束。

## 4. Alternatives considered

- **arm-but-warn（建 board + 强 warn）**：被否（§2.2）——建一块「能创建、不能经 ccm 操作」的 board = phantom orchestration·比不建更坏。
- **`decision:block` 阻断这次 prompt**：被否为主路（§2.2）——是否把 reason 显示给用户取决于宿主 UI（不如 directive agent-relay 可靠）；且 block 后 agent 拿不到 directive、无法主动 relay。
- **留在运行时软降级、不在起点硬查**：被否（§1）——硬前置缺失留到运行时才静默暴露 = 起点盲区·违 fail-loud。

## 5. Related

- ADR-014（ccm 解耦为独立安装的工业化产品·ccm 成主机前置·ship-anywhere 口径修订）——本 ADR 把它定的前置提前 fail-loud。
- ADR-013（board v2 写入关卡·agent 一律经 ccm 写 board）——没 ccm 就写不动 board 是「拒 arm」的根因。
- ADR-007（hook-arming-gate·dormant-until-armed）——bootstrap 是唯一豁免的 ARM 动作；本路是「ARM 前置未满足→拒 ARM」。
- ADR-018（hook→agent 标签注入协议）——ccm-缺失警告用 directive（硬约束·内含 why）。
