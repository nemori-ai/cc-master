---
point: ccm.board.parent-owner
---

## 权威陈述

<!-- ccm:k:start point:ccm.board.parent-owner -->
## J. parent / owner 嵌套语义

`parent` 是容器边——让 board 承载 **depth=1 的嵌套调度图**（owner 节点 + 它的子节点）。

**核心语义：**

```
parent 边方向：子 → 父（指向容器 owner）
deps  边方向：任务 → 上游（指向 dep）
两者正交，互不影响
```

**操作示例：**

```bash
# 建 owner 容器节点（本身是顶层节点，不带 parent）
ccm task add PHASE1 --title "第一阶段：框架建设" --type planning

# 建子节点，归属 PHASE1
ccm task add T1 --parent PHASE1 --deps T0 --type development --accept "框架测试全绿"
ccm task add T2 --parent PHASE1 --deps T0 --type development --accept "配置层单测全绿"

# 查某 owner 的子节点
ccm task list --parent PHASE1
```

**depth=1 不变式（ccm 强制）：**
- owner 的子不能再有子（`GRAPH-PARENT-DEPTH`·hard error）
- parent 引用必须存在（`GRAPH-PARENT-EXISTS`·hard error）
- parent 链无环（`GRAPH-PARENT-CYCLE`·hard error）

**rollup 纪律（关键，容易踩）：**

父节点 `done` 应当满足：① 全子 done ② 父自身端点验收过（整合子产物、跑全套测试）。

lint 的 `GRAPH-ROLLUP` 规则在「done owner 有非 done 子」时发 warn（不 hard fail，容许「父整合中、子刚标完」的瞬态）。

**给 parent 节点加 deps 的反模式：**

```bash
# 反模式：给 owner 本身加真实依赖边
ccm task update PHASE1 --add-dep T5  # T5 是另一个 owner 的子

# 正确：依赖关系连在叶节点上
ccm task update T1 --add-dep T5      # T1 的产出确实依赖 T5
```

owner 容器节点的 `deps` 应该为空或只含真实的 board 级前置（整个阶段的前置条件）。把父的 deps 连到另一 owner 的子节点，语义上是「整个 PHASE1 的所有子都等那个子」，几乎总是错的——往往应该只有 PHASE1 里某个具体子 task 依赖 T5。

**`parent` vs `deps` 正交性（重要）：** 子节点可以 `parent` 指 owner-A，同时 `deps` 指 owner-B 的某个子——两条边各表各的。拓扑就绪（deps 全满足）和所属容器（parent 指向）是两件独立的事。

---

<!-- ccm:k:end point:ccm.board.parent-owner -->

## 失效类型

`environment_fact`（主体：事实方法） —— parent指向容器owner、deps指向依赖上游、depth=1由工具强制、rollup只是软warn——这些都是这套board模型特有的字段语义与工具行为,模型无法从常识猜出,用错会产生错误的依赖图或误标完成。

主体是 parent 容器边的方向、depth=1 不变式与 rollup lint 规则，属于本 board 模型的具体约束。

## 边界

parent只建模depth=1的容器关系,不支持多层嵌套(owner的子不能再有子是硬约束);需要更深层级的项目结构时,这套字段本身不覆盖,得靠项目自己的planning层来承载。

## 失败形态

把某个owner节点标成done,只因为直接子节点都done了,却从未真正跑过父节点自己的端点验收——lint只是软warn不会拦住这次误标,board快照看起来全绿,但rollup语义的第二个条件从未被满足过。
