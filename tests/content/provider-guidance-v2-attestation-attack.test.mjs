/**
 * K1-06R attack suite: v2 dual-manifest migration + candidate attestation.
 * Proves marker-only bypass is gone; migration is atomic; entry pins included.
 *
 * v1 fixtures are synthesized from the committed v2 registry's accepted_final
 * (deterministic, CI-safe). Never depend on machine-local /tmp backups.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  renameSync,
  existsSync,
  copyFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { copyMinimalSkillKnowledgeRepo } from './helpers/skill-knowledge-isolated-repo.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(import.meta.dirname, '..', '..');
const COMMITTED_REGISTRY = join(ROOT, 'plugin/src/skills/provider-guidance-runtime.json');
const attestation = require('../../scripts/provider-guidance-attestation.cjs');

/** Codex skills-scoped entry pin target from portfolio skill_entry surface. */
const CODEX_SKILLS_SCOPED_PIN =
  'plugin/dist/codex/skills/cc-master-as-master-orchestrator/SKILL.md';

function sha256File(pathName) {
  return crypto.createHash('sha256').update(readFileSync(pathName)).digest('hex');
}

function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst);
    else if (entry.isFile()) copyFileSync(src, dst);
  }
}

/**
 * Deterministically synthesize a v1 registry object from committed v2
 * accepted_final manifests (the migration equality target).
 */
function synthesizeV1FromCommittedV2(committedV2 = null) {
  const v2 =
    committedV2 ??
    JSON.parse(readFileSync(COMMITTED_REGISTRY, 'utf8'));
  assert.equal(v2.schema, attestation.REGISTRY_SCHEMA);
  const hosts = {};
  for (const host of attestation.HOSTS) {
    hosts[host] = { skills: {} };
    for (const skill of attestation.SKILLS) {
      const finalManifest = v2.hosts[host].skills[skill].accepted_final;
      assert.equal(finalManifest.schema, attestation.MANIFEST_SCHEMA);
      hosts[host].skills[skill] = {
        schema: attestation.MANIFEST_SCHEMA,
        files: { ...finalManifest.files },
      };
    }
  }
  return {
    schema: attestation.REGISTRY_SCHEMA_V1,
    facts_registry: v2.facts_registry,
    projection_as_of: v2.projection_as_of,
    hosts,
  };
}

function writeSynthesizedV1(registryPath, mutate = null) {
  const v1 = synthesizeV1FromCommittedV2();
  if (typeof mutate === 'function') mutate(v1);
  writeFileSync(registryPath, `${JSON.stringify(v1, null, 2)}\n`);
  return v1;
}

function runUpdate(cwd) {
  return spawnSync(process.execPath, ['scripts/update-provider-guidance-attestations.cjs'], {
    cwd,
    encoding: 'utf8',
  });
}

