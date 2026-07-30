---
point: capacity.account-switch-sequence
---

## 权威陈述

<!-- ccm:k:start point:capacity.account-switch-sequence -->
机制 SSOT 在 ccm `account` 引擎 + `using-ccm`——本文只留**编排决策序列**：

1. **探测 + policy 闸** —— 在 pacing 决策点读 `ccm usage advise --json`：触发 = `verdict==="switch"`（= 5h 临界 + n>1 + 7d 有余量 + `switch_candidate` 非空）。**先过 board-policy 闸**（见上）：`ccm policy show --json` 的 `autonomous_account_switch==deny` → 不自主换号，把授权问题 surface 给用户（绝不自授权）。注：`usage-pacing.js` hook 在 `switch` + policy=allow 下已**机械换号**（切号执行归 hook·你只在事后调配速）；这里的编排决策只在 hook 未自动切（policy=deny / 全池逼顶 / 多板歧义）时接管。
2. **拍板** —— 选号是机械的（ccm `account` 引擎按各号配额恢复度选最优切入号，即 `usage advise` 的 `switch_candidate`），但**切不切由用户拍**——尤其全员逼顶必 surface 给用户、绝不盲切（对齐 7d 总闸纪律，是 `blocked_on:"user"` 决策）。
3. **切（机制归 using-ccm / ccm 引擎）** —— 跑 `ccm account switch`：续期新号 → 覆写官方共享凭证三存储（`$USER` 视角·原子写·全或无回滚）→ 翻 registry `active`。token 全程经 vault 读 / refresh POST body / 三存储写，**绝不进 agent / 绝不进 registry**（机制 / 失败模式 / token 安全见 `using-ccm` 的 `${CLAUDE_PLUGIN_ROOT}/skills/using-ccm/references/account-pool.md`）。
4. **续跑** —— claude 进程惰性 re-read 接管新号后照常推进；board 没动、整张 DAG 没忘。账号切了，目标没忘。无重启凭证覆写**不换进程、不换 session**——所以从前那套「换号前 drain 在飞 / 带飞切后孤儿 reconcile」**不再需要**：sub-agent / workflow 的 handle 不失效、board 连续性锚 `owner.session_id` 不变，在飞工作继续跑、照常在端点回收。

> **ship-anywhere**：换号概念只在订阅口径（Pro/Max/Team/Enterprise）适用——Bedrock/Vertex/Foundry 云后端**无订阅 5h/7d 配额窗口**，探测拿不到订阅 `used_percentage` → 换号 lever **自然不触发**（`available:false`/switch no-op），不破 ship-anywhere。账号机制全在 ccm `account` 引擎 + 带外操作、**绝不进 hook 层**。
<!-- ccm:k:end point:capacity.account-switch-sequence -->
