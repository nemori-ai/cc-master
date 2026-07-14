// Liveness calibration: a referenced timer must not keep the evaluator child alive forever.

export function evaluateW1Case(): { status: string } {
  setInterval(() => {}, 25);
  return { status: 'returned-with-live-interval' };
}
