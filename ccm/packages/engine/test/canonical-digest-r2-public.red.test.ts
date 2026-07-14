import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import * as engine from '../dist/index.mjs';

test('R2 @ccm/engine publicly owns pure SHA-256 and canonical-value digest parity', () => {
  const publicApi = engine as Record<string, any>;
  assert.equal(typeof publicApi.sha256Hex, 'function', 'sha256Hex must be a public engine API');
  assert.equal(
    typeof publicApi.canonicalSha256Digest,
    'function',
    'canonicalSha256Digest must be a public engine API',
  );
  for (const input of ['', 'ccm', '原点-🚀']) {
    assert.equal(publicApi.sha256Hex(input), createHash('sha256').update(input).digest('hex'));
  }
  const value = { z: ['🚀', 1], a: { beta: true, alpha: '原点' } };
  assert.equal(
    publicApi.canonicalSha256Digest(value),
    `sha256:${createHash('sha256').update(publicApi.canonicalJson(value)).digest('hex')}`,
  );
});
