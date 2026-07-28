/**
 * Regression: glossary-lint machine-identity exemption (ccm:k comments + typed ids).
 *
 * Invokes the product scripts/glossary-lint.sh against an isolated temp fixture
 * (CC_MASTER_GLOSSARY_LINT_ROOT). Never mutates the real repo source tree.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lintScript = path.join(repoRoot, 'scripts', 'glossary-lint.sh');

const MINIMAL_GLOSSARY = `# fixture glossary

| canonical（英） | canonical（中） | 表述模式 | 允许变体 | 禁用变体（lint 卡） | 用户定义家 |
|---|---|---|---|---|---|
| decision_package | 决策包 | board field | \`decision_package\` | \`decision package\`、\`decision-package\` | fixture |
`;

function writeFixture(linesByRelPath) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-glossary-lint-'));
  fs.mkdirSync(path.join(root, 'design_docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'design_docs', 'glossary.md'), MINIMAL_GLOSSARY);
  for (const [rel, body] of Object.entries(linesByRelPath)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `${body}\n`);
  }
  return root;
}

function runGlossaryLint(fixtureRoot) {
  return spawnSync('bash', [lintScript], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CC_MASTER_GLOSSARY_LINT_ROOT: fixtureRoot,
    },
  });
}

function withFixture(linesByRelPath, run) {
  const root = writeFixture(linesByRelPath);
  try {
    return run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const PROBE = 'plugin/src/skills/fixture-glossary/references/probe.md';

test('GLOSSARY-LINT-MI-01: valid compiler machine ID containing decision-package is exempt', () => {
  withFixture(
    {
      [PROBE]: [
        '<!-- ccm:k:start point:hitl.decision-package -->',
        '合法正文只用 decision_package。',
        '<!-- ccm:k:end point:hitl.decision-package -->',
        '<!-- ccm:k:nav:start point:hitl.decision-package -->',
        '- [x](./probe.md#ccm-k-point-hitl-decision-package)',
        '<a id="ccm-k-point-hitl-decision-package"></a>',
        '<!-- ccm:k:nav:end -->',
        'Also a bare typed id: point:hitl.decision-package',
        'subject:hitl.decision-package and edge:hitl.decision-package stay machine-only.',
      ].join('\n'),
    },
    (root) => {
      const result = runGlossaryLint(root);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /glossary-lint: OK/);
      assert.equal(result.stderr.trim(), '');
    },
  );
});

test('GLOSSARY-LINT-MI-01b: portable ccm-k anchor does not suppress adjacent banned prose', () => {
  withFixture(
    {
      [PROBE]: 'link #ccm-k-point-hitl-decision-package then decision-package in prose\n',
    },
    (root) => {
      const result = runGlossaryLint(root);
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, /decision-package/);
      assert.match(result.stderr, /glossary-lint: FAILED/);
    },
  );
});

test('GLOSSARY-LINT-MI-02: ordinary prose containing decision-package still fails', () => {
  withFixture(
    {
      [PROBE]: 'Do not write decision-package in ordinary prose.\n',
    },
    (root) => {
      const result = runGlossaryLint(root);
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, /decision-package/);
      assert.match(result.stderr, /decision_package/);
      assert.match(result.stderr, /glossary-lint: FAILED/);
    },
  );
});

test('GLOSSARY-LINT-MI-03: prohibited prose adjacent to exempt ccm:k / namespace id still fails', () => {
  withFixture(
    {
      [PROBE]: [
        '<!-- ccm:k:start point:hitl.decision-package --> trailing decision-package',
        'prefix decision-package <!-- ccm:k:end point:hitl.decision-package -->',
        'See point:hitl.decision-package then also decision-package afterward.',
      ].join('\n'),
    },
    (root) => {
      const result = runGlossaryLint(root);
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, /decision-package/);
      assert.match(result.stderr, /glossary-lint: FAILED/);
      const hits = (result.stderr.match(/banned term drift/g) || []).length;
      assert.ok(hits >= 3, `expected ≥3 drift hits for adjacent prose, got ${hits}:\n${result.stderr}`);
    },
  );
});

test('GLOSSARY-LINT-MI-04: malformed or namespace-looking prose cannot suppress the rest of its line', () => {
  withFixture(
    {
      [PROBE]: [
        // Unclosed ccm:k comment must not swallow the banned remainder.
        '<!-- ccm:k:start point:hitl.decision-package still decision-package here',
        // Namespace-looking prefix that is not a typed id must not strip the line.
        'notpoint:hitl.decision-package',
        'entrypoint:decision-package',
        // Malformed typed-id shape (no alnum after colon) must leave banned text.
        'point: decision-package',
        'point:.decision-package',
        // A real typed id may strip only itself; banned prose after it still fails.
        'point:hitl.ok decision-package',
      ].join('\n'),
    },
    (root) => {
      const result = runGlossaryLint(root);
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, /glossary-lint: FAILED/);
      const hits = (result.stderr.match(/banned term drift/g) || []).length;
      assert.ok(
        hits >= 6,
        `expected every malformed/namespace-looking line to still fail (≥6 hits), got ${hits}:\n${result.stderr}`,
      );
    },
  );
});
