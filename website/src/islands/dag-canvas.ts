/**
 * dag-canvas.ts — the hero signature animation.
 * A goal decomposes into a DAG: nodes appear rank by rank, parallel branches
 * light up together, the critical path traces in amber. ~9s loop, deterministic.
 * Respects prefers-reduced-motion (renders the final frame once) and theme flips.
 */

interface Node {
  id: string;
  x: number; // 0..1 fraction of width
  y: number; // 0..1 fraction of height
  rank: number;
  critical?: boolean;
  w?: number; // node width fraction
}

interface Edge { from: string; to: string }

const NODES: Node[] = [
  { id: 'T0', x: 0.07, y: 0.5, rank: 0, critical: true },
  { id: 'T1', x: 0.26, y: 0.3, rank: 1, critical: true },
  { id: 'M1', x: 0.26, y: 0.72, rank: 1 },
  { id: 'L1', x: 0.48, y: 0.1, rank: 2 },
  { id: 'L2', x: 0.48, y: 0.26, rank: 2 },
  { id: 'L3', x: 0.48, y: 0.42, rank: 2, critical: true },
  { id: 'L4', x: 0.48, y: 0.58, rank: 2 },
  { id: 'L5', x: 0.5, y: 0.74, rank: 2 },
  { id: 'L6', x: 0.5, y: 0.9, rank: 2 },
  { id: 'INT', x: 0.72, y: 0.42, rank: 3, critical: true },
  { id: 'QG', x: 0.72, y: 0.68, rank: 3 },
  { id: 'SHIP', x: 0.9, y: 0.5, rank: 4, critical: true, w: 0.075 },
];

const EDGES: Edge[] = [
  { from: 'T0', to: 'T1' }, { from: 'T0', to: 'M1' },
  { from: 'T1', to: 'L1' }, { from: 'T1', to: 'L2' }, { from: 'T1', to: 'L3' },
  { from: 'T1', to: 'L4' }, { from: 'M1', to: 'L5' }, { from: 'M1', to: 'L6' },
  { from: 'L3', to: 'INT' }, { from: 'L2', to: 'INT' }, { from: 'L1', to: 'INT' },
  { from: 'L4', to: 'QG' }, { from: 'L5', to: 'QG' }, { from: 'L6', to: 'QG' },
  { from: 'INT', to: 'SHIP' }, { from: 'QG', to: 'SHIP' },
];

