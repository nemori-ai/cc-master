## Codex 分档

| 任务 | 配额充足：效果优先 | 配额紧张：性价比优先 |
|---|---|---|
| 读扫 / grep / 格式化 / 测试重跑 / 机械迁移 | Luna medium | Luna low/medium |
| 调研摘要 / 常规文档 / acceptance 清楚的常规实现 | Terra high | Luna high 或 Terra medium |
| 复杂多文件 / 有状态实现 / 含糊根因 | Sol high/xhigh | Terra high/xhigh；验收失败再升 Sol |
| 独立 review / 端点验收 / 架构裁决 / 不可逆决策 | Sol max | Sol high；最高风险仍保留 Sol max |

`ultra` 只给能拆成独立 workstreams、且不会与外层 fan-out 重叠的复合目标；不要把它记成 leaf effort。主线通常从 Sol medium 起步；配额紧张且目标边界清楚时可用 Terra medium/high。长会话建立后固定 family，省配额靠 leaf 的 family / effort 分档。
