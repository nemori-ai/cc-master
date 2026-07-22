import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const ROOT = join(import.meta.dirname, '..', '..');
const HOSTS = ['claude-code', 'codex', 'cursor', 'kimi-code'];
const GUIDE = 'plugin/src/skills/using-ccm/canonical/references/board-model-guide.md';
const CATALOG = 'plugin/src/skills/using-ccm/canonical/references/command-catalog.md';
const IDENTITY_IMPL = 'ccm/apps/cli/src/worker-identity.ts';
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

function section(text, start, end) {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `missing section start: ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing section end: ${end}`);
  return text.slice(from, to);
}

function assertClaudeTrackedIdentityContract(text, label) {
  assert.match(
    text,
    /Claude Code[^\n]*(?:显式|explicit)[^\n]*`?--session-id`?/iu,
    `${label}: explicit Claude session identity`,
  );
  assert.match(
    text,
    /Claude Code[^\n]*(?:--output-format[^\n]*(?:json|stream-json)|(?:json|stream-json)[^\n]*--output-format)[^\n]*(?:type=result|`type=result`)[^\n]*(?:session_id|session id)/iu,
    `${label}: strict declared Claude result envelope`,
  );
  assert.match(
    text,
    /Claude Code[^\n]*(?:transcript|会话文件)[^\n]*(?:claude --resume|resume attach)|(?:claude --resume|resume attach)[^\n]*Claude Code/iu,
    `${label}: Claude transcript and resume attach`,
  );
  assert.match(
    text,
    /(?:不从任意模型文本猜|never guesses identity from model text)/iu,
    `${label}: Claude identity is never guessed from model text`,
  );
  assert.match(
    text,
    /(?:(?:未观察|无证据|尚未取得)[^\n]*(?:仍[^\n]*(?:PID|pid)|(?:PID|pid)[^\n]*(?:保持|仍))|without proven(?: session)? evidence[^\n]*remains?[^\n]*(?:PID|pid))/iu,
    `${label}: no evidence stays PID-only`,
  );
}

function assertClaudeIndependentTranscriptContract(text, label) {
  assert.match(
    text,
    /(?:PID-only[^\n]*(?:identity\/attach|identity[^\n]*attach)[^\n]*(?:typed )?unavailable|identity\/attach[^\n]*(?:typed )?unavailable[^\n]*PID-only)/iu,
    `${label}: missing session keeps PID-only identity/attach unavailable`,
  );
  assert.match(
    text,
    /(?:显式|explicit)[^\n]*`?--transcript`?[^\n]*(?:可读|readable)[^\n]*transcript[^\n]*(?:typed )?supported|(?:显式|explicit)[^\n]*(?:可读|readable)[^\n]*`?--transcript`?[^\n]*transcript[^\n]*(?:typed )?supported/iu,
    `${label}: readable explicit transcript is independently supported`,
  );
  assert.match(
    text,
    /(?:没有|未提供|no)[^\n]*(?:可读|readable)[^\n]*`?--transcript`?[^\n]*transcript[^\n]*(?:typed )?unavailable/iu,
    `${label}: transcript is unavailable only without readable explicit evidence`,
  );
  assert.doesNotMatch(
    text,
    /identity\/transcript\/attach[^\n]*(?:typed )?`?unavailable`?|PID-only[^\n]*typed unavailable capabilities/iu,
    `${label}: transcript must not be coupled to missing session identity`,
  );
}

test('implementation and command catalog prove transcript evidence is independent of session identity', () => {
  const implementation = section(
    read(IDENTITY_IMPL),
    'export function initialWorkerCapabilities(',
    '\nfunction nonempty(',
  );
  const transcriptDecision = implementation.indexOf('const transcript:');
  const harnessDecision = implementation.indexOf("if (harness === 'cursor-agent')");
  assert.ok(transcriptDecision >= 0 && transcriptDecision < harnessDecision);
  assert.match(implementation, /transcriptRef: evidence\.transcriptRef/u);
  assert.match(
    implementation,
    /const transcript:[\s\S]*?location\s*\?\s*\{ status: 'supported', value: \{ path: location\.path \} \}[\s\S]*?return \{[\s\S]*?identity: initialIdentityCapability\(harness\),[\s\S]*?transcript,[\s\S]*?attach:/u,
  );

  const catalog = section(read(CATALOG), '### worker dispatch', '\n---');
  assert.match(catalog, /`--transcript`[^\n]*已存在、可读[^\n]*只读 stream 证据/u);
  assert.match(catalog, /两者都没有或不可读[^\n]*source\.kind="none"/u);
});

test('canonical guide documents proven Claude identity enrichment without guessing', () => {
  const guide = read(GUIDE);
  assertClaudeTrackedIdentityContract(guide, GUIDE);
  assertClaudeIndependentTranscriptContract(guide, GUIDE);
  assert.doesNotMatch(
    guide,
    /Claude Code 与 Cursor[^\n]*(?:session|transcript|attach)[^\n]*`unsupported`/iu,
    'Claude Code must not be grouped with Cursor as unsupported',
  );
});

test('release notes match the implemented Claude tracked-dispatch contract', () => {
  for (const path of ['ccm/.changeset/tracked-worker-dispatch.md', 'CHANGELOG.md']) {
    const body = read(path);
    assertClaudeTrackedIdentityContract(body, path);
    assertClaudeIndependentTranscriptContract(body, path);
    assert.doesNotMatch(body, /only proven Codex\/Kimi session evidence/iu, path);
    assert.doesNotMatch(body, /Claude Code 与 Cursor[^\n]*typed unsupported/iu, path);
  }
});

test('all four rendered using-ccm guides preserve the Claude tracked-dispatch contract', () => {
  for (const host of HOSTS) {
    const path = `plugin/dist/${host}/skills/using-ccm/references/board-model-guide.md`;
    const guide = read(path);
    assertClaudeTrackedIdentityContract(guide, path);
    assertClaudeIndependentTranscriptContract(guide, path);
  }
});
