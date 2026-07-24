#!/usr/bin/env node
'use strict';

// Regenerate plugin/src/skills/provider-guidance-runtime.json as v2 dual-manifest
// registry (accepted_sap + accepted_final).
//
// Atomic audited migration / regen (fail closed; registry bytes untouched until success):
//   1. In controlled no-symlink `.tmp/ccm-provider-guidance-*` staging, project the
//      FULL host runtime skills tree (same skill set as sync — every non-_ skill
//      with a projectable strategy; skip only mode:planned).
//   2. Strict inspect: every guidance skill raw SAP has zero compiler-owned overlays.
//   3. Fingerprint accepted_sap for the three provider-guidance skills only.
//   4. Copy the full raw skills tree → final workspace.
//   5. Apply trusted compiler per-skill overlays to every projected skill, then
//      skills-scoped entry pins on the whole skills tree (same bridges as sync).
//   6. Fingerprint accepted_final for the three provider-guidance skills only.
//   7. If migrating from v1: each accepted_final must exact-equal the old v1 manifest.
//   8. Independently rebuild a second dual-manifest set and require byte-stable equality
//      with the first (sap + final).
//   9. ONLY THEN: single atomicWriteJson. Any failure before step 9 leaves original
//      registry bytes completely untouched (no write-then-restore).
//
// Never read checked-in plugin/dist. Never fingerprint raw SAP as final.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  HOSTS,
  REGISTRY_SCHEMA,
  REGISTRY_SCHEMA_V1,
  SKILLS,
  assertManifestsExactEqual,
  assertRawSapTreeClean,
  atomicWriteJson,
  loadProviderGuidanceRegistry,
  providerGuidanceRuntimeManifest,
  registryBytesSha256,
  validateProviderModelFactsRegistry,
} = require('./provider-guidance-attestation.cjs');
const {
  applyFinalSkillOverlay,
  applySkillProjection,
  planSkillProjection,
} = require('./project-skill.cjs');

const root = path.resolve(__dirname, '..');
const target = path.join(root, 'plugin/src/skills/provider-guidance-runtime.json');
const factsRegistry = 'ccm/apps/cli/src/provider-model-facts.json';
const facts = JSON.parse(fs.readFileSync(path.join(root, factsRegistry), 'utf8'));
const projectionAsOf = Object.values(facts.providers)
  .map((provider) => provider.observed_at)
  .sort()
  .at(-1);
const GUIDANCE_SKILL_SET = new Set(SKILLS);

validateProviderModelFactsRegistry(facts, projectionAsOf);

function rmTree(targetPath) {
  if (!fs.existsSync(targetPath)) return;
  fs.rmSync(targetPath, { recursive: true, force: false });
}

function copyTreeNoSymlinks(from, to) {
  const stat = fs.lstatSync(from);
  if (stat.isSymbolicLink()) {
    throw new Error(`refusing symlink copy: ${from}`);
  }
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from).sort()) {
      copyTreeNoSymlinks(path.join(from, name), path.join(to, name));
    }
    return;
  }
  if (stat.isFile()) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

function listRuntimeSkillNames(skillsSrc) {
  return fs
    .readdirSync(skillsSrc)
    .filter((name) => !name.startsWith('_') && !name.endsWith('.json') && !name.endsWith('.md'))
    .filter((name) => fs.statSync(path.join(skillsSrc, name)).isDirectory())
    .sort();
}

