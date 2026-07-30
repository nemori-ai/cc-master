---
point: ccm.board.deps-linking
---

## 权威陈述

<!-- ccm:k:start point:ccm.board.deps-linking -->
## F. deps 怎么连

`deps` 是 task 的「依赖边」——只有当 deps 中的 task 全部满足之后，这个 task 才进 readySet 可以派发。普通/旧 task 以 `status=done` 满足；显式 review gate 必须 `status=done` 且 verdict 为 `APPROVE`。

**操作命令：**

```bash
# 建 task 时一起加
ccm task add T5 --deps T1,T3

# 建好之后增减
ccm task update T5 --add-dep T2
ccm task update T5 --rm-dep T3
```

**review 审批依赖：执行完成与批准是两件事。** 要求某个 review 明确批准后才放行下游时，在 review task 上声明 gate：

```bash
ccm task add R1 --type review --review-gate APPROVE
ccm task add IMPLEMENT --deps R1
ccm task start R1

# 审查执行完成，但要求修改：R1=done；IMPLEMENT 仍 blocked
ccm task done R1 --artifact /abs/review.md --verified --review-verdict REQUEST-CHANGES

# 修改完成后复活并执行新一轮审查；stale→ready 自动清旧 verdict
ccm task set-status R1 stale
ccm task set-status R1 ready
ccm task start R1
ccm task done R1 --artifact /abs/review-v2.md --verified --review-verdict APPROVE
```

`review_verdict` 只属于当前 attempt。`stale|failed|escalated → ready` 是统一 retry 边界，会清除 current verdict；旧值即使进入 retry 审计也不参与门控。retry 后 `task done` 不带 verdict 时仍保持缺失，绝不会复用上轮 `APPROVE`。缺失、空、null、非法值或 `REQUEST-CHANGES` 都不会开门（非法形状还会被 lint hard gate 拒绝）。没有 `dependency_gate` 的旧板/普通 task 继续按 status-only 语义运行，不需要迁移。

**declared delivery edge 的三层真相：**

1. `candidate-complete`：上游满足 `taskTrulyDone`；它证明本 attempt 已完成并验收，不证明已到接收端。
2. `target-delivered`：当前 candidate 对冻结 target snapshot 有可重验 proof。Git 支持本地 exact containment，或
   “integration commit contained + fresh APPROVE attestation 精确绑定”的 reviewed reconciliation；非 Git 支持
   immutable artifact/ref/digest manifest containment。target ref 漂移或本地 object 缺失后旧 observation 变
   `unknown`，不是 false positive。
3. `dependency-qualified`：downstream exact edge（或 `*` fallback）的 requirement 求值得到
   `qualified|unqualified|unknown`。这是派生值，不落一个可陈旧的 bool。waiver 只会让 exact
   user-authorized、edge-scoped、未过期 requirement `qualified_by=waiver`；它始终
   `target_delivered=false`。

```bash
ccm target set main --kind git-ref --ref refs/remotes/origin/main
ccm dependency require DOWN UP --level delivered --target main
ccm task attest-delivery UP --target main --method git-commit-contained --candidate-commit <oid>
ccm dependency explain DOWN UP
```

`candidate` requirement 只需第一层；`delivered` requirement 必须第二层（或有效 waiver）。所有显式 edge
都先过 true-done + review gate。`ccm delivery audit --strict-dry-run` 只把未声明 edge 在本次读取里显示为
unknown，绝不改 persisted mode；strict-default 尚未启用。

**真实数据依赖 vs 虚假保险边：**

| | 真实数据依赖 | 虚假保险边（反模式） |
|---|---|---|
| **定义** | T5 的执行**需要** T1 的 artifact 作为输入 | T5 和 T1 没有真实数据依赖，但「感觉应该先做 T1」 |
| **影响** | 合法：T1 done 之前 T5 不进 readySet | 阻塞本可并行的工作，拉长 makespan |
| **检测** | 问：「去掉这条边、T5 能先跑吗？」是 → 虚假边 | |
| **处理** | 保留 | 删掉，用 `task update --rm-dep` |

**deps 的图约束（lint 强制）：**
- 不能有悬挂引用（`GRAPH-DANGLING`·hard error）：被 deps 引用的 id 必须存在
- 不能自环（`GRAPH-SELFLOOP`·hard error）
- 不能有有向环（`GRAPH-CYCLE`·hard error）
- 希望全图弱连通、无孤岛子图（`GRAPH-CONNECTED`·**warn 非 hard**）：连通性 = **deps 边 ∪ parent 容器边**，把二者都当无向边算，若分量数 > 1（某任务和主图没有任何依赖/归属关系、成了孤岛）发 warn，列出各分量的 task-id（主图 = 最大分量、其余 = 孤岛）。为目标聚焦希望图全通但不强求，故只 warn 不阻断；edge case：0/1 个（非 fill-work）任务或全连通不 warn。**parent 容器边计入连通**——一个 `deps:[]` 的嵌套子任务经其 owner 连进主图、不被误判孤岛。修法：给孤岛补 deps 连回主图（或挂到一个已连通的 owner 下），或确认它独立后忽略。
  - **连通性只在「非 fill-work」节点上判——`role:fill-work` 豁免**：fill-work 定义即「脱离主图的填闲并行工作」、**故意独立**，把它计入会对每个 fill-work 节点常态误报孤岛（cry-wolf）。故连通性判定时 fill-work 节点整体从节点集剔除（连同其边），纯 fill-work 的孤岛不再 warn——无需给 fill-work 硬凑 deps 连回主图。
  - **`awaiting-user` / 决策门节点**不**豁免**（用户拍板的设计原则）：一个 `blocked_on:user` 的决策门本应是**某主图工作节点的前驱 / 子 / 子图 / 节点本身**——它 gate 某段下游工作，故理应连进主图。一个无上下游的孤立决策门正是该 warn 的**真遗漏**（漏接了它 gate 的下游），照常计入 GRAPH-CONNECTED。修法不是豁免，而是把它接进主图：让它 gate 的那个下游工作节点 `deps` 含这个决策门（决策门 gate 下游），或给决策门本身合理 deps。

deps 图的排期、临界路径计算（哪条链条最长、哪个 task 先派最解锁下游）属于 `master-orchestrator-guide` skill 的调度方法论范畴；本文给的是「怎么连对」，不复述排期。

---

<!-- ccm:k:end point:ccm.board.deps-linking -->
