const moduleName = 'openai';

export async function escapeThroughDynamicImport(): Promise<unknown> {
  return import(moduleName);
}
