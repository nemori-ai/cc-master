import { isAbsolute } from 'node:path';
import { canonicalJson, sha256Digest } from '@ccm/engine';

export const CURSOR_PROVIDER_LAUNCH_EXTENSION_SCHEMA =
  'ccm/cursor-provider-launch-extension/v1' as const;

export const CURSOR_PROVIDER_LAUNCH_EXTENSION_REGISTRY = Object.freeze({
  fields: Object.freeze(['schema', 'selector', 'workspace_path', 'executable_path']),
  dispatch_fields: Object.freeze([
    'attempt_id',
    'run_ref',
    'launch_idempotency_key',
    'launch_nonce',
  ]),
  predicate_ids: Object.freeze(['closed-fields', 'schema', 'canonical-selector', 'absolute-paths']),
});

export interface CursorProviderLaunchExtension {
  schema: typeof CURSOR_PROVIDER_LAUNCH_EXTENSION_SCHEMA;
  selector: string;
  workspace_path: string;
  executable_path: string;
}

export interface CursorProviderLaunchDispatch {
  attempt_id: string;
  run_ref: string;
  launch_idempotency_key: string;
  launch_nonce: string;
}

type Data = Record<string, unknown>;

export function parseCursorProviderLaunchExtension(
  value: unknown,
): Readonly<CursorProviderLaunchExtension> | null {
  const extension = object(value);
  if (
    !exactKeys(extension, CURSOR_PROVIDER_LAUNCH_EXTENSION_REGISTRY.fields) ||
    extension.schema !== CURSOR_PROVIDER_LAUNCH_EXTENSION_SCHEMA ||
    !canonicalPlatformString(extension.selector) ||
    extension.selector.toLowerCase() === 'auto' ||
    !canonicalAbsolutePath(extension.workspace_path) ||
    !canonicalAbsolutePath(extension.executable_path)
  ) {
    return null;
  }
  return deepFreeze(structuredClone(extension) as unknown as CursorProviderLaunchExtension);
}

export function normalizeCursorProviderLaunchDispatch(
  value: unknown,
): Readonly<CursorProviderLaunchDispatch> {
  const dispatch = object(value);
  if (
    !exactKeys(dispatch, CURSOR_PROVIDER_LAUNCH_EXTENSION_REGISTRY.dispatch_fields) ||
    !CURSOR_PROVIDER_LAUNCH_EXTENSION_REGISTRY.dispatch_fields.every((field) =>
      canonicalString(dispatch[field]),
    )
  ) {
    throw new TypeError('Cursor provider launch dispatch is invalid');
  }
  return deepFreeze(structuredClone(dispatch) as unknown as CursorProviderLaunchDispatch);
}

export function digestCursorProviderLaunchRequest(
  extensionValue: unknown,
  dispatchValue: unknown,
): string {
  const providerExtension = parseCursorProviderLaunchExtension(extensionValue);
  if (!providerExtension) throw new TypeError('Cursor provider launch extension is invalid');
  const dispatch = normalizeCursorProviderLaunchDispatch(dispatchValue);
  return sha256Digest(canonicalJson({ provider_extension: providerExtension, dispatch }));
}

function object(value: unknown): Data {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Data)
    : {};
}

function exactKeys(value: Data, fields: readonly string[]): boolean {
  const expected = new Set(fields);
  const actual = Object.keys(value);
  return actual.length === expected.size && actual.every((field) => expected.has(field));
}

function canonicalString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function canonicalPlatformString(value: unknown): value is string {
  return canonicalString(value) && !value.includes('\0');
}

function canonicalAbsolutePath(value: unknown): value is string {
  return canonicalPlatformString(value) && isAbsolute(value);
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
