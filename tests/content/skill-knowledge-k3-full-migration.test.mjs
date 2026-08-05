/**
 * K3-01A acceptance — the authored source is graph-only.
 *
 * This suite deliberately checks the live repository instead of a reduced fixture:
 * all eight runtime skills must be accepted composition artifacts over one global
 * module graph, with no legacy skill manifests or owner-based membership fallback.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const knowledgeRoot = path.join(repoRoot, 'plugin/src/knowledge');

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relative), 'utf8'));
}

function jsonFiles(relative) {
  const root = path.join(repoRoot, relative);
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(root, entry.name))
    .sort();
}

test('SKG-K3-01A-01: graph-only source keeps eight artifact pairs and no module without a declared home', () => {
  assert.equal(
    fs.existsSync(path.join(knowledgeRoot, 'skills')),
    false,
    'plugin/src/knowledge/skills must be deleted, not retained as fallback',
  );

  const moduleFiles = jsonFiles('plugin/src/knowledge/graph/modules');
  const compositionFiles = jsonFiles('plugin/src/knowledge/compositions');
  const analysisFiles = jsonFiles('plugin/src/knowledge/analyses');
  assert.equal(compositionFiles.length, 8);
  assert.equal(analysisFiles.length, 8);

  const modules = moduleFiles.map((file) => JSON.parse(fs.readFileSync(file, 'utf8')));

  // 这里曾经冻着 47 个模块 / 250 个点 / 429 条边。那三个数不服务本用例的命题——它守的是
  // 「授权源是 graph-only、没有遗留的 skill 清单或 owner 式成员关系」,而总量与此无关:
  // 图上多一条尚未分配的知识既不引入 owner_skill,也不让 skills/ 目录复活。在「知识先立、
  // skill 后组」之下多一条备料是常态动作,冻总量只会让每次立知识都要顺手改一次测试,
  // 那道门很快会被当成噪声划掉。
  //
  // 真正该守的是**没有来路不明的模块**:每个模块要么被某个 composition 消费,要么显式
  // 声明为尚未分配的备料。这一条在图长大时不动,而在有人加了模块却忘了接线时立刻报警。
  const consumedModuleIds = new Set(
    compositionFiles
      .map((file) => JSON.parse(fs.readFileSync(file, 'utf8')))
      .flatMap((composition) => composition.consumes.modules.map((ref) => ref.id)),
  );
  const homeless = modules.filter(
    (module) =>
      !consumedModuleIds.has(module.id) && module.lifecycle?.state !== 'draft',
  );
  assert.deepEqual(
    homeless.map((module) => module.id),
    [],
    'every module must be consumed by a composition or declared draft (intentionally unassigned)',
  );

  for (const module of modules) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(module, 'owner_skill'),
      false,
      `${module.id} must derive consumers from compositions`,
    );
  }

  const portfolio = readJson('plugin/src/knowledge/portfolio.json');
  assert.equal(portfolio.skills.length, 8);
  for (const skill of portfolio.skills) {
    assert.match(
      skill.manifest,
      /^plugin\/src\/knowledge\/compositions\/skill\.[a-z0-9-]+\.json$/,
      `${skill.id} must point only to its accepted composition`,
    );
  }
});

test('SKG-K3-01A-02 NEG: source schema rejects legacy skill manifests and owner_skill', async () => {
  const { validateAuthoredDocument } = await import(
    '../../scripts/skill-knowledge/schema.mjs'
  );
  const composition = readJson(
    'plugin/src/knowledge/compositions/skill.dev-as-ml-loop.json',
  );
  const legacySkill = {
    ...composition,
    kind: 'skill',
    id: composition.skill_id,
    modules: composition.consumes.modules,
  };
  delete legacySkill.skill_id;
  delete legacySkill.consumes;
  delete legacySkill.analysis_ref;
  assert.equal(
    validateAuthoredDocument(legacySkill, 'source').ok,
    false,
    'kind=skill must no longer be a valid authored source document',
  );

  const moduleWithOwner = {
    ...readJson('plugin/src/knowledge/graph/modules/devloop.core.json'),
    owner_skill: 'skill:dev-as-ml-loop',
  };
  assert.equal(
    validateAuthoredDocument(moduleWithOwner, 'source').ok,
    false,
    'module.owner_skill must not survive as a compatibility membership channel',
  );
});

test('SKG-K3-01A-03: every runtime skill is an accepted, recomputable composition', async () => {
  const { buildAndValidateGraph } = await import('../../scripts/skill-knowledge/graph.mjs');
  const { analyzeSkillCandidate } = await import(
    '../../scripts/skill-knowledge/graph-first.mjs'
  );
  const { WITNESS_ALLOWED_KEYS } = await import(
    '../../scripts/skill-knowledge/candidate-analysis.mjs'
  );
  const built = buildAndValidateGraph({ repoRoot });
  assert.equal(
    built.ok,
    true,
    JSON.stringify(built.diagnostics.filter((item) => item.severity === 'error').slice(0, 8)),
  );
  // 冻住的是**产品面**：八个 skill、八个 composition、八份分析、八个 entry 一一对应。
  // 这几个数变了,意味着 portfolio 的形状变了,那必须是一次显式决定。
  assert.deepEqual(
    {
      portfolio: built.graph.counts.portfolio,
      skill: built.graph.counts.skill,
      composition: built.graph.counts.composition,
      candidate_analysis: built.graph.counts.candidate_analysis,
      entry: built.graph.counts.entry,
      change: built.graph.counts.change,
    },
    { portfolio: 1, skill: 8, composition: 8, candidate_analysis: 8, entry: 8, change: 0 },
  );

  // 而 module / point / edge 的**总量**曾经也冻在这里(47 / 250 / 429)。那是冻错了对象:
  // 本用例守的是「每个 skill 都是可重算的准入 composition」,总量不服务这个命题;它只在
  // 图上多一条知识时就报警,而在「知识先立、skill 后组」之下,多一条尚未分配的备料是常态
  // 动作,不是回归。冻总量会把每一次立知识都变成一次改测试,那道门很快就会被当成噪声。
  //
  // 换成冻**被 admit 的 composition 实际消费的那部分**——它只在 skill 成员关系真的变动时
  // 才移动,那正是本用例关心的东西。图上的备料随便长,不影响这个数。
  const consumedModuleIds = new Set(
    built.graph.compositions.flatMap((item) =>
      item.consumes.modules.map((ref) => ref.id),
    ),
  );
  const consumedPoints = built.graph.points.filter((point) =>
    consumedModuleIds.has(point.module_id),
  );
  assert.deepEqual(
    { modules: consumedModuleIds.size, points: consumedPoints.length },
    { modules: 47, points: 250 },
    'modules/points consumed by admitted compositions must not drift silently',
  );
  assert.ok(
    built.graph.counts.module >= consumedModuleIds.size &&
      built.graph.counts.point >= consumedPoints.length,
    'graph totals must cover everything the admitted compositions consume',
  );
  assert.ok(
    built.graph.skills.every((skill) => skill._from_composition === true),
    'all runtime skill views must be projected from accepted compositions',
  );

  for (const composition of built.graph.compositions) {
    assert.equal(composition.lifecycle.state, 'accepted');
    const analysis = built.graph.candidate_analyses.find(
      (item) => item.id === composition.analysis_ref,
    );
    assert.ok(analysis, `${composition.id} analysis missing`);
    assert.equal(analysis.verdict, 'admit');
    const recomputed = analyzeSkillCandidate({
      repoRoot,
      skillId: composition.skill_id,
      moduleIds: composition.consumes.modules.map((item) => item.id),
      analysisId: analysis.id,
      compositionId: composition.id,
    });
    assert.equal(
      recomputed.ok,
      true,
      `${composition.id}: ${JSON.stringify(recomputed.diagnostics?.slice(0, 5))}`,
    );
    assert.equal(recomputed.derived_verdict, 'admit');
    assert.deepEqual(recomputed.scoresheet, analysis.scoresheet);
    assert.deepEqual(
      Object.fromEntries(
        WITNESS_ALLOWED_KEYS.map((key) => [key, recomputed.witness[key]]),
      ),
      analysis.witness,
    );
  }
});

test('SKG-K3-01A-04: contract and implementation expose no legacy knowledge/skills layout', async () => {
  const { HARDENING_CONTRACT, SOURCE_LAYOUT } = await import(
    '../../scripts/skill-knowledge/contracts.mjs'
  );
  assert.deepEqual(SOURCE_LAYOUT, {
    root: 'plugin/src/knowledge',
    portfolio: 'plugin/src/knowledge/portfolio.json',
    changes: 'plugin/src/knowledge/changes',
    modules: 'plugin/src/knowledge/graph/modules',
    compositions: 'plugin/src/knowledge/compositions',
    analyses: 'plugin/src/knowledge/analyses',
  });
  assert.deepEqual(HARDENING_CONTRACT.C6.authored_manifest_kinds, [
    'portfolio',
    'module',
    'composition',
    'candidate_analysis',
  ]);

  const implementationRoot = path.join(repoRoot, 'scripts/skill-knowledge');
  const pending = [implementationRoot];
  const offenders = [];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolute);
      } else if (/\.(?:mjs|cjs)$/.test(entry.name)) {
        const text = fs.readFileSync(absolute, 'utf8');
        if (/plugin\/src\/knowledge\/skills|knowledge\/skills\/<skill>/.test(text)) {
          offenders.push(path.relative(repoRoot, absolute));
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `legacy path literals remain: ${offenders.join(', ')}`);
});

test('SKG-K3-01A-05: module explain reports composition-derived consumers', async () => {
  const { runExplain } = await import('../../scripts/skill-knowledge/query.mjs');
  const result = runExplain({
    repoRoot,
    target: 'module:devloop.core',
  });
  assert.equal(result.exitCode, 0, JSON.stringify(result.body.diagnostics));
  assert.equal(result.body.entity.kind, 'module');
  assert.deepEqual(result.body.entity.witness.consumers, ['skill:dev-as-ml-loop']);
  assert.equal(
    Object.prototype.hasOwnProperty.call(result.body.entity, 'owner_skill'),
    false,
    'query output must not preserve owner terminology',
  );
});

test('SKG-K3-01A-06 NEG: closure budgets and cohesion reject a candidate one unit past its cap', async () => {
  const { buildAndValidateGraph } = await import('../../scripts/skill-knowledge/graph.mjs');
  const { computeCandidateMetrics, consumeModuleIds } = await import(
    '../../scripts/skill-knowledge/candidate-analysis.mjs'
  );
  const built = buildAndValidateGraph({ repoRoot });
  assert.equal(built.ok, true);
  assert.deepEqual(
    {
      bytes: built.graph.portfolio.candidate_admission.inventory_max_utf8_bytes,
      lines: built.graph.portfolio.candidate_admission.inventory_max_lines,
      tokens: built.graph.portfolio.candidate_admission.inventory_max_tokens,
      cohesion: built.graph.portfolio.candidate_admission.min_internal_cohesion,
    },
    {
      // Deliberate binary closure ceilings: 512 KiB, 2^13 lines, 2^17 tokens.
      bytes: 524288,
      lines: 8192,
      tokens: 131072,
      // A sparse composition still needs at least one authored relation per ten points.
      cohesion: 0.1,
    },
  );

  const compute = (composition, policyPatch = {}) =>
    computeCandidateMetrics({
      graph: {
        ...built.graph,
        portfolio: {
          ...built.graph.portfolio,
          candidate_admission: {
            ...built.graph.portfolio.candidate_admission,
            ...policyPatch,
          },
        },
      },
      moduleIds: consumeModuleIds(composition),
      composition,
      repoRoot,
    });

  const usingCcm = built.graph.compositions.find(
    (item) => item.skill_id === 'skill:using-ccm',
  );
  const usingBaseline = compute(usingCcm);
  assert.equal(usingBaseline.admission_gates.ok, true);

  const read = usingBaseline.witness_metrics.budgets.read;
  const token = usingBaseline.witness_metrics.budgets.token;
  const byteOverflow = compute(usingCcm, {
    inventory_max_utf8_bytes: read.utf8_bytes - 1,
  });
  assert.equal(byteOverflow.witness_metrics.budgets.read.utf8_bytes, read.utf8_bytes);
  assert.equal(byteOverflow.admission_gates.read_budget, false);
  assert.equal(byteOverflow.admission_gates.ok, false);

  const lineOverflow = compute(usingCcm, {
    inventory_max_lines: read.estimated_lines - 1,
  });
  assert.equal(
    lineOverflow.witness_metrics.budgets.read.estimated_lines,
    read.estimated_lines,
  );
  assert.equal(lineOverflow.admission_gates.read_budget, false);
  assert.equal(lineOverflow.admission_gates.ok, false);

  const tokenOverflow = compute(usingCcm, {
    inventory_max_tokens: token.estimated_tokens - 1,
  });
  assert.equal(
    tokenOverflow.witness_metrics.budgets.token.estimated_tokens,
    token.estimated_tokens,
  );
  assert.equal(tokenOverflow.admission_gates.token_budget, false);
  assert.equal(tokenOverflow.admission_gates.ok, false);

  const orchestrator = built.graph.compositions.find(
    (item) => item.skill_id === 'skill:master-orchestrator-guide',
  );
  const orchestrationBaseline = compute(orchestrator);
  const observedCohesion = orchestrationBaseline.witness_metrics.internal_cohesion;
  assert.ok(observedCohesion >= 0.1);
  const cohesionOverflow = compute(orchestrator, {
    min_internal_cohesion: observedCohesion + 0.000001,
  });
  assert.equal(cohesionOverflow.admission_gates.internal_cohesion, false);
  assert.equal(cohesionOverflow.admission_gates.ok, false);
});
