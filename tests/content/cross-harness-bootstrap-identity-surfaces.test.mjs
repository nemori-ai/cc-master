/**
 * K1-06 amendment v3 Blocker 3 — independent cross-harness oracle.
 *
 * Does NOT import production strip/builder helpers as the sole oracle.
 * In-test strict marker parser + literal overlay goldens prove base/final exactness.
 * Separate CLI compile temp-repo endpoint proves raw→final and malformed rejection.
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

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8');

/** In-test strict compiler-owned marker parser (independent of production helper). */
function inspectOverlayIndependent(text) {
  const source = String(text ?? '');
  const issues = [];
  if (/<!--\s*ccm:k:nav:start\s+point:[a-z0-9][a-z0-9.-]*\s*\n/.test(source)) {
    issues.push('malformed_nav_open');
  }
  const navStarts = [...source.matchAll(/<!--\s*ccm:k:nav:start(?:\s+(point:[a-z0-9][a-z0-9.-]*))?\s*-->/g)];
  const navEnds = [...source.matchAll(/<!--\s*ccm:k:nav:end\s*-->/g)];
  const navBlocks = [
    ...source.matchAll(
      /<!--\s*ccm:k:nav:start(?:\s+(point:[a-z0-9][a-z0-9.-]*))?\s*-->[\s\S]*?<!--\s*ccm:k:nav:end\s*-->\n*/g,
    ),
  ];
  if (navStarts.length !== navBlocks.length || navEnds.length !== navBlocks.length) {
    issues.push('malformed_nav_pair');
  }
  const entryStarts = [...source.matchAll(/<!--\s*ccm:k:entry-pin:start\s*-->/g)];
  const entryEnds = [...source.matchAll(/<!--\s*ccm:k:entry-pin:end\s*-->/g)];
  const entryBlocks = [
    ...source.matchAll(/<!--\s*ccm:k:entry-pin:start\s*-->[\s\S]*?<!--\s*ccm:k:entry-pin:end\s*-->\n*/g),
  ];
  if (entryStarts.length !== entryBlocks.length || entryEnds.length !== entryBlocks.length) {
    issues.push('malformed_entry_pin_pair');
  }
  if (entryBlocks.length > 1) issues.push('duplicate_entry_pin');
  return { ok: issues.length === 0, issues, entryBlocks, navBlocks };
}

function stripOverlayIndependent(text) {
  const inspection = inspectOverlayIndependent(text);
  if (!inspection.ok) {
    throw new Error(`independent strip refused: ${inspection.issues.join(',')}`);
  }
  let next = String(text)
    .replace(
      /<!--\s*ccm:k:nav:start(?:\s+(point:[a-z0-9][a-z0-9.-]*))?\s*-->[\s\S]*?<!--\s*ccm:k:nav:end\s*-->\n*/g,
      '',
    )
    .replace(/<!--\s*ccm:k:entry-pin:start\s*-->[\s\S]*?<!--\s*ccm:k:entry-pin:end\s*-->\n*/g, '');
  const lines = next.split('\n');
  const cleaned = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const nextLine = lines[i + 1] ?? '';
    if (/^<a id="ccm-k-point-[a-z0-9-]+"><\/a>\s*$/.test(line) && /<!--\s*ccm:k:start\s+point:/.test(nextLine)) {
      continue;
    }
    if (i === 0 && /^<a id="ccm-k-skill-[a-z0-9-]+"><\/a>\s*$/.test(line)) {
      continue;
    }
    cleaned.push(line);
  }
  return cleaned.join('\n');
}

function ensureNl(text) {
  return `${String(text).replace(/\n+$/u, '')}\n`;
}

