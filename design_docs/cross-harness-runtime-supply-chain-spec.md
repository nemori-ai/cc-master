# Cross-harness runtime supply-chain contract

> 状态：C1 implementation contract；2026-07-10 批准方向下的最小 slice
> 覆盖：runtime image 的 stage、verify、activate、resolve/invoke、doctor/recover、rollback
> 不覆盖：provider driver、run supervisor、active-run lease/GC、release downloader、真实 Windows SEA 验收

## 1. 目标与不变式

本合同给后续 per-run supervisor 一条稳定的 runtime image supply chain。它不引入中央 daemon，
也不改变 board、provider credential、Codex/Cursor account 或 `$CC_MASTER_HOME` 中的用户数据。

承重不变式：

1. image 以 SHA-256 内容寻址，进入 image store 后不可原地覆盖；
2. 未通过 provenance、hash、owner/security、permission、path-containment 和 regular-file
   校验的 artifact 永远不能进入 activation commit；
3. `current` 与 `previous` 是**一个 activation commit 内的原子状态对**，不是两个可分别 torn-write
   的 mutable pointer；
4. selector 返回 exact image path + expected hash + platform invoke assurance；invoke 在启动前重新验证；
5. activation/rollback 只影响后续 selector。已解析或已启动的旧 image 不 hot-reload、不被普通
   activation/rollback 杀死；
6. transaction journal 和 activation commits append-only。crash 后以已发布 commit 为事实，
   doctor 只补 recovery event，不倒猜或覆盖历史；
7. runtime activation 不删除 `$CC_MASTER_HOME`、boards、runs、services 或未知 sibling data；
8. `CCM_RUNTIME_ACTIVATION_DISABLE=1` 时仍可 stage/doctor-read 以准备或审计 artifact，但
   activate/rollback/doctor-repair 写入拒绝。

## 2. Platform-neutral layout

默认 root 为 `<CC_MASTER_HOME>/runtimes/ccm/v1`：

```text
images/<sha256>/
  ccm                         # exact immutable executable image
  manifest.json               # runtime identity + expected hash + provenance digest
  provenance.json             # normalized verified release provenance
  READY                       # exclusive claim 填充完成后最后发布；缺失即不可解析
transactions/<transaction-id>/
  0001-staged.json
  0002-prepared.json
  0003-activated.json         # crash 后也可能由 recovered/aborted 事件收口
activations/
  00000000000000000001-<transaction-id>.json
launcher/
  README.json                 # stable-selector contract marker；不是 mutable current pointer
  linux-exact-fd-v1-<sha256>  # Linux build-attested exact-fd launcher
  darwin-path-attested-v1-<sha256> # Darwin build-attested final-attestation launcher
materializers/                # owner-only native bootstrap lifecycle root；正常稳态为空
quarantine/
locks/
  activation.lock
```

公共合同**不使用 symlink**。activation/event publish 是在同目录写临时文件并 flush 后，以 hard-link
no-replace 把 inode 发布到唯一最终名，再删除临时目录项；`EEXIST` 只能拒绝、不能覆盖。image publish
先用 exclusive `mkdir` claim 内容寻址目录，逐个 hard-link 已 sealed 文件，最后发布 `READY`；没有
`READY` 的 partial/crash image 永远不可解析。selector 取序号最大的 activation commit；
若最新 commit 损坏则 fail closed，不静默回落旧 commit。

`launcher/` 的稳定 POSIX 不变式是 **effective-UID owner + mode `0700`**；它不是在“可写
`0700`”和“只读 `0500`”之间切换的临界区。每次 native invoke 都通过 pinned directory fd
重验 owner/type/no-symlink，并把合法但只读的旧 `0500` 状态恢复为 `0700` 后再物化 helper。
因此并发 first invoke 不会互相撤掉写权限，SIGKILL 也不会留下一个需要依赖前任进程 finally
才能恢复的目录状态。

helper 的 `<contract>-<sha256>` 最终 pathname 是唯一 publication authority。publisher 先固定并验证
`launcher/` 目录对象；之后的 abandoned-temp 枚举/回收、final observation、owner-only unique temp
创建、final publish、post-publish verify 与 durability barrier 必须全部通过该 pinned directory object
上的相对 leaf name 完成。实现必须使用 dirfd-relative syscall（`openat` / `fstatat` / `linkat` /
`unlinkat` 或等强平台原语）；不得调用 process-global `chdir` / `fchdir`，不得依赖 `/dev/fd`、
`/proc/self/fd` 或其他 fd pseudo-path，也不得在已 pin 后退回 `launcher/` pathname 执行其中任何一步。
若 Node 标准库不能表达这些原语，必须把整条 publication authority chain 放进隔离的 native subprocess，
只向它继承已经 pin 的 directory fd；subprocess bootstrap pathname 不参与 publication 证明，主进程 cwd
始终不变。任何实现都不得把新 pathname 中的 publication 与旧 directory fd 的 `fsync` 混成一份证明。

