import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import {
  type AgentStreamPayload,
  buildAgentStream,
  parserFor,
} from '../src/handlers/agent-stream.js';

let TMPDIRS: string[] = [];
afterEach(() => {
  for (const d of TMPDIRS) rmSync(d, { recursive: true, force: true });
  TMPDIRS = [];
});

function tmpFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ccm-stream-'));
  TMPDIRS.push(dir);
  const path = join(dir, name);
  writeFileSync(path, content, 'utf8');
  return path;
}

// Fixtures distilled from real transcripts on disk (schemas verified empirically, not guessed).

// claude-code: ~/.claude/projects/<slug>/<sid>.jsonl — top-level {type, message:{role,content},
// timestamp}; assistant content is a block array (thinking / text / tool_use); user content is a
// string or a tool_result block array; queue-operation etc. are noise; a non-JSON line is raw.
const CLAUDE_LINES = [
  '{"type":"user","timestamp":"2026-07-08T12:00:00Z","message":{"role":"user","content":"Add retries to the upload client"}}',
  '{"type":"assistant","timestamp":"2026-07-08T12:00:05Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"I should wrap post() in backoff"},{"type":"text","text":"Adding exponential backoff."},{"type":"tool_use","id":"tu1","name":"Edit","input":{"file_path":"src/upload.ts"}}]}}',
  '{"type":"user","timestamp":"2026-07-08T12:00:07Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu1","content":"Applied edit to src/upload.ts"}]}}',
  '{"type":"queue-operation","operation":"noise"}',
  '{"type":"summary","timestamp":"2026-07-08T12:00:09Z","summary":"Added retry with backoff"}',
  'this-is-not-json',
];

// codex: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl — top-level {timestamp, type, payload};
// response_item is the canonical model-io stream (message / reasoning / function_call /
// function_call_output); session_meta + event_msg are skipped (config / duplicate views).
const CODEX_LINES = [
  '{"timestamp":"2026-07-08T12:00:00Z","type":"session_meta","payload":{"id":"abc","cwd":"/repo"}}',
  '{"timestamp":"2026-07-08T12:00:00Z","type":"event_msg","payload":{"type":"user_message","message":"do it"}}',
  '{"timestamp":"2026-07-08T12:00:01Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"do it"}]}}',
  '{"timestamp":"2026-07-08T12:00:02Z","type":"response_item","payload":{"type":"reasoning","summary":[{"type":"summary_text","text":"plan the change"}],"encrypted_content":"gAAA"}}',
  '{"timestamp":"2026-07-08T12:00:03Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"On it."}]}}',
  '{"timestamp":"2026-07-08T12:00:04Z","type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\\"cmd\\":\\"ls -la\\"}"}}',
  '{"timestamp":"2026-07-08T12:00:05Z","type":"response_item","payload":{"type":"function_call_output","call_id":"c1","output":"file.txt\\n"}}',
];

// kimi-code: sessions/<wd>/<sid>/agents/main/wire.jsonl — internal typed transcript (NOT the
// `-p` stream-json OpenAI-message shape). Verified empirically against real wire.jsonl on disk:
// metadata / config.update / usage.record etc. are config/telemetry noise; turn.prompt is a
// duplicate of the canonical context.append_message(user); assistant output + tools flow through
// context.append_loop_event (content.part text/think, tool.call, tool.result); step.* is telemetry.
const KIMI_LINES = [
  '{"type":"metadata","protocol_version":"1.4","created_at":1784270606378}',
  '{"type":"config.update","profileName":"agent","systemPrompt":"You are Kimi Code","time":1784270606380}',
  '{"type":"context.append_message","message":{"role":"user","content":[{"type":"text","text":"Add retries to the upload client"}],"toolCalls":[]},"time":1784270606400}',
  '{"type":"turn.prompt","input":[{"type":"text","text":"Add retries to the upload client"}],"origin":{"kind":"user"},"time":1784270606401}',
  '{"type":"context.append_loop_event","event":{"type":"step.begin","uuid":"u1","turnId":"t1","step":0},"time":1784270606402}',
  '{"type":"context.append_loop_event","event":{"type":"content.part","part":{"type":"think","think":"I should wrap post() in backoff"}},"time":1784270606410}',
  '{"type":"context.append_loop_event","event":{"type":"content.part","part":{"type":"text","text":"Adding exponential backoff."}},"time":1784270606420}',
  '{"type":"context.append_loop_event","event":{"type":"tool.call","toolCallId":"tc1","name":"Edit","args":{"path":"src/upload.ts"},"description":"edit file"},"time":1784270606430}',
  '{"type":"context.append_loop_event","event":{"type":"tool.result","toolCallId":"tc1","result":{"output":"Applied edit to src/upload.ts","note":""}},"time":1784270606440}',
  '{"type":"context.append_loop_event","event":{"type":"step.end","uuid":"u1","turnId":"t1","step":0,"finishReason":"stop"},"time":1784270606450}',
  '{"type":"usage.record","model":"kimi-code/k3","usage":{"output":42},"time":1784270606460}',
  '{"type":"context.append_loop_event","event":{"type":"future.unknown.event","blob":"x"},"time":1784270606470}',
  'this-is-not-json',
];

