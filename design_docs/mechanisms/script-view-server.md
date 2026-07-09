# 机制契约：legacy viewer script payload

> 迁移指针（2026-07-08）：[ADR-029](../../adrs/ADR-029-ccm-web-viewer-namespace.md) 将正式入口改为 home-scoped `ccm web-viewer` service：`--board` / `--goal` 只设初始 selection，service 扫描 `<home>/boards/` 并在 viewer 内列出 / 切换 boards。本页描述的是旧 plugin script payload；它只可作为短期迁移 / 测试资产，长期 SSOT 应迁到 ccm package。用户文档不应继续指导直接运行本脚本或通过旧 command 启动。

> 类别：legacy runtime sidecar（board DAG web viewer server·NOT a hook·随 skill 分发）。正式 lifecycle 由 `ccm web-viewer start/open/status/list/stop/restart` 管理。

## 触发输入

- 仅允许作为 ccm 迁移桥或测试 fixture 被内部调用。
- 需要显式传入目标 board 路径环境变量；这是 legacy contract，不是用户入口。
- 服务文件相对脚本自身解析：HTML shell + local vendor assets。

## 业务流

1. 校验目标 board 路径环境变量非空。
2. 起本地 HTTP server，`listen(0, '127.0.0.1')`。
3. 路由只读：viewer shell、board/model JSON、board list / peer data（若当前 payload 已支持）、本地 vendor assets；非 GET 返回 405。
4. 启动后向 stdout 打一行本地 URL，供内部 launcher / 测试抓取。

## 输出副作用

- 起一个本地 HTTP server 进程。
- 绝不写 board。

## 关键不变式

- 只读 viewer：从不写 board。
- 仅绑 127.0.0.1、服务本地资产、零外部网络访问。
- 服务文件相对脚本自身解析。
- node/JS only、纯 stdlib HTTP / filesystem。
- non-GET → 405；path traversal 越界 → 404。

## 失败模式

- board mid-write / 读失败 / parse 失败 → 返回 recoverable 错误，client 下次轮询重试。
- 缺目标 board 路径 → stderr + exit 1。
- server error（端口绑定等）→ stderr + exit 1。

## 退役条件

当 ccm-native server/assets 完成 packaging 后，删除或归档本 legacy payload；正式文档继续只指 `ccm web-viewer`。
