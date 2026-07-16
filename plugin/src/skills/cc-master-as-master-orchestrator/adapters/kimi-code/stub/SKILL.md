---
name: cc-master-as-master-orchestrator
description: 'Triggers: 当你在 kimi-code 收到 `cc-master:as-master-orchestrator ...` 或同类 command surface 时，不能直接触发该 skill；Do NOT 把此 skill 当作主流程入口，这里是 unsupported stub（命令入口已提升为 host-native plugin command）。'
---

# Unsupported Stub

该 skill 为兼容性占位，不作为 kimi-code 的独立入口。

在 kimi-code 下，请用 plugin 命令 `cc-master:as-master-orchestrator <目标>` 触发编排初始化；板的选定、所有权与武装都在 bootstrap hook 里完成。
