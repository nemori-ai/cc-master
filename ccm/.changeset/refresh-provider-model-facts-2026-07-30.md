---
'ccm': patch
---

刷新 provider model facts 注册表（观测窗口 2026-07-30 → 2026-08-06）。

上一份快照 2026-07-29 到期，任何投影都会被 `SKG-PROVIDER-GUIDANCE` 硬闸拦下。重新观测四个 provider 的官方来源后发现快照不只是过期，还在给路由提供过时的目录：

- **新增 `claude-opus-5`**（$5/$25，frontier）。此前 claude-code 的 frontier 指向 `claude-opus-4-8`，而 Opus 5 早已发布。
- **新增 `claude-haiku-4-5`**（$1/$5，economy）。claude-code 的 economy 档此前一个型号都没有；同时解掉 `current_haiku_generation` 这条 unknown。
- **移除 `claude-opus-4-8`**。官方目录已将其归入 legacy，且被 Opus 5 取代；注册表只保留当前目录。
- codex / cursor / kimi-code 三家价格经一手源确认无变化，仅刷新观测时间与来源链接。

codex 的来源换成 OpenAI 自己的 API 定价页——原先记录的发布博文当日返回 403，其 `retrieved_at` 保持旧值未续，缺口记入 `unknown`。过程中发现两个二手源（Cursor 与 OpenRouter）对 GPT-5.6 的报价档位比例不一致，以一手定价页为准。
