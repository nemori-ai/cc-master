---
point: goal.trace-and-delta
---

## 权威陈述

<!-- ccm:k:start point:goal.trace-and-delta -->
每次 dispatch、接纳 fill-work、扩大 review、增加 task 或准备完成前，跑 **Goal Trace Test**：

1. 这项工作直接兑现当前 revision 的哪一条 goal / acceptance / constraint？
2. 它将产生什么可验收证据？
3. 若删掉它，当前 acceptance 是否仍能全部满足？若“是”，它通常不应进入当前 DAG。

“有用”不等于“相关”。技术上漂亮、顺手清理、未来可能需要，都不是 scope 证据。无法追溯就先分类，绝不先做后解释。

## 新发现：Goal Delta Classifier

新信息只准进入四类之一：

| 分类 | 判据 | 动作 |
|---|---|---|
| `in-scope` | 只是当前语义的实现细化，不改变 outcome / acceptance / non-goals / authority | 用 `ccm log add "<fact>" --board <board> --kind finding --detail "<evidence>"` 记录新事实；必要时更新 task 的执行细节，revision 不变，不借机改写 Goal Contract 或成功状态 |
| `amendment` | 改变 outcome、scope、acceptance、关键约束或权限边界 | 先说明影响与需要的授权，再 `ccm goal amend`；revision +1 后重切受影响 DAG |
| `follow-up` | 有价值但当前 acceptance 不需要 | 独立 backlog / issue / 新 board，不混入本 DAG |
| `unrelated` | 与当前目标无可验证关系 | 停止，不制造 busywork |

显式修改目标：

```bash
ccm goal amend --board <board> --summary "<new normalized goal>" \
  --reason "<why semantics changed>" --assurance asserted \
  [--brief-file /absolute/path/to/new-goal-brief.md]
ccm goal check --board <board> --json
```

不得用 `ccm board update --goal` 绕过 revision。amend 后旧 task 不能自动继承正当性：逐个重跑 Trace Test，保留、改写、移出或取消，并让新的 revision 进入 completion fingerprint。

<!-- ccm:k:end point:goal.trace-and-delta -->

## 失效类型

`capability_gap`（主体：事实方法） —— 完全清楚该先做 Goal Trace Test、无法追溯就先分类，但看到一件顺手又明显有价值的事时会想「这么明显有用，先做完再解释也一样」，是主动绕开分类流程而非不懂流程。

主体是 Goal Trace Test 三问与 Delta Classifier 四分类判据，是判断新信息该往哪去的方法框架。

## 失败形态

新加的任务确实写了一句话过 Goal Trace Test 第一问，理由是为当前 acceptance 打基础——但拆开看这个因果链是勉强搭上的、任务本身价值独立于当前目标；表面走完了三问流程，实质是先决定要做、再倒着找一条能通过测试的理由。
