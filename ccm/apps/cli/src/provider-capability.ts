// provider-capability.ts — pure, fail-closed Codex CLI capability assessment.
//
// Version/help text can establish parser compatibility, while generated protocol schemas establish
// the behavior contract. Neither a familiar version nor help prose alone is eligibility evidence.

const ASSESSMENT_SCHEMA = 'ccm/codex-capability-assessment/v1';
const EXEC_JSONL_CONTRACT = 'ccm/codex-exec-jsonl-capability/v1';
const MAX_HELP_BYTES = 512 * 1024;
const MAX_SCHEMA_BYTES = 2 * 1024 * 1024;
const MAX_SCHEMA_DEPTH = 64;
const MAX_SCHEMA_NODES = 50_000;

const REQUIRED_APP_SERVER_METHODS = [
  'initialize',
  'account/read',
  'model/list',
  'account/rateLimits/read',
] as const;

const REQUIRED_EXEC_EVENT_TYPES = [
  'thread.started',
  'turn.started',
  'item.started',
  'item.updated',
  'item.completed',
  'turn.completed',
  'turn.failed',
  'error',
] as const;

export const CODEX_READ_ONLY_ARGV_TEMPLATE = [
  '--ask-for-approval',
  'never',
  'exec',
  '--json',
  '--output-schema',
  '<absolute-schema-file>',
  '--output-last-message',
  '<absolute-result-file>',
  '--model',
  '<resolved-model>',
  '-c',
  'model_reasoning_effort=<resolved-effort>',
  '--sandbox',
  'read-only',
  '--ephemeral',
  '-C',
  '<absolute-workspace>',
  '-',
] as const;

export interface CodexTextProbe {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
}

export interface CodexCapabilityInput {
  version: CodexTextProbe;
  rootHelp: CodexTextProbe;
  execHelp: CodexTextProbe;
  appServerHelp: CodexTextProbe;
  schemaBundle: Record<string, string | undefined>;
}

export interface CodexCapabilityAssessment {
  schema: typeof ASSESSMENT_SCHEMA;
  supported: boolean;
  reason_code: string | null;
  detail: string | null;
  binary_version: string | null;
  app_server_methods: string[];
  exec_jsonl_contract: {
    present: boolean;
    contract_id: string | null;
    identity_event_type: string | null;
    event_types: string[];
  };
  invocation: {
    argv_template: string[];
    approval_before_exec: boolean;
    prompt_last: boolean;
  } | null;
}

type JsonObject = Record<string, unknown>;

interface ParsedHelp {
  commands: Set<string>;
  flags: Set<string>;
  optionBlocks: Map<string, string>;
}

type SchemaRead =
  | { ok: true; value: unknown }
  | { ok: false; reason: 'too_large' | 'malformed' | 'too_complex' };

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function successfulProbe(probe: CodexTextProbe): boolean {
  return probe.exitCode === 0 && probe.signal === null;
}

function parseVersion(stdout: string): string | null {
  const match = stdout.match(/^codex-cli\s+(\S{1,128})\s*$/u);
  return match?.[1] ?? null;
}

function optionDeclaration(line: string): { flags: string[] } | null {
  const match = line.match(
    /^\s{2,}(?:(-[A-Za-z]),\s*)?(--[a-z][a-z0-9-]*)(?:\s+(?:<[^>]+>|\[[^\]]+\]))?/u,
  );
  if (!match) return null;
  return { flags: [match[1], match[2]].filter((flag): flag is string => Boolean(flag)) };
}

function parseHelp(stdout: string): ParsedHelp {
  const lines = stdout.split(/\r?\n/u);
  const commands = new Set<string>();
  const flags = new Set<string>();
  const optionBlocks = new Map<string, string>();
  let inCommands = false;

  for (const line of lines) {
    if (line.trim() === 'Commands:') {
      inCommands = true;
      continue;
    }
    if (/^[A-Z][A-Za-z ]+:\s*$/u.test(line)) {
      inCommands = false;
      continue;
    }
    if (inCommands) {
      const command = line.match(/^\s{2}([a-z][a-z0-9-]*)(?:\s{2,}|\s*$)/u)?.[1];
      if (command) commands.add(command);
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const declaration = optionDeclaration(lines[index] ?? '');
    if (!declaration) continue;
    let end = index + 1;
    while (end < lines.length) {
      if (optionDeclaration(lines[end] ?? '')) break;
      if (/^[A-Z][A-Za-z ]+:\s*$/u.test(lines[end] ?? '')) break;
      end += 1;
    }
    const block = lines.slice(index, end).join('\n');
    for (const flag of declaration.flags) {
      flags.add(flag);
      optionBlocks.set(flag, block);
    }
  }

  return { commands, flags, optionBlocks };
}

function readSchema(raw: string | undefined): SchemaRead {
  if (raw === undefined) return { ok: false, reason: 'malformed' };
  if (byteLength(raw) > MAX_SCHEMA_BYTES) return { ok: false, reason: 'too_large' };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  try {
    visitSchema(value, () => {});
  } catch {
    return { ok: false, reason: 'too_complex' };
  }
  return { ok: true, value };
}

function visitSchema(value: unknown, visitor: (node: JsonObject) => void): void {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    nodes += 1;
    if (nodes > MAX_SCHEMA_NODES || current.depth > MAX_SCHEMA_DEPTH)
      throw new Error('schema complexity exceeded');
    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1)
        stack.push({ value: current.value[index], depth: current.depth + 1 });
      continue;
    }
    if (!isRecord(current.value)) continue;
    visitor(current.value);
    for (const child of Object.values(current.value).reverse())
      stack.push({ value: child, depth: current.depth + 1 });
  }
}

