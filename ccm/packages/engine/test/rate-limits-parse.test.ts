// rate-limits-parse.test.ts — Fable model_scoped + rolling window parsers (statusline schema).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  pickFableSevenDayFromRateLimits,
  pickRateLimitWindow,
} from '../src/statusline/rate-limits-parse.ts';

test('pickRateLimitWindow accepts used_percentage + epoch resets_at', () => {
  assert.deepEqual(pickRateLimitWindow({ used_percentage: 42.5, resets_at: 1_750_000_000 }), {
    used_percentage: 42.5,
    resets_at: 1_750_000_000,
  });
});

test('pickFableSevenDayFromRateLimits maps model_scoped Fable 5 row (utilization percent + ISO reset)', () => {
  const out = pickFableSevenDayFromRateLimits({
    five_hour: { used_percentage: 10 },
    model_scoped: [
      { display_name: 'Sonnet 5', utilization: 55, resets_at: '2026-07-25T00:00:00Z' },
      { display_name: 'Fable 5', utilization: 33.5, resets_at: '2026-07-24T18:00:00Z' },
    ],
  });
  assert.ok(out);
  assert.equal(out.used_percentage, 33.5);
  assert.equal(out.resets_at, Math.floor(Date.parse('2026-07-24T18:00:00Z') / 1000));
});

test('pickFableSevenDayFromRateLimits ignores non-fable rows and absent model_scoped', () => {
  assert.equal(
    pickFableSevenDayFromRateLimits({
      model_scoped: [{ display_name: 'Opus 4.8', utilization: 80, resets_at: null }],
    }),
    null,
  );
  assert.equal(pickFableSevenDayFromRateLimits({}), null);
});