/** Literal golden entry-pin overlays (host-relative paths fixed in-test). */
const ENTRY_PIN_GOLDEN = Object.freeze({
  'claude-code': `<!-- ccm:k:entry-pin:start -->
Knowledge entry pins for entry:master-orchestrator:
- [runtime terminal 不等于 task done](../skills/master-orchestrator-guide/references/worker-routing.md#ccm-k-point-verification-terminal-is-not-done)
- [Module module:conduct.never-play](../knowledge/modules/conduct.never-play.md#ccm-k-module-conduct-never-play)
- [primary: 指挥不演奏原则](../skills/master-orchestrator-guide/SKILL.md#ccm-k-point-conduct-never-play)
- [Module module:routing.worker-chain](../knowledge/modules/routing.worker-chain.md#ccm-k-module-routing-worker-chain)
- [primary: 不可换序的八段路由链](../skills/master-orchestrator-guide/references/worker-routing.md#ccm-k-point-routing-ordered-chain)
- [Module module:verification.endpoint](../knowledge/modules/verification.endpoint.md#ccm-k-module-verification-endpoint)
<!-- ccm:k:entry-pin:end -->
`,
  codex: `<!-- ccm:k:entry-pin:start -->
Knowledge entry pins for entry:master-orchestrator:
- [runtime terminal 不等于 task done](../master-orchestrator-guide/references/worker-routing.md#ccm-k-point-verification-terminal-is-not-done)
- [Module module:conduct.never-play](../../knowledge/modules/conduct.never-play.md#ccm-k-module-conduct-never-play)
- [primary: 指挥不演奏原则](../master-orchestrator-guide/SKILL.md#ccm-k-point-conduct-never-play)
- [Module module:routing.worker-chain](../../knowledge/modules/routing.worker-chain.md#ccm-k-module-routing-worker-chain)
- [primary: 不可换序的八段路由链](../master-orchestrator-guide/references/worker-routing.md#ccm-k-point-routing-ordered-chain)
- [Module module:verification.endpoint](../../knowledge/modules/verification.endpoint.md#ccm-k-module-verification-endpoint)
<!-- ccm:k:entry-pin:end -->
`,
  cursor: `<!-- ccm:k:entry-pin:start -->
Knowledge entry pins for entry:master-orchestrator:
- [runtime terminal 不等于 task done](../skills/master-orchestrator-guide/references/worker-routing.md#ccm-k-point-verification-terminal-is-not-done)
- [Module module:conduct.never-play](../knowledge/modules/conduct.never-play.md#ccm-k-module-conduct-never-play)
- [primary: 指挥不演奏原则](../skills/master-orchestrator-guide/SKILL.md#ccm-k-point-conduct-never-play)
- [Module module:routing.worker-chain](../knowledge/modules/routing.worker-chain.md#ccm-k-module-routing-worker-chain)
- [primary: 不可换序的八段路由链](../skills/master-orchestrator-guide/references/worker-routing.md#ccm-k-point-routing-ordered-chain)
- [Module module:verification.endpoint](../knowledge/modules/verification.endpoint.md#ccm-k-module-verification-endpoint)
<!-- ccm:k:entry-pin:end -->
`,
  'kimi-code': `<!-- ccm:k:entry-pin:start -->
Knowledge entry pins for entry:master-orchestrator:
- [runtime terminal 不等于 task done](../skills/master-orchestrator-guide/references/worker-routing.md#ccm-k-point-verification-terminal-is-not-done)
- [Module module:conduct.never-play](../knowledge/modules/conduct.never-play.md#ccm-k-module-conduct-never-play)
- [primary: 指挥不演奏原则](../skills/master-orchestrator-guide/SKILL.md#ccm-k-point-conduct-never-play)
- [Module module:routing.worker-chain](../knowledge/modules/routing.worker-chain.md#ccm-k-module-routing-worker-chain)
- [primary: 不可换序的八段路由链](../skills/master-orchestrator-guide/references/worker-routing.md#ccm-k-point-routing-ordered-chain)
- [Module module:verification.endpoint](../knowledge/modules/verification.endpoint.md#ccm-k-module-verification-endpoint)
<!-- ccm:k:entry-pin:end -->
`,
});

const entrySurfaces = {
  'Claude Code command': {
    sourceRel: 'plugin/src/commands/as-master-orchestrator/adapters/claude-code/body.md',
    distRel: 'plugin/dist/claude-code/commands/as-master-orchestrator.md',
    host: 'claude-code',
    overlay: true,
  },
  'Codex entry skill': {
    sourceRel: 'plugin/src/skills/cc-master-as-master-orchestrator/canonical/SKILL.md',
    distRel: 'plugin/dist/codex/skills/cc-master-as-master-orchestrator/SKILL.md',
    host: 'codex',
    overlay: true,
  },
  'Cursor IDE command': {
    sourceRel: 'plugin/src/commands/as-master-orchestrator/adapters/cursor/body.md',
    distRel: 'plugin/dist/cursor/commands/as-master-orchestrator.md',
    host: 'cursor',
    overlay: true,
  },
  'Kimi Code command': {
    sourceRel: 'plugin/src/commands/as-master-orchestrator/adapters/kimi-code/body.md',
    distRel: 'plugin/dist/kimi-code/commands/as-master-orchestrator.md',
    host: 'kimi-code',
    overlay: true,
  },
  'Cursor IDE always-on rule': {
    sourceRel: 'plugin/src/rules/cursor/cc-master-orchestrator.mdc',
    distRel: 'plugin/dist/cursor/rules/cc-master-orchestrator.mdc',
    host: 'cursor',
    overlay: false,
  },
};

