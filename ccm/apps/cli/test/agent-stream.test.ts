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
