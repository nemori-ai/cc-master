# 模型档位 —— 相对成本 + 按难度选档 + 为何主线不切

> **何时读：** 给每个节点选模型档位、纠结升档还是降档、或想清楚为何主线固定一个模型时。这里装的是**事实映射**（哪几档、相对成本、按难度落点）——「把强档集中到临界链上」的**判断**归 `master-orchestrator-guide`「目标即依赖图」镜头，本文不复述决策。

## Cursor 模型档位（两池 + GPT-5.6 family × effort；不用 Fable）

> **易 stale 警告（SSOT 不在本表）。** 具体 model ID、价格与 CursorBench 分数都会变——本表快照**截至 2026-07-10**。核对绝对数字时以 [OpenAI GPT-5.6 发布页](https://openai.com/index/gpt-5-6/)、[Cursor Models & Pricing](https://cursor.com/docs/models-and-pricing) 与 [CursorBench](https://cursor.com/cursorbench) 为准。教学价值在**score/$ + 任务轴落点 + 两池心智**，不在永久型号排序。

### 两池先于档位

Cursor 个人/团队计划有两个独立用量池（随账期重置）：

| 池 | 含什么 | 编排含义 |
|---|---|---|
| **First-party** | Auto、`Composer 2.5`、`Grok 4.5`（含 effort / fast 变体） | 额度通常更宽；能压进这池的叶子优先走这里，别先烧 API 池 |
| **API** | 手动点名的 Claude / GPT-5.6 等第三方 | 按各模型 API 单价扣美元池（Pro 起约 $20/月 included） |

**先问池，再问档**：机械/可降级叶子优先 Composer；难实现与裁决优先 Grok（仍在 first-party）；只有需要 Claude/GPT 家族特长或 Grok 不可用时，再进 API 池。

### CursorBench 3.2：用实际 task cost 看甜点

| 配置 | Score | 平均 cost/task | 怎么读 |
|---|---:|---:|---|
| Composer 2.5 | 56.1% | $0.44 | first-party 机械叶基线 |
| Grok 4.5 low / medium / high* | 63.5% / 65.4% / 66.7% | $1.22 / $1.54 / $1.51 | first-party 强甜点；星号分数不可当硬真理 |
| GPT-5.6 Luna high / max | 56.8% / 61.1% | $0.77 / $1.85 | GPT 族轻量；low 仅 37.6%，不作默认 |
| GPT-5.6 Terra xhigh / max | 59.2% / 64.9% | $1.36 / $2.73 | API 性价比甜点；复杂实现优先考察 |
| GPT-5.6 Sol medium / high / xhigh / max | 60.0% / 63.5% / 64.5% / 67.2% | $1.83 / $2.62 / $3.67 / $5.22 | 能力上限；effort 的边际收益要按任务买 |
| Opus 4.8 high / max | 58.0% / 62.3% | $3.15 / $5.77 | 异构 Claude 复核，不是 GPT-5.6 的默认价格甜点 |

结果有方差，小分差可能不显著；Grok 4.5 的旧 Cursor 代码训练污染让其分数偏高程度未知。因此把表当**路由证据**：Composer 机械活最省；Terra max 在接近 Sol 高档的水位上显著更便宜；Sol max 留给真需能力上限的节点。

> **本 adapter 不用 Fable 5。** 裁决档不指向 `claude-fable-5`（隐私 opt-in、单价约 2× Opus、且产品选择排除）。无 Fable 时裁决与难实现可能同落「最强可用」——靠**任务身份**区分，不靠档位名。

**Grok 变体**：

- **`high`**：first-party 难实现 / review 的效果档；CursorBench 未给 xhigh 行，不凭名字外推收益。
- **`fast`**（$4·$18）：要吞吐时用；约 3× 标准 out，**不是省钱档**——省钱用标准 Grok 或 Composer。
- **与 Composer**：同属 first-party、不同重量级——Composer = 轻量/高吞吐 coding specialist；Grok = 更强长跑与跨域工具使用。别把二者当成同一档。

**诚实标注（CursorBench）**：Grok 4.5 在 CursorBench 3.2 上分数带 `*`——训练曾误含旧 Cursor 代码快照，官方承认分数偏高；相对排序可参考，**别把绝对分差当硬真理**。EU 暂不可用 Grok → 难实现 / 裁决回退 GPT-5.6 Terra/Sol 或 Opus 4.8。

编排花销仍由输出主导；pace 用相对 multiplier +「先 first-party 再 API」两层心智。绝对价以官方定价页为准。

### 档位差距不按价格单调——按任务轴选

同 Claude 侧纪律，不复述长论证：

- **复杂多文件 / 有状态实现**：升档回报最确定。
- **终端 / agentic 执行**：Composer / Luna high / Terra xhigh / Grok medium 常够，别默认为它加 Sol max 价。
- **知识工作 / 方案文本**：主力与旗舰常接近打平。

选档先问任务轴，再问要不要多付几倍或换池。

### 每节点模型选择：两种运行方案

给每节点契约一个 **model** 字段，按任务类型 + 配额水位定——不是按主线碰巧跑在哪个模型上。「把强档压临界链」的调度判断归 `master-orchestrator-guide`。

| 任务 | 配额充足：效果优先 | 配额紧张：性价比优先 |
|---|---|---|
| grep / 格式化 / 测试重跑 / 机械迁移 | Composer 2.5；要 GPT 族时 Luna high | Composer 2.5 |
| 调研摘要 / 常规文档 / acceptance 清楚的常规实现 | Grok medium 或 Terra xhigh | Composer（强验收）/ Luna high；优先 first-party |
| 复杂多文件 / 有状态实现 / 含糊根因 | Grok high、Terra max 或 Sol high | Grok low/medium（first-party）或 Terra xhigh/max；失败再升 Sol |
| 独立 review / 端点验收 / 架构裁决 | Sol max，再用 Grok/Claude 异构复核 | Sol high 或 Terra max；最高风险仍用 Sol max，先砍 WIP/float 再降 |

**duration 不是难度。** 长 estimate 先拆分 / 降 WIP / 外部化；只有高复杂性或高错误代价才支持升 family/effort。`fast` 是吞吐 lever，不是节流 lever；账期逼顶时不要用它假装省钱。Cursor 也不提供 Codex `ultra` 语义——不要把外部多 agent 模式写进本表。

### 高杠杆裁决：换家族二审

独立 review / 端点验收除了升 effort，可用 **Claude ↔ GPT-5.6** 交叉二审（Opus / Sol），或 **Grok 裁决 + Sol/Terra 复核**。这是方向性 lever；**何时强制、怎么喂契约、怎么核 verdict** 归 `master-orchestrator-guide` 的 `references/resume-verify.md`（异构族系第二视角·高杠杆/临界强制），本文不复述操作纪律。边跑边记分歧率，别把单次 CursorBench 排名当二审真值。

### 为何主线固定一个模型

省钱靠给 leaf 分档 / 换池，**不靠中途切主会话模型**：

- 切模型作废跨模型不可互换的 prompt cache。
- 编排手册等大段稳定前缀被重计费。
- 可能骑在 compaction / session 边界上，危及 board 连续性。

主线锁一档；叶子（Task / subagent）各自选档。lever 是**每叶子的模型选择**，不是主线频繁换模型。
