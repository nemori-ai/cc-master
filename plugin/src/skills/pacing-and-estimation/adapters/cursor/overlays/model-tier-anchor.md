## 心智锚 4：模型档位是资源——先 first-party 池，再按任务轴选

Cursor 四档相对 output 心智（详表 + CursorBench 诚实标注见 model-tiers.md）：**Composer ~0.5× / 主力(Sonnet·Codex)~3× / 旗舰(Grok high 优先·Opus·GPT-5.5)~5–6× API 或 Grok~1.2× first-party / 裁决=Grok xhigh**。**不用 Fable 5。**

按任务类型选档：机械=Composer；常规实现=Sonnet 5 或 GPT-5.3 Codex；难实现/临界=**Grok 4.5 high**（优先榨 first-party）；裁决/独立 review=**Grok 4.5 xhigh**（回退 Opus 4.8 high）。「把强档压临界链」的判断归 `master-orchestrator-guide`。档位差距不单调——复杂多文件升档最值，终端/知识工作别默认旗舰。账期吃紧时先降机械/调研，并**先榨 first-party（Composer→Grok）再烧 API 池**；难实现与裁决不降。主线固定一个模型——省钱靠 leaf 分档，不靠切主线模型。