function fileFrom(lines: string[]): string {
  return `${lines.join('\n')}\n`;
}

// Walk the engine forward from offset 0 to end, concatenating every page — the "full read"
// reference the tail + backward pages must reproduce exactly (same ids, order, no gap/dup).
function collectForward(ref: string, harness: string): AgentStreamPayload['events'] {
  const events: AgentStreamPayload['events'] = [];
  let cursor = '0';
  for (let guard = 0; guard < 10000; guard++) {
    const page = buildAgentStream({
      agentId: 'a',
      harness,
      handleKind: 'task-id',
      handleValue: '',
      transcriptRef: ref,
      cursorParam: cursor,
    });
    events.push(...page.events);
    if (page.cursor.next >= (page.source.size ?? 0) || page.cursor.next === Number(cursor)) break;
    cursor = String(page.cursor.next);
  }
  return events;
}

// Walk backward from the tail to the file head, prepending each page. Asserts the paging
// protocol invariants the frontend relies on: prev strictly decreases on EVERY page (empty
// intermediate pages included — a stalled prev means "load earlier" spins forever), and the
// walk terminates at at_start. Returns the full prepended sequence.
function collectBackward(ref: string, harness: string): AgentStreamPayload['events'] {
  const tail = buildAgentStream({
    agentId: 'a',
    harness,
    handleKind: 'task-id',
    handleValue: '',
    transcriptRef: ref,
  });
  const events = tail.events.slice();
  let before = tail.cursor.prev;
  let atStart = tail.cursor.at_start;
  let guard = 0;
  while (!atStart) {
    assert.ok(guard++ < 10000, 'backward walk page guard');
    const page = buildAgentStream({
      agentId: 'a',
      harness,
      handleKind: 'task-id',
      handleValue: '',
      transcriptRef: ref,
      beforeParam: String(before),
    });
    assert.ok(
      page.cursor.prev < before,
      `backward page must progress: before=${before} prev=${page.cursor.prev} events=${page.events.length}`,
    );
    events.unshift(...page.events);
    before = page.cursor.prev;
    atStart = page.cursor.at_start;
  }
  return events;
}

test('claude-code tail normalizes every block kind and drops noise', () => {
  const ref = tmpFile('s.jsonl', fileFrom(CLAUDE_LINES));
  const p = buildAgentStream({
    agentId: 'a',
    harness: 'claude-code',
    handleKind: 'task-id',
    handleValue: '',
    transcriptRef: ref,
  });
  assert.equal(p.schema, 'ccm/web-viewer-agent-stream/v1');
  assert.equal(p.mode, 'tail');
  assert.equal(p.source.kind, 'transcript');
  assert.equal(p.cursor.at_start, true); // small file — whole thing fits in the tail window
  const kinds = p.events.map((e) => e.kind);
  // user, [thinking, assistant, tool], tool_result, (queue-operation dropped), system(summary), raw
  assert.deepEqual(kinds, [
    'user',
    'thinking',
    'assistant',
    'tool',
    'tool_result',
    'system',
    'raw',
  ]);
  const tool = p.events.find((e) => e.kind === 'tool');
  assert.equal(tool?.title, 'Edit');
  assert.match(String(tool?.detail), /src\/upload\.ts/);
  const raw = p.events.find((e) => e.kind === 'raw');
  assert.equal(raw?.text, 'this-is-not-json');
  // Stable ids encode line byte offset + block index; the assistant line yields 3 same-offset ids.
  const offsets = p.events.map((e) => e.id.split('.')[0]);
  assert.equal(offsets[1], offsets[2]); // thinking + assistant share the assistant line
  assert.equal(offsets[2], offsets[3]); // + tool_use
});

test('codex tail uses response_item canonical stream and skips duplicate/config lines', () => {
  const ref = tmpFile('r.jsonl', fileFrom(CODEX_LINES));
  const p = buildAgentStream({
    agentId: 'a',
    harness: 'codex',
    handleKind: 'task-id',
    handleValue: '',
    transcriptRef: ref,
  });
  const kinds = p.events.map((e) => e.kind);
  // session_meta + event_msg skipped; message(user), reasoning, message(assistant), fn_call, fn_output
  assert.deepEqual(kinds, ['user', 'thinking', 'assistant', 'tool', 'tool_result']);
  assert.equal(p.events[0]?.text, 'do it');
  assert.equal(p.events[1]?.text, 'plan the change');
  assert.equal(p.events[3]?.title, 'exec_command');
  assert.match(String(p.events[4]?.text), /file\.txt/);
});

