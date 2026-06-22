# 机制契约：`skills/orchestrating-to-completion/scripts/view-server.js`

> 类别：运行时带外 node 脚本（board DAG webview server·NOT a hook·随 skill 分发）。源码：`skills/orchestrating-to-completion/scripts/view-server.js`。`/cc-master:view` 启动的本地 http server。**只读、零联网。**

## 触发输入
- `/cc-master:view` 以后台 shell 启动：`CC_MASTER_BOARD=/abs/path node view-server.js`。
- env `CC_MASTER_BOARD`（必填，board 绝对路径）。
- 服务文件相对脚本自身（`__dirname`）解析：`view.html` + `vendor/`（本地 vendored xyflow 资产）。

## 业务流
1. 校验 `CC_MASTER_BOARD` 非空（缺 → stderr ERROR + exit 1）。
2. 起 http server，`listen(0, '127.0.0.1')`（OS 分配空闲端口，仅绑 127.0.0.1）。
3. 路由（只支持 GET）：`/` → view.html；`/favicon.ico` → 204；`/board.json` → 每请求 fresh 读 board（先 JSON.parse 校验，torn write → 404 让 client 下次轮询重试）；`/vendor/*` → 服务 vendored 资产（path traversal 防护：resolved 必须留在 VENDOR_DIR 内）；其余 → 404。
4. 启动后 console.log 恰好一行 `cc-master board view: http://127.0.0.1:<port>` 供 launcher scrape。

## 输出副作用
- 起一个本地 http server 进程；stdout 一行可 scrape URL。**绝不写 board**（每请求 fresh 读）。

## 关键不变式
- 只读 viewer——从不写 board。
- 仅绑 127.0.0.1、服务本地 vendored 资产、**零网络访问**（红线 5 ship-anywhere）。
- 服务文件相对脚本自身解析（launcher 可能从任意 cwd 跑）。
- node/JS only、纯 stdlib http/fs（红线 1·ADR-006）。
- non-GET → 405；path traversal 越界 → 404。

## 失败模式
- board mid-write / 读失败 / parse 失败 → 404 + `{}`，client 下次轮询重试（不崩、不缓存 stale）。
- `CC_MASTER_BOARD` 缺 → exit 1（stderr）。
- server error（端口绑不上等）→ stderr + exit 1。
