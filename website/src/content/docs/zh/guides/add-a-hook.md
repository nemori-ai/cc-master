---
title: 加一个 hook
description: 新 hook 只是一个小脚本——但它必须未武装即休眠、说话带标签、且只用 bash 或 Node。
section: guides
order: 2
deeper:
  - label: ADR-006 —— 为什么 hook 可以用 bash + Node（也只能用这些）
    url: https://github.com/nemori-ai/cc-master/blob/main/adrs/ADR-006-hooks-may-use-node-js.md
  - label: ADR-007 —— 每个 hook 都要过的武装闸
    url: https://github.com/nemori-ai/cc-master/blob/main/adrs/ADR-007-hook-arming-gate.md
  - label: ADR-018 —— ambient/advisory/directive 注入协议
    url: https://github.com/nemori-ai/cc-master/blob/main/adrs/ADR-018-hook-agent-message-protocol.md
---

hook 让你能在 harness 生命周期事件——session 启动、prompt 提交、工具调用前后、stop——上挂上 agent 看不见、也跳不过的逻辑。它也是全项目约束最多的表面，因为 hook 会在该 harness 的**每一个** session 里触发，不管那场 session 是不是编排。三条硬规则保证这件事不出事。

## 规则 1：bash 或 Node，别无选择

hook 必须能在任何跑得动 harness CLI 的机器上跑：**bash，或只用标准库的 Node**。不用 `jq`、不用 Python、不用 `tsx`、不用任何 npm 依赖。简单高频的 hook 用 bash，需要真正 JSON 解析或计算的用 Node。访问 board 和引擎状态只能经 `ccm` 二进制（shell + JSON）——绝不 import 引擎代码。

## 规则 2：未武装即休眠

你的 hook 每次触发的第一个动作，是武装检查：`<home>/boards/` 里有没有一块 `owner.active: true`、且 `owner.session_id` 与 stdin payload 匹配的 board？没有——空 stdout、exit 0、不 block。在非编排 session 里开口的 hook 就是 bug，没有例外。

这不用你从零实现。共享的 `hook-common.js` 库持有判定谓词（`isArmed`、`boardMatches`、`listMatchingBoards`）和一个 `runHook(spec)` harness，它包住你的 hook 主体：先过武装闸，再跑你的逻辑，所有异常兜成静默 exit 0。Node hook 经 `runHook({ arm: 'boards' })` 委托武装（harness 帮你填好匹配的 board），需要自判复合闸时用 `arm: 'custom'`。判武装只读窄腰字段——`owner.active`、`owner.session_id`。

两条推论：

- **Fail open。** 崩溃的守卫绝不能卡死 agent。意外错误 → 静默 exit 0。（例外是 bootstrap 的前置检查，它被刻意设计成 fail loud——因为它就是武装动作本身。）
- **写入走白名单。** hook 只读 board 窄腰，别无其他。唯一被许可的写是 `ccm board set-param` 写 `runtime.*` 参数区（比如记录你的 hook 上次提醒的时刻），与任何写入一样过锁和 lint。

## 规则 3：每条注入都带标签

你的 hook 打印的一切都会作为 in-context 文本到达 agent，而 in-context 文本永远在 steering。每条消息都包进三个协议标签之一，`source` 填你的 hook 名：

- `<ambient source="my-hook">` —— 背景事实；更新世界模型，不是待办。
- `<advisory source="my-hook" strength="weak|strong">` —— 供 agent 权衡的建议。大多数 hook 该待在这里。
- `<directive source="my-hook">` —— 硬闸；留给真约束，且永远带上 **why** 和该改怎么做。

用够用的最低类别。写成命令口气的 advisory，是在训练 agent 无视真正的 directive。

## 文件放哪

hook 走 PHIP 布局——host 中立的契约 + 各 host 实现：

```
plugin/src/hooks/_manifest/hooks.yaml          # 注册表：id、触发阶段、各 host 覆盖
plugin/src/hooks/<your-hook>/CONTRACT.md       # 业务规则，host 中立（SSOT）
plugin/src/hooks/<your-hook>/implementations/
  claude-code/<your-hook>.js + meta.yaml       # 每个支持的 host 一个目录
  codex/…
```

在 `_manifest/hooks.yaml` 里声明 hook 的触发阶段，以及每个 host 诚实的覆盖值（`implemented`、`unsupported`、或带限定的中间态）。hook 上多个 host 时，CONTRACT 是共享真相源——业务规则改动要在同一个 PR 里落到所有覆盖 host 的实现，否则必须在 CONTRACT 的降级行为一节说明为什么。

## 测试

hook 测试是 bash，住在 `tests/hooks/`，经 `bash run-tests.sh` 跑。测三种形态：**未武装**（静默、exit 0）、**武装 + 触发**（产出带标签的消息或闸判定）、**垃圾输入**（fail-open）。多 host 的 hook 还有 parity fixture 套件：同一份 host 中立 stdin 跑各实现，断言判定落在同一等价类。

然后重新生成 adapter（`bash scripts/sync-plugin-dist.sh --host <host>`），开 PR 前再跑一遍全套测试。
