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
quarantine/
locks/
  activation.lock
```

公共合同**不使用 symlink**。activation/event publish 是在同目录写临时文件并 flush 后，以 hard-link
no-replace 把 inode 发布到唯一最终名，再删除临时目录项；`EEXIST` 只能拒绝、不能覆盖。image publish
先用 exclusive `mkdir` claim 内容寻址目录，逐个 hard-link 已 sealed 文件，最后发布 `READY`；没有
`READY` 的 partial/crash image 永远不可解析。selector 取序号最大的 activation commit；
若最新 commit 损坏则 fail closed，不静默回落旧 commit。

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
| Darwin POSIX | supported-by-scope；资格仍由真机 gate 决定 | uid/mode/no-symlink、O_NOFOLLOW/fstat、hard-link no-replace、build-attested `darwin-path-attested-v1` launcher、final vnode identity/revision + SHA-256 recheck、无 `fexecve`/`execveat`/fd pseudo-path；darwin-arm64/x64 各跑 downloaded SEA 的 stage→activate→resolve→invoke、pre-final-check mutation denial、strict exact-object typed denial，并把 same-UID final-check→exec race记录为 residual 而非伪造 resistant green |
| Windows | public seam + independent contract fixture；default fail-closed | 公共状态模型无 symlink/admin 假设；真实 ACL/Authenticode、locked SEA/fd-equivalent 与 durable publish e2e 未过前 activation 返回 `RUNTIME_BACKEND` |

Windows 是待实现 backend，不是公共模型中的永久 unsupported。后续 platform hardening 只替换 backend，
不得改变 image/provenance/transaction/activation commit/selector 合同。

## 7. Rollback / kill 与非目标

- 全局 kill：`CCM_RUNTIME_ACTIVATION_DISABLE=1`，阻止新 activation/rollback/recover，不杀 active run。
- bad staged image activation=0；历史 transaction、activation commit 与 home data 保留审计。`quarantine/`
  目录在 C1 只保留合同位置，自动 quarantine/lease-aware GC 留给 platform hardening，不虚报已实现。
- 本 slice 不接管 `ccm upgrade` downloader，也不把当前 in-place SEA 静默迁入 store；doctor 只给 dry-run
  计划，用户/后续 upgrader 必须显式 stage official provenance。
- 本 slice 不做 lease-aware GC、uninstall、force、supervisor attach；没有 active-run lease 前不删除任何 image。