test('kimi-code tail normalizes typed wire.jsonl, drops noise + turn.prompt dup, raws unknowns', () => {
  const ref = tmpFile('wire.jsonl', fileFrom(KIMI_LINES));
  const p = buildAgentStream({
    agentId: 'a',
    harness: 'kimi-code',
    handleKind: 'task-id',
    handleValue: '',
    transcriptRef: ref,
  });
  assert.equal(p.source.kind, 'transcript');
  const kinds = p.events.map((e) => e.kind);
  // metadata + config.update + turn.prompt(dup) + step.begin/step.end + usage.record dropped;
  // append_message(user), content.part(think→thinking), content.part(text→assistant),
  // tool.call(→tool), tool.result(→tool_result), unknown loop event (→raw), non-json (→raw).
  assert.deepEqual(kinds, ['user', 'thinking', 'assistant', 'tool', 'tool_result', 'raw', 'raw']);
  assert.equal(p.events[0]?.text, 'Add retries to the upload client');
  assert.equal(p.events[1]?.text, 'I should wrap post() in backoff');
  assert.equal(p.events[2]?.text, 'Adding exponential backoff.');
  const tool = p.events[3];
  assert.equal(tool?.title, 'Edit');
  assert.match(String(tool?.detail), /src\/upload\.ts/);
  assert.equal(p.events[4]?.text, 'Applied edit to src/upload.ts');
  // epoch-ms `time` is converted to an ISO ts on emitted events.
  assert.match(String(p.events[0]?.ts), /^2026-.*Z$/);
  // The last raw is the non-JSON line passed through verbatim.
  assert.equal(p.events[6]?.text, 'this-is-not-json');
  // parserFor dispatch is public + stable for kimi.
  assert.equal(parserFor('kimi-code')('  ').length, 0);
});

test('kimi-code locates wire.jsonl by path-segment sid (session-id handle, no transcript_ref)', () => {
  // Real layout: <KIMI_CODE_HOME>/sessions/<wd>/<sid>/agents/main/wire.jsonl — the sid is the
  // session directory segment, the filename is always `wire.jsonl`. The stream must resolve the
  // source from the session-id handle alone (agent-probe path-segment match).
  const home = mkdtempSync(join(tmpdir(), 'ccm-kimi-home-'));
  TMPDIRS.push(home);
  const sid = 'session_7cfabeb1-ad90-41bc-b9a3-bc4e2f105bbc';
  const dir = join(home, 'sessions', 'wd_repo_deadbeef', sid, 'agents', 'main');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'wire.jsonl'), fileFrom(KIMI_LINES), 'utf8');

  const p = buildAgentStream({
    agentId: 'a',
    harness: 'kimi-code',
    handleKind: 'session-id',
    handleValue: sid,
    transcriptRef: null,
    env: { KIMI_CODE_HOME: home },
  });
  assert.equal(p.source.kind, 'transcript');
  assert.ok(String(p.source.path).endsWith(`${sid}/agents/main/wire.jsonl`));
  assert.deepEqual(
    p.events.map((e) => e.kind),
    ['user', 'thinking', 'assistant', 'tool', 'tool_result', 'raw', 'raw'],
  );
});

test('kimi-code Task subagent resolves its own wire.jsonl from parent main ref + task-id handle', () => {
  // Real Kimi layout: one session contains `agents/main/wire.jsonl` plus one sibling directory
  // per Task subagent (`agents/<agentId>/wire.jsonl`). The Task-returned agent id is the handle;
  // registering the parent main wire supplies the stable session anchor without copying content.
  const dir = mkdtempSync(join(tmpdir(), 'ccm-kimi-subagent-'));
  TMPDIRS.push(dir);
  const agentsDir = join(
    dir,
    'sessions',
    'wd_repo_deadbeef',
    'session_7cfabeb1-ad90-41bc-b9a3-bc4e2f105bbc',
    'agents',
  );
  const mainDir = join(agentsDir, 'main');
  const agentId = 'agent-0';
  const subDir = join(agentsDir, agentId);
  mkdirSync(mainDir, { recursive: true });
  mkdirSync(subDir, { recursive: true });
  const parentPath = join(mainDir, 'wire.jsonl');
  writeFileSync(
    parentPath,
    `${[
      '{"type":"context.append_message","message":{"role":"user","content":[{"type":"text","text":"parent request"}],"toolCalls":[]},"time":1784270606400}',
      '{"type":"context.append_loop_event","event":{"type":"content.part","part":{"type":"text","text":"parent line — must NOT stream under the subagent"}},"time":1784270606420}',
    ].join('\n')}\n`,
    'utf8',
  );
  writeFileSync(
    join(subDir, 'wire.jsonl'),
    `${[
      '{"type":"context.append_message","message":{"role":"user","content":[{"type":"text","text":"inspect the parser"}],"toolCalls":[]},"time":1784270606500}',
      '{"type":"context.append_loop_event","event":{"type":"tool.call","toolCallId":"tc1","name":"Read","args":{"path":"src/parser.ts"}},"time":1784270606510}',
      '{"type":"context.append_loop_event","event":{"type":"tool.result","toolCallId":"tc1","result":{"output":"export function parse() {}"}},"time":1784270606520}',
      '{"type":"context.append_loop_event","event":{"type":"content.part","part":{"type":"text","text":"parser inspected"}},"time":1784270606530}',
    ].join('\n')}\n`,
    'utf8',
  );

  const p = buildAgentStream({
    agentId: 'agt-kimi-sub',
    harness: 'kimi-code',
    handleKind: 'task-id',
    handleValue: agentId,
    transcriptRef: parentPath,
  });
  assert.equal(p.source.kind, 'transcript');
  assert.ok(
    String(p.source.path).endsWith(`agents/${agentId}/wire.jsonl`),
    'derived Kimi Task subagent wire wins over the parent main ref',
  );
  assert.deepEqual(
    p.events.map((e) => e.kind),
    ['user', 'tool', 'tool_result', 'assistant'],
  );
  assert.equal(p.events[3]?.text, 'parser inspected');
  assert.ok(
    p.events.every((e) => !e.text.includes('parent line')),
    'no Kimi main-agent events leak into the Task subagent stream',
  );
});

