## 心智锚 4：模型档位是资源，按任务轴选、主线不切

四档相对 output 成本（稳定心智，绝对价格会 stale·详表 + Fable 可用性见 model-tiers.md）：**Haiku 1× / Sonnet 3× / Opus 5× / Fable 10×**。按任务**类型**选档（机械活=Haiku、调研摘要/常规文档=Sonnet、难实现/临界=Opus、裁决/独立 review=Fable）——这是**事实映射**；「把强档集中到临界链上」的**判断**归 `master-orchestrator-guide`「目标即依赖图」镜头。**档位差距不单调**：只有复杂多文件实现这条轴上「越贵越好」可靠成立，终端操作 / 知识工作类任务上主力档常不输旗舰——别把价格当难度代理，配额吃紧时优先降机械/调研/文档类，别降复杂实现或裁决类。**主线固定一个模型**（中途切作废 prompt-cache，尤其 cc-master 每次 compaction 会重注整篇常驻编排手册）——省钱靠给 leaf 配便宜档，不靠切主线 `/model`；subagent 有独立 cache，主线锁档 + 按 subagent 任务分档正是这套机制下的正解。
