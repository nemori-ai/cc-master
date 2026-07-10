## Codex 模型档位（GPT-5.6 family × effort）

> **易 stale 警告。** 本快照截至 **2026-07-10**。绝对价格、额度与 model ID 以 [OpenAI GPT-5.6 发布页](https://openai.com/index/gpt-5-6/)、[Codex 模型指南](https://developers.openai.com/codex/models) 和 [Codex pricing](https://developers.openai.com/codex/pricing) 为准；这里承载的是 family×effort 路由与两种配额模式。

### 先选 family：用任务形状定能力下限

| family | 相对 token 价（Luna=1×） | Plus local messages / 5h（官方估算） | 官方 coding headline（SWE-Pro / TB 2.1） | 默认任务 |
|---|---:|---:|---:|---|
| **Luna** | 1× | 50–280 | 62.7% / 84.7% | 边界清楚、可重复、能机械验收的高吞吐叶子 |
| **Terra** | 2.5× | 20–110 | 63.4% / 87.4% | everyday workhorse：常规实现、工具使用、调研整合 |
| **Sol** | 5× | 15–90 | 64.6% / 88.8% | 含糊、开放、高价值、需深判断与 polish 的任务 |

消息区间不是固定成本倍率：上下文、reasoning、工具、retrieval 与 cache 都会改变消耗。表中 headline benchmark 也不是每种 effort 的承诺；它只证明 **Terra/Luna 的能力水位远比价格差更接近 Sol**，因此可以安全承接大量有强验收契约的叶子。

### 再选 effort：只买任务真正需要的深度

| effort | 用在什么任务 | 不该怎样用 |
|---|---|---|
| **low**（UI 的 Light） | 快速、窄、明确、回归闸便宜 | 不给高不确定 / 不可逆节点 |
| **medium**（默认） | 日常实现、需要一定规划的多步工作；Sol 主线默认起点 | 别因「是临界路径」就自动升高 |
| **high / xhigh** | 多文件、多个 trade-off、失败根因含糊、需要更强自检 | 先确认瓶颈真是推理深度，不是任务切得太厚 |
| **max** | 最难的单任务、架构仲裁、端点验收、高错误代价 review | 不是所有复杂任务的默认，更不是配额充足就全开 |

### Ultra 单列：它是拓扑，不是第六档 effort

`ultra` 会用 subagents 并行不同 workstreams。只在任务能拆成有意义的独立工作流、host / 用户允许 subagents、且不会与已有 cc-master fan-out 重叠时使用；不要给不可并行的单链问题，也不要把它记录成 leaf 的 model tier。

### 两种运行方案

| 任务 | 配额充足：效果优先 | 配额紧张：性价比优先 |
|---|---|---|
| 读扫 / grep / 格式化 / 测试重跑 / 机械迁移 | Luna medium | Luna low/medium |
| 调研摘要 / 常规文档 / acceptance 清楚的常规实现 | Terra high | Luna high 或 Terra medium |
| 复杂多文件 / 有状态实现 / 含糊根因 | Sol high/xhigh | Terra high/xhigh；验收失败再升 Sol |
| 独立 review / 端点验收 / 架构裁决 / 不可逆决策 | Sol max | Sol high；最高风险仍保留 Sol max，先砍 WIP/float 而非继续降 |
| 真正可并行的复合目标 | Sol ultra（只在不会与外层 fan-out 重叠时） | 不用 ultra；由外层 orchestrator 明确拆 leaf |

**临界路径不是模型型号。** 临界只提高这次失败的排期代价；是否升 family / effort 仍取决于复杂性、错误代价与验收强度。一个有强测试闸的临界机械迁移仍可用 Luna/Terra；一个 30 分钟的不可逆裁决反而该用 Sol。

### 主线固定，leaf 分档

开跑前选主线：默认 **Sol medium**；配额紧张且目标边界清楚时可用 **Terra medium/high**。一旦长会话已建立，别为短时水位来回切 family：跨模型 cache 不可互换，稳定前缀会重计。省配额靠给 leaf 分 family/effort、降 WIP、推迟 high-float，不靠频繁切主线。