test('cursor short-term: external transcript via CURSOR_TRANSCRIPT_PATH tails as raw lines', () => {
  // Cursor's native store is SQLite (state.vscdb) — not tailable. Short-term: an externally
  // provided plain-text transcript path is honored as a raw-line source when no explicit
  // transcript_ref is registered (session-id walk finds nothing for cursor).
  const path = tmpFile('cursor.log', 'agent: reading file\nassistant: done\n');
  const p = buildAgentStream({
    agentId: 'a',
    harness: 'cursor-agent',
    handleKind: 'session-id',
    handleValue: 'conv-123',
    transcriptRef: null,
    env: { CURSOR_TRANSCRIPT_PATH: path },
  });
  assert.equal(p.source.kind, 'transcript');
  assert.equal(p.source.path, path);
  assert.equal(p.events.length, 2);
  assert.ok(p.events.every((e) => e.kind === 'raw'));
  assert.equal(p.events[0]?.text, 'agent: reading file');
});

test('cursor: explicit transcript_ref wins over CURSOR_TRANSCRIPT_PATH env', () => {
  const registered = tmpFile('registered.log', 'registered line\n');
  const envPath = tmpFile('env.log', 'env line\n');
  const p = buildAgentStream({
    agentId: 'a',
    harness: 'cursor-agent',
    handleKind: 'session-id',
    handleValue: 'conv-123',
    transcriptRef: registered,
    env: { CURSOR_TRANSCRIPT_PATH: envPath },
  });
  assert.equal(p.source.path, registered);
  assert.equal(p.events[0]?.text, 'registered line');
});

test('cursor: no external transcript → honest source.kind none (SQLite state.vscdb not tailable)', () => {
  const p = buildAgentStream({
    agentId: 'a',
    harness: 'cursor-agent',
    handleKind: 'session-id',
    handleValue: 'conv-123',
    transcriptRef: null,
    env: {},
  });
  assert.equal(p.source.kind, 'none');
  assert.equal(p.mode, 'none');
  assert.ok(p.source.reason && p.source.reason.length > 0);
});

test('forward, tail, and backward pages tile identically (no gap, no dup, no tear)', () => {
  // A file large enough to span multiple tail/backward pages.
  const lines: string[] = [];
  for (let i = 0; i < 400; i++) {
    lines.push(
      `{"type":"assistant","timestamp":"2026-07-08T12:00:00Z","message":{"role":"assistant","content":[{"type":"text","text":"line ${i} ${'x'.repeat(120)}"}]}}`,
    );
  }
  const ref = tmpFile('big.jsonl', fileFrom(lines));
  const forward = collectForward(ref, 'claude-code');
  const backward = collectBackward(ref, 'claude-code');
  assert.deepEqual(
    backward.map((e) => e.id),
    forward.map((e) => e.id),
  );
  // Every line produced exactly one event, ids strictly increasing by byte offset, none repeated.
  assert.equal(forward.length, 400);
  const ids = new Set(forward.map((e) => e.id));
  assert.equal(ids.size, 400);
  for (let i = 1; i < forward.length; i++) {
    const prev = Number(forward[i - 1]?.id.split('.')[0]);
    const cur = Number(forward[i]?.id.split('.')[0]);
    assert.ok(cur > prev, 'byte offsets strictly increase');
  }
});

test('tail reads only the file end on a large transcript (never an integral read)', () => {
  const lines: string[] = [];
  for (let i = 0; i < 12000; i++) {
    lines.push(
      `{"type":"assistant","timestamp":"2026-07-08T12:00:00Z","message":{"role":"assistant","content":[{"type":"text","text":"row ${i} ${'y'.repeat(120)}"}]}}`,
    );
  }
  const ref = tmpFile('huge.jsonl', fileFrom(lines));
  const p = buildAgentStream({
    agentId: 'a',
    harness: 'claude-code',
    handleKind: 'task-id',
    handleValue: '',
    transcriptRef: ref,
  });
  const size = p.source.size ?? 0;
  assert.ok(size > 1024 * 1024, 'fixture exceeds 1 MiB');
  assert.equal(p.cursor.at_start, false); // did NOT reach the head — only the tail window
  // The earliest returned line starts within one 64 KiB window (+ one line) of EOF.
  assert.ok(size - p.cursor.prev <= 64 * 1024 + 4096, 'tail anchored to the last ~64 KiB');
  assert.ok(p.events.length <= 200, 'single response capped at 200 events');
});

