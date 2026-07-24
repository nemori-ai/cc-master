/**
 * Candidate provider-guidance attestation: trusted rebuild of expected-final.
 * Sidecar is evidence only; verifier recomputes every commitment.
 *
 * Trusted rebuild (whole-host skills tree, sync parity):
 *   1. Project FULL runtime skills SAP into controlled staging
 *   2. Guidance skills must exact-equal committed accepted_sap + overlay-clean
 *   3. Copy full SAP tree → final
 *   4. Apply per-skill overlays with candidate graph for every projected skill
 *   5. Apply skills-scoped entry pins on the whole skills tree
 *   6. Fingerprint guidance skill expected_final; actual must exact-equal it
 *
 * Never trust strip(actual), marker presence, or staging-path hash fallbacks.
 * candidate_graph_sha256 must be the real candidate graph hash from the caller.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertSkillTreeHasNoCompilerOwnedOverlay,
  applyFinalSkillOverlaysToTree,
  applySkillsScopedEntryPins,
} from './compile/skill-overlay.mjs';
import { buildAndValidateGraph } from './graph.mjs';

const require = createRequire(import.meta.url);
const {
  COMPILER_CONTRACT,
  SKILLS,
  assertManifestsExactEqual,
  assertProviderGuidanceAcceptedSap,
  buildCandidateAttestationSidecar,
  loadProviderGuidanceRegistry,
  manifestSha256,
  providerGuidanceRuntimeManifest,
  registryBytesSha256,
  verifyCandidateAttestationSidecar,
} = require('../provider-guidance-attestation.cjs');
const {
  applySkillProjection,
  planSkillProjection,
} = require('../project-skill.cjs');

const GUIDANCE_SKILL_SET = new Set(SKILLS);

function copyTreeNoSymlinks(from, to) {
  const stat = fs.lstatSync(from);
  if (stat.isSymbolicLink()) {
    throw Object.assign(new Error(`refusing symlink copy: ${from}`), {
      code: 'SKG-PATH-AUTHORITY-SYMLINK',
    });
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

function sidecarPath(skillTreeAbsolute) {
  return path.join(skillTreeAbsolute, '.ccm-provider-guidance-candidate-attestation.json');
}

/**
 * Independently rebuild expected-final for ALL guidance skills on one host
 * via a full skills-tree trusted compile (overlays + entry pins).
 */
export async function rebuildTrustedExpectedFinalsForHost({
  repoRoot,
  host,
  registry,
  stagingRootAbsolute,
  graph,
}) {
  const rebuildRoot = path.join(stagingRootAbsolute, `.trusted-rebuild-${host}`);
  if (fs.existsSync(rebuildRoot)) {
    fs.rmSync(rebuildRoot, { recursive: true, force: false });
  }
  fs.mkdirSync(rebuildRoot, { recursive: true });

  const skillsSrc = path.join(repoRoot, 'plugin/src/skills');
  const skillNames = listRuntimeSkillNames(skillsSrc);
  const sapSkills = path.join(rebuildRoot, 'sap', 'skills');
  fs.mkdirSync(sapSkills, { recursive: true });
  const projected = [];

  for (const skill of skillNames) {
    const plan = planSkillProjection({ repoRoot, host, skill });
    if (plan.mode === 'planned') continue;
    const sapRoot = path.join(sapSkills, skill);
    applySkillProjection(plan, sapRoot);
    projected.push(skill);
    if (GUIDANCE_SKILL_SET.has(skill)) {
      assertSkillTreeHasNoCompilerOwnedOverlay(sapRoot);
      assertProviderGuidanceAcceptedSap(registry, host, skill, sapRoot);
    }
  }
  for (const skill of SKILLS) {
    if (!projected.includes(skill)) {
      throw Object.assign(
        new Error(`trusted rebuild missing guidance skill SAP: ${host}/${skill}`),
        { code: 'SKG-CHANGE-CANDIDATE-ATTESTATION' },
      );
    }
  }

  const finalSkills = path.join(rebuildRoot, 'final', 'skills');
  copyTreeNoSymlinks(sapSkills, finalSkills);

  for (const skill of projected) {
    applyFinalSkillOverlaysToTree({
      repoRoot,
      host,
      graph,
      skillTreeAbsolute: path.join(finalSkills, skill),
      skillName: skill,
      stagingRootAbsolute,
    });
  }
  applySkillsScopedEntryPins({
    repoRoot,
    host,
    graph,
    skillsTreeAbsolute: finalSkills,
    stagingRootAbsolute,
  });

  const bySkill = Object.create(null);
  for (const skill of SKILLS) {
    bySkill[skill] = {
      sapManifest: providerGuidanceRuntimeManifest(path.join(sapSkills, skill)),
      expectedFinalManifest: providerGuidanceRuntimeManifest(path.join(finalSkills, skill)),
    };
  }
  return { rebuildRoot, projected, bySkill };
}

/**
 * Attest all guidance skill trees after candidate overlay on a full host skills staging.
 */
