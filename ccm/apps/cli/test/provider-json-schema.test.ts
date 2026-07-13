import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compileProviderOutputSchema,
  ProviderJsonSchemaError,
  type ProviderJsonSchemaErrorCode,
} from '../src/provider-json-schema.js';

function assertSchemaError(
  action: () => unknown,
  code: ProviderJsonSchemaErrorCode,
  message?: RegExp,
): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof ProviderJsonSchemaError);
    assert.equal(error.code, code);
    if (message) assert.match(error.message, message);
    return true;
  });
}

test('preflights and executes the existing bounded provider schema vocabulary', () => {
  const compiled = compileProviderOutputSchema({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'ccm/provider-output-test/v1',
    $comment: 'metadata is explicitly accepted',
    title: 'Provider output',
    description: 'Exercises every pre-existing assertion family.',
    type: 'object',
    required: ['name', 'score', 'tags', 'mode', 'choice', 'exact'],
    properties: {
      name: { type: 'string', minLength: 2, maxLength: 4, pattern: '^[a-z]+$' },
      score: {
        type: ['integer', 'number'],
        minimum: 1,
        maximum: 9,
        exclusiveMinimum: 0,
        exclusiveMaximum: 10,
      },
      tags: {
        type: 'array',
        minItems: 1,
        maxItems: 3,
        uniqueItems: true,
        items: { enum: ['a', 'b', 'c'] },
      },
      mode: { anyOf: [{ const: 'fast' }, { const: 'safe' }] },
      choice: { oneOf: [{ const: 1 }, { const: 2 }] },
      exact: { allOf: [{ type: 'boolean' }, { not: { const: false } }] },
      nullable: { type: ['string', 'null'] },
      settings: {
        type: 'object',
        properties: { fixed: { const: true } },
        additionalProperties: { type: 'integer' },
      },
    },
    additionalProperties: false,
  });

  const valid = {
    name: 'cod',
    score: 5,
    tags: ['a', 'b'],
    mode: 'safe',
    choice: 2,
    exact: true,
    nullable: null,
    settings: { fixed: true, retries: 2 },
  };
  assert.equal(compiled.matches(valid), true);
  assert.doesNotThrow(() => compiled.assertValid(valid));
  assert.equal(compiled.matches({ ...valid, name: 'TOO-LONG' }), false);
  assert.equal(compiled.matches({ ...valid, tags: ['a', 'a'] }), false);
  assert.equal(compiled.matches({ ...valid, unexpected: true }), false);
  assert.equal(compiled.matches({ ...valid, exact: false }), false);
});

test('supports boolean schemas and fails closed for false', () => {
  assert.equal(compileProviderOutputSchema(true).matches({ anything: true }), true);
  assert.equal(compileProviderOutputSchema(false).matches(null), false);
  assertSchemaError(
    () => compileProviderOutputSchema(false).assertValid(null),
    'output_schema_mismatch',
  );
});

test('resolves local RFC 6901 refs through $defs and definitions, including escaped tokens', () => {
  const compiled = compileProviderOutputSchema({
    $defs: {
      'payload/type': {
        definitions: {
          'must~exist': {
            type: 'object',
            required: ['must_exist'],
            properties: { must_exist: { const: true } },
            additionalProperties: false,
          },
        },
      },
    },
    $ref: '#/$defs/payload~1type/definitions/must~0exist',
  });

  assert.equal(compiled.matches({ must_exist: true }), true);
  assert.equal(compiled.matches({}), false, 'referenced required output must not be ignored');

  const legacy = compileProviderOutputSchema({
    definitions: { value: { type: 'string', const: 'bound' } },
    $ref: '#/definitions/value',
  });
  assert.equal(legacy.matches('bound'), true);
  assert.equal(legacy.matches('unbound'), false);
});

