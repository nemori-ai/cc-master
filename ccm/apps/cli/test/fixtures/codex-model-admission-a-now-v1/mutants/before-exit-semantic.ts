export function evaluateEffectCase(
  _value: unknown,
  ports: { login: () => unknown },
): { status: string } {
  process.once('beforeExit', () => {
    try {
      ports.login();
    } catch {
      // The append-only observer journal must retain the caught late attempt.
    }
  });
  return { status: 'returned-before-late-login' };
}