function parseUpdateStdout(result) {
  const line = String(result.stdout || '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .at(-1);
  return JSON.parse(line);
}

test('ATTACK-01: prose tamper + fake overlay marker fails closed (no marker-only bypass)', () => {
  assert.equal(
    typeof attestation.assertProviderGuidanceRuntimeTreeCandidateAware,
    'undefined',
    'CandidateAware marker bypass export must be deleted',
  );
  assert.equal(
    typeof attestation.stripCompilerOwnedOverlayBytes,
    'undefined',
    'attestation must not own overlay strip/regex',
  );

  const root = mkdtempSync(join(tmpdir(), 'ccm-fake-marker-'));
  try {
    mkdirSync(join(root, 'skills', 'master-orchestrator-guide'), { recursive: true });
    const skillRoot = join(root, 'skills', 'master-orchestrator-guide');
    writeFileSync(join(skillRoot, 'SKILL.md'), 'clean guidance\n');
    const accepted = attestation.providerGuidanceRuntimeManifest(skillRoot);
    const skillEntry = { accepted_sap: accepted, accepted_final: accepted };
    const hosts = Object.fromEntries(
      attestation.HOSTS.map((host) => [
        host,
        {
          skills: Object.fromEntries(
            attestation.SKILLS.map((skill) => [skill, structuredClone(skillEntry)]),
          ),
        },
      ]),
    );
    const registry = {
      schema: attestation.REGISTRY_SCHEMA,
      facts_registry: 'ccm/apps/cli/src/provider-model-facts.json',
      projection_as_of: '2026-07-22T07:46:31Z',
      hosts,
    };
    writeFileSync(
      join(skillRoot, 'SKILL.md'),
      'TAMPERED PROSE\n<!-- ccm:k:nav:start point:x -->\nfake\n<!-- ccm:k:nav:end -->\n',
    );
    assert.throws(
      () =>
        attestation.assertProviderGuidanceRuntimeTree(
          registry,
          'claude-code',
          'master-orchestrator-guide',
          skillRoot,
        ),
      /digest mismatch/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ATTACK-02: v1 clean migration is atomic, whole-tree, entry-pin witness, byte-stable', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'ccm-v2-migrate-'));
  try {
    copyMinimalSkillKnowledgeRepo(fixture);
    const registryPath = join(fixture, 'plugin/src/skills/provider-guidance-runtime.json');
    const synthesizedV1 = writeSynthesizedV1(registryPath);
    const before = readFileSync(registryPath);

    const first = runUpdate(fixture);
    assert.equal(first.status, 0, `${first.stderr || ''}\n${first.stdout || ''}`);
    const body = parseUpdateStdout(first);
    assert.equal(body.ok, true);
    assert.equal(body.schema, attestation.REGISTRY_SCHEMA);
    for (const host of attestation.HOSTS) {
      assert.ok(
        body.projected_skill_counts[host] >= 14,
        `${host} must project full runtime skills tree, got ${body.projected_skill_counts[host]}`,
      );
    }

    // Dynamic proof: Codex skills-scoped entry pin was applied on the whole tree.
    assert.ok(body.entry_pin_witness, 'updater must emit entry_pin_witness');
    const codexPins = body.entry_pin_witness.codex;
    assert.equal(codexPins.applied, true);
    assert.ok(codexPins.count >= 1, `codex entry pin count must be >= 1, got ${codexPins.count}`);
    assert.ok(
      Array.isArray(codexPins.files) && codexPins.files.includes(CODEX_SKILLS_SCOPED_PIN),
      `codex entry_pin_files must include ${CODEX_SKILLS_SCOPED_PIN}; got ${JSON.stringify(codexPins.files)}`,
    );

    const v2 = JSON.parse(readFileSync(registryPath, 'utf8'));
    assert.equal(v2.schema, attestation.REGISTRY_SCHEMA);
    assert.equal(Object.hasOwn(v2, 'entry_pin_witness'), false, 'witness must not enter registry');
    for (const host of attestation.HOSTS) {
      for (const skill of attestation.SKILLS) {
        const entry = v2.hosts[host].skills[skill];
        assert.deepEqual(Object.keys(entry).sort(), ['accepted_final', 'accepted_sap']);
        attestation.assertManifestsExactEqual(
          entry.accepted_final,
          synthesizedV1.hosts[host].skills[skill],
          `${host}/${skill} final==synthesized-v1`,
        );
        assert.ok(entry.accepted_sap.files);
        assert.ok(entry.accepted_final.files);
      }
    }

    const afterFirstSha = sha256File(registryPath);
    assert.notEqual(
      afterFirstSha,
      crypto.createHash('sha256').update(before).digest('hex'),
      'successful migration must rewrite registry to v2',
    );

    const second = runUpdate(fixture);
    assert.equal(second.status, 0, `${second.stderr || ''}\n${second.stdout || ''}`);
    assert.equal(sha256File(registryPath), afterFirstSha, 'second regen must be byte-stable');
    const secondBody = parseUpdateStdout(second);
    assert.ok(
      secondBody.entry_pin_witness.codex.files.includes(CODEX_SKILLS_SCOPED_PIN),
      'second regen must still report Codex skills-scoped pin witness',
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('ATTACK-03: v1 final drift fails migration and leaves original registry bytes untouched', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'ccm-v2-drift-'));
  try {
    copyMinimalSkillKnowledgeRepo(fixture);
    const registryPath = join(fixture, 'plugin/src/skills/provider-guidance-runtime.json');
    writeSynthesizedV1(registryPath, (v1) => {
      const files = v1.hosts['claude-code'].skills['using-ccm'].files;
      const firstKey = Object.keys(files).sort()[0];
      files[firstKey] = '0'.repeat(64);
    });
    const before = readFileSync(registryPath);

    const result = runUpdate(fixture);
    assert.notEqual(result.status, 0, 'drifted v1 migration must fail');
    assert.match(`${result.stdout}\n${result.stderr}`, /digest mismatch|v1→v2|accepted_final/i);
    assert.deepEqual(
      readFileSync(registryPath),
      before,
      'failed migration must not alter registry bytes',
    );
    assert.equal(
      JSON.parse(readFileSync(registryPath, 'utf8')).schema,
      attestation.REGISTRY_SCHEMA_V1,
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('ATTACK-04: product load of synthesized v1 fails closed with REGISTRY_V2_REQUIRED', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccm-v1-load-'));
  try {
    const v1Path = join(dir, 'provider-guidance-runtime.v1.json');
    writeSynthesizedV1(v1Path);
    assert.throws(
      () => attestation.loadProviderGuidanceRegistry(v1Path, ROOT),
      (error) => error?.code === 'REGISTRY_V2_REQUIRED',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ATTACK-05: sidecar missing/extra field and cross-host replay fail closed', () => {
  const base = {
    host: 'claude-code',
    skill: 'master-orchestrator-guide',
    acceptedRegistrySha256: 'a'.repeat(64),
    acceptedSapManifestSha256: 'b'.repeat(64),
    candidateGraphSha256: 'c'.repeat(64),
    rawSapManifestSha256: 'd'.repeat(64),
    expectedFinalManifestSha256: 'e'.repeat(64),
    compilerContract: attestation.COMPILER_CONTRACT,
  };
  const good = attestation.buildCandidateAttestationSidecar(base);
  attestation.verifyCandidateAttestationSidecar(good, base);

  assert.throws(() => {
    const bad = { ...good };
    delete bad.raw_sap_manifest_sha256;
    attestation.verifyCandidateAttestationSidecar(bad, base);
  }, /keys must be exactly|raw_sap/i);

  assert.throws(() => {
    const bad = { ...good, extra_field: 'nope' };
    attestation.verifyCandidateAttestationSidecar(bad, base);
  }, /keys must be exactly|extra/i);

  assert.throws(() => {
    const replay = { ...good, host: 'codex' };
    attestation.verifyCandidateAttestationSidecar(replay, base);
  }, /commitment mismatch/i);

  assert.throws(() => {
    const oldGraph = { ...good, candidate_graph_sha256: 'f'.repeat(64) };
    attestation.verifyCandidateAttestationSidecar(oldGraph, base);
  }, /commitment mismatch/i);
});

test('ATTACK-06: committed v2 registry accepted_final matches live dist', () => {
  const registry = attestation.loadProviderGuidanceRegistry(COMMITTED_REGISTRY, ROOT);
  assert.equal(registry.schema, attestation.REGISTRY_SCHEMA);
  for (const host of attestation.HOSTS) {
    for (const skill of attestation.SKILLS) {
      attestation.assertProviderGuidanceRuntimeTree(
        registry,
        host,
        skill,
        join(ROOT, `plugin/dist/${host}/skills/${skill}`),
      );
      const entry = registry.hosts[host].skills[skill];
      assert.ok(Object.keys(entry.accepted_sap.files).length > 0);
      assert.ok(Object.keys(entry.accepted_final.files).length > 0);
    }
  }
});

test('ATTACK-07: update script forbids write-then-restore; atomicWrite after dual rebuild', () => {
  const source = readFileSync(
    join(ROOT, 'scripts/update-provider-guidance-attestations.cjs'),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /writeFileSync\(target,\s*originalBytes\)/,
    'must not writeFileSync-restore registry after failed publish',
  );
  assert.match(source, /entry_pin_witness/);
  assert.match(source, /entry_pin_files/);
  const atomicIdx = source.indexOf('atomicWriteJson(target');
  const rebuildIdx = source.indexOf('buildHostSkillDualManifests(scratchB)');
  assert.ok(rebuildIdx > 0 && atomicIdx > rebuildIdx, 'second rebuild must complete before atomicWrite');
});

test('ATTACK-08: raw fake overlay block fails raw-SAP clean and accepted_final digest', () => {
  const registry = attestation.loadProviderGuidanceRegistry(COMMITTED_REGISTRY, ROOT);
  const root = mkdtempSync(join(tmpdir(), 'ccm-raw-fake-'));
  try {
    const skill = 'master-orchestrator-guide';
    const host = 'claude-code';
    const cleanRoot = join(root, 'clean');
    mkdirSync(cleanRoot, { recursive: true });
    writeFileSync(join(cleanRoot, 'SKILL.md'), '# clean guidance\n');
    attestation.assertRawSapTreeClean(ROOT, cleanRoot);

    writeFileSync(
      join(cleanRoot, 'SKILL.md'),
      '# clean guidance\n<!-- ccm:k:nav:start point:fake.raw -->\nRAW FAKE\n<!-- ccm:k:nav:end -->\n',
    );
    assert.throws(
      () => attestation.assertRawSapTreeClean(ROOT, cleanRoot),
      (error) =>
        /overlay|polluted|malformed|RAW|nav/i.test(String(error?.message || error)) ||
        error?.code === 'SKG-OVERLAY-RAW-SAP-POLLUTED',
    );

    const finalRoot = join(root, 'final');
    copyTree(join(ROOT, `plugin/dist/${host}/skills/${skill}`), finalRoot);
    writeFileSync(
      join(finalRoot, 'SKILL.md'),
      `${readFileSync(join(finalRoot, 'SKILL.md'), 'utf8')}\n<!-- ccm:k:nav:start point:fake.raw -->\nRAW FAKE\n<!-- ccm:k:nav:end -->\n`,
    );
    assert.throws(
      () => attestation.assertProviderGuidanceRuntimeTree(registry, host, skill, finalRoot),
      /digest mismatch|file set mismatch/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ATTACK-09: overlay interior and exterior prose tamper fail closed against accepted_final', () => {
  const registry = attestation.loadProviderGuidanceRegistry(COMMITTED_REGISTRY, ROOT);
  const host = 'claude-code';
  const skill = 'master-orchestrator-guide';
  for (const mode of ['interior', 'exterior']) {
    const root = mkdtempSync(join(tmpdir(), `ccm-overlay-${mode}-`));
    try {
      const skillRoot = join(root, skill);
      copyTree(join(ROOT, `plugin/dist/${host}/skills/${skill}`), skillRoot);
      const skillMd = join(skillRoot, 'SKILL.md');
      let text = readFileSync(skillMd, 'utf8');
      if (mode === 'interior') {
        assert.match(text, /ccm:k:nav:start/);
        text = text.replace(
          /<!--\s*ccm:k:nav:start[\s\S]*?<!--\s*ccm:k:nav:end\s*-->/,
          (block) => `${block.slice(0, Math.min(40, block.length))}TAMPER_INTERIOR${block.slice(40)}`,
        );
      } else {
        text = `EXTERIOR TAMPER\n${text}`;
      }
      writeFileSync(skillMd, text);
      assert.throws(
        () => attestation.assertProviderGuidanceRuntimeTree(registry, host, skill, skillRoot),
        /digest mismatch/i,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('ATTACK-10: fileset add/delete/rename fail closed against accepted_final', () => {
  const registry = attestation.loadProviderGuidanceRegistry(COMMITTED_REGISTRY, ROOT);
  const host = 'claude-code';
  const skill = 'using-ccm';
  for (const mode of ['add', 'delete', 'rename']) {
    const root = mkdtempSync(join(tmpdir(), `ccm-fileset-${mode}-`));
    try {
      const skillRoot = join(root, skill);
      copyTree(join(ROOT, `plugin/dist/${host}/skills/${skill}`), skillRoot);
      if (mode === 'add') {
        writeFileSync(join(skillRoot, 'EXTRA-ATTACK.md'), 'unexpected file\n');
      } else if (mode === 'delete') {
        const victim = Object.keys(registry.hosts[host].skills[skill].accepted_final.files).sort()[0];
        unlinkSync(join(skillRoot, victim));
      } else {
        const victim = Object.keys(registry.hosts[host].skills[skill].accepted_final.files).sort()[0];
        renameSync(join(skillRoot, victim), join(skillRoot, `${victim}.renamed`));
      }
      assert.throws(
        () => attestation.assertProviderGuidanceRuntimeTree(registry, host, skill, skillRoot),
        /file set mismatch|digest mismatch/i,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('ATTACK-11: sidecar missing/extra/tamper/replay fail closed', () => {
  const base = {
    host: 'claude-code',
    skill: 'master-orchestrator-guide',
    acceptedRegistrySha256: 'a'.repeat(64),
    acceptedSapManifestSha256: 'b'.repeat(64),
    candidateGraphSha256: 'c'.repeat(64),
    rawSapManifestSha256: 'd'.repeat(64),
    expectedFinalManifestSha256: 'e'.repeat(64),
    compilerContract: attestation.COMPILER_CONTRACT,
  };
  const good = attestation.buildCandidateAttestationSidecar(base);
  attestation.verifyCandidateAttestationSidecar(good, base);

  assert.throws(() => {
    const bad = { ...good };
    delete bad.expected_final_manifest_sha256;
    attestation.verifyCandidateAttestationSidecar(bad, base);
  }, /keys must be exactly|expected_final/i);

  assert.throws(() => {
    const bad = { ...good, rogue: true };
    attestation.verifyCandidateAttestationSidecar(bad, base);
  }, /keys must be exactly|extra|rogue/i);

  assert.throws(() => {
    const bad = { ...good, expected_final_manifest_sha256: 'f'.repeat(64) };
    attestation.verifyCandidateAttestationSidecar(bad, base);
  }, /commitment mismatch/i);

  assert.throws(() => {
    const replay = { ...good, skill: 'using-ccm' };
    attestation.verifyCandidateAttestationSidecar(replay, {
      ...base,
      skill: 'master-orchestrator-guide',
    });
  }, /commitment mismatch/i);
});

test('ATTACK-12: candidateGraphSha256 must equal recomputed graph hash (no write-through)', async () => {
  const { attestAllCandidateGuidanceSkills } = await import(
    '../../scripts/skill-knowledge/candidate-attestation.mjs'
  );
  const { buildAndValidateGraph } = await import('../../scripts/skill-knowledge/graph.mjs');
  const fixture = mkdtempSync(join(tmpdir(), 'ccm-graph-bind-'));
  try {
    copyMinimalSkillKnowledgeRepo(fixture);
    const built = buildAndValidateGraph({ repoRoot: fixture });
    assert.equal(built.ok, true, JSON.stringify(built.diagnostics?.slice(0, 3)));
    assert.ok(built.graph?.graph_hash);
    assert.notEqual(built.graph.graph_hash, '0'.repeat(64));

    const staging = join(fixture, '.tmp', 'ccm-bind-staging');
    const skillsStaging = join(staging, 'skills');
    mkdirSync(skillsStaging, { recursive: true });

    await assert.rejects(
      () =>
        attestAllCandidateGuidanceSkills({
          repoRoot: fixture,
          host: 'claude-code',
          skillsStagingAbsolute: skillsStaging,
          stagingRootAbsolute: staging,
          registryPath: join(fixture, 'plugin/src/skills/provider-guidance-runtime.json'),
          candidateGraphSha256: '0'.repeat(64),
        }),
      (error) =>
        error?.code === 'SKG-CHANGE-CANDIDATE-ATTESTATION' &&
        /candidate_graph_sha256 mismatch/i.test(String(error.message)) &&
        error?.sync_envelope?.phase === 'candidate_graph_sha256_bind' &&
        error?.sync_envelope?.recomputed_candidate_graph_sha256 === built.graph.graph_hash,
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
