---
'ccm': patch
---

刷新 provider model facts 注册表（观测窗口 2026-08-06 → 2026-08-13）。

上一份快照 2026-08-06T05:30Z 到期，`SKG-PROVIDER-GUIDANCE` 硬闸开始拦下所有投影，main 与全部在途 PR 的 CI 一并变红。

**四家逐一重新核对官方一手源，抓到 codex 两处真价格漂移：**

- **`gpt-5.6-luna` 从 `1/6` 改为 `0.2/1.2`** —— 输入价此前高估了 **5 倍**。
- **`gpt-5.6-terra` 从 `2.5/15` 改为 `2/12`**。
- `gpt-5.6-sol`（5/30）无变化。

两条纠正有**两个独立来源互证**：OpenAI 自己的定价页（`developers.openai.com/api/docs/pricing`，原 `platform.openai.com` 路径已 301）与 Cursor 定价页对 OpenAI 全系的转载，逐条一致。

**另修一处死链**：cursor 的一手源 `cursor.com/docs/models-and-pricing.md` 现在返回 **404**，改为官方定价页指向的现行路径 `cursor.com/docs/account/pricing`。`provider-model-facts.test.ts` 里把旧 URL 钉死的那条断言同步更新——**断言把来源钉死是对的，但钉的必须是活链**。

**核过而未变的**：

- claude-code 四条（Fable 5 `10/50`、Opus 5 `5/25`、Sonnet 5 `2/10` 促销至 2026-08-31 后转 `3/15`、Haiku 4.5 `1/5`）与官方 models overview 逐条吻合，含促销条款。
- kimi-code 两条（K3 `3/15`、K2.7 Code `0.95/4`）经 Kimi 一手定价页确认，cache-hit 输入价 `0.30` 亦相符。
- cursor 的 Auto 三档官方仍未给出逐 token 费率，注册表原有的「Auto Cost 固定费率、其余按所路由模型的 API 费率计」表述维持不变。