native materializer bootstrap 的 crash ownership 是独立于 JavaScript `finally` 的承重合同：

- bootstrap 只能落在 runtime root 内的 `materializers/`，不得再落 system temp。该 root 必须是
  effective-UID owner、non-symlink directory、精确 `0700`，并在创建 instance 前以 no-follow open 固定；
- 每次 cold invoke/materialization 只创建一个 `.materializer-<contract>-<publisher-pid>-<uuid>.tmp/` owner instance。
  instance 必须是 effective-UID owner、non-symlink directory、精确 `0700`；唯一合法 payload leaf 为
  `materializer`，写入态精确 `0600`、seal 后精确 `0500`。root/instance directory 的 pathname observation
  必须与各自 inherited fd 的稳定 object identity/policy（device/inode/owner/type/精确 mode；平台提供时含
  object generation）对齐；它们的目录内容会被合法的并发 create/unlink 改变，因此 directory size/mtime/ctime
  不属于 object identity、不得作为 pathname replacement 的判据。bootstrap regular file 的 pathname
  observation 则必须与 inherited fd 的 immutable file revision（object identity/policy + size/mtime/ctime）对齐；
- native child 一进入 materializer mode、在 launcher temp cleanup/publication 之前，就须只经 inherited
  root/instance fd 对自己的 `materializer` leaf 执行 no-follow identity check、`unlinkat`、instance
  `AT_REMOVEDIR` 与 root durability barrier。真实 Node parent 即使此刻被 `SIGKILL`，child 仍能完成
  self-clean；parent graceful cleanup 只能是 best-effort，不得作为 crash-safety 证明；
- 若 parent 在 native spawn/self-clean 前死亡，后续 invoke/materialization 必须在同一 pinned `materializers/` root
  枚举 exact contract/PID/UUID instance，先证明 publisher PID 为 dead（`ESRCH`；`EPERM` 仍视为
  live/unknown），再 object-relative 回收。只允许空 instance，或只含一个 owner-matching regular
  `materializer`（mode `0600`/`0500`）；symlink、非 directory/regular、wrong owner/mode、未知 leaf、
  permission/I/O anomaly 一律保留并 fail closed；
- 两个 recovery worker 可同时 snapshot 同一个已证 dead candidate。只有该 exact candidate 在证明后的
  `fstatat` / `openat` / `unlinkat` / `AT_REMOVEDIR` 并发消失所产生的 `ENOENT` 可视为幂等成功；
  该豁免不得扩到未匹配名称、live/unknown publisher 或其他 errno。live publisher 的 instance 不得回收；
- 正常返回、并发 cold activation、parent 在 bootstrap create / native self-clean / helper publish 前后任意点
  被 `SIGKILL`，最终都只能留下空的 managed root，不能留下可执行 bootstrap 或 owner instance。
  bootstrap GC 不得删除 launcher final、launcher temp、unknown sibling 或 runtime root 之外的任何对象。

因此 crash recovery 有两层：native self-clean 收口“child 已启动、parent 消失”的窗口；下一次 invoke/materialization
的 dead-owner GC 收口“parent 在 spawn/self-clean 前消失”的窗口。两层都必须存在，删除任一层都应由
regression/mutation instrument 检出；测试自己的 attributable cleanup 只能发生在 leak 断言之后。

publisher 写完 temp 后 file-fsync、seal 为 `0500`，再以同目录 hard-link no-replace 发布；`link(2)`
成功是 publication linearization point，`EEXIST` 只转入对既有 final 的独立验证，绝不 rename/copy
覆盖。无论 final 是本次发布还是前任在 crash-before-directory-fsync 后留下的合法 publication，返回前
都必须从同一 pinned directory object 对 final 重新执行 no-symlink/owner/mode/size/digest 验证，并对
该目录对象执行 durability barrier。Darwin 明确只容忍 directory fd 对 `fsync` 返回
`EINVAL`/`ENOTSUP` 的平台不支持结果，其他 I/O 错误继续向调用方传播。若外部 `launcher/`
pathname 在 pin 后改指另一目录，materialization 仍不得逃离 pinned object，且在把 pathname 交给既有
launcher spawn 边界前必须因 identity drift fail closed。

