# examples/decision-briefing —— 采访式决策闭环的端到端 demo

证明 **decision-briefing-discuss-loop** feature 的完整闭环：
**网页中触发讨论 → 模拟讨论结束（版本化 append-only、可聊 N 次）→ 卡片上看到讨论历史 → master 取最新一份消化**。

把一个 `blocked_on:"user"` 节点从「干问题」升级成「**对着准确且仍有时效的完整依据，做一次高质量决策**」，并让决策干净回流进规划。

## 三个文件

| 文件 | 作用 |
|---|---|
| [`fixture.board.json`](fixture.board.json) | 一块合法的 `cc-master/v1` board，含一个 `status:"blocked", blocked_on:"user"` 决策节点 `D1`，挂一份完整合法的 `decision_package`（`ask_type:"decision"`、3 个 options）。能被 `view-server.js` 加载、被 `view.html` 的 `DecisionCard` 渲染成富决策卡。字段严格对齐 [`board.md` §decision_package](../../skills/orchestrating-to-completion/references/board.md) 契约。 |
| [`walkthrough.md`](walkthrough.md) | 叙事化走一遍完整闭环（webview 富卡 + 「💬 已讨论 N 次」历史区 → 复制命令 → `/cc-master:discuss D1` → freshness-check → 版本化 append-only 写 `--<STAMP>.decision.md` → master recon 取最新一份消化），每步标明预期现象 + 对应 smoke 断言。 |
| [`smoke.sh`](smoke.sh) | 可无人值守跑的冒烟证明，覆盖闭环的**可机验部分**，以 `DEMO E2E PASSED` / 非零退出收尾。 |

## 跑起来

```bash
# 1) 可机验闭环（沙箱、零联网、纯 bash+node）
bash examples/decision-briefing/smoke.sh        # → DEMO E2E PASSED

# 2) 人验：在浏览器看富决策卡（walkthrough §A）
CC_MASTER_BOARD="$(pwd)/examples/decision-briefing/fixture.board.json" \
  node skills/orchestrating-to-completion/scripts/view-server.js
```

> `examples/` 是 dev-only、不随 plugin 分发——从 repo 根跑、裸相对路径在此正确（与 `examples/sample-orchestration/` 一致）。smoke.sh 用 mktemp 沙箱 `$CC_MASTER_HOME`，**不污染真实 `.claude/cc-master/`**。

## smoke.sh 的可机验链

- **STEP 1** —— `decision_package` 逐字段契约完整 + `enter_cmd` 即复制命令（board 窄腰合法性改由带外 `ccm board lint` 校验；skill 版 `board-lint.js` 已退役）。
- **STEP 2 / 3** —— freshness-check：输入未变判 fresh（hash 一致）、上游 artifact 改变判 stale（hash 不一致）。
- **STEP 4** —— 模拟讨论结束（聊 2 次）：版本化 append-only 写**两份** `D1--<STAMP>.decision.md` sidecar（round 1/2），断言两份并存（计数 == 2、不覆盖）+ board 逐字节未变（discuss 不碰 board，单写者纪律）。
- **STEP 4b** —— webview 历史区：起真 `view-server.js`、`node` HTTP GET `/decisions.json`，断言返回 D1 的 2 条（round 顺序对、`tldr` 抽取对、`node_id` 对）——卡片「💬 已讨论 N 次」据此渲染。
- **STEP 5** —— master 消化：recon 拾取**最新**那份（round 2）→ 纯 node 解析 → 选定 option id 属于 board 节点 `decision_package.options`（证明 master 用得上）。

相关产物：[`commands/discuss.md`](../../commands/discuss.md)（discuss 命令）· [`board.md`](../../skills/orchestrating-to-completion/references/board.md)（字段契约 SSOT）· [`async-hitl.md`](../../skills/orchestrating-to-completion/references/async-hitl.md)（准备 / 消化纪律）· `view.html` 的 `DecisionCard`（富卡渲染）。
