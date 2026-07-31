---
point: ccm.account-enroll-why
---

## 权威陈述

<!-- ccm:k:start point:ccm.account-enroll-why -->
## 录号机制 why（keychain 直读完整 blob）

录号（`ccm account add`）的捕获源 = **macOS keychain「Claude Code-credentials」(`account=$USER`)**，**直读当前机器登录号的完整 `claudeAiOauth` blob**（含 `accessToken`/`refreshToken`/`expiresAt`/…）——**不是** `setup-token`、**不是** `credentials.json` 文件。为什么这样设计：

- **只读、不写官方凭证 → 不扰动用户的登录。** 旧 `setup-token` 流会重认证、把用户登出——keychain 直读把那套副作用 moot 了。
- **身份匹配 guard——「要录号 X，你必须当前正登录在 X」。** keychain 里永远是机器**当前登录号**的 blob（与 email 参数无绑定）。引擎读 blob 前先读 `${CLAUDE_CONFIG_DIR:-$HOME}/.claude.json` 的 `oauthAccount.emailAddress`、要求 == 录的 email，否则拒——否则会把当前登录号 B 的 blob 错标成 A（A 的 entry 实指 B 的凭证 = 选号/换号灾难）。**建池流程**：登录 A → `add A`；切登录到 B → `add B`（每次录的就是当前登录号）。
- 非 mac / 无 keychain → 降级读 `${CLAUDE_CONFIG_DIR:-~/.claude}/.credentials.json` 的 `.claudeAiOauth`。

## refreshToken 是硬要求（无重启换号死依赖它）

vault 必须存**含非空 refreshToken 的完整 blob**。换号是**无重启凭证覆写**（switch 覆写官方共享凭证、运行中 claude 惰性 re-read 接管），它靠 refreshToken 续期——keychain blob 里的 access token 仅 ~8h 有效，无 refreshToken 续不上、切进去很快认证失败。**只有真 `/login` 走完整 OAuth 才在 keychain 写下非空 refreshToken**；`claude setup-token`（旧弃用路径）铸长寿命 headless token、**结构上不产生 refreshToken**（实测 `credentials.json` 里 refreshToken 值为空·残缺副本）。故 `ccm account add` 取不到非空 refreshToken 即 FAIL，绝不存残缺 blob——这是个该 surface 给用户的失败模式（提示「多半没真 `/login`→ 请用 Orca / `claude login` 登录后重跑」），不是静默放弃。
<!-- ccm:k:end point:ccm.account-enroll-why -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删除后,agent 不知道这个项目的录号机制具体读的是 keychain 完整 blob 而非 setup-token,遇到录号失败时可能建议用户改用 setup-token,而那条路径结构上产生不出 refreshToken,治标不治本。

删掉后不知录号读 keychain blob、身份匹配 guard 与 refreshToken 硬要求等 ccm 事实。

## 边界

本条边界止于录号这一步(捕获凭证写进 vault);不覆盖号池内的选号策略、换号触发条件或 token 到期后的自动续期行为,这些依赖其它机制。

## 失败形态

录号看起来成功了——vault 里确实多了一条 entry——但因为走的是 setup-token 生成的残缺 credentials.json、refreshToken 是空字符串,若没有严格校验就被当完整 blob 存下,问题要等很久后换号失败才会暴露,且难以追溯到录号那一刻。