并发 publisher 即使都观察到 final 缺失，也只能把**同一已验证 digest bytes**原子发布到同一 digest
name，reader 不会观察 partial final。SIGKILL 留下的 unique temp 不具备 authority；后续 invoke 只回收
pid 已证 dead、名称/owner/type 都符合本合同的 abandoned temp，再继续发布。错误不吞掉；final 已存在
但校验失败时保留原 entry 并 fail closed，不以“修复”为名覆盖未知内容。cleanup 可把已经通过候选名称
语法与 dead-pid 证明、随后在 `fstatat` 或 `unlinkat` 并发消失产生的 `ENOENT` 视为幂等成功；该豁免不
扩展到其他名称、错误码或 surviving entry，symlink/type/owner/permission/I/O 异常仍须 fail closed。

每个 activation commit 同时持有：

```json
{
  "schema": "ccm/runtime-activation/v1",
  "sequence": 1,
  "transaction_id": "tx_...",
  "current": { "sha256": "...", "image": "images/<sha256>/ccm" },
  "previous": null,
  "operation": "activate",
  "created_at": "..."
}
```

rollback 不是回写旧 commit，而是追加新 commit，把旧 commit 的 `previous` 作为新 `current`，
旧 `current` 作为新 `previous`。因此 current/previous 的切换只有一个 publish linearization point。

## 3. Runtime identity 与 provenance

首版只接受 ccm 官方 release provenance：

```json
{
  "schema": "ccm/runtime-provenance/v1",
  "repository": "nemori-ai/cc-master",
  "tag": "ccm-v0.21.0",
  "asset": "ccm-linux-x64",
  "sha256": "<64 lower-case hex>"
}
```

- repository 必须精确匹配；tag 必须匹配 `ccm-v<semver>`；asset 必须匹配当前 backend 声明的
  platform/arch；manifest identity 为 `tag + asset + sha256`，requested 与 resolved 不静默替换。
- artifact 和 provenance input 都必须是 non-symlink regular file。
- input 以 `O_NOFOLLOW` 打开并固定 fd；copy/hash 从该 fd 读取，前后 `fstat` identity/size/time 必须
  稳定。pathname swap 或读取中变更 fail closed。managed image 的每个 path component 都必须留在
  owner-only runtime root 且非 symlink。
- Linux invoke 把重验后的 image fd 交给随 SEA 构建并由 digest 固定的 `linux-exact-fd-v1`
  launcher，由 launcher 直接 `fexecve` 该 fd。实现不得把 `/dev/fd`、`/proc/self/fd` 或重验后的
  pathname 当 executable path，也不得在 verify→exec 间重新信任 image pathname。
- 两个平台当前都由 Node `spawn` 通过 digest-pinned **launcher pathname** 进入 native helper；隔离的
  materializer subprocess bootstrap 也只能经 runtime-root 内、已重验并与 inherited fd identity 对齐的
  owner-only sealed pathname 启动。helper
  自身虽在 spawn 前重验 owner/mode/digest，kernel 仍会在用户态校验后重新解析 pathname。因此一个
  持续竞争的 same-UID process 仍能制造 launcher-check→launcher-exec residual。Linux
  `exact-fd-v1/resistant` 描述的是 helper 内对 **payload image fd** 的绑定，不把 launcher-by-path
  边界伪装成抵抗 same-UID 替换；`--require-assurance exact-object` 也不升级该 launcher 边界。
- Darwin 没有公开 `fexecve` / `execveat`。Darwin invoke 使用独立的
  `darwin-path-attested-v1` launcher：在最后一个同步 native handoff 内以 `O_NOFOLLOW` 重新打开
  content-addressed image pathname，把 pathname fd 与先前 pinned fd 的 vnode identity/revision 对齐，
  从 pathname fd 重新计算并比对 SHA-256，再次复核 pathname/fd revision，随后立即以 pathname
  `execve`，不经 shell 或 PATH lookup。所有在最后复核完成前被观察到的替换/改写均 fail closed。
  kernel 在最终用户态检查后仍会重新解析 pathname，因此该合同**不能**声称抵抗一个持续竞争的
  same-UID process；owner-only mode 与 content-addressed name 都不消除这项 residual。
