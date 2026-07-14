import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { runProduction } from '../src/production-run.js';

const roots: string[] = [];
after(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const clone = <T>(value: T): T => structuredClone(value);

function fixture(): any {
  return JSON.parse(
    readFileSync(
      join(
        dirname(new URL(import.meta.url).pathname),
        '../../../packages/engine/test/fixtures/native-attempt/codex-api-tool-v1.json',
      ),
      'utf8',
    ),
  );
}

function invoke(boardPath: string, home: string, command: any, extra: Record<string, unknown> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = runProduction(
    [
      'task',
      'native-attempt-create',
      command.task_id,
      '--selection',
      JSON.stringify(command.selection_snapshot),
      '--attempt',
      JSON.stringify(command.attempt),
      '--replay-intent',
      command.replay_intent,
      '--board',
      boardPath,
      '--home',
      home,
      '--json',
    ],
    {
      out: (value: string) => out.push(value),
      err: (value: string) => err.push(value),
      env: {
        CC_MASTER_HOME: home,
        CC_MASTER_HARNESS: 'codex',
        CODEX_SESSION_ID: 'session-ref:fixture-origin',
        CC_MASTER_STATUSLINE_AUTO_INSTALL: '0',
      },
      ...extra,
    } as any,
  );
  assert.equal(typeof code, 'number');
  return { code, out, err };
}

test('R1 runProduction composes owner launch authority without a RunOpts resolver', () => {
  const value = fixture();
  const root = mkdtempSync(join(tmpdir(), 'ccm-native-production-r1-'));
  roots.push(root);
  const home = join(root, 'home');
  const boardPath = join(root, 'native.board.json');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(boardPath, `${JSON.stringify(value.initial_board, null, 2)}\n`);

  const command = clone(value.commands.create);
  command.attempt.dispatch.input_hash =
    'sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  const admissionDir = join(home, 'native-attempt', 'v1', 'admissions');
  mkdirSync(admissionDir, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(admissionDir, `${createHash('sha256').update(command.attempt.dispatch.key).digest('hex')}.json`),
    `${JSON.stringify({ schema: 'ccm/native-launch-authority/v1', red_fixture: true })}\n`,
    { mode: 0o600 },
  );

  const before = readFileSync(boardPath, 'utf8');
  const result = invoke(boardPath, home, command);
  assert.equal(result.code, 0, result.err.join('\n'));
  assert.notEqual(readFileSync(boardPath, 'utf8'), before);
});

test('R1 runProduction never treats an injected resolver as production evidence', () => {
  const value = fixture();
  const root = mkdtempSync(join(tmpdir(), 'ccm-native-production-injection-r1-'));
  roots.push(root);
  const home = join(root, 'home');
  const boardPath = join(root, 'native.board.json');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(boardPath, `${JSON.stringify(value.initial_board, null, 2)}\n`);
  const command = clone(value.commands.create);
  const before = readFileSync(boardPath, 'utf8');
  const result = invoke(boardPath, home, command, {
    nativeAttemptAdmission: {
      resolveCreate: () => clone(command.admission_snapshot),
      resolveControl: () => clone(value.commands.cancel.authority_snapshot),
    },
  });
  assert.notEqual(result.code, 0);
  assert.equal(readFileSync(boardPath, 'utf8'), before);
});
