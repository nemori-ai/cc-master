/**
 * Shared helpers for the closed-subset knowledge fixtures.
 *
 * Several tests copy one or a few skills' shards into a temp source root and
 * validate that subset on its own. Three things have to hold for that subset to
 * be judged the way the real portfolio is judged:
 *
 *   1. It must carry the *same* admission policy. A synthetic portfolio that
 *      omits `candidate_admission` silently falls back to the conservative
 *      defaults, where `external_edge_policy.allowed_types` is empty — so the
 *      cross-skill nav edges the real portfolio exempts start consuming the
 *      cut-coupling budget and the candidate is rejected for a rule the real
 *      graph never applied to it.
 *
 *   2. Its edges must resolve. Cross-skill nav edges legitimately point outside
 *      a subset; those dangling routes are pruned here. Content edges are a
 *      different matter — one crossing the boundary means the subset is not
 *      content-closed, which is exactly what these tests exist to catch, so
 *      pruning refuses them loudly instead.
 *
 *   3. Its analyses must describe the subset. The copied documents carry
 *      whole-portfolio metrics, which a subset cannot reproduce.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/** Edge types the portfolio exempts from cut coupling: routing, not dependency. */
const NAV_TYPES = new Set(['contrasts_with', 'routes_to']);

/** The live portfolio's admission policy, so subsets are judged by the real rules. */
export function liveAdmissionPolicy(repoRoot) {
  const portfolio = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'plugin/src/knowledge/portfolio.json'), 'utf8'),
  );
  assert.ok(
    portfolio.candidate_admission,
    'live portfolio must declare candidate_admission for subsets to mirror',
  );
  return portfolio.candidate_admission;
}

/**
 * Drop edges whose endpoints are not both present in the copied module shards.
 * Returns the number pruned. Throws if a non-nav edge crosses the boundary.
 */
export function pruneDanglingNavEdges(moduleDir) {
  const files = fs.readdirSync(moduleDir).filter((name) => name.endsWith('.json'));
  const localPoints = new Set();
  for (const name of files) {
    const doc = JSON.parse(fs.readFileSync(path.join(moduleDir, name), 'utf8'));
    for (const point of doc.points ?? []) localPoints.add(point.id);
  }

  let pruned = 0;
  for (const name of files) {
    const file = path.join(moduleDir, name);
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    const kept = [];
    for (const edge of doc.edges ?? []) {
      if (localPoints.has(edge.from) && localPoints.has(edge.to)) {
        kept.push(edge);
        continue;
      }
      assert.ok(
        NAV_TYPES.has(edge.type),
        `${edge.id} (${edge.type}) leaves the closed set — only nav edges may cross`,
      );
      pruned += 1;
    }
    if (kept.length !== (doc.edges ?? []).length) {
      doc.edges = kept;
      fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    }
  }
  return pruned;
}

/**
 * Re-derive each copied analysis against the subset, to a fixed point.
 *
 * Two passes, and the second one is not optional. The analyzer computes
 * `metricGatesOk = diagnostics.length === 0 && gates.ok`, so on the first pass —
 * where the copied metrics are still whole-portfolio numbers — the stale-metrics
 * diagnostic alone forces the derived verdict to `reject`. Persisting that value
 * would write a failure state into the document and make it its own next cause,
 * which is precisely the self-poisoning loop this helper exists to avoid. The
 * second pass runs against the corrected metrics and yields the real verdict.
 */
export async function rederiveSubsetAnalyses({ repoRoot, sourceRoot, graphSourceRoot, analysesDir }) {
  // Callers pass sourceRoot in whatever form their own buildAndValidateGraph call
  // uses — some temp roots live outside the repo, where a repo-relative rewrite
  // would silently resolve back to the real graph and make this a no-op.
  const relRoot = graphSourceRoot ?? sourceRoot;
  const { buildAndValidateGraph } = await import('../../../scripts/skill-knowledge/graph.mjs');
  const { analyzeAgainstGraph, consumeModuleIds, WITNESS_ALLOWED_KEYS } = await import(
    '../../../scripts/skill-knowledge/candidate-analysis.mjs'
  );
  const allowed = new Set(WITNESS_ALLOWED_KEYS);
  const dir = analysesDir ?? path.join(sourceRoot, 'analyses');

  const pass = (writeVerdict) => {
    const bootstrap = buildAndValidateGraph({
      repoRoot,
      sourceRoot: relRoot,
      skipCompositionAdmission: true,
    });
    const graph = bootstrap.graph ?? bootstrap;
    for (const composition of graph.compositions ?? []) {
      const file = path.join(dir, `${composition.analysis_ref.replace(/^analysis:/, '')}.json`);
      if (!fs.existsSync(file)) continue;
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      const result = analyzeAgainstGraph({
        repoRoot,
        graph,
        skillId: composition.skill_id,
        moduleIds: consumeModuleIds(composition),
        analysisId: composition.analysis_ref,
        compositionId: composition.id,
        composition,
        // Judge the subset's own copy. Left to itself the analyzer reads the
        // real repo's analyses directory, which is a different document here.
        authoredAnalysis: { doc, path: file },
      });
      assert.ok(
        result.graph_metrics && result.graph_metrics.point_count !== undefined,
        `subset analysis produced no metrics for ${composition.id}: ${JSON.stringify(
          (result.diagnostics ?? []).map((item) => item.code),
        )}`,
      );
      doc.candidate_modules = [...consumeModuleIds(composition)].sort();
      doc.graph_metrics = result.graph_metrics;
      const witness = {};
      for (const key of Object.keys(result.witness ?? {})) {
        if (allowed.has(key)) witness[key] = result.witness[key];
      }
      for (const key of ['reason', 'composition_id']) {
        if (doc.witness?.[key] !== undefined && witness[key] === undefined) {
          witness[key] = doc.witness[key];
        }
      }
      doc.witness = witness;
      if (writeVerdict) doc.verdict = result.derived_verdict ?? result.verdict;
      fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    }
  };

  pass(false); // correct the metrics; the verdict here is still poisoned by them
  pass(true); // now that they agree, the derived verdict is the real one
}
