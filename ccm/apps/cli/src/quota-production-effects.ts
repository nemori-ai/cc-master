import * as fsPromises from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createQuotaEffectBoundary,
  type QuotaEffectBoundary,
  type QuotaEffectInput,
} from '@ccm/engine';

export const QUOTA_FILESYSTEM_CAPABILITIES = Object.freeze([
  'filesystem.quota.open',
  'filesystem.quota.read_file',
  'filesystem.quota.read_directory',
  'filesystem.quota.stat',
  'filesystem.quota.make_directory',
  'filesystem.quota.rename',
  'filesystem.quota.unlink',
] as const);

function path(input: QuotaEffectInput, field = 'path'): string {
  const value = input[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`quota filesystem capability requires ${field}`);
  }
  return value;
}

export function createProductionQuotaEffectBoundary(options: {
  home: string;
}): QuotaEffectBoundary {
  const quotaRoot = resolve(options.home, 'quota', 'v1');
  return createQuotaEffectBoundary({
    profile: 'production',
    allow: QUOTA_FILESYSTEM_CAPABILITIES,
    quotaRoot,
    handlers: {
      'filesystem.quota.open': (input) =>
        fsPromises.open(
          path(input),
          input.flags as string | number,
          input.mode as number | undefined,
        ),
      'filesystem.quota.read_file': (input) =>
        fsPromises.readFile(path(input), input.encoding as BufferEncoding | undefined),
      'filesystem.quota.read_directory': (input) => fsPromises.readdir(path(input)),
      'filesystem.quota.stat': (input) => fsPromises.stat(path(input)),
      'filesystem.quota.make_directory': (input) =>
        fsPromises.mkdir(path(input), input.options as Parameters<typeof fsPromises.mkdir>[1]),
      'filesystem.quota.rename': (input) =>
        fsPromises.rename(path(input, 'from'), path(input, 'to')),
      'filesystem.quota.unlink': (input) => fsPromises.unlink(path(input)),
    },
  });
}

async function execute<T>(
  boundary: QuotaEffectBoundary,
  capability: string,
  input: QuotaEffectInput,
): Promise<T> {
  return (await boundary.execute(capability, input)) as T;
}

export function quotaFilesystemFromBoundary(
  boundary: QuotaEffectBoundary,
  requiredCapabilities: readonly string[] = QUOTA_FILESYSTEM_CAPABILITIES,
): Record<PropertyKey, unknown> {
  boundary.assertCapabilities(requiredCapabilities);
  return {
    open: (filePath: string, flags: string | number, mode?: number) =>
      execute(boundary, 'filesystem.quota.open', { path: filePath, flags, mode }),
    readFile: (filePath: string, encoding?: BufferEncoding) =>
      execute(boundary, 'filesystem.quota.read_file', { path: filePath, encoding }),
    readdir: (directoryPath: string) =>
      execute(boundary, 'filesystem.quota.read_directory', { path: directoryPath }),
    stat: (filePath: string) => execute(boundary, 'filesystem.quota.stat', { path: filePath }),
    mkdir: (directoryPath: string, options?: unknown) =>
      execute(boundary, 'filesystem.quota.make_directory', {
        path: directoryPath,
        options,
      }),
    rename: (from: string, to: string) =>
      execute(boundary, 'filesystem.quota.rename', { from, to }),
    unlink: (filePath: string) => execute(boundary, 'filesystem.quota.unlink', { path: filePath }),
  };
}
