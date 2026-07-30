---
point: ccm.board.jc-judgment
---

## 权威陈述

<!-- ccm:k:start point:ccm.board.jc-judgment -->
## H. judgment_call（jc）：何时建、severity 怎么定

**judgment_call（jc）是自驱决策记录（autonomous decision record / judgment record）**——记录 agent 在自驱模式下**已经做过**的重要判断。它的存在价值：用户回前台 / 新 session resume 后，能快速了解「这里 agent 自己判断了什么、为什么、影响多大、是否需要复盘或追认」。

它不是待办队列，也不是 awaiting-user 的替代品。拿不准时先问一句：**这件事是我能先行、但需要用户事后知情或复盘，还是只有用户能拍板？** 前者建 jc；后者建 `blocked_on:"user"` 节点并挂 `decision_package`。

**何时建 jc：**

| 场景 | 要不要建 jc |
|---|---|
| 在两个技术方案之间做了选择，影响后续路径但仍可推翻 | **建** |
| 依赖版本 / API 漂移，选择了兼容策略 | **建** |
| 发现 spec 和实现有偏差，自己判断了临时路线 | **建** |
| 为了继续推进，选择了一个可逆的默认值 / 降级策略 | **建**（通常 low/medium） |
| merge / 发布 / 对外承诺 / 授权 / 不可逆迁移 / 方向性拍板 | **不建 jc；改建 `blocked_on:"user"` + `decision_package`** |
| 执行明确的既定方案，无自由裁量 | **不建** |
| 小的实现细节（变量命名、函数拆法）无不可逆影响 | **不建**（太多 jc 会淹没重要条目） |

```bash
ccm jc add "选用 ICU MessageFormat 而非自研格式化" \
  --category architecture \
  --severity high \
  --decision "采用 ICU MF，理由：生态成熟、多语言团队熟悉" \
  --rationale "自研维护成本高、缺陷风险大" \
  --impact "i18n 格式化层完全依赖 ICU MF 生态"
```

**category 四选一：**

| category | 含义 |
|---|---|
| `architecture` | 技术架构 / 技术选型决策 |
| `drift` | 与原计划 / spec 的偏离 |
| `spec-impl-misalignment` | 发现 spec 和实现不一致、自行裁量 |
| `other` | 不属于以上三类 |

**severity 怎么定（对应回前台汇报强度）：**

| severity | 汇报口径 | 判断标准 | 示例 |
|---|---|---|---|
| `low` | FYI | 影响局部、可逆、风险小 | 选择一个默认配置 / 轻量降级 |
| `medium` | review | 影响多个模块、反转有成本 | 选用某个库替代另一个 |
| `high` | review（优先提） | 影响架构或核心路径、反转代价大 | 换接口协议、改存储方案 |
| `critical` | must-escalate 检查 | 影响系统整体、涉及安全 / 合规、或接近不可逆边界 | 若仍可推翻才记 jc；若需要用户授权，改走 `blocked_on:"user"` |

**jc 的生命周期：**

1. **`pending_review`**（建立时）：等用户审阅
2. **`upheld`**（`ccm jc resolve J1 --status upheld`）：事后看决策是对的
3. **`overturned`**（`ccm jc resolve J1 --status overturned --note "理由"`）：需要推翻、重做

{{USING_CCM_JC_HOOK_GUIDANCE}}

---

<!-- ccm:k:end point:ccm.board.jc-judgment -->
