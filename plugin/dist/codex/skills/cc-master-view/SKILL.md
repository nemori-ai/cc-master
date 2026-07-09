---
name: cc-master-view
description: 'Triggers: 当你在 Codex 收到 `$cc-master-view` 时，执行迁移提示：正式 viewer 入口已改为 `ccm web-viewer open`；Do NOT 启动旧 viewer 脚本或维护旧 lifecycle。'
argument-hint: '[deprecated; use ccm web-viewer open]'
---

$cc-master-view $ARGUMENTS

`$cc-master-view` 已废弃。不要定位 skill 目录，不要直接运行旧 viewer 脚本，也不要维护旧后台进程。

告诉用户正式入口已经迁到 ccm：

```bash
ccm web-viewer open
```

如果需要指定初始 board，用 `ccm web-viewer open --board <board-path>`。服务生命周期统一由 `ccm web-viewer start/open/status/stop/restart` 管理；本 skill 只做迁移提示。
