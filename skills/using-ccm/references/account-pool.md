# 号池 / 换号概念叙事 —— 模型 · 录号 why · 选号方法论 · vault 安全

> **服务愿景：C2**（控制 token 消耗速度·换号是最重的 pacing lever 的底层容量）。**何时读：** 你要懂 `ccm account` 这套换号号池**为什么这么设计**——号池模型、录号机制 why、选号判据、vault 安全局限时。
> **这是概念叙事（why），不是实现，也不是决策。** 命令**怎么敲**见 `command-catalog.md` 的 namespace account；**算法 / vault / 切号的实现 SSOT** 在 ccm 引擎 `@ccm/engine/account`（`select.ts`/`switch.ts`/`vault.ts`/`registry.ts`…）——本文不复述实现代码；换号**决策**（何时换 / 值不值 / 谁拍板 / 绝不自授权）归 `orchestrating-to-completion`（`references/cost-decisions.md`）。本文只讲「读手册的人也该懂的那条 why」。

## Contents

- [号池模型（registry 指针 vs token 值）](#号池模型registry-指针-vs-token-值)
- [录号机制 why（keychain 直读完整 blob）](#录号机制-whykeychain-直读完整-blob)
- [refreshToken 是硬要求（无重启换号死依赖它）](#refreshtoken-是硬要求无重启换号死依赖它)
- [选号方法论判据](#选号方法论判据)
- [policy 机制硬闸（切号前读 board.policy）](#policy-机制硬闸切号前读-boardpolicy)
- [vault 两形态 + 明文 floor 的诚实局限](#vault-两形态--明文-floor-的诚实局限)
- [token-blind：agent 永不见 token](#token-blindagent-永不见-token)

## 号池模型（registry 指针 vs token 值）

一个用户级、跨编排、跨 repo 的号池台账：`${CC_MASTER_HOME:-$HOME/.claude/cc-master}/accounts.json`（`0600`·**绝不落 repo 树**）。它把每个 **email**（账号唯一标识）映射到：

- **`vault` 引用**——token 在哪取的**非密指针**（`{kind: keychain, service, account}` 或 `{kind: file, path, key}`），**不是 token 值**。
- **时间元信息**——`token_added_at` / `token_refreshed_at` / `token_expires_at`（严格 ISO-8601-UTC）。
- **`active`**——是否当前在用号（全 registry 至多一个 true·active 唯一性由 switch 维护）。
- **`switchable`**——能否无重启换号切入：`false` = 残缺号（只含 access token、无 refresh token，切不进·选号硬排除、不计 effective-N）；缺省 = 视作可切。
- **`identity`**（`oauthAccount` 非密副本）/ **`subscription_type`**（非密订阅枚举）/ **`last_observed_quota`** / **`last_switch_out`**（切出快照·选号核心输入）。

**关键不变式：registry 零凭证。** 读到它的任何 agent / 程序都无害（vault 是指针，仍要过 OS keychain 解锁 / 文件 0600 才拿得到 token）。**「指针 vs 值」的分离不是官僚，是让 registry 永远可安全读**：registry 是会被 cat / 贴 bug 报告 / 截图 / 同步 / 误 commit 的台账——token 进去就把每个日常操作变成泄漏面。`base64` / 标 `# sensitive` 都不算缓解（base64 `atob()` 一下就解、不是加密）。token 进 vault，registry 进指针，没有第三条路。

## 录号机制 why（keychain 直读完整 blob）

录号（`ccm account add`）的捕获源 = **macOS keychain「Claude Code-credentials」(`account=$USER`)**，**直读当前机器登录号的完整 `claudeAiOauth` blob**（含 `accessToken`/`refreshToken`/`expiresAt`/…）——**不是** `setup-token`、**不是** `credentials.json` 文件。为什么这样设计：

- **只读、不写官方凭证 → 不扰动用户的登录。** 旧 `setup-token` 流会重认证、把用户登出——keychain 直读把那套副作用 moot 了。
- **身份匹配 guard——「要录号 X，你必须当前正登录在 X」。** keychain 里永远是机器**当前登录号**的 blob（与 email 参数无绑定）。引擎读 blob 前先读 `~/.claude.json` 的 `oauthAccount.emailAddress`、要求 == 录的 email，否则拒——否则会把当前登录号 B 的 blob 错标成 A（A 的 entry 实指 B 的凭证 = 选号/换号灾难）。**建池流程**：登录 A → `add A`；切登录到 B → `add B`（每次录的就是当前登录号）。
- 非 mac / 无 keychain → 降级读 `~/.claude/.credentials.json` 的 `.claudeAiOauth`。

## refreshToken 是硬要求（无重启换号死依赖它）

vault 必须存**含非空 refreshToken 的完整 blob**。换号是**无重启凭证覆写**（switch 覆写官方共享凭证、运行中 claude 惰性 re-read 接管），它靠 refreshToken 续期——keychain blob 里的 access token 仅 ~8h 有效，无 refreshToken 续不上、切进去很快认证失败。**只有真 `/login` 走完整 OAuth 才在 keychain 写下非空 refreshToken**；`claude setup-token`（旧弃用路径）铸长寿命 headless token、**结构上不产生 refreshToken**（实测 `credentials.json` 里 refreshToken 值为空·残缺副本）。故 `ccm account add` 取不到非空 refreshToken 即 FAIL，绝不存残缺 blob——这是个该 surface 给用户的失败模式（提示「多半没真 `/login`→ 请用 Orca / `claude login` 登录后重跑」），不是静默放弃。

## 选号方法论判据

换号时从所有**非 active 且 token 未过期**的号中，选一个**预计可用配额最优**的切入。判据（权重 / 阈值是引擎可 env 覆写的常量·实现在 `@ccm/engine/account/select.ts`、本文只蒸馏 why）：

- **单窗口恢复度推算（保守二值，不插值）**：用切出快照 `{used_pct, resets_at}` + `now` 推「现在恢复了多少」——`now ≥ resets_at` 已过 reset → 满血；未过 → 保守仍按切出 used_pct。**为何二值不插值**：账户口径不给绝对 token 分母 + 不给 burn rate（见 `pacing-and-estimation` skill 的诚实天花板），线性插值是未经验证的精度假设；二值版在「选哪个号最优」的**相对排序**上多数够用（过 reset 一定优于没过）；多个号都未过 reset → 用 `resets_at` 早晚当 tiebreaker。
- **7d 是硬总闸（关键非对称）**：7d 已逼顶（默认 ≥85%）的号即便 5h 满血也几乎没用（切进去马上又被 7d 卡）→ 判作几乎不可用、排在所有正常号之后（对齐 usage-pacing 的 dispatch gate）。
- **可用度评分**：`score = W5×(100-p5) + W7×(100-p7)`——两窗口各自剩余额度加权，**7d 加权更重**（W7>W5·它是跨窗口总闸、最易不知不觉逼顶）。
- **source 信任分级（最大精度风险）**：切出快照带 `source`——`"account"`（账户权威）= 1.0；`"local-derived-approx"`（降级反推·reset 失真）→ 整号评分乘信任折扣 + warn 口径不可靠。**算法只保证相对排序方向性正确、不承诺精确**——真换号必 dogfood 验证选出的号是否真更经烧。
- **临到期降权 + 边界**：token 临近到期 → 降权（不归零·还能用、只是该续期）；无历史新号视作满血最优先；全员逼顶 → `NONE_ALL_EXHAUSTED`，**surface 用户别盲切**（是 `blocked_on:"user"` 决策）。

## policy 机制硬闸（切号前读 board.policy）

`ccm account switch` 在**真正覆写官方凭证存储之前**多一道**机制硬闸**（ADR-016 纵深防御机制侧）：读目标 board 的 `policy.autonomous_account_switch`，显式 `deny` → 拒绝本次换号、**exit 7**（policy-deny·不取锁 / 不覆写任何凭证 / registry 原封不动）+ best-effort 往 board.log 记一条 `decision`（供审计）。fail-open/closed 分流：真·无 ccm 上下文 → fail-open `allow`；有明确目标板（`--board`/`$CC_MASTER_BOARD`）但 policy 读不到 / 歧义 → fail-closed `deny`（exit 7·绝不让 deny 因 discovery 失败被绕过）。

> **这是纵深防御的安全网、不是硬锁。** agent 有 shell，理论上能绕过；价值在「让擅自换号从一句合理化变成要主动绕闸、且每次都在 log 留痕」。机制层只在 deny 时拦下并报响——它**不替编排做「换不换」的决策**。换号**决策**（何时换 / 谁授权 / 绝不自授权 `--user-authorized` self-grant 红线）归 `orchestrating-to-completion` 的 `cost-decisions.md`（红线 3：决策归 A、机制硬闸归引擎）。

## vault 两形态 + 明文 floor 的诚实局限

token 的唯一合法落点：

- **形态 1 —— mac keychain（首选）**：token 在 OS keychain，**agent `cat` 不到**——floor 之上的真防护。
- **形态 2 —— 0600 file（ship-anywhere floor）**：非 mac 没有 keychain 时的底线。**file vault 里是明文 token，对同用户进程不设防**——任何能跑 shell 的进程都能读 0600 文件。这是 ship-anywhere floor 的**固有代价**，诚实披露：高敏感环境建议用 mac keychain 或外部 secret manager。

vault 路径必须在 gitignored 用户级区（`~/.claude/cc-master/` 或 `${CC_MASTER_HOME}`），**绝不在 repo 树内**。

## token-blind：agent 永不见 token

换号 / 录号 / 续期都跑 `ccm account` 命令——**token 全程活在 ccm 引擎子进程内**（从 keychain 直读 / refresh POST body / 三存储原子写都在引擎子进程），**绝不进 agent context / transcript / log / registry / board / commit**。agent 跑命令、但**不见 token**——引擎是 token 的隔离边界。这就是「最大化 agentic（直接跑命令录号换号）」与「token no-leak」并存的关键：agent 不必、也绝不该手 `cat` vault / 手拼 `security -w` 取值。token 安全实现纪律（vault 两形态读写、argv 写 keychain 的 128 字节例外、refresh 端点白名单、切出 token 抢救…）已固化在引擎 `@ccm/engine/account/vault.ts`·`switch.ts`——**不靠 skill prose 守、不靠 agent 自律**（agent 已不直接碰 token，那套抗合理化纪律的触发场景消失）。读手册的人只需知道：**凭证由 ccm 引擎读写、全程不进 agent / 不 log，切不切由用户拍。**
