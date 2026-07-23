import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONTRACT_VERSION,
  DECLARED_COMMANDS,
  EXIT_CODES,
  IMPLEMENTED_COMMANDS,
  contractEnvelope,
} from './contracts.mjs';
import { diagnostic, failureEnvelope } from './diagnostics.mjs';
import { runCheck } from './check.mjs';
import {
  applyTransaction,
  beginTransaction,
  publicTransactionResult,
  validateTransaction,
} from './transactions.mjs';
import { assertReportFormat, runExplain, runPath, runReport } from './query.mjs';

const help = `Usage: node scripts/skill-knowledge.mjs <command> [options]

Commands:
  contract [--json]
  check [--source <dir>] [--stage K0|K1|K2|K3] [--host <host>] [--base <git-ref>] [--json]
  change begin --op <${'add|wording|refine|move|split|merge|transfer_owner|deprecate|retire'}> --scope <path...> --base <git-ref> [--json]
  change validate <workspace> [--json]
  change apply <workspace> [--json]
  report [--source <dir>] [--format json|markdown] [--host <host>] [--json]
  path --from <id> --to <id> --host <host> [--source <dir>] [--json]
  explain <id-or-code> [--source <dir>] [--json]
  compile [--json]   Declared; unavailable in K1 pilot

Global:
  --help
  --version
`;

function parseCheckOptions(args) {
  const options = { source: undefined, stage: 'K0', host: undefined, base: undefined, json: false };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--json') options.json = true;
    else if (token === '--source') {
      index += 1;
      if (!args[index]) throw new Error('--source requires a directory');
      options.source = args[index];
    } else if (token === '--stage') {
      index += 1;
      if (!args[index]) throw new Error('--stage requires K0, K1, K2, or K3');
      options.stage = args[index];
    } else if (token === '--host') {
      index += 1;
      if (!args[index]) throw new Error('--host requires a host');
      options.host = args[index];
    } else if (token === '--base') {
      index += 1;
      if (!args[index]) throw new Error('--base requires a git ref');
      options.base = args[index];
    } else {
      throw new Error(`unknown check argument: ${token}`);
    }
  }
  return options;
}

function parseChangeOptions(args) {
  const [action, ...rest] = args;
  if (!['begin', 'validate', 'apply'].includes(action)) throw new Error('change requires begin, validate, or apply');
  const options = { action, json: false, op: undefined, scope: [], base: undefined, workspace: undefined };
  if (action === 'validate' || action === 'apply') {
    for (const token of rest) {
      if (token === '--json') options.json = true;
      else if (!options.workspace) options.workspace = token;
      else throw new Error(`unknown change ${action} argument: ${token}`);
    }
    if (!options.workspace) throw new Error(`change ${action} requires a workspace`);
    return options;
  }
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === '--json') options.json = true;
    else if (token === '--op') { index += 1; if (!rest[index]) throw new Error('--op requires an operation'); options.op = rest[index]; }
    else if (token === '--base') { index += 1; if (!rest[index]) throw new Error('--base requires a git ref'); options.base = rest[index]; }
    else if (token === '--scope') {
      while (rest[index + 1] && !rest[index + 1].startsWith('--')) { index += 1; options.scope.push(rest[index]); }
      if (options.scope.length === 0) throw new Error('--scope requires one or more paths');
    } else throw new Error(`unknown change begin argument: ${token}`);
  }
  if (!options.op || !options.base || options.scope.length === 0) throw new Error('change begin requires --op, --scope, and --base');
  return options;
}

function parseSourceJsonOptions(args, { allowFormat = false, allowHost = false } = {}) {
  const options = {
    source: undefined,
    host: undefined,
    format: 'json',
    json: false,
    positionals: [],
  };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--json') options.json = true;
    else if (token === '--source') {
      index += 1;
      if (!args[index]) throw new Error('--source requires a directory');
      options.source = args[index];
    } else if (token === '--host') {
      if (!allowHost) throw new Error('unknown argument: --host');
      index += 1;
      if (!args[index]) throw new Error('--host requires a host');
      options.host = args[index];
    } else if (token === '--format') {
      if (!allowFormat) throw new Error('unknown argument: --format');
      index += 1;
      if (!args[index]) throw new Error('--format requires json|markdown');
      options.format = args[index];
      if (options.format === 'json') options.json = true;
    } else if (token === '--from' || token === '--to') {
      index += 1;
      if (!args[index]) throw new Error(`${token} requires an id`);
      options[token.slice(2)] = args[index];
    } else if (token.startsWith('-')) {
      throw new Error(`unknown argument: ${token}`);
    } else {
      options.positionals.push(token);
    }
  }
  return options;
}

