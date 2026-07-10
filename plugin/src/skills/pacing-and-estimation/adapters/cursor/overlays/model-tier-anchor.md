## 心智锚 4：先问池，再用 score/$ 选 family × effort

Cursor 的第一轴是 **first-party（Composer/Grok）还是 API（Claude/GPT）**，第二轴才是能力与价格。CursorBench 3.2 的关键甜点：Composer 56.1%/$0.44；Luna high 56.8%/$0.77；Terra xhigh 59.2%/$1.36、max 64.9%/$2.73；Sol high 63.5%/$2.62、max 67.2%/$5.22。Grok high 66.7%/$1.51 虽很强，但带训练污染星号——可榨 first-party，别把小分差当硬真理。**不用 Fable 5。**

- **配额充足（效果优先）**：机械叶仍用 Composer；常规实现用 Grok medium 或 Terra xhigh；难实现用 Grok high / Terra max / Sol high；独立裁决用 Sol max，再找 Grok/Claude 异构复核。
- **配额紧张（性价比优先）**：机械叶用 Composer；清晰常规实现用 Composer 或 Luna high；复杂实现优先 Grok low/medium（first-party）或 Terra xhigh/max；高风险 review 才保留 Sol high/max。先砍 WIP / high-float，再把裁决降到 Terra 以下。

Cursor 不投影 Codex `ultra`。主线开跑前锁定一个模型，省配额靠 leaf 换池 / 分 family / 调 effort，不靠中途频繁切主线。详表、口径与两套任务路由见 `references/model-tiers.md`。
