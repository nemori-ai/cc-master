# 机制契约：`commands/accounts.md`

> 类别：command（换号号池 token 管理·写侧）。源码：`commands/accounts.md`。命令体指示 agent 直接 Bash 跑 `account-management/scripts/` 下的预设脚本完成 add/delete/refresh/list。**token 全程活在脚本子进程、绝不进 agent context。**

## 触发输入
- 用户敲 `/cc-master:accounts --add <email> | --delete <email> | --refresh <email> | --list`。
- email 是账号唯一标识。号池两层：registry `${CC_MASTER_HOME:-$HOME/.claude/cc-master}/accounts.json`（非密）+ token 本体（mac keychain service `cc-master-oauth` / 非 mac 0600 文件 `accounts.env`）。

## 业务流
1. **云后端自检（红线 5）**：`CLAUDE_CODE_USE_BEDROCK`/`VERTEX`/`FOUNDRY` 任一为真 → 告知「云后端无订阅 OAuth token 可管」、收尾退出（每个脚本内部也各有这道自检）。
2. **解析 `$ARGUMENTS` 路由到一个操作**；缺操作 flag → 默认先跑 list 再提示四操作；add/delete/refresh 缺 email → 问用户要。
3. **delete** → Bash 跑 `account-delete.sh --email <email>`（不涉密，全程亲跑；非 mac file 形态推不出时补 `--vault-kind file`）。
4. **add / refresh** → 走**完全相同**的 `account-add.sh`（幂等 upsert，refresh 即对同一 email 再跑一次）：机制是直读 keychain「Claude Code-credentials」(`account=$USER`) 的完整 blob（含 refreshToken）。**身份 guard**：录号前确认用户当前正登录在目标号（脚本硬 guard `~/.claude.json` 的 emailAddress 须 == `--email`）。
5. **list** → Bash 跑 `account-list.sh`（只读对账，绝不取 token；探活 keychain 加 `--probe-keychain`）。
6. 收尾转述脚本非密结果（email / vault 形态 / 到期日 / registry 写没写成），绝不含任何 token 值。

## 输出副作用
- 无（agent 侧）。所有 token 写入只在脚本子进程内经 OS 工具（`security` / 0600 文件写）发生。**完全不碰 board、不武装 hook、不新增后台派发机制。**

## 关键不变式
- **token 永不进 agent context（铁律）**——脚本是凭证隔离边界，agent 跑脚本但 blob 全程在管道/子进程，绝不 echo/log/流回 agent。
- registry 只经脚本读写——agent 绝不直接 `Read`/`cat`/`Edit` accounts.json（用 account-list.sh），更绝不 `cat` file vault。
- refreshToken 硬要求：必须真 `/login`（OAuth）才在 keychain 写非空 refreshToken；`setup-token`（旧弃用路径）结构上不产生 refreshToken。
- 与 board 正交（红线 2）。

## 失败模式
- 云后端 → no-op 退出（不适用）。
- add 身份不匹配（当前登录 B 但 `--add A`）→ 脚本立刻 FAIL（防把 B 的 blob 错标成 A）。
- 取不到含非空 refreshToken 的完整 blob → 脚本 FAIL + 提示「多半没真 /login → 用 Orca / claude login 登录后重跑」，绝不静默存残缺 blob。
