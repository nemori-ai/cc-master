# 机制契约：`skills/account-management/scripts/switch-account.sh`

> 类别：运行时带外脚本（账号切换 wrapper·NOT a hook·随 skill 分发）。源码：`skills/account-management/scripts/switch-account.sh`。配额逼顶换号的最重 pacing lever。**post-0.8.0 形态：无重启凭证覆写**（不再 exec claude / 不重启进程 / 不 resume 板）。

## 触发输入
- 主线在 pacing 决策点 deliberately 跑（`cost-and-pacing.md` §换号 lever）。用法 `switch-account.sh [--email <email>] [options]`。
- `--email` 缺省 = 自动选号（`select-account.js`）；`--registry` / `--vault-kind` / `--vault-file` / `--keychain-service` / `--no-snapshot` / `--now` / `--dry-run` / `--skip-token-check`；`--board` 已 **deprecated no-op**。
- 读：accounts.json registry（vault 引用 + identity）+ vault（完整 claudeAiOauth blob）+ cc-usage.sh（切出快照配额）。

## 业务流
1. **安全开头**：`set +x` + `unset SHELLOPTS`（堵 xtrace 凭证泄漏）；**云后端自检**（红线 5）任一云开关真 → no-op `exit 0`。
2. **切前选号**（无 `--email` 时）：`node select-account.js`；exit 3（全员逼顶 NONE_ALL_EXHAUSTED）→ surface 用户、不硬切；其它非 0 → 报「无备号可切」保持现状；选号 stderr 警告透传给用户（P2-14）。
3. **从 registry 读选中 email 的 vault 引用 + identity**（全非密，identity 经 node stdout 回 bash）。
4. **vault 读 blob**（keychain `security -w` / file awk index($0,p)==1 行首锚定取 _TOKEN= 行·对 `.`/`@` 元字符免疫）进 `$VAULT_BLOB`，绝不打印。
5. **过全部非变更性 preflight 后才动 registry**（P2-1）：refresh 新号（node https·refreshToken 放 POST body 不进 argv·**REFRESH_TOKEN_URL host 白名单**在构造含 token 的 POST body 之前先校验·只放行 https 的 `*.claude.com`/`*.anthropic.com`/`claude.ai`，或显式 opt-in 的 loopback·否则 exit 6 token 从未上网·`REFRESH_TIMEOUT_MS` 默认 15s 防端点 stall wedge）→ writeback vault 保新鲜（全或无 + `with_vault_lock`·只删 `_TOKEN=` 保 `_EXPIRES=`）→ **取跨进程换号锁**（键在官方 credentials.json 路径·串行化整个「覆写三存储 → setActive」临界段·防并发 switch 交错三存储·fail-closed）→ **覆写官方共享凭证三存储**（① credentials.json `.claudeAiOauth` 经 node stdin；② ~/.claude.json oauthAccount；③ keychain「Claude Code-credentials」/$USER 经 `security -w "$wrapped"` argv·Linux 无 keychain 跳③）·全或无回滚（写①②前 snapshot①②·快照失败 fail-closed 中止；③失败回滚①②含删除换号新建的文件）。
6. **registry 两段解耦**（P2-2·顺序先 setActive 后 snapshot 收 split-brain 窗口）：① setActive 切入号 = 关键状态独立可靠落盘（三存储一覆写成功就立刻翻 active）；② recordSwitchOut 切出号快照 = best-effort 可降级（cc-usage 降级/超时仅少一条快照、绝不连累 active）。setActive 完成即释放换号锁。

## 输出副作用
- vault：refresh 后回写切入号的完整 blob（keychain `-w` argv / file 删 _TOKEN 行后 append、保留 _EXPIRES）。
- 官方三存储：覆写为新号凭证 + 身份（原子写）。
- registry：写切出号 last_switch_out 快照（best-effort）+ 翻 active（切入号 true 其余 false）。
- stdout 留给 dry-run 计划，诊断走 stderr。**token 绝不进 agent context / registry / log。**

