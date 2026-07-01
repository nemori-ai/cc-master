# ADR-020 — hook 可经 `ccm board set-param` 写特定 ✎ board 字段（带锁）

> Status: **Accepted**（方向经用户拍板·2026-06-29）
> Date: 2026-06-29
> Scope: 松绑 AGENTS.md §12「hooks ... 状态写 sidecar，永不碰 board」这条 **pre-ccm 保守默认**——许可 hook 经 `ccm` 的带锁字段级 setter 写特定 ✎（非窄腰）board 字段；落地物：`@ccm/engine` 新增 ✎ 字段 `board.runtime` + `FMT-RUNTIME` warn（规则全集 46→47）、`ccm` 新增 `board set-param <key> <value>` 写 verb（least-privilege·收窄 `runtime.*`·白名单 + 值校验·走 runWrite 带锁）、新增 Stop 事件周期提示 hook `identity-nudge.js`（IDNUDGE·首个写 board 字段的 hook）、`using-ccm` 两份 reference 锁步。**narrow waist（红线2）一字不动**（`runtime` 是 ✎·hook 武装闸不读它）·hook 仍 bash+node/JS（红线1）·dormant-until-armed（红线6）不破。
> Source: `design_docs/plans/2026-06-29-periodic-prompt-and-board-params.md`（§4 ADR 大纲·用户拍板 setter 形态候选 B + clobber 轻解）。
> Co-signed: user (owner)

---

## 1. Context

§12 既有纪律是「hook 状态写 sidecar、**永不碰 board**」。这条是一个 **pre-ccm 保守默认**——它成立于「hook 用脆弱 bash 串解析 board、没有带锁写入关卡、任何 hook 写都担 torn-write / clobber」的时代。那个时代里，让 hook 写 board 等于把一条无锁、无校验、易撕裂的写路径塞进对 agent context 失明的 shell——保守禁掉是对的。

ccm（ADR-013/014）改变了这个前提：board 现在有一条**唯一写入关卡**——`runWrite` 管线（`withBoardLock` O_EXCL 原子抢占 → 读盘最新 → mutate → `lintBoard` 校验 → 原子写）。带锁 + lint-gated + 原子的写路径存在后，「hook 写 board 必担 torn-write」这条根因消失了，§12 的保守默认可被**有条件松绑**。

第一个咬到这块空白的具体场景是 **IDNUDGE 周期提示 hook**：它要在长会话里隔一段时间（默认 6h）轻量重申「你是 master orchestrator」、并在漂离时提示重温 SKILL A，补 `reinject`（SessionStart·compaction 边界整篇重注魂）够不到的盲区——**长时间无 compaction 时的缓慢漂移**。判阈值需要一个**持久的「上次提示时刻」**：

- 它是 **per-board** 语义（「这块板的 orchestrator 上次被提示的时刻」），随板持久、跨 session resume 不丢、viewer 可观测。sidecar 是 **home-global**（如 usage-pacing 的换号冷却 `.cc-master-switch.json` 跨编排），语义错配。
- usage-pacing 的 LBHOOK 已开「hook 经进程边界 spawn `ccm`（`account switch`）」的先例（ADR-016），但那写的是 accounts.json / 凭证存储，**不写 board**。IDNUDGE 是 **第一个写 board 字段的 hook**，故需本 ADR 显式授权这条新能力面。

## 2. Decision

把 §12「hooks 永不碰 board」松绑为：**hook 可经 `ccm` 的带锁字段级 setter 写特定 ✎（非窄腰）board 字段**，受六条硬约束框死。

### 2.1 新增 ✎ 参数区字段 `board.runtime`（非 narrow-waist·红线2 不破）

`runtime` 作 board 顶层 **✎ flexible** 字段（与 `policy` / `coordination` / `baseline` 同档），装「周期 hook / script 跑起来后维护的瞬态簿记」。**hook 武装闸完全不读它**（只读 `owner.active`/`owner.session_id`·不变）——它不进 ADR-003 的 narrow waist。结构是命名键的对象（非自由扁平 map·避免滥用）。首个键服务 IDNUDGE：

