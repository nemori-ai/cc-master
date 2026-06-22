# 机制契约：`skills/account-management/scripts/account-delete.sh`

> 类别：运行时带外脚本（删号写侧·NOT a hook）。源码：`skills/account-management/scripts/account-delete.sh`。把一个备号从号池两处删干净。**不读 token 值**（按 email 前缀删，token-blind）。

## 触发输入
- `/cc-master:accounts --delete <email>` → agent Bash 跑。用法 `account-delete.sh --email <email> [--vault-kind keychain|file] [--vault-file <path>] [--keychain-service <s>] [--dry-run]`。
- 读 registry entry 的 vault 引用推断 vault-kind / 实际 file path（非密）。

## 业务流
1. 安全开头 + 云后端自检 no-op。
2. **从 registry 读 entry 的 vault 形态**推断 kind / file path（CLI 显式 > registry 推断 > 默认 keychain；`*_EXPLICIT` guard 防 stale-registry 场景被覆盖·P2-12）。
3. **先删 vault**（token 痕迹）：keychain `security delete-generic-password -a <email> -s <service>`（绝不带 `-w`）/ file 用 accounts-lib.fileVaultLineMatch 的 awk index($0,p)!=1 删本号**精确** `<email>_TOKEN=`/`<email>_EXPIRES=` 两类行（**绝不宽 `<email>_` 前缀**免误删 sibling `<email>_bar_*`·codex round#3·对 `.`/`@` 元字符免疫·§A.4）·**全或无 + `with_vault_lock` 跨进程串行化**（temp 全成功才 rename·rename 失败当删除失败不谎报删净）。
4. **再删 registry entry**：accounts-lib removeAccount + `mutateRegistry` 锁内 RMW（原子写）；entry 不存在 = no-op 不报错。

## 输出副作用
- vault：删该 email 的 token 项/行。
- registry：删该 email 的 entry。
- stdout 只有「✓ 已删 / · 未找到 / 警告」非密信息。**绝不回显任何 token。**

## 关键不变式
- **token-blind**：删 vault 是按 email 前缀删项/删行，绝不带 `-w`、绝不读等号右侧值。
- file vault 删行必须用 awk index() **精确**前缀（`tokenLine`/`expiresLine` 两个·绝不宽 `<email>_`·绝不 `grep -E "^email_"`·email 的 `.` 是元字符会误删 sibling）·全或无（rename 失败当删除失败、不谎报删净）。
- **跨进程串行化 + fail-closed**：file vault 删行整段「数-筛-写-rename」在 `with_vault_lock` 锁内（防与并发 add/writeback 互踩最后 mv 者赢复活已删 token）；取锁失败 fail-closed return 1（原文件不动·不继续删 registry·一致）。
- 先删 vault 再删 registry（保持一致：避免 registry 指向已没的 vault 却仍留 token）。
- 绝不进 hooks/（红线 1/5），与 board 正交。

## 失败模式
- vault 里没该 email 的 token（已删/从没录）→ 非致命（rc 2），继续删 registry entry。
- vault 删除失败 / 取锁失败 / rename 失败（rc 其它）→ 不继续删 registry（保持一致）、exit 1。
- registry entry 删除失败（坏 JSON / 锁超时）→ vault 已删但 registry 残留一条 entry，提示人工检查。
