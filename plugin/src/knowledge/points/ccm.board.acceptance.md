---
point: ccm.board.acceptance
---

## 权威陈述

<!-- ccm:k:start point:ccm.board.acceptance -->
## D. acceptance 怎么写好

`acceptance` 是这个 task 的「目标函数」——什么情况算完成。acceptance 哲学（验收 = ML 优化目标函数的设计）属于 `dev-as-ml-loop` skill；这里只给**操作侧：怎么填好这个字段**。

**两种形式：**

**1. 一句话 DoD（轻量，推荐优先用）**

```bash
ccm task add T3 --type development --accept "用户能在 3 秒内完成注册流程，端到端测试全绿"
```

或用文件：

```bash
ccm task add T3 --accept @/abs/path/to/acceptance.md
```

**2. 结构化 criteria 对象（需机器可判断多条件时）**

```bash
ccm task update T3 --set-json 'acceptance={"criteria":[
  {"desc":"E2E 测试全绿","kind":"test","check":"npm run test:e2e","status":"pending"},
  {"desc":"P95 响应 <500ms","kind":"metric","target":"<500ms","status":"pending"}
]}'
```

**写好 acceptance 的三条操作原则：**

| 原则 | 好的写法 | 坏的写法（反模式） |
|---|---|---|
| **可验收** | "单元测试全绿 + PR merged" | "代码质量好"（无法机器或人工判定） |
| **粒度合适** | 一句话覆盖完成条件 | 把实现步骤写进 acceptance（那是 description / plan 的事） |
| **不过细** | "lint 无 error" | "第 47 行变量名改成 camelCase"（implementation detail） |

**特定 type 的 acceptance 要求：**

- `development` / `development-demo` / `acceptance` / `e2e-integration`：**必须**有 `acceptance`，否则 lint 报 `BIZ-ACCEPTANCE-REQUIRED` warn。
- 其余 type：推荐写，不强制。

**acceptance object 里的 `criteria[].status`：** 每条 criterion 有自己的 `status`（`pending / met / failed`）。`acceptanceConverged`（ccm 内部谓词）= criteria 全 `met` 且非空，才算目标函数收敛。你在验收时逐条把 `status` 更新到 `met` / `failed`（`task update --set-json`），视图里的 acceptance 灯就会随之更新。

---

<!-- ccm:k:end point:ccm.board.acceptance -->
