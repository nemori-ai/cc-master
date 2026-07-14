import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { test } from 'node:test';

const workflow = readFileSync('.github/workflows/macos-live-qualification.yml', 'utf8');
const operator = readFileSync('scripts/qualify-macos-live.sh', 'utf8');
const runtimeSupplyChainSpec = readFileSync(
  'design_docs/cross-harness-runtime-supply-chain-spec.md',
  'utf8',
);
const manifestScript = resolve('scripts/macos-evidence-manifest.mjs');
const deactivationValidator = 'scripts/validate-macos-launchd-deactivation.mjs';
const fixtureEvidenceCommit = '1'.repeat(40);
const fixtureEvidenceTree = '2'.repeat(40);

const legacyLaunchdMutations = {
  'missing-result': (doc) => {
    delete doc.deactivation.steps[0].result;
  },
  'shell-command': (doc) => {
    doc.deactivation.steps[0].command = 'sh';
  },
  'wrong-args': (doc) => {
    doc.deactivation.steps[0].args.push('extra');
  },
  'wrong-target': (doc) => {
    doc.deactivation.steps[0].args[1] = `system/${doc.deactivation.steps[0].args[1].split('/').at(-1)}`;
  },
  'wrong-result': (doc) => {
    doc.deactivation.steps[0].result = 'failed';
  },
  'wrong-arch': (doc) => {
    doc.arch = doc.arch === 'arm64' ? 'x64' : 'arm64';
  },
  'extra-step': (doc) => {
    const target = doc.deactivation.steps[0].args[1];
    doc.deactivation.steps.push({
      id: 'status',
      command: 'launchctl',
      args: ['print', target],
      code: 0,
      ok: true,
      error: null,
      result: 'succeeded',
    });
  },
};

const launchdRejectionReasons = {
  'missing-result': 'bootout result must be one of succeeded/already-absent/failed',
  'shell-command':
    'bootout must use exact structured launchctl argv for the independently trusted target',
  'wrong-args':
    'bootout must use exact structured launchctl argv for the independently trusted target',
  'wrong-target':
    'bootout must use exact structured launchctl argv for the independently trusted target',
  'wrong-result':
    'live install→uninstall evidence requires result=succeeded, ok=true, code=0, error=null',
  'wrong-arch': 'evidence platform/arch must be darwin/',
  'extra-step': 'deactivation must contain exactly one bootout step',
  'wrong-numeric-uid':
    'bootout must use exact structured launchctl argv for the independently trusted target',
  'relative-path': 'uninstall path must exactly match the independently trusted plist path',
  'wrong-parent': 'uninstall path must exactly match the independently trusted plist path',
  'self-consistent-wrong-triple':
    'uninstall path must exactly match the independently trusted plist path',
};

function triggerBlock(id) {
  const marker = `  ${id}:\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `workflow trigger ${id} must exist`);
  const tail = workflow.slice(start + marker.length);
  const nextTrigger = tail.search(/^  [a-z_][a-z0-9_-]*:\n/m);
  return nextTrigger === -1 ? tail : tail.slice(0, nextTrigger);
}

function jobBlock(id) {
  const marker = `  ${id}:\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `workflow job ${id} must exist`);
  const tail = workflow.slice(start + marker.length);
  const nextJob = tail.search(/^  [a-z0-9][a-z0-9-]*:\n/m);
  return nextJob === -1 ? tail : tail.slice(0, nextJob);
}

function namedStep(block, name) {
  const marker = `      - name: ${name}\n`;
  const start = block.indexOf(marker);
  assert.notEqual(start, -1, `workflow step ${name} must exist`);
  const tail = block.slice(start + marker.length);
  const nextStep = tail.search(/^      - (?:name|uses):/m);
  return nextStep === -1 ? tail : tail.slice(0, nextStep);
}

