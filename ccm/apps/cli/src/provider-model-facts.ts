import rawRegistry from './provider-model-facts.json' with { type: 'json' };

export type ProviderModelFactsProvider = 'claude-code' | 'codex' | 'cursor';
export type ProviderModelFactsFreshness = 'fresh' | 'future-invalid' | 'hard-stale';

type JsonObject = Record<string, unknown>;

export interface ProviderModelFactsRegistry {
  schema: 'ccm/provider-model-facts-registry/v1';
  revision: string;
  providers: Record<ProviderModelFactsProvider, JsonObject>;
}

export const PROVIDER_MODEL_FACTS_REGISTRY = rawRegistry as unknown as ProviderModelFactsRegistry;

const PROVIDERS = ['claude-code', 'codex', 'cursor'] as const;
const OFFICIAL_HOSTS = new Set(['anthropic.com', 'www.anthropic.com', 'openai.com', 'cursor.com']);

function object(value: unknown, path: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as JsonObject;
}

function nonemptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`${path} must be non-empty`);
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${path} must be a string array`);
  }
  return value as string[];
}

function timestamp(value: unknown, path: string): number {
  const text = nonemptyString(value, path);
  if (!text.endsWith('Z')) throw new Error(`${path} must be UTC RFC3339`);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) throw new Error(`${path} must be RFC3339`);
  return parsed;
}

function uniqueStrings(values: string[], path: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${path} contains duplicates`);
}

function validateProviderSnapshot(
  provider: ProviderModelFactsProvider,
  value: unknown,
  asOfMs: number,
  requireFresh: boolean,
): void {
  const snapshot = object(value, `providers.${provider}`);
  if (snapshot.schema !== 'ccm/provider-model-facts/v1') {
    throw new Error(`providers.${provider}.schema is invalid`);
  }
  if (snapshot.provider !== provider) throw new Error(`providers.${provider}.provider is invalid`);
  nonemptyString(snapshot.revision, `providers.${provider}.revision`);
  stringArray(snapshot.supported_surfaces, `providers.${provider}.supported_surfaces`);
  stringArray(
    snapshot.supported_client_versions,
    `providers.${provider}.supported_client_versions`,
  );
  nonemptyString(snapshot.account_scope, `providers.${provider}.account_scope`);
  nonemptyString(snapshot.confidence, `providers.${provider}.confidence`);
  stringArray(snapshot.unknown, `providers.${provider}.unknown`);

  if (!Array.isArray(snapshot.source) || snapshot.source.length === 0) {
    throw new Error(`providers.${provider}.source must contain official provenance`);
  }
  const sourceIds: string[] = [];
  const observedAt = timestamp(snapshot.observed_at, `providers.${provider}.observed_at`);
  const validUntil = timestamp(snapshot.valid_until, `providers.${provider}.valid_until`);
  if (observedAt > validUntil) throw new Error(`providers.${provider} evidence is expired`);
  for (const [index, item] of snapshot.source.entries()) {
    const source = object(item, `providers.${provider}.source[${index}]`);
    const id = nonemptyString(source.id, `providers.${provider}.source[${index}].id`);
    const urlText = nonemptyString(source.url, `providers.${provider}.source[${index}].url`);
    let url: URL;
    try {
      url = new URL(urlText);
    } catch {
      throw new Error(`providers.${provider}.source[${index}].url is invalid`);
    }
    if (url.protocol !== 'https:' || !OFFICIAL_HOSTS.has(url.hostname)) {
      throw new Error(`providers.${provider}.source[${index}] is not an official HTTPS source`);
    }
    const retrievedAt = timestamp(
      source.retrieved_at,
      `providers.${provider}.source[${index}].retrieved_at`,
    );
    if (retrievedAt > observedAt) {
      throw new Error(`providers.${provider}.source[${index}] was retrieved after observation`);
    }
    sourceIds.push(id);
  }
  uniqueStrings(sourceIds, `providers.${provider}.source IDs`);

  if (!Array.isArray(snapshot.models) || snapshot.models.length === 0) {
    throw new Error(`providers.${provider}.models must be non-empty`);
  }
  const modelIds: string[] = [];
  const superseded = new Set<string>();
  for (const [index, item] of snapshot.models.entries()) {
    const model = object(item, `providers.${provider}.models[${index}]`);
    const modelId = nonemptyString(
      model.model_id,
      `providers.${provider}.models[${index}].model_id`,
    );
    nonemptyString(model.display_name, `providers.${provider}.models[${index}].display_name`);
    nonemptyString(model.tier, `providers.${provider}.models[${index}].tier`);
    const availability = object(
      model.availability,
      `providers.${provider}.models[${index}].availability`,
    );
    const availabilityState = nonemptyString(
      availability.state,
      `providers.${provider}.models[${index}].availability.state`,
    );
    const availabilityScope = nonemptyString(
      availability.account_scope,
      `providers.${provider}.models[${index}].availability.account_scope`,
    );
    if (availabilityState === 'conditional' && availabilityScope === 'global') {
      throw new Error(
        `providers.${provider}.models[${index}] conditional availability requires account_scope`,
      );
    }
    const sourceRefs = stringArray(
      model.source_refs,
      `providers.${provider}.models[${index}].source_refs`,
    );
    if (sourceRefs.length === 0 || sourceRefs.some((id) => !sourceIds.includes(id))) {
      throw new Error(`providers.${provider}.models[${index}].source_refs is invalid`);
    }
    const supersedes = stringArray(
      model.supersedes,
      `providers.${provider}.models[${index}].supersedes`,
    );
    for (const id of supersedes) superseded.add(id);
    if (model.selectors !== undefined) {
      stringArray(model.selectors, `providers.${provider}.models[${index}].selectors`);
    }
    modelIds.push(modelId);
  }
  uniqueStrings(modelIds, `providers.${provider}.model IDs`);
  const supersededCurrent = modelIds.find((id) => superseded.has(id));
  if (supersededCurrent) {
    throw new Error(`providers.${provider} contains superseded current model ${supersededCurrent}`);
  }

  if (requireFresh) {
    if (asOfMs < observedAt) throw new Error(`providers.${provider} observation is in the future`);
    if (asOfMs > validUntil) throw new Error(`providers.${provider} evidence is stale or expired`);
  }
}