```jsonc
"runtime": {
  "last_identity_remind": "2026-06-29T12:34:56Z"   // ISO-8601 UTC·IDNUDGE 上次注入身份提示的时刻
}
```

未来同形成员（周期 hook/script 的运行时簿记家族）= 加一条 ✎ 字段说明 + 复用同一条 `FMT-RUNTIME` warn lint，**不动 hook 武装闸、不动窄腰**。**已兑现的第二成员（hooks-enhancements-v2 ②·ADR-021 同批）**：`runtime.last_critpath_remind`（ISO·critpath-nudge 周期临界路径提示 hook 读它判 2h 阈值）——正是这条「加一个键 = 加一条 ✎ 字段说明 + 复用同一条 warn lint + 进 `set-param` 白名单」的同形扩展教科书例（`RUNTIME_PARAM_KEYS` 白名单 + `FMT-RUNTIME` 各加一条·`using-ccm` 两份 reference 锁步·hook 武装闸 / 窄腰一字未动）。

### 2.2 least-privilege scoped setter `ccm board set-param <key> <value>`（候选 B·用户拍板）

新增 `board` noun 的写 verb `set-param`，**作用域收窄到 `runtime.*`**，verb 层做 ① 键白名单（当前仅 `last_identity_remind`·非白名单 → exit 2 Usage）+ ② 值类型校验（ISO key 走 `isISOUTC`·非法 → exit 2）。走 `runWrite` → `withBoardLock` → 读盘最新 → `boardSetParam` mutate（`touch` 刷 `owner.heartbeat`·与所有写 verb 同口径）→ lint → 原子写。

**为何候选 B 而非候选 A（通用 `--set`）**：「hook 写 board」是 §12 松绑的新能力面——给它一个**恰好够用**的 scoped verb，比把一个能写任意 ✎ path 的通用逃生口交给 hook 更稳、更易守不被滥用。typo 的键 / 非法值 verb 层响亮拒（exit 2），不静默把垃圾塞进通用 ✎ map；审计面窄。`applySet` 的 `assertFlexible`（拒 🔒 path）是第二道兜底，verb 白名单是第一道。

### 2.3 hook 写 board 经进程边界 spawn（ADR-014 落点）

IDNUDGE 经进程边界 `spawnSync('ccm', ['board','set-param',...,'--board',<path>,'--home',<home>])` 写回（**不 import 引擎**·与 `adviseViaCcm`/`attemptCcmSwitch` 同模式·红线1 / ADR-014 进程边界）。**写回成功才注入**（spawn 在前、注入在后）——把「提示」与「记下已提示」原子绑定：ccm 缺 / 失败 / lock timeout → 不注入，杜绝「无法持久化 → 每回合重注」的 spam。

### 2.4 六条硬约束（把松绑框死）

1. **只写 ✎ 字段（参数区 `runtime.*`），绝不写 🔒/👁 窄腰** → **红线2 不破**（窄腰仍 hook-read-only-for-arming，applySet 守门 + verb 白名单双闸）。
2. **经进程边界 spawn `ccm board set-param`**（不 import 引擎）→ 红线1 / ADR-014 的进程边界落点。
3. **写经 board-lock + lint**（runWrite 管线）→ 无 torn-write；与并发 ccm 写者串行化。
4. **武装后才写**（红线6）+ **目标板确定**（仅 `ctx.boards.length===1` 时写·透传 `--board`·与 LBHOOK / ADR-016 §2.3「确定性目标板」同精神，避免多 active 板写错板）。
5. **ccm 缺 / 失败 → 优雅降级静默**（ship-anywhere·红线5；不 block Stop）。
6. **token-blind**（参数区无任何 secret·只有时间戳等簿记·与 LBHOOK 同纪律）。

### 2.45 bootstrap 作为板的创建者的 board-init 写边界（方案 A·`as-master-orchestrator` 启动 flag）

ADR-020 §2.2 给的是**运行时周期 hook**经 `ccm board set-param` 写 `runtime.*` 的 side-channel（least-privilege·收窄到簿记参数区）。`as-master-orchestrator` 的**启动期显式 board 参数 flag**（`--priority` / `--wip` / `--owner-wip` / `--policy-switch`）落在一个**不同性质**的写边界上，本节显式记录：

