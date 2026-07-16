# Release notes draft — cc-master v0.20.0 / ccm-v0.21.0

Status: release candidate; do not tag or publish from this document.

History window: `e80c57f6..b2d5691a` (62 commits, after plugin v0.19.0 and ccm-v0.20.0). Package versions produced by the repository changeset flow are `ccm@0.21.0`, `@ccm/engine@0.21.0`, and `@ccm/web-viewer@0.19.0`; the plugin manifests are `0.20.0`.

## Features

### Cross-harness dispatch is now a usable local loop

- `ccm worker` discovers and starts locally installed Claude Code, Codex, and Cursor Agent CLIs, passes target-native arguments through, exposes target help, and owns the session-bound process tree through terminal settlement.
- Opt-in planning/routing board contracts record difficulty, effect/capability/permission floors, ample/tight candidates, fallback authority, and immutable per-attempt selection evidence.
- Cursor IDE and Cursor Agent are separate inventory/admission surfaces. Only the headless Agent CLI is a worker target.
- The immutable runtime supply chain adds content-addressed staging, atomic activation, verified invoke, doctor, rollback, and crash recovery on supported POSIX hosts.

### Runtime actors are first-class

- Agent Registry v1 adds board `agents[]` plus `ccm agent create|bind|link|terminal|probe|list|show`.
- Task, agent, and attempt are distinct: process termination is not task acceptance, and retry evidence cannot silently cross attempt boundaries.
- The web viewer now includes an agent roster, inspector, lifecycle/probe state, and linked tasks.

### One cross-harness model and quota view

- The plugin’s eight distributed skills now start from a machine-wide worker pool. Model allocation, quota, pacing, dispatch, resume, review, and handoff no longer assume that the origin harness is the only execution pool.
- `ccm model-policy` separates official provider facts, project role candidates, live admission, and expiring community task-affinity taste. Capability/effect floors remain hard gates; taste is only a bounded tie-break.
- Orchestrator-tier policy is explicit: Claude Code Fable 5, Codex GPT-5.6 Sol, Cursor first-party Grok 4.5; Cursor API Fable/Sol require explicit paid-route permission.
- Machine-wide cached quota posture and coordination notifications are visible from all three origins. Codex is seven-day-only for hard pacing (rolling 24h is advisory); Cursor uses its subscription-period signal; neither Codex nor Cursor gains automatic account switching.

### Goal and delivery truth

- Goal Contract v1 adds revisioned `goal set|confirm|amend|show|check`, immutable Goal Briefs, drift checks, and safe resume/handoff behavior.
- Declared delivery/dependency truth distinguishes a passing candidate from a change actually landed in the downstream baseline, including git, immutable artifact, waiver, drift, retry, and reviewed-reconciliation evidence.

### Viewer and orchestration observability

- The shipped viewer adds Goal Contract, planning/routing views, route-aware filters, URL state, Agent Registry, and current board-model fields while remaining localhost-only, token-gated, and read-only.
- Cached coordination notification and machine-wide quota spines feed pre-context and hooks without provider calls from hook runtime.

## Changes

- Installer publication is transactional across Linux and macOS: target-adjacent staging, checksum/manifest/executable validation, fsync barriers, atomic activation, replayable rollback state, and fail-closed symlink/EXDEV handling.
- Runtime environment and executable resolution are platform contracts rather than hard-coded paths. Linux and macOS service serializers cover systemd-user and launchd lifecycle.
- Cross-harness model/quota guidance is canonical and shared; 27 origin-local quota/pacing overlays were removed. Host adapters now retain only genuine invocation differences.
- `using-ccm` follows the current CLI, Agent Registry, model policy, routing contracts, and all 82 board validation rules.
- Provider candidates, quota reservations, native attempts, and offline Claude/Cursor fixtures use fail-closed evidence boundaries. These fixtures validate contracts; they do not claim every real-provider canary passed on every host.

## Fixes

- Board guard closes Codex freeform `apply_patch`, parser-normalization, structured path alias, and shell redirect bypasses without blocking ordinary `ccm --board` calls.
- Retry and review gates archive prior evidence, invalidate stale verdicts, and require current-attempt `APPROVE` before downstream release.
- Worker cancellation waits for owned descendants to settle; tests reap leaked trees.
- Persistent stores, runtime materialization, locks, statusline temporary-root detection, and ignored clean-worktree fixtures are crash/concurrency safe.
- macOS runtime invocation uses an attested final-path tier instead of Linux fd pseudo-path assumptions; launchd deactivation/uninstall failures are nonzero and replayable.
- Agent Registry examples now register actors for in-flight tasks; graph reset returns dragged nodes to generated layout.

## Docs

- Cross-harness capability blueprints, information needs, orchestration model, provider contracts, quota notification contract, post-MVP roadmap, model role policy, and capability parity were formalized.
- The feature manual now reflects the shipped eight-skill, three-origin, 82-rule, worker/agent/model-policy/quota/viewer/Goal Contract product, with current vs partial boundaries.
- README changes are prepared in a separate review lane and are intentionally not part of this draft’s edit scope.

## Compatibility

