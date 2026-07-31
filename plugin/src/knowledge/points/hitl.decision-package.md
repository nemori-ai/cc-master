---
point: hitl.decision-package
---

## 权威陈述

<!-- ccm:k:start point:hitl.decision-package -->
把一个 `blocked_on:"user"` 节点从「干问题」升级成「**对着准确且仍有时效的完整依据，做一次高质量决策**」的闭环。它接在上面 prefetch / recon 两条纪律上——不复述、只补两个具体动作（准备 / 消化）；{{DISCUSS_SESSION_GUIDANCE}}采访包 / sidecar 协议（字段、枚举、sidecar 结构）的 SSOT 在 `board.md` §`decision_package`，此处只讲方法论。

### 准备 decision_package（as prefetch / fill-work）

master 在 **idle** 或**创建一个 awaiting-user 节点**时，为该节点准备一份采访包（`decision_package`，挂节点上，agent-shaped）：把「cc-master 走到这一步、为什么卡这、要用户给什么（`ask_type`）、不答焊死哪条临界路径、可选项与取舍」整理成自说明的富上下文，省掉用户进来时的上下文重建成本。

- 这是上面 prefetch 纪律的自然延伸——prefetch 是「现在就问那个可预见的决策」，准备采访包是「**把那个问题连同判断依据一起备好**」，让用户在方便时对着完整依据答，而非随便选。
- **可派 sub-agent 起草侦察**（翻 deps 产物 / 翻代码搜集决策依据本就可外包）——但**对话本身绝不外包**（挖需求是你自己的活，由独立 discuss session 跟用户直接谈）。
- 它在 **fill-work 准入测试**下合法：产出一个可复用 artifact（采访包本身）/ 降低用户决策时的上下文重建成本——不是装忙。
- **`enter_cmd` 自带选择器（board + home）**：discuss 在新终端起、未必继承自定义 `CC_MASTER_HOME`、且同 home 下可能还开着别的 orchestration board——故 `enter_cmd` **默认带 `--board <board-stem>`**（钉死是哪块板、防窜板），home 非默认时再追加 `--home <绝对路径>`（**路径加 shell 引号**防含空格 home 被截断），让复制按钮产物既不依赖 env、也不靠自动消歧。生成规则 SSOT 在 `board.md` §decision_package（含「home 含字面单引号则报错拒吐」边界）。

### 消化 `.decision.md` sidecar（in recon step 1）

recon 时扫 awaiting-user 节点：sidecar 现在是 **版本化 append-only**（每次 discuss 写一份新 `<board-stem>--<node-id>--<STAMP>.decision.md`、绝不覆盖，`<STAMP>` 是紧凑 UTC `YYYYMMDDTHHMMSSZ`、字典序即时间序）。所以**扫该 node 的全部 `<board-stem>--<node-id>--*.decision.md`**（`<board-stem>` = 当前这块板文件名去 `.board.json` 后缀——防在共享 home 多 board 下误消化别的板的 sidecar；node id path-safe `[A-Za-z0-9._-]`、非 `.`/`..`，discuss 落前已 guard），按 STAMP 取**最新一份**为准消化（旧的可选保留不删、不重复消化）→

1. **先读 `## TL;DR` 再读全文**——TL;DR 是给 master 的快速摘要，全文供 replan 依据。
2. **据此 replan DAG**——决策结论解锁 / 重接哪些下游边。
3. **把短摘要折进节点 `notes`**（master 写、on-board，webview 借此显示「已解决」）+ **清 `blocked_on:"user"`**。

sidecar 由 discuss session 写、master 只读它再 on-board 落 `notes`——单写者纪律不破（discuss 绝不碰 board）。**不需实时通知**（用户明确）：master 在下一次 recon / idle 自然拾取即可；watchdog 在 idle 期可选地顺带 surface「有决策结论落地」。

### freshness / 时效性 —— 采访包是缓存

采访包在 T 时刻成形，subagent 又跑了 n 步，用户在 T+n 才回答——若不校验，他答的是个**已被架空**的问题。复用既有 `stale` status + content-hash 心智：`decision_package.inputs_hash` 是对[直接 dep 节点 artifact]串接 `board.goal` 的内容 hash；**discuss 入口必 reconcile**（重算比对），不一致即采访已过期 → 先 re-ground（discuss session 能翻当前 board / 代码）再开谈。entry-time 必 reconcile 是正确性底座，prep 缓存只换低延迟入口——不靠它，靠 entry 的 freshness-check。

---

## goal-hook —— Stop 时强制自检 + board 闸

cc-master 对抗"过早停止"的确定性守卫是 **goal-hook**（`verify-board` 这个 Stop hook）。当你试图停止时，它读**你的 board**（绝不读你的推理）并对 Stop 设闸：board 但凡还携带可行动的工作——一个 `ready` 任务，或一个 `uncertain` 的"做了但未验"节点——它就拦下把你踢回去。当 board 已是完成状态时，它会先**强制你对照 board 的 `goal` 做一次自检**，再放你走（连续拦太多次时有一根保险丝会松开闸，所以一次误判不会把你永久焊死）。

因为 hook 是个 shell——它看到的是 board，不是对话——所以自检这件事得你自己来：让 board 的 `status` enum 保持诚实（依赖已满足、可派的标 `ready`，被卡住的标 `blocked`，做了但未验的标 `uncertain`），并把你的决策程序 step-6 ledger + 验收证据写进对话和 board 两边。hook 对 board 状态设闸；真正让一次 Stop 可信的，是你写下的那份自检。

<!-- ccm:k:end point:hitl.decision-package -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删掉后模型仍会准备一些材料、推进流程，但真正容易垮的是收尾那一刻——board 看起来已经"完成"，模型更容易只把状态摆成合规的样子就想停下，而不是老实做一次对照 goal 的自检并把证据写进 board。

主体是 cc-master 特有的 decision_package/sidecar 协议与 goal-hook 行为（文件命名、enter_cmd 选择器、inputs_hash、hook 闸门），缺的是本项目具体事实。

## 边界

只在两类时刻生效——节点等待用户输入时的准备/消化，以及尝试停止时的自检；不涉及用户决策也未触发停止判断的常规推进节点不适用。没有能让自检打折扣的例外，时间紧张不构成豁免。

## 失败形态

最隐蔽的形态是"表面状态摆对了，自检其实是假的"——把未验证的节点悄悄标成完成态、让机械检查顺利放行，却没有真的对照 goal 核实过、也没把验收证据同步写进对话和 board；一切读起来正常，但这次停止从未被真正验证过。
