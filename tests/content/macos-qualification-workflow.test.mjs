import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync('.github/workflows/macos-live-qualification.yml', 'utf8');
const operator = readFileSync('scripts/qualify-macos-live.sh', 'utf8');
const runtimeSupplyChainSpec = readFileSync(
  'design_docs/cross-harness-runtime-supply-chain-spec.md',
  'utf8',
);

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

test('runtime-affecting pull requests require both real macOS architecture qualification jobs', () => {
  assert.match(workflow, /^  pull_request:\n    paths:\n/m);
  assert.match(workflow, /^      - "ccm\/\*\*"$/m);
  assert.match(workflow, /^      - "scripts\/qualify-macos-live\.sh"$/m);
  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.match(workflow, /runner: macos-14\n            contract: darwin-arm64/);
  assert.match(workflow, /runner: macos-15-intel\n            contract: darwin-x64/);
});

test('Darwin support claim is bound to replayable arm64/x64 evidence and preserves exclusions', () => {
  assert.match(runtimeSupplyChainSpec, /Darwin POSIX \| supported；已通过真机资格门/);
  assert.match(
    runtimeSupplyChainSpec,
    /tree `1e8f49e29b3c87eea37ac5dc5588f58e3f1a3b24`/,
  );
  assert.match(runtimeSupplyChainSpec, /Actions run `29309116222`/);
  assert.match(runtimeSupplyChainSpec, /darwin-arm64.*darwin-x64/s);
  assert.match(runtimeSupplyChainSpec, /same-UID final-check→exec race.*residual/);
  assert.match(runtimeSupplyChainSpec, /Gatekeeper\/notarization.*conditional/);
  assert.match(runtimeSupplyChainSpec, /真实 Cursor Agent\s+endpoint.*conditional/s);
});

test('build and qualification jobs retain the exact arm64/x64 contracts', () => {
  assert.equal(strategyBlock(jobBlock('build-sea')), expectedStrategy);
  assert.equal(strategyBlock(jobBlock('qualify')), expectedStrategy);
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
  assert.match(upload, /^ {10}include-hidden-files: true$/m);
  assert.match(upload, /^ {10}if-no-files-found: error$/m);
  assert.equal(
    (workflow.match(/^[ \t]+include-hidden-files: true$/gm) ?? []).length,
    1,
    'hidden upload must stay scoped to the generated raw evidence tree',
  );
  assert.match(workflow, /^permissions:\n  contents: read$/m);
});

test('downloaded inner artifacts and the outer index are verified before index upload', () => {
  const index = jobBlock('evidence-index');
  assert.match(index, /uses: actions\/checkout@v4/);
  assert.match(index, /uses: actions\/download-artifact@v4/);
  assert.match(index, /^ {10}pattern: macos-live-evidence-\*$/m);
  assert.match(index, /^ {10}merge-multiple: false$/m);
  for (const contract of ['darwin-arm64', 'darwin-x64']) {
    assert.match(index, new RegExp(`macos-live-evidence-${contract}`));
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