**`bootstrap-board.sh` 作为板的创建者，在 fresh 建板初始化时可调完整 `ccm board update` / `ccm policy set` 写 coordination/scheduling/policy。** 它据用户在命令里**亲手敲的** flag，在「建板 + 盖 sid」之后、注入 ctx 之前，经进程边界 spawn：

- `ccm board update --board <新板> --priority <v> [--wip-limit <N>] [--owner-wip <N>]` → 写 ✎ `coordination.priority` / `scheduling.wip_limit` / `scheduling.owner_wip_limit`；
- `ccm policy set --board <新板> --autonomous-account-switch <allow|deny> --user-authorized` → 写 ✎ `policy`。

**与 §2.2 运行时 `runtime.*` nudge 的区分**：§2.2 是 hook 在编排**运行中**周期维护自己的簿记（瞬态·side-channel·收窄到 `set-param` 白名单）；本节是 bootstrap 在**建板那一刻**据用户显式输入做的**一次性初始化**——板的创建者天然有权初始化板的配置（同一脚本本就在写 owner.session_id/git 等）。故这里**不收窄到 set-param scoped verb**，用完整 `board update`/`policy set` 写 noun（它们本就是 agent 初始化板用的写命令）。

**为何不破红线**：

1. **红线1**——flag 解析是纯 bash token 循环（enum/int 轻校验），落地经**进程边界 spawn `ccm`**（不 import 引擎·同 §2.3）。
2. **红线6**——写在「建板 + 盖 sid」**之后**：板此刻已存在、本 session 已武装（bootstrap 是 ARM 动作本身）。绝不在未武装路径上写。
3. **红线2**——`coordination.priority` / `scheduling.*` / `policy` 皆 **✎ 非窄腰**字段（hook 武装闸只读 `owner.active`/`owner.session_id`·不读它们）；窄腰一字不动。
4. **best-effort 不 block 起跑**——板已建好；flag 应用失败（ccm 缺/报错/非法值）只在 ctx 附一句 `<advisory source="bootstrap">`，hook 仍 exit 0 走完 ctx 注入（ship-anywhere·红线5）。非法值（坏 priority/wip/policy）跳过该 flag、不 block。

**policy 授权语义（关键）**：`ccm policy set` 在非 TTY 须 `--user-authorized`（policy 视权限为用户所有·ADR-016）。bootstrap 在非 TTY 环境跑，故转 `--user-authorized`——但这**不是 hook 自授权**：授权的源头是**用户亲手在命令里敲了 `--policy-switch <v>`**，hook 只是把「用户已表达的换号偏好」转译成 ccm 调用。hook 永不在用户**没敲 flag** 时替用户设 policy（那才是越权·SKILL A「绝不自授权」红线）；agent 侧亦然——command step-3 明确「未经显式 flag 的换号偏好只能留默认，或请用户重发带 flag 的命令」。

### 2.5 clobber 风险的处置（轻解·用户拍板）

clobber（lost update）风险不在 ccm 之间（带锁串行化），而在 **agent 的「整文件 Write」模型**：agent 持旧整板内存快照 → hook 经 ccm 写 `runtime.last_identity_remind`（改盘上最新）→ agent 用 `Write` 整文件覆盖回盘 → hook 刚写的字段被冲掉。board-lock 是 advisory 锁，裸 `Write`/`Edit` 不抢它。

**本 chunk 采用轻解**（非「退役整文件 Write」的结构性大改）：① hook 独占 `runtime.*`（经 ccm set-param 带锁写）；② agent 永不写 `runtime.*`；③ 在 `orchestrating-to-completion/references/board.md`（board-写纪律 reference）加一句澄清：`runtime.*` 是 hook-owned·agent 写 board 须保留它——field-local Edit / ccm 写天然保留；若整文件 Write 须先 re-read 合并。**「退役整文件 Write」是独立的长期架构议题，本 chunk 不做。** 防御纵深（非主解）：set-param 锁内读盘最新 → 即便 agent 偶发裸写覆盖，hook 下一次 set-param 仍基于最新盘重写（自愈窗口）；set-param 失败必降级静默，不为 clobber 兜底而 retry 风暴。