test('forward from offset 0 caps at 200 events and advances the cursor', () => {
  const lines: string[] = [];
  for (let i = 0; i < 500; i++) {
    lines.push(
      `{"type":"user","timestamp":"2026-07-08T12:00:00Z","message":{"role":"user","content":"m${i}"}}`,
    );
  }
  const ref = tmpFile('many.jsonl', fileFrom(lines));
  const p = buildAgentStream({
    agentId: 'a',
    harness: 'claude-code',
    handleKind: 'task-id',
    handleValue: '',
    transcriptRef: ref,
    cursorParam: '0',
  });
  assert.equal(p.mode, 'forward');
  assert.equal(p.events.length, 200);
  assert.ok(p.cursor.next > 0 && p.cursor.next < (p.source.size ?? 0));
});

test('forward incremental picks up appended lines', () => {
  const ref = tmpFile('live.jsonl', fileFrom(CLAUDE_LINES.slice(0, 2)));
  const first = buildAgentStream({
    agentId: 'a',
    harness: 'claude-code',
    handleKind: 'task-id',
    handleValue: '',
    transcriptRef: ref,
  });
  const before = first.events.length;
  appendFileSync(
    ref,
    `${'{"type":"user","timestamp":"2026-07-08T12:00:20Z","message":{"role":"user","content":"a new message"}}'}\n`,
    'utf8',
  );
  const next = buildAgentStream({
    agentId: 'a',
    harness: 'claude-code',
    handleKind: 'task-id',
    handleValue: '',
    transcriptRef: ref,
    cursorParam: String(first.cursor.next),
  });
  assert.equal(next.mode, 'forward');
  assert.equal(next.events.length, 1);
  assert.equal(next.events[0]?.text, 'a new message');
  assert.ok(before >= 1);
});

test('cursor beyond size (truncation/rotation) resets and re-tails', () => {
  const ref = tmpFile('trunc.jsonl', fileFrom(CLAUDE_LINES.slice(0, 2)));
  const p = buildAgentStream({
    agentId: 'a',
    harness: 'claude-code',
    handleKind: 'task-id',
    handleValue: '',
    transcriptRef: ref,
    cursorParam: '9999999',
  });
  assert.equal(p.reset, true);
  assert.equal(p.mode, 'tail');
  assert.ok(p.events.length > 0);
});

test('unresolvable handle degrades to source.kind none (200 payload, not an error)', () => {
  const p = buildAgentStream({
    agentId: 'a',
    harness: 'origin',
    handleKind: 'none',
    handleValue: '',
    transcriptRef: null,
  });
  assert.equal(p.source.kind, 'none');
  assert.equal(p.mode, 'none');
  assert.equal(p.events.length, 0);
  assert.ok(p.source.reason && p.source.reason.length > 0);
});

test('no-source reason names the binding gap (not the agent type) for a streamable harness', () => {
  // 真实事故形状：codex agent 以 task-id 登记（未走 ccm worker dispatch）、无 transcript_ref ——
  //   旧文案「no readable stream source for this agent type yet」被误读成 codex 不支持流式。
  const p = buildAgentStream({
    agentId: 'agt-007',
    harness: 'codex',
    handleKind: 'task-id',
    handleValue: 'b71um3zlv',
    transcriptRef: null,
    env: {},
  });
  assert.equal(p.source.kind, 'none');
  assert.match(p.source.reason ?? '', /no stream binding/);
  assert.match(p.source.reason ?? '', /task-id/);
  assert.match(p.source.reason ?? '', /ccm worker dispatch/);
  assert.match(p.source.reason ?? '', /ccm agent amend agt-007/);
});

test('no-source reason for cursor names the SQLite store and both bind-a-transcript exits', () => {
  const p = buildAgentStream({
    agentId: 'agt-008',
    harness: 'cursor-agent',
    handleKind: 'session-id',
    handleValue: 'conv-123',
    transcriptRef: null,
    env: {},
  });
  assert.equal(p.source.kind, 'none');
  assert.match(p.source.reason ?? '', /state\.vscdb/);
  assert.match(p.source.reason ?? '', /CURSOR_TRANSCRIPT_PATH/);
  assert.match(p.source.reason ?? '', /ccm agent amend agt-008/);
});

test('truncation marks long values and unknown harness falls back to raw lines', () => {
  const big = 'z'.repeat(9000);
  const ref = tmpFile(
    'raw.txt',
    `plain text line one\n{"not":"parsed by raw ${big}"}\nthird line\n`,
  );
  const p = buildAgentStream({
    agentId: 'a',
    harness: 'weird-harness',
    handleKind: 'task-id',
    handleValue: '',
    transcriptRef: ref,
  });
  assert.equal(p.events.length, 3);
  assert.ok(p.events.every((e) => e.kind === 'raw'));
  const truncated = p.events.find((e) => e.truncated);
  assert.ok(truncated, 'a >4KiB line is flagged truncated');
  assert.ok(truncated && truncated.text.length <= 4100);
  // parserFor dispatch is public and stable.
  assert.equal(parserFor('claude-code')('  ').length, 0);
});

