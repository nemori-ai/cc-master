/**
 * Generated standalone Draft 2020-12 validator (bundled).
 * Source: design_docs/skill-knowledge-graph/schemas/knowledge-change.schema.json
 * Source-schema-sha256: 5cc39f3b8010c8c53eb0050102c718790cf82aca130da18410e9af98bb87dd43
 * Schema-fingerprint: 02ba5253bb96d71ccde23b106284b21942b7790a387e99cbbf2dc942e2e66580
 * Regenerate: node scripts/skill-knowledge/generate-validators.mjs
 */
"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// node_modules/ajv/dist/runtime/ucs2length.js
var require_ucs2length = __commonJS({
  "node_modules/ajv/dist/runtime/ucs2length.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    function ucs2length(str) {
      const len = str.length;
      let length = 0;
      let pos = 0;
      let value;
      while (pos < len) {
        length++;
        value = str.charCodeAt(pos++);
        if (value >= 55296 && value <= 56319 && pos < len) {
          value = str.charCodeAt(pos);
          if ((value & 64512) === 56320)
            pos++;
        }
      }
      return length;
    }
    exports2.default = ucs2length;
    ucs2length.code = 'require("ajv/dist/runtime/ucs2length").default';
  }
});

// node_modules/fast-deep-equal/index.js
var require_fast_deep_equal = __commonJS({
  "node_modules/fast-deep-equal/index.js"(exports2, module2) {
    "use strict";
    module2.exports = function equal(a, b) {
      if (a === b) return true;
      if (a && b && typeof a == "object" && typeof b == "object") {
        if (a.constructor !== b.constructor) return false;
        var length, i, keys;
        if (Array.isArray(a)) {
          length = a.length;
          if (length != b.length) return false;
          for (i = length; i-- !== 0; )
            if (!equal(a[i], b[i])) return false;
          return true;
        }
        if (a.constructor === RegExp) return a.source === b.source && a.flags === b.flags;
        if (a.valueOf !== Object.prototype.valueOf) return a.valueOf() === b.valueOf();
        if (a.toString !== Object.prototype.toString) return a.toString() === b.toString();
        keys = Object.keys(a);
        length = keys.length;
        if (length !== Object.keys(b).length) return false;
        for (i = length; i-- !== 0; )
          if (!Object.prototype.hasOwnProperty.call(b, keys[i])) return false;
        for (i = length; i-- !== 0; ) {
          var key = keys[i];
          if (!equal(a[key], b[key])) return false;
        }
        return true;
      }
      return a !== a && b !== b;
    };
  }
});

// node_modules/ajv/dist/runtime/equal.js
var require_equal = __commonJS({
  "node_modules/ajv/dist/runtime/equal.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var equal = require_fast_deep_equal();
    equal.code = 'require("ajv/dist/runtime/equal").default';
    exports2.default = equal;
  }
});