## 3. Consequences

### 3.1 Positive
- 周期 hook 能持久化 **per-board** 簿记（IDNUDGE 的 `last_identity_remind`），随板持久 / 跨 session resume 不丢 / viewer 可观测。
- §12「永不碰 board」从「绝对禁令」精化为「✎-only·带锁·进程边界·武装后·token-blind」的有约束能力，匹配 ccm 时代。
- 为未来周期 hook/script 留了同形扩展位（加一个 `runtime.*` 键 + 复用 `FMT-RUNTIME`），不再各自发明 sidecar。

### 3.2 Negative（诚实记账）
- **第一个写 board 的 hook**——能力面扩张。靠「scoped verb（least-privilege）+ ✎-only + 武装闸 + 确定性目标板」四重收口防 creep；非红线破，但须 PR review 守「不被滥用为通用 board 写」。
- 轻解不根除 clobber 竞态（只靠「hook 独占 `runtime.*` + agent 不写它」的约定 + 自愈窗口）；结构性根除（agent 写 board 一律经 ccm·退役整文件 Write）留作独立议题。

### 3.3 Neutral
- 红线 1/2/4/5/6 全保（**这不是红线破·是 §12 约定松绑**——红线2 窄腰显式不动，因只写 ✎）。

## 4. Alternatives Considered

### 4.1 维持「永不碰 board」、IDNUDGE 用 home-global sidecar
拒：`last_identity_remind` 是 per-board 语义，home-global sidecar 错配（丢 board 可观测 / 随板持久 / 跨 session）；且 ccm 已提供安全写路径，旧默认的前提（无安全写路径）已不在。

### 4.2 候选 A：往 `board update` 加通用 `--set` / `--set-json`
拒（用户拍板候选 B）：`--set` 能写任意 ✎ path，把一个宽逃生口交给 hook，能力面偏大、审计面宽；scoped `set-param` 是 least-privilege——hook 拿到的写能力恰好是「写参数区」。

### 4.3 把参数区升入窄腰让某 hook 直接写
拒：无机制收益（hook 不需窄腰读它）、把每条参数升格成跨全 hook 契约改动（ADR-003 §3.2 摩擦）；✎ + 进程边界 setter 是更小更对的落点（同 ADR-016 §4.4）。

### 4.4 clobber 走 option①（退役整文件 Write·agent 写 board 一律经 ccm）
本 chunk 不做（用户拍板轻解）：那是 board v2 / ADR-013「ccm 唯一写入关卡」的设计本意、能从结构上消除 lost-update，但牵动 SKILL A 魂的改写 + pressure baseline 工序，是独立的长期架构议题，不绑在本 chunk。

## 5. Related
- ADR-003（窄腰·不动·只写 ✎）、ADR-007（武装后才写）、ADR-013/014（ccm 写入关卡 + 进程边界）、ADR-016（hook→ccm 进程边界 + ✎ 字段 + 确定性目标板先例）、ADR-018（IDNUDGE 注入按 advisory weak 标签）、ADR-015（写 noun vs 只读 namespace 分界·`set-param` 是写 verb）。
- 设计稿：`design_docs/plans/2026-06-29-periodic-prompt-and-board-params.md`。

## 6. References
- 落地物：`@ccm/engine` `board-model.ts`（FIELDS.board.runtime + FMT-RUNTIME）/ `board-lint-core.ts`（lintRuntime）·`ccm` `mutations.boardSetParam` / `handlers/board.setParam` / `registry` board set-param verb·`hooks/scripts/identity-nudge.js`·`skills/using-ccm/references/`（command-catalog + board-model-guide 锁步）。
- §2.45 board-init 写边界落地物（方案 A·启动 flag）：`hooks/scripts/bootstrap-board.sh`（fresh 路径建板后的 INIT FLAGS 段·经 `ccm board update`/`ccm policy set` 写 coordination/scheduling/policy）·`commands/as-master-orchestrator.md`（argument-hint + step-3「flag 已落板·原样保留别覆写 + 绝不自授权」约束）·`tests/hooks/test_bootstrap-board.sh`（INIT-FLAGS 系列覆盖两条触发路径）。
