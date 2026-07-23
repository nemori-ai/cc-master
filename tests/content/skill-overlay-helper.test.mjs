/**
 * Unit + integration coverage for compiler-owned skill overlay helper (K1-06).
 * Covers fail-closed malformed/extra/duplicate strip, skills-only independence from
 * command surfaces, and expected final bytes builders.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  SkillOverlayError,
  applyFinalSkillOverlaysForSkill,
  buildExpectedEntrySurfaceBytes,
  inspectCompilerOwnedOverlay,
  stripCompilerOwnedOverlay,
} from '../../scripts/skill-knowledge/compile/skill-overlay.mjs';
import { buildAndValidateGraph } from '../../scripts/skill-knowledge/graph.mjs';
import { withIsolatedSkillKnowledgeRepo } from './helpers/skill-knowledge-isolated-repo.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const WELL_FORMED = `# title

<!-- ccm:k:start point:conduct.never-play -->
body
<!-- ccm:k:end point:conduct.never-play -->
<!-- ccm:k:nav:start point:conduct.never-play -->
Knowledge navigation:
- [Knowledge atlas](../knowledge/atlas.md)
<!-- ccm:k:nav:end -->

<!-- ccm:k:entry-pin:start -->
Knowledge entry pins for entry:master-orchestrator:
- [x](../skills/master-orchestrator-guide/SKILL.md#ccm-k-point-conduct-never-play)
<!-- ccm:k:entry-pin:end -->
`;

test('stripCompilerOwnedOverlay recovers base from well-formed overlays', () => {
  const stripped = stripCompilerOwnedOverlay(WELL_FORMED);
  assert.doesNotMatch(stripped, /ccm:k:nav:/);
  assert.doesNotMatch(stripped, /ccm:k:entry-pin:/);
  assert.match(stripped, /ccm:k:start point:conduct\.never-play/);
  assert.match(stripped, /ccm:k:end point:conduct\.never-play/);
});

test('malformed / extra / duplicate overlays fail closed (never silently swallowed)', () => {
  const cases = [
    {
      label: 'malformed nav open',
      text: '<!-- ccm:k:nav:start point:conduct.never-play\nKnowledge\n<!-- ccm:k:nav:end -->\n',
    },
    {
      label: 'duplicate nav',
      text: `${WELL_FORMED}\n<!-- ccm:k:nav:start point:conduct.never-play -->\nx\n<!-- ccm:k:nav:end -->\n`,
    },
    {
      label: 'duplicate entry pin',
      text: `${WELL_FORMED}\n<!-- ccm:k:entry-pin:start -->\ny\n<!-- ccm:k:entry-pin:end -->\n`,
    },
    {
      label: 'extra orphan nav end',
      text: 'body\n<!-- ccm:k:nav:end -->\n',
    },
    {
      label: 'extra point anchor',
      text: '<a id="ccm-k-point-conduct-never-play"></a>\nnot-a-start\n',
    },
  ];
  for (const item of cases) {
    const inspection = inspectCompilerOwnedOverlay(item.text);
    assert.equal(inspection.ok, false, `${item.label} must be flagged`);
    assert.throws(
      () => stripCompilerOwnedOverlay(item.text),
      (error) => error instanceof SkillOverlayError && error.code === 'SKG-OVERLAY-MALFORMED',
      `${item.label} must throw SkillOverlayError`,
    );
  }
});

test('skills-only final overlay does not require command surfaces', async () => {
  await withIsolatedSkillKnowledgeRepo(
    async ({ repoRoot: iso, runCli }) => {
      const skillsOnly = spawnSync(
        'bash',
        ['scripts/sync-plugin-dist.sh', '--host', 'claude-code', '--skills-only'],
        { cwd: iso, encoding: 'utf8' },
      );
      assert.equal(
        skillsOnly.status,
        0,
        `--skills-only must succeed without command surfaces\n${skillsOnly.stdout}\n${skillsOnly.stderr}`,
      );

      const skillMd = fs.readFileSync(
        path.join(iso, 'plugin/dist/claude-code/skills/master-orchestrator-guide/SKILL.md'),
        'utf8',
      );
      assert.match(skillMd, /ccm:k:nav:start point:conduct\.never-play/);
      assert.match(skillMd, /ccm-k-skill-master-orchestrator-guide/);
      assert.equal(
        fs.existsSync(path.join(iso, 'plugin/dist/claude-code/commands')),
        false,
        'skills-only must not recreate command surfaces',
      );
      assert.equal(
        fs.existsSync(path.join(iso, 'plugin/dist/claude-code/knowledge')),
        false,
        'skills-only must not invoke full compile atlas/module emission',
      );

      // Full compile still requires commands — prove the surfaces are independent.
      const full = runCli(['compile', '--host', 'claude-code', '--json']);
      assert.notEqual(full.status, 0, 'full compile without commands must fail closed');
    },
  );
});

test('shared builder expected entry bytes match compiled dist for Claude command', () => {
  const built = buildAndValidateGraph({ repoRoot });
  assert.ok(built.ok && built.graph);
  const sourceFile =
    'plugin/src/commands/as-master-orchestrator/adapters/claude-code/body.md';
  const raw = fs.readFileSync(path.join(repoRoot, sourceFile), 'utf8');
  const expected = buildExpectedEntrySurfaceBytes({
    rawText: raw,
    host: 'claude-code',
    graph: built.graph,
    sourceFile,
  });
  const actual = fs.readFileSync(
    path.join(repoRoot, 'plugin/dist/claude-code/commands/as-master-orchestrator.md'),
    'utf8',
  );
  assert.equal(actual, expected);
  const stripped = stripCompilerOwnedOverlay(actual);
  assert.equal(stripped, raw.endsWith('\n') ? raw : `${raw}\n`);
});

test('applyFinalSkillOverlaysForSkill is idempotent on a projected skill tree', async () => {
  await withIsolatedSkillKnowledgeRepo(async ({ repoRoot: iso }) => {
    const sync = spawnSync(
      'bash',
      ['scripts/sync-plugin-dist.sh', '--host', 'claude-code', '--skills-only'],
      { cwd: iso, encoding: 'utf8' },
    );
    assert.equal(sync.status, 0, `skills-only project failed:\n${sync.stdout}\n${sync.stderr}`);

    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-overlay-idem-'));
    try {
      fs.cpSync(
        path.join(iso, 'plugin/dist/claude-code/skills/master-orchestrator-guide'),
        staging,
        { recursive: true },
      );
      // Start from stripped base to mimic raw SAP.
      for (const file of ['SKILL.md', 'references/worker-routing.md', 'references/resume-verify.md']) {
        const absolute = path.join(staging, file);
        if (!fs.existsSync(absolute)) continue;
        const stripped = stripCompilerOwnedOverlay(fs.readFileSync(absolute, 'utf8'));
        fs.writeFileSync(absolute, stripped);
      }
      await applyFinalSkillOverlaysForSkill({
        repoRoot: iso,
        host: 'claude-code',
        skillName: 'master-orchestrator-guide',
        skillTreeAbsolute: staging,
      });
      const first = fs.readFileSync(path.join(staging, 'SKILL.md'), 'utf8');
      await applyFinalSkillOverlaysForSkill({
        repoRoot: iso,
        host: 'claude-code',
        skillName: 'master-orchestrator-guide',
        skillTreeAbsolute: staging,
      });
      const second = fs.readFileSync(path.join(staging, 'SKILL.md'), 'utf8');
      assert.equal(second, first);
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  });
});