function discriminatorValues(node: JsonObject, property: string): string[] {
  const properties = isRecord(node.properties) ? node.properties : null;
  const discriminator = properties && isRecord(properties[property]) ? properties[property] : null;
  if (!discriminator) return [];
  const values: string[] = [];
  if (typeof discriminator.const === 'string') values.push(discriminator.const);
  if (Array.isArray(discriminator.enum))
    for (const value of discriminator.enum) if (typeof value === 'string') values.push(value);
  return values;
}

function collectDiscriminators(schema: unknown, property: string): Set<string> {
  const values = new Set<string>();
  visitSchema(schema, (node) => {
    for (const value of discriminatorValues(node, property)) values.add(value);
  });
  return values;
}

function hasIdentityBranch(schema: unknown, eventType: string): boolean {
  let found = false;
  visitSchema(schema, (node) => {
    if (found || !discriminatorValues(node, 'type').includes(eventType)) return;
    const required = Array.isArray(node.required)
      ? new Set(node.required.filter((value): value is string => typeof value === 'string'))
      : new Set<string>();
    found =
      required.has('type') &&
      required.has('schema') &&
      required.has('model') &&
      required.has('effort');
  });
  return found;
}

function invocationAssessment(): NonNullable<CodexCapabilityAssessment['invocation']> {
  const argv = [...CODEX_READ_ONLY_ARGV_TEMPLATE];
  const approval = argv.indexOf('--ask-for-approval');
  const exec = argv.indexOf('exec');
  return {
    argv_template: argv,
    approval_before_exec: approval >= 0 && approval < exec,
    prompt_last: argv.at(-1) === '-',
  };
}

function baseAssessment(): CodexCapabilityAssessment {
  return {
    schema: ASSESSMENT_SCHEMA,
    supported: false,
    reason_code: null,
    detail: null,
    binary_version: null,
    app_server_methods: [],
    exec_jsonl_contract: {
      present: false,
      contract_id: null,
      identity_event_type: null,
      event_types: [],
    },
    invocation: null,
  };
}

function reject(
  assessment: CodexCapabilityAssessment,
  reasonCode: string,
  detail: string | null = null,
): CodexCapabilityAssessment {
  return { ...assessment, supported: false, reason_code: reasonCode, detail };
}

