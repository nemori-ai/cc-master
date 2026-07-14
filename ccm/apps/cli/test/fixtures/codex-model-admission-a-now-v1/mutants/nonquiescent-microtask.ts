// Liveness calibration: recursive microtasks starve an in-child setImmediate/deadline loop.

export function evaluateW1Case(): { status: string } {
  const spin = () => queueMicrotask(spin);
  queueMicrotask(spin);
  return { status: 'returned-with-infinite-microtasks' };
}
