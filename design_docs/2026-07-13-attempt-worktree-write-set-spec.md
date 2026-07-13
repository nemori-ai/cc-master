# Attempt worktree write-set preflight v1

> Status: **Frozen recovery contract; executable local preflight only; dispatcher integration remains unsupported**
> Date: 2026-07-13 UTC
> Board task: `fix_ccm_attempt_worktree_write_set`
> Contract IDs: `ccm/worktree-write-lease/v1`, `ccm/attempt-write-set-request/v1`, `ccm/attempt-write-set/v1`
> Depends on: [`cross-harness-orchestration-capability-model.md`](cross-harness-orchestration-capability-model.md) §§4, 6, 8, 12; [`2026-07-13-codex-native-attempt-ledger-spec.md`](2026-07-13-codex-native-attempt-ledger-spec.md) §§4–5, 9

## 1. Problem and scope

A linked Git worktree stores `.git` as a gitfile. The gitfile points outside the worktree content
directory to the per-worktree metadata directory under the common repository:

```text
<worktree>/.git
  -> <common-git-dir>/worktrees/<admin-name>
       -> commondir -> <common-git-dir>
```

Authorizing only `<worktree>` therefore lets a managed worker edit source but prevents Git from
creating `index.lock`, objects, ref locks, or reflogs. The run can finish its substantive work and
then fail while staging or committing. The original dogfood instance also declared its report path
under the main checkout, outside the worker worktree, so the managed sandbox could not write the
required completion artifact either.

This slice freezes and implements an **executable local preflight** that:

1. consumes a worktree-lease projection plus explicit artifact roots;
2. resolves the real worktree/git layout without spawning Git;
3. compiles the smallest directory-root authorization set needed for worktree edits, local Git
   stage/commit metadata, and declared artifacts;
4. probes every writable root before launch and returns stable structured refusal issues;
5. maps the same write roots into provider-neutral Codex/Claude managed-profile plans while retaining
   hard denies for remote/account/credential/network/outward operations.

This slice does **not** implement a worktree lease store, native-attempt writer, provider driver,
dispatcher, supervisor, or host sandbox launcher. The public CLI input is caller-supplied preflight
material and is not a trust proof. A safe result therefore has `launch_ready:false` until a future
composition root obtains the lease from the ccm-owned manager and consumes this plan atomically in
the native/cross-CLI launch transaction. The opt-in integration oracle remains RED on that missing
seam.

## 2. Ownership and boundaries

| Concern | Owner in this slice | Must not own |
| --- | --- | --- |
| versioned shapes, path/scope invariants, profile deny floor, deterministic compilation | `@ccm/engine` | filesystem/process/network/credential access |
| gitfile/commondir/HEAD parsing, symlink/containment checks, writability probes, CLI JSON/exit semantics | ccm CLI | lease authenticity, provider launch, board mutation |
| worktree lease authenticity and single-live-writer ownership | future ccm worktree manager | caller JSON or prompt |
| host sandbox flag/config compilation and worker launch | future provider/native adapter | route policy, task done, account mutation |
| final acceptance and commit/push authority | parent master/verifier | worker terminal result |

The engine accepts resolved fact input because it is pure. The future launch composition root must
authenticate the lease before calling it. The standalone CLI is diagnostic/preflight-only and must
never label caller JSON trusted or launch-ready.

## 3. Input contract

`ccm/worktree-write-lease/v1` is the minimum projection consumed by the preflight:

```json
{
  "schema": "ccm/worktree-write-lease/v1",
  "lease_ref": "worktree-lease:opaque",
  "worktree_root": "/abs/repo-worktree",
  "baseline_commit": "40-hex",
  "artifact_write_roots": ["/abs/main/design_docs/plans"]
}
```

The standalone command accepts it through `--lease @/abs/lease.json`; it is still caller-supplied.
Every `--artifact-root` must be exactly equal to or contained by a lease-declared
`artifact_write_roots` entry. Read-only roots may be declared separately but never satisfy a write.
Relative paths, empty refs, malformed baselines, duplicate/conflicting roots, roots inside Git
metadata, symlinked roots, missing roots, or roots outside lease scope fail closed.

The CLI resolves and supplies `ccm/attempt-write-set-request/v1` to the engine. Its resolved facts
include:

- canonical worktree root;
- `.git` kind (`main-worktree` or `linked-worktree`), gitfile, per-worktree gitdir, commondir,
  common `objects`, `refs`, and `logs` roots;
- stable layout verdict (`resolved|escape|symlink|missing|not-a-worktree|unknown`);
- real writability observations for every read-write authorization root.

The internal fact request is not a public trust boundary and is not accepted through a bypass flag.

## 4. Safe layout algorithm

For a main worktree, `.git` is recognized as a valid Git layout but this v1 writer preflight refuses
it with `WRITESET-WORKTREE-NOT-ISOLATED`. Safe writers require an orchestrator-owned linked
worktree; otherwise the worktree-content grant would recursively include shared `.git` config,
hooks, refs, and unrelated metadata.

For a linked worktree:

1. `.git` must be a regular non-symlink file containing exactly one `gitdir:` record;
2. the resolved gitdir must exist, contain `HEAD` and `commondir`, and contain no symlink redirection;
3. `commondir` must contain exactly one path record and resolve without symlink redirection;
4. the gitdir must be a direct child of `<commondir>/worktrees/`;
5. the gitdir's `gitdir` backlink must resolve exactly to the worktree `.git` file;
6. the common dir must contain `HEAD`, `objects`, `refs`, and `logs`, and none of the authorized metadata
   roots may escape it.

Unknown syntax or missing markers is `not-a-worktree`; missing files are `missing`; a direct symbolic
link is `symlink`; realpath/containment/backlink drift is `escape`. All four refuse the plan.

