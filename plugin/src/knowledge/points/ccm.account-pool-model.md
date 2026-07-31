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

## 失效类型

`environment_fact`（双重性质·方法部分补不回来，它才是承重结构） —— 删除后,agent 在图省事(比如想省一次 keychain 查找延迟)的压力下,会把 token 值本身或做过简单编码的版本直接写进 registry,而不是老实存指针,让 registry 悄悄变成明文凭证台账。

删掉后不知 accounts.json 指针-vs-值模型、registry 字段与零凭证不变式。

## 边界

唯一客观做不到别的的例外是运行环境彻底没有任何安全存储原语(既无 OS keychain 也无带权限控制的本地文件系统),此时存指针方案本身没有落脚点,只能拒绝录号并 surface 给用户,而不是退而求其次把 token 直接摆进 registry。

## 失败形态

registry JSON 里字段名仍叫 vault、结构看起来像指针,但塞进去的值其实是被简单编码(如 base64)过的 token 本身,不是真正指向 keychain/文件的引用——schema 表面完全看不出问题,只有解出该字段的值才会发现它其实是凭证。
