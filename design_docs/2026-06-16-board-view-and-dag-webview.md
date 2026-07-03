# board-view + DAG webview 设计 spec —— 让编排进度「看得见」

状态：已 brainstorm + 用户在设计闸 approve（2026-06-16）+ 已实现（分支 `feat/board-view-and-dag-webview`）。本文是该 feature 的**设计闸留痕**（design-gate 记录，对齐本仓 `requirement-elicitation` 范式：动手前/动手围着要有一份设计记录）。

源起：cc-master 把一个目标拆成任务 DAG、跨 compaction 存活在一块 board JSON 里推进；但**编排进度对人是不可视的**——用户只能靠 `/cc-master:status` 读一段散文式状态汇报，没有「一眼看清整张依赖图、谁在飞、临界路径在哪、卡在哪个用户闸」的 glanceable 视图。用户要的是**把 orchestration 进度可视化**，并明确分两层都要。

参照系：Claude Code 自带的 `/workflow` 进度大纲——分层、活的、glanceable。A1 在精神上对标它（文本侧），A2 把它升格成真正的图（DAG 侧）。

---

## 一、两层方案（A1 / A2，双双 approve）

用户在设计闸把范围定为**两层都做**——一轻一重，互补而非二选一：

### A1 —— 轻量 board view（升级 `/cc-master:status` 的输出）

**纯 prose 升级，零新增基建。** 把 `status` 命令体从「一段简洁散文汇报」改写成一份**可一眼扫完、按状态分组**的 board 视图：一行 header（goal 截断 · `done/total` 进度 · `git.branch` · 一条 pacing 备注）、按状态分组的任务区（Blocked-on-user 置顶醒目 → In flight → Blocked-on-task → Ready → Done → 需注意），再接原有的只读健康检查。空组直接略过。落点：`commands/status.md`（diff：`+16 -6`）。

A1 不碰任何 hook、不起任何 server、不引任何依赖——它只是把同一份 board 数据**更可扫地讲出来**，且仍严格只读（命令体末尾重申「不要修改 board」）。命令体末尾新增一行指针，把想看图的用户引向 A2 的 `/cc-master:view`。

### A2 —— 可视化 DAG webview（新 `/cc-master:view` 命令 + 本地 server）

一个**本地 webview**，用 xyflow（`@xyflow/react`）把 board 的任务 DAG 渲成节点 + 边的图。三件实物：

- `commands/view.md` —— 新命令，认准 active board → 以**后台 shell**（`run_in_background`）启动 server → 抓 server 打到 stdout 的 `127.0.0.1:<port>` URL 交给用户在浏览器打开。
- `skills/master-orchestrator-guide/scripts/view-server.js` —— 一个**零依赖**的 node stdlib http server（`http`/`fs`/`path`，无 npm install），serve 静态 `view.html` + 一个**活轮询**的 `/board.json` + 本地 vendored 资产。
- `skills/master-orchestrator-guide/scripts/view.html` —— 单文件浏览器端：xyflow + dagre 布局 + 自定义节点 + 每 2s 轮询 + 客户端算临界路径。
- `skills/master-orchestrator-guide/scripts/vendor/` —— 本地 vendored 的第三方 JS/CSS（见 §三 vendor 清单）。

---

## 二、设计闸拍板的 4 个关键决策（用户做的）

### 决策 1 —— 范围 = A1 **且** A2

不是二选一。轻量文本视图（A1）服务「我此刻在 CLI 里就想扫一眼」，可视化图（A2）服务「我想看清整张依赖图与临界路径」。两者面向不同时机、互补，故都做。

### 决策 2 —— xyflow 依赖**本地 vendored**，**不**运行时走 CDN

viewer 必须**完全离线 / air-gapped 可用**。理由直指红线 5（ship-anywhere）：**一个运行时的 CDN 依赖本身就是一个 ship-anywhere 依赖**——它会在 air-gapped / Bedrock-隔离 的网络上断掉，而那正是红线 5 要守的那一类场景。所以 react / react-dom / `@xyflow/react` / dagre / xyflow 的 CSS 全部 vendored 进插件，server 只 serve 本地 `./vendor/`、运行时**零联网**（`view-server.js` 头注释与 `view.html` 注释都显式钉死「ZERO external URLs」「ZERO network access」）。

**接受的代价**（用户知情拍板）：① 插件里多约 **448KB** 的 vendored 第三方 JS/CSS（见 §三）；② 一桩 **upgrade-时刷新** 的杂活（xyflow/react 升版时要手动重新 vendor）。用户判定「离线可用」远比这点体积/杂活重要。

### 决策 3 —— live 更新 = 客户端**每 2s 轮询** `/board.json`