function renderHuman(body) {
  if (body.result_kind === 'contract') {
    return [
      `skill-knowledge contract ${body.contract_version}`,
      `implemented: ${body.implemented_commands.join(', ')}`,
      `declared: ${body.declared_commands.join(', ')}`,
    ].join('\n');
  }
  if (body.result_kind === 'check') {
    const lines = [
      `skill-knowledge check ${body.stage}: ${body.ok ? 'OK' : 'FAILED'}`,
      `source: ${body.source_root}`,
      `documents: ${body.summary.documents}; errors: ${body.summary.errors}; debts: ${body.summary.debts}`,
    ];
    for (const item of body.diagnostics) {
      lines.push(`${item.severity.toUpperCase()} ${item.code}: ${item.message}`);
    }
    return lines.join('\n');
  }
  if (body.result_kind === 'change') {
    const lines = [`skill-knowledge change ${body.action}: ${body.ok ? 'OK' : 'FAILED'}`];
    if (body.workspace) lines.push(`workspace: ${body.workspace}`);
    if (body.ledger_path) lines.push(`ledger: ${body.ledger_path}`);
    for (const item of body.diagnostics) lines.push(`${item.severity.toUpperCase()} ${item.code}: ${item.message}`);
    return lines.join('\n');
  }
  if (body.result_kind === 'report') {
    const lines = [
      `skill-knowledge report: ${body.ok ? 'OK' : 'FAILED'}`,
      `structural: ${body.structural_status.state}; behavioral: ${body.behavioral_evidence_status.state}`,
    ];
    if (body.graph_hash) lines.push(`graph_hash: ${body.graph_hash}`);
    for (const item of body.diagnostics) {
      lines.push(`${item.severity.toUpperCase()} ${item.code}: ${item.message}`);
    }
    return lines.join('\n');
  }
  if (body.result_kind === 'path') {
    const pathResult = body.path_result;
    return [
      `skill-knowledge path: ${pathResult.reachable ? 'REACHABLE' : 'UNREACHABLE'}`,
      `from ${body.path_query.from} -> ${body.path_query.to} (host=${body.path_query.host})`,
      `hops: ${pathResult.hops}`,
      `nodes: ${(pathResult.nodes ?? []).join(' -> ')}`,
    ].join('\n');
  }
  if (body.result_kind === 'explain') {
    return [
      `skill-knowledge explain ${body.explain_target}`,
      `kind: ${body.entity.kind}; id: ${body.entity.id}`,
    ].join('\n');
  }
  return body.diagnostics
    .map((item) => `${item.severity.toUpperCase()} ${item.code}: ${item.message}`)
    .join('\n');
}

function emit(body, json, stream = process.stdout) {
  stream.write(json ? `${JSON.stringify(body, null, 2)}\n` : `${renderHuman(body)}\n`);
}

function usageFailure(command, message) {
  const item = diagnostic({
    severity: 'error',
    code: 'SKG-USAGE',
    message,
    location: 'argv',
    witness: { command, declared_commands: [...DECLARED_COMMANDS] },
    remediation: 'Run node scripts/skill-knowledge.mjs --help and use a declared command.',
    exitCode: EXIT_CODES.usage,
  });
  return failureEnvelope(command, [item]);
}

function unavailable(command) {
  const item = diagnostic({
    severity: 'error',
    code: 'SKG-CAPABILITY-NOT-IMPLEMENTED',
    message: `${command} is declared but not implemented in K1 pilot`,
    location: 'scripts/skill-knowledge.mjs',
    witness: { command, stage: 'K1' },
    remediation: 'Implement the next admitted slice; do not treat this command as successful.',
    exitCode: EXIT_CODES.capability_not_implemented,
  });
  return failureEnvelope(command, [item]);
}

function unavailableCheckOption(option, value) {
  const item = diagnostic({
    severity: 'error',
    code: 'SKG-CAPABILITY-NOT-IMPLEMENTED',
    message: `check ${option} is declared but not implemented in K1 pilot`,
    location: 'scripts/skill-knowledge.mjs',
    witness: { command: 'check', option, value, stage: 'K1' },
    remediation:
      'Omit --host/--base until changed-scope / host portability slices land; do not treat this option as successful.',
    exitCode: EXIT_CODES.capability_not_implemented,
  });
  return failureEnvelope('check', [item]);
}

