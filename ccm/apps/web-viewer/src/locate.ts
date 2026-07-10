import { type RefObject, useEffect, useRef } from 'react';

/**
 * A user-click locate request. The nonce increments once per click so repeat clicks on
 * the same task re-trigger the locate; background polls never touch this object, so
 * polling can never move the viewport or scroll a card (L5 zero-churn stays intact).
 */
export interface LocateRequest {
  taskId: string;
  nonce: number;
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** One-shot highlight pulse via the Web Animations API — immune to React re-renders
 *  overwriting className/style on the 2s poll, and skipped under reduced-motion. */
export function pulseElement(el: HTMLElement): void {
  if (prefersReducedMotion()) return;
  if (typeof el.animate !== 'function') return;
  el.animate(
    [
      { boxShadow: '0 0 0 0 oklch(0.7 0.115 244 / 0.55)' },
      { boxShadow: '0 0 0 12px oklch(0.7 0.115 244 / 0)' },
    ],
    { duration: 950, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
  );
}

/**
 * Card/list/timeline locate: scroll the element carrying data-task-id into view inside
 * the given container and run the one-shot pulse. Fires only when a NEW locate request
 * lands while the view is mounted — never on mount replay, never on polls.
 */
export function useLocateTask(
  containerRef: RefObject<HTMLElement | null>,
  locate: LocateRequest | null,
): void {
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (!locate) return;
    const root = containerRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(locate.taskId)}"]`);
    if (!el) return;
    el.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'center',
      inline: 'center',
    });
    pulseElement(el);
  }, [locate, containerRef]);
}