const CYCLE = 9000; // ms
const DONE_AT = 0.62; // fraction of cycle when all nodes are done
const TRACE_AT = 0.68; // critical-path trace begins
const FADE_AT = 0.94; // loop fade-out begins

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function mountDagCanvas(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0;
  let start = performance.now();
  let destroyed = false;

  const colors = () => {
    const cs = getComputedStyle(document.documentElement);
    return {
      hair: cs.getPropertyValue('--hair').trim() || '#888',
      faint: cs.getPropertyValue('--ink-faint').trim() || '#999',
      panel: cs.getPropertyValue('--panel-hi').trim() || '#fff',
      done: cs.getPropertyValue('--done').trim() || 'green',
      inflight: cs.getPropertyValue('--inflight').trim() || 'orange',
      ready: cs.getPropertyValue('--ready').trim() || 'steelblue',
      spine: cs.getPropertyValue('--spine').trim() || 'darkorange',
    };
  };
  let c = colors();
  const themeObserver = new MutationObserver(() => { c = colors(); });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { clientWidth: w, clientHeight: h } = canvas;
    if (w === 0 || h === 0) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  // per-node timing: appear staggered by rank, then work, then done
  const timing = NODES.map((n, i) => {
    const appear = 0.03 + n.rank * 0.055;
    const runStart = appear + 0.09;
    const dur = n.critical ? 0.16 : 0.13;
    return { appear, runStart, done: Math.min(runStart + dur + (i % 3) * 0.012, DONE_AT) };
  });
  const nodeById = new Map(NODES.map((n, i) => [n.id, { n, t: timing[i] }]));

  function draw(now: number) {
    if (destroyed) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) { raf = requestAnimationFrame(draw); return; }

    const elapsed = reduced ? CYCLE : (now - start) % CYCLE;
    const t = reduced ? DONE_AT + 0.06 : elapsed / CYCLE;
    const loopFade = reduced ? 1 : t > FADE_AT ? 1 - ease((t - FADE_AT) / (1 - FADE_AT)) : 1;

    ctx!.clearRect(0, 0, w, h);

    const nw = (id: string) => (nodeById.get(id)!.n.w ?? 0.062) * w;
    const nh = Math.max(18, h * 0.085);
    const pos = (id: string) => {
      const { n } = nodeById.get(id)!;
      return { x: n.x * w, y: n.y * h };
    };

    // edges — appear as their source node starts running
    for (const e of EDGES) {
      const src = nodeById.get(e.from)!;
      const dst = nodeById.get(e.to)!;
      const p = clamp01((t - src.t.runStart) / 0.1);
      if (p <= 0) continue;
      const a = ease(p);
      const { x: x1, y: y1 } = pos(e.from);
      const { x: x2, y: y2 } = pos(e.to);
      const mx = x1 + (x2 - x1) * 0.5;
      ctx!.beginPath();
      ctx!.moveTo(x1 + nw(e.from) / 2, y1);
      ctx!.bezierCurveTo(mx, y1, mx, y2, x2 - nw(e.to) / 2, y2);
      ctx!.strokeStyle = c.hair;
      ctx!.globalAlpha = 0.9 * a * loopFade;
      ctx!.lineWidth = 1;
      ctx!.stroke();
      ctx!.globalAlpha = 1;
    }

    // critical path trace
    const critPath = EDGES.filter((e) => nodeById.get(e.from)!.n.critical && nodeById.get(e.to)!.n.critical);
    const trace = clamp01((t - TRACE_AT) / 0.22);
    if (trace > 0) {
      const per = trace / critPath.length;
      critPath.forEach((e, i) => {
        const local = clamp01((trace - i * per) / per);
        if (local <= 0) return;
        const { x: x1, y: y1 } = pos(e.from);
        const { x: x2, y: y2 } = pos(e.to);
        const mx = x1 + (x2 - x1) * 0.5;
        const xe = x1 + (x2 - x1) * local;
        ctx!.beginPath();
        ctx!.moveTo(x1 + nw(e.from) / 2, y1);
        if (local >= 1) {
          ctx!.bezierCurveTo(mx, y1, mx, y2, x2 - nw(e.to) / 2, y2);
        } else {
          ctx!.bezierCurveTo(mx, y1, mx, y1 + (y2 - y1) * local * 0.6, xe, y1 + (y2 - y1) * local);
        }
        ctx!.strokeStyle = c.spine;
        ctx!.globalAlpha = 0.95 * loopFade;
        ctx!.lineWidth = 2.2;
        ctx!.shadowColor = c.spine;
        ctx!.shadowBlur = 8;
        ctx!.stroke();
        ctx!.shadowBlur = 0;
        ctx!.globalAlpha = 1;
      });
    }

    // nodes
    NODES.forEach((n, i) => {
      const tm = timing[i];
      const appear = ease(clamp01((t - tm.appear) / 0.06));
      if (appear <= 0) return;
      const running = t >= tm.runStart && t < tm.done;
      const done = t >= tm.done;
      const x = n.x * w;
      const y = n.y * h;
      const w2 = (n.w ?? 0.062) * w;
      const pulse = running ? 0.5 + 0.5 * Math.sin(now / 240 + i) : 0;
      const lampC = done ? c.done : running ? c.inflight : c.ready;

      // card
      ctx!.globalAlpha = appear * loopFade;
      ctx!.beginPath();
      ctx!.roundRect(x - w2 / 2, y - nh / 2, w2, nh, 5);
      ctx!.fillStyle = c.panel;
      ctx!.fill();
      ctx!.strokeStyle = n.critical && trace > 0.6 ? c.spine : c.hair;
      ctx!.lineWidth = n.critical && trace > 0.6 ? 1.6 : 1;
      ctx!.stroke();

      // lamp
      ctx!.beginPath();
      ctx!.arc(x - w2 / 2 + 9, y, 2.6 + (running ? pulse * 0.8 : 0), 0, Math.PI * 2);
      ctx!.fillStyle = lampC;
      if (running) { ctx!.shadowColor = lampC; ctx!.shadowBlur = 6 + pulse * 6; }
      ctx!.fill();
      ctx!.shadowBlur = 0;

      // abstract text ticks
      ctx!.fillStyle = c.faint;
      ctx!.globalAlpha = appear * 0.85 * loopFade;
      const tx = x - w2 / 2 + 16;
      ctx!.fillRect(tx, y - 4.5, w2 * 0.42, 2.4);
      ctx!.globalAlpha = appear * 0.45 * loopFade;
      ctx!.fillRect(tx, y + 1.5, w2 * 0.58, 2.2);
      ctx!.globalAlpha = 1;
    });

    if (!reduced) raf = requestAnimationFrame(draw);
  }

  raf = requestAnimationFrame(draw);

  return () => {
    destroyed = true;
    cancelAnimationFrame(raf);
    ro.disconnect();
    themeObserver.disconnect();
  };
}

// auto-mount
document.querySelectorAll<HTMLCanvasElement>('canvas[data-dag]').forEach((el) => mountDagCanvas(el));
