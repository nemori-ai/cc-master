# 机制契约：旧 `commands/view.md`（deleted）

> 迁移指针（2026-07-09）：[ADR-029](../../adrs/ADR-029-ccm-web-viewer-namespace.md) 将正式入口改为 home-scoped `ccm web-viewer open`。旧 `commands/view.md` 已从 plugin source/dist 删除，不再保留 deprecated shim。`open` 默认 ensure/open 指定 home 的 service，`--board` / `--goal` 只设初始 selection，不按 board 创建独立 service。

> 类别：historical command contract。旧源码：`commands/view.md`。旧 `/cc-master:view` 不再承载 viewer lifecycle，也不再作为迁移入口分发；用户直接使用 `ccm web-viewer open`。

## 触发输入

- 历史：用户敲旧 `/cc-master:view`。

## 业务流

1. 不选择 board，不启动旧 viewer 脚本，不创建后台 shell。
2. 提示用户正式入口：

   ```bash
   ccm web-viewer open
   ```

3. 若用户需要指定初始 board，提示：

   ```bash
   ccm web-viewer open --board <board-path>
   ```

4. 告诉用户 lifecycle 由 `ccm web-viewer start/open/status/stop/restart` 管理。

## 输出副作用

- 无 board 写入。
- 旧 command 已删除；不再有 plugin command 侧输出。

## 关键不变式

- 正式 viewer lifecycle 只归 `ccm web-viewer`。
- plugin source/dist 不再包含 `commands/view.md`。
- 旧 command 只能是迁移提示，不能重新引入脚本路径、后台 shell、per-session lifecycle。

## 失败模式

- 无需探测 viewer service。`ccm` 缺失或 `ccm web-viewer` 失败由用户运行正式命令时得到 ccm 自己的错误。