function strategyBlock(block) {
  const match = block.match(/^    strategy:\n[\s\S]*?(?=^    runs-on:)/m);
  assert.ok(match, 'job must contain a strategy immediately before runs-on');
  return match[0];
}

function runScript(step) {
  const marker = '        run: |\n';
  const start = step.indexOf(marker);
  assert.notEqual(start, -1, 'workflow step must contain a run block');
  const tail = step.slice(start + marker.length);
  const nextYaml = tail.search(/^ {0,8}\S/m);
  const body = nextYaml === -1 ? tail : tail.slice(0, nextYaml);
  return body
    .split('\n')
    .map((line) => (line.startsWith('          ') ? line.slice(10) : line))
    .join('\n');
}

function downloadPattern(block) {
  const match = block.match(/^ {10}pattern: (.+)$/m);
  assert.ok(match, 'evidence index must declare an artifact download pattern');
  return match[1];
}

function matchesTrailingStarPattern(name, pattern) {
  assert.match(pattern, /^[a-z0-9-]+\*$/, 'the hermetic matcher covers the workflow trailing-star contract');
  return name.startsWith(pattern.slice(0, -1));
}

function writeRawArtifact(root, name) {
  const artifact = join(root, name);
  mkdirSync(artifact, { recursive: true });
  writeFileSync(join(artifact, 'evidence.log'), `${name}\n`);
  writeFileSync(
    join(artifact, 'summary.txt'),
    `required_failures=0\nexact_commit=${fixtureEvidenceCommit}\nexact_tree=${fixtureEvidenceTree}\n`,
  );
  const buildEvidence = join(artifact, 'sea-build-evidence');
  mkdirSync(buildEvidence, { recursive: true });
  writeFileSync(
    join(buildEvidence, 'runner.txt'),
    `exact_commit=${fixtureEvidenceCommit}\nexact_tree=${fixtureEvidenceTree}\n`,
  );
  writeRawManifest(artifact);
}

function writeRawManifest(artifact) {
  const manifest = spawnSync(
    process.execPath,
    [manifestScript, 'write', artifact, join(artifact, 'SHA256SUMS')],
    { encoding: 'utf8' },
  );
  assert.equal(manifest.status, 0, manifest.stderr);
}

function prepareIndexAttempt(artifactNames, pattern) {
  const root = mkdtempSync(join(tmpdir(), 'cc-master-macos-evidence-index-'));
  const catalog = join(root, 'catalog');
  const workspace = join(root, 'workspace');
  const evidence = join(workspace, 'evidence');
  mkdirSync(catalog, { recursive: true });
  mkdirSync(join(workspace, 'scripts'), { recursive: true });
  cpSync(manifestScript, join(workspace, 'scripts', basename(manifestScript)));

  for (const name of artifactNames) {
    if (name === 'macos-live-evidence-index') {
      const artifact = join(catalog, name);
      mkdirSync(artifact, { recursive: true });
      writeFileSync(join(artifact, 'EVIDENCE_SHA256SUMS'), 'previous attempt index\n');
    } else {
      writeRawArtifact(catalog, name);
    }
  }

  mkdirSync(evidence, { recursive: true });
  for (const entry of readdirSync(catalog, { withFileTypes: true })) {
    if (entry.isDirectory() && matchesTrailingStarPattern(entry.name, pattern)) {
      cpSync(join(catalog, entry.name), join(evidence, entry.name), { recursive: true });
    }
  }

  return {
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    evidence,
    workspace,
  };
}

function runIndexAttempt(attempt, script, expectedCommit = fixtureEvidenceCommit) {
  return spawnSync('bash', ['-c', script], {
    cwd: attempt.workspace,
    env: { ...process.env, EXPECTED_COMMIT: expectedCommit },
    encoding: 'utf8',
  });
}

const expectedStrategy = `    strategy:
      fail-fast: false
      matrix:
        include:
          - runner: macos-14
            contract: darwin-arm64
            uname_arch: arm64
            node_arch: arm64
            asset: ccm-darwin-arm64
          - runner: macos-15-intel
            contract: darwin-x64
            uname_arch: x86_64
            node_arch: x64
            asset: ccm-darwin-x64
`;

