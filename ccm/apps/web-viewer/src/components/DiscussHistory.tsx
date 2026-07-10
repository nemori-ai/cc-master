import { useState } from 'react';
import { localTime } from '../format';
import type { DecisionEntry } from '../types';
import { ASK_META } from './DecisionCard';

/**
 * A node's past-discussion record: a collapsible summary line (count + latest TL;DR + time)
 * expanding to per-round entries. Every field is guarded — a sidecar missing tldr /
 * resolved_at / round still renders; a wholly empty entry is skipped, never throws.
 */
export function DiscussHistory({ items }: { items: DecisionEntry[] }) {
  const [open, setOpen] = useState(false);
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return null;

  const latest = list[list.length - 1];
  const latestTldr =
    latest && typeof latest.tldr === 'string' && latest.tldr.trim() ? latest.tldr.trim() : null;
  const latestWhen = latest ? localTime(latest.resolved_at) : null;

  const rows = list
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') return null;
      const round = Number(entry.round);
      const roundStr = Number.isFinite(round) ? `#${round}` : null;
      const when = localTime(entry.resolved_at);
      const askKey =
        entry.ask_type === 'decision' || entry.ask_type === 'advice' || entry.ask_type === 'solution'
          ? entry.ask_type
          : null;
      const askMeta = askKey ? ASK_META[askKey] : null;
      const tldr = typeof entry.tldr === 'string' && entry.tldr.trim() ? entry.tldr.trim() : null;
      if (!roundStr && !when && !askMeta && !tldr) return null;
      return (
        <div className="dh-entry" key={`${roundStr ?? ''}${index}`}>
          <div className="dh-ehead">
            {roundStr ? <span className="dh-round">{roundStr}</span> : null}
            {askMeta && askKey ? (
              <span className={`askbadge ${askKey}`}>
                <span className="glyph">{askMeta.glyph}</span>
                {askMeta.label}
              </span>
            ) : null}
            {when ? <span className="dh-when">{when}</span> : null}
          </div>
          {tldr ? <div className="dh-etldr">{tldr}</div> : null}
        </div>
      );
    })
    .filter(Boolean);

  return (
    <div className="dischist-box">
      <button
        className={`dh-summary${open ? ' open' : ''}`}
        onClick={() => setOpen((value) => !value)}
        title={open ? '收起讨论历史' : '展开讨论历史'}
        type="button"
      >
        <span className="dh-caret">{open ? '▾' : '▸'}</span>
        <span className="dh-summary-text">
          <span className="dh-count">已讨论 {list.length} 次</span>
          {latestTldr ? <span className="dh-tldr">最近结论：{latestTldr}</span> : null}
          {latestWhen ? <span className="dh-when">{latestWhen}</span> : null}
        </span>
      </button>
      {open && rows.length ? <div className="dh-entries">{rows}</div> : null}
    </div>
  );
}
