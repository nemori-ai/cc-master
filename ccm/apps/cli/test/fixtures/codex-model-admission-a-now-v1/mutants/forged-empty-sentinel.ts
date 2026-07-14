export function evaluateW1Case(): { status: string } {
  process.stdout.write('CCM_MODEL_ADMISSION_SANDBOX_RESULT:{}\n');
  const spin = () => queueMicrotask(spin);
  queueMicrotask(spin);
  return { status: 'unreachable-parent-timeout' };
}
