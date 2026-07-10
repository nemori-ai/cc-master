import { useCallback, useEffect, useRef, useState } from 'react';
import type { DecisionPackage } from '../types';

export const ASK_META: Record<string, { glyph: string; label: string }> = {
  decision: { glyph: '◈', label: 'decision' },
  advice: { glyph: '◇', label: 'advice' },
  solution: { glyph: '◆', label: 'solution' }
};

function askKeyOf(value: unknown): 'decision' | 'advice' | 'solution' | null {
  return value === 'decision' || value === 'advice' || value === 'solution' ? value : null;
}

/**
 * Rich awaiting-user briefing rendered from a prepared `decision_package`. Every field is
 * guarded — a partial package just omits blocks, nothing throws. The copy button is
 * clipboard-only (navigator.clipboard with a textarea/execCommand fallback — zero network).
 */
export function DecisionCard({ pkg }: { pkg: DecisionPackage }) {
  const [copyState, setCopyState] = useState<'' | 'copied' | 'failed'>('');
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (resetRef.current) clearTimeout(resetRef.current);
    },
    []
  );

  const askKey = askKeyOf(pkg.ask_type);
  const askMeta = askKey ? ASK_META[askKey] : null;
  const cmd = typeof pkg.enter_cmd === 'string' && pkg.enter_cmd.trim() ? pkg.enter_cmd.trim() : '';

  const onCopy = useCallback(() => {
    if (!cmd) return;
    const flash = (state: 'copied' | 'failed') => {
      setCopyState(state);
      if (resetRef.current) clearTimeout(resetRef.current);
      resetRef.current = setTimeout(() => setCopyState(''), 1800);
    };
    try {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(cmd).then(
          () => flash('copied'),
          () => flash('failed')
        );
        return;
      }
    } catch {
      /* fall through to the local textarea fallback */
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = cmd;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      flash(ok ? 'copied' : 'failed');
    } catch {
      setCopyState('failed');
    }
  }, [cmd]);

  const bits = [];

  if (askMeta && askKey) {
    bits.push(
      <div className="askrow" key="askrow">
        <span className={`askbadge ${askKey}`}>
          <span className="glyph">{askMeta.glyph}</span>
          {askMeta.label}
        </span>
      </div>
    );
  }

  if (pkg.freshness === 'stale') {
    bits.push(
      <div className="stalehint" key="stale">
        <span className="glyph">⟲</span>
        可能已过期，进入讨论时会自动刷新
      </div>
    );
  }

  if (typeof pkg.question === 'string' && pkg.question.trim()) {
    bits.push(
      <div className="question" key="q">
        {pkg.question.trim()}
      </div>
    );
  }

  if (typeof pkg.context_md === 'string' && pkg.context_md.trim()) {
    bits.push(
      <div className="context-md" key="ctx">
        {pkg.context_md}
      </div>
    );
  }

  for (const [key, label, value] of [
    ['need', 'what i need', pkg.what_i_need],
    ['why', 'why it matters', pkg.why_it_matters]
  ] as const) {
    if (typeof value === 'string' && value.trim()) {
      bits.push(
        <div className="decfield" key={key}>
          <div className="dfk">{label}</div>
          <div className="dfv">{value.trim()}</div>
        </div>
      );
    }
  }

  const options = Array.isArray(pkg.options) ? pkg.options : [];
  if (options.length) {
    bits.push(
      <div className="options" key="opts">
        {options.map((option, index) => {
          if (!option || typeof option !== 'object') return null;
          const oid = option.id != null && String(option.id).trim() ? String(option.id).trim() : null;
          const label =
            typeof option.label === 'string' && option.label.trim()
              ? option.label.trim()
              : '(unlabeled option)';
          return (
            <div className="opt" key={oid ?? `opt${index}`}>
              <div className="ohead">
                {oid ? <span className="oid">{oid}</span> : null}
                <span className="olabel">{label}</span>
              </div>
              {typeof option.rationale === 'string' && option.rationale.trim() ? (
                <div className="orat">{option.rationale.trim()}</div>
              ) : null}
              {typeof option.tradeoffs === 'string' && option.tradeoffs.trim() ? (
                <div className="otrade">
                  <span className="otk">trade</span>
                  <span>{option.tradeoffs.trim()}</span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  if (cmd) {
    const copyLabel =
      copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败，手动选择下方命令' : '复制命令';
    const copyGlyph = copyState === 'copied' ? '✓' : copyState === 'failed' ? '✕' : '⧉';
    bits.push(
      <div className="copyrow" key="copy">
        <button
          className={`copycmd${copyState ? ` ${copyState}` : ''}`}
          onClick={onCopy}
          title="复制进入讨论的命令到剪贴板（纯本地，零联网）"
          type="button"
        >
          <span className="glyph">{copyGlyph}</span>
          {copyLabel}
        </button>
        <div className="cmdtext">{cmd}</div>
      </div>
    );
  }

  if (!bits.length) return null;
  return <div className="deccard">{bits}</div>;
}
