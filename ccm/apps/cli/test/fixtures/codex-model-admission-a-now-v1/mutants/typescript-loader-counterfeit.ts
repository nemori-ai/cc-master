// Loader calibration only: this must execute through tsx before the worker boundary is armed.

export function evaluateW1Case(): { loader: string } {
  return { loader: 'tsx-bound-before-restrictions' };
}
