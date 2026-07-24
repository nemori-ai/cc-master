export const CONTRACT_VERSION = 'v1alpha1';
export const OUTPUT_SCHEMA = 'cc-master/skill-knowledge-cli/v1alpha1';
export const SOURCE_SCHEMA_VERSION = 'cc-master/skill-knowledge-source/v1alpha1';
export const CHANGE_SCHEMA_VERSION = 'cc-master/skill-knowledge-change/v1alpha1';
export const DEFAULT_SOURCE_ROOT = 'plugin/src/knowledge';

export const IMPLEMENTED_COMMANDS = Object.freeze([
  'change',
  'check',
  'compile',
  'contract',
  'explain',
  'path',
  'report',
]);
export const DECLARED_COMMANDS = Object.freeze([
  'change',
  'check',
  'compile',
  'contract',
  'explain',
  'path',
  'report',
]);
export const OPERATIONS = Object.freeze([
  'add',
  'wording',
  'refine',
  'move',
  'split',
  'merge',
  'transfer_owner',
  'deprecate',
  'retire',
]);
export const PLANES = Object.freeze([
  'structural',
  'authority',
  'navigation',
  'trigger',
  'constraint',
  'lineage',
  'projection',
]);
export const INVARIANTS = Object.freeze(
  Array.from({ length: 23 }, (_, index) => `K-I${String(index + 1).padStart(2, '0')}`),
);

export const HARDENING_CONTRACT = Object.freeze({
  C1: Object.freeze({
    entry_surface_fields: Object.freeze([
      'host',
      'source_file',
      'binding',
      'surface_kind',
      'targets',
      'lifecycle',
    ]),
  }),
  C2: Object.freeze({
    coverage_states: Object.freeze(['full', 'partial', 'non_knowledge', 'excluded']),
    denominator: 'git_canonical_markdown',
  }),
  C3: Object.freeze({
    derived_fields: Object.freeze(['canonical', 'review_policy', 'reviewed_canonical_sha256']),
  }),
  C4: Object.freeze({ accepted_skill_requires_admission: true }),
  C5: Object.freeze({
    change_workflow: Object.freeze(['begin', 'validate', 'apply']),
    workspace_root: '.skill-knowledge/workspaces/<change-id>',
  }),
  C6: Object.freeze({
    algorithm: 'cc-master/skill-knowledge-canonical-graph-hash/v1',
    authored_manifest_kinds: Object.freeze(['portfolio', 'skill', 'module']),
    change_head_digest_excludes: Object.freeze(['result_graph_sha256']),
    identity_set_fields: Object.freeze([
      'skills',
      'modules',
      'points',
      'edges',
      'entries',
      'canonical_source_inventory',
      'inventory',
      'entry_modules',
      'relevant_entries',
      'primary_points',
      'point_ids',
    ]),
    semantic_order_fields: Object.freeze([
      'operations',
      'when',
      'avoid_when',
      'recognition_cues',
      'includes',
      'excludes',
      'unresolved_coverage_debt',
      'evidence',
      'verifiers',
      'targets',
      'results',
      'edge_rewrites',
      'surfaces',
      'host_coverage',
      'runtime_hosts',
      'scope',
    ]),
  }),
  C7: Object.freeze({
    algorithm: 'cc-master/skill-knowledge-markdown-span-hash/v1',
    newline_normalization: 'crlf-to-lf',
  }),
  C8: Object.freeze({
    algorithm: 'cc-master/skill-knowledge-budget-estimator/v1',
    formula: 'ceil(utf8_bytes/3)',
  }),
  C9: Object.freeze({
    hosts: Object.freeze(['claude-code', 'codex', 'cursor', 'kimi-code']),
    worker_allowlist: Object.freeze(['codex', 'cursor']),
    payload_modes: Object.freeze(['canonical', 'partial', 'stub']),
    anchor_form: 'explicit-html-id',
    path_policy: 'relative-final-host-path',
  }),
  C10: Object.freeze({ changed_scope_base_option: '--base', immutable_chain: true }),
  C11: Object.freeze({ k2_allows_partial: false }),
  C12: Object.freeze({
    report_tracks: Object.freeze(['structural_status', 'behavioral_evidence_status']),
  }),
  C13: Object.freeze({ research_supersession_required: true }),
  C14: Object.freeze({ runtime_skill_count: 8, governance_meta_skill_is_runtime: false }),
});

export const EXIT_CODES = Object.freeze({
  success: 0,
  usage: 2,
  source_contract: 3,
  semantic_invariant: 4,
  projection: 5,
  hop: 6,
  drift: 7,
  capability_not_implemented: 10,
  internal: 70,
});

export const SCHEMAS = Object.freeze({
  source: 'design_docs/skill-knowledge-graph/schemas/knowledge-source.schema.json',
  change: 'design_docs/skill-knowledge-graph/schemas/knowledge-change.schema.json',
  output: 'design_docs/skill-knowledge-graph/schemas/knowledge-cli-output.schema.json',
  cli: 'design_docs/skill-knowledge-graph/cli-contract.md',
});

export const SOURCE_LAYOUT = Object.freeze({
  root: DEFAULT_SOURCE_ROOT,
  portfolio: `${DEFAULT_SOURCE_ROOT}/portfolio.json`,
  changes: `${DEFAULT_SOURCE_ROOT}/changes`,
  skills: `${DEFAULT_SOURCE_ROOT}/skills/<skill>`,
});

export const CAPABILITIES = Object.freeze({
  source_json_parse: true,
  source_envelope_validation: true,
  global_id_uniqueness: true,
  // K1 pilot: standalone validators + IR/hash/marker/inventory + authored-graph query.
  full_json_schema_validation: true,
  markdown_binding: true,
  graph_invariants: true,
  runtime_projection: true,
  hop_analysis: true,
  typed_change_transactions: true,
  entry_surface_binding: true,
  canonical_source_inventory: true,
  derived_freshness: true,
  canonical_graph_hash: true,
  deterministic_budget_estimator: true,
  // HUB four-host fixture probe + C9 contract delivered; check --host CLI still exit 10.
  host_portability_probe: true,
  // K1 pilot semantic coverage over admitted three-module inventory.
  semantic_coverage: true,
  behavioral_evidence_tracking: true,
});

export function contractEnvelope() {
  return {
    schema: OUTPUT_SCHEMA,
    ok: true,
    command: 'contract',
    result_kind: 'contract',
    contract_version: CONTRACT_VERSION,
    implemented_commands: [...IMPLEMENTED_COMMANDS],
    declared_commands: [...DECLARED_COMMANDS],
    operations: [...OPERATIONS],
    planes: [...PLANES],
    invariants: [...INVARIANTS],
    exit_codes: { ...EXIT_CODES },
    schemas: { ...SCHEMAS },
    source_layout: { ...SOURCE_LAYOUT },
    capabilities: { ...CAPABILITIES },
    hardening_contract: Object.fromEntries(
      Object.entries(HARDENING_CONTRACT).map(([id, value]) => [id, { ...value }]),
    ),
  };
}
