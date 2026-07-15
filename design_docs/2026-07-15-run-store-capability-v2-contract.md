# RunStoreCapability v2 contract

Status: frozen implementation-before contract and counterexample oracle. No production consumer exists at this revision.

Scope: the existing Node SEA supervisor run store on Linux and macOS. The capability is bound to the detached child's
attested current-working-directory object. It is not a generic filesystem, a provider/account authority, a board completion
authority, a daemon contract, or a Windows admission.

## 1. Consumer inventory is the vocabulary boundary

Inventory source: `ccm/apps/cli/src/supervisor.ts` on the last bounded supervisor GREEN candidate
`cc8fab2e5bcb0ae12c366c1d1724ec2f4539554b`. Every public operation below has a concrete call site in that candidate.
Anything without a consumer is omitted.

| Operation | Existing consumer | Required domain behavior |
| --- | --- | --- |
| `read-file` | `requestFor`, `helloFor`, `journalFor`, `readIdempotencyClaim`, `reconcile`, `supervise`, `inspectActiveRunCompatibility` | bounded regular-file read with explicit missing |
| `list-directory` | `supervise` control-inbox loop and `inspectActiveRunCompatibility` idempotency/by-run scans | bounded, non-recursive, deterministic entries |
| `create-file-no-replace` | `launch`, `publishClaimNoReplace`, `cancel`, and immutable publications in `supervise` | atomic no-replace publication |
| `replace-file-cas` | `attach` manager lease and `supervise.writeLease` heartbeat | revision-checked atomic replacement |
| `append-ccmj-frame-cas` | `appendJournal` | bounded, framed, revision-and-length checked append |

There is no public `rename`, `remove`, `mkdir`, `sync`, `stat`, `exists`, `open`, `copy`, `truncate`, `watch`, link or
symlink operation. Current `rename` and `remove` calls only implement same-directory atomic publication and private temporary
cleanup. File and directory sync calls only complete those mutations. They remain mandatory internal commit semantics and are
observable in the mutation receipt; exposing them independently would create filesystem authority without a consumer.

## 2. Prior art: reuse, adapt, build

| Prior art | Decision | Reason |
| --- | --- | --- |
| Node `fs` | reuse beneath the fixture and future implementation | The existing SEA already ships Node; `O_NOFOLLOW`, exclusive create, rename, link, file sync and directory sync are the actual host primitives. |
| Existing ccm supervisor store | adapt | Its request/journal/lease/attach/cancel/reconcile paths provide the consumer inventory and domain names. |
| Existing cwd-authority V1 oracle | adapt | Reuse canonical envelope, exact-shape capability, relative segments, spawn-cwd identity and no-bypass trace; reject V1 as underpowered rather than widen it. |
| Effect Platform FileSystem | learn only | Typed effects/errors and service injection are useful interface ideas, but its broad filesystem vocabulary and runtime dependency exceed this contract. |
| Endo capability discipline | learn only | Closed powers and no ambient locator support the authority boundary; no Endo runtime is required. |
| memfs | reject for constraint evidence | It mirrors broad Node/browser filesystem APIs, while this oracle must exercise real symlink, no-replace, rename and sync constraints on the host filesystem. |