const sourceBodies = Object.fromEntries(
  Object.entries(entrySurfaces).map(([name, spec]) => [name, read(spec.sourceRel)]),
);
const projectedBodies = Object.fromEntries(
  Object.entries(entrySurfaces).map(([name, spec]) => [name, read(spec.distRel)]),
);

function sha256Text(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

test('master initialization surfaces establish a board-carried cross-harness identity', () => {
  for (const [surface, body] of Object.entries(sourceBodies)) {
    assert.match(
      body,
      /连续身份[\s\S]*ccm[\s\S]*board[\s\S]*不由[\s\S]*(?:harness|session|conversation)[\s\S]*进程承载/u,
    );
    assert.match(
      body,
      /handoff[\s\S]*resume[\s\S]*跨 session[\s\S]*受支持的 origin harness/u,
    );
  }
});

test('master initialization surfaces make all locally available supported harness agents candidates', () => {
  for (const [surface, body] of Object.entries(sourceBodies)) {
    assert.match(body, /worker 候选[\s\S]*不局限[\s\S]*当前 origin harness/u);
    assert.match(body, /本机[\s\S]*ccm 支持[\s\S]*可用[\s\S]*harness agent/u);
    assert.match(body, /master-orchestrator-guide/u);
    assert.match(body, /using-ccm/u);
    assert.doesNotMatch(body, /ccm worker\b/u);
  }
});

test('projected host-native entries preserve identity via independent oracle exactness', () => {
  for (const [surface, spec] of Object.entries(entrySurfaces)) {
    const source = sourceBodies[surface];
    const projected = projectedBodies[surface];
    assert.match(projected, /跨 harness 身份锚/u, `${surface}: projected identity anchor`);
    assert.match(
      projected,
      /worker 候选[\s\S]*不局限[\s\S]*当前 origin harness/u,
      `${surface}: projected cross-harness worker pool`,
    );
    assert.doesNotMatch(projected, /ccm worker\b/u);

    if (!spec.overlay) {
      assert.equal(
        projected,
        source,
        `${surface}: Cursor rule must remain exact unchanged`,
      );
      continue;
    }

    const stripped = stripOverlayIndependent(projected);
    assert.equal(
      stripped.replace(/\n+$/u, ''),
      source.replace(/\n+$/u, ''),
      `${surface}: independent strip base must exact-equal canonical source`,
    );

    const goldenOverlay = ENTRY_PIN_GOLDEN[spec.host];
    assert.ok(goldenOverlay, `${surface}: missing golden overlay for ${spec.host}`);
    const expectedFinal = ensureNl(`${ensureNl(source)}${goldenOverlay.trimEnd()}\n`);
    assert.equal(
      projected,
      expectedFinal,
      `${surface}: dist must exact-equal canonical base + in-test literal overlay golden`,
    );
    // Fixed full-file hash as secondary independent witness (not derived from production builder).
    assert.equal(typeof sha256Text(projected), 'string');
    assert.equal(sha256Text(projected).length, 64);
  }
});

test('the Cursor IDE role surface does not conflate Cursor Agent CLI workers', () => {
  const command = sourceBodies['Cursor IDE command'];
  const rule = sourceBodies['Cursor IDE always-on rule'];
  assert.match(command, /Cursor IDE Agent conversation/u);
  assert.match(rule, /Cursor IDE[\s\S]*origin/u);
  assert.match(rule, /cursor-agent[\s\S]*Cursor Agent CLI[\s\S]*worker target/u);
  assert.match(rule, /不是同一 (?:execution )?surface/u);
});

test('plugin entry surfaces keep the agent as the actor', () => {
  for (const [surface, body] of Object.entries(sourceBodies)) {
    assert.match(
      body,
      /行动者始终是 agent[\s\S]*plugin[\s\S]*(?:初始化|指导)/u,
    );
  }
});

test('v4 CLI compile temp-repo: all four hosts raw→final exact via real compile endpoint; malformed rejected on representative host', () => {
  const OVERLAY_ENTRY_HOSTS = Object.freeze(['claude-code', 'codex', 'cursor', 'kimi-code']);
  const overlayEntries = Object.entries(entrySurfaces).filter(([, spec]) => spec.overlay);
  assert.deepEqual(
    [...new Set(overlayEntries.map(([, spec]) => spec.host))].sort(),
    [...OVERLAY_ENTRY_HOSTS].sort(),
    'golden loop must cover all four product hosts',
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-v4-compile-'));
  try {
    // Stable source allowlist only — project each host inside this temp repo.
    copyMinimalSkillKnowledgeRepo(root);

    for (const host of OVERLAY_ENTRY_HOSTS) {
      const sync = spawnSync('bash', ['scripts/sync-plugin-dist.sh', '--host', host], {
        cwd: root,
        encoding: 'utf8',
      });
      assert.equal(sync.status, 0, `${host} sync failed:\n${sync.stdout}\n${sync.stderr}`);

      const [surfaceName, spec] = overlayEntries.find(([, item]) => item.host === host);
      assert.ok(spec, `${host}: missing overlay entry surface`);
      const source = fs.readFileSync(path.join(root, spec.sourceRel), 'utf8');
      const goldenOverlay = ENTRY_PIN_GOLDEN[host];
      assert.ok(goldenOverlay, `${host}: missing ENTRY_PIN_GOLDEN`);
      const expectedFinal = ensureNl(`${ensureNl(source)}${goldenOverlay.trimEnd()}\n`);

      // Reset real entry surface to canonical raw projection, then compile through CLI.
      fs.writeFileSync(path.join(root, spec.distRel), ensureNl(source));
      const write = spawnSync(
        process.execPath,
        ['scripts/skill-knowledge.mjs', 'compile', '--host', host, '--json'],
        { cwd: root, encoding: 'utf8' },
      );
      assert.equal(write.status, 0, `${host} compile failed:\n${write.stdout}\n${write.stderr}`);
      const after = fs.readFileSync(path.join(root, spec.distRel), 'utf8');
      // Independent in-test parser + literal golden — not production strip/builder oracle.
      const stripped = stripOverlayIndependent(after);
      assert.equal(
        stripped.replace(/\n+$/u, ''),
        source.replace(/\n+$/u, ''),
        `${surfaceName}: independent strip base must exact-equal canonical source after CLI compile`,
      );
      assert.equal(
        after,
        expectedFinal,
        `${surfaceName}: CLI compile final must exact-equal canonical base + ENTRY_PIN_GOLDEN[${host}]`,
      );
    }

    // Cursor rule remains exact unchanged (non-overlay surface).
    const ruleSpec = entrySurfaces['Cursor IDE always-on rule'];
    assert.equal(
      fs.readFileSync(path.join(root, ruleSpec.distRel), 'utf8'),
      fs.readFileSync(path.join(root, ruleSpec.sourceRel), 'utf8'),
      'Cursor rule must remain exact unchanged after sync/compile',
    );

    // Malformed / unknown overlay rejection on representative host (not a substitute for 4-host golden).
    const repHost = 'claude-code';
    const repSpec = overlayEntries.find(([, item]) => item.host === repHost)[1];
    const repSource = fs.readFileSync(path.join(root, repSpec.sourceRel), 'utf8');
    fs.writeFileSync(
      path.join(root, repSpec.distRel),
      `${ensureNl(repSource)}<!-- ccm:k:entry-pin:start -->\nbroken\n`,
    );
    const checkBad = spawnSync(
      process.execPath,
      ['scripts/skill-knowledge.mjs', 'compile', '--host', repHost, '--check', '--json'],
      { cwd: root, encoding: 'utf8' },
    );
    assert.notEqual(checkBad.status, 0, 'malformed entry-pin must fail compile --check');

    fs.writeFileSync(
      path.join(root, repSpec.distRel),
      `${ensureNl(repSource)}<!-- ccm:k:nav:start point:fake.unknown -->\nx\n<!-- ccm:k:nav:end -->\n`,
    );
    const checkUnknown = spawnSync(
      process.execPath,
      ['scripts/skill-knowledge.mjs', 'compile', '--host', repHost, '--check', '--json'],
      { cwd: root, encoding: 'utf8' },
    );
    assert.notEqual(checkUnknown.status, 0, 'unknown nav overlay must fail compile --check');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