function applySkillsScopedEntryPins({ host, stagingRoot, skillsTree }) {
  const script = path.join(root, 'scripts/skill-knowledge/apply-final-skill-overlay.mjs');
  const result = spawnSync(
    process.execPath,
    [
      script,
      '--repo-root',
      root,
      '--host',
      host,
      '--entry-pins-only',
      '--staging-root',
      stagingRoot,
      '--skills-tree',
      skillsTree,
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(
      `skills-scoped entry pins failed for ${host}: ${result.stderr || result.stdout || `exit ${result.status}`}`,
    );
  }
  let parsed;
  try {
    const { parseStructuredJsonStdout } = require('./skill-knowledge/json-framing.cjs');
    parsed = parseStructuredJsonStdout(result.stdout, {
      label: `skills-scoped entry pins (${host})`,
    });
  } catch (error) {
    throw new Error(
      `skills-scoped entry pins returned non-JSON for ${host}: ${error.message}; stdout=${result.stdout}`,
    );
  }
  if (!parsed || parsed.ok !== true) {
    throw new Error(`skills-scoped entry pins refused for ${host}: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

/**
 * Build dual manifests for all hosts inside one controlled staging root.
 * Projects the FULL runtime skills tree (sync parity), applies overlays + entry pins,
 * then records accepted_sap / accepted_final only for the three guidance skills.
 */
function buildHostSkillDualManifests(scratchRoot) {
  const skillsSrc = path.join(root, 'plugin/src/skills');
  const skillNames = listRuntimeSkillNames(skillsSrc);
  const hosts = {};

  for (const host of HOSTS) {
    const sapSkills = path.join(scratchRoot, host, 'sap', 'skills');
    fs.mkdirSync(sapSkills, { recursive: true });
    const projected = [];

    for (const skill of skillNames) {
      const plan = planSkillProjection({ repoRoot: root, host, skill });
      if (plan.mode === 'planned') continue;
      const sapRoot = path.join(sapSkills, skill);
      applySkillProjection(plan, sapRoot);
      if (!fs.existsSync(sapRoot)) {
        throw new Error(`SAP projection produced no tree for ${host}/${skill}`);
      }
      projected.push(skill);
      if (GUIDANCE_SKILL_SET.has(skill)) {
        assertRawSapTreeClean(root, sapRoot);
      }
    }

    // Entry pins (esp. Codex skill_entry) require non-guidance skills to exist.
    if (projected.length < skillNames.filter((name) => {
      const plan = planSkillProjection({ repoRoot: root, host, skill: name });
      return plan.mode !== 'planned';
    }).length) {
      // projected already skipped planned; length check is informational only.
    }
    if (projected.length === 0) {
      throw new Error(`no runtime skills projected for host ${host}`);
    }
    for (const skill of SKILLS) {
      if (!projected.includes(skill)) {
        throw new Error(`provider-guidance skill missing from full SAP tree: ${host}/${skill}`);
      }
    }

    const skills = {};
    for (const skill of SKILLS) {
      skills[skill] = {
        accepted_sap: providerGuidanceRuntimeManifest(path.join(sapSkills, skill)),
        accepted_final: null,
      };
    }

    const finalSkills = path.join(scratchRoot, host, 'final', 'skills');
    copyTreeNoSymlinks(sapSkills, finalSkills);

    for (const skill of projected) {
      applyFinalSkillOverlay({
        repoRoot: root,
        host,
        skill,
        skillTree: path.join(finalSkills, skill),
        stagingRoot: scratchRoot,
      });
    }
    const pinResult = applySkillsScopedEntryPins({
      host,
      stagingRoot: scratchRoot,
      skillsTree: finalSkills,
    });
    const entryPinFiles = Array.isArray(pinResult.entry_pin_files)
      ? [...pinResult.entry_pin_files].sort()
      : [];

    for (const skill of SKILLS) {
      skills[skill].accepted_final = providerGuidanceRuntimeManifest(
        path.join(finalSkills, skill),
      );
    }

    hosts[host] = {
      skills,
      _meta: {
        projected_skills: projected.slice().sort(),
        entry_pins_applied: true,
        entry_pin_files: entryPinFiles,
        entry_pin_count: entryPinFiles.length,
      },
    };
  }

  return hosts;
}

function assertDualManifestsByteStable(left, right, label) {
  for (const host of HOSTS) {
    for (const skill of SKILLS) {
      assertManifestsExactEqual(
        left[host].skills[skill].accepted_sap,
        right[host].skills[skill].accepted_sap,
        `${label} ${host}/${skill} accepted_sap`,
      );
      assertManifestsExactEqual(
        left[host].skills[skill].accepted_final,
        right[host].skills[skill].accepted_final,
        `${label} ${host}/${skill} accepted_final`,
      );
    }
    const leftProjected = left[host]._meta?.projected_skills ?? [];
    const rightProjected = right[host]._meta?.projected_skills ?? [];
    if (JSON.stringify(leftProjected) !== JSON.stringify(rightProjected)) {
      throw new Error(
        `${label} ${host} projected skill set drifted: ${JSON.stringify(leftProjected)} vs ${JSON.stringify(rightProjected)}`,
      );
    }
    if (!left[host]._meta?.entry_pins_applied || !right[host]._meta?.entry_pins_applied) {
      throw new Error(`${label} ${host} missing entry_pins_applied witness`);
    }
    if (
      JSON.stringify(left[host]._meta?.entry_pin_files ?? null) !==
      JSON.stringify(right[host]._meta?.entry_pin_files ?? null)
    ) {
      throw new Error(
        `${label} ${host} entry_pin_files witness drifted: ${JSON.stringify(left[host]._meta?.entry_pin_files)} vs ${JSON.stringify(right[host]._meta?.entry_pin_files)}`,
      );
    }
  }
}

function stripMeta(hosts) {
  const next = {};
  for (const host of HOSTS) {
    next[host] = { skills: {} };
    for (const skill of SKILLS) {
      next[host].skills[skill] = {
        accepted_sap: hosts[host].skills[skill].accepted_sap,
        accepted_final: hosts[host].skills[skill].accepted_final,
      };
    }
  }
  return next;
}

function migrateOrRegenerate() {
  const originalBytes = fs.readFileSync(target);
  const originalSha = registryBytesSha256(target);
  let priorV1 = null;

  const parsed = JSON.parse(originalBytes.toString('utf8'));
  if (parsed.schema === REGISTRY_SCHEMA_V1) {
    priorV1 = loadProviderGuidanceRegistry(target, root, projectionAsOf, {
      allowV1ForMigration: true,
    });
  } else if (parsed.schema === REGISTRY_SCHEMA) {
    loadProviderGuidanceRegistry(target, root, projectionAsOf);
  } else {
    throw new Error(`unsupported registry schema ${parsed.schema}`);
  }

  const scratchParent = path.join(root, '.tmp');
  fs.mkdirSync(scratchParent, { recursive: true });
  const scratchA = fs.mkdtempSync(path.join(scratchParent, 'ccm-provider-guidance-'));
  const scratchB = fs.mkdtempSync(path.join(scratchParent, 'ccm-provider-guidance-'));

  try {
    // Pass 1: fresh whole-tree projection.
    const hostsA = buildHostSkillDualManifests(scratchA);

    // v1 equality BEFORE any write.
    if (priorV1) {
      for (const host of HOSTS) {
        for (const skill of SKILLS) {
          assertManifestsExactEqual(
            hostsA[host].skills[skill].accepted_final,
            priorV1.hosts[host].skills[skill],
            `${host}/${skill} v1→v2 accepted_final`,
          );
        }
      }
    }

    // Pass 2: independent rebuild; must be byte-stable with pass 1.
    const hostsB = buildHostSkillDualManifests(scratchB);
    assertDualManifestsByteStable(hostsA, hostsB, 'regen');

    const next = {
      schema: REGISTRY_SCHEMA,
      facts_registry: factsRegistry,
      projection_as_of: projectionAsOf,
      hosts: stripMeta(hostsA),
    };

    // Unique publish point — only after gen + rebuild + v1 equality + byte-stable.
    atomicWriteJson(target, next);

    return {
      schema: REGISTRY_SCHEMA,
      previous_sha256: originalSha,
      path: target,
      projected_skill_counts: Object.fromEntries(
        HOSTS.map((host) => [host, hostsA[host]._meta.projected_skills.length]),
      ),
      // Runtime witness only — never written into the committed registry.
      entry_pin_witness: Object.fromEntries(
        HOSTS.map((host) => [
          host,
          {
            applied: true,
            count: hostsA[host]._meta.entry_pin_count,
            files: hostsA[host]._meta.entry_pin_files,
          },
        ]),
      ),
    };
  } finally {
    rmTree(scratchA);
    rmTree(scratchB);
    try {
      fs.rmdirSync(scratchParent);
    } catch {
      // parent may be non-empty
    }
  }
}

const result = migrateOrRegenerate();
process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
