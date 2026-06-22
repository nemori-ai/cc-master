# 机制契约：`skills/account-management/scripts/account-add.sh`

> 类别：运行时带外脚本（录号写侧·NOT a hook）。源码：`skills/account-management/scripts/account-add.sh`。一条命令把当前登录号的完整 OAuth blob 录进 vault + 写一条 registry entry。refresh 复用同一脚本（幂等 upsert）。

## 触发输入
- `/cc-master:accounts --add/--refresh <email>` → agent Bash 跑。用法 `account-add.sh --email <email> [--vault-kind keychain|file] [--vault-file <path>] [--keychain-service <s>] [--expires <ISO>] [--dry-run]`。
- 读：macOS keychain「Claude Code-credentials」(`account=$USER`)（主路径，含 refreshToken）/ 非 mac fallback `~/.claude/.credentials.json`；`~/.claude.json` 的 `oauthAccount`（身份 + guard email 来源）；可选 cc-usage.sh（录号那刻配额快照）。

## 业务流
1. 安全开头（`set +x` + `unset SHELLOPTS`）+ 云后端自检 no-op。
2. **身份提取 + guard**：node 读 `~/.claude.json` 取 oauthAccount（身份 + emailAddress）；硬 guard 当前登录 email 须 == `--email`，否则 FAIL（防把 B 的 blob 错标成 A）。
3. **完整 blob 提取**（主路径直读 keychain）：`security find-generic-password -w -s "Claude Code-credentials" -a "$USER"` → 管道喂 node JSON.parse 取 `.claudeAiOauth` → 严格校验三必需字段（accessToken `sk-ant-oat` / **refreshToken `sk-ant-ort` 非空** / expiresAt 数字）→ 规整单行 blob。非 mac 降级读 credentials.json。
4. **存进 vault**（store_blob）：keychain `security -U -w "$blob"`（值作 argv·避 stdin 128 截断）/ file **全或无 + 精确前缀**——`with_vault_lock`（accounts-lib 通用文件锁·O_EXCL + owner token + stale 回收·fail-closed）罩住整段「筛-写-rename」，temp 里先写齐（只删本号**精确** `<email>_TOKEN=`/`_EXPIRES=` 两类行·绝不宽 `<email>_` 前缀免误删 sibling）全成功才 rename（任一步失败原 vault 原封不动·旧 token 存活）。
5. **写 registry entry**（accounts-lib upsertAccount·全非密·整段 load→改→save 在 `mutateRegistry` 锁内做防并发 lost-update）：email→vault 引用 + token_added/refreshed/expires_at（now+365d 长期有效期）+ 非密 subscription_type + identity；录的是当前登录号 → setActive 标 active:true。
6. **录号配额快照**（best-effort·optional）：cc-usage.sh（可移植后台跑 + watchdog 轮询 + 超时 kill·`CC_USAGE_TIMEOUT_S` 默认 60s）取当前号 5h/7d → recordObservedQuota（锁内 RMW·弱信号兜底）。
7. fallback/手动恢复路径：自动提取失败（含身份 guard 失败：当前登录非 `--email` / 读不出登录 email）→ `try_mark_switchable_from_vault` 旁路先探 cc-master vault 是否已有该 email 有效 blob（`probe_vault_has_valid_blob`·token-blind 探「有没有」·不碰官方 keychain·不依赖当前登录·无 mislabel 风险）→ 有则标 switchable:true 闭环 + exit 0；无则按身份 guard 失败处理。

## 输出副作用
- vault：写完整 blob（keychain `-U` 原地更新 / file 删旧行后 append）。
- registry：upsert entry（含 active:true 当前登录号）+ best-effort last_observed_quota。
- stdout 进度，诊断 stderr。**token 绝不进 agent / argv（keychain `-w` argv 除外·决策 A）/ registry。**

## 关键不变式
- **token 永不经过 agent**（HARD）——blob 全程在 `security … | node …` 管道/子进程，绝不 echo/print/log/进 registry。
- **refreshToken 硬要求**：必须取到非空 refreshToken（sk-ant-ort），否则 FAIL、绝不存残缺 blob——无重启换号死依赖它续期。捕获源 = keychain「Claude Code-credentials」，不是 setup-token（结构上不产生 refreshToken）、不是 credentials.json 文件（mac 上 refreshToken 值为空）。
- 身份 guard：录号 X 必须当前正登录在 X。
- registry 只写非密（upsertAccount 自带 token-leak 断言）；keychain 直读不写官方凭证 → 不扰动登录。
- 单行不变式：blob 必须单行（validate_blob 守 oneLine），否则 file vault 取行截断。
- **file vault 全或无 + 跨进程串行化**：写 file vault 经 `with_vault_lock`，取锁失败 fail-closed（拒绝无锁重写·return 1·原 vault 不动），整段「筛-写-rename」全成功才 rename——绝不留下「旧 token 已删、新 token 未写」的空 vault。
- **registry 写并发安全**：所有 registry RMW（write_registry_entry / write_observed_quota）经 `mutateRegistry` 锁内 load→改→save，防并发录号/换号 lost-update。
- **手动恢复旁路无 mislabel**：身份 guard 防的是「从官方 keychain 捕获时把 B 的 blob 错标成 A」；手动恢复路只读 cc-master vault 自身已有的有效 blob、不捕获官方 keychain，故不依赖当前登录、可在登录非目标号时恢复。

## 失败模式
- 身份不匹配 → FAIL + 提示先登录目标号。
- 取不到非空 refreshToken → FAIL + 提示「多半没真 /login」+ 打印手动录入骨架（凭证仍不经 agent），绝不静默存错。
- registry 写失败 → 不回滚 vault（token 已安全入 vault 是主目标），但 surface 用户 + exit 3（非干净 0·提示修好 accounts.json 后重跑补写）。
- file vault 写锁取不到（contention 超时 / node 不可用）→ fail-closed return 1（原 vault 不动），按 vault 写失败处理。
- cc-usage 超时（`CC_USAGE_TIMEOUT_S` 默认 60s·巨 JSONL）→ kill、跳过 last_observed_quota，绝不阻断录号。