test('validator-only changes require both real macOS architecture qualification jobs', () => {
  assert.match(workflow, /^  pull_request:\n    paths:\n/m);
  assert.match(workflow, /^      - "ccm\/\*\*"$/m);
  assert.match(workflow, /^      - "scripts\/qualify-macos-live\.sh"$/m);
  for (const trigger of ['push', 'pull_request']) {
    assert.match(
      triggerBlock(trigger),
      /^      - "scripts\/validate-macos-launchd-deactivation\.mjs"$/m,
      `${trigger} must qualify a validator-only diff`,
    );
  }
  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.match(workflow, /runner: macos-14\n            contract: darwin-arm64/);
  assert.match(workflow, /runner: macos-15-intel\n            contract: darwin-x64/);
});

test('every Darwin job checks out and attests the exact pull-request head tree', () => {
  const exactRef = 'ref: ${{ github.event.pull_request.head.sha || github.sha }}';
  assert.equal(
    (workflow.match(new RegExp(exactRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? [])
      .length,
    3,
    'build, qualification, and evidence-index jobs must all use the exact PR head',
  );
  assert.match(workflow, /printf 'exact_commit=%s\\n'.*git rev-parse HEAD/s);
  assert.match(workflow, /printf 'exact_tree=%s\\n'.*git rev-parse 'HEAD\^\{tree\}'/s);
  assert.match(workflow, /downloaded-sea\/build-evidence\/runner\.txt/);
  assert.match(workflow, /sea-build-evidence/);
  assert.match(workflow, /summary\.txt.*exact_commit.*exact_tree/s);
  assert.match(workflow, /expected_commit=.*git rev-parse HEAD/s);
  assert.match(workflow, /expected_tree=.*git rev-parse 'HEAD\^\{tree\}'/s);
});

test('current Darwin claim stays unqualified until replayable exact-tree arm64/x64 evidence exists', () => {
  assert.match(
    runtimeSupplyChainSpec,
    /Darwin POSIX \| historical baseline qualified；当前 runtime-affecting tree 未资格化/,
  );
  assert.match(runtimeSupplyChainSpec, /历史资格快照.*tree `1e8f49e29b3c87eea37ac5dc5588f58e3f1a3b24`/s);
  assert.match(runtimeSupplyChainSpec, /Actions run `29309116222`/);
  assert.match(runtimeSupplyChainSpec, /旧 run 不得作为新 tree 的通过证据/);
  assert.match(runtimeSupplyChainSpec, /darwin-arm64.*darwin-x64/s);
  assert.match(runtimeSupplyChainSpec, /same-UID final-check→exec race.*residual/);
  assert.match(runtimeSupplyChainSpec, /Gatekeeper\/notarization.*conditional/);
  assert.match(runtimeSupplyChainSpec, /真实 Cursor Agent\s+endpoint.*conditional/s);
});

test('build and qualification jobs retain the exact arm64/x64 contracts', () => {
  assert.equal(strategyBlock(jobBlock('build-sea')), expectedStrategy);
  assert.equal(strategyBlock(jobBlock('qualify')), expectedStrategy);
});

test('both macOS architecture contracts replay and reject historical active deactivation evidence', () => {
  const validatorStart = operator.indexOf('validate_launchd_uninstall_log() {');
  const validatorEnd = operator.indexOf('\n}', validatorStart);
  const validatorFunction = operator.slice(validatorStart, validatorEnd + 2);
  assert.match(
    validatorFunction,
    /node scripts\/validate-macos-launchd-deactivation\.mjs/,
    'the live operator must use the same replayable deactivation validator as fixtures',
  );
  assert.match(validatorFunction, /"\$\{EVIDENCE_DIR\}\/launchd_uninstall\.log"/);
  assert.match(validatorFunction, /"\$\{CONTRACT\}" "\$\{LAUNCHD_IDENTITY\}"/);
  for (const contract of ['darwin-arm64', 'darwin-x64']) {
    const fixture = `tests/fixtures/macos-launchd-deactivation/${contract}/launchd_uninstall.log`;
    const identity = `tests/fixtures/macos-launchd-deactivation/${contract}/trusted-identity.json`;
    const replay = spawnSync(
      process.execPath,
      [deactivationValidator, fixture, contract, identity],
      { encoding: 'utf8' },
    );
    assert.equal(replay.status, 1, `${contract} historical state=active evidence must fail closed`);
    assert.match(replay.stderr, /deactivation\.state="inactive"/);
  }
});

test('both macOS architecture contracts accept only exact structured launchctl bootout evidence', () => {
  for (const contract of ['darwin-arm64', 'darwin-x64']) {
    const fixtureDir = `tests/fixtures/macos-launchd-deactivation/${contract}`;
    const identity = `${fixtureDir}/trusted-identity.json`;
    const validDoc = JSON.parse(readFileSync(`${fixtureDir}/valid-launchd-uninstall.log`, 'utf8'));
    const accepted = spawnSync(
      process.execPath,
      [deactivationValidator, `${fixtureDir}/valid-launchd-uninstall.log`, contract, identity],
      { encoding: 'utf8' },
    );
    assert.equal(accepted.status, 0, `${contract} valid evidence rejected: ${accepted.stderr}`);

    const otherContract = contract === 'darwin-arm64' ? 'darwin-x64' : 'darwin-arm64';
    const wrongArch = spawnSync(
      process.execPath,
      [deactivationValidator, `${fixtureDir}/valid-launchd-uninstall.log`, otherContract, identity],
      { encoding: 'utf8' },
    );
    assert.equal(wrongArch.status, 1, `${contract} evidence must not certify ${otherContract}`);

    const invalidCases = JSON.parse(readFileSync(`${fixtureDir}/invalid-cases.json`, 'utf8'));
    assert.ok(Array.isArray(invalidCases) && invalidCases.length >= 11);
    const scratch = mkdtempSync(join(tmpdir(), `ccm-launchd-evidence-${contract}-`));
    try {
      for (const scenario of invalidCases) {
        const expectedReason = launchdRejectionReasons[scenario.name];
        assert.ok(expectedReason, `${contract}/${scenario.name} must name its rejection branch`);
        const mutateLegacyCase = legacyLaunchdMutations[scenario.name];
        if (mutateLegacyCase) {
          const expectedDoc = structuredClone(validDoc);
          mutateLegacyCase(expectedDoc);
          assert.deepEqual(
            scenario.doc,
            expectedDoc,
            `${contract}/${scenario.name} must be only its named mutation of the accepted fixture`,
          );
        }
        const evidence = join(scratch, `${scenario.name}.json`);
        writeFileSync(evidence, `${JSON.stringify(scenario.doc)}\n`);
        const rejected = spawnSync(
          process.execPath,
          [deactivationValidator, evidence, contract, identity],
          { encoding: 'utf8' },
        );
        assert.equal(
          rejected.status,
          1,
          `${contract}/${scenario.name} counterfeit evidence was accepted`,
        );
        assert.ok(
          rejected.stderr.includes(`launchd deactivation evidence invalid: ${expectedReason}`),
          `${contract}/${scenario.name} hit the wrong rejection branch: ${rejected.stderr}`,
        );
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
});

test('live operator supplies an independent trusted launchd identity before uninstall', () => {
  assert.match(operator, /write_launchd_trusted_identity/);
  assert.match(operator, /id -u/);
  assert.match(operator, /launchd_trusted_identity\.json/);
  assert.match(operator, /validate-macos-launchd-deactivation\.mjs/);
  assert.match(operator, /"\$\{CONTRACT\}" "\$\{LAUNCHD_IDENTITY\}"/);
  const identityWrite = operator.indexOf('run_required launchd_trusted_identity');
  const uninstall = operator.indexOf('run_required launchd_uninstall');
  assert.ok(identityWrite !== -1 && identityWrite < uninstall, 'trusted identity must predate uninstall');
});

test('ccm launchd fix and using-ccm projections carry separate release-line truth', () => {
  const changeset = readFileSync('ccm/.changeset/honest-launchd-uninstall.md', 'utf8');
  assert.match(changeset, /'ccm': patch/);
  assert.match(changeset, /unit removal/i);
  assert.match(changeset, /nonzero/i);

  const canonical = readFileSync(
    'plugin/src/skills/using-ccm/canonical/references/command-catalog.md',
    'utf8',
  );
  assert.match(canonical, /bootout/);
  assert.match(canonical, /unit_removal/);
  assert.match(canonical, /uninstalled:false/);
  assert.match(canonical, /already-absent/);
  const uninstallSection = (text) => {
    const start = text.indexOf('### monitor uninstall-service');
    assert.notEqual(start, -1);
    const end = text.indexOf('\n---', start);
    assert.notEqual(end, -1);
    return text.slice(start, end);
  };
  for (const host of ['claude-code', 'codex', 'cursor']) {
    const projected = readFileSync(
      `plugin/dist/${host}/skills/using-ccm/references/command-catalog.md`,
      'utf8',
    );
    assert.equal(
      uninstallSection(projected),
      uninstallSection(canonical),
      `${host} using-ccm uninstall guidance drifted`,
    );
  }

  const rootChangelog = readFileSync('CHANGELOG.md', 'utf8');
  assert.match(rootChangelog, /macOS monitor uninstall guidance/);
  assert.doesNotMatch(rootChangelog, /macOS launchd deactivation truth/);
  assert.ok(
    readdirSync('ccm/.changeset').includes('honest-launchd-uninstall.md'),
    'ccm behavior must carry ccm-line release intent',
  );
});

test('Darwin build and live operator attest the path-attested invoke contract without fd-exec claims', () => {
  const build = namedStep(jobBlock('build-sea'), 'Build and attest SEA');
  assert.match(build, /runtime-invoke-helper-darwin\.c/);
  assert.match(build, /runtime-invoke-helper\.json/);
  assert.match(build, /darwin-path-attested-v1/);
  assert.match(build, /nm -u .*runtime-invoke-helper/);
  assert.match(build, /_fexecve\|_execveat/);

  assert.match(operator, /validate_darwin_runtime_assurance/);
  assert.match(operator, /object_binding.*path-attested-v1/);
  assert.match(operator, /active_same_uid_replacement.*residual/);
  assert.match(operator, /runtime_exact_object_denial/);
  assert.match(operator, /RUNTIME_INVOKE_ASSURANCE/);
  assert.match(operator, /runtime-verified-exec-contract\.test\.ts/);
});

test('macOS live evidence requires launcher cold-race and SIGKILL recovery coverage', () => {
  assert.match(operator, /two concurrent cold invokes both succeed/);
  assert.match(operator, /a concurrently appearing invalid launcher final is preserved and rejected/);
  assert.match(operator, /launcher pathname replacement after pinning cannot redirect publication/);
  assert.match(operator, /an independently verified valid launcher final is idempotent/);
  assert.match(operator, /SIGKILL around launcher directory recovery and helper publication/);
  assert.match(operator, /a real publisher-parent SIGKILL cannot strand an executable materializer bootstrap/);
  assert.match(operator, /a publisher crash after bootstrap creation is reclaimed by the next activation/);
  assert.match(operator, /native bootstrap self-clean survives parent SIGKILL before and after helper publication/);
  assert.match(operator, /dead publisher materializer bootstrap instances are recovered without touching live owners/);
  assert.match(operator, /dead materializer bootstrap recovery is idempotent across concurrent activations/);
  assert.match(operator, /native materializer self-cleans its own bootstrap before stale recovery/);
  assert.match(
    operator,
    /materializer bootstrap recovery fails closed on symlink, type, and permission anomalies/,
  );
  assert.match(operator, /runtime_apfs_exdev_crash_matrix/);
});

test('Darwin execve symbol assertion accepts only the exact unresolved-symbol line shapes', () => {
  const build = namedStep(jobBlock('build-sea'), 'Build and attest SEA');
  const predicate = '^[[:space:]]*_execve$';
  assert.ok(
    build.includes(
      `grep -Eq '${predicate}' "\${EVIDENCE}/runtime-helper-symbols.log"`,
    ),
    'the workflow must accept both column-one and whitespace-prefixed macOS nm -u output',
  );

  const matches = (input) =>
    spawnSync('grep', ['-Eq', predicate], { input, encoding: 'utf8' }).status === 0;

  for (const accepted of ['_execve\n', '  _execve\n', '\t_execve\n']) {
    assert.equal(matches(accepted), true, `expected exact unresolved symbol: ${JSON.stringify(accepted)}`);
  }
  for (const rejected of [
    '_execveat\n',
    '_execve_suffix\n',
    '_my_execve\n',
    '0000000000000000 T _execve\n',
    'T _execve\n',
    '_execve U\n',
  ]) {
    assert.equal(matches(rejected), false, `must reject non-exact symbol: ${JSON.stringify(rejected)}`);
  }
});

test('Darwin build failure uploads complete evidence before preserving the original verdict', () => {
  const buildJob = jobBlock('build-sea');
  const build = namedStep(buildJob, 'Build and attest SEA');
  const upload = namedStep(buildJob, 'Upload non-release SEA evidence');
  const enforce = namedStep(buildJob, 'Enforce build verdict');

  assert.match(build, /^ {8}id: build$/m);
  assert.match(build, /^ {10}set \+e$/m);
  assert.match(build, /\) 2>&1 \| tee "\$\{EVIDENCE\}\/build-attestation\.log"/);
  assert.match(build, /pipeline_status=\("\$\{PIPESTATUS\[@\]\}"\)/);
  assert.match(build, /build_exit_code="\$\{pipeline_status\[0\]\}"/);
  assert.match(build, /tee_exit_code="\$\{pipeline_status\[1\]\}"/);
  assert.match(build, /^ {10}NODE$/m, 'heredoc terminator must stay at the YAML run-block baseline');
  assert.doesNotMatch(build, /^ {12}NODE$/m, 'shell nesting must not indent the heredoc terminator');
  assert.match(build, /build-attestation\.log/);
  assert.match(build, /build-result\.json/);
  assert.match(build, /exit_code=%s\\n.*GITHUB_OUTPUT/);
  assert.match(build, /^ {10}exit 0$/m);

  assert.match(upload, /^ {8}if: always\(\)$/m);
  assert.match(upload, /uses: actions\/upload-artifact@v4/);
  assert.match(upload, /\$\{\{ runner\.temp \}\}\/macos-sea\/build-evidence/);
  assert.match(upload, /^ {10}if-no-files-found: error$/m);

  assert.match(enforce, /^ {8}if: always\(\)$/m);
  assert.match(enforce, /steps\.build\.outputs\.exit_code/);
  assert.match(enforce, /\^\[0-9\]\+\$/);
  assert.match(enforce, /exit "\$\{BUILD_EXIT_CODE\}"/);

  const buildSyntax = spawnSync('bash', ['-n'], { input: runScript(build), encoding: 'utf8' });
  assert.equal(buildSyntax.status, 0, buildSyntax.stderr);
  const enforceScript = runScript(enforce);
  const success = spawnSync('bash', ['-c', enforceScript], {
    env: { ...process.env, BUILD_EXIT_CODE: '0' },
    encoding: 'utf8',
  });
  assert.equal(success.status, 0, success.stderr);
  const failure = spawnSync('bash', ['-c', enforceScript], {
    env: { ...process.env, BUILD_EXIT_CODE: '37' },
    encoding: 'utf8',
  });
  assert.equal(failure.status, 37, 'the final gate must preserve the original nonzero verdict');
  assert.match(failure.stderr, /build attestation exited 37/);
  const missing = spawnSync('bash', ['-c', enforceScript], {
    env: { ...process.env, BUILD_EXIT_CODE: '' },
    encoding: 'utf8',
  });
  assert.equal(missing.status, 1, 'missing build evidence must fail closed');

  const buildOffset = buildJob.indexOf('- name: Build and attest SEA');
  const uploadOffset = buildJob.indexOf('- name: Upload non-release SEA evidence');
  const enforceOffset = buildJob.indexOf('- name: Enforce build verdict');
  assert.ok(buildOffset < uploadOffset, 'evidence upload must follow the captured build attempt');
  assert.ok(uploadOffset < enforceOffset, 'the original failure must be re-raised only after upload');
});

test('raw evidence upload intentionally includes hidden members only within the evidence root', () => {
  const qualify = jobBlock('qualify');
  const upload = namedStep(qualify, 'Upload raw qualification evidence');
  assert.match(upload, /uses: actions\/upload-artifact@v4/);
  assert.match(
    upload,
    /path: \$\{\{ runner\.temp \}\}\/macos-qualification-\$\{\{ matrix\.contract \}\}/,
  );
  assert.match(
    upload,
    /^ {10}name: macos-live-raw-evidence-\$\{\{ matrix\.contract \}\}$/m,
  );
  assert.match(upload, /^ {10}include-hidden-files: true$/m);
  assert.match(upload, /^ {10}if-no-files-found: error$/m);
  assert.match(upload, /^ {10}overwrite: true$/m);
  assert.match(upload, /^ {10}retention-days: 14$/m);
  assert.equal(
    (workflow.match(/^[ \t]+include-hidden-files: true$/gm) ?? []).length,
    1,
    'hidden upload must stay scoped to the generated raw evidence tree',
  );
  assert.match(workflow, /^permissions:\n  contents: read$/m);
});

test('downloaded inner artifacts and the outer index are verified before index upload', () => {
  const index = jobBlock('evidence-index');
  const verification = namedStep(index, 'Verify inner manifests and build the outer index');
  const verificationScript = runScript(verification);
  assert.match(index, /uses: actions\/checkout@v4/);
  assert.match(index, /uses: actions\/download-artifact@v4/);
  assert.match(index, /^ {10}pattern: macos-live-raw-evidence-\*$/m);
  assert.match(index, /^ {10}merge-multiple: false$/m);
  for (const contract of ['darwin-arm64', 'darwin-x64']) {
    assert.match(index, new RegExp(`macos-live-raw-evidence-${contract}`));
  }
  const innerVerify = index.indexOf(
    'macos-evidence-manifest.mjs verify "${root}" "${root}/SHA256SUMS"',
  );
  const outerWrite = index.indexOf(
    'macos-evidence-manifest.mjs write evidence EVIDENCE_SHA256SUMS',
  );
  const outerVerify = index.indexOf(
    'macos-evidence-manifest.mjs verify evidence EVIDENCE_SHA256SUMS',
  );
  const indexUpload = index.indexOf('name: macos-live-evidence-index');
  assert.ok(innerVerify !== -1, 'inner verifier must run');
  assert.ok(outerWrite > innerVerify, 'outer index must be written only after inner verification');
  assert.ok(outerVerify > outerWrite, 'outer index must verify after it is written');
  assert.ok(indexUpload > outerVerify, 'index artifact must upload only after outer verification');
  assert.match(index.slice(outerVerify), /uses: actions\/upload-artifact@v4/);
  assert.match(index.slice(indexUpload), /^ {10}overwrite: true$/m);
  assert.match(index.slice(indexUpload), /^ {10}retention-days: 14$/m);
  assert.match(
    verification,
    /^ {8}env:\n {10}EXPECTED_COMMIT: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}$/m,
  );
  assert.match(verificationScript, /process\.env\.EXPECTED_COMMIT/);
  assert.doesNotMatch(verificationScript, /git rev-parse/);
});

test('rerun selection excludes a previous index while duplicate, extra, missing, and corrupt raw evidence fail closed', () => {
  const index = jobBlock('evidence-index');
  const pattern = downloadPattern(index);
  const script = runScript(namedStep(index, 'Verify inner manifests and build the outer index'));
  const arm = 'macos-live-raw-evidence-darwin-arm64';
  const x64 = 'macos-live-raw-evidence-darwin-x64';
  const previousIndex = 'macos-live-evidence-index';

  assert.equal(matchesTrailingStarPattern(previousIndex, pattern), false);
  const rerun = prepareIndexAttempt([arm, x64, previousIndex], pattern);
  try {
    assert.deepEqual(readdirSync(rerun.evidence).sort(), [arm, x64]);
    const result = runIndexAttempt(rerun, script);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rerun.cleanup();
  }

  const wrongExpectedCommit = prepareIndexAttempt([arm, x64], pattern);
  try {
    const result = runIndexAttempt(wrongExpectedCommit, script, '3'.repeat(40));
    assert.notEqual(result.status, 0, 'event commit mismatch must fail closed');
    assert.match(result.stderr, /expected commit/i);
  } finally {
    wrongExpectedCommit.cleanup();
  }

  const inconsistentTree = prepareIndexAttempt([arm, x64], pattern);
  try {
    const summary = join(inconsistentTree.evidence, x64, 'summary.txt');
    writeFileSync(
      summary,
      readFileSync(summary, 'utf8').replace(fixtureEvidenceTree, '4'.repeat(40)),
    );
    writeRawManifest(join(inconsistentTree.evidence, x64));
    const result = runIndexAttempt(inconsistentTree, script);
    assert.notEqual(result.status, 0, 'cross-record tree mismatch must fail closed');
    assert.match(result.stderr, /tree/i);
  } finally {
    inconsistentTree.cleanup();
  }

  for (const [label, names] of [
    ['duplicate architecture', [arm, `${arm}-rerun`, x64]],
    ['unknown architecture', [arm, x64, 'macos-live-raw-evidence-darwin-riscv64']],
    ['missing architecture', [arm]],
  ]) {
    const attempt = prepareIndexAttempt(names, pattern);
    try {
      const result = runIndexAttempt(attempt, script);
      assert.notEqual(result.status, 0, `${label} must fail closed`);
      assert.match(result.stderr, /expected artifact directories/);
    } finally {
      attempt.cleanup();
    }
  }

  const corrupt = prepareIndexAttempt([arm, x64], pattern);
  try {
    writeFileSync(join(corrupt.evidence, x64, 'evidence.log'), 'corrupt after manifest\n');
    const result = runIndexAttempt(corrupt, script);
    assert.notEqual(result.status, 0, 'manifest corruption must fail closed');
    assert.match(result.stderr, /manifest closure mismatch:.*corrupt=evidence\.log/);
  } finally {
    corrupt.cleanup();
  }
});

test('the operator finalizes all evidence before writing and self-verifying the inner manifest', () => {
  const summary = operator.indexOf("printf 'required_failures=%s\\n'");
  const write = operator.indexOf('macos-evidence-manifest.mjs write');
  const verify = operator.indexOf('macos-evidence-manifest.mjs verify');
  assert.notEqual(summary, -1);
  assert.notEqual(write, -1);
  assert.notEqual(verify, -1);
  assert.ok(summary < write, 'summary.txt must be finalized before the root manifest is written');
  assert.ok(write < verify, 'the producer must verify the exact tree it just manifested');
});
