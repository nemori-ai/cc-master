# 环境事实档迁移台账（112 条 · 只判不动）

> 判定轴（用户拍板）：**`--help` 按 Unix CLI 标准与最佳实践承载；help 不适合承载的，由 `using-ccm` 作为技术文档承载。**
>
> 本轮**只出判定，不改 ccm、不改 skill**。ccm 侧实作走 ccm 版本线，另行开工。
>
> 证据环境：本机 `ccm 0.22.1`，隔离 home 探针，未触碰真实 board。

---

## 0. 判据：Unix 段落规约就是那条边界

不必另造标准。man/`--help` 的传统段落本身已经划好了什么进什么不进：

| Unix 段 | 承载 | 本仓对应 |
|---|---|---|
| `SYNOPSIS` | 调用形态 | 母本的语法行 —— **已重复** |
| `OPTIONS` | 每个 flag 一行 | 母本的 flag 表 —— **已重复且有损** |
| `DESCRIPTION` | 它做什么、改什么、**不改什么** | 「只读 board」这类副作用声明 |
| `FILES` | 读写哪些路径 | `<home>/calibration/deadline-snapshots.jsonl` |
| `EXIT STATUS` | 退出码语义 | `exit 2/3/4` 的含义 |
| `ENVIRONMENT` | 环境变量 | `CC_MASTER_HOME` / `CCM_BIN` |
| `EXAMPLES` | 典型调用 | 母本的「例：」—— **已重复** |
| `SEE ALSO` | 相关命令 | 「label 回填不在此命令内，见 X」 |

**Unix help 不承载的三类**，一律归 skill：

1. **设计理由**（为什么 `board_id` 用路径 SHA-256 而不用可变的 goal —— help 说「是什么」，不说「为什么这么设计」）
2. **跨命令的流程与心智**（先 A 再 B 再 C、状态机全景、字段三档、什么时候用哪个）
3. **归纳与反模式**（症状→诊断的跨命令通则、「凡 🔒 字段都走 verb」这类抽象）

一句话判据：**这句话只关于一条命令 → help；要横跨两条以上命令才成立 → skill。**

---

## 1. A 族 · 命令目录（21 条 · 约 150KB）

**整体判定：主体迁 help。** 这一族逐条对应 ccm 的一个 namespace，本就是 per-command reference。

| 点 | 判定 | 落点 / 理由 |
|---|---|---|
| `ccm.cmd.task` | **迁** | SYNOPSIS/OPTIONS/EXAMPLES 已重复；状态转移的**合法性矩阵**是跨 verb 的 → 那部分归 `status-state-machine`（已单独成点） |
| `ccm.cmd.board` `.goal` `.agent` `.estimate` `.usage` `.jc` `.log` `.cadence` `.baseline` `.watchdog` `.calibration` `.account` `.capability-deps` `.peers-coord` | **迁** | 同上。语义段按 `DESCRIPTION`/`FILES`/`SEE ALSO` 归位 |
| `ccm.cmd.worker-quota` | **迁（部分）** | 其中 **codex / cursor-agent / kimi 的 flag 事实**（`--sandbox` / `--yolo` / `-p`）不是 ccm 的命令面，help 里只能作 `SEE ALSO` 提一句 → **跨 harness 对照表留 skill** |
| `ccm.cmd.ops-surfaces` `.misc-ns` `.cross-harness-facts` | **迁（部分）** | 单命令部分迁；「哪些面属于哪一层」的归类留 skill |
| `ccm.cmd.overview` | **迁（主体）** | 顶层 namespace 清单 = `ccm --help` 根输出，已重复。**「ccm 是数据模型 SSOT 的唯一写入关卡」这句概念框定留 skill** |
| `ccm.cmd.json-shape` | **⚠ 未决** | 见 §4 |

**已实测的重复证据**（两条完整并排）：

- `calibration capture`：语法、`positional：无`、6 个 flag 的类型与含义、两条示例**逐字对得上**，连示例参数 `--scope this-board --as-of 2026-07-20T12:00:00Z --json` 都一模一样；help 措辞更精确。
- `jc add`：七条 flag 描述**与 help 字节相同**；且母本表**遗漏** `--set` / `--set-json`——**有损副本**，照它写命令的 agent 会以为不支持通用 setter。

---

## 2. B 族 · board 模型（17 条 · 约 71KB）

**整体判定：以留为主。** 这一族讲的是 board 这个**数据模型**，不是某条命令；多数横跨多个 verb。

| 点 | 判定 | 理由 |
|---|---|---|
| `ccm.board.validation-rules` | **留（主体）** | 全量 FMT/GRAPH/BIZ 规则是**模型级**约束，不属任何单条命令。**但实测发现 lint 消息本身已含规则 + 为什么 + 怎么修**（`BIZ-AWAITING` 那条比母本讲得还全）→ 逐规则核对后，**凡 lint 已说全的行可删** |
| `ccm.board.task-fields` `.status-semantics` `.artifact-verified` `.blocked-on` `.parent-owner` `.deps-linking` `.acceptance` `.deadline-ddl` | **留** | 字段语义跨多个 verb（`add`/`update`/`done`/`set-status` 都碰同一字段）。help 只能在各自 OPTIONS 里说一行，说不了字段本身的语义 |
| `ccm.board.antipatterns` | **留** | 反模式是归纳，Unix help 不承载 |
| `ccm.board.planning-routing` `.agents-registry` | **留（主体）** | 概念模型跨 verb；其中纯 flag 说明迁 help |
| `ccm.board.watchdog` `.cadence` `.jc-judgment` `.estimate-judgment` | **留** | 「什么时候该用」是判断，不是 reference |
| `ccm.board.executor-choice` | **留** | 无命令痕迹，纯判断 |

