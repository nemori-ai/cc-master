---
point: ccm.account-pool-model
---

## 权威陈述

<!-- ccm:k:start point:ccm.account-pool-model -->
## 号池模型（registry 指针 vs token 值）

一个用户级、跨编排、跨 repo 的号池台账：`${CC_MASTER_HOME:-$HOME/.cc_master}/accounts.json`（`0600`·**绝不落 repo 树**）。它把每个 **email**（账号唯一标识）映射到：

> **cc-master home 不跟随 `CLAUDE_CONFIG_DIR`**：`CLAUDE_CONFIG_DIR` 只影响 Claude Code 自己的 settings、credentials、projects；cc-master 的 board、号池 registry、file vault、用量 sidecar 默认在 `${CC_MASTER_HOME:-$HOME/.cc_master}`。

> **Codex host 暂不支持号池管理**：`ccm account add/delete/refresh/list/switch` 在 Codex 下显式 `NotImplemented`；Codex 只保留当前账户用量这类只读能力。

- **`vault` 引用**——token 在哪取的**非密指针**（`{kind: keychain, service, account}` 或 `{kind: file, path, key}`），**不是 token 值**。
- **时间元信息**——`token_added_at` / `token_refreshed_at` / `token_expires_at`（严格 ISO-8601-UTC）。
- **`active`**——是否当前在用号（全 registry 至多一个 true·active 唯一性由 switch 维护）。
- **`switchable`**——能否无重启换号切入：`false` = 残缺号（只含 access token、无 refresh token，切不进·选号硬排除、不计 effective-N）；缺省 = 视作可切。
- **`identity`**（`oauthAccount` 非密副本）/ **`subscription_type`**（非密订阅枚举）/ **`last_observed_quota`** / **`last_switch_out`**（切出快照·选号核心输入）。

**关键不变式：registry 零凭证。** 读到它的任何 agent / 程序都无害（vault 是指针，仍要过 OS keychain 解锁 / 文件 0600 才拿得到 token）。**「指针 vs 值」的分离不是官僚，是让 registry 永远可安全读**：registry 是会被 cat / 贴 bug 报告 / 截图 / 同步 / 误 commit 的台账——token 进去就把每个日常操作变成泄漏面。`base64` / 标 `# sensitive` 都不算缓解（base64 `atob()` 一下就解、不是加密）。token 进 vault，registry 进指针，没有第三条路。
<!-- ccm:k:end point:ccm.account-pool-model -->
