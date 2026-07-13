// provider-json-schema.ts — bounded, fail-closed JSON Schema boundary for provider output.
//
// This module deliberately implements a closed Draft 2020-12 vocabulary. Preflight rejects every
// keyword or keyword value it cannot execute, so provider launch code never mistakes an ignored
// assertion for validation. References are local RFC 6901 pointers only; remote fetch is forbidden.

export type ProviderJsonSchemaErrorCode =
  | 'schema_invalid'
  | 'schema_keyword_unsupported'
  | 'schema_ref_remote'
  | 'schema_ref_unresolved'
  | 'schema_ref_cycle'
  | 'schema_limit_exceeded'
  | 'validation_limit_exceeded'
  | 'output_schema_mismatch';

export class ProviderJsonSchemaError extends Error {
  readonly code: ProviderJsonSchemaErrorCode;
  readonly schemaPath: string;

  constructor(code: ProviderJsonSchemaErrorCode, message: string, schemaPath = '#') {
    super(message);
    this.name = 'ProviderJsonSchemaError';
    this.code = code;
    this.schemaPath = schemaPath;
  }
}

export interface ProviderJsonSchemaLimits {
  maxDepth: number;
  maxNodes: number;
  maxValidationSteps: number;
}

export interface CompiledProviderOutputSchema {
  matches(value: unknown): boolean;
  assertValid(value: unknown): void;
}

const DEFAULT_LIMITS: ProviderJsonSchemaLimits = {
  maxDepth: 64,
  maxNodes: 10_000,
  maxValidationSteps: 100_000,
};

const JSON_SCHEMA_2020_12 = new Set([
  'https://json-schema.org/draft/2020-12/schema',
  'https://json-schema.org/draft/2020-12/schema#',
]);

const SUPPORTED_TYPES = new Set([
  'null',
  'boolean',
  'string',
  'number',
  'integer',
  'array',
  'object',
]);

const SUPPORTED_KEYWORDS = new Set([
  '$schema',
  '$id',
  '$comment',
  '$defs',
  'definitions',
  '$ref',
  'title',
  'description',
  'const',
  'enum',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'type',
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minItems',
  'maxItems',
  'uniqueItems',
  'items',
  'required',
  'properties',
  'additionalProperties',
]);

type Schema = boolean | SchemaObject;
type SchemaObject = Record<string, unknown>;
type VisitState = 'visiting' | 'done';

interface ValidationBudget {
  steps: number;
  readonly max: number;
}

function plain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function pointerToken(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function childPath(parent: string, key: string): string {
  return `${parent}/${pointerToken(key)}`;
}

function fail(code: ProviderJsonSchemaErrorCode, message: string, schemaPath: string): never {
  throw new ProviderJsonSchemaError(code, message, schemaPath);
}

function boundedPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function normalizedLimits(override: Partial<ProviderJsonSchemaLimits>): ProviderJsonSchemaLimits {
  const result = { ...DEFAULT_LIMITS, ...override };
  for (const [key, value] of Object.entries(result)) {
    if (!boundedPositiveInteger(value))
      fail('schema_invalid', `${key} must be a positive safe integer`, '#');
  }
  return result;
}

function assertBoundedSchemaDocument(value: unknown, limits: ProviderJsonSchemaLimits): void {
  const pending: Array<{ value: unknown; path: string; depth: number }> = [
    { value, path: '#', depth: 0 },
  ];
  const seen = new WeakSet<object>();
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    if (current.depth > limits.maxDepth)
      fail('schema_limit_exceeded', 'schema document depth limit exceeded', current.path);
    nodes += 1;
    if (nodes > limits.maxNodes)
      fail('schema_limit_exceeded', 'schema document node limit exceeded', current.path);
    if (current.value === null || typeof current.value !== 'object') continue;
    if (seen.has(current.value))
      fail('schema_ref_cycle', 'schema document contains an object cycle', current.path);
    seen.add(current.value);
    const entries = Array.isArray(current.value)
      ? current.value.map((child, index) => [String(index), child] as const)
      : Object.entries(current.value);
    for (const [key, child] of entries)
      pending.push({
        value: child,
        path: childPath(current.path, key),
        depth: current.depth + 1,
      });
  }
}

function isJsonValue(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (!Array.isArray(value) && !plain(value)) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  const valid = children.every((child) => isJsonValue(child, seen));
  seen.delete(value);
  return valid;
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (plain(value))
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalJsonValue(value[key])]),
    );
  return value;
}

function assertSchemaValue(value: unknown, schemaPath: string): asserts value is Schema {
  if (typeof value !== 'boolean' && !plain(value))
    fail('schema_invalid', 'schema must be a boolean or object', schemaPath);
}