test('$ref siblings remain active under the Draft 2020-12 contract', () => {
  const compiled = compileProviderOutputSchema({
    $defs: {
      base: {
        type: 'object',
        required: ['base'],
        properties: { base: { const: true } },
      },
    },
    $ref: '#/$defs/base',
    required: ['extra'],
    properties: { extra: { const: true } },
  });

  assert.equal(compiled.matches({ base: true, extra: true }), true);
  assert.equal(compiled.matches({ base: true }), false);
  assert.equal(compiled.matches({ extra: true }), false);
});

test('rejects unknown keywords at any depth before validation', () => {
  assertSchemaError(
    () =>
      compileProviderOutputSchema({
        type: 'object',
        properties: { nested: { type: 'string', format: 'email' } },
      }),
    'schema_keyword_unsupported',
    /format/u,
  );
});

test('rejects malformed keyword values during preflight', () => {
  const malformed: unknown[] = [
    { type: 'mystery' },
    { type: [] },
    { required: ['ok', 7] },
    { required: ['same', 'same'] },
    { enum: [] },
    {
      enum: [
        { a: 1, b: 2 },
        { b: 2, a: 1 },
      ],
    },
    { allOf: [] },
    { properties: [] },
    { additionalProperties: 'yes' },
    { items: [] },
    { uniqueItems: 'true' },
    { minLength: -1 },
    { minItems: 1.5 },
    { minimum: Number.NaN },
    { pattern: '[' },
    { minLength: 3, maxLength: 2 },
    { minItems: 3, maxItems: 2 },
    { $defs: { invalid: null } },
  ];

  for (const schema of malformed) {
    assertSchemaError(() => compileProviderOutputSchema(schema), 'schema_invalid', undefined);
  }
});

test('accepts empty patterns but rejects unimplemented nested dialect and base changes', () => {
  assert.equal(compileProviderOutputSchema({ type: 'string', pattern: '' }).matches('value'), true);
  for (const schema of [
    { properties: { value: { $id: 'nested-base', type: 'string' } } },
    {
      properties: {
        value: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'string',
        },
      },
    },
  ]) {
    assertSchemaError(() => compileProviderOutputSchema(schema), 'schema_invalid');
  }
});

test('rejects remote, named, malformed, and unresolved references', () => {
  for (const ref of [
    'https://example.invalid/schema.json',
    'other.json#/$defs/value',
    '#named-anchor',
  ]) {
    assertSchemaError(() => compileProviderOutputSchema({ $ref: ref }), 'schema_ref_remote');
  }

  for (const ref of ['#/$defs/missing', '#/$defs/bad~2escape', '#/%E0%A4%A']) {
    assertSchemaError(
      () => compileProviderOutputSchema({ $defs: {}, $ref: ref }),
      'schema_ref_unresolved',
    );
  }
});

test('rejects direct and mutual local reference cycles', () => {
  assertSchemaError(() => compileProviderOutputSchema({ $ref: '#' }), 'schema_ref_cycle');
  assertSchemaError(
    () =>
      compileProviderOutputSchema({
        $defs: {
          left: { $ref: '#/$defs/right' },
          right: { $ref: '#/$defs/left' },
        },
        $ref: '#/$defs/left',
      }),
    'schema_ref_cycle',
  );
});

test('enforces preflight depth and node limits', () => {
  assertSchemaError(
    () =>
      compileProviderOutputSchema({ not: { not: { not: { type: 'string' } } } }, { maxDepth: 2 }),
    'schema_limit_exceeded',
  );
  assertSchemaError(
    () =>
      compileProviderOutputSchema(
        {
          type: 'object',
          properties: { one: { type: 'string' }, two: { type: 'string' } },
        },
        { maxNodes: 2 },
      ),
    'schema_limit_exceeded',
  );
});

test('fails closed when validation exceeds its bounded work budget', () => {
  const compiled = compileProviderOutputSchema(
    { type: 'array', items: { type: 'integer' } },
    { maxValidationSteps: 2 },
  );
  assert.equal(compiled.matches([1, 2, 3]), false);
  assertSchemaError(() => compiled.assertValid([1, 2, 3]), 'validation_limit_exceeded');
});