export function validateProviderModelFactsRegistry(
  value: unknown,
  asOf: string,
  options: { requireFresh?: boolean } = {},
): asserts value is ProviderModelFactsRegistry {
  const registry = object(value, 'registry');
  if (registry.schema !== 'ccm/provider-model-facts-registry/v1') {
    throw new Error('registry.schema is invalid');
  }
  nonemptyString(registry.revision, 'registry.revision');
  const providers = object(registry.providers, 'registry.providers');
  const asOfMs = timestamp(asOf, 'as_of');
  for (const provider of PROVIDERS) {
    validateProviderSnapshot(provider, providers[provider], asOfMs, options.requireFresh === true);
  }
}

export function providerModelFacts(provider: string, asOf: string): JsonObject {
  if (!(PROVIDERS as readonly string[]).includes(provider)) {
    throw new Error(`unsupported provider facts id: ${provider}`);
  }
  validateProviderModelFactsRegistry(PROVIDER_MODEL_FACTS_REGISTRY, asOf);
  const snapshot = structuredClone(
    PROVIDER_MODEL_FACTS_REGISTRY.providers[provider as ProviderModelFactsProvider],
  );
  const asOfMs = timestamp(asOf, 'as_of');
  const observedAt = timestamp(snapshot.observed_at, `${provider}.observed_at`);
  const validUntil = timestamp(snapshot.valid_until, `${provider}.valid_until`);
  const freshness: ProviderModelFactsFreshness =
    asOfMs < observedAt ? 'future-invalid' : asOfMs > validUntil ? 'hard-stale' : 'fresh';
  const unknown = stringArray(snapshot.unknown, `${provider}.unknown`);
  const automaticSelectionBlockers = [
    ...(freshness === 'fresh' ? [] : [`catalog_${freshness}`]),
    ...unknown.map((item) => `unknown:${item}`),
    'live_transport_admission_required',
  ];
  return {
    ...snapshot,
    as_of: asOf,
    freshness,
    catalog_eligible_for_admission_check: freshness === 'fresh',
    eligible_for_automatic_selection: automaticSelectionBlockers.length === 0,
    automatic_selection_blockers: automaticSelectionBlockers,
    side_effects: {
      provider_requests: 0,
      account_mutations: 0,
      credential_writes: 0,
      board_writes: 0,
    },
  };
}
