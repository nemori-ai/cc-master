# 机制契约：`skills/account-management/scripts/accounts-lib.js`

> 类别：运行时带外 node 库（NOT a hook·NOT a CLI——被 add/delete/list/switch/select `require()` 或 `node -e` 调用）。源码：`skills/account-management/scripts/accounts-lib.js`。accounts.json 号池 registry 的读/写/校验纯逻辑核心。

## 触发输入
- 被其它 account 脚本 require/调用。输入：registry 对象 / 路径 / 非密 fields（vault 引用 + 时间元 + 配额快照 + identity）。
- 路径：`defaultRegistryPath()` = `${CC_MASTER_HOME:-$HOME/.claude/cc-master}/accounts.json`（用户级）。
- 常量：SCHEMA `cc-master/accounts/v1`、ISO_UTC_RE 严格定宽 ISO、VAULT_KINDS {keychain,file}、TOKEN_LIKE_RE `sk-ant-`、FORBIDDEN_FIELD_RE token/secret/credential/...。

## 业务流（导出 API）
- `loadRegistry(path?)`：读 + 规整；文件不存在 → 空池（天然单账号）；坏 JSON → 抛清晰 error。
- `saveRegistry(reg, path?)`：写前过 `validateRegistry`，有 token-leak/结构硬 error 即**拒写抛错**；原子写（tmp + rename）、0600、刷新 updated_at。
- `validateRegistry(obj)` → `{errors, warnings}`：schema/updated_at/accounts 形态；逐 entry vault 形态 + active boolean + active 唯一性（至多一个 true）+ token 误入断言（scanForTokenLeak 递归扫字符串叶子，identity 子树豁免字段名启发式但保留值扫描）+ 时间戳/subscription_type/identity/switchable/快照形态校验。
- entry 助手（原地改 reg）：`upsertAccount`（插/更，拒 token 字段·含 identity 子树值扫描兜底）、`removeAccount`、`setActive`（指定 true 其余 false，维护唯一性，不在池抛错）、`recordSwitchOut`（写 last_switch_out + append switch_history，JS key fiveHour/sevenDay → 落盘 "5h"/"7d"）、`recordObservedQuota`（写 last_observed_quota，不 append history）。
- **并发串行化锁**（codex round#7 Finding C·防并发 lost-update）：`mutateRegistry(regPath, mutator)`——在**整个 load→改→save 序列**外加一把咨询文件锁，让并发 RMW 串行（每个 mutator 锁内 load 最新态再改再存）；底层 `acquireRegistryLock`/`releaseRegistryLock`（O_EXCL lockfile + owner token + pid 存活性 stale 回收·compare-and-delete 防破到别人新锁·`livePid` 让 bash `$$` 当锁主防一次性 node 退出即被判 stale·Atomics.wait 真睡眠让出 CPU）。
- **通用文件锁**（codex round#9 Finding C·file vault 跨进程串行化）：`acquireFileLock`/`releaseFileLock`（= registry 同一把锁原语·给 bash 锁住 file vault 「读-筛-写-rename」整段·锁文件零 token）。
- `fileVaultLineMatch(email)` → 给 bash file vault 行操作的安全前缀（prefix / tokenLine / expiresLine + **awk index($0,p)==1 行首锚定**守卫；防 email `.`/`@` 元字符；**读 token 行也绝不 grep -F**——子串匹配·非行首锚定·重叠标识下取错行→整行畸形当 token·P2-5）。
- `nowIso()` 严格 ISO（裁到秒）。

## 输出副作用
- 仅读写 accounts.json 这一份非密 registry（原子写 + 0600）。**绝不碰 token、绝不碰 board、绝不 spawn、绝不联网。**

## 关键不变式
- registry 零 token（安全命门 HARD）：validateRegistry 主动断言 sk-ant- 疑似 token 串 = 硬 error；saveRegistry 写前必过校验、有 token-leak 就拒写抛错（永不落盘含 token 的 entry）。
- 与 board 正交（红线 2）——绝不 import/读 board，不碰窄腰。
- `token_expires_at` 语义钉死 = **refresh token 长期有效期**（录号 now+365d），不是 vault blob 里 ~8h 的短期 access expiresAt（误写会让号池瞬间全过期）。
- active 唯一性：至多一个 active:true。
- **registry RMW 并发安全**：所有「读-改-写」registry 的写侧都该经 `mutateRegistry`（锁内 load 最新态）——单纯 tmp+rename 只防单次写撕裂、挡不住跨步 load→改→save 的并发 lost-update。锁文件只含非密 pid/at/owner·绝不碰 token。
- 纯 node stdlib，零第三方依赖（ship-anywhere·红线 5）。

## 失败模式
- 文件不存在 → 空池（不报错，天然单账号·设计稿 §F）。
- 坏 JSON → loadRegistry 抛清晰 error（不静默返垃圾，调用方自决降级单账号还是修）。
- token-leak / 结构硬 error → saveRegistry 拒写抛错（错误信息只列「哪个 account 的哪条规则」，绝不回显字段值）。
- 取锁超时（另有进程长时间持锁）→ acquireRegistryLock/acquireFileLock 抛错（调用方 fail-closed·拒绝无锁重写）；持锁进程异常死亡 → pid 存活性 stale 回收（活持有者绝不因老 mtime 被破锁·compare-and-delete 防破到别人新锁）。
