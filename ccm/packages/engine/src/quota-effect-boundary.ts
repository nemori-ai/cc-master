import { isAbsolute, relative, resolve } from 'node:path';

export const QUOTA_PRODUCTION_EFFECT_ALLOWLIST = Object.freeze([
  'auth.observe',
  'quota.observe',
  'filesystem.quota.open',
  'filesystem.quota.read_file',
  'filesystem.quota.read_directory',
  'filesystem.quota.stat',
  'filesystem.quota.lstat',
  'filesystem.quota.make_directory',
  'filesystem.quota.rename',
  'filesystem.quota.unlink',
  'filesystem.quota.lock',
  'pinned.route.read',
  'pinned.runtime.read',
  'pinned.supervisor.read',
] as const);

const QUOTA_TEST_ONLY_EFFECT_ALLOWLIST = Object.freeze([
  'test.clock.now',
  'test.random.id',
  'test.trace.record',
] as const);

export const QUOTA_TEST_EFFECT_ALLOWLIST = Object.freeze([
  ...QUOTA_PRODUCTION_EFFECT_ALLOWLIST,
  ...QUOTA_TEST_ONLY_EFFECT_ALLOWLIST,
] as const);

export const ACCOUNT_MUTATION_CAPABILITIES = Object.freeze([
  'account_login',
  'account_logout',
  'account_switch',
  'session_switch',
  'credential_import',
  'credential_copy',
  'credential_write',
  'auth_write',
] as const);

export const FORBIDDEN_QUOTA_EFFECT_CAPABILITIES = Object.freeze([
  'process.spawn',
  'network.connect',
  'network.socket',
  'network.dns',
  'network.http',
  'provider.invoke',
  'provider.spawn',
  'model.invoke',
  'keychain.read',
  'keychain.write',
  'keychain.delete',
  'board.write',
  'task.done',
  'repo.write',
  'runtime.activate',
  ...ACCOUNT_MUTATION_CAPABILITIES,
] as const);

export type QuotaProductionEffectCapability = (typeof QUOTA_PRODUCTION_EFFECT_ALLOWLIST)[number];
export type QuotaTestEffectCapability = (typeof QUOTA_TEST_EFFECT_ALLOWLIST)[number];
export type QuotaEffectCapability = QuotaProductionEffectCapability | QuotaTestEffectCapability;
export type ForbiddenQuotaEffectCapability = (typeof FORBIDDEN_QUOTA_EFFECT_CAPABILITIES)[number];
export type QuotaEffectProfile = 'production' | 'test';

export type QuotaEffectErrorCode =
  | 'ACCOUNT_MUTATION_FORBIDDEN'
  | 'QUOTA_EFFECT_FORBIDDEN'
  | 'QUOTA_CAPABILITY_UNDECLARED'
  | 'QUOTA_CAPABILITY_UNAVAILABLE';

export class QuotaEffectError extends Error {
  readonly code: QuotaEffectErrorCode;
  readonly capability: string;

  constructor(code: QuotaEffectErrorCode, capability: string, detail: string) {
    super(`${code}: ${capability}: ${detail}`);
    this.name = 'QuotaEffectError';
    this.code = code;
    this.capability = capability;
  }
}

export type QuotaEffectInput = Readonly<Record<string, unknown>>;
export type QuotaEffectHandler = (input: QuotaEffectInput) => unknown | Promise<unknown>;

export interface QuotaEffectBoundary {
  readonly profile: QuotaEffectProfile;
  readonly declaredCapabilities: readonly QuotaEffectCapability[];
  execute(capability: string, input: QuotaEffectInput): unknown | Promise<unknown>;
}

export interface CreateQuotaEffectBoundaryOptions {
  profile?: QuotaEffectProfile;
  allow: readonly string[];
  handlers: Readonly<Record<string, QuotaEffectHandler | undefined>>;
  quotaRoot?: string;
}

const ACCOUNT_MUTATION_SET: ReadonlySet<string> = new Set(ACCOUNT_MUTATION_CAPABILITIES);
const FORBIDDEN_CAPABILITY_SET: ReadonlySet<string> = new Set(FORBIDDEN_QUOTA_EFFECT_CAPABILITIES);
const PRODUCTION_CAPABILITY_SET: ReadonlySet<string> = new Set(QUOTA_PRODUCTION_EFFECT_ALLOWLIST);
const TEST_CAPABILITY_SET: ReadonlySet<string> = new Set(QUOTA_TEST_EFFECT_ALLOWLIST);