- resolve 每次同时重验 executable hash、READY、manifest、normalized provenance digest 与
  repository/tag/asset/hash identity；相同 bytes 被不同 tag/asset 重新声明也拒绝复用。
- POSIX backend 要求文件 owner 等于 effective uid、owner-executable、group/other 不可写。
- Windows backend 不依赖 symlink 或管理员权限。公共 backend seam 必须提供 regular-file/path containment、
  Authenticode/ACL（或等强 attestation）和 unique-name durable publish；真实 backend gate 未过前拒绝
  activation，不能把 mode bits 当 Windows ACL。

## 4. Transaction state machine

```text
artifact + provenance
  -> verify source
  -> copy into root-local staging + fsync
  -> verify copied bytes/security/containment
  -> publish immutable image
  -> append staged
  -> activation lock
     -> reverify staged event + exact image
     -> append prepared(current_before, target)
     -> publish activation commit       # linearization point
     -> append activated
```

- 正常 `staged` 是可继续 activation 的非终态，doctor 不把它当 incomplete、也绝不自动 abort。
- crash after `prepared`、before activation commit：current 不变；doctor 报 incomplete transaction，
  repair 在 activation lock 内追加 `aborted`；aborted transaction 永远不能再 activate。
- crash after activation commit、before activated event：new current 已生效；doctor 以 commit 反查
  transaction，repair 追加 `recovered`，绝不反切 current。
- activation concurrency：同一 runtime root 的 activation/rollback/recover 由 exclusive lock 串行；doctor
  repair 只有在原 lock owner 已证 dead 后才能回收 stale lock并重新拿锁。commit sequence 在锁内分配，
  最终 publish 是 hard-link no-replace，不允许覆盖；terminal 重试幂等返回同一 commit。
- cross-volume：staging、commit temp 与 final 必须在各自 final directory 内。backend 返回 `EXDEV` 或不能
  证明同卷 atomic publish时，本次操作失败且 activation commit 数不增加。

## 5. CLI contract

所有 JSON 输出沿用 `{ok:true,data}`；校验拒绝用 exit 3，锁冲突用 exit 4，缺 current/transaction
用 exit 5，非预期 IO 用 exit 1。

```text
ccm runtime stage <artifact> --provenance <file> [--json]
ccm runtime activate <transaction-id> [--json]
ccm runtime resolve [--json]
ccm runtime invoke [--require-assurance exact-object] -- <runtime-argv...>
ccm runtime doctor [--installed-path <legacy-in-place-binary>] [--repair] [--json]
ccm runtime rollback [--json]
```

- `stage` 不 activation；返回 transaction、exact image、hash 和 normalized provenance。
- `activate` 在锁内全量重验，成功后返回 current/previous 和 commit ref。
- `resolve` 是只读 stable selector；无 current 或最新 commit/image 不合法时 fail closed。返回值显式
  带 `invoke_assurance`：Linux=`exact-fd-v1/resistant`；Darwin=`path-attested-v1/residual`；
  publisher identity 仍只承诺 `local-sha256-provenance`，不把 ad-hoc code signing 冒充 Developer ID。
- `invoke` 先 resolve/reverify并保持 image fd 打开，再由 platform backend 启动经过自身
  SHA-256/owner/mode/no-symlink 重验的 launcher。默认接受该平台诚实声明的 guarantee；调用者可用
  `--require-assurance exact-object` 要求 exact-object。Linux `exact-fd-v1` 满足；Darwin
  `path-attested-v1` 必须在创建 child 前以 typed `RUNTIME_INVOKE_ASSURANCE` fail closed，绝不静默降级。
  launcher/backend 在 payload 执行前失败时经 close-on-exec control fd 返回结构化
  `RUNTIME_INVOKE_*`；成功后 handler 只透传真实 payload 的 exit code。
- `doctor` 可重复、默认只读。`--installed-path` 解释现有 in-place layout 的迁移计划，不移动原文件；
  `--repair` 只追加 recovery/aborted event和回收已证 dead 的 stale installer lock。
- `rollback` 要求 previous 存在并重验，追加 operation=`rollback` 的 activation commit。
- 全局 `--dry-run` 可用于只读 `doctor [--installed-path ...]` 且不会初始化 runtime layout；对
  `stage` / `activate` / `invoke` / `rollback` / `doctor --repair` 显式返回 usage error，不得接受后静默执行写操作。

## 6. Platform backend seam 与首版支持矩阵

backend 合同：