- **Node.js 22+ and bash are required.** Release SEA builds are pinned to Node 22.
- Supported release binaries: Linux x64/arm64 and macOS x64/arm64. Windows runtime/release support remains deferred.
- Plugin and ccm have independent tags and versions. If upgrading separately, **upgrade ccm to `ccm-v0.21.0` before installing plugin `v0.20.0`**, because the plugin’s new guidance and hooks consume new CLI surfaces.
- Existing boards remain compatible unless an opt-in contract is enabled. New contracts add evidence gates; they do not silently reinterpret legacy tasks.
- `ccm worker` is a local, session-bound MVP. Durable remote transport, a universal provider sandbox, Windows runtime support, and stronger isolation remain post-MVP.
- Claude Code may use its user-authorized account-pool policy. Codex and Cursor do not auto-switch accounts.

## Exhaustive history ledger

Every commit in the release window is represented below; this ledger is the audit source for the grouped notes above.

### Product features

- `466f4d5c` — cross-harness routing contract spine (#87)
- `1f8ccc50` — immutable runtime activation supply chain (#88)
- `27e9330d` — C1 cross-harness shadow routing (#91)
- `704bab22` — independent Cursor IDE / Cursor Agent admission (#92)
- `4b52f574` — managed-attempt write-set preflight (#94)
- `afedfe8d` — portable runtime environment core (#97)
- `e51a9e66` — portable launchd/systemd serializers (#99)
- `1ac57c90` — fail-closed Codex provider candidate (#105)
- `e34bad59` — Cursor dual-surface contract (#108)
- `01dc8967` — quota reservation authority binding (#112)
- `df46609a` — Codex model admission integrated with quota authority (#114)
- `f68e3803` — cached Cursor context (#115)
- `5d08d83a` — native-attempt ledger authority stack (#117)
- `d055ccca` — offline Cursor provider boundary (#119)
- `14ddcc83` — provider-aware cross-harness model guidance (#120)
- `99c31890` — Goal Contract lifecycle and drift guards (#121)
- `aae6788c` — session-bound cross-harness worker (#122)
- `444807d4` — cross-harness target fact query guidance (#123)
- `60477392` — offline Claude provider fixture (#127)
- `96ca94c0` — declared delivery/dependency truth (#130)
- `c4985ccf` — cached coordination notification spine (#131)
- `296081ce` — raw cross-harness worker passthrough (#133)
- `af4bbf3b` — cross-harness-native orchestrator guidance
- `2cd3f3dd` — Goal/routing execution in web viewer (#140)
- `a15bcc20` — machine-wide cross-session quota posture (#141)
- `df638e1f` — machine-wide quota notifications in plugin (#145)
- `fae016b0` — Agent Registry and orchestration visualization (#144)
- `e0f2f374` — unified cross-harness model, quota, and agent guidance (#151)

### Reliability, security, and compatibility fixes

- `a43b29f0` — graph reset restores generated layout (#90)
- `e904207d` — statusline temporary-root detection (#93)
- `e52dfd88` — executor-handle lint scoped to active work (#95)
- `8af68c94` — macOS qualification evidence manifests (#96)
- `4776c044` — attempt-safe retry evidence and review gates (#98)
- `6d975c72` — transactional installer publication (#100)
- `2d8c71c4` — portable three-harness hook paths (#102)
- `7ab0a9a1` — crash-safe persistent state writes (#103)
- `77252ff2` — board-guard parser and shell bypasses (#104)
- `e3992005` — verified runtime invocation on macOS (#101)
- `d61a4d89` — isolated macOS evidence reruns (#109)
- `7b46bb32` — launchd deactivation integration (#110)
- `f5b45a36` — deterministic runtime lock concurrency test (#111)
- `474b1853` — hardened runtime launcher materialization (#113)
- `4b661c4c` — provider test worker-tree reaping (#116)
- `cd8e4957` — accountable watchdog handles (#118)
- `255ff93a` — precise ccm redirect classification (#128)
- `dd4aae19` — clean worker-tree settlement (#143)
- `3b13ff1b` — Agent Registry fixture warning (#146)
- `7106677c` — Codex freeform apply_patch guard (#147)
- `cf6d66e1` — hardened cached quota hook inputs (#148)
- `3e31bf47` — clean-worktree mutation test bootstrap (#150)

### Contract and qualification tests

- `c31eb048` — 7d-only quota admission contract (#106)
- `75c35b36` — C3 PHIP authority checker (#124)
- `3f579586` — lifecycle tick policy closed oracle (#125)
- `78a7b025` — subscription epoch negative oracle (#126)
- `d081b34a` — run-store capability v2 contract (#129)

### Documentation and design alignment

- `b5052dc1` — formalized cross-harness orchestration guidance (#85)
- `65ca5a3f` — Darwin support claim bound to live evidence (#107)
- `471d650f` — cross-harness post-MVP roadmap (#132)
- `9baedcfa` — plans directory excluded from content authority scan
- `d87458d6` — cross-harness skill-view convergence plan
- `3991e64b` — cross-harness model-role policy
- `b2d5691a` — machine-wide quota capability parity alignment (#153)