## 关键不变式
- **无重启换号**：覆写官方共享凭证存储、运行中 claude 惰性 re-read 接管新号——进程不重启、board 不动、session 不换、`--resume` 不触发。
- token no-leak（HARD）：blob 绝不 echo/print/log/进 registry；refresh token 放 POST body、覆写文件经 stdin、keychain 写经 argv（决策 A 接受的 sub-second 本机局部暴露）。
- **refresh 端点 host 白名单（反 exfiltration·HARD）**：在构造含 refresh token 的 POST body 之前先校验 `REFRESH_TOKEN_URL` host——只放行 https 的授权 Claude/Anthropic 主机（或显式 opt-in `CCM_ALLOW_LOOPBACK_REFRESH=1` 的 loopback 测试端点），其它一律拒绝退出、token 从未进 body / 从未上网（防被污染 env / 误抄测试值把 token 发到攻击者端）。
- 先过全部非变更性 preflight（选号 + 读 token）才动 registry（P2-1：绝不在 token 失败路径上翻 active）。
- snapshot 与 setActive 解耦（P2-2：快照校验失败不连累 active）；先 setActive 后 snapshot（收 split-brain 窗口）。
- **跨进程换号锁**：整个「覆写三存储 → setActive」临界段在一把换号级锁内（键在官方 credentials.json 路径）·同一时刻只一个 switch 跑这段——消除并发 switch 交错三存储的 split-brain；取锁失败 fail-closed（拒绝无锁覆写官方存储·未换号）。
- **全或无 + 中断两阶段恢复**：写①②前先 snapshot①②（快照失败 fail-closed 中止·绝不进会 split-brain 的覆写）；EXIT/INT/TERM trap 按提交阶段双向恢复——**阶段 A**（存储未提交·`OVERWRITE_IN_PROGRESS`）中断 → **回滚①②到旧号**；**阶段 B**（①② 已提交·`STORES_COMMITTED`）中断 → **前向对齐**（补写 keychain③ idempotent `-U` + setActive 让 registry 追上存储·不回滚已提交的①·消除 keychain-lag split-brain）。
- 与 board 正交（红线 2），绝不进 hooks/（红线 1/5）。

## 失败模式
- 全员逼顶（select exit 3）→ surface 用户、未切（对齐 7d 总闸纪律）。
- refresh 端点 host 非白名单（exit 6）→ 硬失败、token 未上网、绝不 force-refresh（force-refresh 会用同一坏 URL）。
- 主动 refresh 网络不通 / 端点 stall 超时（rc=5）→ 退化 force-refresh 兜底（覆写原 blob + expiresAt 临近过期逼 claude 自 refresh·有 vault-stale 风险）；refresh token 失效（rc=4）/ 缺 refresh token（rc=3）→ 硬失败（force-refresh 无意义）。
- refresh token **已轮转** + vault 回写失败 → 硬失败（未覆写任何存储）+ 把轮转后唯一副本 NEW_BLOB 抢救到 0600 recovery 文件（绝不丢该 token·brick）；未轮转 + 回写失败 → 非致命（旧 refresh token 仍有效·三存储仍覆写、换号继续）。
- 换号锁取不到（另有 switch 在跑 / node 不可用）→ fail-closed exit 1（拒绝无锁覆写官方存储·registry 原封不动）。
- ① credentials.json 写失败 → 致命退出、registry 不翻 active；② 身份写失败（identity 切换路·exit 2）→ 回滚①到旧号（避免 split-identity）；③ keychain 失败 → 回滚①②到旧号（全或无），换号未发生可重试；snapshot 缺失无法回滚 → 标 split-brain 风险、surface 需手动对账。
- setActive 落盘失败 / 切入号不在 registry（exit 5）→ 换号已生效但 registry active 未对齐 → 置 `ACTIVE_WRITE_FAILED`、最终消息如实标注「需手动对账」+ exit 4（不谎报干净成功）。
- 中断（INT/TERM）→ trap 按阶段双向恢复：存储未提交回滚①②、①②已提交前向对齐（补 keychain③ + setActive）。
- cc-usage 超时（`CC_USAGE_TIMEOUT_S` 默认 60s·巨 JSONL）→ kill、切出快照配额字段留空、active 已先翻不受影响。