在 SSE / `fs.watch`+websocket 等方案中选了**最朴素的轮询**。理由：board 很小（一次读整文件几乎无成本）、新鲜度需求只是「人扫一眼」级别（2s 足够）、且轮询**天然免疫**跨平台的 `fs.watch` 怪癖与 board 原子写（torn-write）race——server 每次请求重读 board，读/parse 失败就回 404 让客户端下一拍重试（不崩、不缓存脏数据），客户端某一拍失败就跳过、保留上一帧好渲染。简单、鲁棒、够用，不过度工程。

### 决策 4 —— 临界路径**客户端算**，board **不被改动**

临界路径（最长依赖链）在浏览器端纯函数算出（`computeCriticalPath`：按节点数算最长链，带 cycle guard），**绝不写回 board**。这把红线 2（board narrow-waist）守得干净：viewer 是**严格只读**的——它不往 board 里塞 `critical_path` / `float` 之类派生字段，board 的 waist 一字未动。派生计算住在 viewer 侧，board 仍是 agent 独占的单一真相源。

---

## 三、架构

### server —— `view-server.js`（零依赖 node stdlib）

- 红线 1（ADR-006）：只用 node stdlib（`http`/`fs`/`path`），无 jq/python/tsx、无 npm 依赖。**注意它不是 hook**（见 §四）——它是带外运行时脚本，node 在此天然合法。
- 入口靠 `CC_MASTER_BOARD` 环境变量拿到 board 的**绝对路径**（缺则报错退出）；serve 的文件一律相对 `__dirname` 解析、**绝不相对 cwd**（launcher 可能从任意目录起）。
- `listen(0, '127.0.0.1')`：**只绑 127.0.0.1**（无外部暴露）、端口由 OS 分配（避免撞端口）。启动后往 stdout 打**恰好一行** `cc-master board view: http://127.0.0.1:<port>` 供 launcher 抓取。
- 路由（仅 GET，只读 viewer；非 GET 回 405）：
  - `GET /` → `view.html`。
  - `GET /board.json` → **每次请求重读** board 文件、先 `JSON.parse` 校验（torn-write 则回 404 让客户端重试）、`Cache-Control: no-store`。
  - `GET /vendor/*` → serve 本地 vendored 资产，带**路径穿越防护**（resolved 必须留在 `VENDOR_DIR` 内）。

### html —— `view.html`（单文件浏览器端）

- 用 ESM **import-map** 把每个 specifier 映到本地 `/vendor/` 文件；react 映到**单一** `react.mjs`，让 react / react-dom / `@xyflow/react` 共享**同一个 react 实例**（两份 copy 会让 hooks 崩）。无 esm.sh / CDN。
- 渲染栈：`@xyflow/react`（`ReactFlow` + `Background`/`Controls`/`MiniMap`/`Handle`）+ **dagre** 自动布局（xyflow 无内建布局，`rankdir: 'TB'` 竖排）+ 自定义 `CcNode`。
- 节点：每个任务一个节点，按 status 上色（9 个 enum 各一色），临界路径节点描橙边、`blocked_on:"user"` 节点描红虚线边凸显「⛔ awaiting user」。header 给 goal / `done/total` / `git.branch` / awaiting-user 计数 pill；左下角图例列 status 配色 + 计数。

### data-mapping —— board → nodes / edges

读 `board.tasks[]`：

- **node** ← 每个 `task`：`{ id, data: { id, title, status, crit, userGate } }`，`userGate = (status==='blocked' && blocked_on==='user')`。
- **edge** ← 每个 `task.deps[d]`（`d` 是上游 id）：边 `d -> task.id`；两端都在临界路径上的边 `animated` + 橙色加粗。
- **只读 narrow-waist 字段**：仅消费 `tasks[{id,status,deps}]` + `title`/`blocked_on`/`goal`/`git.branch`——全是 board 已有字段，viewer 一个都不写回。

### live-poll + 防闪烁

客户端每 2s `fetch('/board.json')`。用一个**结构签名**（`structSig`：节点/边集合的排序串）判 DAG 拓扑是否变了：

- 拓扑变了 → 整图重 layout（dagre 重排 + 一次 `fitView`）。
- 拓扑没变、只 status/label 变 → **就地 diff 更新**节点 data、保留既有坐标 → **无闪烁、无跳动**。

### launch UX —— `/cc-master:view`

命令体引导 agent：① 认准 active board（与 `status` 同款消歧逻辑——单块直接用、多块按 goal 匹配、歧义则问用户、零 active 则提示先起 orchestration）；② 以**后台 shell**（`run_in_background`，跨回合活着）跑 `CC_MASTER_BOARD=<abs> node "${CLAUDE_PLUGIN_ROOT}/.../view-server.js"`；③ 抓那行 URL 交给用户；④ 说明「每 2s 自动刷新、只读、杀后台 shell 即停（或随 session 退出）」。

