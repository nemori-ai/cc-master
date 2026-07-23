export const CONTRACT_VERSION = 'v1alpha1';
export const OUTPUT_SCHEMA = 'cc-master/skill-knowledge-cli/v1alpha1';
export const SOURCE_SCHEMA_VERSION = 'cc-master/skill-knowledge-source/v1alpha1';
export const CHANGE_SCHEMA_VERSION = 'cc-master/skill-knowledge-change/v1alpha1';
export const DEFAULT_SOURCE_ROOT = 'plugin/src/knowledge';

export const IMPLEMENTED_COMMANDS = Object.freeze(['check', 'contract']);
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
  Array.from({ length: 16 }, (_, index) => `K-I${String(index + 1).padStart(2, '0')}`),
);

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
  full_json_schema_validation: false,
  markdown_binding: false,
  graph_invariants: false,
  runtime_projection: false,
  hop_analysis: false,
  typed_change_transactions: false,
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
  };
}