export async function attestAllCandidateGuidanceSkills({
  repoRoot,
  host,
  skillsStagingAbsolute,
  stagingRootAbsolute,
  registryPath,
  candidateGraphSha256,
}) {
  if (typeof candidateGraphSha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(candidateGraphSha256)) {
    throw Object.assign(
      new Error('candidate_graph_sha256 must be the real candidate graph SHA-256 (no staging fallback)'),
      { code: 'SKG-CHANGE-CANDIDATE-ATTESTATION' },
    );
  }

  const registry = loadProviderGuidanceRegistry(registryPath, repoRoot);
  const acceptedRegistrySha256 = registryBytesSha256(registryPath);

  const built = buildAndValidateGraph({ repoRoot });
  if (!built.ok || !built.graph) {
    throw Object.assign(new Error(`candidate graph unavailable for ${host}`), {
      code: 'SKG-CHANGE-CANDIDATE-ATTESTATION',
      diagnostics: built.diagnostics ?? [],
    });
  }
  const recomputedGraphSha256 = built.graph.graph_hash;
  if (recomputedGraphSha256 !== candidateGraphSha256) {
    throw Object.assign(
      new Error(
        `candidate_graph_sha256 mismatch: caller=${candidateGraphSha256} recomputed=${recomputedGraphSha256}`,
      ),
      {
        code: 'SKG-CHANGE-CANDIDATE-ATTESTATION',
        sync_envelope: {
          schema: 'cc-master/skill-knowledge-sync/v1alpha1',
          ok: false,
          host,
          phase: 'candidate_graph_sha256_bind',
          caller_candidate_graph_sha256: candidateGraphSha256,
          recomputed_candidate_graph_sha256: recomputedGraphSha256,
        },
      },
    );
  }

  const rebuilt = await rebuildTrustedExpectedFinalsForHost({
    repoRoot,
    host,
    registry,
    stagingRootAbsolute,
    graph: built.graph,
  });

  const results = [];
  for (const skill of SKILLS) {
    const skillTreeAbsolute = path.join(skillsStagingAbsolute, skill);
    if (!fs.existsSync(skillTreeAbsolute)) {
      throw Object.assign(new Error(`missing candidate skill tree ${host}/${skill}`), {
        code: 'SKG-CHANGE-CANDIDATE-ATTESTATION',
      });
    }
    const actual = providerGuidanceRuntimeManifest(skillTreeAbsolute);
    assertManifestsExactEqual(
      actual,
      rebuilt.bySkill[skill].expectedFinalManifest,
      `${host}/${skill} trusted expected_final`,
    );

    const acceptedSapManifestSha256 = manifestSha256(registry.hosts[host].skills[skill].accepted_sap);
    const sidecar = buildCandidateAttestationSidecar({
      host,
      skill,
      acceptedRegistrySha256,
      acceptedSapManifestSha256,
      candidateGraphSha256,
      rawSapManifestSha256: manifestSha256(rebuilt.bySkill[skill].sapManifest),
      expectedFinalManifestSha256: manifestSha256(rebuilt.bySkill[skill].expectedFinalManifest),
      compilerContract: COMPILER_CONTRACT,
    });
    const sidecarFile = sidecarPath(skillTreeAbsolute);
    fs.writeFileSync(sidecarFile, `${JSON.stringify(sidecar, null, 2)}\n`);
    verifyCandidateAttestationSidecar(JSON.parse(fs.readFileSync(sidecarFile, 'utf8')), {
      host,
      skill,
      acceptedRegistrySha256,
      acceptedSapManifestSha256,
      candidateGraphSha256,
      rawSapManifestSha256: manifestSha256(rebuilt.bySkill[skill].sapManifest),
      expectedFinalManifestSha256: manifestSha256(rebuilt.bySkill[skill].expectedFinalManifest),
      compilerContract: COMPILER_CONTRACT,
    });
    results.push({ skill, sidecar, sidecarFile });
  }
  return results;
}

export function stripCandidateAttestationSidecars(skillsStagingAbsolute) {
  for (const skill of SKILLS) {
    const file = sidecarPath(path.join(skillsStagingAbsolute, skill));
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

/** CLI for CJS sync bridge. */
export async function runCli(argv = process.argv.slice(2)) {
  const values = Object.create(null);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`unexpected ${token}`);
    values[token] = argv[++i];
  }
  if (!values['--graph-sha256'] || !/^[0-9a-f]{64}$/u.test(values['--graph-sha256'])) {
    throw Object.assign(
      new Error('missing required --graph-sha256 (real candidate graph hash)'),
      { code: 'SKG-CHANGE-CANDIDATE-ATTESTATION' },
    );
  }
  const skillsStaging = path.resolve(values['--skills-staging']);
  await attestAllCandidateGuidanceSkills({
    repoRoot: path.resolve(values['--repo-root']),
    host: values['--host'],
    skillsStagingAbsolute: skillsStaging,
    stagingRootAbsolute: path.resolve(values['--staging-root']),
    registryPath: path.resolve(values['--registry']),
    candidateGraphSha256: values['--graph-sha256'],
  });
  if (values['--keep-sidecar'] !== '1') {
    stripCandidateAttestationSidecars(skillsStaging);
  }
  process.stdout.write(`${JSON.stringify({ ok: true })}\n`);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  runCli().catch((error) => {
    process.stdout.write(
      `${JSON.stringify({
        ok: false,
        code: error?.code ?? 'SKG-CHANGE-CANDIDATE-ATTESTATION',
        message: error instanceof Error ? error.message : String(error),
      })}\n`,
    );
    process.exitCode = 1;
  });
}
