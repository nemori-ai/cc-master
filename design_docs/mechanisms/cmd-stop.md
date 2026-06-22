# 机制契约：`commands/stop.md`

> 类别：command（归档 board + 停用 orchestrator）。源码：`commands/stop.md`。命令体是注入 agent context 的 prompt——指示 agent 把一块 board 的 `owner.active` 置 false。**破坏性但显式可逆**（不删文件）。

## 触发输入
- 用户敲 `/cc-master:stop`。
- 读：cc-master home 下每块 `owner.active:true` 的 board。

## 业务流
1. 认准 board（同 `/status`）：恰一块 active 用它；多块按 `goal` 匹配；歧义 → 向用户询问（列候选 + goal + 文件名），不靠猜——停错 board 会归档别人的 orchestration。
2. **停用前先确认**：说明将停的 board（goal + 文件名），请用户确认。没有用户确认不要停用。
3. 确认后把该 board 文件的 `owner.active` 置 `false`（保留文件作审计；不删除）。这一处编辑即完成停用。
4. 给用户一段收尾说明：什么完成了（带 artifacts）、什么还在飞、什么仍阻塞在他们身上。

## 输出副作用
- 改写认准 board 的 `owner.active: true → false`（单处编辑）。**不删除文件、不留额外标记文件**（hooks 只把 `active:true` 当活的）。

## 关键不变式
- 停用 = 把 `owner.active` 置 false → 全套 hook 对这块 board 休眠（解除武装）。
- **显式可逆**：board 文件保留，`tasks`/`log`/`goal`/`git` 全留，日后经 `--resume <选择器>` 在新 session 复活（active:false → true + 重盖 owner）。
- 没有用户确认不停用（会改变状态）。

## 失败模式
- 多块 active 无法无歧义确定 → 询问用户，不靠猜（停错会归档别人的 orchestration）。