// raw/validate-change.cjs
module.exports = validate20;
module.exports.default = validate20;
var schema32 = { "type": "object", "additionalProperties": false, "required": ["schema_version", "kind", "change_id", "base_ref", "base_graph_sha256", "result_graph_sha256", "parent_change", "scope", "reason", "operations", "evidence", "expected_effects"], "properties": { "schema_version": { "const": "cc-master/skill-knowledge-change/v1alpha1" }, "kind": { "const": "change" }, "change_id": { "$ref": "#/$defs/changeId" }, "base_ref": { "$ref": "#/$defs/gitRef" }, "base_graph_sha256": { "$ref": "#/$defs/sha256" }, "result_graph_sha256": { "$ref": "#/$defs/sha256" }, "parent_change": { "$ref": "#/$defs/parentChange" }, "scope": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/scopedFileTransition" } }, "reason": { "$ref": "#/$defs/nonEmptyString" }, "operations": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/operation" } }, "evidence": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/evidence" } }, "expected_effects": { "$ref": "#/$defs/expectedEffects" } } };
var func1 = Object.prototype.hasOwnProperty;
var func2 = require_ucs2length().default;
var pattern4 = new RegExp("^change:[0-9]{8}\\.[a-z0-9][a-z0-9.-]*$", "u");
var pattern5 = new RegExp("^[^\\s\\u0000]+$", "u");
var pattern6 = new RegExp("^[a-f0-9]{64}$", "u");
function validate22(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate22.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  const _errs0 = errors;
  let valid0 = false;
  let passing0 = null;
  const _errs1 = errors;
  if (data !== null) {
    const err0 = { instancePath, schemaPath: "#/oneOf/0/type", keyword: "type", params: { type: "null" }, message: "must be null" };
    if (vErrors === null) {
      vErrors = [err0];
    } else {
      vErrors.push(err0);
    }
    errors++;
  }
  var _valid0 = _errs1 === errors;
  if (_valid0) {
    valid0 = true;
    passing0 = 0;
  }
  const _errs3 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.change_id === void 0) {
      const err1 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: "change_id" }, message: "must have required property 'change_id'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.result_graph_sha256 === void 0) {
      const err2 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: "result_graph_sha256" }, message: "must have required property 'result_graph_sha256'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "change_id" || key0 === "result_graph_sha256")) {
        const err3 = { instancePath, schemaPath: "#/oneOf/1/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err3];
        } else {
          vErrors.push(err3);
        }
        errors++;
      }
    }
    if (data.change_id !== void 0) {
      let data0 = data.change_id;
      if (typeof data0 === "string") {
        if (!pattern4.test(data0)) {
          const err4 = { instancePath: instancePath + "/change_id", schemaPath: "#/$defs/changeId/pattern", keyword: "pattern", params: { pattern: "^change:[0-9]{8}\\.[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^change:[0-9]{8}\\.[a-z0-9][a-z0-9.-]*$"' };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
      } else {
        const err5 = { instancePath: instancePath + "/change_id", schemaPath: "#/$defs/changeId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.result_graph_sha256 !== void 0) {
      let data1 = data.result_graph_sha256;
      if (typeof data1 === "string") {
        if (!pattern6.test(data1)) {
          const err6 = { instancePath: instancePath + "/result_graph_sha256", schemaPath: "#/$defs/sha256/pattern", keyword: "pattern", params: { pattern: "^[a-f0-9]{64}$" }, message: 'must match pattern "^[a-f0-9]{64}$"' };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
      } else {
        const err7 = { instancePath: instancePath + "/result_graph_sha256", schemaPath: "#/$defs/sha256/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
  } else {
    const err8 = { instancePath, schemaPath: "#/oneOf/1/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err8];
    } else {
      vErrors.push(err8);
    }
    errors++;
  }
  var _valid0 = _errs3 === errors;
  if (_valid0 && valid0) {
    valid0 = false;
    passing0 = [passing0, 1];
  } else {
    if (_valid0) {
      valid0 = true;
      passing0 = 1;
      var props0 = true;
    }
  }
  if (!valid0) {
    const err9 = { instancePath, schemaPath: "#/oneOf", keyword: "oneOf", params: { passingSchemas: passing0 }, message: "must match exactly one schema in oneOf" };
    if (vErrors === null) {
      vErrors = [err9];
    } else {
      vErrors.push(err9);
    }
    errors++;
  } else {
    errors = _errs0;
    if (vErrors !== null) {
      if (_errs0) {
        vErrors.length = _errs0;
      } else {
        vErrors = null;
      }
    }
  }
  validate22.errors = vErrors;
  evaluated0.props = props0;
  return errors === 0;
}
validate22.evaluated = { "dynamicProps": true, "dynamicItems": false };
var pattern10 = new RegExp("^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))[A-Za-z0-9._/-]+$", "u");
function validate25(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate25.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  const _errs0 = errors;
  let valid0 = false;
  let passing0 = null;
  const _errs1 = errors;
  if (typeof data === "string") {
    if (!pattern6.test(data)) {
      const err0 = { instancePath, schemaPath: "#/$defs/sha256/pattern", keyword: "pattern", params: { pattern: "^[a-f0-9]{64}$" }, message: 'must match pattern "^[a-f0-9]{64}$"' };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
  } else {
    const err1 = { instancePath, schemaPath: "#/$defs/sha256/type", keyword: "type", params: { type: "string" }, message: "must be string" };
    if (vErrors === null) {
      vErrors = [err1];
    } else {
      vErrors.push(err1);
    }
    errors++;
  }
  var _valid0 = _errs1 === errors;
  if (_valid0) {
    valid0 = true;
    passing0 = 0;
  }
  const _errs4 = errors;
  if (data !== null) {
    const err2 = { instancePath, schemaPath: "#/oneOf/1/type", keyword: "type", params: { type: "null" }, message: "must be null" };
    if (vErrors === null) {
      vErrors = [err2];
    } else {
      vErrors.push(err2);
    }
    errors++;
  }
  var _valid0 = _errs4 === errors;
  if (_valid0 && valid0) {
    valid0 = false;
    passing0 = [passing0, 1];
  } else {
    if (_valid0) {
      valid0 = true;
      passing0 = 1;
    }
  }
  if (!valid0) {
    const err3 = { instancePath, schemaPath: "#/oneOf", keyword: "oneOf", params: { passingSchemas: passing0 }, message: "must match exactly one schema in oneOf" };
    if (vErrors === null) {
      vErrors = [err3];
    } else {
      vErrors.push(err3);
    }
    errors++;
  } else {
    errors = _errs0;
    if (vErrors !== null) {
      if (_errs0) {
        vErrors.length = _errs0;
      } else {
        vErrors = null;
      }
    }
  }
  validate25.errors = vErrors;
  return errors === 0;
}
validate25.evaluated = { "dynamicProps": false, "dynamicItems": false };
function validate24(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate24.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.path === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "path" }, message: "must have required property 'path'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.before_sha256 === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "before_sha256" }, message: "must have required property 'before_sha256'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.after_sha256 === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "after_sha256" }, message: "must have required property 'after_sha256'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "path" || key0 === "before_sha256" || key0 === "after_sha256")) {
        const err3 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err3];
        } else {
          vErrors.push(err3);
        }
        errors++;
      }
    }
    if (data.path !== void 0) {
      let data0 = data.path;
      if (typeof data0 === "string") {
        if (!pattern10.test(data0)) {
          const err4 = { instancePath: instancePath + "/path", schemaPath: "#/$defs/repoScopePath/pattern", keyword: "pattern", params: { pattern: "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))[A-Za-z0-9._/-]+$" }, message: 'must match pattern "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))[A-Za-z0-9._/-]+$"' };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
      } else {
        const err5 = { instancePath: instancePath + "/path", schemaPath: "#/$defs/repoScopePath/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.before_sha256 !== void 0) {
      if (!validate25(data.before_sha256, { instancePath: instancePath + "/before_sha256", parentData: data, parentDataProperty: "before_sha256", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate25.errors : vErrors.concat(validate25.errors);
        errors = vErrors.length;
      }
    }
    if (data.after_sha256 !== void 0) {
      if (!validate25(data.after_sha256, { instancePath: instancePath + "/after_sha256", parentData: data, parentDataProperty: "after_sha256", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate25.errors : vErrors.concat(validate25.errors);
        errors = vErrors.length;
      }
    }
  } else {
    const err6 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err6];
    } else {
      vErrors.push(err6);
    }
    errors++;
  }
  validate24.errors = vErrors;
  return errors === 0;
}
validate24.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var pattern12 = new RegExp("^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9.:-]*$", "u");
var func0 = require_equal().default;
function validate31(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate31.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (Array.isArray(data)) {
    if (data.length < 1) {
      const err0 = { instancePath, schemaPath: "#/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    const len0 = data.length;
    for (let i0 = 0; i0 < len0; i0++) {
      let data0 = data[i0];
      if (typeof data0 === "string") {
        if (!pattern12.test(data0)) {
          const err1 = { instancePath: instancePath + "/" + i0, schemaPath: "#/$defs/globalId/pattern", keyword: "pattern", params: { pattern: "^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9.:-]*$" }, message: 'must match pattern "^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9.:-]*$"' };
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
      } else {
        const err2 = { instancePath: instancePath + "/" + i0, schemaPath: "#/$defs/globalId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
    }
    let i1 = data.length;
    let j0;
    if (i1 > 1) {
      outer0: for (; i1--; ) {
        for (j0 = i1; j0--; ) {
          if (func0(data[i1], data[j0])) {
            const err3 = { instancePath, schemaPath: "#/uniqueItems", keyword: "uniqueItems", params: { i: i1, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i1 + " are identical)" };
            if (vErrors === null) {
              vErrors = [err3];
            } else {
              vErrors.push(err3);
            }
            errors++;
            break outer0;
          }
        }
      }
    }
  } else {
    const err4 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "array" }, message: "must be array" };
    if (vErrors === null) {
      vErrors = [err4];
    } else {
      vErrors.push(err4);
    }
    errors++;
  }
  validate31.errors = vErrors;
  return errors === 0;
}
validate31.evaluated = { "items": true, "dynamicProps": false, "dynamicItems": false };
function validate30(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate30.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.op === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "op" }, message: "must have required property 'op'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.entities === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "entities" }, message: "must have required property 'entities'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.rationale === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "rationale" }, message: "must have required property 'rationale'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "op" || key0 === "entities" || key0 === "rationale")) {
        const err3 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err3];
        } else {
          vErrors.push(err3);
        }
        errors++;
      }
    }
    if (data.op !== void 0) {
      if ("add" !== data.op) {
        const err4 = { instancePath: instancePath + "/op", schemaPath: "#/properties/op/const", keyword: "const", params: { allowedValue: "add" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
    if (data.entities !== void 0) {
      if (!validate31(data.entities, { instancePath: instancePath + "/entities", parentData: data, parentDataProperty: "entities", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate31.errors : vErrors.concat(validate31.errors);
        errors = vErrors.length;
      }
    }
    if (data.rationale !== void 0) {
      let data2 = data.rationale;
      if (typeof data2 === "string") {
        if (func2(data2) < 1) {
          const err5 = { instancePath: instancePath + "/rationale", schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err5];
          } else {
            vErrors.push(err5);
          }
          errors++;
        }
      } else {
        const err6 = { instancePath: instancePath + "/rationale", schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
  } else {
    const err7 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err7];
    } else {
      vErrors.push(err7);
    }
    errors++;
  }
  validate30.errors = vErrors;
  return errors === 0;
}
validate30.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var pattern13 = new RegExp("^point:[a-z0-9][a-z0-9.-]*$", "u");
var pattern14 = new RegExp("^[A-Za-z0-9._/-]+\\.md$", "u");
function validate35(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate35.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.path === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "path" }, message: "must have required property 'path'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.marker === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "marker" }, message: "must have required property 'marker'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "path" || key0 === "marker")) {
        const err2 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
    }
    if (data.path !== void 0) {
      let data0 = data.path;
      if (typeof data0 === "string") {
        if (!pattern14.test(data0)) {
          const err3 = { instancePath: instancePath + "/path", schemaPath: "#/properties/path/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9._/-]+\\.md$" }, message: 'must match pattern "^[A-Za-z0-9._/-]+\\.md$"' };
          if (vErrors === null) {
            vErrors = [err3];
          } else {
            vErrors.push(err3);
          }
          errors++;
        }
      } else {
        const err4 = { instancePath: instancePath + "/path", schemaPath: "#/properties/path/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
    if (data.marker !== void 0) {
      let data1 = data.marker;
      if (typeof data1 === "string") {
        if (!pattern13.test(data1)) {
          const err5 = { instancePath: instancePath + "/marker", schemaPath: "#/$defs/pointId/pattern", keyword: "pattern", params: { pattern: "^point:[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^point:[a-z0-9][a-z0-9.-]*$"' };
          if (vErrors === null) {
            vErrors = [err5];
          } else {
            vErrors.push(err5);
          }
          errors++;
        }
      } else {
        const err6 = { instancePath: instancePath + "/marker", schemaPath: "#/$defs/pointId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
  } else {
    const err7 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err7];
    } else {
      vErrors.push(err7);
    }
    errors++;
  }
  validate35.errors = vErrors;
  return errors === 0;
}
validate35.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate34(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate34.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.op === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "op" }, message: "must have required property 'op'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.subject === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "subject" }, message: "must have required property 'subject'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.binding === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "binding" }, message: "must have required property 'binding'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.before_sha256 === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "before_sha256" }, message: "must have required property 'before_sha256'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.after_sha256 === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "after_sha256" }, message: "must have required property 'after_sha256'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.rationale === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "rationale" }, message: "must have required property 'rationale'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "op" || key0 === "subject" || key0 === "binding" || key0 === "before_sha256" || key0 === "after_sha256" || key0 === "rationale")) {
        const err6 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.op !== void 0) {
      if ("wording" !== data.op) {
        const err7 = { instancePath: instancePath + "/op", schemaPath: "#/properties/op/const", keyword: "const", params: { allowedValue: "wording" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.subject !== void 0) {
      let data1 = data.subject;
      if (typeof data1 === "string") {
        if (!pattern13.test(data1)) {
          const err8 = { instancePath: instancePath + "/subject", schemaPath: "#/$defs/pointId/pattern", keyword: "pattern", params: { pattern: "^point:[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^point:[a-z0-9][a-z0-9.-]*$"' };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
      } else {
        const err9 = { instancePath: instancePath + "/subject", schemaPath: "#/$defs/pointId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.binding !== void 0) {
      if (!validate35(data.binding, { instancePath: instancePath + "/binding", parentData: data, parentDataProperty: "binding", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate35.errors : vErrors.concat(validate35.errors);
        errors = vErrors.length;
      }
    }
    if (data.before_sha256 !== void 0) {
      let data3 = data.before_sha256;
      if (typeof data3 === "string") {
        if (!pattern6.test(data3)) {
          const err10 = { instancePath: instancePath + "/before_sha256", schemaPath: "#/$defs/sha256/pattern", keyword: "pattern", params: { pattern: "^[a-f0-9]{64}$" }, message: 'must match pattern "^[a-f0-9]{64}$"' };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
      } else {
        const err11 = { instancePath: instancePath + "/before_sha256", schemaPath: "#/$defs/sha256/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.after_sha256 !== void 0) {
      let data4 = data.after_sha256;
      if (typeof data4 === "string") {
        if (!pattern6.test(data4)) {
          const err12 = { instancePath: instancePath + "/after_sha256", schemaPath: "#/$defs/sha256/pattern", keyword: "pattern", params: { pattern: "^[a-f0-9]{64}$" }, message: 'must match pattern "^[a-f0-9]{64}$"' };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
      } else {
        const err13 = { instancePath: instancePath + "/after_sha256", schemaPath: "#/$defs/sha256/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
    if (data.rationale !== void 0) {
      let data5 = data.rationale;
      if (typeof data5 === "string") {
        if (func2(data5) < 1) {
          const err14 = { instancePath: instancePath + "/rationale", schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err14];
          } else {
            vErrors.push(err14);
          }
          errors++;
        }
      } else {
        const err15 = { instancePath: instancePath + "/rationale", schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err15];
        } else {
          vErrors.push(err15);
        }
        errors++;
      }
    }
  } else {
    const err16 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err16];
    } else {
      vErrors.push(err16);
    }
    errors++;
  }
  validate34.errors = vErrors;
  return errors === 0;
}
validate34.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var schema57 = { "type": "object", "additionalProperties": false, "required": ["op", "subject", "changed_fields", "rationale"], "properties": { "op": { "const": "refine" }, "subject": { "$ref": "#/$defs/globalId" }, "changed_fields": { "type": "array", "minItems": 1, "items": { "enum": ["intent", "boundary", "summary", "recognition_cues", "access", "authority.subject", "edge.when", "edge.avoid_when", "edge.path_role", "edge.runtime.enabled_by_default", "hop_policy.critical_any_point_to_primary_max", "hop_policy.primary_entry_to_primary_max"] }, "uniqueItems": true }, "rationale": { "$ref": "#/$defs/nonEmptyString" } } };
function validate38(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate38.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.op === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "op" }, message: "must have required property 'op'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.subject === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "subject" }, message: "must have required property 'subject'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.changed_fields === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "changed_fields" }, message: "must have required property 'changed_fields'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.rationale === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "rationale" }, message: "must have required property 'rationale'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "op" || key0 === "subject" || key0 === "changed_fields" || key0 === "rationale")) {
        const err4 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
    if (data.op !== void 0) {
      if ("refine" !== data.op) {
        const err5 = { instancePath: instancePath + "/op", schemaPath: "#/properties/op/const", keyword: "const", params: { allowedValue: "refine" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.subject !== void 0) {
      let data1 = data.subject;
      if (typeof data1 === "string") {
        if (!pattern12.test(data1)) {
          const err6 = { instancePath: instancePath + "/subject", schemaPath: "#/$defs/globalId/pattern", keyword: "pattern", params: { pattern: "^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9.:-]*$" }, message: 'must match pattern "^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9.:-]*$"' };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
      } else {
        const err7 = { instancePath: instancePath + "/subject", schemaPath: "#/$defs/globalId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.changed_fields !== void 0) {
      let data2 = data.changed_fields;
      if (Array.isArray(data2)) {
        if (data2.length < 1) {
          const err8 = { instancePath: instancePath + "/changed_fields", schemaPath: "#/properties/changed_fields/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
        const len0 = data2.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data3 = data2[i0];
          if (!(data3 === "intent" || data3 === "boundary" || data3 === "summary" || data3 === "recognition_cues" || data3 === "access" || data3 === "authority.subject" || data3 === "edge.when" || data3 === "edge.avoid_when" || data3 === "edge.path_role" || data3 === "edge.runtime.enabled_by_default" || data3 === "hop_policy.critical_any_point_to_primary_max" || data3 === "hop_policy.primary_entry_to_primary_max")) {
            const err9 = { instancePath: instancePath + "/changed_fields/" + i0, schemaPath: "#/properties/changed_fields/items/enum", keyword: "enum", params: { allowedValues: schema57.properties.changed_fields.items.enum }, message: "must be equal to one of the allowed values" };
            if (vErrors === null) {
              vErrors = [err9];
            } else {
              vErrors.push(err9);
            }
            errors++;
          }
        }
        let i1 = data2.length;
        let j0;
        if (i1 > 1) {
          outer0: for (; i1--; ) {
            for (j0 = i1; j0--; ) {
              if (func0(data2[i1], data2[j0])) {
                const err10 = { instancePath: instancePath + "/changed_fields", schemaPath: "#/properties/changed_fields/uniqueItems", keyword: "uniqueItems", params: { i: i1, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i1 + " are identical)" };
                if (vErrors === null) {
                  vErrors = [err10];
                } else {
                  vErrors.push(err10);
                }
                errors++;
                break outer0;
              }
            }
          }
        }
      } else {
        const err11 = { instancePath: instancePath + "/changed_fields", schemaPath: "#/properties/changed_fields/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.rationale !== void 0) {
      let data4 = data.rationale;
      if (typeof data4 === "string") {
        if (func2(data4) < 1) {
          const err12 = { instancePath: instancePath + "/rationale", schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
      } else {
        const err13 = { instancePath: instancePath + "/rationale", schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
  } else {
    const err14 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err14];
    } else {
      vErrors.push(err14);
    }
    errors++;
  }
  validate38.errors = vErrors;
  return errors === 0;
}
validate38.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var pattern20 = new RegExp("^module:[a-z0-9][a-z0-9.-]*$", "u");
function validate41(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate41.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (Object.keys(data).length < 1) {
      const err0 = { instancePath, schemaPath: "#/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "module" || key0 === "binding")) {
        const err1 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err1];
        } else {
          vErrors.push(err1);
        }
        errors++;
      }
    }
    if (data.module !== void 0) {
      let data0 = data.module;
      if (typeof data0 === "string") {
        if (!pattern20.test(data0)) {
          const err2 = { instancePath: instancePath + "/module", schemaPath: "#/$defs/moduleId/pattern", keyword: "pattern", params: { pattern: "^module:[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^module:[a-z0-9][a-z0-9.-]*$"' };
          if (vErrors === null) {
            vErrors = [err2];
          } else {
            vErrors.push(err2);
          }
          errors++;
        }
      } else {
        const err3 = { instancePath: instancePath + "/module", schemaPath: "#/$defs/moduleId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err3];
        } else {
          vErrors.push(err3);
        }
        errors++;
      }
    }
    if (data.binding !== void 0) {
      if (!validate35(data.binding, { instancePath: instancePath + "/binding", parentData: data, parentDataProperty: "binding", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate35.errors : vErrors.concat(validate35.errors);
        errors = vErrors.length;
      }
    }
  } else {
    const err4 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err4];
    } else {
      vErrors.push(err4);
    }
    errors++;
  }
  validate41.errors = vErrors;
  return errors === 0;
}
validate41.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var schema64 = { "type": "object", "additionalProperties": false, "required": ["action", "edge"], "properties": { "action": { "enum": ["add", "remove", "retarget"] }, "edge": { "$ref": "#/$defs/edgeId" }, "from": { "$ref": "#/$defs/globalId" }, "to": { "$ref": "#/$defs/globalId" }, "reason": { "$ref": "#/$defs/nonEmptyString" } } };
var pattern21 = new RegExp("^edge:[a-z0-9][a-z0-9.-]*$", "u");
function validate45(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate45.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.action === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "action" }, message: "must have required property 'action'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.edge === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "edge" }, message: "must have required property 'edge'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "action" || key0 === "edge" || key0 === "from" || key0 === "to" || key0 === "reason")) {
        const err2 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
    }
    if (data.action !== void 0) {
      let data0 = data.action;
      if (!(data0 === "add" || data0 === "remove" || data0 === "retarget")) {
        const err3 = { instancePath: instancePath + "/action", schemaPath: "#/properties/action/enum", keyword: "enum", params: { allowedValues: schema64.properties.action.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err3];
        } else {
          vErrors.push(err3);
        }
        errors++;
      }
    }
    if (data.edge !== void 0) {
      let data1 = data.edge;
      if (typeof data1 === "string") {
        if (!pattern21.test(data1)) {
          const err4 = { instancePath: instancePath + "/edge", schemaPath: "#/$defs/edgeId/pattern", keyword: "pattern", params: { pattern: "^edge:[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^edge:[a-z0-9][a-z0-9.-]*$"' };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
      } else {
        const err5 = { instancePath: instancePath + "/edge", schemaPath: "#/$defs/edgeId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.from !== void 0) {
      let data2 = data.from;
      if (typeof data2 === "string") {
        if (!pattern12.test(data2)) {
          const err6 = { instancePath: instancePath + "/from", schemaPath: "#/$defs/globalId/pattern", keyword: "pattern", params: { pattern: "^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9.:-]*$" }, message: 'must match pattern "^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9.:-]*$"' };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
      } else {
        const err7 = { instancePath: instancePath + "/from", schemaPath: "#/$defs/globalId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.to !== void 0) {
      let data3 = data.to;
      if (typeof data3 === "string") {
        if (!pattern12.test(data3)) {
          const err8 = { instancePath: instancePath + "/to", schemaPath: "#/$defs/globalId/pattern", keyword: "pattern", params: { pattern: "^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9.:-]*$" }, message: 'must match pattern "^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9.:-]*$"' };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
      } else {
        const err9 = { instancePath: instancePath + "/to", schemaPath: "#/$defs/globalId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.reason !== void 0) {
      let data4 = data.reason;
      if (typeof data4 === "string") {
        if (func2(data4) < 1) {
          const err10 = { instancePath: instancePath + "/reason", schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
      } else {
        const err11 = { instancePath: instancePath + "/reason", schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
  } else {
    const err12 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err12];
    } else {
      vErrors.push(err12);
    }
    errors++;
  }
  validate45.errors = vErrors;
  return errors === 0;
}
validate45.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate40(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate40.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.op === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "op" }, message: "must have required property 'op'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.subject === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "subject" }, message: "must have required property 'subject'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.from === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "from" }, message: "must have required property 'from'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.to === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "to" }, message: "must have required property 'to'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.edge_rewrites === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "edge_rewrites" }, message: "must have required property 'edge_rewrites'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.rationale === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "rationale" }, message: "must have required property 'rationale'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "op" || key0 === "subject" || key0 === "from" || key0 === "to" || key0 === "edge_rewrites" || key0 === "rationale")) {
        const err6 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.op !== void 0) {
      if ("move" !== data.op) {
        const err7 = { instancePath: instancePath + "/op", schemaPath: "#/properties/op/const", keyword: "const", params: { allowedValue: "move" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.subject !== void 0) {
      let data1 = data.subject;
      if (typeof data1 === "string") {
        if (!pattern13.test(data1)) {
          const err8 = { instancePath: instancePath + "/subject", schemaPath: "#/$defs/pointId/pattern", keyword: "pattern", params: { pattern: "^point:[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^point:[a-z0-9][a-z0-9.-]*$"' };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
      } else {
        const err9 = { instancePath: instancePath + "/subject", schemaPath: "#/$defs/pointId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.from !== void 0) {
      if (!validate41(data.from, { instancePath: instancePath + "/from", parentData: data, parentDataProperty: "from", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate41.errors : vErrors.concat(validate41.errors);
        errors = vErrors.length;
      }
    }
    if (data.to !== void 0) {
      if (!validate41(data.to, { instancePath: instancePath + "/to", parentData: data, parentDataProperty: "to", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate41.errors : vErrors.concat(validate41.errors);
        errors = vErrors.length;
      }
    }
    if (data.edge_rewrites !== void 0) {
      let data4 = data.edge_rewrites;
      if (Array.isArray(data4)) {
        const len0 = data4.length;
        for (let i0 = 0; i0 < len0; i0++) {
          if (!validate45(data4[i0], { instancePath: instancePath + "/edge_rewrites/" + i0, parentData: data4, parentDataProperty: i0, rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate45.errors : vErrors.concat(validate45.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err10 = { instancePath: instancePath + "/edge_rewrites", schemaPath: "#/properties/edge_rewrites/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
    }
    if (data.rationale !== void 0) {
      let data6 = data.rationale;
      if (typeof data6 === "string") {
        if (func2(data6) < 1) {
          const err11 = { instancePath: instancePath + "/rationale", schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err11];
          } else {
            vErrors.push(err11);
          }
          errors++;
        }
      } else {
        const err12 = { instancePath: instancePath + "/rationale", schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
    }
  } else {
    const err13 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err13];
    } else {
      vErrors.push(err13);
    }
    errors++;
  }
  validate40.errors = vErrors;
  return errors === 0;
}
validate40.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate48(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate48.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.op === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "op" }, message: "must have required property 'op'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.subject === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "subject" }, message: "must have required property 'subject'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.results === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "results" }, message: "must have required property 'results'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.edge_rewrites === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "edge_rewrites" }, message: "must have required property 'edge_rewrites'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.rationale === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "rationale" }, message: "must have required property 'rationale'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "op" || key0 === "subject" || key0 === "results" || key0 === "edge_rewrites" || key0 === "rationale")) {
        const err5 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.op !== void 0) {
      if ("split" !== data.op) {
        const err6 = { instancePath: instancePath + "/op", schemaPath: "#/properties/op/const", keyword: "const", params: { allowedValue: "split" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.subject !== void 0) {
      let data1 = data.subject;
      if (typeof data1 === "string") {
        if (!pattern12.test(data1)) {
          const err7 = { instancePath: instancePath + "/subject", schemaPath: "#/$defs/globalId/pattern", keyword: "pattern", params: { pattern: "^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9.:-]*$" }, message: 'must match pattern "^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9.:-]*$"' };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
      } else {
        const err8 = { instancePath: instancePath + "/subject", schemaPath: "#/$defs/globalId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
    }
    if (data.results !== void 0) {
      let data2 = data.results;
      if (Array.isArray(data2)) {
        if (data2.length < 2) {
          const err9 = { instancePath: instancePath + "/results", schemaPath: "#/properties/results/minItems", keyword: "minItems", params: { limit: 2 }, message: "must NOT have fewer than 2 items" };
          if (vErrors === null) {
            vErrors = [err9];
          } else {
            vErrors.push(err9);
          }
          errors++;
        }
        const len0 = data2.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data3 = data2[i0];
          if (typeof data3 === "string") {
            if (!pattern12.test(data3)) {
              const err10 = { instancePath: instancePath + "/results/" + i0, schemaPath: "#/$defs/globalId/pattern", keyword: "pattern", params: { pattern: "^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9.:-]*$" }, message: 'must match pattern "^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9.:-]*$"' };
              if (vErrors === null) {
                vErrors = [err10];
              } else {
                vErrors.push(err10);
              }
              errors++;
            }
          } else {
            const err11 = { instancePath: instancePath + "/results/" + i0, schemaPath: "#/$defs/globalId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err11];
            } else {
              vErrors.push(err11);
            }
            errors++;
          }
        }
        let i1 = data2.length;
        let j0;
        if (i1 > 1) {
          outer0: for (; i1--; ) {
            for (j0 = i1; j0--; ) {
              if (func0(data2[i1], data2[j0])) {
                const err12 = { instancePath: instancePath + "/results", schemaPath: "#/properties/results/uniqueItems", keyword: "uniqueItems", params: { i: i1, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i1 + " are identical)" };
                if (vErrors === null) {
                  vErrors = [err12];
                } else {
                  vErrors.push(err12);
                }
                errors++;
                break outer0;
              }
            }
          }
        }
      } else {
        const err13 = { instancePath: instancePath + "/results", schemaPath: "#/properties/results/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
    if (data.edge_rewrites !== void 0) {
      let data4 = data.edge_rewrites;
      if (Array.isArray(data4)) {
        const len1 = data4.length;
        for (let i2 = 0; i2 < len1; i2++) {
          if (!validate45(data4[i2], { instancePath: instancePath + "/edge_rewrites/" + i2, parentData: data4, parentDataProperty: i2, rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate45.errors : vErrors.concat(validate45.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err14 = { instancePath: instancePath + "/edge_rewrites", schemaPath: "#/properties/edge_rewrites/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
    }
    if (data.rationale !== void 0) {
      let data6 = data.rationale;
      if (typeof data6 === "string") {
        if (func2(data6) < 1) {
          const err15 = { instancePath: instancePath + "/rationale", schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
      } else {
        const err16 = { instancePath: instancePath + "/rationale", schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
    }
  } else {
    const err17 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err17];
    } else {
      vErrors.push(err17);
    }
    errors++;
  }
  validate48.errors = vErrors;
  return errors === 0;
}
validate48.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate51(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate51.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.op === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "op" }, message: "must have required property 'op'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.subjects === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "subjects" }, message: "must have required property 'subjects'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.result === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "result" }, message: "must have required property 'result'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.edge_rewrites === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "edge_rewrites" }, message: "must have required property 'edge_rewrites'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.rationale === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "rationale" }, message: "must have required property 'rationale'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "op" || key0 === "subjects" || key0 === "result" || key0 === "edge_rewrites" || key0 === "rationale")) {
        const err5 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.op !== void 0) {
      if ("merge" !== data.op) {
        const err6 = { instancePath: instancePath + "/op", schemaPath: "#/properties/op/const", keyword: "const", params: { allowedValue: "merge" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.subjects !== void 0) {
      let data1 = data.subjects;
      if (Array.isArray(data1)) {
        if (data1.length < 2) {
          const err7 = { instancePath: instancePath + "/subjects", schemaPath: "#/properties/subjects/minItems", keyword: "minItems", params: { limit: 2 }, message: "must NOT have fewer than 2 items" };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
        const len0 = data1.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data2 = data1[i0];
          if (typeof data2 === "string") {
            if (!pattern12.test(data2)) {
              const err8 = { instancePath: instancePath + "/subjects/" + i0, schemaPath: "#/$defs/globalId/pattern", keyword: "pattern", params: { pattern: "^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9.:-]*$" }, message: 'must match pattern "^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9.:-]*$"' };
              if (vErrors === null) {
                vErrors = [err8];
              } else {
                vErrors.push(err8);
              }
              errors++;
            }
          } else {
            const err9 = { instancePath: instancePath + "/subjects/" + i0, schemaPath: "#/$defs/globalId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err9];
            } else {
              vErrors.push(err9);
            }
            errors++;
          }
        }
        let i1 = data1.length;
        let j0;
        if (i1 > 1) {
          outer0: for (; i1--; ) {
            for (j0 = i1; j0--; ) {
              if (func0(data1[i1], data1[j0])) {
                const err10 = { instancePath: instancePath + "/subjects", schemaPath: "#/properties/subjects/uniqueItems", keyword: "uniqueItems", params: { i: i1, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i1 + " are identical)" };
                if (vErrors === null) {
                  vErrors = [err10];
                } else {
                  vErrors.push(err10);
                }
                errors++;
                break outer0;
              }
            }
          }
        }
      } else {
        const err11 = { instancePath: instancePath + "/subjects", schemaPath: "#/properties/subjects/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.result !== void 0) {
      let data3 = data.result;
      if (typeof data3 === "string") {
        if (!pattern12.test(data3)) {
          const err12 = { instancePath: instancePath + "/result", schemaPath: "#/$defs/globalId/pattern", keyword: "pattern", params: { pattern: "^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9.:-]*$" }, message: 'must match pattern "^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9.:-]*$"' };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
      } else {
        const err13 = { instancePath: instancePath + "/result", schemaPath: "#/$defs/globalId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
    if (data.edge_rewrites !== void 0) {
      let data4 = data.edge_rewrites;
      if (Array.isArray(data4)) {
        const len1 = data4.length;
        for (let i2 = 0; i2 < len1; i2++) {
          if (!validate45(data4[i2], { instancePath: instancePath + "/edge_rewrites/" + i2, parentData: data4, parentDataProperty: i2, rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate45.errors : vErrors.concat(validate45.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err14 = { instancePath: instancePath + "/edge_rewrites", schemaPath: "#/properties/edge_rewrites/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
    }
    if (data.rationale !== void 0) {
      let data6 = data.rationale;
      if (typeof data6 === "string") {
        if (func2(data6) < 1) {
          const err15 = { instancePath: instancePath + "/rationale", schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
      } else {
        const err16 = { instancePath: instancePath + "/rationale", schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
    }
  } else {
    const err17 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err17];
    } else {
      vErrors.push(err17);
    }
    errors++;
  }
  validate51.errors = vErrors;
  return errors === 0;
}
validate51.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var pattern29 = new RegExp("^skill:[a-z0-9][a-z0-9.-]*$", "u");
function validate54(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate54.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.op === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "op" }, message: "must have required property 'op'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.subject === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "subject" }, message: "must have required property 'subject'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.from_skill === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "from_skill" }, message: "must have required property 'from_skill'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.to_skill === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "to_skill" }, message: "must have required property 'to_skill'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.edge_rewrites === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "edge_rewrites" }, message: "must have required property 'edge_rewrites'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.rationale === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "rationale" }, message: "must have required property 'rationale'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "op" || key0 === "subject" || key0 === "from_skill" || key0 === "to_skill" || key0 === "edge_rewrites" || key0 === "rationale")) {
        const err6 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.op !== void 0) {
      if ("transfer_owner" !== data.op) {
        const err7 = { instancePath: instancePath + "/op", schemaPath: "#/properties/op/const", keyword: "const", params: { allowedValue: "transfer_owner" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.subject !== void 0) {
      let data1 = data.subject;
      if (typeof data1 === "string") {
        if (!pattern20.test(data1)) {
          const err8 = { instancePath: instancePath + "/subject", schemaPath: "#/$defs/moduleId/pattern", keyword: "pattern", params: { pattern: "^module:[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^module:[a-z0-9][a-z0-9.-]*$"' };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
      } else {
        const err9 = { instancePath: instancePath + "/subject", schemaPath: "#/$defs/moduleId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.from_skill !== void 0) {
      let data2 = data.from_skill;
      if (typeof data2 === "string") {
        if (!pattern29.test(data2)) {
          const err10 = { instancePath: instancePath + "/from_skill", schemaPath: "#/$defs/skillId/pattern", keyword: "pattern", params: { pattern: "^skill:[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^skill:[a-z0-9][a-z0-9.-]*$"' };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
      } else {
        const err11 = { instancePath: instancePath + "/from_skill", schemaPath: "#/$defs/skillId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.to_skill !== void 0) {
      let data3 = data.to_skill;
      if (typeof data3 === "string") {
        if (!pattern29.test(data3)) {
          const err12 = { instancePath: instancePath + "/to_skill", schemaPath: "#/$defs/skillId/pattern", keyword: "pattern", params: { pattern: "^skill:[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^skill:[a-z0-9][a-z0-9.-]*$"' };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
      } else {
        const err13 = { instancePath: instancePath + "/to_skill", schemaPath: "#/$defs/skillId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
    if (data.edge_rewrites !== void 0) {
      let data4 = data.edge_rewrites;
      if (Array.isArray(data4)) {
        const len0 = data4.length;
        for (let i0 = 0; i0 < len0; i0++) {
          if (!validate45(data4[i0], { instancePath: instancePath + "/edge_rewrites/" + i0, parentData: data4, parentDataProperty: i0, rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate45.errors : vErrors.concat(validate45.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err14 = { instancePath: instancePath + "/edge_rewrites", schemaPath: "#/properties/edge_rewrites/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
    }
    if (data.rationale !== void 0) {
      let data6 = data.rationale;
      if (typeof data6 === "string") {
        if (func2(data6) < 1) {
          const err15 = { instancePath: instancePath + "/rationale", schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
      } else {
        const err16 = { instancePath: instancePath + "/rationale", schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
    }
  } else {
    const err17 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err17];
    } else {
      vErrors.push(err17);
    }
    errors++;
  }
  validate54.errors = vErrors;
  return errors === 0;
}
validate54.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate57(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate57.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.op === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "op" }, message: "must have required property 'op'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.subjects === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "subjects" }, message: "must have required property 'subjects'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.edge_rewrites === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "edge_rewrites" }, message: "must have required property 'edge_rewrites'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.rationale === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "rationale" }, message: "must have required property 'rationale'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "op" || key0 === "subjects" || key0 === "replacement" || key0 === "edge_rewrites" || key0 === "rationale")) {
        const err4 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
    if (data.op !== void 0) {
      if ("deprecate" !== data.op) {
        const err5 = { instancePath: instancePath + "/op", schemaPath: "#/properties/op/const", keyword: "const", params: { allowedValue: "deprecate" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.subjects !== void 0) {
      if (!validate31(data.subjects, { instancePath: instancePath + "/subjects", parentData: data, parentDataProperty: "subjects", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate31.errors : vErrors.concat(validate31.errors);
        errors = vErrors.length;
      }
    }
    if (data.replacement !== void 0) {
      let data2 = data.replacement;
      if (typeof data2 === "string") {
        if (!pattern12.test(data2)) {
          const err6 = { instancePath: instancePath + "/replacement", schemaPath: "#/$defs/globalId/pattern", keyword: "pattern", params: { pattern: "^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9.:-]*$" }, message: 'must match pattern "^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9.:-]*$"' };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
      } else {
        const err7 = { instancePath: instancePath + "/replacement", schemaPath: "#/$defs/globalId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.edge_rewrites !== void 0) {
      let data3 = data.edge_rewrites;
      if (Array.isArray(data3)) {
        const len0 = data3.length;
        for (let i0 = 0; i0 < len0; i0++) {
          if (!validate45(data3[i0], { instancePath: instancePath + "/edge_rewrites/" + i0, parentData: data3, parentDataProperty: i0, rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate45.errors : vErrors.concat(validate45.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err8 = { instancePath: instancePath + "/edge_rewrites", schemaPath: "#/properties/edge_rewrites/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
    }
    if (data.rationale !== void 0) {
      let data5 = data.rationale;
      if (typeof data5 === "string") {
        if (func2(data5) < 1) {
          const err9 = { instancePath: instancePath + "/rationale", schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err9];
          } else {
            vErrors.push(err9);
          }
          errors++;
        }
      } else {
        const err10 = { instancePath: instancePath + "/rationale", schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
    }
  } else {
    const err11 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err11];
    } else {
      vErrors.push(err11);
    }
    errors++;
  }
  validate57.errors = vErrors;
  return errors === 0;
}
validate57.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate61(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate61.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.op === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "op" }, message: "must have required property 'op'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.subjects === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "subjects" }, message: "must have required property 'subjects'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.edge_rewrites === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "edge_rewrites" }, message: "must have required property 'edge_rewrites'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.rationale === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "rationale" }, message: "must have required property 'rationale'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "op" || key0 === "subjects" || key0 === "replacement" || key0 === "edge_rewrites" || key0 === "rationale")) {
        const err4 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
    if (data.op !== void 0) {
      if ("retire" !== data.op) {
        const err5 = { instancePath: instancePath + "/op", schemaPath: "#/properties/op/const", keyword: "const", params: { allowedValue: "retire" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.subjects !== void 0) {
      if (!validate31(data.subjects, { instancePath: instancePath + "/subjects", parentData: data, parentDataProperty: "subjects", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate31.errors : vErrors.concat(validate31.errors);
        errors = vErrors.length;
      }
    }
    if (data.replacement !== void 0) {
      let data2 = data.replacement;
      if (typeof data2 === "string") {
        if (!pattern12.test(data2)) {
          const err6 = { instancePath: instancePath + "/replacement", schemaPath: "#/$defs/globalId/pattern", keyword: "pattern", params: { pattern: "^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9.:-]*$" }, message: 'must match pattern "^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9.:-]*$"' };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
      } else {
        const err7 = { instancePath: instancePath + "/replacement", schemaPath: "#/$defs/globalId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.edge_rewrites !== void 0) {
      let data3 = data.edge_rewrites;
      if (Array.isArray(data3)) {
        const len0 = data3.length;
        for (let i0 = 0; i0 < len0; i0++) {
          if (!validate45(data3[i0], { instancePath: instancePath + "/edge_rewrites/" + i0, parentData: data3, parentDataProperty: i0, rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate45.errors : vErrors.concat(validate45.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err8 = { instancePath: instancePath + "/edge_rewrites", schemaPath: "#/properties/edge_rewrites/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
    }
    if (data.rationale !== void 0) {
      let data5 = data.rationale;
      if (typeof data5 === "string") {
        if (func2(data5) < 1) {
          const err9 = { instancePath: instancePath + "/rationale", schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err9];
          } else {
            vErrors.push(err9);
          }
          errors++;
        }
      } else {
        const err10 = { instancePath: instancePath + "/rationale", schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
    }
  } else {
    const err11 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err11];
    } else {
      vErrors.push(err11);
    }
    errors++;
  }
  validate61.errors = vErrors;
  return errors === 0;
}
validate61.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate29(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate29.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  const _errs0 = errors;
  let valid0 = false;
  let passing0 = null;
  const _errs1 = errors;
  if (!validate30(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })) {
    vErrors = vErrors === null ? validate30.errors : vErrors.concat(validate30.errors);
    errors = vErrors.length;
  }
  var _valid0 = _errs1 === errors;
  if (_valid0) {
    valid0 = true;
    passing0 = 0;
    var props0 = true;
  }
  const _errs2 = errors;
  if (!validate34(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })) {
    vErrors = vErrors === null ? validate34.errors : vErrors.concat(validate34.errors);
    errors = vErrors.length;
  }
  var _valid0 = _errs2 === errors;
  if (_valid0 && valid0) {
    valid0 = false;
    passing0 = [passing0, 1];
  } else {
    if (_valid0) {
      valid0 = true;
      passing0 = 1;
      if (props0 !== true) {
        props0 = true;
      }
    }
    const _errs3 = errors;
    if (!validate38(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })) {
      vErrors = vErrors === null ? validate38.errors : vErrors.concat(validate38.errors);
      errors = vErrors.length;
    }
    var _valid0 = _errs3 === errors;
    if (_valid0 && valid0) {
      valid0 = false;
      passing0 = [passing0, 2];
    } else {
      if (_valid0) {
        valid0 = true;
        passing0 = 2;
        if (props0 !== true) {
          props0 = true;
        }
      }
      const _errs4 = errors;
      if (!validate40(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate40.errors : vErrors.concat(validate40.errors);
        errors = vErrors.length;
      }
      var _valid0 = _errs4 === errors;
      if (_valid0 && valid0) {
        valid0 = false;
        passing0 = [passing0, 3];
      } else {
        if (_valid0) {
          valid0 = true;
          passing0 = 3;
          if (props0 !== true) {
            props0 = true;
          }
        }
        const _errs5 = errors;
        if (!validate48(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })) {
          vErrors = vErrors === null ? validate48.errors : vErrors.concat(validate48.errors);
          errors = vErrors.length;
        }
        var _valid0 = _errs5 === errors;
        if (_valid0 && valid0) {
          valid0 = false;
          passing0 = [passing0, 4];
        } else {
          if (_valid0) {
            valid0 = true;
            passing0 = 4;
            if (props0 !== true) {
              props0 = true;
            }
          }
          const _errs6 = errors;
          if (!validate51(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate51.errors : vErrors.concat(validate51.errors);
            errors = vErrors.length;
          }
          var _valid0 = _errs6 === errors;
          if (_valid0 && valid0) {
            valid0 = false;
            passing0 = [passing0, 5];
          } else {
            if (_valid0) {
              valid0 = true;
              passing0 = 5;
              if (props0 !== true) {
                props0 = true;
              }
            }
            const _errs7 = errors;
            if (!validate54(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })) {
              vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
              errors = vErrors.length;
            }
            var _valid0 = _errs7 === errors;
            if (_valid0 && valid0) {
              valid0 = false;
              passing0 = [passing0, 6];
            } else {
              if (_valid0) {
                valid0 = true;
                passing0 = 6;
                if (props0 !== true) {
                  props0 = true;
                }
              }
              const _errs8 = errors;
              if (!validate57(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })) {
                vErrors = vErrors === null ? validate57.errors : vErrors.concat(validate57.errors);
                errors = vErrors.length;
              }
              var _valid0 = _errs8 === errors;
              if (_valid0 && valid0) {
                valid0 = false;
                passing0 = [passing0, 7];
              } else {
                if (_valid0) {
                  valid0 = true;
                  passing0 = 7;
                  if (props0 !== true) {
                    props0 = true;
                  }
                }
                const _errs9 = errors;
                if (!validate61(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })) {
                  vErrors = vErrors === null ? validate61.errors : vErrors.concat(validate61.errors);
                  errors = vErrors.length;
                }
                var _valid0 = _errs9 === errors;
                if (_valid0 && valid0) {
                  valid0 = false;
                  passing0 = [passing0, 8];
                } else {
                  if (_valid0) {
                    valid0 = true;
                    passing0 = 8;
                    if (props0 !== true) {
                      props0 = true;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  if (!valid0) {
    const err0 = { instancePath, schemaPath: "#/oneOf", keyword: "oneOf", params: { passingSchemas: passing0 }, message: "must match exactly one schema in oneOf" };
    if (vErrors === null) {
      vErrors = [err0];
    } else {
      vErrors.push(err0);
    }
    errors++;
  } else {
    errors = _errs0;
    if (vErrors !== null) {
      if (_errs0) {
        vErrors.length = _errs0;
      } else {
        vErrors = null;
      }
    }
  }
  validate29.errors = vErrors;
  evaluated0.props = props0;
  return errors === 0;
}
validate29.evaluated = { "dynamicProps": true, "dynamicItems": false };
var schema89 = { "type": "object", "additionalProperties": false, "required": ["kind", "ref"], "properties": { "kind": { "enum": ["design", "research", "test", "migration", "review", "user-decision"] }, "ref": { "$ref": "#/$defs/nonEmptyString" }, "note": { "$ref": "#/$defs/nonEmptyString" } } };
function validate66(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate66.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.kind === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.ref === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "ref" }, message: "must have required property 'ref'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "kind" || key0 === "ref" || key0 === "note")) {
        const err2 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
    }
    if (data.kind !== void 0) {
      let data0 = data.kind;
      if (!(data0 === "design" || data0 === "research" || data0 === "test" || data0 === "migration" || data0 === "review" || data0 === "user-decision")) {
        const err3 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/enum", keyword: "enum", params: { allowedValues: schema89.properties.kind.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err3];
        } else {
          vErrors.push(err3);
        }
        errors++;
      }
    }
    if (data.ref !== void 0) {
      let data1 = data.ref;
      if (typeof data1 === "string") {
        if (func2(data1) < 1) {
          const err4 = { instancePath: instancePath + "/ref", schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
      } else {
        const err5 = { instancePath: instancePath + "/ref", schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.note !== void 0) {
      let data2 = data.note;
      if (typeof data2 === "string") {
        if (func2(data2) < 1) {
          const err6 = { instancePath: instancePath + "/note", schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
      } else {
        const err7 = { instancePath: instancePath + "/note", schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
  } else {
    const err8 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err8];
    } else {
      vErrors.push(err8);
    }
    errors++;
  }
  validate66.errors = vErrors;
  return errors === 0;
}
validate66.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate68(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate68.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.identity_delta === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "identity_delta" }, message: "must have required property 'identity_delta'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.canonical_subject_delta === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "canonical_subject_delta" }, message: "must have required property 'canonical_subject_delta'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.max_hop_regression_allowed === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "max_hop_regression_allowed" }, message: "must have required property 'max_hop_regression_allowed'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.coverage_debt_allowed === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "coverage_debt_allowed" }, message: "must have required property 'coverage_debt_allowed'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "identity_delta" || key0 === "canonical_subject_delta" || key0 === "max_hop_regression_allowed" || key0 === "coverage_debt_allowed" || key0 === "notes")) {
        const err4 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
    if (data.identity_delta !== void 0) {
      let data0 = data.identity_delta;
      if (!(typeof data0 == "number" && (!(data0 % 1) && !isNaN(data0)))) {
        const err5 = { instancePath: instancePath + "/identity_delta", schemaPath: "#/properties/identity_delta/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.canonical_subject_delta !== void 0) {
      let data1 = data.canonical_subject_delta;
      if (!(typeof data1 == "number" && (!(data1 % 1) && !isNaN(data1)))) {
        const err6 = { instancePath: instancePath + "/canonical_subject_delta", schemaPath: "#/properties/canonical_subject_delta/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.max_hop_regression_allowed !== void 0) {
      if (0 !== data.max_hop_regression_allowed) {
        const err7 = { instancePath: instancePath + "/max_hop_regression_allowed", schemaPath: "#/properties/max_hop_regression_allowed/const", keyword: "const", params: { allowedValue: 0 }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.coverage_debt_allowed !== void 0) {
      if (typeof data.coverage_debt_allowed !== "boolean") {
        const err8 = { instancePath: instancePath + "/coverage_debt_allowed", schemaPath: "#/properties/coverage_debt_allowed/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
    }
    if (data.notes !== void 0) {
      let data4 = data.notes;
      if (typeof data4 === "string") {
        if (func2(data4) < 1) {
          const err9 = { instancePath: instancePath + "/notes", schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err9];
          } else {
            vErrors.push(err9);
          }
          errors++;
        }
      } else {
        const err10 = { instancePath: instancePath + "/notes", schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
    }
  } else {
    const err11 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err11];
    } else {
      vErrors.push(err11);
    }
    errors++;
  }
  validate68.errors = vErrors;
  return errors === 0;
}
validate68.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate21(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate21.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.schema_version === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "schema_version" }, message: "must have required property 'schema_version'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.kind === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.change_id === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "change_id" }, message: "must have required property 'change_id'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.base_ref === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "base_ref" }, message: "must have required property 'base_ref'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.base_graph_sha256 === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "base_graph_sha256" }, message: "must have required property 'base_graph_sha256'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.result_graph_sha256 === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "result_graph_sha256" }, message: "must have required property 'result_graph_sha256'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    if (data.parent_change === void 0) {
      const err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "parent_change" }, message: "must have required property 'parent_change'" };
      if (vErrors === null) {
        vErrors = [err6];
      } else {
        vErrors.push(err6);
      }
      errors++;
    }
    if (data.scope === void 0) {
      const err7 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "scope" }, message: "must have required property 'scope'" };
      if (vErrors === null) {
        vErrors = [err7];
      } else {
        vErrors.push(err7);
      }
      errors++;
    }
    if (data.reason === void 0) {
      const err8 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "reason" }, message: "must have required property 'reason'" };
      if (vErrors === null) {
        vErrors = [err8];
      } else {
        vErrors.push(err8);
      }
      errors++;
    }
    if (data.operations === void 0) {
      const err9 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "operations" }, message: "must have required property 'operations'" };
      if (vErrors === null) {
        vErrors = [err9];
      } else {
        vErrors.push(err9);
      }
      errors++;
    }
    if (data.evidence === void 0) {
      const err10 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "evidence" }, message: "must have required property 'evidence'" };
      if (vErrors === null) {
        vErrors = [err10];
      } else {
        vErrors.push(err10);
      }
      errors++;
    }
    if (data.expected_effects === void 0) {
      const err11 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "expected_effects" }, message: "must have required property 'expected_effects'" };
      if (vErrors === null) {
        vErrors = [err11];
      } else {
        vErrors.push(err11);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func1.call(schema32.properties, key0)) {
        const err12 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
    }
    if (data.schema_version !== void 0) {
      if ("cc-master/skill-knowledge-change/v1alpha1" !== data.schema_version) {
        const err13 = { instancePath: instancePath + "/schema_version", schemaPath: "#/properties/schema_version/const", keyword: "const", params: { allowedValue: "cc-master/skill-knowledge-change/v1alpha1" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
    if (data.kind !== void 0) {
      if ("change" !== data.kind) {
        const err14 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "change" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
    }
    if (data.change_id !== void 0) {
      let data2 = data.change_id;
      if (typeof data2 === "string") {
        if (!pattern4.test(data2)) {
          const err15 = { instancePath: instancePath + "/change_id", schemaPath: "#/$defs/changeId/pattern", keyword: "pattern", params: { pattern: "^change:[0-9]{8}\\.[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^change:[0-9]{8}\\.[a-z0-9][a-z0-9.-]*$"' };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
      } else {
        const err16 = { instancePath: instancePath + "/change_id", schemaPath: "#/$defs/changeId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
    }
    if (data.base_ref !== void 0) {
      let data3 = data.base_ref;
      if (typeof data3 === "string") {
        if (func2(data3) < 1) {
          const err17 = { instancePath: instancePath + "/base_ref", schemaPath: "#/$defs/gitRef/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err17];
          } else {
            vErrors.push(err17);
          }
          errors++;
        }
        if (!pattern5.test(data3)) {
          const err18 = { instancePath: instancePath + "/base_ref", schemaPath: "#/$defs/gitRef/pattern", keyword: "pattern", params: { pattern: "^[^\\s\\u0000]+$" }, message: 'must match pattern "^[^\\s\\u0000]+$"' };
          if (vErrors === null) {
            vErrors = [err18];
          } else {
            vErrors.push(err18);
          }
          errors++;
        }
      } else {
        const err19 = { instancePath: instancePath + "/base_ref", schemaPath: "#/$defs/gitRef/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err19];
        } else {
          vErrors.push(err19);
        }
        errors++;
      }
    }
    if (data.base_graph_sha256 !== void 0) {
      let data4 = data.base_graph_sha256;
      if (typeof data4 === "string") {
        if (!pattern6.test(data4)) {
          const err20 = { instancePath: instancePath + "/base_graph_sha256", schemaPath: "#/$defs/sha256/pattern", keyword: "pattern", params: { pattern: "^[a-f0-9]{64}$" }, message: 'must match pattern "^[a-f0-9]{64}$"' };
          if (vErrors === null) {
            vErrors = [err20];
          } else {
            vErrors.push(err20);
          }
          errors++;
        }
      } else {
        const err21 = { instancePath: instancePath + "/base_graph_sha256", schemaPath: "#/$defs/sha256/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err21];
        } else {
          vErrors.push(err21);
        }
        errors++;
      }
    }
    if (data.result_graph_sha256 !== void 0) {
      let data5 = data.result_graph_sha256;
      if (typeof data5 === "string") {
        if (!pattern6.test(data5)) {
          const err22 = { instancePath: instancePath + "/result_graph_sha256", schemaPath: "#/$defs/sha256/pattern", keyword: "pattern", params: { pattern: "^[a-f0-9]{64}$" }, message: 'must match pattern "^[a-f0-9]{64}$"' };
          if (vErrors === null) {
            vErrors = [err22];
          } else {
            vErrors.push(err22);
          }
          errors++;
        }
      } else {
        const err23 = { instancePath: instancePath + "/result_graph_sha256", schemaPath: "#/$defs/sha256/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err23];
        } else {
          vErrors.push(err23);
        }
        errors++;
      }
    }
    if (data.parent_change !== void 0) {
      if (!validate22(data.parent_change, { instancePath: instancePath + "/parent_change", parentData: data, parentDataProperty: "parent_change", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate22.errors : vErrors.concat(validate22.errors);
        errors = vErrors.length;
      }
    }
    if (data.scope !== void 0) {
      let data7 = data.scope;
      if (Array.isArray(data7)) {
        if (data7.length < 1) {
          const err24 = { instancePath: instancePath + "/scope", schemaPath: "#/properties/scope/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          if (vErrors === null) {
            vErrors = [err24];
          } else {
            vErrors.push(err24);
          }
          errors++;
        }
        const len0 = data7.length;
        for (let i0 = 0; i0 < len0; i0++) {
          if (!validate24(data7[i0], { instancePath: instancePath + "/scope/" + i0, parentData: data7, parentDataProperty: i0, rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate24.errors : vErrors.concat(validate24.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err25 = { instancePath: instancePath + "/scope", schemaPath: "#/properties/scope/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err25];
        } else {
          vErrors.push(err25);
        }
        errors++;
      }
    }
    if (data.reason !== void 0) {
      let data9 = data.reason;
      if (typeof data9 === "string") {
        if (func2(data9) < 1) {
          const err26 = { instancePath: instancePath + "/reason", schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err26];
          } else {
            vErrors.push(err26);
          }
          errors++;
        }
      } else {
        const err27 = { instancePath: instancePath + "/reason", schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err27];
        } else {
          vErrors.push(err27);
        }
        errors++;
      }
    }
    if (data.operations !== void 0) {
      let data10 = data.operations;
      if (Array.isArray(data10)) {
        if (data10.length < 1) {
          const err28 = { instancePath: instancePath + "/operations", schemaPath: "#/properties/operations/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          if (vErrors === null) {
            vErrors = [err28];
          } else {
            vErrors.push(err28);
          }
          errors++;
        }
        const len1 = data10.length;
        for (let i1 = 0; i1 < len1; i1++) {
          if (!validate29(data10[i1], { instancePath: instancePath + "/operations/" + i1, parentData: data10, parentDataProperty: i1, rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate29.errors : vErrors.concat(validate29.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err29 = { instancePath: instancePath + "/operations", schemaPath: "#/properties/operations/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err29];
        } else {
          vErrors.push(err29);
        }
        errors++;
      }
    }
    if (data.evidence !== void 0) {
      let data12 = data.evidence;
      if (Array.isArray(data12)) {
        if (data12.length < 1) {
          const err30 = { instancePath: instancePath + "/evidence", schemaPath: "#/properties/evidence/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          if (vErrors === null) {
            vErrors = [err30];
          } else {
            vErrors.push(err30);
          }
          errors++;
        }
        const len2 = data12.length;
        for (let i2 = 0; i2 < len2; i2++) {
          if (!validate66(data12[i2], { instancePath: instancePath + "/evidence/" + i2, parentData: data12, parentDataProperty: i2, rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate66.errors : vErrors.concat(validate66.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err31 = { instancePath: instancePath + "/evidence", schemaPath: "#/properties/evidence/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err31];
        } else {
          vErrors.push(err31);
        }
        errors++;
      }
    }
    if (data.expected_effects !== void 0) {
      if (!validate68(data.expected_effects, { instancePath: instancePath + "/expected_effects", parentData: data, parentDataProperty: "expected_effects", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate68.errors : vErrors.concat(validate68.errors);
        errors = vErrors.length;
      }
    }
  } else {
    const err32 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err32];
    } else {
      vErrors.push(err32);
    }
    errors++;
  }
  validate21.errors = vErrors;
  return errors === 0;
}
validate21.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var schema94 = { "type": "object", "additionalProperties": false, "required": ["schema_version", "kind", "change_id", "operation", "base_ref", "base_graph_sha256", "scope", "candidate_root", "status"], "properties": { "schema_version": { "const": "cc-master/skill-knowledge-workspace/v1alpha1" }, "kind": { "const": "change_workspace" }, "change_id": { "$ref": "#/$defs/changeId" }, "operation": { "$ref": "#/$defs/operationType" }, "base_ref": { "$ref": "#/$defs/gitRef" }, "base_graph_sha256": { "$ref": "#/$defs/sha256" }, "scope": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/scopedFileHash" } }, "candidate_root": { "$ref": "#/$defs/repoScopePath" }, "status": { "enum": ["begun", "validated", "applied"] } } };
var schema96 = { "enum": ["add", "wording", "refine", "move", "split", "merge", "transfer_owner", "deprecate", "retire"] };
function validate72(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate72.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.path === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "path" }, message: "must have required property 'path'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.sha256 === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "sha256" }, message: "must have required property 'sha256'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "path" || key0 === "sha256")) {
        const err2 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
    }
    if (data.path !== void 0) {
      let data0 = data.path;
      if (typeof data0 === "string") {
        if (!pattern10.test(data0)) {
          const err3 = { instancePath: instancePath + "/path", schemaPath: "#/$defs/repoScopePath/pattern", keyword: "pattern", params: { pattern: "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))[A-Za-z0-9._/-]+$" }, message: 'must match pattern "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))[A-Za-z0-9._/-]+$"' };
          if (vErrors === null) {
            vErrors = [err3];
          } else {
            vErrors.push(err3);
          }
          errors++;
        }
      } else {
        const err4 = { instancePath: instancePath + "/path", schemaPath: "#/$defs/repoScopePath/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
    if (data.sha256 !== void 0) {
      let data1 = data.sha256;
      if (typeof data1 === "string") {
        if (!pattern6.test(data1)) {
          const err5 = { instancePath: instancePath + "/sha256", schemaPath: "#/$defs/sha256/pattern", keyword: "pattern", params: { pattern: "^[a-f0-9]{64}$" }, message: 'must match pattern "^[a-f0-9]{64}$"' };
          if (vErrors === null) {
            vErrors = [err5];
          } else {
            vErrors.push(err5);
          }
          errors++;
        }
      } else {
        const err6 = { instancePath: instancePath + "/sha256", schemaPath: "#/$defs/sha256/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
  } else {
    const err7 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err7];
    } else {
      vErrors.push(err7);
    }
    errors++;
  }
  validate72.errors = vErrors;
  return errors === 0;
}
validate72.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate71(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate71.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.schema_version === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "schema_version" }, message: "must have required property 'schema_version'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.kind === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.change_id === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "change_id" }, message: "must have required property 'change_id'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.operation === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "operation" }, message: "must have required property 'operation'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.base_ref === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "base_ref" }, message: "must have required property 'base_ref'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.base_graph_sha256 === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "base_graph_sha256" }, message: "must have required property 'base_graph_sha256'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    if (data.scope === void 0) {
      const err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "scope" }, message: "must have required property 'scope'" };
      if (vErrors === null) {
        vErrors = [err6];
      } else {
        vErrors.push(err6);
      }
      errors++;
    }
    if (data.candidate_root === void 0) {
      const err7 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "candidate_root" }, message: "must have required property 'candidate_root'" };
      if (vErrors === null) {
        vErrors = [err7];
      } else {
        vErrors.push(err7);
      }
      errors++;
    }
    if (data.status === void 0) {
      const err8 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "status" }, message: "must have required property 'status'" };
      if (vErrors === null) {
        vErrors = [err8];
      } else {
        vErrors.push(err8);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func1.call(schema94.properties, key0)) {
        const err9 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.schema_version !== void 0) {
      if ("cc-master/skill-knowledge-workspace/v1alpha1" !== data.schema_version) {
        const err10 = { instancePath: instancePath + "/schema_version", schemaPath: "#/properties/schema_version/const", keyword: "const", params: { allowedValue: "cc-master/skill-knowledge-workspace/v1alpha1" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
    }
    if (data.kind !== void 0) {
      if ("change_workspace" !== data.kind) {
        const err11 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "change_workspace" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.change_id !== void 0) {
      let data2 = data.change_id;
      if (typeof data2 === "string") {
        if (!pattern4.test(data2)) {
          const err12 = { instancePath: instancePath + "/change_id", schemaPath: "#/$defs/changeId/pattern", keyword: "pattern", params: { pattern: "^change:[0-9]{8}\\.[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^change:[0-9]{8}\\.[a-z0-9][a-z0-9.-]*$"' };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
      } else {
        const err13 = { instancePath: instancePath + "/change_id", schemaPath: "#/$defs/changeId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
    if (data.operation !== void 0) {
      let data3 = data.operation;
      if (!(data3 === "add" || data3 === "wording" || data3 === "refine" || data3 === "move" || data3 === "split" || data3 === "merge" || data3 === "transfer_owner" || data3 === "deprecate" || data3 === "retire")) {
        const err14 = { instancePath: instancePath + "/operation", schemaPath: "#/$defs/operationType/enum", keyword: "enum", params: { allowedValues: schema96.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
    }
    if (data.base_ref !== void 0) {
      let data4 = data.base_ref;
      if (typeof data4 === "string") {
        if (func2(data4) < 1) {
          const err15 = { instancePath: instancePath + "/base_ref", schemaPath: "#/$defs/gitRef/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
        if (!pattern5.test(data4)) {
          const err16 = { instancePath: instancePath + "/base_ref", schemaPath: "#/$defs/gitRef/pattern", keyword: "pattern", params: { pattern: "^[^\\s\\u0000]+$" }, message: 'must match pattern "^[^\\s\\u0000]+$"' };
          if (vErrors === null) {
            vErrors = [err16];
          } else {
            vErrors.push(err16);
          }
          errors++;
        }
      } else {
        const err17 = { instancePath: instancePath + "/base_ref", schemaPath: "#/$defs/gitRef/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
    }
    if (data.base_graph_sha256 !== void 0) {
      let data5 = data.base_graph_sha256;
      if (typeof data5 === "string") {
        if (!pattern6.test(data5)) {
          const err18 = { instancePath: instancePath + "/base_graph_sha256", schemaPath: "#/$defs/sha256/pattern", keyword: "pattern", params: { pattern: "^[a-f0-9]{64}$" }, message: 'must match pattern "^[a-f0-9]{64}$"' };
          if (vErrors === null) {
            vErrors = [err18];
          } else {
            vErrors.push(err18);
          }
          errors++;
        }
      } else {
        const err19 = { instancePath: instancePath + "/base_graph_sha256", schemaPath: "#/$defs/sha256/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err19];
        } else {
          vErrors.push(err19);
        }
        errors++;
      }
    }
    if (data.scope !== void 0) {
      let data6 = data.scope;
      if (Array.isArray(data6)) {
        if (data6.length < 1) {
          const err20 = { instancePath: instancePath + "/scope", schemaPath: "#/properties/scope/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          if (vErrors === null) {
            vErrors = [err20];
          } else {
            vErrors.push(err20);
          }
          errors++;
        }
        const len0 = data6.length;
        for (let i0 = 0; i0 < len0; i0++) {
          if (!validate72(data6[i0], { instancePath: instancePath + "/scope/" + i0, parentData: data6, parentDataProperty: i0, rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err21 = { instancePath: instancePath + "/scope", schemaPath: "#/properties/scope/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err21];
        } else {
          vErrors.push(err21);
        }
        errors++;
      }
    }
    if (data.candidate_root !== void 0) {
      let data8 = data.candidate_root;
      if (typeof data8 === "string") {
        if (!pattern10.test(data8)) {
          const err22 = { instancePath: instancePath + "/candidate_root", schemaPath: "#/$defs/repoScopePath/pattern", keyword: "pattern", params: { pattern: "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))[A-Za-z0-9._/-]+$" }, message: 'must match pattern "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))[A-Za-z0-9._/-]+$"' };
          if (vErrors === null) {
            vErrors = [err22];
          } else {
            vErrors.push(err22);
          }
          errors++;
        }
      } else {
        const err23 = { instancePath: instancePath + "/candidate_root", schemaPath: "#/$defs/repoScopePath/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err23];
        } else {
          vErrors.push(err23);
        }
        errors++;
      }
    }
    if (data.status !== void 0) {
      let data9 = data.status;
      if (!(data9 === "begun" || data9 === "validated" || data9 === "applied")) {
        const err24 = { instancePath: instancePath + "/status", schemaPath: "#/properties/status/enum", keyword: "enum", params: { allowedValues: schema94.properties.status.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err24];
        } else {
          vErrors.push(err24);
        }
        errors++;
      }
    }
  } else {
    const err25 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err25];
    } else {
      vErrors.push(err25);
    }
    errors++;
  }
  validate71.errors = vErrors;
  return errors === 0;
}
validate71.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var schema103 = { "type": "object", "additionalProperties": false, "required": ["schema_version", "kind", "change_id", "base_ref", "base_graph_sha256", "scope", "result_graph_sha256", "candidate_valid", "candidate_runtime_valid", "optimistic_lock_valid", "git_apply_check", "patch_sha256", "host_projection_witnesses", "diagnostics"], "properties": { "schema_version": { "const": "cc-master/skill-knowledge-validation/v1alpha1" }, "kind": { "const": "change_validation" }, "change_id": { "$ref": "#/$defs/changeId" }, "base_ref": { "$ref": "#/$defs/gitRef" }, "base_graph_sha256": { "$ref": "#/$defs/sha256" }, "scope": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/scopedFileHash" } }, "result_graph_sha256": { "$ref": "#/$defs/sha256" }, "candidate_valid": { "type": "boolean" }, "candidate_runtime_valid": { "type": "boolean" }, "optimistic_lock_valid": { "type": "boolean" }, "git_apply_check": { "type": "boolean" }, "patch_sha256": { "$ref": "#/$defs/sha256" }, "host_projection_witnesses": { "type": "array", "minItems": 4, "maxItems": 4, "prefixItems": [{ "allOf": [{ "$ref": "#/$defs/hostProjectionWitness" }, { "properties": { "host": { "const": "claude-code" } }, "required": ["host"] }] }, { "allOf": [{ "$ref": "#/$defs/hostProjectionWitness" }, { "properties": { "host": { "const": "codex" } }, "required": ["host"] }] }, { "allOf": [{ "$ref": "#/$defs/hostProjectionWitness" }, { "properties": { "host": { "const": "cursor" } }, "required": ["host"] }] }, { "allOf": [{ "$ref": "#/$defs/hostProjectionWitness" }, { "properties": { "host": { "const": "kimi-code" } }, "required": ["host"] }] }], "items": false }, "diagnostics": { "type": "array", "items": { "$ref": "#/$defs/workspaceDiagnostic" } } } };
var schema109 = { "type": "object", "additionalProperties": false, "required": ["host", "ok", "mode", "artifacts", "enabled_edges", "point_anchors", "hop_report", "budgets", "executed_checks", "conditional_route_policy", "result_graph_sha256"], "properties": { "host": { "type": "string", "enum": ["claude-code", "codex", "cursor", "kimi-code"] }, "ok": { "type": "boolean" }, "mode": { "type": "string", "enum": ["full", "partial", "stub", "unsupported"] }, "artifacts": { "type": "array", "items": { "type": "object", "additionalProperties": false, "required": ["path", "bytes"], "properties": { "path": { "type": "string", "minLength": 1 }, "bytes": { "type": "integer", "minimum": 0 } } } }, "enabled_edges": { "type": "integer", "minimum": 0 }, "point_anchors": { "type": "integer", "minimum": 0 }, "hop_report": { "type": "object", "additionalProperties": false, "required": ["H1", "H2", "H3", "H4"], "properties": { "H1": { "$ref": "#/$defs/hopGate" }, "H2": { "$ref": "#/$defs/hopGate" }, "H3": { "$ref": "#/$defs/hopGate" }, "H4": { "$ref": "#/$defs/hopGate" } } }, "budgets": { "type": "object" }, "executed_checks": { "type": "array", "items": { "type": "string", "minLength": 1 }, "uniqueItems": true }, "conditional_route_policy": { "type": "string", "enum": ["enabled_by_default-only", "abstained"] }, "result_graph_sha256": { "$ref": "#/$defs/sha256" }, "final_surface_snapshot": { "type": "object", "additionalProperties": false, "required": ["host", "mode", "final_root", "fileset_manifest", "fileset", "skills", "modules", "points", "edges", "entries", "enabled_edge_ids", "enabled_adjacency"], "properties": { "host": { "type": "string", "minLength": 1 }, "mode": { "type": "string", "enum": ["full", "partial"] }, "final_root": { "type": "string", "minLength": 1 }, "fileset_manifest": { "type": "array", "items": { "type": "string", "minLength": 1 } }, "fileset": { "type": "array", "minItems": 1, "items": { "type": "object", "additionalProperties": false, "required": ["path", "kind"], "properties": { "path": { "type": "string", "minLength": 1 }, "kind": { "type": "string", "enum": ["file", "dir", "symlink"] }, "bytes": { "type": "integer", "minimum": 0 }, "sha256": { "$ref": "#/$defs/sha256" } }, "allOf": [{ "if": { "properties": { "kind": { "const": "file" } }, "required": ["kind"] }, "then": { "required": ["bytes", "sha256"] } }] } }, "skills": { "type": "array" }, "modules": { "type": "array" }, "points": { "type": "array" }, "edges": { "type": "array" }, "entries": { "type": "array" }, "enabled_edge_ids": { "type": "array", "items": { "type": "string", "minLength": 1 } }, "enabled_adjacency": { "type": "object" } } } }, "allOf": [{ "if": { "properties": { "mode": { "enum": ["stub", "unsupported"] } }, "required": ["mode"] }, "then": { "properties": { "artifacts": { "maxItems": 0 }, "enabled_edges": { "const": 0 }, "point_anchors": { "const": 0 }, "conditional_route_policy": { "const": "abstained" }, "final_surface_snapshot": false, "hop_report": { "type": "object", "additionalProperties": false, "required": ["H1", "H2", "H3", "H4"], "properties": { "H1": { "$ref": "#/$defs/abstainedHopGate" }, "H2": { "$ref": "#/$defs/abstainedHopGate" }, "H3": { "$ref": "#/$defs/abstainedHopGate" }, "H4": { "$ref": "#/$defs/abstainedHopGate" } } } } } }, { "if": { "properties": { "mode": { "enum": ["full", "partial"] }, "ok": { "const": true } }, "required": ["mode", "ok"] }, "then": { "required": ["final_surface_snapshot"], "properties": { "conditional_route_policy": { "const": "enabled_by_default-only" }, "budgets": { "type": "object", "minProperties": 1 }, "executed_checks": { "type": "array", "allOf": [{ "contains": { "const": "candidate_runtime_sync" } }, { "contains": { "const": "candidate_runtime_verify" } }] }, "hop_report": { "type": "object", "additionalProperties": false, "required": ["H1", "H2", "H3", "H4"], "properties": { "H1": { "$ref": "#/$defs/executedSuccessHopGate" }, "H2": { "$ref": "#/$defs/executedSuccessHopGate" }, "H3": { "$ref": "#/$defs/executedSuccessHopGate" }, "H4": { "$ref": "#/$defs/executedSuccessHopGate" } } } } } }, { "if": { "properties": { "mode": { "enum": ["full", "partial"] }, "ok": { "const": false } }, "required": ["mode", "ok"] }, "then": { "properties": { "conditional_route_policy": { "const": "enabled_by_default-only" }, "final_surface_snapshot": false } } }] };
function validate77(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate77.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  const _errs2 = errors;
  let valid1 = true;
  const _errs3 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    let missing0;
    if (data.mode === void 0 && (missing0 = "mode")) {
      const err0 = {};
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    } else {
      if (data.mode !== void 0) {
        let data0 = data.mode;
        if (!(data0 === "stub" || data0 === "unsupported")) {
          const err1 = {};
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
      }
    }
  }
  var _valid0 = _errs3 === errors;
  errors = _errs2;
  if (vErrors !== null) {
    if (_errs2) {
      vErrors.length = _errs2;
    } else {
      vErrors = null;
    }
  }
  if (_valid0) {
    const _errs5 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.artifacts !== void 0) {
        let data1 = data.artifacts;
        if (Array.isArray(data1)) {
          if (data1.length > 0) {
            const err2 = { instancePath: instancePath + "/artifacts", schemaPath: "#/allOf/0/then/properties/artifacts/maxItems", keyword: "maxItems", params: { limit: 0 }, message: "must NOT have more than 0 items" };
            if (vErrors === null) {
              vErrors = [err2];
            } else {
              vErrors.push(err2);
            }
            errors++;
          }
        }
      }
      if (data.enabled_edges !== void 0) {
        if (0 !== data.enabled_edges) {
          const err3 = { instancePath: instancePath + "/enabled_edges", schemaPath: "#/allOf/0/then/properties/enabled_edges/const", keyword: "const", params: { allowedValue: 0 }, message: "must be equal to constant" };
          if (vErrors === null) {
            vErrors = [err3];
          } else {
            vErrors.push(err3);
          }
          errors++;
        }
      }
      if (data.point_anchors !== void 0) {
        if (0 !== data.point_anchors) {
          const err4 = { instancePath: instancePath + "/point_anchors", schemaPath: "#/allOf/0/then/properties/point_anchors/const", keyword: "const", params: { allowedValue: 0 }, message: "must be equal to constant" };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
      }
      if (data.conditional_route_policy !== void 0) {
        if ("abstained" !== data.conditional_route_policy) {
          const err5 = { instancePath: instancePath + "/conditional_route_policy", schemaPath: "#/allOf/0/then/properties/conditional_route_policy/const", keyword: "const", params: { allowedValue: "abstained" }, message: "must be equal to constant" };
          if (vErrors === null) {
            vErrors = [err5];
          } else {
            vErrors.push(err5);
          }
          errors++;
        }
      }
      if (data.final_surface_snapshot !== void 0) {
        const err6 = { instancePath: instancePath + "/final_surface_snapshot", schemaPath: "#/allOf/0/then/properties/final_surface_snapshot/false schema", keyword: "false schema", params: {}, message: "boolean schema is false" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
      if (data.hop_report !== void 0) {
        let data6 = data.hop_report;
        if (data6 && typeof data6 == "object" && !Array.isArray(data6)) {
          if (data6.H1 === void 0) {
            const err7 = { instancePath: instancePath + "/hop_report", schemaPath: "#/allOf/0/then/properties/hop_report/required", keyword: "required", params: { missingProperty: "H1" }, message: "must have required property 'H1'" };
            if (vErrors === null) {
              vErrors = [err7];
            } else {
              vErrors.push(err7);
            }
            errors++;
          }
          if (data6.H2 === void 0) {
            const err8 = { instancePath: instancePath + "/hop_report", schemaPath: "#/allOf/0/then/properties/hop_report/required", keyword: "required", params: { missingProperty: "H2" }, message: "must have required property 'H2'" };
            if (vErrors === null) {
              vErrors = [err8];
            } else {
              vErrors.push(err8);
            }
            errors++;
          }
          if (data6.H3 === void 0) {
            const err9 = { instancePath: instancePath + "/hop_report", schemaPath: "#/allOf/0/then/properties/hop_report/required", keyword: "required", params: { missingProperty: "H3" }, message: "must have required property 'H3'" };
            if (vErrors === null) {
              vErrors = [err9];
            } else {
              vErrors.push(err9);
            }
            errors++;
          }
          if (data6.H4 === void 0) {
            const err10 = { instancePath: instancePath + "/hop_report", schemaPath: "#/allOf/0/then/properties/hop_report/required", keyword: "required", params: { missingProperty: "H4" }, message: "must have required property 'H4'" };
            if (vErrors === null) {
              vErrors = [err10];
            } else {
              vErrors.push(err10);
            }
            errors++;
          }
          for (const key0 in data6) {
            if (!(key0 === "H1" || key0 === "H2" || key0 === "H3" || key0 === "H4")) {
              const err11 = { instancePath: instancePath + "/hop_report", schemaPath: "#/allOf/0/then/properties/hop_report/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
              if (vErrors === null) {
                vErrors = [err11];
              } else {
                vErrors.push(err11);
              }
              errors++;
            }
          }
          if (data6.H1 !== void 0) {
            let data7 = data6.H1;
            if (data7 && typeof data7 == "object" && !Array.isArray(data7)) {
              if (data7.ok === void 0) {
                const err12 = { instancePath: instancePath + "/hop_report/H1", schemaPath: "#/$defs/abstainedHopGate/required", keyword: "required", params: { missingProperty: "ok" }, message: "must have required property 'ok'" };
                if (vErrors === null) {
                  vErrors = [err12];
                } else {
                  vErrors.push(err12);
                }
                errors++;
              }
              if (data7.witness === void 0) {
                const err13 = { instancePath: instancePath + "/hop_report/H1", schemaPath: "#/$defs/abstainedHopGate/required", keyword: "required", params: { missingProperty: "witness" }, message: "must have required property 'witness'" };
                if (vErrors === null) {
                  vErrors = [err13];
                } else {
                  vErrors.push(err13);
                }
                errors++;
              }
              if (data7.remediation === void 0) {
                const err14 = { instancePath: instancePath + "/hop_report/H1", schemaPath: "#/$defs/abstainedHopGate/required", keyword: "required", params: { missingProperty: "remediation" }, message: "must have required property 'remediation'" };
                if (vErrors === null) {
                  vErrors = [err14];
                } else {
                  vErrors.push(err14);
                }
                errors++;
              }
              for (const key1 in data7) {
                if (!(key1 === "ok" || key1 === "witness" || key1 === "remediation")) {
                  const err15 = { instancePath: instancePath + "/hop_report/H1", schemaPath: "#/$defs/abstainedHopGate/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
                  if (vErrors === null) {
                    vErrors = [err15];
                  } else {
                    vErrors.push(err15);
                  }
                  errors++;
                }
              }
              if (data7.ok !== void 0) {
                if (true !== data7.ok) {
                  const err16 = { instancePath: instancePath + "/hop_report/H1/ok", schemaPath: "#/$defs/abstainedHopGate/properties/ok/const", keyword: "const", params: { allowedValue: true }, message: "must be equal to constant" };
                  if (vErrors === null) {
                    vErrors = [err16];
                  } else {
                    vErrors.push(err16);
                  }
                  errors++;
                }
              }
              if (data7.witness !== void 0) {
                let data9 = data7.witness;
                if (data9 && typeof data9 == "object" && !Array.isArray(data9)) {
                  if (data9.abstained === void 0) {
                    const err17 = { instancePath: instancePath + "/hop_report/H1/witness", schemaPath: "#/$defs/abstainedHopGate/properties/witness/required", keyword: "required", params: { missingProperty: "abstained" }, message: "must have required property 'abstained'" };
                    if (vErrors === null) {
                      vErrors = [err17];
                    } else {
                      vErrors.push(err17);
                    }
                    errors++;
                  }
                  if (data9.abstained !== void 0) {
                    if (true !== data9.abstained) {
                      const err18 = { instancePath: instancePath + "/hop_report/H1/witness/abstained", schemaPath: "#/$defs/abstainedHopGate/properties/witness/properties/abstained/const", keyword: "const", params: { allowedValue: true }, message: "must be equal to constant" };
                      if (vErrors === null) {
                        vErrors = [err18];
                      } else {
                        vErrors.push(err18);
                      }
                      errors++;
                    }
                  }
                } else {
                  const err19 = { instancePath: instancePath + "/hop_report/H1/witness", schemaPath: "#/$defs/abstainedHopGate/properties/witness/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                  if (vErrors === null) {
                    vErrors = [err19];
                  } else {
                    vErrors.push(err19);
                  }
                  errors++;
                }
              }
              if (data7.remediation !== void 0) {
                let data11 = data7.remediation;
                if (typeof data11 === "string") {
                  if (func2(data11) < 1) {
                    const err20 = { instancePath: instancePath + "/hop_report/H1/remediation", schemaPath: "#/$defs/abstainedHopGate/properties/remediation/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                    if (vErrors === null) {
                      vErrors = [err20];
                    } else {
                      vErrors.push(err20);
                    }
                    errors++;
                  }
                } else {
                  const err21 = { instancePath: instancePath + "/hop_report/H1/remediation", schemaPath: "#/$defs/abstainedHopGate/properties/remediation/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                  if (vErrors === null) {
                    vErrors = [err21];
                  } else {
                    vErrors.push(err21);
                  }
                  errors++;
                }
              }
            } else {
              const err22 = { instancePath: instancePath + "/hop_report/H1", schemaPath: "#/$defs/abstainedHopGate/type", keyword: "type", params: { type: "object" }, message: "must be object" };
              if (vErrors === null) {
                vErrors = [err22];
              } else {
                vErrors.push(err22);
              }
              errors++;
            }
          }
          if (data6.H2 !== void 0) {
            let data12 = data6.H2;
            if (data12 && typeof data12 == "object" && !Array.isArray(data12)) {
              if (data12.ok === void 0) {
                const err23 = { instancePath: instancePath + "/hop_report/H2", schemaPath: "#/$defs/abstainedHopGate/required", keyword: "required", params: { missingProperty: "ok" }, message: "must have required property 'ok'" };
                if (vErrors === null) {
                  vErrors = [err23];
                } else {
                  vErrors.push(err23);
                }
                errors++;
              }
              if (data12.witness === void 0) {
                const err24 = { instancePath: instancePath + "/hop_report/H2", schemaPath: "#/$defs/abstainedHopGate/required", keyword: "required", params: { missingProperty: "witness" }, message: "must have required property 'witness'" };
                if (vErrors === null) {
                  vErrors = [err24];
                } else {
                  vErrors.push(err24);
                }
                errors++;
              }
              if (data12.remediation === void 0) {
                const err25 = { instancePath: instancePath + "/hop_report/H2", schemaPath: "#/$defs/abstainedHopGate/required", keyword: "required", params: { missingProperty: "remediation" }, message: "must have required property 'remediation'" };
                if (vErrors === null) {
                  vErrors = [err25];
                } else {
                  vErrors.push(err25);
                }
                errors++;
              }
              for (const key2 in data12) {
                if (!(key2 === "ok" || key2 === "witness" || key2 === "remediation")) {
                  const err26 = { instancePath: instancePath + "/hop_report/H2", schemaPath: "#/$defs/abstainedHopGate/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
                  if (vErrors === null) {
                    vErrors = [err26];
                  } else {
                    vErrors.push(err26);
                  }
                  errors++;
                }
              }
              if (data12.ok !== void 0) {
                if (true !== data12.ok) {
                  const err27 = { instancePath: instancePath + "/hop_report/H2/ok", schemaPath: "#/$defs/abstainedHopGate/properties/ok/const", keyword: "const", params: { allowedValue: true }, message: "must be equal to constant" };
                  if (vErrors === null) {
                    vErrors = [err27];
                  } else {
                    vErrors.push(err27);
                  }
                  errors++;
                }
              }
              if (data12.witness !== void 0) {
                let data14 = data12.witness;
                if (data14 && typeof data14 == "object" && !Array.isArray(data14)) {
                  if (data14.abstained === void 0) {
                    const err28 = { instancePath: instancePath + "/hop_report/H2/witness", schemaPath: "#/$defs/abstainedHopGate/properties/witness/required", keyword: "required", params: { missingProperty: "abstained" }, message: "must have required property 'abstained'" };
                    if (vErrors === null) {
                      vErrors = [err28];
                    } else {
                      vErrors.push(err28);
                    }
                    errors++;
                  }
                  if (data14.abstained !== void 0) {
                    if (true !== data14.abstained) {
                      const err29 = { instancePath: instancePath + "/hop_report/H2/witness/abstained", schemaPath: "#/$defs/abstainedHopGate/properties/witness/properties/abstained/const", keyword: "const", params: { allowedValue: true }, message: "must be equal to constant" };
                      if (vErrors === null) {
                        vErrors = [err29];
                      } else {
                        vErrors.push(err29);
                      }
                      errors++;
                    }
                  }
                } else {
                  const err30 = { instancePath: instancePath + "/hop_report/H2/witness", schemaPath: "#/$defs/abstainedHopGate/properties/witness/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                  if (vErrors === null) {
                    vErrors = [err30];
                  } else {
                    vErrors.push(err30);
                  }
                  errors++;
                }
              }
              if (data12.remediation !== void 0) {
                let data16 = data12.remediation;
                if (typeof data16 === "string") {
                  if (func2(data16) < 1) {
                    const err31 = { instancePath: instancePath + "/hop_report/H2/remediation", schemaPath: "#/$defs/abstainedHopGate/properties/remediation/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                    if (vErrors === null) {
                      vErrors = [err31];
                    } else {
                      vErrors.push(err31);
                    }
                    errors++;
                  }
                } else {
                  const err32 = { instancePath: instancePath + "/hop_report/H2/remediation", schemaPath: "#/$defs/abstainedHopGate/properties/remediation/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                  if (vErrors === null) {
                    vErrors = [err32];
                  } else {
                    vErrors.push(err32);
                  }
                  errors++;
                }
              }
            } else {
              const err33 = { instancePath: instancePath + "/hop_report/H2", schemaPath: "#/$defs/abstainedHopGate/type", keyword: "type", params: { type: "object" }, message: "must be object" };
              if (vErrors === null) {
                vErrors = [err33];
              } else {
                vErrors.push(err33);
              }
              errors++;
            }
          }
          if (data6.H3 !== void 0) {
            let data17 = data6.H3;
            if (data17 && typeof data17 == "object" && !Array.isArray(data17)) {
              if (data17.ok === void 0) {
                const err34 = { instancePath: instancePath + "/hop_report/H3", schemaPath: "#/$defs/abstainedHopGate/required", keyword: "required", params: { missingProperty: "ok" }, message: "must have required property 'ok'" };
                if (vErrors === null) {
                  vErrors = [err34];
                } else {
                  vErrors.push(err34);
                }
                errors++;
              }
              if (data17.witness === void 0) {
                const err35 = { instancePath: instancePath + "/hop_report/H3", schemaPath: "#/$defs/abstainedHopGate/required", keyword: "required", params: { missingProperty: "witness" }, message: "must have required property 'witness'" };
                if (vErrors === null) {
                  vErrors = [err35];
                } else {
                  vErrors.push(err35);
                }
                errors++;
              }
              if (data17.remediation === void 0) {
                const err36 = { instancePath: instancePath + "/hop_report/H3", schemaPath: "#/$defs/abstainedHopGate/required", keyword: "required", params: { missingProperty: "remediation" }, message: "must have required property 'remediation'" };
                if (vErrors === null) {
                  vErrors = [err36];
                } else {
                  vErrors.push(err36);
                }
                errors++;
              }
              for (const key3 in data17) {
                if (!(key3 === "ok" || key3 === "witness" || key3 === "remediation")) {
                  const err37 = { instancePath: instancePath + "/hop_report/H3", schemaPath: "#/$defs/abstainedHopGate/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" };
                  if (vErrors === null) {
                    vErrors = [err37];
                  } else {
                    vErrors.push(err37);
                  }
                  errors++;
                }
              }
              if (data17.ok !== void 0) {
                if (true !== data17.ok) {
                  const err38 = { instancePath: instancePath + "/hop_report/H3/ok", schemaPath: "#/$defs/abstainedHopGate/properties/ok/const", keyword: "const", params: { allowedValue: true }, message: "must be equal to constant" };
                  if (vErrors === null) {
                    vErrors = [err38];
                  } else {
                    vErrors.push(err38);
                  }
                  errors++;
                }
              }
              if (data17.witness !== void 0) {
                let data19 = data17.witness;
                if (data19 && typeof data19 == "object" && !Array.isArray(data19)) {
                  if (data19.abstained === void 0) {
                    const err39 = { instancePath: instancePath + "/hop_report/H3/witness", schemaPath: "#/$defs/abstainedHopGate/properties/witness/required", keyword: "required", params: { missingProperty: "abstained" }, message: "must have required property 'abstained'" };
                    if (vErrors === null) {
                      vErrors = [err39];
                    } else {
                      vErrors.push(err39);
                    }
                    errors++;
                  }
                  if (data19.abstained !== void 0) {
                    if (true !== data19.abstained) {
                      const err40 = { instancePath: instancePath + "/hop_report/H3/witness/abstained", schemaPath: "#/$defs/abstainedHopGate/properties/witness/properties/abstained/const", keyword: "const", params: { allowedValue: true }, message: "must be equal to constant" };
                      if (vErrors === null) {
                        vErrors = [err40];
                      } else {
                        vErrors.push(err40);
                      }
                      errors++;
                    }
                  }
                } else {
                  const err41 = { instancePath: instancePath + "/hop_report/H3/witness", schemaPath: "#/$defs/abstainedHopGate/properties/witness/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                  if (vErrors === null) {
                    vErrors = [err41];
                  } else {
                    vErrors.push(err41);
                  }
                  errors++;
                }
              }
              if (data17.remediation !== void 0) {
                let data21 = data17.remediation;
                if (typeof data21 === "string") {
                  if (func2(data21) < 1) {
                    const err42 = { instancePath: instancePath + "/hop_report/H3/remediation", schemaPath: "#/$defs/abstainedHopGate/properties/remediation/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                    if (vErrors === null) {
                      vErrors = [err42];
                    } else {
                      vErrors.push(err42);
                    }
                    errors++;
                  }
                } else {
                  const err43 = { instancePath: instancePath + "/hop_report/H3/remediation", schemaPath: "#/$defs/abstainedHopGate/properties/remediation/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                  if (vErrors === null) {
                    vErrors = [err43];
                  } else {
                    vErrors.push(err43);
                  }
                  errors++;
                }
              }
            } else {
              const err44 = { instancePath: instancePath + "/hop_report/H3", schemaPath: "#/$defs/abstainedHopGate/type", keyword: "type", params: { type: "object" }, message: "must be object" };
              if (vErrors === null) {
                vErrors = [err44];
              } else {
                vErrors.push(err44);
              }
              errors++;
            }
          }
          if (data6.H4 !== void 0) {
            let data22 = data6.H4;
            if (data22 && typeof data22 == "object" && !Array.isArray(data22)) {
              if (data22.ok === void 0) {
                const err45 = { instancePath: instancePath + "/hop_report/H4", schemaPath: "#/$defs/abstainedHopGate/required", keyword: "required", params: { missingProperty: "ok" }, message: "must have required property 'ok'" };
                if (vErrors === null) {
                  vErrors = [err45];
                } else {
                  vErrors.push(err45);
                }
                errors++;
              }
              if (data22.witness === void 0) {
                const err46 = { instancePath: instancePath + "/hop_report/H4", schemaPath: "#/$defs/abstainedHopGate/required", keyword: "required", params: { missingProperty: "witness" }, message: "must have required property 'witness'" };
                if (vErrors === null) {
                  vErrors = [err46];
                } else {
                  vErrors.push(err46);
                }
                errors++;
              }
              if (data22.remediation === void 0) {
                const err47 = { instancePath: instancePath + "/hop_report/H4", schemaPath: "#/$defs/abstainedHopGate/required", keyword: "required", params: { missingProperty: "remediation" }, message: "must have required property 'remediation'" };
                if (vErrors === null) {
                  vErrors = [err47];
                } else {
                  vErrors.push(err47);
                }
                errors++;
              }
              for (const key4 in data22) {
                if (!(key4 === "ok" || key4 === "witness" || key4 === "remediation")) {
                  const err48 = { instancePath: instancePath + "/hop_report/H4", schemaPath: "#/$defs/abstainedHopGate/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key4 }, message: "must NOT have additional properties" };
                  if (vErrors === null) {
                    vErrors = [err48];
                  } else {
                    vErrors.push(err48);
                  }
                  errors++;
                }
              }
              if (data22.ok !== void 0) {
                if (true !== data22.ok) {
                  const err49 = { instancePath: instancePath + "/hop_report/H4/ok", schemaPath: "#/$defs/abstainedHopGate/properties/ok/const", keyword: "const", params: { allowedValue: true }, message: "must be equal to constant" };
                  if (vErrors === null) {
                    vErrors = [err49];
                  } else {
                    vErrors.push(err49);
                  }
                  errors++;
                }
              }
              if (data22.witness !== void 0) {
                let data24 = data22.witness;
                if (data24 && typeof data24 == "object" && !Array.isArray(data24)) {
                  if (data24.abstained === void 0) {
                    const err50 = { instancePath: instancePath + "/hop_report/H4/witness", schemaPath: "#/$defs/abstainedHopGate/properties/witness/required", keyword: "required", params: { missingProperty: "abstained" }, message: "must have required property 'abstained'" };
                    if (vErrors === null) {
                      vErrors = [err50];
                    } else {
                      vErrors.push(err50);
                    }
                    errors++;
                  }
                  if (data24.abstained !== void 0) {
                    if (true !== data24.abstained) {
                      const err51 = { instancePath: instancePath + "/hop_report/H4/witness/abstained", schemaPath: "#/$defs/abstainedHopGate/properties/witness/properties/abstained/const", keyword: "const", params: { allowedValue: true }, message: "must be equal to constant" };
                      if (vErrors === null) {
                        vErrors = [err51];
                      } else {
                        vErrors.push(err51);
                      }
                      errors++;
                    }
                  }
                } else {
                  const err52 = { instancePath: instancePath + "/hop_report/H4/witness", schemaPath: "#/$defs/abstainedHopGate/properties/witness/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                  if (vErrors === null) {
                    vErrors = [err52];
                  } else {
                    vErrors.push(err52);
                  }
                  errors++;
                }
              }
              if (data22.remediation !== void 0) {
                let data26 = data22.remediation;
                if (typeof data26 === "string") {
                  if (func2(data26) < 1) {
                    const err53 = { instancePath: instancePath + "/hop_report/H4/remediation", schemaPath: "#/$defs/abstainedHopGate/properties/remediation/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                    if (vErrors === null) {
                      vErrors = [err53];
                    } else {
                      vErrors.push(err53);
                    }
                    errors++;
                  }
                } else {
                  const err54 = { instancePath: instancePath + "/hop_report/H4/remediation", schemaPath: "#/$defs/abstainedHopGate/properties/remediation/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                  if (vErrors === null) {
                    vErrors = [err54];
                  } else {
                    vErrors.push(err54);
                  }
                  errors++;
                }
              }
            } else {
              const err55 = { instancePath: instancePath + "/hop_report/H4", schemaPath: "#/$defs/abstainedHopGate/type", keyword: "type", params: { type: "object" }, message: "must be object" };
              if (vErrors === null) {
                vErrors = [err55];
              } else {
                vErrors.push(err55);
              }
              errors++;
            }
          }
        } else {
          const err56 = { instancePath: instancePath + "/hop_report", schemaPath: "#/allOf/0/then/properties/hop_report/type", keyword: "type", params: { type: "object" }, message: "must be object" };
          if (vErrors === null) {
            vErrors = [err56];
          } else {
            vErrors.push(err56);
          }
          errors++;
        }
      }
    }
    var _valid0 = _errs5 === errors;
    valid1 = _valid0;
    if (valid1) {
      var props0 = {};
      props0.artifacts = true;
      props0.enabled_edges = true;
      props0.point_anchors = true;
      props0.conditional_route_policy = true;
      props0.final_surface_snapshot = true;
      props0.hop_report = true;
      props0.mode = true;
    }
  }
  if (!valid1) {
    const err57 = { instancePath, schemaPath: "#/allOf/0/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err57];
    } else {
      vErrors.push(err57);
    }
    errors++;
  }
  const _errs54 = errors;
  let valid17 = true;
  const _errs55 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    let missing1;
    if (data.mode === void 0 && (missing1 = "mode") || data.ok === void 0 && (missing1 = "ok")) {
      const err58 = {};
      if (vErrors === null) {
        vErrors = [err58];
      } else {
        vErrors.push(err58);
      }
      errors++;
    } else {
      if (data.mode !== void 0) {
        let data27 = data.mode;
        const _errs56 = errors;
        if (!(data27 === "full" || data27 === "partial")) {
          const err59 = {};
          if (vErrors === null) {
            vErrors = [err59];
          } else {
            vErrors.push(err59);
          }
          errors++;
        }
        var valid18 = _errs56 === errors;
      } else {
        var valid18 = true;
      }
      if (valid18) {
        if (data.ok !== void 0) {
          const _errs57 = errors;
          if (true !== data.ok) {
            const err60 = {};
            if (vErrors === null) {
              vErrors = [err60];
            } else {
              vErrors.push(err60);
            }
            errors++;
          }
          var valid18 = _errs57 === errors;
        } else {
          var valid18 = true;
        }
      }
    }
  }
  var _valid1 = _errs55 === errors;
  errors = _errs54;
  if (vErrors !== null) {
    if (_errs54) {
      vErrors.length = _errs54;
    } else {
      vErrors = null;
    }
  }
  if (_valid1) {
    const _errs58 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.final_surface_snapshot === void 0) {
        const err61 = { instancePath, schemaPath: "#/allOf/1/then/required", keyword: "required", params: { missingProperty: "final_surface_snapshot" }, message: "must have required property 'final_surface_snapshot'" };
        if (vErrors === null) {
          vErrors = [err61];
        } else {
          vErrors.push(err61);
        }
        errors++;
      }
      if (data.conditional_route_policy !== void 0) {
        if ("enabled_by_default-only" !== data.conditional_route_policy) {
          const err62 = { instancePath: instancePath + "/conditional_route_policy", schemaPath: "#/allOf/1/then/properties/conditional_route_policy/const", keyword: "const", params: { allowedValue: "enabled_by_default-only" }, message: "must be equal to constant" };
          if (vErrors === null) {
            vErrors = [err62];
          } else {
            vErrors.push(err62);
          }
          errors++;
        }
      }
      if (data.budgets !== void 0) {
        let data30 = data.budgets;
        if (data30 && typeof data30 == "object" && !Array.isArray(data30)) {
          if (Object.keys(data30).length < 1) {
            const err63 = { instancePath: instancePath + "/budgets", schemaPath: "#/allOf/1/then/properties/budgets/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" };
            if (vErrors === null) {
              vErrors = [err63];
            } else {
              vErrors.push(err63);
            }
            errors++;
          }
        } else {
          const err64 = { instancePath: instancePath + "/budgets", schemaPath: "#/allOf/1/then/properties/budgets/type", keyword: "type", params: { type: "object" }, message: "must be object" };
          if (vErrors === null) {
            vErrors = [err64];
          } else {
            vErrors.push(err64);
          }
          errors++;
        }
      }
      if (data.executed_checks !== void 0) {
        let data31 = data.executed_checks;
        if (!Array.isArray(data31)) {
          const err65 = { instancePath: instancePath + "/executed_checks", schemaPath: "#/allOf/1/then/properties/executed_checks/type", keyword: "type", params: { type: "array" }, message: "must be array" };
          if (vErrors === null) {
            vErrors = [err65];
          } else {
            vErrors.push(err65);
          }
          errors++;
        }
        if (Array.isArray(data31)) {
          const _errs65 = errors;
          const len0 = data31.length;
          for (let i0 = 0; i0 < len0; i0++) {
            const _errs66 = errors;
            if ("candidate_runtime_sync" !== data31[i0]) {
              const err66 = { instancePath: instancePath + "/executed_checks/" + i0, schemaPath: "#/allOf/1/then/properties/executed_checks/allOf/0/contains/const", keyword: "const", params: { allowedValue: "candidate_runtime_sync" }, message: "must be equal to constant" };
              if (vErrors === null) {
                vErrors = [err66];
              } else {
                vErrors.push(err66);
              }
              errors++;
            }
            var valid21 = _errs66 === errors;
            if (valid21) {
              break;
            }
          }
          if (!valid21) {
            const err67 = { instancePath: instancePath + "/executed_checks", schemaPath: "#/allOf/1/then/properties/executed_checks/allOf/0/contains", keyword: "contains", params: { minContains: 1 }, message: "must contain at least 1 valid item(s)" };
            if (vErrors === null) {
              vErrors = [err67];
            } else {
              vErrors.push(err67);
            }
            errors++;
          } else {
            errors = _errs65;
            if (vErrors !== null) {
              if (_errs65) {
                vErrors.length = _errs65;
              } else {
                vErrors = null;
              }
            }
          }
        }
        if (Array.isArray(data31)) {
          const _errs68 = errors;
          const len1 = data31.length;
          for (let i1 = 0; i1 < len1; i1++) {
            const _errs69 = errors;
            if ("candidate_runtime_verify" !== data31[i1]) {
              const err68 = { instancePath: instancePath + "/executed_checks/" + i1, schemaPath: "#/allOf/1/then/properties/executed_checks/allOf/1/contains/const", keyword: "const", params: { allowedValue: "candidate_runtime_verify" }, message: "must be equal to constant" };
              if (vErrors === null) {
                vErrors = [err68];
              } else {
                vErrors.push(err68);
              }
              errors++;
            }
            var valid22 = _errs69 === errors;
            if (valid22) {
              break;
            }
          }
          if (!valid22) {
            const err69 = { instancePath: instancePath + "/executed_checks", schemaPath: "#/allOf/1/then/properties/executed_checks/allOf/1/contains", keyword: "contains", params: { minContains: 1 }, message: "must contain at least 1 valid item(s)" };
            if (vErrors === null) {
              vErrors = [err69];
            } else {
              vErrors.push(err69);
            }
            errors++;
          } else {
            errors = _errs68;
            if (vErrors !== null) {
              if (_errs68) {
                vErrors.length = _errs68;
              } else {
                vErrors = null;
              }
            }
          }
        }
      }
      if (data.hop_report !== void 0) {
        let data34 = data.hop_report;
        if (data34 && typeof data34 == "object" && !Array.isArray(data34)) {
          if (data34.H1 === void 0) {
            const err70 = { instancePath: instancePath + "/hop_report", schemaPath: "#/allOf/1/then/properties/hop_report/required", keyword: "required", params: { missingProperty: "H1" }, message: "must have required property 'H1'" };
            if (vErrors === null) {
              vErrors = [err70];
            } else {
              vErrors.push(err70);
            }
            errors++;
          }
          if (data34.H2 === void 0) {
            const err71 = { instancePath: instancePath + "/hop_report", schemaPath: "#/allOf/1/then/properties/hop_report/required", keyword: "required", params: { missingProperty: "H2" }, message: "must have required property 'H2'" };
            if (vErrors === null) {
              vErrors = [err71];
            } else {
              vErrors.push(err71);
            }
            errors++;
          }
          if (data34.H3 === void 0) {
            const err72 = { instancePath: instancePath + "/hop_report", schemaPath: "#/allOf/1/then/properties/hop_report/required", keyword: "required", params: { missingProperty: "H3" }, message: "must have required property 'H3'" };
            if (vErrors === null) {
              vErrors = [err72];
            } else {
              vErrors.push(err72);
            }
            errors++;
          }
          if (data34.H4 === void 0) {
            const err73 = { instancePath: instancePath + "/hop_report", schemaPath: "#/allOf/1/then/properties/hop_report/required", keyword: "required", params: { missingProperty: "H4" }, message: "must have required property 'H4'" };
            if (vErrors === null) {
              vErrors = [err73];
            } else {
              vErrors.push(err73);
            }
            errors++;
          }
          for (const key5 in data34) {
            if (!(key5 === "H1" || key5 === "H2" || key5 === "H3" || key5 === "H4")) {
              const err74 = { instancePath: instancePath + "/hop_report", schemaPath: "#/allOf/1/then/properties/hop_report/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key5 }, message: "must NOT have additional properties" };
              if (vErrors === null) {
                vErrors = [err74];
              } else {
                vErrors.push(err74);
              }
              errors++;
            }
          }
          if (data34.H1 !== void 0) {
            let data35 = data34.H1;
            if (data35 && typeof data35 == "object" && !Array.isArray(data35)) {
              if (data35.ok === void 0) {
                const err75 = { instancePath: instancePath + "/hop_report/H1", schemaPath: "#/$defs/executedSuccessHopGate/required", keyword: "required", params: { missingProperty: "ok" }, message: "must have required property 'ok'" };
                if (vErrors === null) {
                  vErrors = [err75];
                } else {
                  vErrors.push(err75);
                }
                errors++;
              }
              if (data35.witness === void 0) {
                const err76 = { instancePath: instancePath + "/hop_report/H1", schemaPath: "#/$defs/executedSuccessHopGate/required", keyword: "required", params: { missingProperty: "witness" }, message: "must have required property 'witness'" };
                if (vErrors === null) {
                  vErrors = [err76];
                } else {
                  vErrors.push(err76);
                }
                errors++;
              }
              if (data35.remediation === void 0) {
                const err77 = { instancePath: instancePath + "/hop_report/H1", schemaPath: "#/$defs/executedSuccessHopGate/required", keyword: "required", params: { missingProperty: "remediation" }, message: "must have required property 'remediation'" };
                if (vErrors === null) {
                  vErrors = [err77];
                } else {
                  vErrors.push(err77);
                }
                errors++;
              }
              for (const key6 in data35) {
                if (!(key6 === "ok" || key6 === "witness" || key6 === "remediation")) {
                  const err78 = { instancePath: instancePath + "/hop_report/H1", schemaPath: "#/$defs/executedSuccessHopGate/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key6 }, message: "must NOT have additional properties" };
                  if (vErrors === null) {
                    vErrors = [err78];
                  } else {
                    vErrors.push(err78);
                  }
                  errors++;
                }
              }
              if (data35.ok !== void 0) {
                if (true !== data35.ok) {
                  const err79 = { instancePath: instancePath + "/hop_report/H1/ok", schemaPath: "#/$defs/executedSuccessHopGate/properties/ok/const", keyword: "const", params: { allowedValue: true }, message: "must be equal to constant" };
                  if (vErrors === null) {
                    vErrors = [err79];
                  } else {
                    vErrors.push(err79);
                  }
                  errors++;
                }
              }
              if (data35.witness !== void 0) {
                let data37 = data35.witness;
                if (data37 && typeof data37 == "object" && !Array.isArray(data37)) {
                  if (data37.abstained !== void 0) {
                    const _errs81 = errors;
                    const _errs82 = errors;
                    if (true !== data37.abstained) {
                      const err80 = {};
                      if (vErrors === null) {
                        vErrors = [err80];
                      } else {
                        vErrors.push(err80);
                      }
                      errors++;
                    }
                    var valid27 = _errs82 === errors;
                    if (valid27) {
                      const err81 = { instancePath: instancePath + "/hop_report/H1/witness/abstained", schemaPath: "#/$defs/executedSuccessHopGate/properties/witness/properties/abstained/not", keyword: "not", params: {}, message: "must NOT be valid" };
                      if (vErrors === null) {
                        vErrors = [err81];
                      } else {
                        vErrors.push(err81);
                      }
                      errors++;
                    } else {
                      errors = _errs81;
                      if (vErrors !== null) {
                        if (_errs81) {
                          vErrors.length = _errs81;
                        } else {
                          vErrors = null;
                        }
                      }
                    }
                  }
                  if (data37.skipped !== void 0) {
                    const _errs84 = errors;
                    const _errs85 = errors;
                    if (true !== data37.skipped) {
                      const err82 = {};
                      if (vErrors === null) {
                        vErrors = [err82];
                      } else {
                        vErrors.push(err82);
                      }
                      errors++;
                    }
                    var valid28 = _errs85 === errors;
                    if (valid28) {
                      const err83 = { instancePath: instancePath + "/hop_report/H1/witness/skipped", schemaPath: "#/$defs/executedSuccessHopGate/properties/witness/properties/skipped/not", keyword: "not", params: {}, message: "must NOT be valid" };
                      if (vErrors === null) {
                        vErrors = [err83];
                      } else {
                        vErrors.push(err83);
                      }
                      errors++;
                    } else {
                      errors = _errs84;
                      if (vErrors !== null) {
                        if (_errs84) {
                          vErrors.length = _errs84;
                        } else {
                          vErrors = null;
                        }
                      }
                    }
                  }
                } else {
                  const err84 = { instancePath: instancePath + "/hop_report/H1/witness", schemaPath: "#/$defs/executedSuccessHopGate/properties/witness/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                  if (vErrors === null) {
                    vErrors = [err84];
                  } else {
                    vErrors.push(err84);
                  }
                  errors++;
                }
              }
              if (data35.remediation !== void 0) {
                let data40 = data35.remediation;
                if (typeof data40 === "string") {
                  if (func2(data40) < 1) {
                    const err85 = { instancePath: instancePath + "/hop_report/H1/remediation", schemaPath: "#/$defs/executedSuccessHopGate/properties/remediation/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                    if (vErrors === null) {
                      vErrors = [err85];
                    } else {
                      vErrors.push(err85);
                    }
                    errors++;
                  }
                } else {
                  const err86 = { instancePath: instancePath + "/hop_report/H1/remediation", schemaPath: "#/$defs/executedSuccessHopGate/properties/remediation/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                  if (vErrors === null) {
                    vErrors = [err86];
                  } else {
                    vErrors.push(err86);
                  }
                  errors++;
                }
              }
            } else {
              const err87 = { instancePath: instancePath + "/hop_report/H1", schemaPath: "#/$defs/executedSuccessHopGate/type", keyword: "type", params: { type: "object" }, message: "must be object" };
              if (vErrors === null) {
                vErrors = [err87];
              } else {
                vErrors.push(err87);
              }
              errors++;
            }
          }
          if (data34.H2 !== void 0) {
            let data41 = data34.H2;
            if (data41 && typeof data41 == "object" && !Array.isArray(data41)) {
              if (data41.ok === void 0) {
                const err88 = { instancePath: instancePath + "/hop_report/H2", schemaPath: "#/$defs/executedSuccessHopGate/required", keyword: "required", params: { missingProperty: "ok" }, message: "must have required property 'ok'" };
                if (vErrors === null) {
                  vErrors = [err88];
                } else {
                  vErrors.push(err88);
                }
                errors++;
              }
              if (data41.witness === void 0) {
                const err89 = { instancePath: instancePath + "/hop_report/H2", schemaPath: "#/$defs/executedSuccessHopGate/required", keyword: "required", params: { missingProperty: "witness" }, message: "must have required property 'witness'" };
                if (vErrors === null) {
                  vErrors = [err89];
                } else {
                  vErrors.push(err89);
                }
                errors++;
              }
              if (data41.remediation === void 0) {
                const err90 = { instancePath: instancePath + "/hop_report/H2", schemaPath: "#/$defs/executedSuccessHopGate/required", keyword: "required", params: { missingProperty: "remediation" }, message: "must have required property 'remediation'" };
                if (vErrors === null) {
                  vErrors = [err90];
                } else {
                  vErrors.push(err90);
                }
                errors++;
              }
              for (const key7 in data41) {
                if (!(key7 === "ok" || key7 === "witness" || key7 === "remediation")) {
                  const err91 = { instancePath: instancePath + "/hop_report/H2", schemaPath: "#/$defs/executedSuccessHopGate/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key7 }, message: "must NOT have additional properties" };
                  if (vErrors === null) {
                    vErrors = [err91];
                  } else {
                    vErrors.push(err91);
                  }
                  errors++;
                }
              }
              if (data41.ok !== void 0) {
                if (true !== data41.ok) {
                  const err92 = { instancePath: instancePath + "/hop_report/H2/ok", schemaPath: "#/$defs/executedSuccessHopGate/properties/ok/const", keyword: "const", params: { allowedValue: true }, message: "must be equal to constant" };
                  if (vErrors === null) {
                    vErrors = [err92];
                  } else {
                    vErrors.push(err92);
                  }
                  errors++;
                }
              }
              if (data41.witness !== void 0) {
                let data43 = data41.witness;
                if (data43 && typeof data43 == "object" && !Array.isArray(data43)) {
                  if (data43.abstained !== void 0) {
                    const _errs96 = errors;
                    const _errs97 = errors;
                    if (true !== data43.abstained) {
                      const err93 = {};
                      if (vErrors === null) {
                        vErrors = [err93];
                      } else {
                        vErrors.push(err93);
                      }
                      errors++;
                    }
                    var valid32 = _errs97 === errors;
                    if (valid32) {
                      const err94 = { instancePath: instancePath + "/hop_report/H2/witness/abstained", schemaPath: "#/$defs/executedSuccessHopGate/properties/witness/properties/abstained/not", keyword: "not", params: {}, message: "must NOT be valid" };
                      if (vErrors === null) {
                        vErrors = [err94];
                      } else {
                        vErrors.push(err94);
                      }
                      errors++;
                    } else {
                      errors = _errs96;
                      if (vErrors !== null) {
                        if (_errs96) {
                          vErrors.length = _errs96;
                        } else {
                          vErrors = null;
                        }
                      }
                    }
                  }
                  if (data43.skipped !== void 0) {
                    const _errs99 = errors;
                    const _errs100 = errors;
                    if (true !== data43.skipped) {
                      const err95 = {};
                      if (vErrors === null) {
                        vErrors = [err95];
                      } else {
                        vErrors.push(err95);
                      }
                      errors++;
                    }
                    var valid33 = _errs100 === errors;
                    if (valid33) {
                      const err96 = { instancePath: instancePath + "/hop_report/H2/witness/skipped", schemaPath: "#/$defs/executedSuccessHopGate/properties/witness/properties/skipped/not", keyword: "not", params: {}, message: "must NOT be valid" };
                      if (vErrors === null) {
                        vErrors = [err96];
                      } else {
                        vErrors.push(err96);
                      }
                      errors++;
                    } else {
                      errors = _errs99;
                      if (vErrors !== null) {
                        if (_errs99) {
                          vErrors.length = _errs99;
                        } else {
                          vErrors = null;
                        }
                      }
                    }
                  }
                } else {
                  const err97 = { instancePath: instancePath + "/hop_report/H2/witness", schemaPath: "#/$defs/executedSuccessHopGate/properties/witness/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                  if (vErrors === null) {
                    vErrors = [err97];
                  } else {
                    vErrors.push(err97);
                  }
                  errors++;
                }
              }
              if (data41.remediation !== void 0) {
                let data46 = data41.remediation;
                if (typeof data46 === "string") {
                  if (func2(data46) < 1) {
                    const err98 = { instancePath: instancePath + "/hop_report/H2/remediation", schemaPath: "#/$defs/executedSuccessHopGate/properties/remediation/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                    if (vErrors === null) {
                      vErrors = [err98];
                    } else {
                      vErrors.push(err98);
                    }
                    errors++;
                  }
                } else {
                  const err99 = { instancePath: instancePath + "/hop_report/H2/remediation", schemaPath: "#/$defs/executedSuccessHopGate/properties/remediation/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                  if (vErrors === null) {
                    vErrors = [err99];
                  } else {
                    vErrors.push(err99);
                  }
                  errors++;
                }
              }
            } else {
              const err100 = { instancePath: instancePath + "/hop_report/H2", schemaPath: "#/$defs/executedSuccessHopGate/type", keyword: "type", params: { type: "object" }, message: "must be object" };
              if (vErrors === null) {
                vErrors = [err100];
              } else {
                vErrors.push(err100);
              }
              errors++;
            }
          }
          if (data34.H3 !== void 0) {
            let data47 = data34.H3;
            if (data47 && typeof data47 == "object" && !Array.isArray(data47)) {
              if (data47.ok === void 0) {
                const err101 = { instancePath: instancePath + "/hop_report/H3", schemaPath: "#/$defs/executedSuccessHopGate/required", keyword: "required", params: { missingProperty: "ok" }, message: "must have required property 'ok'" };
                if (vErrors === null) {
                  vErrors = [err101];
                } else {
                  vErrors.push(err101);
                }
                errors++;
              }
              if (data47.witness === void 0) {
                const err102 = { instancePath: instancePath + "/hop_report/H3", schemaPath: "#/$defs/executedSuccessHopGate/required", keyword: "required", params: { missingProperty: "witness" }, message: "must have required property 'witness'" };
                if (vErrors === null) {
                  vErrors = [err102];
                } else {
                  vErrors.push(err102);
                }
                errors++;
              }
              if (data47.remediation === void 0) {
                const err103 = { instancePath: instancePath + "/hop_report/H3", schemaPath: "#/$defs/executedSuccessHopGate/required", keyword: "required", params: { missingProperty: "remediation" }, message: "must have required property 'remediation'" };
                if (vErrors === null) {
                  vErrors = [err103];
                } else {
                  vErrors.push(err103);
                }
                errors++;
              }
              for (const key8 in data47) {
                if (!(key8 === "ok" || key8 === "witness" || key8 === "remediation")) {
                  const err104 = { instancePath: instancePath + "/hop_report/H3", schemaPath: "#/$defs/executedSuccessHopGate/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key8 }, message: "must NOT have additional properties" };
                  if (vErrors === null) {
                    vErrors = [err104];
                  } else {
                    vErrors.push(err104);
                  }
                  errors++;
                }
              }
              if (data47.ok !== void 0) {
                if (true !== data47.ok) {
                  const err105 = { instancePath: instancePath + "/hop_report/H3/ok", schemaPath: "#/$defs/executedSuccessHopGate/properties/ok/const", keyword: "const", params: { allowedValue: true }, message: "must be equal to constant" };
                  if (vErrors === null) {
                    vErrors = [err105];
                  } else {
                    vErrors.push(err105);
                  }
                  errors++;
                }
              }
              if (data47.witness !== void 0) {
                let data49 = data47.witness;
                if (data49 && typeof data49 == "object" && !Array.isArray(data49)) {
                  if (data49.abstained !== void 0) {
                    const _errs111 = errors;
                    const _errs112 = errors;
                    if (true !== data49.abstained) {
                      const err106 = {};
                      if (vErrors === null) {
                        vErrors = [err106];
                      } else {
                        vErrors.push(err106);
                      }
                      errors++;
                    }
                    var valid37 = _errs112 === errors;
                    if (valid37) {
                      const err107 = { instancePath: instancePath + "/hop_report/H3/witness/abstained", schemaPath: "#/$defs/executedSuccessHopGate/properties/witness/properties/abstained/not", keyword: "not", params: {}, message: "must NOT be valid" };
                      if (vErrors === null) {
                        vErrors = [err107];
                      } else {
                        vErrors.push(err107);
                      }
                      errors++;
                    } else {
                      errors = _errs111;
                      if (vErrors !== null) {
                        if (_errs111) {
                          vErrors.length = _errs111;
                        } else {
                          vErrors = null;
                        }
                      }
                    }
                  }
                  if (data49.skipped !== void 0) {
                    const _errs114 = errors;
                    const _errs115 = errors;
                    if (true !== data49.skipped) {
                      const err108 = {};
                      if (vErrors === null) {
                        vErrors = [err108];
                      } else {
                        vErrors.push(err108);
                      }
                      errors++;
                    }
                    var valid38 = _errs115 === errors;
                    if (valid38) {
                      const err109 = { instancePath: instancePath + "/hop_report/H3/witness/skipped", schemaPath: "#/$defs/executedSuccessHopGate/properties/witness/properties/skipped/not", keyword: "not", params: {}, message: "must NOT be valid" };
                      if (vErrors === null) {
                        vErrors = [err109];
                      } else {
                        vErrors.push(err109);
                      }
                      errors++;
                    } else {
                      errors = _errs114;
                      if (vErrors !== null) {
                        if (_errs114) {
                          vErrors.length = _errs114;
                        } else {
                          vErrors = null;
                        }
                      }
                    }
                  }
                } else {
                  const err110 = { instancePath: instancePath + "/hop_report/H3/witness", schemaPath: "#/$defs/executedSuccessHopGate/properties/witness/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                  if (vErrors === null) {
                    vErrors = [err110];
                  } else {
                    vErrors.push(err110);
                  }
                  errors++;
                }
              }
              if (data47.remediation !== void 0) {
                let data52 = data47.remediation;
                if (typeof data52 === "string") {
                  if (func2(data52) < 1) {
                    const err111 = { instancePath: instancePath + "/hop_report/H3/remediation", schemaPath: "#/$defs/executedSuccessHopGate/properties/remediation/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                    if (vErrors === null) {
                      vErrors = [err111];
                    } else {
                      vErrors.push(err111);
                    }
                    errors++;
                  }
                } else {
                  const err112 = { instancePath: instancePath + "/hop_report/H3/remediation", schemaPath: "#/$defs/executedSuccessHopGate/properties/remediation/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                  if (vErrors === null) {
                    vErrors = [err112];
                  } else {
                    vErrors.push(err112);
                  }
                  errors++;
                }
              }
            } else {
              const err113 = { instancePath: instancePath + "/hop_report/H3", schemaPath: "#/$defs/executedSuccessHopGate/type", keyword: "type", params: { type: "object" }, message: "must be object" };
              if (vErrors === null) {
                vErrors = [err113];
              } else {
                vErrors.push(err113);
              }
              errors++;
            }
          }
          if (data34.H4 !== void 0) {
            let data53 = data34.H4;
            if (data53 && typeof data53 == "object" && !Array.isArray(data53)) {
              if (data53.ok === void 0) {
                const err114 = { instancePath: instancePath + "/hop_report/H4", schemaPath: "#/$defs/executedSuccessHopGate/required", keyword: "required", params: { missingProperty: "ok" }, message: "must have required property 'ok'" };
                if (vErrors === null) {
                  vErrors = [err114];
                } else {
                  vErrors.push(err114);
                }
                errors++;
              }
              if (data53.witness === void 0) {
                const err115 = { instancePath: instancePath + "/hop_report/H4", schemaPath: "#/$defs/executedSuccessHopGate/required", keyword: "required", params: { missingProperty: "witness" }, message: "must have required property 'witness'" };
                if (vErrors === null) {
                  vErrors = [err115];
                } else {
                  vErrors.push(err115);
                }
                errors++;
              }
              if (data53.remediation === void 0) {
                const err116 = { instancePath: instancePath + "/hop_report/H4", schemaPath: "#/$defs/executedSuccessHopGate/required", keyword: "required", params: { missingProperty: "remediation" }, message: "must have required property 'remediation'" };
                if (vErrors === null) {
                  vErrors = [err116];
                } else {
                  vErrors.push(err116);
                }
                errors++;
              }
              for (const key9 in data53) {
                if (!(key9 === "ok" || key9 === "witness" || key9 === "remediation")) {
                  const err117 = { instancePath: instancePath + "/hop_report/H4", schemaPath: "#/$defs/executedSuccessHopGate/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key9 }, message: "must NOT have additional properties" };
                  if (vErrors === null) {
                    vErrors = [err117];
                  } else {
                    vErrors.push(err117);
                  }
                  errors++;
                }
              }
              if (data53.ok !== void 0) {
                if (true !== data53.ok) {
                  const err118 = { instancePath: instancePath + "/hop_report/H4/ok", schemaPath: "#/$defs/executedSuccessHopGate/properties/ok/const", keyword: "const", params: { allowedValue: true }, message: "must be equal to constant" };
                  if (vErrors === null) {
                    vErrors = [err118];
                  } else {
                    vErrors.push(err118);
                  }
                  errors++;
                }
              }
              if (data53.witness !== void 0) {
                let data55 = data53.witness;
                if (data55 && typeof data55 == "object" && !Array.isArray(data55)) {
                  if (data55.abstained !== void 0) {
                    const _errs126 = errors;
                    const _errs127 = errors;
                    if (true !== data55.abstained) {
                      const err119 = {};
                      if (vErrors === null) {
                        vErrors = [err119];
                      } else {
                        vErrors.push(err119);
                      }
                      errors++;
                    }
                    var valid42 = _errs127 === errors;
                    if (valid42) {
                      const err120 = { instancePath: instancePath + "/hop_report/H4/witness/abstained", schemaPath: "#/$defs/executedSuccessHopGate/properties/witness/properties/abstained/not", keyword: "not", params: {}, message: "must NOT be valid" };
                      if (vErrors === null) {
                        vErrors = [err120];
                      } else {
                        vErrors.push(err120);
                      }
                      errors++;
                    } else {
                      errors = _errs126;
                      if (vErrors !== null) {
                        if (_errs126) {
                          vErrors.length = _errs126;
                        } else {
                          vErrors = null;
                        }
                      }
                    }
                  }
                  if (data55.skipped !== void 0) {
                    const _errs129 = errors;
                    const _errs130 = errors;
                    if (true !== data55.skipped) {
                      const err121 = {};
                      if (vErrors === null) {
                        vErrors = [err121];
                      } else {
                        vErrors.push(err121);
                      }
                      errors++;
                    }
                    var valid43 = _errs130 === errors;
                    if (valid43) {
                      const err122 = { instancePath: instancePath + "/hop_report/H4/witness/skipped", schemaPath: "#/$defs/executedSuccessHopGate/properties/witness/properties/skipped/not", keyword: "not", params: {}, message: "must NOT be valid" };
                      if (vErrors === null) {
                        vErrors = [err122];
                      } else {
                        vErrors.push(err122);
                      }
                      errors++;
                    } else {
                      errors = _errs129;
                      if (vErrors !== null) {
                        if (_errs129) {
                          vErrors.length = _errs129;
                        } else {
                          vErrors = null;
                        }
                      }
                    }
                  }
                } else {
                  const err123 = { instancePath: instancePath + "/hop_report/H4/witness", schemaPath: "#/$defs/executedSuccessHopGate/properties/witness/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                  if (vErrors === null) {
                    vErrors = [err123];
                  } else {
                    vErrors.push(err123);
                  }
                  errors++;
                }
              }
              if (data53.remediation !== void 0) {
                let data58 = data53.remediation;
                if (typeof data58 === "string") {
                  if (func2(data58) < 1) {
                    const err124 = { instancePath: instancePath + "/hop_report/H4/remediation", schemaPath: "#/$defs/executedSuccessHopGate/properties/remediation/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                    if (vErrors === null) {
                      vErrors = [err124];
                    } else {
                      vErrors.push(err124);
                    }
                    errors++;
                  }
                } else {
                  const err125 = { instancePath: instancePath + "/hop_report/H4/remediation", schemaPath: "#/$defs/executedSuccessHopGate/properties/remediation/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                  if (vErrors === null) {
                    vErrors = [err125];
                  } else {
                    vErrors.push(err125);
                  }
                  errors++;
                }
              }
            } else {
              const err126 = { instancePath: instancePath + "/hop_report/H4", schemaPath: "#/$defs/executedSuccessHopGate/type", keyword: "type", params: { type: "object" }, message: "must be object" };
              if (vErrors === null) {
                vErrors = [err126];
              } else {
                vErrors.push(err126);
              }
              errors++;
            }
          }
        } else {
          const err127 = { instancePath: instancePath + "/hop_report", schemaPath: "#/allOf/1/then/properties/hop_report/type", keyword: "type", params: { type: "object" }, message: "must be object" };
          if (vErrors === null) {
            vErrors = [err127];
          } else {
            vErrors.push(err127);
          }
          errors++;
        }
      }
    }
    var _valid1 = _errs58 === errors;
    valid17 = _valid1;
    if (valid17) {
      var props1 = {};
      props1.conditional_route_policy = true;
      props1.budgets = true;
      props1.executed_checks = true;
      props1.hop_report = true;
      props1.mode = true;
      props1.ok = true;
    }
  }
  if (!valid17) {
    const err128 = { instancePath, schemaPath: "#/allOf/1/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err128];
    } else {
      vErrors.push(err128);
    }
    errors++;
  }
  if (props0 !== true && props1 !== void 0) {
    if (props1 === true) {
      props0 = true;
    } else {
      props0 = props0 || {};
      Object.assign(props0, props1);
    }
  }
  const _errs134 = errors;
  let valid44 = true;
  const _errs135 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    let missing2;
    if (data.mode === void 0 && (missing2 = "mode") || data.ok === void 0 && (missing2 = "ok")) {
      const err129 = {};
      if (vErrors === null) {
        vErrors = [err129];
      } else {
        vErrors.push(err129);
      }
      errors++;
    } else {
      if (data.mode !== void 0) {
        let data59 = data.mode;
        const _errs136 = errors;
        if (!(data59 === "full" || data59 === "partial")) {
          const err130 = {};
          if (vErrors === null) {
            vErrors = [err130];
          } else {
            vErrors.push(err130);
          }
          errors++;
        }
        var valid45 = _errs136 === errors;
      } else {
        var valid45 = true;
      }
      if (valid45) {
        if (data.ok !== void 0) {
          const _errs137 = errors;
          if (false !== data.ok) {
            const err131 = {};
            if (vErrors === null) {
              vErrors = [err131];
            } else {
              vErrors.push(err131);
            }
            errors++;
          }
          var valid45 = _errs137 === errors;
        } else {
          var valid45 = true;
        }
      }
    }
  }
  var _valid2 = _errs135 === errors;
  errors = _errs134;
  if (vErrors !== null) {
    if (_errs134) {
      vErrors.length = _errs134;
    } else {
      vErrors = null;
    }
  }
  if (_valid2) {
    const _errs138 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.conditional_route_policy !== void 0) {
        if ("enabled_by_default-only" !== data.conditional_route_policy) {
          const err132 = { instancePath: instancePath + "/conditional_route_policy", schemaPath: "#/allOf/2/then/properties/conditional_route_policy/const", keyword: "const", params: { allowedValue: "enabled_by_default-only" }, message: "must be equal to constant" };
          if (vErrors === null) {
            vErrors = [err132];
          } else {
            vErrors.push(err132);
          }
          errors++;
        }
      }
      if (data.final_surface_snapshot !== void 0) {
        const err133 = { instancePath: instancePath + "/final_surface_snapshot", schemaPath: "#/allOf/2/then/properties/final_surface_snapshot/false schema", keyword: "false schema", params: {}, message: "boolean schema is false" };
        if (vErrors === null) {
          vErrors = [err133];
        } else {
          vErrors.push(err133);
        }
        errors++;
      }
    }
    var _valid2 = _errs138 === errors;
    valid44 = _valid2;
    if (valid44) {
      var props2 = {};
      props2.conditional_route_policy = true;
      props2.final_surface_snapshot = true;
      props2.mode = true;
      props2.ok = true;
    }
  }
  if (!valid44) {
    const err134 = { instancePath, schemaPath: "#/allOf/2/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err134];
    } else {
      vErrors.push(err134);
    }
    errors++;
  }
  if (props0 !== true && props2 !== void 0) {
    if (props2 === true) {
      props0 = true;
    } else {
      props0 = props0 || {};
      Object.assign(props0, props2);
    }
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.host === void 0) {
      const err135 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "host" }, message: "must have required property 'host'" };
      if (vErrors === null) {
        vErrors = [err135];
      } else {
        vErrors.push(err135);
      }
      errors++;
    }
    if (data.ok === void 0) {
      const err136 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "ok" }, message: "must have required property 'ok'" };
      if (vErrors === null) {
        vErrors = [err136];
      } else {
        vErrors.push(err136);
      }
      errors++;
    }
    if (data.mode === void 0) {
      const err137 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "mode" }, message: "must have required property 'mode'" };
      if (vErrors === null) {
        vErrors = [err137];
      } else {
        vErrors.push(err137);
      }
      errors++;
    }
    if (data.artifacts === void 0) {
      const err138 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "artifacts" }, message: "must have required property 'artifacts'" };
      if (vErrors === null) {
        vErrors = [err138];
      } else {
        vErrors.push(err138);
      }
      errors++;
    }
    if (data.enabled_edges === void 0) {
      const err139 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "enabled_edges" }, message: "must have required property 'enabled_edges'" };
      if (vErrors === null) {
        vErrors = [err139];
      } else {
        vErrors.push(err139);
      }
      errors++;
    }
    if (data.point_anchors === void 0) {
      const err140 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "point_anchors" }, message: "must have required property 'point_anchors'" };
      if (vErrors === null) {
        vErrors = [err140];
      } else {
        vErrors.push(err140);
      }
      errors++;
    }
    if (data.hop_report === void 0) {
      const err141 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "hop_report" }, message: "must have required property 'hop_report'" };
      if (vErrors === null) {
        vErrors = [err141];
      } else {
        vErrors.push(err141);
      }
      errors++;
    }
    if (data.budgets === void 0) {
      const err142 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "budgets" }, message: "must have required property 'budgets'" };
      if (vErrors === null) {
        vErrors = [err142];
      } else {
        vErrors.push(err142);
      }
      errors++;
    }
    if (data.executed_checks === void 0) {
      const err143 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "executed_checks" }, message: "must have required property 'executed_checks'" };
      if (vErrors === null) {
        vErrors = [err143];
      } else {
        vErrors.push(err143);
      }
      errors++;
    }
    if (data.conditional_route_policy === void 0) {
      const err144 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "conditional_route_policy" }, message: "must have required property 'conditional_route_policy'" };
      if (vErrors === null) {
        vErrors = [err144];
      } else {
        vErrors.push(err144);
      }
      errors++;
    }
    if (data.result_graph_sha256 === void 0) {
      const err145 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "result_graph_sha256" }, message: "must have required property 'result_graph_sha256'" };
      if (vErrors === null) {
        vErrors = [err145];
      } else {
        vErrors.push(err145);
      }
      errors++;
    }
    for (const key10 in data) {
      if (!func1.call(schema109.properties, key10)) {
        const err146 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key10 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err146];
        } else {
          vErrors.push(err146);
        }
        errors++;
      }
    }
    if (data.host !== void 0) {
      let data63 = data.host;
      if (typeof data63 !== "string") {
        const err147 = { instancePath: instancePath + "/host", schemaPath: "#/properties/host/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err147];
        } else {
          vErrors.push(err147);
        }
        errors++;
      }
      if (!(data63 === "claude-code" || data63 === "codex" || data63 === "cursor" || data63 === "kimi-code")) {
        const err148 = { instancePath: instancePath + "/host", schemaPath: "#/properties/host/enum", keyword: "enum", params: { allowedValues: schema109.properties.host.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err148];
        } else {
          vErrors.push(err148);
        }
        errors++;
      }
    }
    if (data.ok !== void 0) {
      if (typeof data.ok !== "boolean") {
        const err149 = { instancePath: instancePath + "/ok", schemaPath: "#/properties/ok/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
        if (vErrors === null) {
          vErrors = [err149];
        } else {
          vErrors.push(err149);
        }
        errors++;
      }
    }
    if (data.mode !== void 0) {
      let data65 = data.mode;
      if (typeof data65 !== "string") {
        const err150 = { instancePath: instancePath + "/mode", schemaPath: "#/properties/mode/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err150];
        } else {
          vErrors.push(err150);
        }
        errors++;
      }
      if (!(data65 === "full" || data65 === "partial" || data65 === "stub" || data65 === "unsupported")) {
        const err151 = { instancePath: instancePath + "/mode", schemaPath: "#/properties/mode/enum", keyword: "enum", params: { allowedValues: schema109.properties.mode.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err151];
        } else {
          vErrors.push(err151);
        }
        errors++;
      }
    }
    if (data.artifacts !== void 0) {
      let data66 = data.artifacts;
      if (Array.isArray(data66)) {
        const len2 = data66.length;
        for (let i2 = 0; i2 < len2; i2++) {
          let data67 = data66[i2];
          if (data67 && typeof data67 == "object" && !Array.isArray(data67)) {
            if (data67.path === void 0) {
              const err152 = { instancePath: instancePath + "/artifacts/" + i2, schemaPath: "#/properties/artifacts/items/required", keyword: "required", params: { missingProperty: "path" }, message: "must have required property 'path'" };
              if (vErrors === null) {
                vErrors = [err152];
              } else {
                vErrors.push(err152);
              }
              errors++;
            }
            if (data67.bytes === void 0) {
              const err153 = { instancePath: instancePath + "/artifacts/" + i2, schemaPath: "#/properties/artifacts/items/required", keyword: "required", params: { missingProperty: "bytes" }, message: "must have required property 'bytes'" };
              if (vErrors === null) {
                vErrors = [err153];
              } else {
                vErrors.push(err153);
              }
              errors++;
            }
            for (const key11 in data67) {
              if (!(key11 === "path" || key11 === "bytes")) {
                const err154 = { instancePath: instancePath + "/artifacts/" + i2, schemaPath: "#/properties/artifacts/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key11 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err154];
                } else {
                  vErrors.push(err154);
                }
                errors++;
              }
            }
            if (data67.path !== void 0) {
              let data68 = data67.path;
              if (typeof data68 === "string") {
                if (func2(data68) < 1) {
                  const err155 = { instancePath: instancePath + "/artifacts/" + i2 + "/path", schemaPath: "#/properties/artifacts/items/properties/path/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err155];
                  } else {
                    vErrors.push(err155);
                  }
                  errors++;
                }
              } else {
                const err156 = { instancePath: instancePath + "/artifacts/" + i2 + "/path", schemaPath: "#/properties/artifacts/items/properties/path/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err156];
                } else {
                  vErrors.push(err156);
                }
                errors++;
              }
            }
            if (data67.bytes !== void 0) {
              let data69 = data67.bytes;
              if (!(typeof data69 == "number" && (!(data69 % 1) && !isNaN(data69)))) {
                const err157 = { instancePath: instancePath + "/artifacts/" + i2 + "/bytes", schemaPath: "#/properties/artifacts/items/properties/bytes/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                if (vErrors === null) {
                  vErrors = [err157];
                } else {
                  vErrors.push(err157);
                }
                errors++;
              }
              if (typeof data69 == "number") {
                if (data69 < 0 || isNaN(data69)) {
                  const err158 = { instancePath: instancePath + "/artifacts/" + i2 + "/bytes", schemaPath: "#/properties/artifacts/items/properties/bytes/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
                  if (vErrors === null) {
                    vErrors = [err158];
                  } else {
                    vErrors.push(err158);
                  }
                  errors++;
                }
              }
            }
          } else {
            const err159 = { instancePath: instancePath + "/artifacts/" + i2, schemaPath: "#/properties/artifacts/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err159];
            } else {
              vErrors.push(err159);
            }
            errors++;
          }
        }
      } else {
        const err160 = { instancePath: instancePath + "/artifacts", schemaPath: "#/properties/artifacts/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err160];
        } else {
          vErrors.push(err160);
        }
        errors++;
      }
    }
    if (data.enabled_edges !== void 0) {
      let data70 = data.enabled_edges;
      if (!(typeof data70 == "number" && (!(data70 % 1) && !isNaN(data70)))) {
        const err161 = { instancePath: instancePath + "/enabled_edges", schemaPath: "#/properties/enabled_edges/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err161];
        } else {
          vErrors.push(err161);
        }
        errors++;
      }
      if (typeof data70 == "number") {
        if (data70 < 0 || isNaN(data70)) {
          const err162 = { instancePath: instancePath + "/enabled_edges", schemaPath: "#/properties/enabled_edges/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
          if (vErrors === null) {
            vErrors = [err162];
          } else {
            vErrors.push(err162);
          }
          errors++;
        }
      }
    }
    if (data.point_anchors !== void 0) {
      let data71 = data.point_anchors;
      if (!(typeof data71 == "number" && (!(data71 % 1) && !isNaN(data71)))) {
        const err163 = { instancePath: instancePath + "/point_anchors", schemaPath: "#/properties/point_anchors/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err163];
        } else {
          vErrors.push(err163);
        }
        errors++;
      }
      if (typeof data71 == "number") {
        if (data71 < 0 || isNaN(data71)) {
          const err164 = { instancePath: instancePath + "/point_anchors", schemaPath: "#/properties/point_anchors/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
          if (vErrors === null) {
            vErrors = [err164];
          } else {
            vErrors.push(err164);
          }
          errors++;
        }
      }
    }
    if (data.hop_report !== void 0) {
      let data72 = data.hop_report;
      if (data72 && typeof data72 == "object" && !Array.isArray(data72)) {
        if (data72.H1 === void 0) {
          const err165 = { instancePath: instancePath + "/hop_report", schemaPath: "#/properties/hop_report/required", keyword: "required", params: { missingProperty: "H1" }, message: "must have required property 'H1'" };
          if (vErrors === null) {
            vErrors = [err165];
          } else {
            vErrors.push(err165);
          }
          errors++;
        }
        if (data72.H2 === void 0) {
          const err166 = { instancePath: instancePath + "/hop_report", schemaPath: "#/properties/hop_report/required", keyword: "required", params: { missingProperty: "H2" }, message: "must have required property 'H2'" };
          if (vErrors === null) {
            vErrors = [err166];
          } else {
            vErrors.push(err166);
          }
          errors++;
        }
        if (data72.H3 === void 0) {
          const err167 = { instancePath: instancePath + "/hop_report", schemaPath: "#/properties/hop_report/required", keyword: "required", params: { missingProperty: "H3" }, message: "must have required property 'H3'" };
          if (vErrors === null) {
            vErrors = [err167];
          } else {
            vErrors.push(err167);
          }
          errors++;
        }
        if (data72.H4 === void 0) {
          const err168 = { instancePath: instancePath + "/hop_report", schemaPath: "#/properties/hop_report/required", keyword: "required", params: { missingProperty: "H4" }, message: "must have required property 'H4'" };
          if (vErrors === null) {
            vErrors = [err168];
          } else {
            vErrors.push(err168);
          }
          errors++;
        }
        for (const key12 in data72) {
          if (!(key12 === "H1" || key12 === "H2" || key12 === "H3" || key12 === "H4")) {
            const err169 = { instancePath: instancePath + "/hop_report", schemaPath: "#/properties/hop_report/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key12 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err169];
            } else {
              vErrors.push(err169);
            }
            errors++;
          }
        }
        if (data72.H1 !== void 0) {
          let data73 = data72.H1;
          if (data73 && typeof data73 == "object" && !Array.isArray(data73)) {
            if (data73.ok === void 0) {
              const err170 = { instancePath: instancePath + "/hop_report/H1", schemaPath: "#/$defs/hopGate/required", keyword: "required", params: { missingProperty: "ok" }, message: "must have required property 'ok'" };
              if (vErrors === null) {
                vErrors = [err170];
              } else {
                vErrors.push(err170);
              }
              errors++;
            }
            if (data73.witness === void 0) {
              const err171 = { instancePath: instancePath + "/hop_report/H1", schemaPath: "#/$defs/hopGate/required", keyword: "required", params: { missingProperty: "witness" }, message: "must have required property 'witness'" };
              if (vErrors === null) {
                vErrors = [err171];
              } else {
                vErrors.push(err171);
              }
              errors++;
            }
            if (data73.remediation === void 0) {
              const err172 = { instancePath: instancePath + "/hop_report/H1", schemaPath: "#/$defs/hopGate/required", keyword: "required", params: { missingProperty: "remediation" }, message: "must have required property 'remediation'" };
              if (vErrors === null) {
                vErrors = [err172];
              } else {
                vErrors.push(err172);
              }
              errors++;
            }
            for (const key13 in data73) {
              if (!(key13 === "ok" || key13 === "witness" || key13 === "remediation")) {
                const err173 = { instancePath: instancePath + "/hop_report/H1", schemaPath: "#/$defs/hopGate/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key13 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err173];
                } else {
                  vErrors.push(err173);
                }
                errors++;
              }
            }
            if (data73.ok !== void 0) {
              if (typeof data73.ok !== "boolean") {
                const err174 = { instancePath: instancePath + "/hop_report/H1/ok", schemaPath: "#/$defs/hopGate/properties/ok/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
                if (vErrors === null) {
                  vErrors = [err174];
                } else {
                  vErrors.push(err174);
                }
                errors++;
              }
            }
            if (data73.witness !== void 0) {
              let data75 = data73.witness;
              if (!(data75 && typeof data75 == "object" && !Array.isArray(data75))) {
                const err175 = { instancePath: instancePath + "/hop_report/H1/witness", schemaPath: "#/$defs/hopGate/properties/witness/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err175];
                } else {
                  vErrors.push(err175);
                }
                errors++;
              }
            }
            if (data73.remediation !== void 0) {
              let data76 = data73.remediation;
              if (typeof data76 === "string") {
                if (func2(data76) < 1) {
                  const err176 = { instancePath: instancePath + "/hop_report/H1/remediation", schemaPath: "#/$defs/hopGate/properties/remediation/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err176];
                  } else {
                    vErrors.push(err176);
                  }
                  errors++;
                }
              } else {
                const err177 = { instancePath: instancePath + "/hop_report/H1/remediation", schemaPath: "#/$defs/hopGate/properties/remediation/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err177];
                } else {
                  vErrors.push(err177);
                }
                errors++;
              }
            }
          } else {
            const err178 = { instancePath: instancePath + "/hop_report/H1", schemaPath: "#/$defs/hopGate/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err178];
            } else {
              vErrors.push(err178);
            }
            errors++;
          }
        }
        if (data72.H2 !== void 0) {
          let data77 = data72.H2;
          if (data77 && typeof data77 == "object" && !Array.isArray(data77)) {
            if (data77.ok === void 0) {
              const err179 = { instancePath: instancePath + "/hop_report/H2", schemaPath: "#/$defs/hopGate/required", keyword: "required", params: { missingProperty: "ok" }, message: "must have required property 'ok'" };
              if (vErrors === null) {
                vErrors = [err179];
              } else {
                vErrors.push(err179);
              }
              errors++;
            }
            if (data77.witness === void 0) {
              const err180 = { instancePath: instancePath + "/hop_report/H2", schemaPath: "#/$defs/hopGate/required", keyword: "required", params: { missingProperty: "witness" }, message: "must have required property 'witness'" };
              if (vErrors === null) {
                vErrors = [err180];
              } else {
                vErrors.push(err180);
              }
              errors++;
            }
            if (data77.remediation === void 0) {
              const err181 = { instancePath: instancePath + "/hop_report/H2", schemaPath: "#/$defs/hopGate/required", keyword: "required", params: { missingProperty: "remediation" }, message: "must have required property 'remediation'" };
              if (vErrors === null) {
                vErrors = [err181];
              } else {
                vErrors.push(err181);
              }
              errors++;
            }
            for (const key14 in data77) {
              if (!(key14 === "ok" || key14 === "witness" || key14 === "remediation")) {
                const err182 = { instancePath: instancePath + "/hop_report/H2", schemaPath: "#/$defs/hopGate/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key14 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err182];
                } else {
                  vErrors.push(err182);
                }
                errors++;
              }
            }
            if (data77.ok !== void 0) {
              if (typeof data77.ok !== "boolean") {
                const err183 = { instancePath: instancePath + "/hop_report/H2/ok", schemaPath: "#/$defs/hopGate/properties/ok/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
                if (vErrors === null) {
                  vErrors = [err183];
                } else {
                  vErrors.push(err183);
                }
                errors++;
              }
            }
            if (data77.witness !== void 0) {
              let data79 = data77.witness;
              if (!(data79 && typeof data79 == "object" && !Array.isArray(data79))) {
                const err184 = { instancePath: instancePath + "/hop_report/H2/witness", schemaPath: "#/$defs/hopGate/properties/witness/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err184];
                } else {
                  vErrors.push(err184);
                }
                errors++;
              }
            }
            if (data77.remediation !== void 0) {
              let data80 = data77.remediation;
              if (typeof data80 === "string") {
                if (func2(data80) < 1) {
                  const err185 = { instancePath: instancePath + "/hop_report/H2/remediation", schemaPath: "#/$defs/hopGate/properties/remediation/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err185];
                  } else {
                    vErrors.push(err185);
                  }
                  errors++;
                }
              } else {
                const err186 = { instancePath: instancePath + "/hop_report/H2/remediation", schemaPath: "#/$defs/hopGate/properties/remediation/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err186];
                } else {
                  vErrors.push(err186);
                }
                errors++;
              }
            }
          } else {
            const err187 = { instancePath: instancePath + "/hop_report/H2", schemaPath: "#/$defs/hopGate/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err187];
            } else {
              vErrors.push(err187);
            }
            errors++;
          }
        }
        if (data72.H3 !== void 0) {
          let data81 = data72.H3;
          if (data81 && typeof data81 == "object" && !Array.isArray(data81)) {
            if (data81.ok === void 0) {
              const err188 = { instancePath: instancePath + "/hop_report/H3", schemaPath: "#/$defs/hopGate/required", keyword: "required", params: { missingProperty: "ok" }, message: "must have required property 'ok'" };
              if (vErrors === null) {
                vErrors = [err188];
              } else {
                vErrors.push(err188);
              }
              errors++;
            }
            if (data81.witness === void 0) {
              const err189 = { instancePath: instancePath + "/hop_report/H3", schemaPath: "#/$defs/hopGate/required", keyword: "required", params: { missingProperty: "witness" }, message: "must have required property 'witness'" };
              if (vErrors === null) {
                vErrors = [err189];
              } else {
                vErrors.push(err189);
              }
              errors++;
            }
            if (data81.remediation === void 0) {
              const err190 = { instancePath: instancePath + "/hop_report/H3", schemaPath: "#/$defs/hopGate/required", keyword: "required", params: { missingProperty: "remediation" }, message: "must have required property 'remediation'" };
              if (vErrors === null) {
                vErrors = [err190];
              } else {
                vErrors.push(err190);
              }
              errors++;
            }
            for (const key15 in data81) {
              if (!(key15 === "ok" || key15 === "witness" || key15 === "remediation")) {
                const err191 = { instancePath: instancePath + "/hop_report/H3", schemaPath: "#/$defs/hopGate/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key15 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err191];
                } else {
                  vErrors.push(err191);
                }
                errors++;
              }
            }
            if (data81.ok !== void 0) {
              if (typeof data81.ok !== "boolean") {
                const err192 = { instancePath: instancePath + "/hop_report/H3/ok", schemaPath: "#/$defs/hopGate/properties/ok/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
                if (vErrors === null) {
                  vErrors = [err192];
                } else {
                  vErrors.push(err192);
                }
                errors++;
              }
            }
            if (data81.witness !== void 0) {
              let data83 = data81.witness;
              if (!(data83 && typeof data83 == "object" && !Array.isArray(data83))) {
                const err193 = { instancePath: instancePath + "/hop_report/H3/witness", schemaPath: "#/$defs/hopGate/properties/witness/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err193];
                } else {
                  vErrors.push(err193);
                }
                errors++;
              }
            }
            if (data81.remediation !== void 0) {
              let data84 = data81.remediation;
              if (typeof data84 === "string") {
                if (func2(data84) < 1) {
                  const err194 = { instancePath: instancePath + "/hop_report/H3/remediation", schemaPath: "#/$defs/hopGate/properties/remediation/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err194];
                  } else {
                    vErrors.push(err194);
                  }
                  errors++;
                }
              } else {
                const err195 = { instancePath: instancePath + "/hop_report/H3/remediation", schemaPath: "#/$defs/hopGate/properties/remediation/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err195];
                } else {
                  vErrors.push(err195);
                }
                errors++;
              }
            }
          } else {
            const err196 = { instancePath: instancePath + "/hop_report/H3", schemaPath: "#/$defs/hopGate/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err196];
            } else {
              vErrors.push(err196);
            }
            errors++;
          }
        }
        if (data72.H4 !== void 0) {
          let data85 = data72.H4;
          if (data85 && typeof data85 == "object" && !Array.isArray(data85)) {
            if (data85.ok === void 0) {
              const err197 = { instancePath: instancePath + "/hop_report/H4", schemaPath: "#/$defs/hopGate/required", keyword: "required", params: { missingProperty: "ok" }, message: "must have required property 'ok'" };
              if (vErrors === null) {
                vErrors = [err197];
              } else {
                vErrors.push(err197);
              }
              errors++;
            }
            if (data85.witness === void 0) {
              const err198 = { instancePath: instancePath + "/hop_report/H4", schemaPath: "#/$defs/hopGate/required", keyword: "required", params: { missingProperty: "witness" }, message: "must have required property 'witness'" };
              if (vErrors === null) {
                vErrors = [err198];
              } else {
                vErrors.push(err198);
              }
              errors++;
            }
            if (data85.remediation === void 0) {
              const err199 = { instancePath: instancePath + "/hop_report/H4", schemaPath: "#/$defs/hopGate/required", keyword: "required", params: { missingProperty: "remediation" }, message: "must have required property 'remediation'" };
              if (vErrors === null) {
                vErrors = [err199];
              } else {
                vErrors.push(err199);
              }
              errors++;
            }
            for (const key16 in data85) {
              if (!(key16 === "ok" || key16 === "witness" || key16 === "remediation")) {
                const err200 = { instancePath: instancePath + "/hop_report/H4", schemaPath: "#/$defs/hopGate/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key16 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err200];
                } else {
                  vErrors.push(err200);
                }
                errors++;
              }
            }
            if (data85.ok !== void 0) {
              if (typeof data85.ok !== "boolean") {
                const err201 = { instancePath: instancePath + "/hop_report/H4/ok", schemaPath: "#/$defs/hopGate/properties/ok/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
                if (vErrors === null) {
                  vErrors = [err201];
                } else {
                  vErrors.push(err201);
                }
                errors++;
              }
            }
            if (data85.witness !== void 0) {
              let data87 = data85.witness;
              if (!(data87 && typeof data87 == "object" && !Array.isArray(data87))) {
                const err202 = { instancePath: instancePath + "/hop_report/H4/witness", schemaPath: "#/$defs/hopGate/properties/witness/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err202];
                } else {
                  vErrors.push(err202);
                }
                errors++;
              }
            }
            if (data85.remediation !== void 0) {
              let data88 = data85.remediation;
              if (typeof data88 === "string") {
                if (func2(data88) < 1) {
                  const err203 = { instancePath: instancePath + "/hop_report/H4/remediation", schemaPath: "#/$defs/hopGate/properties/remediation/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err203];
                  } else {
                    vErrors.push(err203);
                  }
                  errors++;
                }
              } else {
                const err204 = { instancePath: instancePath + "/hop_report/H4/remediation", schemaPath: "#/$defs/hopGate/properties/remediation/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err204];
                } else {
                  vErrors.push(err204);
                }
                errors++;
              }
            }
          } else {
            const err205 = { instancePath: instancePath + "/hop_report/H4", schemaPath: "#/$defs/hopGate/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err205];
            } else {
              vErrors.push(err205);
            }
            errors++;
          }
        }
      } else {
        const err206 = { instancePath: instancePath + "/hop_report", schemaPath: "#/properties/hop_report/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err206];
        } else {
          vErrors.push(err206);
        }
        errors++;
      }
    }
    if (data.budgets !== void 0) {
      let data89 = data.budgets;
      if (!(data89 && typeof data89 == "object" && !Array.isArray(data89))) {
        const err207 = { instancePath: instancePath + "/budgets", schemaPath: "#/properties/budgets/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err207];
        } else {
          vErrors.push(err207);
        }
        errors++;
      }
    }
    if (data.executed_checks !== void 0) {
      let data90 = data.executed_checks;
      if (Array.isArray(data90)) {
        const len3 = data90.length;
        for (let i3 = 0; i3 < len3; i3++) {
          let data91 = data90[i3];
          if (typeof data91 === "string") {
            if (func2(data91) < 1) {
              const err208 = { instancePath: instancePath + "/executed_checks/" + i3, schemaPath: "#/properties/executed_checks/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err208];
              } else {
                vErrors.push(err208);
              }
              errors++;
            }
          } else {
            const err209 = { instancePath: instancePath + "/executed_checks/" + i3, schemaPath: "#/properties/executed_checks/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err209];
            } else {
              vErrors.push(err209);
            }
            errors++;
          }
        }
        let i4 = data90.length;
        let j0;
        if (i4 > 1) {
          const indices0 = {};
          for (; i4--; ) {
            let item0 = data90[i4];
            if (typeof item0 !== "string") {
              continue;
            }
            if (typeof indices0[item0] == "number") {
              j0 = indices0[item0];
              const err210 = { instancePath: instancePath + "/executed_checks", schemaPath: "#/properties/executed_checks/uniqueItems", keyword: "uniqueItems", params: { i: i4, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i4 + " are identical)" };
              if (vErrors === null) {
                vErrors = [err210];
              } else {
                vErrors.push(err210);
              }
              errors++;
              break;
            }
            indices0[item0] = i4;
          }
        }
      } else {
        const err211 = { instancePath: instancePath + "/executed_checks", schemaPath: "#/properties/executed_checks/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err211];
        } else {
          vErrors.push(err211);
        }
        errors++;
      }
    }
    if (data.conditional_route_policy !== void 0) {
      let data92 = data.conditional_route_policy;
      if (typeof data92 !== "string") {
        const err212 = { instancePath: instancePath + "/conditional_route_policy", schemaPath: "#/properties/conditional_route_policy/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err212];
        } else {
          vErrors.push(err212);
        }
        errors++;
      }
      if (!(data92 === "enabled_by_default-only" || data92 === "abstained")) {
        const err213 = { instancePath: instancePath + "/conditional_route_policy", schemaPath: "#/properties/conditional_route_policy/enum", keyword: "enum", params: { allowedValues: schema109.properties.conditional_route_policy.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err213];
        } else {
          vErrors.push(err213);
        }
        errors++;
      }
    }
    if (data.result_graph_sha256 !== void 0) {
      let data93 = data.result_graph_sha256;
      if (typeof data93 === "string") {
        if (!pattern6.test(data93)) {
          const err214 = { instancePath: instancePath + "/result_graph_sha256", schemaPath: "#/$defs/sha256/pattern", keyword: "pattern", params: { pattern: "^[a-f0-9]{64}$" }, message: 'must match pattern "^[a-f0-9]{64}$"' };
          if (vErrors === null) {
            vErrors = [err214];
          } else {
            vErrors.push(err214);
          }
          errors++;
        }
      } else {
        const err215 = { instancePath: instancePath + "/result_graph_sha256", schemaPath: "#/$defs/sha256/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err215];
        } else {
          vErrors.push(err215);
        }
        errors++;
      }
    }
    if (data.final_surface_snapshot !== void 0) {
      let data94 = data.final_surface_snapshot;
      if (data94 && typeof data94 == "object" && !Array.isArray(data94)) {
        if (data94.host === void 0) {
          const err216 = { instancePath: instancePath + "/final_surface_snapshot", schemaPath: "#/properties/final_surface_snapshot/required", keyword: "required", params: { missingProperty: "host" }, message: "must have required property 'host'" };
          if (vErrors === null) {
            vErrors = [err216];
          } else {
            vErrors.push(err216);
          }
          errors++;
        }
        if (data94.mode === void 0) {
          const err217 = { instancePath: instancePath + "/final_surface_snapshot", schemaPath: "#/properties/final_surface_snapshot/required", keyword: "required", params: { missingProperty: "mode" }, message: "must have required property 'mode'" };
          if (vErrors === null) {
            vErrors = [err217];
          } else {
            vErrors.push(err217);
          }
          errors++;
        }
        if (data94.final_root === void 0) {
          const err218 = { instancePath: instancePath + "/final_surface_snapshot", schemaPath: "#/properties/final_surface_snapshot/required", keyword: "required", params: { missingProperty: "final_root" }, message: "must have required property 'final_root'" };
          if (vErrors === null) {
            vErrors = [err218];
          } else {
            vErrors.push(err218);
          }
          errors++;
        }
        if (data94.fileset_manifest === void 0) {
          const err219 = { instancePath: instancePath + "/final_surface_snapshot", schemaPath: "#/properties/final_surface_snapshot/required", keyword: "required", params: { missingProperty: "fileset_manifest" }, message: "must have required property 'fileset_manifest'" };
          if (vErrors === null) {
            vErrors = [err219];
          } else {
            vErrors.push(err219);
          }
          errors++;
        }
        if (data94.fileset === void 0) {
          const err220 = { instancePath: instancePath + "/final_surface_snapshot", schemaPath: "#/properties/final_surface_snapshot/required", keyword: "required", params: { missingProperty: "fileset" }, message: "must have required property 'fileset'" };
          if (vErrors === null) {
            vErrors = [err220];
          } else {
            vErrors.push(err220);
          }
          errors++;
        }
        if (data94.skills === void 0) {
          const err221 = { instancePath: instancePath + "/final_surface_snapshot", schemaPath: "#/properties/final_surface_snapshot/required", keyword: "required", params: { missingProperty: "skills" }, message: "must have required property 'skills'" };
          if (vErrors === null) {
            vErrors = [err221];
          } else {
            vErrors.push(err221);
          }
          errors++;
        }
        if (data94.modules === void 0) {
          const err222 = { instancePath: instancePath + "/final_surface_snapshot", schemaPath: "#/properties/final_surface_snapshot/required", keyword: "required", params: { missingProperty: "modules" }, message: "must have required property 'modules'" };
          if (vErrors === null) {
            vErrors = [err222];
          } else {
            vErrors.push(err222);
          }
          errors++;
        }
        if (data94.points === void 0) {
          const err223 = { instancePath: instancePath + "/final_surface_snapshot", schemaPath: "#/properties/final_surface_snapshot/required", keyword: "required", params: { missingProperty: "points" }, message: "must have required property 'points'" };
          if (vErrors === null) {
            vErrors = [err223];
          } else {
            vErrors.push(err223);
          }
          errors++;
        }
        if (data94.edges === void 0) {
          const err224 = { instancePath: instancePath + "/final_surface_snapshot", schemaPath: "#/properties/final_surface_snapshot/required", keyword: "required", params: { missingProperty: "edges" }, message: "must have required property 'edges'" };
          if (vErrors === null) {
            vErrors = [err224];
          } else {
            vErrors.push(err224);
          }
          errors++;
        }
        if (data94.entries === void 0) {
          const err225 = { instancePath: instancePath + "/final_surface_snapshot", schemaPath: "#/properties/final_surface_snapshot/required", keyword: "required", params: { missingProperty: "entries" }, message: "must have required property 'entries'" };
          if (vErrors === null) {
            vErrors = [err225];
          } else {
            vErrors.push(err225);
          }
          errors++;
        }
        if (data94.enabled_edge_ids === void 0) {
          const err226 = { instancePath: instancePath + "/final_surface_snapshot", schemaPath: "#/properties/final_surface_snapshot/required", keyword: "required", params: { missingProperty: "enabled_edge_ids" }, message: "must have required property 'enabled_edge_ids'" };
          if (vErrors === null) {
            vErrors = [err226];
          } else {
            vErrors.push(err226);
          }
          errors++;
        }
        if (data94.enabled_adjacency === void 0) {
          const err227 = { instancePath: instancePath + "/final_surface_snapshot", schemaPath: "#/properties/final_surface_snapshot/required", keyword: "required", params: { missingProperty: "enabled_adjacency" }, message: "must have required property 'enabled_adjacency'" };
          if (vErrors === null) {
            vErrors = [err227];
          } else {
            vErrors.push(err227);
          }
          errors++;
        }
        for (const key17 in data94) {
          if (!func1.call(schema109.properties.final_surface_snapshot.properties, key17)) {
            const err228 = { instancePath: instancePath + "/final_surface_snapshot", schemaPath: "#/properties/final_surface_snapshot/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key17 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err228];
            } else {
              vErrors.push(err228);
            }
            errors++;
          }
        }
        if (data94.host !== void 0) {
          let data95 = data94.host;
          if (typeof data95 === "string") {
            if (func2(data95) < 1) {
              const err229 = { instancePath: instancePath + "/final_surface_snapshot/host", schemaPath: "#/properties/final_surface_snapshot/properties/host/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err229];
              } else {
                vErrors.push(err229);
              }
              errors++;
            }
          } else {
            const err230 = { instancePath: instancePath + "/final_surface_snapshot/host", schemaPath: "#/properties/final_surface_snapshot/properties/host/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err230];
            } else {
              vErrors.push(err230);
            }
            errors++;
          }
        }
        if (data94.mode !== void 0) {
          let data96 = data94.mode;
          if (typeof data96 !== "string") {
            const err231 = { instancePath: instancePath + "/final_surface_snapshot/mode", schemaPath: "#/properties/final_surface_snapshot/properties/mode/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err231];
            } else {
              vErrors.push(err231);
            }
            errors++;
          }
          if (!(data96 === "full" || data96 === "partial")) {
            const err232 = { instancePath: instancePath + "/final_surface_snapshot/mode", schemaPath: "#/properties/final_surface_snapshot/properties/mode/enum", keyword: "enum", params: { allowedValues: schema109.properties.final_surface_snapshot.properties.mode.enum }, message: "must be equal to one of the allowed values" };
            if (vErrors === null) {
              vErrors = [err232];
            } else {
              vErrors.push(err232);
            }
            errors++;
          }
        }
        if (data94.final_root !== void 0) {
          let data97 = data94.final_root;
          if (typeof data97 === "string") {
            if (func2(data97) < 1) {
              const err233 = { instancePath: instancePath + "/final_surface_snapshot/final_root", schemaPath: "#/properties/final_surface_snapshot/properties/final_root/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err233];
              } else {
                vErrors.push(err233);
              }
              errors++;
            }
          } else {
            const err234 = { instancePath: instancePath + "/final_surface_snapshot/final_root", schemaPath: "#/properties/final_surface_snapshot/properties/final_root/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err234];
            } else {
              vErrors.push(err234);
            }
            errors++;
          }
        }
        if (data94.fileset_manifest !== void 0) {
          let data98 = data94.fileset_manifest;
          if (Array.isArray(data98)) {
            const len4 = data98.length;
            for (let i5 = 0; i5 < len4; i5++) {
              let data99 = data98[i5];
              if (typeof data99 === "string") {
                if (func2(data99) < 1) {
                  const err235 = { instancePath: instancePath + "/final_surface_snapshot/fileset_manifest/" + i5, schemaPath: "#/properties/final_surface_snapshot/properties/fileset_manifest/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err235];
                  } else {
                    vErrors.push(err235);
                  }
                  errors++;
                }
              } else {
                const err236 = { instancePath: instancePath + "/final_surface_snapshot/fileset_manifest/" + i5, schemaPath: "#/properties/final_surface_snapshot/properties/fileset_manifest/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err236];
                } else {
                  vErrors.push(err236);
                }
                errors++;
              }
            }
          } else {
            const err237 = { instancePath: instancePath + "/final_surface_snapshot/fileset_manifest", schemaPath: "#/properties/final_surface_snapshot/properties/fileset_manifest/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err237];
            } else {
              vErrors.push(err237);
            }
            errors++;
          }
        }
        if (data94.fileset !== void 0) {
          let data100 = data94.fileset;
          if (Array.isArray(data100)) {
            if (data100.length < 1) {
              const err238 = { instancePath: instancePath + "/final_surface_snapshot/fileset", schemaPath: "#/properties/final_surface_snapshot/properties/fileset/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
              if (vErrors === null) {
                vErrors = [err238];
              } else {
                vErrors.push(err238);
              }
              errors++;
            }
            const len5 = data100.length;
            for (let i6 = 0; i6 < len5; i6++) {
              let data101 = data100[i6];
              const _errs232 = errors;
              let valid70 = true;
              const _errs233 = errors;
              if (data101 && typeof data101 == "object" && !Array.isArray(data101)) {
                let missing3;
                if (data101.kind === void 0 && (missing3 = "kind")) {
                  const err239 = {};
                  if (vErrors === null) {
                    vErrors = [err239];
                  } else {
                    vErrors.push(err239);
                  }
                  errors++;
                } else {
                  if (data101.kind !== void 0) {
                    if ("file" !== data101.kind) {
                      const err240 = {};
                      if (vErrors === null) {
                        vErrors = [err240];
                      } else {
                        vErrors.push(err240);
                      }
                      errors++;
                    }
                  }
                }
              }
              var _valid3 = _errs233 === errors;
              errors = _errs232;
              if (vErrors !== null) {
                if (_errs232) {
                  vErrors.length = _errs232;
                } else {
                  vErrors = null;
                }
              }
              if (_valid3) {
                const _errs235 = errors;
                if (data101 && typeof data101 == "object" && !Array.isArray(data101)) {
                  if (data101.bytes === void 0) {
                    const err241 = { instancePath: instancePath + "/final_surface_snapshot/fileset/" + i6, schemaPath: "#/properties/final_surface_snapshot/properties/fileset/items/allOf/0/then/required", keyword: "required", params: { missingProperty: "bytes" }, message: "must have required property 'bytes'" };
                    if (vErrors === null) {
                      vErrors = [err241];
                    } else {
                      vErrors.push(err241);
                    }
                    errors++;
                  }
                  if (data101.sha256 === void 0) {
                    const err242 = { instancePath: instancePath + "/final_surface_snapshot/fileset/" + i6, schemaPath: "#/properties/final_surface_snapshot/properties/fileset/items/allOf/0/then/required", keyword: "required", params: { missingProperty: "sha256" }, message: "must have required property 'sha256'" };
                    if (vErrors === null) {
                      vErrors = [err242];
                    } else {
                      vErrors.push(err242);
                    }
                    errors++;
                  }
                }
                var _valid3 = _errs235 === errors;
                valid70 = _valid3;
              }
              if (!valid70) {
                const err243 = { instancePath: instancePath + "/final_surface_snapshot/fileset/" + i6, schemaPath: "#/properties/final_surface_snapshot/properties/fileset/items/allOf/0/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
                if (vErrors === null) {
                  vErrors = [err243];
                } else {
                  vErrors.push(err243);
                }
                errors++;
              }
              if (data101 && typeof data101 == "object" && !Array.isArray(data101)) {
                if (data101.path === void 0) {
                  const err244 = { instancePath: instancePath + "/final_surface_snapshot/fileset/" + i6, schemaPath: "#/properties/final_surface_snapshot/properties/fileset/items/required", keyword: "required", params: { missingProperty: "path" }, message: "must have required property 'path'" };
                  if (vErrors === null) {
                    vErrors = [err244];
                  } else {
                    vErrors.push(err244);
                  }
                  errors++;
                }
                if (data101.kind === void 0) {
                  const err245 = { instancePath: instancePath + "/final_surface_snapshot/fileset/" + i6, schemaPath: "#/properties/final_surface_snapshot/properties/fileset/items/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
                  if (vErrors === null) {
                    vErrors = [err245];
                  } else {
                    vErrors.push(err245);
                  }
                  errors++;
                }
                for (const key18 in data101) {
                  if (!(key18 === "path" || key18 === "kind" || key18 === "bytes" || key18 === "sha256")) {
                    const err246 = { instancePath: instancePath + "/final_surface_snapshot/fileset/" + i6, schemaPath: "#/properties/final_surface_snapshot/properties/fileset/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key18 }, message: "must NOT have additional properties" };
                    if (vErrors === null) {
                      vErrors = [err246];
                    } else {
                      vErrors.push(err246);
                    }
                    errors++;
                  }
                }
                if (data101.path !== void 0) {
                  let data103 = data101.path;
                  if (typeof data103 === "string") {
                    if (func2(data103) < 1) {
                      const err247 = { instancePath: instancePath + "/final_surface_snapshot/fileset/" + i6 + "/path", schemaPath: "#/properties/final_surface_snapshot/properties/fileset/items/properties/path/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                      if (vErrors === null) {
                        vErrors = [err247];
                      } else {
                        vErrors.push(err247);
                      }
                      errors++;
                    }
                  } else {
                    const err248 = { instancePath: instancePath + "/final_surface_snapshot/fileset/" + i6 + "/path", schemaPath: "#/properties/final_surface_snapshot/properties/fileset/items/properties/path/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    if (vErrors === null) {
                      vErrors = [err248];
                    } else {
                      vErrors.push(err248);
                    }
                    errors++;
                  }
                }
                if (data101.kind !== void 0) {
                  let data104 = data101.kind;
                  if (typeof data104 !== "string") {
                    const err249 = { instancePath: instancePath + "/final_surface_snapshot/fileset/" + i6 + "/kind", schemaPath: "#/properties/final_surface_snapshot/properties/fileset/items/properties/kind/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    if (vErrors === null) {
                      vErrors = [err249];
                    } else {
                      vErrors.push(err249);
                    }
                    errors++;
                  }
                  if (!(data104 === "file" || data104 === "dir" || data104 === "symlink")) {
                    const err250 = { instancePath: instancePath + "/final_surface_snapshot/fileset/" + i6 + "/kind", schemaPath: "#/properties/final_surface_snapshot/properties/fileset/items/properties/kind/enum", keyword: "enum", params: { allowedValues: schema109.properties.final_surface_snapshot.properties.fileset.items.properties.kind.enum }, message: "must be equal to one of the allowed values" };
                    if (vErrors === null) {
                      vErrors = [err250];
                    } else {
                      vErrors.push(err250);
                    }
                    errors++;
                  }
                }
                if (data101.bytes !== void 0) {
                  let data105 = data101.bytes;
                  if (!(typeof data105 == "number" && (!(data105 % 1) && !isNaN(data105)))) {
                    const err251 = { instancePath: instancePath + "/final_surface_snapshot/fileset/" + i6 + "/bytes", schemaPath: "#/properties/final_surface_snapshot/properties/fileset/items/properties/bytes/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                    if (vErrors === null) {
                      vErrors = [err251];
                    } else {
                      vErrors.push(err251);
                    }
                    errors++;
                  }
                  if (typeof data105 == "number") {
                    if (data105 < 0 || isNaN(data105)) {
                      const err252 = { instancePath: instancePath + "/final_surface_snapshot/fileset/" + i6 + "/bytes", schemaPath: "#/properties/final_surface_snapshot/properties/fileset/items/properties/bytes/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
                      if (vErrors === null) {
                        vErrors = [err252];
                      } else {
                        vErrors.push(err252);
                      }
                      errors++;
                    }
                  }
                }
                if (data101.sha256 !== void 0) {
                  let data106 = data101.sha256;
                  if (typeof data106 === "string") {
                    if (!pattern6.test(data106)) {
                      const err253 = { instancePath: instancePath + "/final_surface_snapshot/fileset/" + i6 + "/sha256", schemaPath: "#/$defs/sha256/pattern", keyword: "pattern", params: { pattern: "^[a-f0-9]{64}$" }, message: 'must match pattern "^[a-f0-9]{64}$"' };
                      if (vErrors === null) {
                        vErrors = [err253];
                      } else {
                        vErrors.push(err253);
                      }
                      errors++;
                    }
                  } else {
                    const err254 = { instancePath: instancePath + "/final_surface_snapshot/fileset/" + i6 + "/sha256", schemaPath: "#/$defs/sha256/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    if (vErrors === null) {
                      vErrors = [err254];
                    } else {
                      vErrors.push(err254);
                    }
                    errors++;
                  }
                }
              } else {
                const err255 = { instancePath: instancePath + "/final_surface_snapshot/fileset/" + i6, schemaPath: "#/properties/final_surface_snapshot/properties/fileset/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err255];
                } else {
                  vErrors.push(err255);
                }
                errors++;
              }
            }
          } else {
            const err256 = { instancePath: instancePath + "/final_surface_snapshot/fileset", schemaPath: "#/properties/final_surface_snapshot/properties/fileset/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err256];
            } else {
              vErrors.push(err256);
            }
            errors++;
          }
        }
        if (data94.skills !== void 0) {
          if (!Array.isArray(data94.skills)) {
            const err257 = { instancePath: instancePath + "/final_surface_snapshot/skills", schemaPath: "#/properties/final_surface_snapshot/properties/skills/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err257];
            } else {
              vErrors.push(err257);
            }
            errors++;
          }
        }
        if (data94.modules !== void 0) {
          if (!Array.isArray(data94.modules)) {
            const err258 = { instancePath: instancePath + "/final_surface_snapshot/modules", schemaPath: "#/properties/final_surface_snapshot/properties/modules/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err258];
            } else {
              vErrors.push(err258);
            }
            errors++;
          }
        }
        if (data94.points !== void 0) {
          if (!Array.isArray(data94.points)) {
            const err259 = { instancePath: instancePath + "/final_surface_snapshot/points", schemaPath: "#/properties/final_surface_snapshot/properties/points/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err259];
            } else {
              vErrors.push(err259);
            }
            errors++;
          }
        }
        if (data94.edges !== void 0) {
          if (!Array.isArray(data94.edges)) {
            const err260 = { instancePath: instancePath + "/final_surface_snapshot/edges", schemaPath: "#/properties/final_surface_snapshot/properties/edges/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err260];
            } else {
              vErrors.push(err260);
            }
            errors++;
          }
        }
        if (data94.entries !== void 0) {
          if (!Array.isArray(data94.entries)) {
            const err261 = { instancePath: instancePath + "/final_surface_snapshot/entries", schemaPath: "#/properties/final_surface_snapshot/properties/entries/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err261];
            } else {
              vErrors.push(err261);
            }
            errors++;
          }
        }
        if (data94.enabled_edge_ids !== void 0) {
          let data112 = data94.enabled_edge_ids;
          if (Array.isArray(data112)) {
            const len6 = data112.length;
            for (let i7 = 0; i7 < len6; i7++) {
              let data113 = data112[i7];
              if (typeof data113 === "string") {
                if (func2(data113) < 1) {
                  const err262 = { instancePath: instancePath + "/final_surface_snapshot/enabled_edge_ids/" + i7, schemaPath: "#/properties/final_surface_snapshot/properties/enabled_edge_ids/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err262];
                  } else {
                    vErrors.push(err262);
                  }
                  errors++;
                }
              } else {
                const err263 = { instancePath: instancePath + "/final_surface_snapshot/enabled_edge_ids/" + i7, schemaPath: "#/properties/final_surface_snapshot/properties/enabled_edge_ids/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err263];
                } else {
                  vErrors.push(err263);
                }
                errors++;
              }
            }
          } else {
            const err264 = { instancePath: instancePath + "/final_surface_snapshot/enabled_edge_ids", schemaPath: "#/properties/final_surface_snapshot/properties/enabled_edge_ids/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err264];
            } else {
              vErrors.push(err264);
            }
            errors++;
          }
        }
        if (data94.enabled_adjacency !== void 0) {
          let data114 = data94.enabled_adjacency;
          if (!(data114 && typeof data114 == "object" && !Array.isArray(data114))) {
            const err265 = { instancePath: instancePath + "/final_surface_snapshot/enabled_adjacency", schemaPath: "#/properties/final_surface_snapshot/properties/enabled_adjacency/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err265];
            } else {
              vErrors.push(err265);
            }
            errors++;
          }
        }
      } else {
        const err266 = { instancePath: instancePath + "/final_surface_snapshot", schemaPath: "#/properties/final_surface_snapshot/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err266];
        } else {
          vErrors.push(err266);
        }
        errors++;
      }
    }
  } else {
    const err267 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err267];
    } else {
      vErrors.push(err267);
    }
    errors++;
  }
  validate77.errors = vErrors;
  return errors === 0;
}
validate77.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var schema124 = { "type": "object", "additionalProperties": false, "required": ["severity", "code", "message", "location", "witness", "remediation"], "properties": { "severity": { "enum": ["error", "warning", "debt", "info"] }, "code": { "type": "string", "pattern": "^SKG-[A-Z0-9-]+$" }, "message": { "$ref": "#/$defs/nonEmptyString" }, "location": { "$ref": "#/$defs/nonEmptyString" }, "witness": { "type": "object" }, "remediation": { "$ref": "#/$defs/nonEmptyString" } } };
var pattern46 = new RegExp("^SKG-[A-Z0-9-]+$", "u");
function validate82(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate82.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.severity === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "severity" }, message: "must have required property 'severity'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.code === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "code" }, message: "must have required property 'code'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.message === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "message" }, message: "must have required property 'message'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.location === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "location" }, message: "must have required property 'location'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.witness === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "witness" }, message: "must have required property 'witness'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.remediation === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "remediation" }, message: "must have required property 'remediation'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "severity" || key0 === "code" || key0 === "message" || key0 === "location" || key0 === "witness" || key0 === "remediation")) {
        const err6 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.severity !== void 0) {
      let data0 = data.severity;
      if (!(data0 === "error" || data0 === "warning" || data0 === "debt" || data0 === "info")) {
        const err7 = { instancePath: instancePath + "/severity", schemaPath: "#/properties/severity/enum", keyword: "enum", params: { allowedValues: schema124.properties.severity.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.code !== void 0) {
      let data1 = data.code;
      if (typeof data1 === "string") {
        if (!pattern46.test(data1)) {
          const err8 = { instancePath: instancePath + "/code", schemaPath: "#/properties/code/pattern", keyword: "pattern", params: { pattern: "^SKG-[A-Z0-9-]+$" }, message: 'must match pattern "^SKG-[A-Z0-9-]+$"' };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
      } else {
        const err9 = { instancePath: instancePath + "/code", schemaPath: "#/properties/code/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.message !== void 0) {
      let data2 = data.message;
      if (typeof data2 === "string") {
        if (func2(data2) < 1) {
          const err10 = { instancePath: instancePath + "/message", schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
      } else {
        const err11 = { instancePath: instancePath + "/message", schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.location !== void 0) {
      let data3 = data.location;
      if (typeof data3 === "string") {
        if (func2(data3) < 1) {
          const err12 = { instancePath: instancePath + "/location", schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
      } else {
        const err13 = { instancePath: instancePath + "/location", schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
    if (data.witness !== void 0) {
      let data4 = data.witness;
      if (!(data4 && typeof data4 == "object" && !Array.isArray(data4))) {
        const err14 = { instancePath: instancePath + "/witness", schemaPath: "#/properties/witness/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
    }
    if (data.remediation !== void 0) {
      let data5 = data.remediation;
      if (typeof data5 === "string") {
        if (func2(data5) < 1) {
          const err15 = { instancePath: instancePath + "/remediation", schemaPath: "#/$defs/nonEmptyString/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
      } else {
        const err16 = { instancePath: instancePath + "/remediation", schemaPath: "#/$defs/nonEmptyString/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
    }
  } else {
    const err17 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err17];
    } else {
      vErrors.push(err17);
    }
    errors++;
  }
  validate82.errors = vErrors;
  return errors === 0;
}
validate82.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate75(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate75.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.schema_version === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "schema_version" }, message: "must have required property 'schema_version'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.kind === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.change_id === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "change_id" }, message: "must have required property 'change_id'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.base_ref === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "base_ref" }, message: "must have required property 'base_ref'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.base_graph_sha256 === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "base_graph_sha256" }, message: "must have required property 'base_graph_sha256'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.scope === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "scope" }, message: "must have required property 'scope'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    if (data.result_graph_sha256 === void 0) {
      const err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "result_graph_sha256" }, message: "must have required property 'result_graph_sha256'" };
      if (vErrors === null) {
        vErrors = [err6];
      } else {
        vErrors.push(err6);
      }
      errors++;
    }
    if (data.candidate_valid === void 0) {
      const err7 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "candidate_valid" }, message: "must have required property 'candidate_valid'" };
      if (vErrors === null) {
        vErrors = [err7];
      } else {
        vErrors.push(err7);
      }
      errors++;
    }
    if (data.candidate_runtime_valid === void 0) {
      const err8 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "candidate_runtime_valid" }, message: "must have required property 'candidate_runtime_valid'" };
      if (vErrors === null) {
        vErrors = [err8];
      } else {
        vErrors.push(err8);
      }
      errors++;
    }
    if (data.optimistic_lock_valid === void 0) {
      const err9 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "optimistic_lock_valid" }, message: "must have required property 'optimistic_lock_valid'" };
      if (vErrors === null) {
        vErrors = [err9];
      } else {
        vErrors.push(err9);
      }
      errors++;
    }
    if (data.git_apply_check === void 0) {
      const err10 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "git_apply_check" }, message: "must have required property 'git_apply_check'" };
      if (vErrors === null) {
        vErrors = [err10];
      } else {
        vErrors.push(err10);
      }
      errors++;
    }
    if (data.patch_sha256 === void 0) {
      const err11 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "patch_sha256" }, message: "must have required property 'patch_sha256'" };
      if (vErrors === null) {
        vErrors = [err11];
      } else {
        vErrors.push(err11);
      }
      errors++;
    }
    if (data.host_projection_witnesses === void 0) {
      const err12 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "host_projection_witnesses" }, message: "must have required property 'host_projection_witnesses'" };
      if (vErrors === null) {
        vErrors = [err12];
      } else {
        vErrors.push(err12);
      }
      errors++;
    }
    if (data.diagnostics === void 0) {
      const err13 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "diagnostics" }, message: "must have required property 'diagnostics'" };
      if (vErrors === null) {
        vErrors = [err13];
      } else {
        vErrors.push(err13);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func1.call(schema103.properties, key0)) {
        const err14 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
    }
    if (data.schema_version !== void 0) {
      if ("cc-master/skill-knowledge-validation/v1alpha1" !== data.schema_version) {
        const err15 = { instancePath: instancePath + "/schema_version", schemaPath: "#/properties/schema_version/const", keyword: "const", params: { allowedValue: "cc-master/skill-knowledge-validation/v1alpha1" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err15];
        } else {
          vErrors.push(err15);
        }
        errors++;
      }
    }
    if (data.kind !== void 0) {
      if ("change_validation" !== data.kind) {
        const err16 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "change_validation" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
    }
    if (data.change_id !== void 0) {
      let data2 = data.change_id;
      if (typeof data2 === "string") {
        if (!pattern4.test(data2)) {
          const err17 = { instancePath: instancePath + "/change_id", schemaPath: "#/$defs/changeId/pattern", keyword: "pattern", params: { pattern: "^change:[0-9]{8}\\.[a-z0-9][a-z0-9.-]*$" }, message: 'must match pattern "^change:[0-9]{8}\\.[a-z0-9][a-z0-9.-]*$"' };
          if (vErrors === null) {
            vErrors = [err17];
          } else {
            vErrors.push(err17);
          }
          errors++;
        }
      } else {
        const err18 = { instancePath: instancePath + "/change_id", schemaPath: "#/$defs/changeId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err18];
        } else {
          vErrors.push(err18);
        }
        errors++;
      }
    }
    if (data.base_ref !== void 0) {
      let data3 = data.base_ref;
      if (typeof data3 === "string") {
        if (func2(data3) < 1) {
          const err19 = { instancePath: instancePath + "/base_ref", schemaPath: "#/$defs/gitRef/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err19];
          } else {
            vErrors.push(err19);
          }
          errors++;
        }
        if (!pattern5.test(data3)) {
          const err20 = { instancePath: instancePath + "/base_ref", schemaPath: "#/$defs/gitRef/pattern", keyword: "pattern", params: { pattern: "^[^\\s\\u0000]+$" }, message: 'must match pattern "^[^\\s\\u0000]+$"' };
          if (vErrors === null) {
            vErrors = [err20];
          } else {
            vErrors.push(err20);
          }
          errors++;
        }
      } else {
        const err21 = { instancePath: instancePath + "/base_ref", schemaPath: "#/$defs/gitRef/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err21];
        } else {
          vErrors.push(err21);
        }
        errors++;
      }
    }
    if (data.base_graph_sha256 !== void 0) {
      let data4 = data.base_graph_sha256;
      if (typeof data4 === "string") {
        if (!pattern6.test(data4)) {
          const err22 = { instancePath: instancePath + "/base_graph_sha256", schemaPath: "#/$defs/sha256/pattern", keyword: "pattern", params: { pattern: "^[a-f0-9]{64}$" }, message: 'must match pattern "^[a-f0-9]{64}$"' };
          if (vErrors === null) {
            vErrors = [err22];
          } else {
            vErrors.push(err22);
          }
          errors++;
        }
      } else {
        const err23 = { instancePath: instancePath + "/base_graph_sha256", schemaPath: "#/$defs/sha256/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err23];
        } else {
          vErrors.push(err23);
        }
        errors++;
      }
    }
    if (data.scope !== void 0) {
      let data5 = data.scope;
      if (Array.isArray(data5)) {
        if (data5.length < 1) {
          const err24 = { instancePath: instancePath + "/scope", schemaPath: "#/properties/scope/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          if (vErrors === null) {
            vErrors = [err24];
          } else {
            vErrors.push(err24);
          }
          errors++;
        }
        const len0 = data5.length;
        for (let i0 = 0; i0 < len0; i0++) {
          if (!validate72(data5[i0], { instancePath: instancePath + "/scope/" + i0, parentData: data5, parentDataProperty: i0, rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err25 = { instancePath: instancePath + "/scope", schemaPath: "#/properties/scope/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err25];
        } else {
          vErrors.push(err25);
        }
        errors++;
      }
    }
    if (data.result_graph_sha256 !== void 0) {
      let data7 = data.result_graph_sha256;
      if (typeof data7 === "string") {
        if (!pattern6.test(data7)) {
          const err26 = { instancePath: instancePath + "/result_graph_sha256", schemaPath: "#/$defs/sha256/pattern", keyword: "pattern", params: { pattern: "^[a-f0-9]{64}$" }, message: 'must match pattern "^[a-f0-9]{64}$"' };
          if (vErrors === null) {
            vErrors = [err26];
          } else {
            vErrors.push(err26);
          }
          errors++;
        }
      } else {
        const err27 = { instancePath: instancePath + "/result_graph_sha256", schemaPath: "#/$defs/sha256/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err27];
        } else {
          vErrors.push(err27);
        }
        errors++;
      }
    }
    if (data.candidate_valid !== void 0) {
      if (typeof data.candidate_valid !== "boolean") {
        const err28 = { instancePath: instancePath + "/candidate_valid", schemaPath: "#/properties/candidate_valid/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
        if (vErrors === null) {
          vErrors = [err28];
        } else {
          vErrors.push(err28);
        }
        errors++;
      }
    }
    if (data.candidate_runtime_valid !== void 0) {
      if (typeof data.candidate_runtime_valid !== "boolean") {
        const err29 = { instancePath: instancePath + "/candidate_runtime_valid", schemaPath: "#/properties/candidate_runtime_valid/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
        if (vErrors === null) {
          vErrors = [err29];
        } else {
          vErrors.push(err29);
        }
        errors++;
      }
    }
    if (data.optimistic_lock_valid !== void 0) {
      if (typeof data.optimistic_lock_valid !== "boolean") {
        const err30 = { instancePath: instancePath + "/optimistic_lock_valid", schemaPath: "#/properties/optimistic_lock_valid/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
        if (vErrors === null) {
          vErrors = [err30];
        } else {
          vErrors.push(err30);
        }
        errors++;
      }
    }
    if (data.git_apply_check !== void 0) {
      if (typeof data.git_apply_check !== "boolean") {
        const err31 = { instancePath: instancePath + "/git_apply_check", schemaPath: "#/properties/git_apply_check/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
        if (vErrors === null) {
          vErrors = [err31];
        } else {
          vErrors.push(err31);
        }
        errors++;
      }
    }
    if (data.patch_sha256 !== void 0) {
      let data12 = data.patch_sha256;
      if (typeof data12 === "string") {
        if (!pattern6.test(data12)) {
          const err32 = { instancePath: instancePath + "/patch_sha256", schemaPath: "#/$defs/sha256/pattern", keyword: "pattern", params: { pattern: "^[a-f0-9]{64}$" }, message: 'must match pattern "^[a-f0-9]{64}$"' };
          if (vErrors === null) {
            vErrors = [err32];
          } else {
            vErrors.push(err32);
          }
          errors++;
        }
      } else {
        const err33 = { instancePath: instancePath + "/patch_sha256", schemaPath: "#/$defs/sha256/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err33];
        } else {
          vErrors.push(err33);
        }
        errors++;
      }
    }
    if (data.host_projection_witnesses !== void 0) {
      let data13 = data.host_projection_witnesses;
      if (Array.isArray(data13)) {
        if (data13.length > 4) {
          const err34 = { instancePath: instancePath + "/host_projection_witnesses", schemaPath: "#/properties/host_projection_witnesses/maxItems", keyword: "maxItems", params: { limit: 4 }, message: "must NOT have more than 4 items" };
          if (vErrors === null) {
            vErrors = [err34];
          } else {
            vErrors.push(err34);
          }
          errors++;
        }
        if (data13.length < 4) {
          const err35 = { instancePath: instancePath + "/host_projection_witnesses", schemaPath: "#/properties/host_projection_witnesses/minItems", keyword: "minItems", params: { limit: 4 }, message: "must NOT have fewer than 4 items" };
          if (vErrors === null) {
            vErrors = [err35];
          } else {
            vErrors.push(err35);
          }
          errors++;
        }
        const len1 = data13.length;
        if (len1 > 0) {
          let data14 = data13[0];
          if (!validate77(data14, { instancePath: instancePath + "/host_projection_witnesses/0", parentData: data13, parentDataProperty: 0, rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate77.errors : vErrors.concat(validate77.errors);
            errors = vErrors.length;
          }
          if (data14 && typeof data14 == "object" && !Array.isArray(data14)) {
            if (data14.host === void 0) {
              const err36 = { instancePath: instancePath + "/host_projection_witnesses/0", schemaPath: "#/properties/host_projection_witnesses/prefixItems/0/allOf/1/required", keyword: "required", params: { missingProperty: "host" }, message: "must have required property 'host'" };
              if (vErrors === null) {
                vErrors = [err36];
              } else {
                vErrors.push(err36);
              }
              errors++;
            }
            if (data14.host !== void 0) {
              if ("claude-code" !== data14.host) {
                const err37 = { instancePath: instancePath + "/host_projection_witnesses/0/host", schemaPath: "#/properties/host_projection_witnesses/prefixItems/0/allOf/1/properties/host/const", keyword: "const", params: { allowedValue: "claude-code" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err37];
                } else {
                  vErrors.push(err37);
                }
                errors++;
              }
            }
          }
        }
        if (len1 > 1) {
          let data16 = data13[1];
          if (!validate77(data16, { instancePath: instancePath + "/host_projection_witnesses/1", parentData: data13, parentDataProperty: 1, rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate77.errors : vErrors.concat(validate77.errors);
            errors = vErrors.length;
          }
          if (data16 && typeof data16 == "object" && !Array.isArray(data16)) {
            if (data16.host === void 0) {
              const err38 = { instancePath: instancePath + "/host_projection_witnesses/1", schemaPath: "#/properties/host_projection_witnesses/prefixItems/1/allOf/1/required", keyword: "required", params: { missingProperty: "host" }, message: "must have required property 'host'" };
              if (vErrors === null) {
                vErrors = [err38];
              } else {
                vErrors.push(err38);
              }
              errors++;
            }
            if (data16.host !== void 0) {
              if ("codex" !== data16.host) {
                const err39 = { instancePath: instancePath + "/host_projection_witnesses/1/host", schemaPath: "#/properties/host_projection_witnesses/prefixItems/1/allOf/1/properties/host/const", keyword: "const", params: { allowedValue: "codex" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err39];
                } else {
                  vErrors.push(err39);
                }
                errors++;
              }
            }
          }
        }
        if (len1 > 2) {
          let data18 = data13[2];
          if (!validate77(data18, { instancePath: instancePath + "/host_projection_witnesses/2", parentData: data13, parentDataProperty: 2, rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate77.errors : vErrors.concat(validate77.errors);
            errors = vErrors.length;
          }
          if (data18 && typeof data18 == "object" && !Array.isArray(data18)) {
            if (data18.host === void 0) {
              const err40 = { instancePath: instancePath + "/host_projection_witnesses/2", schemaPath: "#/properties/host_projection_witnesses/prefixItems/2/allOf/1/required", keyword: "required", params: { missingProperty: "host" }, message: "must have required property 'host'" };
              if (vErrors === null) {
                vErrors = [err40];
              } else {
                vErrors.push(err40);
              }
              errors++;
            }
            if (data18.host !== void 0) {
              if ("cursor" !== data18.host) {
                const err41 = { instancePath: instancePath + "/host_projection_witnesses/2/host", schemaPath: "#/properties/host_projection_witnesses/prefixItems/2/allOf/1/properties/host/const", keyword: "const", params: { allowedValue: "cursor" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err41];
                } else {
                  vErrors.push(err41);
                }
                errors++;
              }
            }
          }
        }
        if (len1 > 3) {
          let data20 = data13[3];
          if (!validate77(data20, { instancePath: instancePath + "/host_projection_witnesses/3", parentData: data13, parentDataProperty: 3, rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate77.errors : vErrors.concat(validate77.errors);
            errors = vErrors.length;
          }
          if (data20 && typeof data20 == "object" && !Array.isArray(data20)) {
            if (data20.host === void 0) {
              const err42 = { instancePath: instancePath + "/host_projection_witnesses/3", schemaPath: "#/properties/host_projection_witnesses/prefixItems/3/allOf/1/required", keyword: "required", params: { missingProperty: "host" }, message: "must have required property 'host'" };
              if (vErrors === null) {
                vErrors = [err42];
              } else {
                vErrors.push(err42);
              }
              errors++;
            }
            if (data20.host !== void 0) {
              if ("kimi-code" !== data20.host) {
                const err43 = { instancePath: instancePath + "/host_projection_witnesses/3/host", schemaPath: "#/properties/host_projection_witnesses/prefixItems/3/allOf/1/properties/host/const", keyword: "const", params: { allowedValue: "kimi-code" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err43];
                } else {
                  vErrors.push(err43);
                }
                errors++;
              }
            }
          }
        }
        const len2 = data13.length;
        if (!(len2 <= 4)) {
          const err44 = { instancePath: instancePath + "/host_projection_witnesses", schemaPath: "#/properties/host_projection_witnesses/items", keyword: "items", params: { limit: 4 }, message: "must NOT have more than 4 items" };
          if (vErrors === null) {
            vErrors = [err44];
          } else {
            vErrors.push(err44);
          }
          errors++;
        }
      } else {
        const err45 = { instancePath: instancePath + "/host_projection_witnesses", schemaPath: "#/properties/host_projection_witnesses/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err45];
        } else {
          vErrors.push(err45);
        }
        errors++;
      }
    }
    if (data.diagnostics !== void 0) {
      let data22 = data.diagnostics;
      if (Array.isArray(data22)) {
        const len3 = data22.length;
        for (let i1 = 0; i1 < len3; i1++) {
          if (!validate82(data22[i1], { instancePath: instancePath + "/diagnostics/" + i1, parentData: data22, parentDataProperty: i1, rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate82.errors : vErrors.concat(validate82.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err46 = { instancePath: instancePath + "/diagnostics", schemaPath: "#/properties/diagnostics/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err46];
        } else {
          vErrors.push(err46);
        }
        errors++;
      }
    }
  } else {
    const err47 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err47];
    } else {
      vErrors.push(err47);
    }
    errors++;
  }
  validate75.errors = vErrors;
  return errors === 0;
}
validate75.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
function validate20(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  ;
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate20.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  const _errs0 = errors;
  let valid0 = false;
  let passing0 = null;
  const _errs1 = errors;
  if (!validate21(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })) {
    vErrors = vErrors === null ? validate21.errors : vErrors.concat(validate21.errors);
    errors = vErrors.length;
  }
  var _valid0 = _errs1 === errors;
  if (_valid0) {
    valid0 = true;
    passing0 = 0;
    var props0 = true;
  }
  const _errs2 = errors;
  if (!validate71(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })) {
    vErrors = vErrors === null ? validate71.errors : vErrors.concat(validate71.errors);
    errors = vErrors.length;
  }
  var _valid0 = _errs2 === errors;
  if (_valid0 && valid0) {
    valid0 = false;
    passing0 = [passing0, 1];
  } else {
    if (_valid0) {
      valid0 = true;
      passing0 = 1;
      if (props0 !== true) {
        props0 = true;
      }
    }
    const _errs3 = errors;
    if (!validate75(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })) {
      vErrors = vErrors === null ? validate75.errors : vErrors.concat(validate75.errors);
      errors = vErrors.length;
    }
    var _valid0 = _errs3 === errors;
    if (_valid0 && valid0) {
      valid0 = false;
      passing0 = [passing0, 2];
    } else {
      if (_valid0) {
        valid0 = true;
        passing0 = 2;
        if (props0 !== true) {
          props0 = true;
        }
      }
    }
  }
  if (!valid0) {
    const err0 = { instancePath, schemaPath: "#/oneOf", keyword: "oneOf", params: { passingSchemas: passing0 }, message: "must match exactly one schema in oneOf" };
    if (vErrors === null) {
      vErrors = [err0];
    } else {
      vErrors.push(err0);
    }
    errors++;
  } else {
    errors = _errs0;
    if (vErrors !== null) {
      if (_errs0) {
        vErrors.length = _errs0;
      } else {
        vErrors = null;
      }
    }
  }
  validate20.errors = vErrors;
  evaluated0.props = props0;
  return errors === 0;
}
validate20.evaluated = { "dynamicProps": true, "dynamicItems": false };