```text
id/platform/arch
invokeAssurance # object_binding / publisher_identity / active_same_uid_replacement / platform
ensurePrivateDirectory(path)
verifyOpenFile(path, fd, fstat, purpose)
verifyManagedDirectory(path, lstat)
sealFile（platform-native executable/metadata security）
publishUniqueFile(tempPath, finalPath) # hard-link no-replace；不能 exists+rename
publishImage(stagingDir, finalDir)     # exclusive claim + READY-last
spawnVerifiedImage(path, fd, argv, env, {root, resolution})
flushDirectory(path)
inspectLockOwner(record)
```

| Backend | C1 状态 | 证据门 |
| --- | --- | --- |
| Linux POSIX | supported | uid/mode/no-symlink、O_NOFOLLOW/fstat、hard-link no-replace、build-attested `linux-exact-fd-v1` launcher + `fexecve`、无 `/dev/fd` 假设、active pathname-swap fixture 仍执行 pinned trusted image |
| Darwin POSIX | historical baseline qualified；当前 runtime-affecting tree 未资格化 | uid/mode/no-symlink、O_NOFOLLOW/fstat、hard-link no-replace、build-attested `darwin-path-attested-v1` launcher、final vnode identity/revision + SHA-256 recheck、无 `fexecve`/`execveat`/fd pseudo-path；每个 runtime-affecting PR 的 exact head 须由 darwin-arm64/x64 各跑 downloaded SEA 的 stage→activate→resolve→invoke、launcher materialization race/recovery、pre-final-check mutation denial、strict exact-object typed denial，并把 same-UID final-check→exec race记录为 residual 而非伪造 resistant green |
| Windows | public seam + independent contract fixture；default fail-closed | 公共状态模型无 symlink/admin 假设；真实 ACL/Authenticode、locked SEA/fd-equivalent 与 durable publish e2e 未过前 activation 返回 `RUNTIME_BACKEND` |

Darwin 历史资格快照（2026-07-14 UTC）：tree `1e8f49e29b3c87eea37ac5dc5588f58e3f1a3b24`
在 [Actions run `29309116222`](https://github.com/nemori-ai/cc-master/actions/runs/29309116222)
中由真实 `darwin-arm64` / `darwin-x64` runner 完成，两个 inner manifest 与 outer
`EVIDENCE_SHA256SUMS` 均可完整复验，所有 required gates 为 PASS。该支持声明不扩大 invoke assurance：
same-UID final-check→exec race 仍明确为 residual；Gatekeeper/notarization 仍为 conditional，真实 Cursor Agent
endpoint 仍为 conditional，不能借 runtime/plugin/installer/service 资格结果推导为已验收。该快照只证明
其记录的 exact tree；任何后续 runtime-affecting tree 在新的 arm64/x64 inner manifests 与 outer index
同时记录并校验相同 exact commit + tree 前均保持未资格化，旧 run 不得作为新 tree 的通过证据。
outer index verifier 必须从 workflow event 注入的 immutable expected commit 与已经 inner-manifest
封闭的 `summary.txt` / `sea-build-evidence/runner.txt` identity records 完成该校验：两份 record 各自只允许
一个 40-hex commit/tree，commit 必须等于 event expected commit，tree 必须在同一 artifact 内及 arm64/x64
之间完全一致。build / qualify producer 仍须从各自 exact checkout 生成并互验 identity；outer index
不得重新依赖 ambient Git repository 推导 expected identity，否则无 Git 的 hermetic replay 无法验证这条合同。

Windows 是待实现 backend，不是公共模型中的永久 unsupported。后续 platform hardening 只替换 backend，
不得改变 image/provenance/transaction/activation commit/selector 合同。

## 7. Rollback / kill 与非目标

- 全局 kill：`CCM_RUNTIME_ACTIVATION_DISABLE=1`，阻止新 activation/rollback/recover，不杀 active run。
- bad staged image activation=0；历史 transaction、activation commit 与 home data 保留审计。`quarantine/`
  目录在 C1 只保留合同位置，自动 quarantine/lease-aware GC 留给 platform hardening，不虚报已实现。
- 本 slice 不接管 `ccm upgrade` downloader，也不把当前 in-place SEA 静默迁入 store；doctor 只给 dry-run
  计划，用户/后续 upgrader 必须显式 stage official provenance。
- 本 slice 不做 lease-aware GC、uninstall、force、supervisor attach；没有 active-run lease 前不删除任何 image。