test('real-shape tiling: multi-window fixture with an all-dropped middle stretch pages back losslessly', () => {
  // >2 windows (~190KiB) with a dropped-only band in the middle — the shape of a real claude
  // transcript where file-history-snapshot / queue-operation lines dominate whole 64KiB windows.
  const normal = (i: number) =>
    `{"type":"assistant","timestamp":"2026-07-08T12:00:00Z","message":{"role":"assistant","content":[{"type":"text","text":"normal ${i} ${'x'.repeat(120)}"}]}}`;
  const dropped = (i: number) =>
    `{"type":"file-history-snapshot","snapshot":{"seq":${i},"pad":"${'d'.repeat(120)}"}}`;
  const lines = [
    ...Array.from({ length: 200 }, (_v, i) => normal(i)),
    ...Array.from({ length: 800 }, (_v, i) => dropped(i)),
    ...Array.from({ length: 200 }, (_v, i) => normal(1000 + i)),
  ];
  const ref = tmpFile('band.jsonl', fileFrom(lines));
  const forward = collectForward(ref, 'claude-code');
  assert.equal(forward.length, 400, 'dropped band contributes zero events');
  // collectBackward asserts per-page strict progress (empty pages included) + at_start arrival.
  const backward = collectBackward(ref, 'claude-code');
  assert.deepEqual(
    backward.map((e) => e.id),
    forward.map((e) => e.id),
    'backward pages tile to the same sequence as a full forward parse',
  );
});

test('giant single line (>64KiB, the real 23MB-transcript bug shape) pages back with progress', () => {
  // The exact production failure: a ~1MiB tool_result line whose middle fills the whole 64KiB
  // backward window — before the fix the page came back empty with prev unchanged (dead
  // "load earlier"). The line-boundary scan must find its start and emit the (truncated) event.
  const giantPayload = 'G'.repeat(1_100_000);
  const lines = [
    ...Array.from(
      { length: 10 },
      (_v, i) =>
        `{"type":"user","timestamp":"2026-07-08T12:00:00Z","message":{"role":"user","content":"pre ${i}"}}`,
    ),
    `{"type":"user","timestamp":"2026-07-08T12:00:01Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"${giantPayload}"}]}}`,
    ...Array.from(
      { length: 10 },
      (_v, i) =>
        `{"type":"user","timestamp":"2026-07-08T12:00:02Z","message":{"role":"user","content":"post ${i}"}}`,
    ),
  ];
  const ref = tmpFile('giant.jsonl', fileFrom(lines));

  // Direct reproduction of the reported HTTP sequence: tail, then before=tail.prev.
  const tail = buildAgentStream({
    agentId: 'a',
    harness: 'claude-code',
    handleKind: 'task-id',
    handleValue: '',
    transcriptRef: ref,
  });
  assert.equal(
    tail.cursor.at_start,
    false,
    'tail window cannot reach the head past the giant line',
  );
  const back = buildAgentStream({
    agentId: 'a',
    harness: 'claude-code',
    handleKind: 'task-id',
    handleValue: '',
    transcriptRef: ref,
    beforeParam: String(tail.cursor.prev),
  });
  assert.ok(back.cursor.prev < tail.cursor.prev, 'prev advances past the giant line');
  assert.equal(back.events.length, 1, 'the giant tool_result line itself is emitted');
  assert.equal(back.events[0]?.kind, 'tool_result');
  assert.equal(back.events[0]?.truncated, true);
  assert.ok((back.events[0]?.text ?? '').length <= 4100, 'event text stays capped');

  // And the giant line does not break lossless tiling (it parses in both directions).
  const forward = collectForward(ref, 'claude-code');
  const backward = collectBackward(ref, 'claude-code');
  assert.equal(forward.length, 21);
  assert.deepEqual(
    backward.map((e) => e.id),
    forward.map((e) => e.id),
  );
});

test('pathological line beyond the boundary-scan budget still progresses in both directions', () => {
  // >4MiB single line: backward degrades to empty progressing pages; forward emits a raw
  // truncated head fragment and keeps moving. Neither direction may stall, and the normal
  // lines on both sides must all surface in both directions.
  const monster = 'M'.repeat(5 * 1024 * 1024);
  const mk = (tag: string, i: number) =>
    `{"type":"user","timestamp":"2026-07-08T12:00:00Z","message":{"role":"user","content":"${tag} ${i}"}}`;
  const lines = [
    ...Array.from({ length: 5 }, (_v, i) => mk('pre', i)),
    `{"type":"user","message":{"role":"user","content":"${monster}"}}`,
    ...Array.from({ length: 5 }, (_v, i) => mk('post', i)),
  ];
  const ref = tmpFile('monster.jsonl', fileFrom(lines));

  const forward = collectForward(ref, 'claude-code');
  const backward = collectBackward(ref, 'claude-code'); // asserts strict progress internally
  const textsOf = (events: AgentStreamPayload['events']) =>
    events.map((e) => e.text).filter((t) => /^(pre|post) \d+$/.test(t));
  const expected = [
    ...Array.from({ length: 5 }, (_v, i) => `pre ${i}`),
    ...Array.from({ length: 5 }, (_v, i) => `post ${i}`),
  ];
  assert.deepEqual(textsOf(forward), expected, 'forward surfaces every normal line');
  assert.deepEqual(textsOf(backward), expected, 'backward surfaces every normal line');
  // Forward honesty: the unparseable-within-budget monster shows up as a truncated raw fragment.
  assert.ok(
    forward.some((e) => e.kind === 'raw' && e.truncated),
    'forward emits a truncated raw fragment for the monster line',
  );
});