export function main(argv = process.argv.slice(2)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const json = argv.includes('--json');
  const command = argv.find((token) => !token.startsWith('-'));

  if (argv.includes('--version')) {
    process.stdout.write(`${CONTRACT_VERSION}\n`);
    return 0;
  }
  if (argv.includes('--help') || argv.length === 0) {
    process.stdout.write(help);
    return 0;
  }

  if (command === 'contract') {
    const extra = argv.filter((token) => token !== 'contract' && token !== '--json');
    if (extra.length > 0) {
      emit(usageFailure(command, `unknown contract argument: ${extra[0]}`), json, process.stdout);
      return EXIT_CODES.usage;
    }
    emit(contractEnvelope(), json);
    return 0;
  }

  if (command === 'check') {
    let options;
    try {
      const commandIndex = argv.indexOf(command);
      options = parseCheckOptions(argv.slice(commandIndex + 1));
    } catch (error) {
      emit(usageFailure(command, error.message), json, process.stdout);
      return EXIT_CODES.usage;
    }
    if (options.host !== undefined || options.base !== undefined) {
      const option = options.host !== undefined ? '--host' : '--base';
      const value = options.host !== undefined ? options.host : options.base;
      emit(unavailableCheckOption(option, value), options.json);
      return EXIT_CODES.capability_not_implemented;
    }
    const result = runCheck({
      repoRoot,
      source: options.source,
      stage: options.stage,
    });
    emit(result.body, options.json);
    return result.exitCode;
  }

  if (command === 'change') {
    let options;
    try { options = parseChangeOptions(argv.slice(argv.indexOf(command) + 1)); }
    catch (error) { emit(usageFailure(command, error.message), json); return EXIT_CODES.usage; }
    const workspace = path.resolve(repoRoot, options.workspace ?? '.');
    const result = options.action === 'begin'
      ? beginTransaction({ repoRoot, operation: options.op, scope: options.scope, base: options.base })
      : options.action === 'validate'
        ? validateTransaction({ repoRoot, workspace })
        : applyTransaction({ repoRoot, workspace });
    emit(publicTransactionResult(options.action, result, repoRoot), options.json);
    return result.exitCode;
  }

  if (command === 'report') {
    let options;
    try {
      options = parseSourceJsonOptions(argv.slice(argv.indexOf(command) + 1), {
        allowFormat: true,
        allowHost: true,
      });
    } catch (error) {
      emit(usageFailure(command, error.message), json || false);
      return EXIT_CODES.usage;
    }
    if (options.host !== undefined) {
      emit(
        unavailable('report --host'),
        options.json || json || options.format === 'json',
      );
      return EXIT_CODES.capability_not_implemented;
    }
    const formatError = assertReportFormat(options.format);
    if (formatError) {
      emit(failureEnvelope('report', [formatError]), true);
      return EXIT_CODES.usage;
    }
    if (options.format === 'markdown') {
      const item = diagnostic({
        severity: 'error',
        code: 'SKG-CAPABILITY-NOT-IMPLEMENTED',
        message: 'report --format markdown is declared but not implemented in K1 pilot',
        location: 'scripts/skill-knowledge.mjs',
        witness: { command: 'report', format: 'markdown', stage: 'K1' },
        remediation: 'Use --format json / --json for the pilot query surface.',
        exitCode: EXIT_CODES.capability_not_implemented,
      });
      emit(failureEnvelope('report', [item]), true);
      return EXIT_CODES.capability_not_implemented;
    }
    const result = runReport({ repoRoot, source: options.source });
    emit(result.body, true);
    return result.exitCode;
  }

  if (command === 'path') {
    let options;
    try {
      options = parseSourceJsonOptions(argv.slice(argv.indexOf(command) + 1), {
        allowHost: true,
      });
    } catch (error) {
      emit(usageFailure(command, error.message), json);
      return EXIT_CODES.usage;
    }
    const result = runPath({
      repoRoot,
      source: options.source,
      from: options.from,
      to: options.to,
      host: options.host,
    });
    emit(result.body, options.json || json);
    return result.exitCode;
  }

  if (command === 'explain') {
    let options;
    try {
      options = parseSourceJsonOptions(argv.slice(argv.indexOf(command) + 1));
    } catch (error) {
      emit(usageFailure(command, error.message), json);
      return EXIT_CODES.usage;
    }
    const result = runExplain({
      repoRoot,
      source: options.source,
      target: options.positionals[0],
    });
    emit(result.body, options.json || json);
    return result.exitCode;
  }

  if (DECLARED_COMMANDS.includes(command) && !IMPLEMENTED_COMMANDS.includes(command)) {
    emit(unavailable(command), json);
    return EXIT_CODES.capability_not_implemented;
  }

  emit(usageFailure(command ?? '<missing>', `unknown command: ${command ?? '<missing>'}`), json);
  return EXIT_CODES.usage;
}

export function internalFailure(argv, error) {
  const command = argv.find((token) => !token.startsWith('-')) ?? '<missing>';
  const item = diagnostic({
    severity: 'error',
    code: 'SKG-INTERNAL',
    message: 'Unexpected skill-knowledge internal error.',
    location: 'scripts/skill-knowledge.mjs',
    witness: { command, error: error instanceof Error ? error.message : String(error) },
    remediation: 'Treat this run as failed and inspect the implementation; do not suppress it.',
    exitCode: EXIT_CODES.internal,
  });
  return {
    exitCode: EXIT_CODES.internal,
    body: failureEnvelope(command, [item]),
    json: argv.includes('--json'),
  };
}
