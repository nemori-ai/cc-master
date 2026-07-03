> ccm **自带的 self-contained status line**（context 进度条 + 5h/7d 配额用量·按阈值变色）。这是 **Claude Code 专有安装面**：`install`/`uninstall` 写全局 `settings.json.statusLine.command`（跟随 `CLAUDE_CONFIG_DIR`），`render` 是 status-line 命令本身（高频跑·读 stdin）。**无感知自动安装**：Claude Code host 首次跑任意**非**-`statusline` ccm 命令时，ccm 会幂等、静默地把 `ccm statusline` 装进 `settings.json`。

- `ccm statusline` / `ccm statusline render`：读官方喂给 status-line 脚本的 stdin JSON，渲染单行 ANSI 状态行，同时把 `rate_limits` 落用量 sidecar。
- `ccm statusline install`：幂等写全局 `settings.json.statusLine.command`，先备份用户原有 `statusLine`。
- `ccm statusline uninstall`：从备份恢复原有 `statusLine`，并落 opt-out 标记。
