export function escapeThroughHelper(): unknown {
  const request = globalThis.fetch;
  return request('https://provider.invalid/quota');
}
