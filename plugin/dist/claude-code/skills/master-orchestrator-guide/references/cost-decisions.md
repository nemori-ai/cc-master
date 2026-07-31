# 容量边界 —— 配额烧穿时你能做什么、不能做什么

> **何时读：** 选定 target 的配额窗口逼近硬边界，你在盘算「还能怎么把活干下去」；或者你收到一条「账号已切换」的背景通报，不确定要不要做点什么。
> **一句话结论：** 同一份配额之内的腾挪归你；**换哪份配额不归你**。后者由后台的容量管控层在整机范围统一决定。
> 同一份配额内怎么读信号、怎么缩放节奏，见 `${CLAUDE_PLUGIN_ROOT}/skills/pacing-and-estimation/SKILL.md`；用户直接命令你换号时那条命令怎么敲，见 `${CLAUDE_PLUGIN_ROOT}/skills/using-ccm/references/command-catalog.md` 的 namespace account。

## 换号不在你的 lever 清单里

<a id="ccm-k-point-capacity-switch-is-not-your-lever"></a>
<!-- ccm:k:start point:capacity.switch-is-not-your-lever -->
配额吃紧时，你手上的 lever 全都落在**同一份配额之内**：降模型档、降并发上限、把高 float 的任务往后推。这些都是在既有容量里腾挪。

**「换到下一份配额」不在你的 lever 清单里。** 当前用哪份配额，由后台的容量管控层在机器范围内统一决定——切换覆写的是本机的登录凭证，一切全机所有会话一起切，不是任何一块看板能局部拍的事。因此：

- 你**不判断**「该不该换号」；
- 你**不执行**切号命令；
- 你**更不去**改任何能让自己获得这项权限的开关。授权类标记只由用户给，自己给自己签发就是越权。

**唯一的例外是用户直接命令你换号。** 那时照他说的执行，执行完把结果回报给他——这是在替用户跑一条命令，不是你自己做了一个容量决策，也不会因此获得下一次自行决定的资格。

配额真的到了边界、而后台没有替你续上时，正确动作只有一个：**停止派发新工作，把「哪份配额已到边界、最近的恢复时刻是什么时候、用户有哪些选项」作为一个等待用户拍板的阻塞项摆出来，然后等。** 等待不是失败；擅自扩容才是。

> **越顺耳的论证越要停。** 「池子里明明还有备号」「默认本来就是允许的」「就切这一次，活干完就不动了」「用户肯定希望我别停」——这类话把一个全机生效、连带影响别人正在跑的会话、消耗用户真实资源的动作，包装成一次无害的本地优化。你越强，编出的理由越像样，而理由像样恰恰是它最危险的地方。判据很硬：这个动作的作用域超出你这块看板，就不归你拍。
<!-- ccm:k:end point:capacity.switch-is-not-your-lever -->
<!-- ccm:k:nav:start point:capacity.switch-is-not-your-lever -->
Knowledge navigation:
- [Knowledge atlas](../SKILL.md#ccm-k-skill-master-orchestrator-guide)
- [Module module:capacity.account-switch](./cost-decisions.md#ccm-k-module-capacity-account-switch)
- [routes_to: policy 硬闸 + vault/token-blind](../../using-ccm/references/account-pool.md#ccm-k-point-ccm-account-policy-vault) <!-- ccm:k:edge edge:account-switch-gate-to-policy-vault -->
- [routes_to: 决策影响向量](../../pacing-and-estimation/references/pacing-levers.md#ccm-k-point-pacing-decision-vectors) <!-- ccm:k:edge edge:account-switch-gate-to-decision-vectors -->
<!-- ccm:k:nav:end -->
**你手上真正能动的那几根**，以及怎么按信号选，见 `${CLAUDE_PLUGIN_ROOT}/skills/pacing-and-estimation/references/pacing-levers.md`。配速建议里出现的账号候选字段是**引擎侧的机器事实**，喂给后台容量层用的，不是发给你的换号许可。

## 后台换号之后

<a id="ccm-k-point-capacity-post-switch-continuity"></a>
<!-- ccm:k:start point:capacity.post-switch-continuity -->
后台换过账号之后，你会收到一条背景通报说「账号已切换」。它是**既成事实的告知**，不是派给你的活。

你要做的只有一件：**让配速模型跟上**——旧那份配额的读数就此作废，按新账号的读数重新判断能装多少活。

你**不需要**做的：重建看板、重派在飞的任务、把已经完成的工作再验一遍。切换是无重启的凭证覆写——进程没换、会话没换、看板一字未动；已派出去的后台作业句柄不失效，在飞的工作继续跑，照常在端点回收。**账号换了，目标没忘。**

也别把这条通报读成「换号是可用手段」的证据。它证明的是**容量层有人在管**，不是你新拿到了一根 lever。
<!-- ccm:k:end point:capacity.post-switch-continuity -->
<!-- ccm:k:nav:start point:capacity.post-switch-continuity -->
Knowledge navigation:
- [Knowledge atlas](../SKILL.md#ccm-k-skill-master-orchestrator-guide)
- [Module module:capacity.account-switch](./cost-decisions.md#ccm-k-module-capacity-account-switch)
<!-- ccm:k:nav:end -->
## 用户直接命令你换号时

这是本页唯一让你碰账号的场景。执行、回报，就结束——不要顺势把它变成一条你以后可以自己走的路。

- 命令怎么敲、参数什么含义：`${CLAUDE_PLUGIN_ROOT}/skills/using-ccm/references/command-catalog.md` 的 namespace account。
- 号池是怎么回事、凭证为什么全程不经你手：`${CLAUDE_PLUGIN_ROOT}/skills/using-ccm/references/account-pool.md`。
- 有两类**硬失败**该直接回报用户、不要静默吞掉：备用号的凭证已失效需要重录；以及机制层的开关处于禁止状态、命令被拒。两者都是用户要知道的事实。
- 只在订阅口径下才有换号这回事。走云端后端的部署没有订阅配额窗口，这条命令自然无从谈起。

<!-- ccm:k:generated -->
## 换号不归编排器

<a id="ccm-k-module-capacity-account-switch"></a>

守住「哪份配额在用由后台机器层统管、编排器既不决策也不执行」这条边界，并说明后台切换发生后编排器该做与不该做什么。

## Member points

- [后台换号后的连续性](./cost-decisions.md#ccm-k-point-capacity-post-switch-continuity)
- [换号不在你的 lever 清单里](./cost-decisions.md#ccm-k-point-capacity-switch-is-not-your-lever)

## Back to atlas

- [Knowledge atlas](../SKILL.md#ccm-k-skill-master-orchestrator-guide)