function assertString(
  value: unknown,
  keyword: string,
  schemaPath: string,
): asserts value is string {
  if (typeof value !== 'string' || value.length === 0)
    fail('schema_invalid', `${keyword} must be a non-empty string`, schemaPath);
}

function assertNonnegativeInteger(value: unknown, keyword: string, schemaPath: string): void {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    fail('schema_invalid', `${keyword} must be a non-negative safe integer`, schemaPath);
}

function assertFiniteNumber(value: unknown, keyword: string, schemaPath: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value))
    fail('schema_invalid', `${keyword} must be a finite number`, schemaPath);
}

function resolveLocalReference(root: Schema, reference: string, schemaPath: string): Schema {
  if (reference === '#') return root;
  if (!reference.startsWith('#/'))
    fail('schema_ref_remote', 'only local RFC 6901 references are supported', schemaPath);

  let pointer: string;
  try {
    pointer = decodeURIComponent(reference.slice(1));
  } catch {
    fail('schema_ref_unresolved', 'reference has invalid URI encoding', schemaPath);
  }
  if (!pointer.startsWith('/'))
    fail('schema_ref_remote', 'named and remote references are unsupported', schemaPath);

  let current: unknown = root;
  for (const rawToken of pointer.slice(1).split('/')) {
    if (/~(?:[^01]|$)/u.test(rawToken))
      fail('schema_ref_unresolved', 'reference has an invalid RFC 6901 escape', schemaPath);
    const token = rawToken.replaceAll('~1', '/').replaceAll('~0', '~');
    if ((plain(current) || Array.isArray(current)) && Object.hasOwn(current, token))
      current = (current as Record<string, unknown>)[token];
    else fail('schema_ref_unresolved', `reference target does not exist: ${reference}`, schemaPath);
  }
  if (typeof current !== 'boolean' && !plain(current))
    fail('schema_ref_unresolved', 'reference target is not a schema', schemaPath);
  return current;
}

function schemaTypeMatches(value: unknown, type: string): boolean {
  switch (type) {
    case 'null':
      return value === null;
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
    case 'array':
      return Array.isArray(value);
    case 'object':
      return plain(value);
    default:
      return false;
  }
}

function bump(budget: ValidationBudget): void {
  budget.steps += 1;
  if (budget.steps > budget.max)
    fail('validation_limit_exceeded', 'output validation work limit exceeded', '#');
}

function sameJson(left: unknown, right: unknown, budget: ValidationBudget): boolean {
  bump(budget);
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    return left.every((entry, index) => sameJson(entry, right[index], budget));
  }
  if (plain(left) && plain(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        Object.hasOwn(right, key) &&
        sameJson(left[key], right[key], budget),
    );
  }
  return false;
}

function canonicalValue(value: unknown, budget: ValidationBudget): unknown {
  bump(budget);
  if (Array.isArray(value)) return value.map((entry) => canonicalValue(entry, budget));
  if (plain(value))
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key], budget)]),
    );
  return value;
}