---

## 3. C 族 · ccm 其它（12 条）与 D 族（62 条）

| 点 | 判定 | 理由 |
|---|---|---|
| `ccm.hotpath-flows` | **留** | **带意图注释的动作序列**（建板 → 转写 Goal Contract → 确认 DDL → 完整性检查）。任何单条 `--help` 都不含流程 |
| `ccm.status-state-machine` | **留** | 状态机全景跨全部 task verb |
| `ccm.field-tiers` | **留** | 🔒/👁/✎ 三档是模型概念 |
| `ccm.footgun-table` | **逐行判** | 已实测 5 行得 3 种结论，见 §5 |
| `ccm.exit-codes`（41 字符） | **迁** | 正是 Unix `EXIT STATUS` 段 |
| `ccm.account-*`（4 条） | **留（主体）** | 号池概念叙事；其中 verb 清单迁 help |
| `ccm.when-to-open` `.planning-opt-in` `.pointers-routing` | **留** | 「什么时候用」是判断 |
| **D 族 `workflow.*`（约 25 条）** | **全留** | ⚠ **它们的 oracle 根本不是 ccm**——讲的是 harness 的 Workflow API。agent 不能对一个 harness 内建工具跑 `--help`，**不存在可代劳的接口** |
| **D 族 `pacing.*` / `goal.*` / `board.*` 等**（约 37 条） | **留（主体）** | 多为跨命令判断；少数纯 flag 引用随 A 族一起迁 |

> **D 族这条要单独强调**：`workflow.*` 这 25 条被标成 `environment_fact` 是对的（它们是关于外部世界的事实），但**「环境事实 → 该退给接口」这条推论对它们不成立**——没有那个接口。判据要写成「**存在一个 agent 能自助查询的接口**」，而不是「是环境事实」。

---

## 4. 未决项（需单独决策，不在本台账内定）

**① `ccm.cmd.json-shape`（27.5KB，最大一条）** —— 通用信封 `{ok,data}` 是跨命令契约（留 skill），但主体是**每条命令的 `data` 形状**。Unix help 传统上不承载输出 schema。三条路：写进各命令 `EXAMPLES` 的样例 JSON / 新增 `ccm <cmd> --schema` 能力 / 留 skill。**这是能力设计问题，不是文档归属问题。**

**② 静默行为无处安放** —— `task show <不存在 id>` 返回 `rc=0` + `{"ok":true,"data":null}`，不报错不提示。**接口无法陈述自己的沉默。** 要么改行为（非 `--json` 时打一行提示），要么这条永久留 skill。**改行为超出 help 范畴。**

**③ help 自身的预算** —— 迁入后 `--help` 会变长，而 agent 每次调用吃全文。Unix 的答案是 `--help` 保持简短、`man` 承载完整——但 ccm 目前没有 man。**需先定：ccm 要不要分 `--help`（简）与 `ccm help <cmd>`（详）两层。**

---

## 5. 逐行判定示例（`ccm.footgun-table`，已实测）

| 行 | 实测 | 判定 |
|---|---|---|
| `--set status=done` 被拒 | `rc=3` · 报错含「🔒 字段 + 该用哪个 verb」 | **删**（错误消息已代劳） |
| `board update --goal` 被拒 | `rc=3` · 报错含 `use \`ccm goal amend\`` | **删** |
| `block --on user` 缺包 | `rc=3` · lint 含规则 + 为什么 + 怎么修 | **删**（比母本更全） |
| `ready` 直接 `done` | `rc=3` · 给合法后继状态，未给 verb 名 | **留**（补一句「`in_flight` 由 `task start` 产生」即可，或改错误消息后删） |
| `task show <不存在>` | `rc=0` · 静默 null | **留**（见 §4②） |

---

## 6. 迁移的真收益（复核过，不是省 token）

**锁步从人工约束变成结构性保证。** 现纪律要求「改命令面 → 同 PR 改 `using-ccm` 两份 reference」，靠人自觉——**本轮已抓到它漏了**（`jc add` 缺两 flag）。迁入后 flag 与其说明在同一份 TS 源码里，改一个顺手改另一个，**不存在第二真相源**。

**成本从常驻变按需。** skill 正文每次会话占 context；`--help` 只在真要用时花一次。

**正确性上升。** `--help` 不会过期，副本会。

---

## 7. 下一步（各自独立，不混做）

1. **ccm 侧**：定 help 段落规约（Unix 段 + 是否分两层）→ 按 A 族清单逐命令补 `DESCRIPTION`/`FILES`/`EXIT STATUS`/`SEE ALSO` → 走 ccm 版本线。
2. **skill 侧**：待 ccm 侧落地后再删 —— **顺序不能反**。先删 skill 再补 help，中间那段时间知识两头皆无。
3. **锁步纪律条文**：ccm 侧落地后同步改 `AGENTS.md` §6 的锁步条款（对象从「两份 reference 逐条对齐」收窄为「跨命令语义变化时同步」）。
4. **B/C/D 族**：本台账已判为「以留为主」，不进迁移批；其中 `validation-rules` 需逐规则核对 lint 消息覆盖度（下一轮）。
