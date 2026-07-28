#!/usr/bin/env node
/**
 * Apply compiler-owned final skill overlays to a projected skill tree.
 *
 * Used by sync staging and attestation updaters so the fingerprint target is
 * the final compiled runtime skill tree — not raw SAP.
 *
 * Usage (per-skill overlay):
 *   node scripts/skill-knowledge/apply-final-skill-overlay.mjs \
 *     --repo-root <abs> --host <host> --skill <name> \
 *     --staging-root <abs> --skill-tree <abs>
 *
 * Usage (skills-scoped entry pins, e.g. Codex skill_entry):
 *   node scripts/skill-knowledge/apply-final-skill-overlay.mjs \
 *     --repo-root <abs> --host <host> --entry-pins-only \
 *     --staging-root <abs> --skills-tree <abs>
 */
import path from 'node:path';
import {
  SkillOverlayError,
  applyFinalSkillOverlaysForSkill,
  applySkillsScopedEntryPins,
  assertControlledStagingContainment,
  assertSafeOverlayHost,
  assertSafeSkillSlug,
} from './compile/skill-overlay.mjs';
import { buildAndValidateGraph } from './graph.mjs';

function parseArgv(argv) {
  const values = Object.create(null);
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new SkillOverlayError(
        'SKG-OVERLAY-ARGV',
        `unexpected positional argument ${JSON.stringify(token)}`,
      );
    }
    if (token === '--entry-pins-only') {
      if (flags.has(token)) {
        throw new SkillOverlayError('SKG-OVERLAY-ARGV', `duplicate argument ${token}`);
      }
      flags.add(token);
      continue;
    }
    if (values[token] !== undefined || flags.has(token)) {
      throw new SkillOverlayError('SKG-OVERLAY-ARGV', `duplicate argument ${token}`);
    }
    if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) {
      throw new SkillOverlayError('SKG-OVERLAY-ARGV', `missing value for ${token}`);
    }
    values[token] = argv[index + 1];
    index += 1;
  }
  return { values, flags };
}

try {
  const { values, flags } = parseArgv(process.argv.slice(2));
  const entryPinsOnly = flags.has('--entry-pins-only');
  const repoRoot = path.resolve(values['--repo-root'] ?? '');
  if (!values['--repo-root'] || !values['--host'] || !values['--staging-root']) {
    throw new SkillOverlayError(
      'SKG-OVERLAY-ARGV',
      'missing required --repo-root / --host / --staging-root',
    );
  }
  const host = assertSafeOverlayHost(values['--host']);
  const stagingRoot = path.resolve(values['--staging-root']);

  if (entryPinsOnly) {
    if (!values['--skills-tree']) {
      throw new SkillOverlayError(
        'SKG-OVERLAY-ARGV',
        'missing required --skills-tree for --entry-pins-only',
      );
    }
    if (values['--skill'] || values['--skill-tree']) {
      throw new SkillOverlayError(
        'SKG-OVERLAY-ARGV',
        '--entry-pins-only does not accept --skill / --skill-tree',
      );
    }
    const skillsTree = path.resolve(values['--skills-tree']);
    const containment = assertControlledStagingContainment({
      repoRootAbsolute: repoRoot,
      stagingRootAbsolute: stagingRoot,
      skillTreeAbsolute: skillsTree,
    });
    const built = buildAndValidateGraph({
      repoRoot: containment.repoAbsolute,
      sourceRoot: 'plugin/src/knowledge',
    });
    if (!built.graph || !built.ok) {
      throw new SkillOverlayError(
        'SKG-OVERLAY-GRAPH-UNAVAILABLE',
        'Cannot apply skills-scoped entry pins because the authored graph failed validation.',
        {
          diagnostics: (built.diagnostics ?? []).map((item) => item.code),
        },
      );
    }
    const result = applySkillsScopedEntryPins({
      repoRoot: containment.repoAbsolute,
      host,
      graph: built.graph,
      skillsTreeAbsolute: skillsTree,
      stagingRootAbsolute: containment.stagingAbsolute,
    });
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
  } else {
    for (const flag of ['--skill', '--skill-tree']) {
      if (!values[flag]) {
        throw new SkillOverlayError(
          'SKG-OVERLAY-ARGV',
          `missing required argument ${flag}`,
        );
      }
    }
    if (values['--skills-tree']) {
      throw new SkillOverlayError(
        'SKG-OVERLAY-ARGV',
        'per-skill overlay does not accept --skills-tree (use --entry-pins-only)',
      );
    }
    const skill = assertSafeSkillSlug(values['--skill']);
    const skillTree = path.resolve(values['--skill-tree']);
    const containment = assertControlledStagingContainment({
      repoRootAbsolute: repoRoot,
      stagingRootAbsolute: stagingRoot,
      skillTreeAbsolute: skillTree,
    });
    const result = await applyFinalSkillOverlaysForSkill({
      repoRoot: containment.repoAbsolute,
      host,
      skillName: skill,
      skillTreeAbsolute: skillTree,
      stagingRootAbsolute: containment.stagingAbsolute,
    });
    if (result?.skipped) {
      throw new SkillOverlayError(
        'SKG-OVERLAY-SKIPPED',
        'overlay returned skipped; callers must refuse skipped/error results',
        { result },
      );
    }
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
