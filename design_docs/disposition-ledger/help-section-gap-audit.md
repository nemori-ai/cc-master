# A 族迁移的机械前提：`--help` 的 Unix 段缺口盘点

> 状态：**实测完成**（2026-08-06 · 本机 `ccm 0.22.1` · 140 个子命令全量）。
> 本文**只盘缺口，不改 ccm、不删 skill**。它是 [`env-fact-migration-ledger.md`](env-fact-migration-ledger.md) §7 第 1 步（「定 help 段落规约 → 逐命令补段」）的输入。

---

## 0. 一句话结论

**四个要接收迁移内容的 Unix 段，当前一个都不存在——140 个子命令，覆盖率 0%。**

| Unix 段 | 覆盖 | 迁移里的角色 |
|---|---:|---|
| `EXAMPLES` | **140 / 140（100%）** | 母本**已逐字重复**——迁移要删的就是它 |
| `FLAGS`（= `OPTIONS`） | 135 / 140（96%） | 同上，已重复 |
| `DESCRIPTION` | **0 / 140** | 副作用声明（「只读 board」这类）**无处可去** |
| `FILES` | **0 / 140** | 读写路径（`<home>/calibration/…`）**无处可去** |
| `EXIT STATUS` | **0 / 140** | `exit 2/3/4` 语义**无处可去** |
| `SEE ALSO` | **0 / 140** | 「label 回填不在此命令内，见 X」**无处可去** |

> 这解释了一件此前看着奇怪的事：**盘点反复得出「母本与 help 逐字重复」，却又判定「主体可迁」。** 两句话都对——重复的恰好是 help **已有**的三段，而母本真正独有的内容对应的四段 help **根本没有**。
>
> **迁移不是「把内容搬过去」，是「先建四个段，再搬」。** 顺序反了就是把知识删进真空。

现在的 help 骨架只有：标题行 → `USAGE` → `FLAGS` → `EXAMPLES` → `GLOBAL FLAGS 见 ccm --help`。

## 1. 规模

| | |
|---|---:|
| namespace | 39 |
| 子命令 | **140** |
| 当前 help 合计 | **约 28k tok** |
| 中位 | 175 tok |
| 最大（`goal deadline`） | 643 tok |

## 2. 预算闸会不会打架——**基本不会，只卡 4 条**

[`output-contract-and-help-budget.md`](output-contract-and-help-budget.md) 裁决的预算闸是**每 verb ≤ 700 tok**，当初定 700 的理由写的是「最坏命令迁完约 690，恰好容下，不多留」。拿实测对一遍：

| 命令 | 当前 | 余额 |
|---|---:|---:|
| `goal deadline` | 643 | **57** |
| `task add` | 610 | **90** |
| `task update` | 593 | **107** |
| `worker dispatch` | 503 | **197** |
| `task attest-delivery` | 433 | 267 |
| `worker run` | 385 | 315 |
| `board update` | 383 | 317 |
| `account switch` | 358 | 342 |

- 余额 **< 200 tok** 的：**4 条**
- 余额 **< 350 tok** 的：**9 条**
- 其余 **131 条**余额均 > 350，中位余额 **525**

**结论：闸与迁移不是系统性冲突，是 4 条个案。** 那 4 条要么补段时精简既有 `FLAGS` 描述，要么单独议是否提额——**不要因为 4 条个案去动全局阈值**，那会把闸的意义抹掉。

## 3. 顺带查出的两处现成缺陷（与迁移无关，但同一趟改最省）

**① 18 个 namespace 在 `ccm --help` 根输出里没有一句描述。** 空白项：`capability` `worker` `quota` `provider` `model-policy` `orchestrator` `route` `attempt` `goal` `target` `delivery` `dependency` `agent` `coordination` `web-viewer` `monitor` `services` `runtime`。

这一条值得单独说：**根输出正是「顶层 namespace 清单」这个知识点判定「已重复、可迁」的依据**，而实际上它对将近一半的 namespace **什么也没说**。所以那条判定当时是**对着一份残缺的 help 做的**——不是判错了方向（清单确实该由 help 承载），是**接收方还没准备好**。

**② `status-report` 的根描述排版溢出**：输出为 `status-report生成式 board 状态报告 artifact（只读 board·ADR-030）`，namespace 名与描述之间没有空格。列宽按最长 namespace 名算，`status-report`（13 字符）恰好把填充吃光。

## 4. 这份盘点授权什么、不授权什么

**授权**：把 [`env-fact-migration-ledger.md`](env-fact-migration-ledger.md) §7 第 1 步从「待定规约」推进到「有清单可执行」——140 个子命令 × 4 个段是确定的工作面。

**不授权**：任何 skill 侧的删除。台账 §7 第 2 步写死了顺序——**先补 help，再删 skill**，中间那段时间知识两头皆无。本盘点恰好量化了这个风险有多大：现在删，四段内容落地为零。

**没查的**：本文只查段是否**存在**，没查已有段的**内容质量**（`FLAGS` 描述是否准确、`EXAMPLES` 是否还跑得通）。那是另一件事。
