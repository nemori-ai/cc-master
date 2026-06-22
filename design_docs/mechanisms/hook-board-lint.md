# 机制契约：`hooks/scripts/board-lint.js`（+ 共享核心 `board-lint-core.js`）

> 类别：hook（`PostToolUse`，matcher `Write|Edit|MultiEdit`，node/JS·ADR-006）。源码：`hooks/scripts/board-lint.js`（薄包装）+ `hooks/scripts/board-lint-core.js`（共享 lint 核心·单一真相源，被本 hook 同目录 require、被运行时手动脚本跨目录 require）。改本 session active board 后跑 lint，不通过则注入**非阻断**报告。**绝不 decision:block。**

## 触发输入
- `PostToolUse` 事件（matcher `Write|Edit|MultiEdit`），stdin JSON 含 `tool_name` / `tool_input.file_path` / `session_id`。
- 读 home（`$CC_MASTER_HOME` 或 `$CLAUDE_PROJECT_DIR/.claude/cc-master`）下 board + 被编辑文件本身。

## 业务流（hook 包装的四闸）
1. **闸1**：`tool_name ∈ {Write,Edit,MultiEdit}`，否则静默（Bash 改 board 的 sed/echo 无结构化 file_path，静态 hook 判不可靠，交手动脚本补）。
2. **闸2**：`file_path` 落 home 内且匹配 `*.board.json`（纯字符串判断，无文件读）。
3. **闸4 先算**（`targetIsMyActiveBoard`）：被编辑文件是不是「本 session 的 active board」——归档/别 session 板 → 静默；解析成功且是我的 → 过 `isArmed` 兜常规路径；JSON 读不出（null，可能正是刚写坏的本 session active 板）→ 走坏-JSON 专用容错认领 `targetOwnedByMeTolerant`（文本扫 owner.session_id == sid 才认领；sid 空降级则认本 home 写坏的 board；扫出别 session sid 不认领·红线 6）。
4. **四闸全过** → 读 board 文本 → 跑 `lintBoard` 核心 → 通过则静默、否则 `formatReport` 注入。

## 业务流（core 规则集 `board-lint-core.js`）
- **R1** 合法 JSON（坏则单条 error 提前返回，提示用 Write 整块重写）。
- **R2** pinned 窄腰存在且类型对：R2a `schema==="cc-master/v1"`、R2b `goal` string、R2c `owner` 对象 + `owner.active` boolean、R2d `owner.session_id` string（空串合法）、R2e `git` 对象、R2f `tasks` 数组（非数组提前返回）。
- **R3** 每 task `{id,status,deps}`：id 非空字符串、全局唯一、status ∈ enum（ready/in_flight/blocked/done/escalated/failed/stale/uncertain）、deps 是 required 硬窄腰字段（缺失即 hard error）必为字符串数组。
- **R4** deps 图完整性：R4a 无悬挂引用、R4b 无自环、R4c 无环（DFS 三色着色迭代式 findCycle）。
- **R5/R6** viewer 必需字段 + 三时间戳格式 + meta.template_version + top-level wip_limit——多为 **warn**（graceful-degrade，silent-on-unknown）。

## 输出副作用
- lint 不通过 → stdout `PostToolUse` additionalContext（hard error 分组 + warn 分组，每条点名 rule + task + 怎么修）。**绝不 decision:block、绝不写 board。**

## 关键不变式
- **绝不 block**——PostToolUse 编辑已落盘撤不回，只软提示。
- lint 只校验窄腰 + 合法 JSON + deps 图完整性 + viewer 真会挂的字段，对 agent-shaped 字段 **silent-on-unknown**（白名单校验 known 字段、未知字段一律放行零 warn·红线 2）——绝不评判内容「合理性」，否则 lint 自己成第二层窄腰。
- 核心住 `hooks/scripts/`（红线 5：hook 不伸手进 skill 树；依赖方向 skill→hooks 合法，两目录都 ship），hook 与运行时手动脚本 require 同一份（DRY 零漂移）。
- 坏-JSON 容错认领仍守红线 6（绝不认领别 session 的坏板）。

## 失败模式
- 单 active board 被写成 invalid JSON：标准 isArmed 扫不到可解析 active 板会误判未武装 → 坏-JSON 专用容错闸认领（codex 逮到的盲区）。
- 任何异常 → try/catch 静默 `exit 0`。