export function assessCodexCapability(input: CodexCapabilityInput): CodexCapabilityAssessment {
  let assessment = baseAssessment();
  const probes = [
    ['version', input.version, 'version_probe_failed'],
    ['root-help', input.rootHelp, 'root_help_probe_failed'],
    ['exec-help', input.execHelp, 'exec_help_probe_failed'],
    ['app-server-help', input.appServerHelp, 'app_server_help_probe_failed'],
  ] as const;
  for (const [phase, probe, reason] of probes) {
    if (!successfulProbe(probe)) return reject(assessment, reason, phase);
    if (byteLength(probe.stdout) > MAX_HELP_BYTES)
      return reject(assessment, `${phase.replaceAll('-', '_')}_output_too_large`, phase);
  }

  const version = parseVersion(input.version.stdout);
  if (!version) return reject(assessment, 'version_output_unrecognized');
  assessment = { ...assessment, binary_version: version };

  const root = parseHelp(input.rootHelp.stdout);
  if (!root.commands.has('exec')) return reject(assessment, 'root_help_missing_exec');
  if (!root.commands.has('app-server')) return reject(assessment, 'root_help_missing_app_server');
  const approval = root.optionBlocks.get('--ask-for-approval');
  if (!approval || !/\bnever\b/u.test(approval))
    return reject(assessment, 'root_help_missing_approval_never');

  const exec = parseHelp(input.execHelp.stdout);
  if (!/^Usage:\s+codex exec(?:\s|$)/mu.test(input.execHelp.stdout))
    return reject(assessment, 'exec_help_usage_unrecognized');
  for (const option of [
    '--json',
    '--output-schema',
    '--output-last-message',
    '--model',
    '--config',
    '--sandbox',
    '--ephemeral',
    '--cd',
  ]) {
    if (!exec.flags.has(option)) return reject(assessment, 'exec_help_option_missing', option);
  }
  if (!exec.flags.has('-c')) return reject(assessment, 'exec_help_option_missing', '-c');
  if (!exec.flags.has('-C')) return reject(assessment, 'exec_help_option_missing', '-C');
  if (!/key=value/u.test(exec.optionBlocks.get('--config') ?? ''))
    return reject(assessment, 'exec_help_config_contract_missing');
  if (!/\bread-only\b/u.test(exec.optionBlocks.get('--sandbox') ?? ''))
    return reject(assessment, 'exec_help_read_only_sandbox_missing');

  const appServer = parseHelp(input.appServerHelp.stdout);
  if (!/^Usage:\s+codex app-server(?:\s|$)/mu.test(input.appServerHelp.stdout))
    return reject(assessment, 'app_server_help_usage_unrecognized');
  if (!appServer.commands.has('generate-json-schema'))
    return reject(assessment, 'app_server_schema_generator_missing');
  const stdioSupported =
    appServer.flags.has('--stdio') ||
    /stdio:\/\//u.test(appServer.optionBlocks.get('--listen') ?? '');
  if (!stdioSupported) return reject(assessment, 'app_server_stdio_transport_missing');

  const invocation = invocationAssessment();
  if (!invocation.approval_before_exec || !invocation.prompt_last)
    return reject(assessment, 'compiled_invocation_order_invalid');
  assessment = { ...assessment, invocation };

  const clientRaw = input.schemaBundle['ClientRequest.json'];
  if (clientRaw === undefined) return reject(assessment, 'missing_client_request_schema');
  const client = readSchema(clientRaw);
  if (!client.ok) {
    const reason =
      client.reason === 'too_large'
        ? 'client_request_schema_too_large'
        : client.reason === 'too_complex'
          ? 'client_request_schema_too_complex'
          : 'client_request_schema_malformed';
    return reject(assessment, reason);
  }
  const methods = collectDiscriminators(client.value, 'method');
  for (const method of REQUIRED_APP_SERVER_METHODS)
    if (!methods.has(method)) return reject(assessment, 'client_request_method_missing', method);
  assessment = { ...assessment, app_server_methods: [...REQUIRED_APP_SERVER_METHODS] };

  const execRaw = input.schemaBundle['codex_exec_jsonl.schema.json'];
  if (execRaw === undefined) return reject(assessment, 'missing_exec_jsonl_contract');
  const execSchema = readSchema(execRaw);
  if (!execSchema.ok) {
    const reason =
      execSchema.reason === 'too_large'
        ? 'exec_jsonl_schema_too_large'
        : execSchema.reason === 'too_complex'
          ? 'exec_jsonl_schema_too_complex'
          : 'exec_jsonl_schema_malformed';
    return reject(assessment, reason);
  }
  assessment = {
    ...assessment,
    exec_jsonl_contract: { ...assessment.exec_jsonl_contract, present: true },
  };
  if (!isRecord(execSchema.value)) return reject(assessment, 'exec_jsonl_contract_invalid');
  const contractId = execSchema.value['x-ccm-capability-contract'];
  if (contractId !== EXEC_JSONL_CONTRACT) return reject(assessment, 'exec_jsonl_contract_invalid');

  const eventTypes = collectDiscriminators(execSchema.value, 'type');
  for (const type of REQUIRED_EXEC_EVENT_TYPES)
    if (!eventTypes.has(type)) return reject(assessment, 'exec_jsonl_event_missing', type);
  const identityEvent = execSchema.value['x-ccm-identity-event-type'];
  if (
    typeof identityEvent !== 'string' ||
    !eventTypes.has(identityEvent) ||
    !hasIdentityBranch(execSchema.value, identityEvent)
  )
    return reject(assessment, 'exec_jsonl_identity_event_missing');

  assessment = {
    ...assessment,
    supported: true,
    reason_code: null,
    detail: null,
    exec_jsonl_contract: {
      present: true,
      contract_id: contractId,
      identity_event_type: identityEvent,
      event_types: [...eventTypes].sort(),
    },
  };
  return assessment;
}
