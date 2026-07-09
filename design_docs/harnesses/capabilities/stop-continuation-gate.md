# stop-continuation-gate

## Intent（host-neutral）

When the agent attempts to end its turn (Stop), verify that unfinished orchestration work is not
silently abandoned: block (or force continuation) when actionable tasks remain, require goal
self-check handshake on settled completion states, surface pending user blocks, remind about
unarmed watchdogs, check rollup consistency, and **bound infinite stop loops** (FUSE).

## Acceptance（可测等价类）

1. Empty armed board (zero real tasks) → must not allow silent stop.
2. `ready` / `uncertain` tasks → must not allow silent stop.
3. Settled completion state → handshake required once per completion fingerprint (mechanism may
   differ per host).
4. `blocked` + `blocked_on:user` → explicit naming in block/continuation reason.
5. `in_flight` without valid watchdog → reminder (advisory layer).
6. Rollup inconsistency → soft reminder when another rule already blocked.
7. **FUSE**: after N consecutive blocks on same session, force release + strong advisory (finite
   upper bound on stop loop duration).
8. No matching active board → silent allow (dormant).

## Host mechanisms

| host | status | mechanism | notes |
| --- | --- | --- | --- |
| claude-code | implemented | `Stop` → `decision:block` + fingerprint dedup sidecar + FUSE | ADR-018 directive/advisory |
| codex | implemented-blocking | `Stop` → `decision:block` + `runtime.stop_allow_until` release valve + streak FUSE | See verify-board CONTRACT |
| cursor | planned | `stop` → **`followup_message`** auto-continue (not hard block) + `loop_limit` (default 5) + session FUSE sidecar aligned with Codex streak model | Track B protocol gap |

## Declared divergence

```yaml
- rule: stop-hard-block-envelope
  kind: protocol-capability-gap
  affected_hosts: [cursor]
  reason: >
    Cursor Stop uses followup_message to auto-submit the next user message when status is
    completed — not Claude/Codex decision:block. Hard "agent cannot end turn" semantics differ.
  compensating_mechanism: >
    Map continuation gate to followup_message with gate reason as follow-up text; enforce
    loop_limit; reuse FUSE sidecar (streak >= 5 → empty followup + strong advisory). Agent may set
    runtime.stop_allow_until via ccm (same as Codex) for explicit release after handshake.
  tracked_by: design_docs/harnesses/capabilities/stop-continuation-gate.md + cursor.md D6

- rule: verify-board-fingerprint-dedup
  kind: protocol-capability-gap
  affected_hosts: [codex, cursor]
  reason: Claude fingerprint dedup on unchanged completion state; Codex uses stop_allow_until; Cursor uses followup loop.
  compensating_mechanism: stop_allow_until + FUSE on Codex/Cursor; fingerprint on Claude.
  tracked_by: plugin/src/hooks/verify-board/CONTRACT.md
```

## Linked surfaces

- Hook: [`plugin/src/hooks/verify-board/CONTRACT.md`](../../../plugin/src/hooks/verify-board/CONTRACT.md)
- Capability overlap: identity-nudge / usage-pacing on same `stop` event (separate CONTRACTs)

## Probe deps

cursor.md Dogfood Backlog: **D6** (followup_message + loop_limit + FUSE interaction)
