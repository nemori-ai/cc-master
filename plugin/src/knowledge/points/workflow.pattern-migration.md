---
point: workflow.pattern-migration
---

## 权威陈述

<!-- ccm:k:start point:workflow.pattern-migration -->
## migrate / discover → transform → verify（带 worktree 隔离）

**何时：** 一场迁移触及很多 site，你得 (1) 把它们发现出来、(2) 在隔离里逐个 transform，让
并行编辑不冲突、(3) 用一道 gate 验证。这是唯一需要 `isolation: 'worktree'` 的形状——每个
site 在自己的 worktree 里 transform，并发的文件编辑绝不撞车。

**批量 transform 前先确认改动形状已定**：discover 阶段收的不该只是"改哪些 site"，还要能
答"按什么方案改"——几十个 site 同时无 spec 下场改，等于让每个并行 leaf 各自即兴决定同一类
决策。方案未定时先派一轮 scoping /
产出改动的最小 spec，再 fan out transform。

```js
const found = await agent('enumerate every migration site', { schema: SITES })
const out = await pipeline(found.sites ?? [],
  (site) => agent(`apply migration to ${site}, commit in your worktree`, { isolation: 'worktree' }),
  (prev, site) => agent(`verify the migration at ${site} (run the gate)`, { schema: VERIFY }).then((v) => ({ site, ...v })))
```

---
<!-- ccm:k:end point:workflow.pattern-migration -->

## 失效类型

`environment_fact`（双重性质·方法部分补不回来，它才是承重结构） —— 模型知道 worktree 隔离和 spec-first 的好处，但下一个上下文忘了这个模式；或压力下想跳过「先固定 spec」这一步

isolation:'worktree' 是本框架唯一支持 worktree 隔离的写法，pipeline 的 discover→transform→verify 调用形状同样是本地 API 事实。

## 边界

site 数量多（>10）或改动形状复杂时值得专项隔离；单 site 或改动简单时可直接走，过度隔离是浪费

## 失败形态

多个 site 的改动最后是不一致的（各 transform agent 在自己上下文里即兴决定改法）；或 discover 阶段没有产出可执行的 spec，导致重复需求解释