test('giant line at the FILE HEAD is emitted, not dropped behind a false at_start', () => {
  // Review F2: every earlier giant-line fixture put normal lines before the giant, so the
  // backward boundary scan always found a preceding newline. When the giant IS the first line,
  // the scan bottoms at offset 0 without a newline — 0 is the line start, and falling into the
  // beyond-budget fallback dropped the first line forever while reporting at_start=true.
  const giant = `{"type":"user","timestamp":"2026-07-08T12:00:00Z","message":{"role":"user","content":"${'G'.repeat(100_000)}"}}`;
  const lines = [
    giant,
    ...Array.from(
      { length: 5 },
      (_v, i) =>
        `{"type":"user","timestamp":"2026-07-08T12:00:01Z","message":{"role":"user","content":"post ${i}"}}`,
    ),
  ];
  const ref = tmpFile('first-giant.jsonl', fileFrom(lines));

  const tail = buildAgentStream({
    agentId: 'a',
    harness: 'claude-code',
    handleKind: 'task-id',
    handleValue: '',
    transcriptRef: ref,
  });
  assert.equal(tail.cursor.at_start, false);
  const back = buildAgentStream({
    agentId: 'a',
    harness: 'claude-code',
    handleKind: 'task-id',
    handleValue: '',
    transcriptRef: ref,
    beforeParam: String(tail.cursor.prev),
  });
  assert.equal(back.events.length, 1, 'the head giant line is emitted');
  assert.equal(back.events[0]?.kind, 'user');
  assert.equal(back.events[0]?.truncated, true);
  assert.equal(back.cursor.prev, 0);
  assert.equal(back.cursor.at_start, true, 'at_start only once the head line is delivered');

  // Lossless tiling holds with the giant at the head.
  const forward = collectForward(ref, 'claude-code');
  const backward = collectBackward(ref, 'claude-code');
  assert.equal(forward.length, 6);
  assert.deepEqual(
    backward.map((e) => e.id),
    forward.map((e) => e.id),
  );
});

test('forward page over an all-noise window advances the cursor with zero events', () => {
  // Review F1 (server half): a full window of server-dropped line types must still move
  // cursor.next — the client mirrors this by adopting empty-page cursors during live follow.
  const noise = Array.from(
    { length: 120 },
    (_v, i) =>
      `{"type":"file-history-snapshot","snapshot":{"seq":${i},"pad":"${'x'.repeat(3000)}"}}`,
  );
  const ref = tmpFile('noise.jsonl', fileFrom(noise));
  const p = buildAgentStream({
    agentId: 'a',
    harness: 'claude-code',
    handleKind: 'task-id',
    handleValue: '',
    transcriptRef: ref,
    cursorParam: '0',
  });
  assert.equal(p.mode, 'forward');
  assert.equal(p.events.length, 0);
  assert.ok(p.cursor.next > 0, 'cursor progresses through the noise window');
});

test('source carries a stable file identity (ino) across repeated reads', () => {
  // Only assert the property our code actually relies on: the SAME file exposes the SAME
  // identity on every page, so the client can compare adjacent pages. Do NOT assert that a
  // deleted-and-recreated path gets a different ino — Linux ext4 recycles freed inodes
  // immediately (only macOS APFS happens to allocate monotonically), so "recreate => new ino"
  // is not a property any filesystem promises. The rotation REACTION is covered by the
  // client-side pure-function test (synthesized adjacent pages with differing ino).
  const ref = tmpFile('ident.jsonl', fileFrom(CLAUDE_LINES.slice(0, 2)));
  const args = {
    agentId: 'a',
    harness: 'claude-code',
    handleKind: 'task-id',
    handleValue: '',
    transcriptRef: ref,
  };
  const a = buildAgentStream(args);
  const b = buildAgentStream(args);
  const c = buildAgentStream({ ...args, cursorParam: '0' });
  assert.equal(typeof a.source.ino, 'number');
  assert.equal(a.source.ino, b.source.ino, 'identity stable across tail reads');
  assert.equal(a.source.ino, c.source.ino, 'identity stable across read modes');
});

