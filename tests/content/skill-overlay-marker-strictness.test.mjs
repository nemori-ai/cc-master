/**
 * Blocker B mutations — strict compiler-owned marker validation at real endpoints.
 *
 * Expected bytes come from an in-test oracle (fixed strings / independent rebuild),
 * never from scripts/skill-knowledge/compile/skill-overlay.mjs builders.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { copyMinimalSkillKnowledgeRepo } from './helpers/skill-knowledge-isolated-repo.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HOST = 'claude-code';
/** Independent oracle: nav block must contain these exact substrings for conduct.never-play. */
const ORACLE_NAV_REQUIRED = Object.freeze([
  '<!-- ccm:k:nav:start point:conduct.never-play -->',
  'Knowledge navigation:',
  '<!-- ccm:k:nav:end -->',
]);

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-marker-'));
  copyMinimalSkillKnowledgeRepo(root);
  return root;
}

function runCli(root, args) {
  return spawnSync(process.execPath, ['scripts/skill-knowledge.mjs', ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

function syncAll(root) {
  return spawnSync('bash', ['scripts/sync-plugin-dist.sh', '--host', HOST], {
    cwd: root,
    encoding: 'utf8',
  });
}

function parseJson(result) {
  const text = `${result.stdout || ''}\n${result.stderr || ''}`;
  const start = text.indexOf('{');
  if (start < 0) {
    return { ok: false, raw: text, status: result.status };
  }
  try {
    return { ...JSON.parse(text.slice(start)), status: result.status };
  } catch {
    return { ok: false, raw: text, status: result.status };
  }
}

function skillMdPath(root) {
  return path.join(root, `plugin/dist/${HOST}/skills/master-orchestrator-guide/SKILL.md`);
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

test('unknown well-formed nav on compiled skill hard-fails compile --check/--write', () => {
  const root = fixture();
  try {
    assert.equal(syncAll(root).status, 0);
    assert.equal(parseJson(runCli(root, ['compile', '--host', HOST, '--json'])).ok, true);

    const skillMd = skillMdPath(root);
    const original = fs.readFileSync(skillMd, 'utf8');
    const beforeHash = sha256Text(original);
    // Insert an extra well-formed nav for a fabricated point id (not in plan).
    const hostile = `${original}\n<!-- ccm:k:nav:start point:fabricated.unknown-point -->\nKnowledge navigation:\n- [x](./x.md)\n<!-- ccm:k:nav:end -->\n`;
    fs.writeFileSync(skillMd, hostile);

    const check = parseJson(runCli(root, ['compile', '--host', HOST, '--check', '--json']));
    assert.equal(check.ok, false, 'unknown well-formed nav must fail check');
    assert.notEqual(check.status, 0);

    const write = parseJson(runCli(root, ['compile', '--host', HOST, '--json']));
    assert.equal(write.ok, false, 'unknown well-formed nav must fail write (no silent strip)');
    assert.equal(sha256Text(fs.readFileSync(skillMd, 'utf8')), sha256Text(hostile));
    // Restore would be wrong — prove bytes were not silently "fixed".
    assert.notEqual(sha256Text(fs.readFileSync(skillMd, 'utf8')), beforeHash);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('wrong leading skill anchor id hard-fails compile', () => {
  const root = fixture();
  try {
    assert.equal(syncAll(root).status, 0);
    assert.equal(parseJson(runCli(root, ['compile', '--host', HOST, '--json'])).ok, true);
    const skillMd = skillMdPath(root);
    let text = fs.readFileSync(skillMd, 'utf8');
    text = text.replace(
      '<a id="ccm-k-skill-master-orchestrator-guide"></a>',
      '<a id="ccm-k-skill-wrong-skill"></a>',
    );
    fs.writeFileSync(skillMd, text);
    const check = parseJson(runCli(root, ['compile', '--host', HOST, '--check', '--json']));
    assert.equal(check.ok, false, 'wrong skill anchor must fail');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('point anchor id mismatched against start marker hard-fails', () => {
  const root = fixture();
  try {
    assert.equal(syncAll(root).status, 0);
    assert.equal(parseJson(runCli(root, ['compile', '--host', HOST, '--json'])).ok, true);
    const skillMd = skillMdPath(root);
    let text = fs.readFileSync(skillMd, 'utf8');
    // Corrupt the anchor id that must precede ccm:k:start point:conduct.never-play
    text = text.replace(
      '<a id="ccm-k-point-conduct-never-play"></a>\n<!-- ccm:k:start point:conduct.never-play -->',
      '<a id="ccm-k-point-wrong-id"></a>\n<!-- ccm:k:start point:conduct.never-play -->',
    );
    fs.writeFileSync(skillMd, text);
    const check = parseJson(runCli(root, ['compile', '--host', HOST, '--check', '--json']));
    assert.equal(check.ok, false, 'anchor/start id mismatch must fail');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('malformed nav start (missing -->) hard-fails; never silently stripped', () => {
  const root = fixture();
  try {
    assert.equal(syncAll(root).status, 0);
    assert.equal(parseJson(runCli(root, ['compile', '--host', HOST, '--json'])).ok, true);
    const skillMd = skillMdPath(root);
    const original = fs.readFileSync(skillMd, 'utf8');
    const hostile = `${original}\n<!-- ccm:k:nav:start point:conduct.never-play\nKnowledge\n<!-- ccm:k:nav:end -->\n`;
    fs.writeFileSync(skillMd, hostile);
    const write = parseJson(runCli(root, ['compile', '--host', HOST, '--json']));
    assert.equal(write.ok, false);
    assert.match(fs.readFileSync(skillMd, 'utf8'), /ccm:k:nav:start point:conduct\.never-play\n/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('legitimate full compile keeps oracle nav substrings + terminal newline + idempotent', () => {
  const root = fixture();
  try {
    assert.equal(syncAll(root).status, 0);
    const first = parseJson(runCli(root, ['compile', '--host', HOST, '--json']));
    assert.equal(first.ok, true, JSON.stringify(first.diagnostics, null, 2));
    const skillMd = skillMdPath(root);
    const once = fs.readFileSync(skillMd, 'utf8');
    for (const needle of ORACLE_NAV_REQUIRED) {
      assert.ok(once.includes(needle), `oracle missing: ${needle}`);
    }
    assert.ok(once.endsWith('\n'), 'terminal newline required');
    // Independent oracle: skill anchor must be first non-empty structural line.
    assert.match(once, /^<a id="ccm-k-skill-master-orchestrator-guide"><\/a>\n/);

    const second = parseJson(runCli(root, ['compile', '--host', HOST, '--json']));
    assert.equal(second.ok, true);
    assert.equal(fs.readFileSync(skillMd, 'utf8'), once, 'compile must be idempotent');

    const check = parseJson(runCli(root, ['compile', '--host', HOST, '--check', '--json']));
    assert.equal(check.ok, true, JSON.stringify(check.diagnostics, null, 2));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('emit must not expose failClosed:false / stripGeneratedBlocks lenient alias', () => {
  const emitPath = path.join(repoRoot, 'scripts/skill-knowledge/compile/emit.mjs');
  const overlayPath = path.join(repoRoot, 'scripts/skill-knowledge/compile/skill-overlay.mjs');
  const emit = fs.readFileSync(emitPath, 'utf8');
  const overlay = fs.readFileSync(overlayPath, 'utf8');
  assert.doesNotMatch(emit, /stripGeneratedBlocks/);
  assert.doesNotMatch(emit, /failClosed:\s*false/);
  assert.doesNotMatch(overlay, /export function stripGeneratedBlocks/);
  assert.doesNotMatch(overlay, /failClosed:\s*false/);
});
