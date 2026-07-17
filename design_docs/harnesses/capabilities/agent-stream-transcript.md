# agent-stream-transcript

## Intent（host-neutral）

The web-viewer real-time work-stream drawer tails a running (or archived) agent's transcript and
renders a normalized event stream (`user` / `assistant` / `thinking` / `tool` / `tool_result` /
`system` / `raw`). The capability is ccm-owned (`ccm/apps/cli/src/handlers/agent-stream.ts` tail
engine + `agent-probe.ts` source location); the frontend `AgentStreamDrawer` renders only
server-normalized events and assumes no harness schema. Per harness the capability needs two things:
(1) **source location** — resolve the agent handle (session-id or transcript_ref) to a tailable
transcript file; (2) **structured parsing** — a per-harness line parser that maps the harness's
transcript schema onto the normalized event kinds, falling back to `raw` for lines it cannot parse.

## Acceptance（可测等价类）

1. For each harness whose agents register a resolvable handle, `buildAgentStream` returns
   `source.kind='transcript'` and a byte-offset paging cursor (tail / forward / backward tile
   losslessly — no gap, no dup, no tear; every page's cursor strictly progresses).
2. A harness with a structured parser normalizes its content-bearing lines into the correct event
   kinds and drops known config/telemetry/duplicate lines; any unparseable line surfaces as a
   truncated `raw` event (fidelity red line: never guess, never silently drop unknown top-level lines).
3. A harness with no tailable transcript degrades honestly to `source.kind='none'` with a non-empty
   `reason` (a 200 payload, not an error) — it never fabricates a stream.
4. Source location and liveness probing share one path/match implementation per harness (no second
   parallel truth); the session store roots come from the harness adapter's `sessionStoreRoots`.

## Host mechanisms

| host | status | mechanism | notes |
| --- | --- | --- | --- |
| claude-code | implemented | `parseClaudeLine` + `scanClaudeRoots` targeted `projects/<slug>/<sid>.jsonl`; in-session subagent derives `subagents/agent-<id>.jsonl` | full structured |
| codex | implemented | `parseCodexLine` (`response_item` canonical stream) + `rollout-*-<sid>.jsonl` walk (filename-boundary sid match) | full structured |
| kimi-code | implemented | `parseKimiLine` (typed `wire.jsonl`: `context.append_message` + `context.append_loop_event`) + **path-segment** sid match on `sessions/<wd>/<sid>/agents/main/wire.jsonl` | filename is always `wire.jsonl`; sid is the session directory segment (not the filename) |
| cursor | partial | external plain-text transcript only: `CURSOR_TRANSCRIPT_PATH` env or explicit `transcript_ref` → `parseRawLine` (raw lines); native SQLite `state.vscdb` not tailed | structured SQLite reader deferred — Track B |

## Current evidence

claude-code and codex parsers + tiling are proven by `ccm/apps/cli/test/agent-stream.test.ts`
(fixtures distilled from real transcripts). The kimi `wire.jsonl` schema was derived empirically from
live transcripts on the 2026-07-17 development host (`~/.kimi-code/sessions/**/agents/main/wire.jsonl`):
content-bearing types are `context.append_message` (canonical user messages) and
`context.append_loop_event` (`content.part` text/think, `tool.call`, `tool.result`); `turn.prompt`
duplicates the user message; `metadata` / `config.update` / `permission.set_mode` / `tools.*` /
`llm.*` / `usage.record` / `step.begin` / `step.end` are config/telemetry. Cursor's transcript store
is SQLite (`state.vscdb`) which the byte-offset `\n`-split tail engine cannot read; the `.vscdb`
extension is also excluded from the session walk, so session-id location returns null. The external
plain-text transcript path (`CURSOR_TRANSCRIPT_PATH` / registered `transcript_ref`) is the short-term
raw-only source. This host evidence does not transfer to another OS or harness version.

## Declared divergence

```yaml
- rule: cursor-structured-transcript-stream
  kind: protocol-capability-gap
  affected_hosts: [cursor]
  reason: >
    Cursor persists conversation state in a native SQLite store (state.vscdb), not an append-only
    text/JSONL transcript. The byte-offset newline-split tail engine cannot read it and the session
    walk excludes .vscdb, so there is no structured, tailable per-line source.
  compensating_mechanism: >
    Short-term: honor an external plain-text transcript path (CURSOR_TRANSCRIPT_PATH env, or an
    explicit `ccm agent bind --transcript` transcript_ref) and tail it through parseRawLine (raw
    events). No structured event kinds. A structured SQLite reader (read-only snapshot of state.vscdb
    → normalized events) is a larger architecture change deferred out of this batch.
  tracked_by: ccm/apps/cli/src/handlers/agent-stream.ts (SQLite reader deferred) · issue #180
```

## Current / target boundary

This card is **implemented** for claude-code, codex and kimi-code (full structured streaming with
lossless tiling). Cursor is **partial**: raw-only external transcript is a functional short-term
source, but structured event kinds require a SQLite reader that is not in scope here. The target for
cursor is a read-only `state.vscdb` snapshot reader projecting the same normalized event kinds; until
then the divergence above governs it as Track B (declared substitute, not silent omission).

## Linked surfaces

- Runtime tail engine + parsers: `ccm/apps/cli/src/handlers/agent-stream.ts`
- Runtime source location + liveness probe: `ccm/apps/cli/src/agent-probe.ts`
- Session store roots per harness: `ccm/apps/cli/src/harnesses/<host>.ts` `sessionStoreRoots`
- Frontend (harness-agnostic): `ccm/apps/web-viewer` `AgentStreamDrawer`
- kimi transcript facts: `design_docs/harnesses/kimi-code.md` §7 / §9 / §10

## Probe deps

`ccm/apps/cli/test/agent-stream.test.ts` proves claude / codex / kimi structured normalization + the
cursor external-transcript raw path + honest `none` degradation. `ccm/apps/cli/test/agent-probe.test.ts`
proves per-harness source location: kimi path-segment sid match (prefer `agents/main`, exact segment,
no substring bleed) and cursor session-id location returning null (no tailable native store). They do
not prove a cursor SQLite reader (out of scope) or that another Cursor version keeps the same store.
