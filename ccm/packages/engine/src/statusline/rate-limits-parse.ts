// rate-limits-parse.ts — shared parsers for Claude Code status-line rate_limits payloads.
//
// Canonical status-line schema (Claude Code >=2.1.170, reverse-engineered from binary + MCP schema;
// **field shapes not live-verified in this sandbox** — model_scoped Fable row needs live statusline):
//   rate_limits.five_hour / seven_day → { used_percentage: 0–100, resets_at?: epoch seconds }
//   rate_limits.model_scoped[] → { display_name: string (e.g. "Fable 5"), utilization: 0–100, resets_at?: ISO }
//
// Red line 1: node/JS only, zero deps.

export interface ParsedRateWindow {
  used_percentage: number;
  resets_at?: number;
}

/** Pick one rolling window object when used_percentage is a finite number. */
export function pickRateLimitWindow(w: unknown): ParsedRateWindow | null {
  if (!w || typeof w !== 'object') return null;
  const o = w as Record<string, unknown>;
  if (typeof o.used_percentage !== 'number' || !Number.isFinite(o.used_percentage)) return null;
  const out: ParsedRateWindow = { used_percentage: o.used_percentage };
  if (typeof o.resets_at === 'number' && Number.isFinite(o.resets_at)) out.resets_at = o.resets_at;
  return out;
}

function parseResetEpoch(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string' && value.trim()) {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return Math.floor(ms / 1000);
  }
  return undefined;
}

/** Normalize utilization to 0–100 (oauth fractions vs percent-style model_scoped rows). */
function usedPercentFromUtilization(utilization: number): number {
  const pct = utilization > 0 && utilization <= 1 ? utilization * 100 : utilization;
  return Math.min(100, Math.max(0, pct));
}

function isFableDisplayName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized.includes('fable');
}

/**
 * Extract the independent Fable 5 weekly window from rate_limits.model_scoped.
 * Matches display_name containing "fable" (case-insensitive; e.g. "Fable 5").
 */
export function pickFableSevenDayFromRateLimits(
  rateLimits: Record<string, unknown> | null | undefined,
): ParsedRateWindow | null {
  const scoped = rateLimits?.model_scoped;
  if (!Array.isArray(scoped)) return null;
  for (const item of scoped) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const displayName = typeof row.display_name === 'string' ? row.display_name : '';
    if (!isFableDisplayName(displayName)) continue;
    const utilization = row.utilization;
    if (typeof utilization !== 'number' || !Number.isFinite(utilization)) continue;
    const out: ParsedRateWindow = {
      used_percentage: usedPercentFromUtilization(utilization),
    };
    const reset = parseResetEpoch(row.resets_at);
    if (reset !== undefined) out.resets_at = reset;
    return out;
  }
  return null;
}
