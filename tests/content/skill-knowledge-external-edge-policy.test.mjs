/**
 * external_edge_policy — cross-composition navigation edges are exempt from the
 * cut-coupling budget; every other external edge type still counts.
 *
 * This is the gate that lets a skill point at a sibling skill ("go read that",
 * "this is not that") without letting content dependencies leak across the
 * boundary. Navigation and contrast may cross; requires/deepens_to may not,
 * because those would split one concept's body across two SSOT owners.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { computeCandidateMetrics } from '../../scripts/skill-knowledge/candidate-analysis.mjs';
import { HARDENING_CONTRACT } from '../../scripts/skill-knowledge/contracts.mjs';

const NAV_TYPES = ['routes_to', 'contrasts_with'];
const COUPLING_TYPES = ['requires', 'deepens_to', 'next', 'operationalizes', 'applies_to', 'fallback_to'];

function graphWithExternalEdge(type, { allowedTypes = NAV_TYPES } = {}) {
  return {
    portfolio: {
      candidate_admission: {
        max_external_edge_count: 0,
        min_internal_cohesion: 0.1,
        external_edge_policy: { allowed_types: allowedTypes },
      },
    },
    modules: [{ id: 'module:inside' }, { id: 'module:outside' }],
    points: [
      { id: 'point:inside.a', module_id: 'module:inside' },
      { id: 'point:inside.b', module_id: 'module:inside' },
      { id: 'point:outside.a', module_id: 'module:outside' },
    ],
    edges: [
      {
        id: 'edge:internal',
        type: 'next',
        from: 'point:inside.a',
        to: 'point:inside.b',
        module_id: 'module:inside',
      },
      {
        id: 'edge:crossing',
        type,
        from: 'point:inside.a',
        to: 'point:outside.a',
        module_id: 'module:inside',
      },
    ],
    compositions: [],
  };
}

function metricsFor(type, options) {
  return computeCandidateMetrics({
    graph: graphWithExternalEdge(type, options),
    moduleIds: ['module:inside'],
    composition: null,
    repoRoot: null,
  });
}

test('allowlisted navigation types cross the boundary without consuming cut budget', () => {
  for (const type of NAV_TYPES) {
    const { graph_metrics, witness_metrics, admission_gates } = metricsFor(type);
    assert.equal(graph_metrics.external_edge_count, 1, `${type}: edge must still be observed`);
    assert.equal(graph_metrics.external_nav_edge_count, 1, `${type}: must count as navigation`);
    assert.equal(witness_metrics.external_cut_coupling, 0, `${type}: must not be cut coupling`);
    assert.equal(admission_gates.external_cut, true, `${type}: admission must pass`);
  }
});

test('every other external edge type still counts as cut coupling and fails admission', () => {
  for (const type of COUPLING_TYPES) {
    const { graph_metrics, witness_metrics, admission_gates } = metricsFor(type);
    assert.equal(graph_metrics.external_nav_edge_count, 0, `${type}: must not be exempt`);
    assert.equal(witness_metrics.external_cut_coupling, 1, `${type}: must count as coupling`);
    assert.equal(admission_gates.external_cut, false, `${type}: admission must fail closed`);
  }
});

test('empty allowlist reproduces the pre-policy behaviour (every external edge couples)', () => {
  for (const type of [...NAV_TYPES, ...COUPLING_TYPES]) {
    const { witness_metrics, admission_gates } = metricsFor(type, { allowedTypes: [] });
    assert.equal(witness_metrics.external_cut_coupling, 1, `${type}: must couple with empty allowlist`);
    assert.equal(admission_gates.external_cut, false, `${type}: must fail with empty allowlist`);
  }
});

test('contract default is the empty allowlist, so unaware portfolios keep the old gate', () => {
  const authored = HARDENING_CONTRACT.C6.candidate_admission;
  assert.deepEqual(authored.external_edge_policy.allowed_types, []);
  assert.equal(authored.max_external_edge_count, 0);
});

test('internal edges are never reclassified as external, whatever their type', () => {
  const { graph_metrics, witness_metrics } = metricsFor('routes_to');
  assert.equal(graph_metrics.internal_edge_count, 1, 'the intra-module next edge stays internal');
  assert.equal(
    graph_metrics.external_edge_count - graph_metrics.external_nav_edge_count,
    witness_metrics.external_cut_coupling,
    'cut coupling must be exactly the non-navigation remainder',
  );
});
