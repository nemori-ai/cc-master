# 机制契约：`commands/view.md`

> 类别：command（启动本地 DAG 可视化 webview）。源码：`commands/view.md`。命令体指示 agent 起一个本地 http server 把 board 渲成 xyflow 图。**只读、零联网。**

## 触发输入
- 用户敲 `/cc-master:view`。
- 读：cc-master home 下每块 `owner.active:true` 的 board。

## 业务流
1. 认准要可视化的 board（同 `/status`）：恰一块用它；多块按 `goal` 匹配；歧义 → 询问用户；零 active board → 提示先 `/cc-master:as-master-orchestrator <目标>`。
2. **以后台 shell（`run_in_background`）启动 view server**，让它跨回合活着，把认准 board 的绝对路径塞进 `CC_MASTER_BOARD`：
   ```
   CC_MASTER_BOARD="<board 绝对路径>" node "${CLAUDE_PLUGIN_ROOT}/skills/orchestrating-to-completion/scripts/view-server.js"
   ```
   `CC_MASTER_BOARD` 值必须套双引号（路径可能含空格）；脚本路径必须 `${CLAUDE_PLUGIN_ROOT}/...` 绝对引用（裸相对会找不到·Finding #38/#39）。
3. 抓 URL 交给用户：server 启动后往 stdout 打恰好一行 `cc-master board view: http://127.0.0.1:<port>`（端口 OS 分配），抓出呈现给用户。
4. 说明用法：view 每 2s 活轮询 `/board.json`、board 一变浏览器自动更新（不用手动刷新），只读；停掉 = 杀后台 shell（或随 session 退出）。

## 输出副作用
- 起一个后台 node 进程（view-server.js）。**不写 board。**

## 关键不变式
- 只读可视化——从不写 board（命令体多处重申）。
- `CC_MASTER_BOARD` 必须套双引号、脚本必须绝对引用（self-containment·红线 5 / Finding #38）。

## 失败模式
- 一两秒内 URL 行未出现 → 把后台 shell stderr 报给用户（最常见：node 不在 PATH、board 路径没塞对）。
