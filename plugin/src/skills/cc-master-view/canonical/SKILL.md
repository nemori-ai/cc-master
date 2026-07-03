---
name: cc-master-view
description: 'Triggers: 当你在 Codex 收到 `$cc-master-view` 时，启动只读 board web viewer 展示 DAG 与节点状态；Do NOT 在本 skill 中直接改写 board。'
argument-hint: '[--board <board-path-or-stem>]'
---

$cc-master-view $ARGUMENTS

启动本地只读 web viewer，展示当前 cc-master board 的 DAG。

参数：$ARGUMENTS

定位目标 board。找到已安装的 `master-orchestrator-guide` skill 目录后，用后台终端启动只读 viewer：

```bash
CC_MASTER_BOARD="<board-path>" node "<master-orchestrator-guide-skill-dir>/scripts/view-server.js"
```

必须给 `CC_MASTER_BOARD` 和脚本路径加引号。抓取 stdout 中类似 `cc-master board view: http://127.0.0.1:<port>` 的 URL 并交给用户。viewer 每 2s 轮询 board，只读、不写 board；要停止就结束该后台会话。