export function compileProviderOutputSchema(
  input: unknown,
  limitOverrides: Partial<ProviderJsonSchemaLimits> = {},
): CompiledProviderOutputSchema {
  const limits = normalizedLimits(limitOverrides);
  assertBoundedSchemaDocument(input, limits);
  assertSchemaValue(input, '#');
  const root: Schema = input;
  const states = new WeakMap<object, VisitState>();
  const patterns = new WeakMap<object, RegExp>();
  let nodeCount = 0;

  const visitSchemaArray = (value: unknown, keyword: string, path: string, depth: number): void => {
    if (!Array.isArray(value) || value.length === 0)
      fail('schema_invalid', `${keyword} must be a non-empty schema array`, path);
    value.forEach((child, index) => {
      visit(child, `${path}/${index}`, depth);
    });
  };

  const visitSchemaMap = (value: unknown, keyword: string, path: string, depth: number): void => {
    if (!plain(value)) fail('schema_invalid', `${keyword} must be a schema map`, path);
    for (const [key, child] of Object.entries(value)) visit(child, childPath(path, key), depth);
  };

  const visit = (value: unknown, schemaPath: string, depth: number): void => {
    if (depth > limits.maxDepth)
      fail('schema_limit_exceeded', 'schema depth limit exceeded', schemaPath);
    assertSchemaValue(value, schemaPath);
    if (typeof value === 'boolean') {
      nodeCount += 1;
      if (nodeCount > limits.maxNodes)
        fail('schema_limit_exceeded', 'schema node limit exceeded', schemaPath);
      return;
    }

    const prior = states.get(value);
    if (prior === 'visiting')
      fail('schema_ref_cycle', 'schema contains a reference or object cycle', schemaPath);
    if (prior === 'done') return;
    states.set(value, 'visiting');
    nodeCount += 1;
    if (nodeCount > limits.maxNodes)
      fail('schema_limit_exceeded', 'schema node limit exceeded', schemaPath);

    for (const keyword of Object.keys(value)) {
      if (!SUPPORTED_KEYWORDS.has(keyword))
        fail(
          'schema_keyword_unsupported',
          `unsupported JSON Schema keyword: ${keyword}`,
          childPath(schemaPath, keyword),
        );
    }

    if (schemaPath !== '#' && ('$schema' in value || '$id' in value))
      fail('schema_invalid', '$schema and $id are supported only at the document root', schemaPath);
    if ('$schema' in value) {
      assertString(value.$schema, '$schema', childPath(schemaPath, '$schema'));
      if (!JSON_SCHEMA_2020_12.has(value.$schema))
        fail(
          'schema_invalid',
          'only the JSON Schema Draft 2020-12 vocabulary is supported',
          childPath(schemaPath, '$schema'),
        );
    }
    if ('$id' in value) assertString(value.$id, '$id', childPath(schemaPath, '$id'));
    for (const keyword of ['$comment', 'title', 'description'])
      if (keyword in value && typeof value[keyword] !== 'string')
        fail('schema_invalid', `${keyword} must be a string`, childPath(schemaPath, keyword));
    if ('const' in value && !isJsonValue(value.const))
      fail('schema_invalid', 'const must be a JSON value', childPath(schemaPath, 'const'));
    if ('enum' in value) {
      if (
        !Array.isArray(value.enum) ||
        value.enum.length === 0 ||
        !value.enum.every((entry) => isJsonValue(entry))
      )
        fail(
          'schema_invalid',
          'enum must be a non-empty JSON value array',
          childPath(schemaPath, 'enum'),
        );
      const encoded = value.enum.map((entry) => JSON.stringify(canonicalJsonValue(entry)));
      if (new Set(encoded).size !== encoded.length)
        fail('schema_invalid', 'enum values must be unique', childPath(schemaPath, 'enum'));
    }
    if ('type' in value) {
      const types = Array.isArray(value.type) ? value.type : [value.type];
      if (
        types.length === 0 ||
        !types.every((type) => typeof type === 'string' && SUPPORTED_TYPES.has(type)) ||
        new Set(types).size !== types.length
      )
        fail(
          'schema_invalid',
          'type must name unique supported JSON types',
          childPath(schemaPath, 'type'),
        );
    }
    if ('required' in value) {
      if (
        !Array.isArray(value.required) ||
        !value.required.every((key) => typeof key === 'string') ||
        new Set(value.required).size !== value.required.length
      )
        fail(
          'schema_invalid',
          'required must be an array of unique strings',
          childPath(schemaPath, 'required'),
        );
    }
    for (const keyword of ['minLength', 'maxLength', 'minItems', 'maxItems']) {
      if (keyword in value)
        assertNonnegativeInteger(value[keyword], keyword, childPath(schemaPath, keyword));
    }
    if (
      typeof value.minLength === 'number' &&
      typeof value.maxLength === 'number' &&
      value.minLength > value.maxLength
    )
      fail('schema_invalid', 'minLength exceeds maxLength', schemaPath);
    if (
      typeof value.minItems === 'number' &&
      typeof value.maxItems === 'number' &&
      value.minItems > value.maxItems
    )
      fail('schema_invalid', 'minItems exceeds maxItems', schemaPath);
    for (const keyword of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum']) {
      if (keyword in value)
        assertFiniteNumber(value[keyword], keyword, childPath(schemaPath, keyword));
    }
    if ('uniqueItems' in value && typeof value.uniqueItems !== 'boolean')
      fail('schema_invalid', 'uniqueItems must be boolean', childPath(schemaPath, 'uniqueItems'));
    if ('pattern' in value) {
      if (typeof value.pattern !== 'string')
        fail('schema_invalid', 'pattern must be a string', childPath(schemaPath, 'pattern'));
      try {
        patterns.set(value, new RegExp(value.pattern, 'u'));
      } catch {
        fail(
          'schema_invalid',
          'pattern is not a valid Unicode regular expression',
          childPath(schemaPath, 'pattern'),
        );
      }
    }
    if ('$ref' in value) {
      assertString(value.$ref, '$ref', childPath(schemaPath, '$ref'));
      const target = resolveLocalReference(root, value.$ref, childPath(schemaPath, '$ref'));
      visit(target, value.$ref, depth + 1);
    }
    if ('$defs' in value)
      visitSchemaMap(value.$defs, '$defs', childPath(schemaPath, '$defs'), depth + 1);
    if ('definitions' in value)
      visitSchemaMap(
        value.definitions,
        'definitions',
        childPath(schemaPath, 'definitions'),
        depth + 1,
      );
    if ('properties' in value)
      visitSchemaMap(
        value.properties,
        'properties',
        childPath(schemaPath, 'properties'),
        depth + 1,
      );
    for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
      if (keyword in value)
        visitSchemaArray(value[keyword], keyword, childPath(schemaPath, keyword), depth + 1);
    }
    for (const keyword of ['not', 'items', 'additionalProperties']) {
      if (keyword in value) visit(value[keyword], childPath(schemaPath, keyword), depth + 1);
    }
    states.set(value, 'done');
  };

  visit(root, '#', 0);

  const evaluate = (value: unknown, schema: Schema, budget: ValidationBudget): boolean => {
    bump(budget);
    if (typeof schema === 'boolean') return schema;

    if ('$ref' in schema) {
      const target = resolveLocalReference(root, schema.$ref as string, '#/$ref');
      if (!evaluate(value, target, budget)) return false;
    }
    if ('const' in schema && !sameJson(value, schema.const, budget)) return false;
    if (Array.isArray(schema.enum) && !schema.enum.some((entry) => sameJson(value, entry, budget)))
      return false;
    if (
      Array.isArray(schema.allOf) &&
      !schema.allOf.every((child) => evaluate(value, child as Schema, budget))
    )
      return false;
    if (
      Array.isArray(schema.anyOf) &&
      !schema.anyOf.some((child) => evaluate(value, child as Schema, budget))
    )
      return false;
    if (
      Array.isArray(schema.oneOf) &&
      schema.oneOf.filter((child) => evaluate(value, child as Schema, budget)).length !== 1
    )
      return false;
    if ('not' in schema && evaluate(value, schema.not as Schema, budget)) return false;
    if ('type' in schema) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!types.some((type) => schemaTypeMatches(value, type as string))) return false;
    }
    if (typeof value === 'string') {
      const length = [...value].length;
      if (typeof schema.minLength === 'number' && length < schema.minLength) return false;
      if (typeof schema.maxLength === 'number' && length > schema.maxLength) return false;
      const pattern = patterns.get(schema);
      if (pattern && !pattern.test(value)) return false;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (typeof schema.minimum === 'number' && value < schema.minimum) return false;
      if (typeof schema.maximum === 'number' && value > schema.maximum) return false;
      if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum)
        return false;
      if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum)
        return false;
    }
    if (Array.isArray(value)) {
      if (typeof schema.minItems === 'number' && value.length < schema.minItems) return false;
      if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) return false;
      if (schema.uniqueItems === true) {
        const seen = new Set<string>();
        for (const entry of value) {
          const encoded = JSON.stringify(canonicalValue(entry, budget));
          if (seen.has(encoded)) return false;
          seen.add(encoded);
        }
      }
      if ('items' in schema)
        for (const entry of value)
          if (!evaluate(entry, schema.items as Schema, budget)) return false;
    }
    if (plain(value)) {
      if (
        Array.isArray(schema.required) &&
        !schema.required.every((key) => Object.hasOwn(value, key as string))
      )
        return false;
      const properties = plain(schema.properties) ? schema.properties : {};
      for (const [key, child] of Object.entries(properties))
        if (Object.hasOwn(value, key) && !evaluate(value[key], child as Schema, budget))
          return false;
      for (const key of Object.keys(value)) {
        bump(budget);
        if (Object.hasOwn(properties, key)) continue;
        if (schema.additionalProperties === false) return false;
        if (
          (schema.additionalProperties === true || plain(schema.additionalProperties)) &&
          !evaluate(value[key], schema.additionalProperties as Schema, budget)
        )
          return false;
      }
    }
    return true;
  };

  const validate = (value: unknown): boolean =>
    evaluate(value, root, { steps: 0, max: limits.maxValidationSteps });

  return {
    matches(value: unknown): boolean {
      try {
        return validate(value);
      } catch (error) {
        if (error instanceof ProviderJsonSchemaError && error.code === 'validation_limit_exceeded')
          return false;
        throw error;
      }
    },
    assertValid(value: unknown): void {
      if (!validate(value))
        fail('output_schema_mismatch', 'provider output does not match requested schema', '#');
    },
  };
}
