import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONTRACT_VERSION,
  DECLARED_COMMANDS,
  EXIT_CODES,
  contractEnvelope,
} from './contracts.mjs';
import { diagnostic, failureEnvelope, outputDiagnostic } from './diagnostics.mjs';
import { runCheck } from './check.mjs';

const help = `Usage: node scripts/skill-knowledge.mjs <command> [options]

Commands:
  contract [--json]
  check [--source <dir>] [--stage K0|K1|K2|K3] [--host <host>] [--base <git-ref>] [--json]
  compile|report|path|explain|change [--json]   Declared; unavailable in K0

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
    message: `${command} is declared but not implemented in K0`,
    location: 'scripts/skill-knowledge.mjs',
    witness: { command, stage: 'K0' },
    remediation: 'Implement the next admitted slice; do not treat this command as successful.',
    exitCode: EXIT_CODES.capability_not_implemented,
  });
  return failureEnvelope(command, [item]);
}

function unavailableCheckOption(option, value) {
  const item = diagnostic({
    severity: 'error',
    code: 'SKG-CAPABILITY-NOT-IMPLEMENTED',
    message: `check ${option} is declared but not implemented in K0`,
    location: 'scripts/skill-knowledge.mjs',
    witness: { command: 'check', option, value, stage: 'K0' },
    remediation: 'Omit --host/--base in K0, or implement the next admitted slice; do not treat this option as successful.',
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

  if (DECLARED_COMMANDS.includes(command)) {
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