function denialCode(capability: string): QuotaEffectErrorCode {
  return ACCOUNT_MUTATION_SET.has(capability)
    ? 'ACCOUNT_MUTATION_FORBIDDEN'
    : 'QUOTA_EFFECT_FORBIDDEN';
}

function rejectCapability(capability: string, detail: string): never {
  throw new QuotaEffectError(denialCode(capability), capability, detail);
}

function isQuotaFilesystemCapability(capability: string): boolean {
  return capability.startsWith('filesystem.quota.');
}

function pathInside(root: string, candidate: unknown): candidate is string {
  if (typeof candidate !== 'string' || !isAbsolute(candidate)) return false;
  const offset = relative(root, resolve(candidate));
  return offset === '' || (!offset.startsWith('..') && !isAbsolute(offset));
}

function enforceFilesystemScope(
  capability: string,
  input: QuotaEffectInput,
  quotaRoot: string | undefined,
): void {
  if (!isQuotaFilesystemCapability(capability)) return;
  if (!quotaRoot) rejectCapability(capability, 'quotaRoot is required for filesystem authority');

  if (capability === 'filesystem.quota.rename') {
    if (!pathInside(quotaRoot, input.from) || !pathInside(quotaRoot, input.to)) {
      rejectCapability(capability, 'rename from/to must both remain inside quotaRoot');
    }
    return;
  }
  if (!pathInside(quotaRoot, input.path)) {
    rejectCapability(capability, 'path must remain inside quotaRoot');
  }
}

export function createQuotaEffectBoundary(
  options: CreateQuotaEffectBoundaryOptions,
): QuotaEffectBoundary {
  const profile = options.profile ?? 'production';
  if (profile !== 'production' && profile !== 'test') {
    rejectCapability('profile', `unknown quota effect profile: ${String(profile)}`);
  }
  const profileCapabilities = profile === 'test' ? TEST_CAPABILITY_SET : PRODUCTION_CAPABILITY_SET;
  const declared = [...options.allow];
  const declaredSet = new Set<string>();

  for (const capability of declared) {
    if (!profileCapabilities.has(capability) || FORBIDDEN_CAPABILITY_SET.has(capability)) {
      rejectCapability(capability, `capability is not permitted in the ${profile} profile`);
    }
    if (declaredSet.has(capability)) {
      rejectCapability(capability, 'duplicate capability declaration');
    }
    declaredSet.add(capability);
  }

  const filesystemDeclared = declared.some(isQuotaFilesystemCapability);
  let quotaRoot: string | undefined;
  if (filesystemDeclared) {
    if (!options.quotaRoot || !isAbsolute(options.quotaRoot)) {
      rejectCapability('filesystem.quota.*', 'an absolute quotaRoot is required');
    }
    quotaRoot = resolve(options.quotaRoot);
  }

  const handlers: Record<string, QuotaEffectHandler> = Object.create(null) as Record<
    string,
    QuotaEffectHandler
  >;
  for (const [capability, handler] of Object.entries(options.handlers)) {
    if (!profileCapabilities.has(capability) || FORBIDDEN_CAPABILITY_SET.has(capability)) {
      rejectCapability(capability, `handler is not permitted in the ${profile} profile`);
    }
    if (!declaredSet.has(capability)) {
      throw new QuotaEffectError(
        'QUOTA_CAPABILITY_UNDECLARED',
        capability,
        'handler was provided without a matching allow declaration',
      );
    }
    if (typeof handler !== 'function') continue;
    handlers[capability] = handler;
  }
  Object.freeze(handlers);

  const declaredCapabilities = Object.freeze(
    declared as QuotaEffectCapability[],
  ) as readonly QuotaEffectCapability[];

  return Object.freeze({
    profile,
    declaredCapabilities,
    execute(capability: string, input: QuotaEffectInput): unknown | Promise<unknown> {
      if (!profileCapabilities.has(capability) || FORBIDDEN_CAPABILITY_SET.has(capability)) {
        rejectCapability(capability, `capability is not permitted in the ${profile} profile`);
      }
      if (!declaredSet.has(capability)) {
        throw new QuotaEffectError(
          'QUOTA_CAPABILITY_UNDECLARED',
          capability,
          'capability was not declared by this boundary',
        );
      }
      const handler = handlers[capability];
      if (!handler) {
        throw new QuotaEffectError(
          'QUOTA_CAPABILITY_UNAVAILABLE',
          capability,
          'declared capability has no executable handler',
        );
      }
      enforceFilesystemScope(capability, input, quotaRoot);
      return handler(Object.freeze({ ...input }));
    },
  });
}
