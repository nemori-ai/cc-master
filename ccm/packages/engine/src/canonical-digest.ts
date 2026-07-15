import { canonicalJson } from './canonical-json.js';
import { sha256Hex } from './sha256.js';

/** Public provider-neutral digest for canonical JSON values. */
export function canonicalSha256Digest(value: unknown): string {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}
