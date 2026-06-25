# using-ccm — 设计宪法（DESIGN.md）

> 本仓 DESIGN.md 统一 6 段（`curating-skill-portfolios` 约定）。任何对 SKILL.md 的实质改动先在此更新。

## 1. One-liner

`ccm` CLI 的操作手册：让 orchestrator/agent **既然要动 board，就用 ccm 把 board 读写动得对**——命令面 + board 状态机心智 + 写入关卡纪律。

## 2. Craft 自分类

**Craft B/C 混合**（cognitive-override 强、process-control 中）。主体是心智模型（board 是状态机不是 JSON 字典 / ccm 是写关卡），配一条 baseline-RED 撑腰的硬纪律（status 走生命周期 verb），全量命令面下沉 reference（Craft A）。

- **诊断证据**：pressure baseline 2（status via field-set）捕到 **RED**——受试 agent 默认"status 不过是个字段，赋值就行"，第一反应 `task set --status` / `task update --status`，连试 3 个死路才走通 start→done。这条逐字合理化进 SKILL.md 心智锚 2 的 Rationalization Table。
- baseline 1（Write vs ccm）跑出 **GREEN**——"用 ccm 别直接 Write board" 默认就对（受试主动选 ccm、理由充分），故只作**轻量 reference 陈述**（心智锚 1），**不配重型 Rationalization Table**——诚实不为对仗硬造纪律（skillsmith 铁律：无 RED 不写重型纪律 prose）。

## 3. Value triad（三视角价值）

### 3.1 Plugin 视角 —— 对 cc-master 这个产品 / portfolio 而言

补上 ADR-013/014 解耦后留下的缺口：机制层（hooks / skill 脚本经进程边界 shell 调 ccm）已就位，但**指导 agent 怎么用 ccm 写 board** 此前无 prose（审计实证：全仓 prose 0 处教 ccm 写操作，board.md 还在教 `Write` 整个文件）。本 skill 是这道缺口的正解——第 4 个分发 skill，**board 操作的机制层手册**，与 A（编排决策）/ B（workflow 写法）/ C（号池机制）正交，不重叠（红线 3）。

### 3.2 Agent 视角 —— 对调用这个 skill 的 AI 而言

给 agent 一把全新自研 CLI 的命令面（`ccm` 不在训练数据里——**A.1 强增量**）+ 纠正一个实证的默认错误心智（把 status 当可赋值字段、不懂状态机、踩 `--set` footgun——**B 强覆写**）。A strong + B strong = 双价值。

### 3.3 Human 视角 —— 对最终落地的用户 / 维护者而言

board 写操作经写关卡校验，少一整类静默损坏（绕锁 / 跳校验 / derived 字段失真 / 伪造审计轨迹）；首跑可用性更顺（`init` 自建 home 等 QA 修复）。

## 4. 责任边界

### 4.1 IN scope

- 怎么用 ccm 对 board 做读 / 写：建板、增删改任务、状态转移（start/done/block/set-status）、阻塞等用户、查 ready 集 / DAG / 临界路径、记 jc / log、开收 cadence iteration、arm watchdog。
- board 操作的**状态机心智**、**三档字段操作规则**、footgun、exit code 语义、`--json` 输出形状。
- `ccm` 缺席时的**降级路径**（Write + 手动 lint）。

### 4.2 OUT of scope（明确移交给谁）

| 不归本 skill | 归谁 |
|---|---|
| 该编排什么 / 怎么拆 DAG / 何时阻塞等用户 / 何时换号（**决策**） | `orchestrating-to-completion`（A） |
| board 协议 SSOT（schema / status enum / 三档字段 rationale） | A 的 board 协议 reference |
| workflow 脚本怎么写（脚本 DSL，非 ccm CLI） | `authoring-workflows`（B） |
| 号池怎么管 / 选号切号 / vault token 安全 | `account-management`（C） |
| board 引擎的不变式 / 状态机机器 SSOT（代码） | `@ccm/engine`（board-model keystone） |

### 4.3 Boundary heuristic（一句话判定法）

"**该不该**让 ccm 做这事" → A；"既然要做，**ccm 命令怎么敲**" → 本 skill。

## 5. 触发与反例

### 5.1 Recognition cues（应当被触发的信号）

敲 `ccm task/board/jc/cadence/log/watchdog` 命令；"怎么把任务标 done / 加依赖 / 查临界路径 / 阻塞等用户"；任何 board 写操作；ccm 报 `exit 3` / `illegal transition` / 🔒 字段被拒。

### 5.2 Counter-examples（明确不该被触发的反例）

"该不该并行拆这几个任务"（A 的调度决策）；"workflow 里 pipeline 还是 parallel"（B）；"哪个号额度够、怎么切"（C）；通用 bash 并行 / git / 其它 CLI / 拿 jq 改任意 JSON（与 ccm board 无关）。

### 5.3 Pre-flight gate（硬门，任一不满足就 STOP）

- 改纪律段（心智锚 2 的 status 硬规则）前，先跑 pressure baseline（skillsmith 铁律：无 RED 不写纪律 prose）。
- `description` 改动前后各跑一遍 Track A trigger eval 比 accuracy。
- 新增命令面 / footgun：先判它是 reference（靠使用验证、不跑 baseline）还是判断型纪律（跑 baseline）。

## 6. 演化锚

- **ccm 命令面变了**（加 namespace / 命令 / flag、reserved 落地 account/estimate/usage）→ 更新 `references/command-catalog.md` + 相关 footgun 速查。
- **状态机转移表 / 三档字段 / lint 规则在 `@ccm/engine` 改了** → 同步心智锚 2/3 的**操作视图**（SSOT 在 engine 代码 + A 的 board 协议 reference，本 skill 只跟操作视图、不复述协议）。
- **新 footgun 在 dogfood 现形** → footgun 速查加行；若是判断型（agent 会合理化掉）先补 baseline 再写。
