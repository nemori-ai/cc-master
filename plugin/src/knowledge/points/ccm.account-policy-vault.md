---
point: ccm.account-policy-vault
---

## 权威陈述

<!-- ccm:k:start point:ccm.account-policy-vault -->
## policy 机制硬闸（切号前读 board.policy）

`board.policy.autonomous_account_switch` 是**用户对「后台容量层能不能自动替这块看板换号」的开关**，取值 `allow | deny`、缺省 `allow`。它**不是**给编排 agent 放权的开关——换哪份配额从来不是单块看板能拍的事，这个字段只决定后台那套自动机制在这块板上是否放行。

`ccm account switch` 在**真正覆写官方凭证存储之前**多一道**机制硬闸**（纵深防御的机制侧）：读目标 board 的 `policy.autonomous_account_switch`，显式 `deny` → 拒绝本次换号、**exit 7**（policy-deny·不取锁 / 不覆写任何凭证 / registry 原封不动）+ best-effort 往 board.log 记一条 `decision`（供审计）。fail-open/closed 分流：真·无 ccm 上下文 → fail-open `allow`；有明确目标板（`--board`/`$CC_MASTER_BOARD`）但 policy 读不到 / 歧义 → fail-closed `deny`（exit 7·绝不让 deny 因 discovery 失败被绕过）。

> **这是纵深防御的安全网、不是硬锁。** agent 有 shell，理论上能绕过；价值在「让擅自换号从一句合理化变成要主动绕闸、且每次都在 log 留痕」。**写这个开关的权属用户**：`ccm policy set` 非 TTY 必须带 `--user-authorized`，而那个标记只能由用户给——agent 自己签发就是 self-grant 越权。缺省是 `allow` 也不构成「所以可以自己切」的许可：它放行的是后台机制，不是 agent 的自主动作。

## vault 两形态 + 明文 floor 的诚实局限

token 的唯一合法落点：

- **形态 1 —— mac keychain（首选）**：token 在 OS keychain，**agent `cat` 不到**——floor 之上的真防护。
- **形态 2 —— 0600 file（ship-anywhere floor）**：非 mac 没有 keychain 时的底线。**file vault 里是明文 token，对同用户进程不设防**——任何能跑 shell 的进程都能读 0600 文件。这是 ship-anywhere floor 的**固有代价**，诚实披露：高敏感环境建议用 mac keychain 或外部 secret manager。

vault 路径必须在 gitignored 用户级区（`${CC_MASTER_HOME:-$HOME/.cc_master}`），**绝不在 repo 树内**。

## token-blind：agent 永不见 token

换号 / 录号 / 续期都跑 `ccm account` 命令——**token 全程活在 ccm 引擎子进程内**（从 keychain 直读 / refresh POST body / 三存储原子写都在引擎子进程），**绝不进 agent context / transcript / log / registry / board / commit**。agent 跑命令、但**不见 token**——引擎是 token 的隔离边界。这就是「最大化 agentic（直接跑命令录号换号）」与「token no-leak」并存的关键：agent 不必、也绝不该手 `cat` vault / 手拼 `security -w` 取值。token 安全实现纪律（vault 两形态读写、argv 写 keychain 的 128 字节例外、refresh 端点白名单、切出 token 抢救…）已固化在 ccm 引擎——**不靠 skill prose 守、不靠 agent 自律**（agent 已不直接碰 token，那套抗合理化纪律的触发场景消失）。读手册的人只需知道：**凭证由 ccm 引擎读写、全程不进 agent / 不 log，切不切由用户拍。**
<!-- ccm:k:end point:ccm.account-policy-vault -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删掉后 agent 可能不知道 switch 前有机制硬闸(以为静默换号即可、绕过 exit 7 与审计留痕),或试图直接读 vault 文件、拼 provider CLI 取 token,把明文 file vault 误当成与 keychain 同等安全。

删掉后不知 policy 字段语义、switch 硬闸 exit 7、vault 两形态与 token-blind 边界。

## 失败形态

agent 为了“确认换成功”,自己去 cat vault 文件或用 provider CLI 打印当前 token 核对——单看这一步不报错、像是多做了一次核实,实质已经违反 token-blind。
