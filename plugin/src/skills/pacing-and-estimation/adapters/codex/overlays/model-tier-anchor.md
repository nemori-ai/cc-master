## 心智锚 4：family 选能力下限，effort 买边际深度

Codex 选档是二维的：先按任务开放性 / 可验证性在 **Luna → Terra → Sol** 里选 family，再用**最低能稳定达标**的 reasoning effort。官方 headline coding eval 中，Sol/Terra/Luna 的 SWE-Bench Pro 为 **64.6/63.4/62.7**，Terminal-Bench 2.1 为 **88.8/87.4/84.7**；API token 价比约 **5:2.5:1**。能力差小于价格差，所以别把所有临界节点无脑推到 Sol max。

- **配额充足（效果优先）**：机械叶用 Luna medium；常规实现用 Terra high/xhigh；复杂开放实现用 Sol high/xhigh；不可逆裁决 / 端点验收才用 Sol max。`ultra` 只给能拆成独立 workstreams 的任务——它是多 agent 拓扑，不是 max 之后的普通 effort。
- **配额紧张（性价比优先）**：机械叶用 Luna low/medium；清晰常规实现用 Luna high 或 Terra medium；复杂实现用 Terra high/xhigh；Sol high/max 只留给错误代价最高的裁决 / review。停用 `ultra`，先降可机械验收叶子的档位与 WIP。

主线会话在开跑前选定：通常 Sol medium；配额紧张且目标边界清楚时可从 Terra medium/high 起步。运行中别因短时水位频繁切主线——省配额主要靠 leaf 分档。完整证据、任务矩阵和边界见 `references/model-tiers.md`。
