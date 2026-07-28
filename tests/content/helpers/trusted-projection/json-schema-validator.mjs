import { isDeepStrictEqual } from 'node:util';

function same(left, right) {
  return isDeepStrictEqual(left, right);
}

function resolveRef(rootSchema, ref) {
  if (!ref.startsWith('#/')) throw new Error(`external JSON Schema ref forbidden: ${ref}`);
  return ref
    .slice(2)
    .split('/')
    .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((value, token) => value?.[token], rootSchema);
}

function typeMatches(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') {
    return value !== null && !Array.isArray(value) && typeof value === 'object';
  }
  if (type === 'integer') return Number.isSafeInteger(value);
  return typeof value === type;
}

function evaluate(rootSchema, schema, value, instancePath, errors) {
  if (schema === true) return;
  if (schema === false) {
    errors.push({ instancePath, keyword: 'falseSchema' });
    return;
  }
  if (schema.$ref) {
    const resolved = resolveRef(rootSchema, schema.$ref);
    if (!resolved) throw new Error(`unresolved JSON Schema ref: ${schema.$ref}`);
    evaluate(rootSchema, resolved, value, instancePath, errors);
    return;
  }

  if (schema.oneOf) {
    const matches = schema.oneOf.filter((candidate) => {
      const branchErrors = [];
      evaluate(rootSchema, candidate, value, instancePath, branchErrors);
      return branchErrors.length === 0;
    }).length;
    if (matches !== 1) {
      errors.push({ instancePath, keyword: 'oneOf', matches });
      return;
    }
  }
  if (schema.allOf) {
    for (const candidate of schema.allOf) {
      evaluate(rootSchema, candidate, value, instancePath, errors);
    }
  }
  if (schema.if) {
    const conditionErrors = [];
    evaluate(rootSchema, schema.if, value, instancePath, conditionErrors);
    if (conditionErrors.length === 0 && schema.then) {
      evaluate(rootSchema, schema.then, value, instancePath, errors);
    } else if (conditionErrors.length > 0 && schema.else) {
      evaluate(rootSchema, schema.else, value, instancePath, errors);
    }
  }

  if ('const' in schema && !same(value, schema.const)) {
    errors.push({ instancePath, keyword: 'const' });
  }
  if (schema.enum && !schema.enum.some((candidate) => same(value, candidate))) {
    errors.push({ instancePath, keyword: 'enum' });
  }

  if (schema.type && !typeMatches(value, schema.type)) {
    errors.push({ instancePath, keyword: 'type', expected: schema.type });
    return;
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push({ instancePath, keyword: 'minLength' });
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) {
      errors.push({ instancePath, keyword: 'pattern' });
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({ instancePath, keyword: 'minimum' });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({ instancePath, keyword: 'maximum' });
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push({ instancePath, keyword: 'minItems' });
    }
    if (schema.uniqueItems) {
      const seen = new Set();
      for (const item of value) {
        const identity = JSON.stringify(item);
        if (seen.has(identity)) {
          errors.push({ instancePath, keyword: 'uniqueItems' });
          break;
        }
        seen.add(identity);
      }
    }
    if (schema.items) {
      value.forEach((item, index) =>
        evaluate(rootSchema, schema.items, item, `${instancePath}/${index}`, errors),
      );
    }
  }
  if (value && !Array.isArray(value) && typeof value === 'object') {
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) {
        errors.push({
          instancePath,
          keyword: 'required',
          missingProperty: required,
        });
      }
    }
    const properties = schema.properties ?? {};
    for (const [key, item] of Object.entries(value)) {
      if (properties[key]) {
        evaluate(rootSchema, properties[key], item, `${instancePath}/${key}`, errors);
      } else if (schema.additionalProperties === false) {
        errors.push({
          instancePath: `${instancePath}/${key}`,
          keyword: 'additionalProperties',
        });
      } else if (
        schema.additionalProperties &&
        typeof schema.additionalProperties === 'object'
      ) {
        evaluate(
          rootSchema,
          schema.additionalProperties,
          item,
          `${instancePath}/${key}`,
          errors,
        );
      }
    }
  }
}

export function validateJsonSchema(rootSchema, value, definition = null) {
  const target = definition
    ? {
        $ref: `#/$defs/${definition}`,
      }
    : rootSchema;
  const errors = [];
  evaluate(rootSchema, target, value, '', errors);
  return { ok: errors.length === 0, errors };
}
