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
决策（见 `engineering-with-craft` 的 sdd.md「动手前的硬闸」）。方案未定时先派一轮 scoping /
产出改动的最小 spec，再 fan out transform。

```js
const found = await agent('enumerate every migration site', { schema: SITES })
const out = await pipeline(found.sites ?? [],
  (site) => agent(`apply migration to ${site}, commit in your worktree`, { isolation: 'worktree' }),
  (prev, site) => agent(`verify the migration at ${site} (run the gate)`, { schema: VERIFY }).then((v) => ({ site, ...v })))
```

**由谁演示：** `assets/examples/migrate-discover-transform-verify.js`（唯一用
`isolation: 'worktree'` 的 bundled 资产）。

---

<!-- ccm:k:end point:workflow.pattern-migration -->