Primary sources: [Node filesystem](https://nodejs.org/api/fs.html),
[Effect platform](https://github.com/Effect-TS/effect/tree/main/packages/platform),
[Endo](https://github.com/endojs/endo), and [memfs](https://github.com/streamich/memfs).

## 3. Authority and exact capability

The canonical authority envelope retains `spawn-cwd-attested-v1`, the physical root identity, and
`kernel-cwd-object-v1`. Its digest includes one exact grant:

```ts
type RunStoreGrantV2 =
  | { phase: "claim-transaction"; run_id: string; attempt_id: string; idempotency_digest: `sha256:${string}` }
  | { phase: "supervisor-runtime"; run_id: string; attempt_id: string; supervisor_instance_id: string }
  | { phase: "manager-control"; run_id: string; manager_id: string }
  | { phase: "inventory-audit" };
```

Identifiers match `[A-Za-z0-9][A-Za-z0-9._-]{0,127}`. The idempotency digest is lowercase SHA-256. The issuer must not
grant two live writers for the same mutable target; filesystem conflict handling is not a substitute for authority issuance.

The consumer returns exactly:

```ts
type RunStoreCapabilityV2 = {
  schema: "ccm/run-store-capability/v2";
  authority_id: `sha256:${string}`;
  assurance: "kernel-cwd-object-v1";
  phase: RunStoreGrantV2["phase"];
  execute(operation: RunStoreOperationV2): Promise<RunStoreExecutionV2> | RunStoreExecutionV2;
};
```

Its own string keys are exactly `assurance, authority_id, execute, phase, schema`; symbol keys and path/root/locator/fd
handles are forbidden. `execute` is the only run-store I/O seam. After binding, the consumer must not call `chdir`, recover
the store from a pathname, or reread home/locator environment variables.

## 4. Relative grammar and containment

Every operation carries `segments`, not a pathname:

- 1-8 segments, at most 1024 total UTF-8 bytes;
- every segment matches `[A-Za-z0-9][A-Za-z0-9._-]{0,127}`;
- absolute paths, empty/`.`/`..`, slash, backslash, NUL, drive/UNC forms and caller-chosen hidden temporary names fail;
- each existing component is checked without following symlinks; expected file/directory types are enforced;
- mutation temporaries are capability-generated inside the already validated parent.

Node does not expose a general `openat`-style directory-handle API. Static symlink escapes, pathname rename-and-decoy,
absolute paths and parent traversal must fail; an active same-UID component-swap race remains an explicit platform residual.

## 5. Closed operations

All variants include exact `schema: "ccm/run-store-operation/v2"`, `operation_id`, `phase`, `kind`, and `segments`.
Unknown kinds or keys fail before I/O.

### `read-file`

Adds `max_bytes` (safe integer 1..67,108,864). It reads one regular file. Missing is an explicit result; oversize fails
without truncation.

### `list-directory`

Adds `max_entries` (1..4096) and `max_name_bytes` (1..255). It lists direct children only, sorted by UTF-8 bytes. A symlink
entry, oversize name or entry-count overflow fails; results are never truncated.

### `create-file-no-replace`

Adds canonical `bytes_base64` (decoded maximum 16 MiB), `directory_mode: "0700"`, `file_mode: "0600"`, and
`durability: "file-and-directory-synced-v1"`. The final target appears atomically or not at all and is never replaced.

### `replace-file-cas`

Adds `expected_revision: "absent" | sha256`, canonical bounded bytes, modes, and durability. Revision is the digest of the
complete current bytes. A stale expected revision has effect `none`; an exact desired revision is an `already-committed`
replay; otherwise a same-directory temporary is synced, renamed, and the containing directory synced.

### `append-ccmj-frame-cas`

Adds expected revision and byte length, one canonical-base64 CCMJ frame, `max_file_bytes` (1..67,108,864), modes and
durability. A frame is exactly `CCMJ/1 <8hex length> <64hex payload sha256>\n<payload>\n`, with payload at most 1 MiB.
The before revision and length must both match. A torn tail or stale prefix fails. Publication is atomic; no partial frame can
receive a committed receipt.

## 6. Phase and path allowlists

The grant binds path placeholders; callers do not choose another run, manager, attempt, or idempotency identity.

| Phase | Actual consumers and permitted families |
| --- | --- |
| `claim-transaction` | read the bound idempotency claim and bound run launch/hello records; create bound request, prepared/claimed claim records and launch receipt/failure |
| `supervisor-runtime` | read bound request/launch/hello/lease/journal/control; list exact control inbox; create immutable hello/confirmation/outbox/result; CAS exact supervisor lease; append exact journal |
| `manager-control` | read bound request/hello/lease/journal/control; create exact command inbox; CAS the exact bound manager lease |
| `inventory-audit` | list `idempotency` and `by-run`, then read selected claims/run metadata; no mutation |

Cross-run or cross-manager paths, audit writes, append outside supervisor runtime, or any unlisted family fail with effect
`none`.

## 7. Results, receipts, and typed failure

`operation_digest` is SHA-256 over canonical JSON of the exact operation.

Read results bind authority, operation id/digest, found/missing outcome, canonical base64 bytes, length and content revision.
Missing is exactly null bytes, zero length and null digests.

List results bind authority, operation id/digest, found/missing outcome, exact sorted entries, count and entries digest.

Mutation receipts bind authority, operation id/digest/kind, committed or already-committed outcome, before and after revision,
final byte length, and exact durability proof:

```ts
{
  schema: "ccm/run-store-durability-proof/v1";
  file: "synced";
  directory: "synced";
}
```

A committed receipt is returned only after final bytes match the after revision and both file and containing directory are
synced. Newly created ancestor directories are mode 0700 and their publication is synced before success. Files are mode 0600.
The executable oracle independently observes at least one successful write, regular-file sync and directory sync for every
`committed` mutation, then rereads the pinned cwd target and checks mode, complete bytes, revision and length. An
`already-committed` replay need not issue another write or sync. These observations are oracle instrumentation, not extra
public filesystem operations or receipt fields.

Receipt validation binds no-replace creation to `before_revision: "absent"`; committed replacement to the requested expected
revision; already-committed replacement to the desired revision; and append to the expected prefix revision, complete frame
length and independently observed final bytes. Fixed `"synced"` strings without the corresponding observed calls cannot
satisfy the oracle.

Cross-process errors use an exact `ccm/run-store-error/v2` envelope with code, authority/operation identity,
`effect: "none" | "unknown"`, `retry: "safe-same-operation" | "reconcile-first" | "never"`, and message. Any failure after
target publication or append starts is `unknown/reconcile-first`; it is never silently relabeled safe.
Once authority and an operation id are available, the adapter binds both into every error. An unclassified read/list error is
non-mutating; an unclassified mutation error is conservatively `unknown/reconcile-first`. Explicit pre-effect conflicts may
remain `none/never`.

## 8. Counterexample-first promotion contract

The executable oracle must establish all of these before production work starts:

1. a known-good fixture executes all five operations on the real pinned cwd object after a pathname rename-and-decoy swap;
2. the latest-main production arm fails only with typed `RUN_STORE_CAPABILITY_PRODUCTION_MISSING`; once the export exists,
   that same arm executes all five operations plus cross-run/phase rejection, stale CAS, symlink rejection, receipt,
   write/sync evidence and pinned-target observations;
3. V1, absolute/parent paths, symlink escape, unknown rename/remove, phase-forbidden operations, forged results, stale CAS,
   partial append, missing/unsafe durability and adapter bypass are rejected;
4. a correct future `consumeRunStoreCapabilityV2` export can satisfy the same oracle without changing it;
5. Linux is exercised on a real filesystem; macOS is contract-qualified for the same Node primitives but requires its own
   later live run before runtime promotion;
6. only this contract and test/oracle fixtures change. No production/runtime/plugin/skills/provider/account/network/release
   surface is part of this artifact.