test('event text truncation never tears a surrogate pair', () => {
  // Review F8: a clip boundary landing inside an astral-plane character must not emit a lone
  // surrogate (ill-formed string -> invalid UTF-8 on the wire).
  const body = `${'a'.repeat(4095)}😀${'b'.repeat(200)}`; // high surrogate sits exactly at index 4095
  const line = `{"type":"user","timestamp":"2026-07-08T12:00:00Z","message":{"role":"user","content":${JSON.stringify(body)}}}`;
  const ref = tmpFile('emoji.jsonl', `${line}\n`);
  const p = buildAgentStream({
    agentId: 'a',
    harness: 'claude-code',
    handleKind: 'task-id',
    handleValue: '',
    transcriptRef: ref,
  });
  const ev = p.events[0];
  assert.ok(ev?.truncated, 'the 4KiB cap applies');
  // Well-formedness: no unpaired surrogate anywhere in the clipped text (lib target predates
  // String#isWellFormed, so check with a lone-surrogate regex).
  const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  assert.doesNotMatch(ev.text, loneSurrogate, 'clipped text stays well-formed');
});

test('claude subagent stream resolves the derived subagents file from parent ref + task-id handle', () => {
  // Empirical layout (real orchestration transcripts): an in-session subagent (Task tool) does
  // NOT write into the parent transcript — it gets its own file at
  // `<parent-transcript-minus-.jsonl>/subagents/agent-<agentId>.jsonl`, same claude line format
  // with an `isSidechain:true` + `agentId` envelope. Registration recipe:
  // `ccm agent bind --handle task-id:<agentId> --transcript <parent-session.jsonl>`.
  const dir = mkdtempSync(join(tmpdir(), 'ccm-subagent-'));
  TMPDIRS.push(dir);
  const parentPath = join(dir, '102faf35-8308-4b30-ad47-52b9e10e06e7.jsonl');
  writeFileSync(
    parentPath,
    `${[
      '{"parentUuid":null,"isSidechain":false,"type":"user","timestamp":"2026-07-16T15:00:00Z","message":{"role":"user","content":"orchestrate the demo"},"sessionId":"102faf35-8308-4b30-ad47-52b9e10e06e7"}',
      '{"parentUuid":"x","isSidechain":false,"type":"assistant","timestamp":"2026-07-16T15:00:05Z","message":{"role":"assistant","content":[{"type":"text","text":"parent line — must NOT stream under the subagent"}]}}',
    ].join('\n')}\n`,
    'utf8',
  );
  // Redacted sample of the real subagent file shape (envelope fields preserved).
  const subDir = join(dir, '102faf35-8308-4b30-ad47-52b9e10e06e7', 'subagents');
  mkdirSync(subDir, { recursive: true });
  const agentId = 'a94c182d71804bad4';
  writeFileSync(
    join(subDir, `agent-${agentId}.jsonl`),
    `${[
      `{"parentUuid":null,"isSidechain":true,"agentId":"${agentId}","sessionId":"102faf35-8308-4b30-ad47-52b9e10e06e7","type":"user","timestamp":"2026-07-16T15:01:00Z","message":{"role":"user","content":"Write and run md2html self-tests"},"userType":"agent"}`,
      `{"parentUuid":"y","isSidechain":true,"agentId":"${agentId}","type":"assistant","timestamp":"2026-07-16T15:01:10Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"tu1","name":"Read","input":{"file_path":"md2html.py"}}]}}`,
      `{"parentUuid":"z","isSidechain":true,"agentId":"${agentId}","type":"user","timestamp":"2026-07-16T15:01:12Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu1","content":"def md2html(text): ..."}]}}`,
      `{"parentUuid":"w","isSidechain":true,"agentId":"${agentId}","type":"assistant","timestamp":"2026-07-16T15:01:20Z","message":{"role":"assistant","content":[{"type":"text","text":"self-tests pass"}]}}`,
    ].join('\n')}\n`,
    'utf8',
  );

  const p = buildAgentStream({
    agentId: 'agt-sub',
    harness: 'claude-code',
    handleKind: 'task-id',
    handleValue: agentId,
    transcriptRef: parentPath,
  });
  assert.equal(p.source.kind, 'transcript');
  assert.ok(
    String(p.source.path).endsWith(`subagents/agent-${agentId}.jsonl`),
    'derived subagent file wins over the parent ref',
  );
  assert.deepEqual(
    p.events.map((e) => e.kind),
    ['user', 'tool', 'tool_result', 'assistant'],
  );
  assert.equal(p.events[3]?.text, 'self-tests pass');
  assert.ok(
    p.events.every((e) => !e.text.includes('parent line')),
    'no parent events leak into the subagent stream',
  );

  // Startup race / unknown agentId: derived file absent -> honest no-source. Falling back to the
  // parent transcript would misattribute the orchestrator's events to this subagent.
  const fallback = buildAgentStream({
    agentId: 'agt-sub2',
    harness: 'claude-code',
    handleKind: 'task-id',
    handleValue: 'anotheragentid000',
    transcriptRef: parentPath,
  });
  assert.equal(fallback.source.kind, 'none');
  assert.deepEqual(fallback.events, []);
  assert.match(fallback.source.reason ?? '', /subagent transcript.*not found/i);
});
