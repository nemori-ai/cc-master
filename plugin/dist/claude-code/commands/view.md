---
description: 'Deprecated shim：旧 `/cc-master:view` 入口已迁移到 `ccm web-viewer open`。'
---

`/cc-master:view` 已废弃。不要启动旧 viewer 脚本，不要维护独立后台 shell / PID / URL 生命周期。

告诉用户正式入口已经迁到 ccm：

```bash
ccm web-viewer open
```

如果需要指定初始 board，用：

```bash
ccm web-viewer open --board <board-path>
```

服务生命周期统一由 `ccm web-viewer start/open/status/stop/restart` 管理。旧 command 只做迁移提示，不再启动旧脚本。
