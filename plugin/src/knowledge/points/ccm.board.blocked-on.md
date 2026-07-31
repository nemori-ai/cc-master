---
point: ccm.board.blocked-on
---

## 权威陈述

<!-- ccm:k:start point:ccm.board.blocked-on -->
## G. blocked_on 怎么选

`blocked_on` 由 `task block --on <target>` 命令设，只有两种合法值：

```
blocked_on = "user"     # 阻塞在用户决策 / 操作
blocked_on = "<taskid>" # 阻塞在另一个 task（非 deps 关系的动态阻塞）
```

**`blocked_on` 是「语义阻塞」判别器：** 有 `blocked_on` 的 blocked 节点是在等**人 / 另一件事**（语义阻塞），与「deps 拓扑就绪」正交——它**豁免** deps 驱动的自动门控（`reconcileGating`），即便 deps 全满足也不会被自动翻成 ready。无 `blocked_on` 的 blocked 节点则是纯 **deps 门控**（系统据 deps 满足度自动定 ready/blocked，见 [B 节](#ready--blocked-由系统按-deps-自动门控)）。**解除语义阻塞用 `task unblock <id>`**（清 `blocked_on`，交回 deps 门控），别手 `set-status`。

**选择表：**

| 情况 | 选 blocked_on | 备注 |
|---|---|---|
| 需要用户拍板 / 提供输入 / 审批 | `"user"` | 必须带 `decision_package`（否则 BIZ-AWAITING hard error）；解除用 `task unblock` |
| 等某个先决任务，但它不是 deps 里的静态依赖 | `"<taskid>"` | 动态阻塞；taskid 必须存在（否则 FMT-BLOCKED-ON warn）；解除用 `task unblock` |
| deps 里的 task 尚未满足 | 不用 block | deps 门控本身就是阻塞——**系统自动**把它落成 `blocked`（无 `blocked_on`），deps 全满足时自动归回 `ready`，无需手动 block/set-status |

**别把 awaiting-user 决策伪装成 judgment_call。** `blocked_on:"user"` + `decision_package` 表示「用户还没拍板、agent 不能替他决定」；`judgment_call` 表示「agent 已经做过一个重要自驱判断，等用户回来知情 / 复盘 / 追认」。merge / 发布 / 不可逆 / 对外 / 授权 / 方向性决定这类 must-escalate 边界，必须走 awaiting-user 决策节点，而不是先斩后奏记成 jc。

**awaiting-user 节点的 decision_package 必须提前备好：**

`blocked_on: "user"` 的节点是给用户的「采访包」——{{USING_CCM_DECISION_PACKAGE_ENTRYPOINT}}所以 lint 对这类节点做 `BIZ-AWAITING` hard 校验：

```bash
# 正确：block 时同时带 decision_package
ccm task block T9 --on user --decision @/abs/path/decision.json
```

`decision.json` 的 canonical 字段：`prepared_at` / `inputs_hash` / `freshness` / `ask_type` / `context_md` / `question` / `what_i_need` / `why_it_matters` / `options[]` / `enter_cmd`。`ask_type` ∈ `{decision, advice, solution}`——明确告诉用户要「决策、建议还是方案」：

| ask_type | 什么时候用 |
|---|---|
| `decision` | 有几个方案，要用户选其一（`options[]` 必填非空） |
| `advice` | 需要用户提供建议或判断，没有预设选项 |
| `solution` | 需要用户提供一个解法（你不知道方案是什么） |

---

<!-- ccm:k:end point:ccm.board.blocked-on -->

## 失效类型

`environment_fact`（双重性质·方法部分补不回来，它才是承重结构） —— 删掉后 agent 仍然知道字段语法，但会在推进压力下把本该停下等用户拍板的 must-escalate 决定，包装成一条 judgment_call 径直做掉——没有任何 lint 能拦住这种语义层面的伪装。

主体是 ccm 的 blocked_on 合法取值、unblock verb 与 decision_package 字段清单，缺了会写错本工具的具体字段而非缺方法。

## 边界

本点只管『要不要设 blocked_on、设成什么值』这一步的取舍规则与字段语法，不管 decision_package 里 context_md / question 写得够不够扎实、不管怎么和用户把决策谈透，也不管 ready/blocked 由 deps 自动门控的机制本身。

## 失败形态

最隐蔽的违反是『看起来很负责』：agent 没有报错也没有卡住，反而留下一条写得工整、理由充分的 judgment_call 记录，把一个理应交给用户拍板的决定悄悄执行了——board 状态和 log 都『合规』存在，唯独用户从未被真正问过。
