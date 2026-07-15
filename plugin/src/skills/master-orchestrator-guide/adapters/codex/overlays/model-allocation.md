## Codex 分档

先运行 `ccm provider facts codex --json`，只让 `freshness:"fresh"` 且 `catalog_eligible_for_admission_check:true` 的候选进入下一道检查。静态 snapshot 的 `eligible_for_automatic_selection` 应保持 `false`；只有当前账号 entitlement 与 exact-model admission 另有证据后，orchestrator 才能组合这些事实做分配。按 facts 返回的 tier 与相对成本做映射，不在 skill 中维护 model ID 清单：

| 任务 | 配额充足：效果优先 | 配额紧张：性价比优先 |
|---|---|---|
| 读扫 / grep / 格式化 / 测试重跑 / 机械迁移 | `economy` + medium | `economy` + low/medium |
| 调研摘要 / 常规文档 / acceptance 清楚的常规实现 | `balanced` + high | `economy` + high 或 `balanced` + medium |
| 复杂多文件 / 有状态实现 / 含糊根因 | `frontier` + high/xhigh | `balanced` + high/xhigh；验收失败再升档 |
| 独立 review / 端点验收 / 架构裁决 / 不可逆决策 | `frontier` + max | `frontier` + high；最高风险仍保留 max |

`ultra` 只给能拆成独立 workstreams、且不会与外层 fan-out 重叠的复合目标；不要把它记成 leaf effort。长会话建立后固定已准入 family，省配额靠 leaf 的 tier / effort 分档。Codex 只受 7d 硬边界约束，自动换号永久禁止。
