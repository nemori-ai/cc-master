import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import guidanceAttestation from '../../scripts/provider-guidance-attestation.cjs';
import { stripRuntimeRouterBundle } from '../../scripts/skill-knowledge/compile/skill-overlay.mjs';
import { withIsolatedSkillKnowledgeRepo } from './helpers/skill-knowledge-isolated-repo.mjs';

function markdownFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.endsWith('.md')) files.push(absolute);
    }
  };
  visit(root);
  return files.sort();
}

test('SKG-FINAL-RUNTIME-00: router stripping is exact and fail-closed', () => {
  const unknownSuffix = '# authored\n\nUNKNOWN TAIL\n';
  assert.equal(stripRuntimeRouterBundle(unknownSuffix), unknownSuffix);
  assert.throws(
    () =>
      stripRuntimeRouterBundle(
        '# authored\n<!-- ccm:k:generated extra -->\nmalformed\n',
      ),
    /SKG-OVERLAY-MALFORMED/u,
  );
  assert.throws(
    () =>
      stripRuntimeRouterBundle(
        '# authored\n<!-- ccm:k:generated -->\none\n<!-- ccm:k:generated -->\ntwo\n',
      ),
    /SKG-OVERLAY-MALFORMED/u,
  );
});

test('SKG-FINAL-RUNTIME-01: published skill-local navigation proves H1-H4 without knowledge paths', async () => {
  await withIsolatedSkillKnowledgeRepo(async ({ repoRoot, projectPluginDist, runCli }) => {
    const host = 'claude-code';
    const projected = projectPluginDist(host);
    assert.equal(
      projected.status,
      0,
      `isolated ${host} projection failed:\n${projected.stdout}\n${projected.stderr}`,
    );

    const hostRoot = path.join(repoRoot, 'plugin', 'dist', host);
    assert.equal(
      fs.existsSync(path.join(hostRoot, 'knowledge')),
      false,
      'repo-only knowledge tree must not enter the published host',
    );
    for (const file of markdownFiles(hostRoot)) {
      const markdown = fs.readFileSync(file, 'utf8');
      assert.doesNotMatch(
        markdown,
        /(?:plugin\/src\/knowledge|(?:^|[(/])(?:\.\.\/)*knowledge\/)/mu,
        `runtime Markdown must not point back to repo-only knowledge: ${path.relative(hostRoot, file)}`,
      );
    }

    const checked = runCli([
      'compile',
      '--host',
      host,
      '--check',
      '--json',
    ]);
    assert.equal(checked.stderr, '', checked.stderr);
    const body = JSON.parse(checked.stdout);
    assert.equal(
      checked.status,
      0,
      `final-runtime compile check failed: ${JSON.stringify(body.diagnostics?.slice(0, 4), null, 2)}`,
    );
    assert.equal(body.ok, true);
    assert.equal(body.host_results.length, 1);
    const [result] = body.host_results;
    assert.equal(result.host, host);
    assert.equal(
      result.artifacts.some((artifact) => /(?:^|\/)knowledge(?:\/|$)/u.test(artifact.path)),
      false,
      'checker artifact inventory must describe the published runtime surface',
    );
    for (const gate of ['H1', 'H2', 'H3', 'H4']) {
      assert.equal(result.hop_report[gate].ok, true, `${host} ${gate}`);
    }
    assert.ok(result.hop_report.H2.witness.diameter <= 3);

    const guidanceSkill = 'master-orchestrator-guide';
    const guidanceRoot = path.join(hostRoot, 'skills', guidanceSkill);
    const guidanceFile = path.join(guidanceRoot, 'SKILL.md');
    const guidanceText = fs.readFileSync(guidanceFile, 'utf8');
    assert.match(guidanceText, /<!-- ccm:k:generated -->/u);
    fs.writeFileSync(
      guidanceFile,
      guidanceText.replace(
        '<!-- ccm:k:generated -->',
        '<!-- ccm:k:generated -->\nROUTER_SUFFIX_TAMPER',
      ),
    );
    const registry = guidanceAttestation.loadProviderGuidanceRegistry(
      path.join(repoRoot, 'plugin/src/skills/provider-guidance-runtime.json'),
      repoRoot,
    );
    assert.throws(
      () =>
        guidanceAttestation.assertProviderGuidanceRuntimeTree(
          registry,
          host,
          guidanceSkill,
          guidanceRoot,
        ),
      /digest mismatch/u,
      'post-compile router bytes must remain inside strict accepted_final',
    );
  });
});