## 5. Authorization and profile plan

The read-write authorization roots are:

- worktree content tree;
- per-worktree gitdir tree (index, HEAD, worktree-local logs/state);
- common object tree;
- common refs tree;
- common logs tree; if it does not already exist, this v1 preflight refuses rather than widening the
  grant to the common Git directory merely so Git could create it;
- each explicit lease-scoped artifact root.

The compiler never grants the whole common Git directory as a recursive root: that would also grant
configuration, hooks, unrelated admin files, and other metadata not required for local stage/commit.
Every root records `scope:"tree"`, mode, reason, and canonical path. Requested writes in executable
fixtures must land under a read-write root; an undeclared path is refused.

Both managed profiles compile the same roots and the same effective permission snapshot:

| Internal profile | Provider mapping status | Effective native-attempt profile |
| --- | --- | --- |
| `codex-managed-workspace` | fixture/local contract only; future Codex driver consumes roots | `workspace-write` |
| `claude-managed-workspace` | fixture/local contract only; future Claude driver consumes roots | `workspace-write` |

The deny floor is closed and mandatory:

```text
account-mutation, credential-read, network, push-remote,
pr-create, merge, release, undeclared-path
```

Local stage/commit metadata is the purpose of this contract and is not equivalent to push/PR/merge.
No profile plan can weaken the deny floor. If a target harness cannot mechanically express the roots
and denies, that candidate remains ineligible rather than relying on prompt wording.

Every compiled plan is a recursively immutable runtime value. The plan object, authorization entries,
profile plan, permission snapshot, writable/read-only/deny arrays, and issue entries are frozen before
return. Mutation through `pop`, `splice`, `push`, index/property assignment, or object replacement must
throw without changing the plan. Compilation freezes only newly constructed output, never caller
input, and separate compilations do not share mutable authorization state.

## 6. Writability and failure atomicity

Preflight is ordered in three phases. First, the CLI resolves filesystem facts read-only and the
engine validates the complete request shape, lease grant uniqueness/non-overlap, linked-worktree
layout, symmetric artifact/Git-metadata separation, declaration scope, profile, and requested-write
containment. Any failure in that phase returns no probe roots, so main worktrees, malformed or
conflicting leases, and invalid/escaping/symlinked artifacts cause **zero filesystem writes**. Only a
structurally valid request may enter the second phase and probe the exact read-write roots returned by
the engine. The final phase recompiles the request with those real observations; any failed or unknown
observation again returns `authorized:[]`. A caller-provided writability claim never bypasses the CLI
resolver/probe boundary.

The CLI probes each writable directory using an exclusive temporary file created and removed inside
that directory. `EACCES`, `EPERM`, `EROFS`, missing/non-directory roots, or an unknown observation all
become `WRITESET-PATH-NOT-WRITABLE`. The test fixture separately calibrates the original `index.lock`
class by attempting the lock write in a read-only per-worktree gitdir.

Compilation is pure and input-preserving. Any issue yields:

```json
{
  "schema": "ccm/attempt-write-set/v1",
  "ok": false,
  "launch_ready": false,
  "authorized": [],
  "issues": [{"code": "...", "path": "...", "message": "..."}]
}
```

Refused plans expose no usable roots. The CLI returns exit `3` and the standard JSON error envelope
on stderr. It must not emit an `ok:true` envelope before throwing. A safe local preflight returns exit
`0`, `ok:true`, but still `launch_ready:false` with
`integration_status:"preflight-only-dispatcher-missing"`.

## 7. Executable acceptance

Default tests must prove:

- real local linked-worktree fixture parsing without spawning Git;
- read-only `index.lock` calibration and preflight refusal;
- Codex/Claude profile plans can execute a fake local stage/commit/artifact sequence using only
  authorized roots;
- gitfile/commondir/backlink escape, direct/ancestor symlink, missing/non-worktree, relative path,
  undeclared artifact, artifact symlink, read-only/missing root, duplicate/conflicting declaration,
  and unknown profile all fail closed;
- an artifact grant at `/repo/.worktrees` cannot authorize a sibling of the selected linked worktree,
  and an artifact grant at `/repo` cannot widen over the common Git ancestor; lease-grant and
  declared-root boundary guards are independently asserted so deleting or reversing either guard—or
  both—makes the ordinary engine and real-CLI focused suites fail;
- the deny floor is present and cannot be weakened;
- successful and refused plan graphs are deeply frozen, adversarial array/object mutation throws, and
  a fresh compilation retains the complete deny floor and narrow roots;
- the native-attempt candidate permission is satisfied by the compiled effective snapshot;
- CLI registry/router/handler run the real resolver/compiler and return stable JSON/exit semantics;
- no `--request` fact-bundle bypass exists.

The full launch seam is an opt-in RED oracle:

```bash
CCM_ATTEMPT_WRITE_SET_DISPATCH_RED=1 \
  pnpm --filter ccm exec node --import tsx --test test/handler-attempt-write-set.test.ts
```

It must fail until a real dispatcher/native-attempt composition root authenticates a ccm-owned lease,
compiles the provider sandbox, and consumes the plan before the only spawn effect. Adding a registry
entry, standalone handler, idle wrapper, or caller-controlled `trusted:true` field must not make it
green.

## 8. Rollback and promotion

Rollback removes the standalone preflight command and engine contract; it does not mutate boards,
worktrees, credentials, accounts, or active processes. Promotion to launch-ready requires a separate
slice with a trusted lease store, driver mapping, process-spawn spy proving preflight precedes the only
spawn, native-attempt/dispatch integration, and explicit provider support probes. Until then the
capability model remains `target` for S7 safe writer and no user-facing claim may say ccm can launch a
managed writer.
