const trace = {
  boundaryResultsConsumed: 0,
};

export function consumeBoundaryResult(result: unknown): unknown {
  trace.boundaryResultsConsumed += 1;
  return result;
}

export function resetControlledQuotaTrace(): void {
  trace.boundaryResultsConsumed = 0;
}

export function controlledQuotaTrace(): Readonly<typeof trace> {
  return Object.freeze({ ...trace });
}
