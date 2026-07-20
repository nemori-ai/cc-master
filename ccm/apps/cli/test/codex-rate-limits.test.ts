import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeCodexRateLimits } from '../src/codex-rate-limits.js';

test('normalizeCodexRateLimits preserves rateLimitsByLimitId as independent model pools', () => {
  const out = normalizeCodexRateLimits({
    rateLimits: {
      limitId: 'codex',
      limitName: 'Codex default',
      primary: null,
      secondary: { usedPercent: 38, windowDurationMins: 10_080, resetsAt: 1_925_078_400 },
    },
    rateLimitsByLimitId: {
      codex: {
        limitId: 'codex',
        limitName: 'Codex default',
        primary: null,
        secondary: { usedPercent: 38, windowDurationMins: 10_080, resetsAt: 1_925_078_400 },
      },
      codex_bengalfox: {
        limitId: 'codex_bengalfox',
        limitName: 'GPT-5.3-Codex-Spark',
        primary: null,
        secondary: { usedPercent: 0, windowDurationMins: 10_080, resetsAt: 1_925_078_400 },
      },
    },
  });
  assert.ok(out);
  assert.equal(out.signal.five_hour?.used_percentage, null, 'missing 5h stays honestly empty');
  assert.equal(
    out.signal.seven_day?.used_percentage,
    38,
    'legacy top-level window remains compatible',
  );
  assert.deepEqual(out.signal.pools, [
    {
      id: 'codex',
      label: 'Codex default',
      kind: 'first_party',
      used_percentage: 38,
      resets_at: 1_925_078_400,
    },
    {
      id: 'codex_bengalfox',
      label: 'GPT-5.3-Codex-Spark',
      kind: 'first_party',
      used_percentage: 0,
      resets_at: 1_925_078_400,
    },
  ]);
  assert.equal(Object.hasOwn(out.signal, 'rolling_24h'), false, 'do not fabricate a 24h window');
});

test('normalizeCodexRateLimits can use a named pool as the compatible window when legacy is absent', () => {
  const out = normalizeCodexRateLimits({
    rateLimitsByLimitId: {
      codex: {
        limitName: 'Codex default',
        secondary: { usedPercent: 41, windowDurationMins: 10_080, resetsAt: 1_925_078_400 },
      },
    },
  });
  assert.ok(out);
  assert.equal(out.signal.seven_day?.used_percentage, 41);
  assert.equal(out.signal.pools?.[0]?.id, 'codex');
});
