## Cursor 模型档位（Composer + Grok + Claude + Codex/GPT；不用 Fable）

> **易 stale 警告（SSOT 不在本表）。** 具体 model ID、$/1M、CursorBench 分数都会变——本表快照**截至 2026-07**。核对绝对数字时以 [Cursor Models & Pricing](https://cursor.com/docs/models-and-pricing) 与 [CursorBench](https://cursor.com/cursorbench) 为准。教学价值在**相对 multiplier + 任务轴落点 + 两池心智**，不在绝对美元。

### 两池先于四档

Cursor 个人/团队计划有两个独立用量池（随账期重置）：

| 池 | 含什么 | 编排含义 |
|---|---|---|
| **First-party** | Auto、`Composer 2.5`、`Grok 4.5`（含 effort / fast 变体） | 额度通常更宽；能压进这池的叶子优先走这里，别先烧 API 池 |
| **API** | 手动点名的 Claude / GPT·Codex 等第三方 | 按各模型 API 单价扣美元池（Pro 起约 $20/月 included） |

**先问池，再问档**：机械/可降级叶子优先 Composer；难实现与裁决优先 Grok（仍在 first-party）；只有需要 Claude/GPT 家族特长或 Grok 不可用时，再进 API 池。

### 四档表（相对 output 心智；基准 = Haiku out $5 → 1×）

| 档 | Rel（out） | 默认落点 | 同档备选 | Use for |
|---|---|---|---|---|
| **轻量** | ~0.5–1× | `Composer 2.5`（first-party；$0.5·$2.5） | `claude-4.5-haiku`（$1·$5）；`gpt-5.1-codex-mini` / `gpt-5-mini`（~$0.25·$2） | 机械活：读扫 / grep / 格式化 / 批量小改 / 跑测 |
| **主力** | ~3× | `claude-sonnet-5` 或 `gpt-5.3-codex`（~$3·$15 / $1.75·$14） | Sonnet 4.6；配额紧且可留 first-party 时用 `Grok 4.5` medium/low | 常规实现、调研摘要、日常文档；Codex 官方「strong default for most coding」 |
| **旗舰执行** | API ~5–6×；Grok 标准 ~1.2× 但吃 first-party | **`Grok 4.5 high`**（first-party；$2·$6） | `claude-opus-4-8` high（$5·$25）；长跑更省 token 时用 `gpt-5.5` high（$5·$30，CursorBench $/task 常低于 Opus） | 难实现、临界路径、复杂并发根因、常规 review |
| **裁决** | 无 Claude 10×；用最强可用 | **`Grok 4.5 xhigh`**（或 high） | 交叉二审：`claude-opus-4-8` max/high ↔ `gpt-5.5` high | 独立 review / 二审 / 端点验收 / 架构仲裁 / 不可逆决策 |

> **本 adapter 不用 Fable 5。** 裁决档不指向 `claude-fable-5`（隐私 opt-in、单价约 2× Opus、且产品选择排除）。无 Fable 时裁决与难实现可能同落「最强可用」——靠**任务身份**区分，不靠档位名。

**Grok 变体**：

- **`xhigh` / `high`**：裁决与最难执行的默认；难节点先加 effort，再换家族。
- **`fast`**（$4·$18）：要吞吐时用；约 3× 标准 out，**不是省钱档**——省钱用标准 Grok 或 Composer。
- **与 Composer**：同属 first-party、不同重量级——Composer = 轻量/高吞吐 coding specialist；Grok = 更强长跑与跨域工具使用。别把二者当成同一档。

**诚实标注（CursorBench）**：Grok 4.5 在 CursorBench 3.2 上分数带 `*`——训练曾误含旧 Cursor 代码快照，官方承认分数偏高；相对排序可参考，**别把绝对分差当硬真理**。EU 暂不可用 Grok → 旗舰/裁决回退 Opus 4.8 / GPT-5.5。

编排花销仍由输出主导；pace 用相对 multiplier +「先 first-party 再 API」两层心智。绝对价以官方定价页为准。

### 档位差距不按价格单调——按任务轴选

同 Claude 侧纪律，不复述长论证：

- **复杂多文件 / 有状态实现**：升档回报最确定。
- **终端 / agentic 执行**：主力（Sonnet / GPT-5.3 Codex / Grok medium）常够，别默认为它加 API 旗舰价。
- **知识工作 / 方案文本**：主力与旗舰常接近打平。

选档先问任务轴，再问要不要多付几倍或换池。

### 每节点模型选择

给每节点契约一个 **model** 字段，按任务类型 + 配额水位定——不是按主线碰巧跑在哪个模型上。「把强档压临界链」的调度判断归 `master-orchestrator-guide`。

- **duration 不是难度。** 长 estimate 先拆分 / 降 WIP / 外部化；只有高复杂性或高风险才支持升档。
- **机械 / 可机械检查** → **Composer 2.5**（或 Haiku / Codex Mini）。升档几乎买不到质量。
- **调研摘要 / 常规文档** → **Sonnet 5 / GPT-5.3 Codex**；性价比模式下几乎无损。结论驱动不可逆决策时，这一次可升 Grok high / Opus。
- **常规实现** → **Sonnet 5 或 GPT-5.3 Codex**（两家可互换，按家族偏好）；能留 first-party 且质量够用时可用 Grok medium/low。
- **难实现 / 临界路径 / 常规 review** → **`Grok 4.5 high`**（优先）；需要 Claude/GPT 家族或 Grok 不可用 → Opus 4.8 high / GPT-5.5 high。
- **高杠杆裁决** → **`Grok 4.5 xhigh`（或 high）**；交叉二审用 Opus ↔ GPT-5.5。**不要因配额吃紧降裁决档**——先砍并发或延后非临界节点。

**性价比模式（账期逼顶 / `throttle`）**：机械 → Composer；调研/常规 → Sonnet·Codex 或 Grok medium；**先榨 first-party 再动 API 池**。难实现与裁决**不降**。  
**效果上限模式**：只为复杂实现与裁决上探 Grok xhigh/high 或 API 旗舰；别把稀缺强档浪费在机械/调研上。

### 高杠杆裁决：换家族二审

独立 review / 端点验收除了升 effort，可用 **Claude ↔ GPT** 交叉二审（Opus / GPT-5.5），或 **Grok 裁决 + 另一家族复核**。这是方向性 lever；**何时强制、怎么喂契约、怎么核 verdict** 归 `master-orchestrator-guide` 的 `references/resume-verify.md`（异构族系第二视角·高杠杆/临界强制），本文不复述操作纪律。边跑边记分歧率，别当成已验证优于同家族升档的铁律。

### 为何主线固定一个模型

省钱靠给 leaf 分档 / 换池，**不靠中途切主会话模型**：

- 切模型作废跨模型不可互换的 prompt cache。
- 编排手册等大段稳定前缀被重计费。
- 可能骑在 compaction / session 边界上，危及 board 连续性。

主线锁一档；叶子（Task / subagent）各自选档。lever 是**每叶子的模型选择**，不是主线频繁换模型。
