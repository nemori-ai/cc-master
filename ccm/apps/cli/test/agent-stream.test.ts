import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

// Walk backward from the tail to the file head, prepending each page.
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
  for (let guard = 0; guard < 10000 && !atStart; guard++) {
    const page = buildAgentStream({
      agentId: 'a',
      harness,
      handleKind: 'task-id',
      handleValue: '',
      transcriptRef: ref,
      beforeParam: String(before),
    });
    events.unshift(...page.events);
    if (page.cursor.prev === before) break;
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