### shipping placement —— 落在 `${CLAUDE_PLUGIN_ROOT}` 下

server / html / vendor 全部住 `skills/master-orchestrator-guide/scripts/`（**运行时**带外脚本归约定的随 skill 分发目录），命令体用 `${CLAUDE_PLUGIN_ROOT}/skills/master-orchestrator-guide/scripts/view-server.js` **绝对引用**——裸相对路径会相对用户 cwd 解析、装到用户机器后找不到脚本（Finding #38/#39 self-containment）。

#### vendor 清单（本地 vendored，约 448KB）

| 文件 | 体积 | 作用 |
|---|---|---|
| `xyflow.mjs` | ~182 KB | `@xyflow/react` 主体 |
| `react-dom.mjs` | ~133 KB | react-dom |
| `dagre.mjs` | ~85 KB | 自动布局（xyflow 无内建 layout） |
| `xyflow-style.css` | ~18 KB | xyflow 样式 |
| `react.mjs` | ~8 KB | react（单一实例源） |
| `jsx-runtime.mjs` | ~2 KB | react/jsx-runtime |
| `react-dom-client.mjs` | ~1 KB | react-dom/client |

---

## 四、红线合规分析

| 红线 | 本 feature 如何合规 |
|---|---|
| **5 ship-anywhere** | 决策 2 的全部理由所在：依赖**本地 vendored**、运行时**零联网**、server 只绑 `127.0.0.1` 只 serve 本地 `./vendor/`——air-gapped / Bedrock-隔离 网络下完全可用。一个运行时 CDN 依赖**正是**红线 5 要排除的那类东西，故被有意拒绝。 |
| **2 board narrow-waist** | viewer **严格只读**：临界路径客户端算（决策 4），board 的 waist 一字未动、零派生字段写回。server 的 `/board.json` 只读不写、`view.md`/`view-server.js`/`view.html` 都显式重申「绝不写 board」。 |
| **hooks 不涉及** | 本 feature **完全不碰 hook**——没新增、没修改任何 `hooks/scripts/`。server 是**带外运行时脚本**，不在任何 hook 路径上，故也不触及武装闸（红线 6）。 |
| **1 hooks 只用 bash+node/JS** | 形式上 N/A（没动 hook）。补充澄清：`view-server.js` 是 node，但它**不是 hook**——ADR-006 本就允许 hook 用 node/JS，而这里连 hook 都不是，node 作为带外运行时脚本天然合法。 |
| **self-contain 分发路径** | 命令体对 server 的引用一律 `${CLAUDE_PLUGIN_ROOT}/skills/master-orchestrator-guide/scripts/...` 绝对路径、落在约定的随插件分发目录；html 的 import-map 全指本地 `/vendor/`、零外链。无裸相对路径、无指向非约定目录（Finding #38/#39）。 |
| **3 两 skill 不重叠** | N/A——A2 是 command + 带外脚本，不动两个分发 skill 的 body；A1 只升级一个 command 的 prose。 |
| **4 指挥不演奏** | N/A——这是给人看的可视化工具，不改变 orchestrator 的派发/验收行为。 |

---

## 五、取舍与 deferred

- **离线代价（accept）**：插件多约 448KB vendored 第三方 JS/CSS（决策 2 已知情拍板）——换「air-gapped 完全可用」，值。
- **vendored-JS 刷新杂活（accept）**：xyflow / react 升版时要手动重新 vendor 一遍。接受为「离线可用」的固定成本；未来可写一条带外 dev 脚本半自动化（非本期）。
- **浏览器渲染（accept）**：A2 需要一个浏览器才能看图（A1 的文本视图在纯 CLI / 无 GUI 环境下仍可用，二者互补正好覆盖这个缺口）。
- **单 board / 单次启动（v1，board-switcher deferred）**：`/cc-master:view` 一次只可视化一块认准的 board；多 active board 时靠命令体消歧（匹配 goal / 问用户），但 webview 内**无 board 切换器**。一个「在 server 内列举 home 全部 active board、前端下拉切换」的版本 deferred 到将来有真实需求时再做。
- **mermaid fallback（considered & rejected）**：曾考虑用 mermaid 渲 DAG（更轻、可能不用 vendored react）。否决理由：mermaid 的交互（拖拽 / pan-zoom / minimap / 就地 diff 更新不闪烁 / 临界路径高亮 / 节点自定义上色）远不及 xyflow，而本 feature 的价值正在「活的、可交互的 glanceable 图」；mermaid 的轻量省不下质的体验。故选 xyflow + 接受 vendored 体积。
- **轮询 vs 推送（已在决策 3 定调）**：固定 2s 轮询，不上 SSE/websocket。board 一变可能最多 2s 后才反映——对「人扫一眼」级新鲜度足够，换来鲁棒性与零跨平台 watch 怪癖。
