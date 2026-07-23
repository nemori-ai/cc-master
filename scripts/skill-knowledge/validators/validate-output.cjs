/**
 * Generated standalone Draft 2020-12 validator (bundled).
 * Source: design_docs/skill-knowledge-graph/schemas/knowledge-cli-output.schema.json
 * Source-schema-sha256: 44dd42936aea7abf7deb1717aab19924f097b9f764eb078e0528c95f5a7ae12e
 * Schema-fingerprint: 58d87586d8b6dbb1d2ab72d1fd754a16371d69b6f06434c5177277f520710373
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

// raw/validate-output.cjs
module.exports = validate20;
module.exports.default = validate20;
var schema31 = { "$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "https://cc-master.dev/schemas/skill-knowledge-cli-output-v1alpha1.json", "title": "cc-master skill knowledge CLI output", "description": "Machine-readable envelope for contract, check, usage, and fail-closed capability results.", "type": "object", "unevaluatedProperties": false, "required": ["schema", "ok", "command", "result_kind", "contract_version"], "properties": { "schema": { "const": "cc-master/skill-knowledge-cli/v1alpha1" }, "ok": { "type": "boolean" }, "command": { "type": "string", "minLength": 1 }, "result_kind": { "enum": ["contract", "check", "report", "change", "diagnostic"] }, "contract_version": { "const": "v1alpha1" }, "implemented_commands": { "$ref": "#/$defs/stringSet" }, "declared_commands": { "$ref": "#/$defs/stringSet" }, "operations": { "$ref": "#/$defs/stringSet" }, "planes": { "$ref": "#/$defs/stringSet" }, "invariants": { "$ref": "#/$defs/stringSet" }, "exit_codes": { "type": "object", "minProperties": 1, "additionalProperties": { "type": "integer", "minimum": 0, "maximum": 255 } }, "schemas": { "type": "object", "additionalProperties": false, "required": ["source", "change", "output", "cli"], "properties": { "source": { "$ref": "#/$defs/repoPath" }, "change": { "$ref": "#/$defs/repoPath" }, "output": { "$ref": "#/$defs/repoPath" }, "cli": { "$ref": "#/$defs/repoPath" } } }, "source_layout": { "type": "object", "additionalProperties": false, "required": ["root", "portfolio", "changes", "skills"], "properties": { "root": { "$ref": "#/$defs/repoPath" }, "portfolio": { "$ref": "#/$defs/repoPath" }, "changes": { "$ref": "#/$defs/repoPath" }, "skills": { "type": "string", "minLength": 1 } } }, "stage": { "enum": ["K0", "K1", "K2", "K3"] }, "source_root": { "type": "string", "minLength": 1 }, "summary": { "$ref": "#/$defs/summary" }, "capabilities": { "$ref": "#/$defs/capabilities" }, "hardening_contract": { "$ref": "#/$defs/hardeningContract" }, "structural_status": { "$ref": "#/$defs/structuralStatus" }, "behavioral_evidence_status": { "$ref": "#/$defs/behavioralEvidenceStatus" }, "improvement_claim": { "type": "string", "minLength": 1 }, "action": { "enum": ["begin", "validate", "apply"] }, "workspace": { "$ref": "#/$defs/repoPath" }, "ledger_path": { "$ref": "#/$defs/repoPath" }, "result_graph_sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }, "validation": { "type": "object" }, "diagnostics": { "type": "array", "items": { "$ref": "#/$defs/diagnostic" } } }, "allOf": [{ "if": { "properties": { "result_kind": { "const": "change" } }, "required": ["result_kind"] }, "then": { "required": ["action", "diagnostics"] } }, { "if": { "properties": { "result_kind": { "const": "contract" }, "ok": { "const": true } }, "required": ["result_kind", "ok"] }, "then": { "required": ["implemented_commands", "declared_commands", "operations", "planes", "invariants", "exit_codes", "schemas", "source_layout", "capabilities", "hardening_contract"] } }, { "if": { "properties": { "result_kind": { "const": "report" } }, "required": ["result_kind"] }, "then": { "required": ["structural_status", "behavioral_evidence_status", "diagnostics"] } }, { "if": { "properties": { "result_kind": { "const": "check" } }, "required": ["result_kind"] }, "then": { "required": ["stage", "source_root", "summary", "capabilities", "diagnostics"] } }, { "if": { "properties": { "ok": { "const": false } }, "required": ["ok"] }, "then": { "required": ["diagnostics"], "properties": { "diagnostics": { "minItems": 1 } } } }, { "if": { "required": ["improvement_claim"] }, "then": { "properties": { "behavioral_evidence_status": { "properties": { "state": { "const": "holdout_verdict" } }, "required": ["state"] } }, "required": ["behavioral_evidence_status"] } }], "$defs": { "repoPath": { "type": "string", "minLength": 1, "pattern": "^[A-Za-z0-9._<>/-]+$" }, "stringSet": { "type": "array", "items": { "type": "string", "minLength": 1 }, "uniqueItems": true }, "capabilities": { "type": "object", "additionalProperties": false, "required": ["source_json_parse", "source_envelope_validation", "global_id_uniqueness", "full_json_schema_validation", "markdown_binding", "graph_invariants", "runtime_projection", "hop_analysis", "typed_change_transactions", "entry_surface_binding", "canonical_source_inventory", "derived_freshness", "canonical_graph_hash", "deterministic_budget_estimator", "host_portability_probe", "semantic_coverage", "behavioral_evidence_tracking"], "properties": { "source_json_parse": { "type": "boolean" }, "source_envelope_validation": { "type": "boolean" }, "global_id_uniqueness": { "type": "boolean" }, "full_json_schema_validation": { "type": "boolean" }, "markdown_binding": { "type": "boolean" }, "graph_invariants": { "type": "boolean" }, "runtime_projection": { "type": "boolean" }, "hop_analysis": { "type": "boolean" }, "typed_change_transactions": { "type": "boolean" }, "entry_surface_binding": { "type": "boolean" }, "canonical_source_inventory": { "type": "boolean" }, "derived_freshness": { "type": "boolean" }, "canonical_graph_hash": { "type": "boolean" }, "deterministic_budget_estimator": { "type": "boolean" }, "host_portability_probe": { "type": "boolean" }, "semantic_coverage": { "type": "boolean" }, "behavioral_evidence_tracking": { "type": "boolean" } } }, "hardeningContract": { "type": "object", "additionalProperties": false, "required": ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11", "C12", "C13", "C14"], "properties": { "C1": { "type": "object", "additionalProperties": false, "required": ["entry_surface_fields"], "properties": { "entry_surface_fields": { "const": ["host", "source_file", "binding", "surface_kind", "targets", "lifecycle"] } } }, "C2": { "type": "object", "additionalProperties": false, "required": ["coverage_states", "denominator"], "properties": { "coverage_states": { "const": ["full", "partial", "non_knowledge", "excluded"] }, "denominator": { "const": "git_canonical_markdown" } } }, "C3": { "type": "object", "additionalProperties": false, "required": ["derived_fields"], "properties": { "derived_fields": { "const": ["canonical", "review_policy", "reviewed_canonical_sha256"] } } }, "C4": { "type": "object", "additionalProperties": false, "required": ["accepted_skill_requires_admission"], "properties": { "accepted_skill_requires_admission": { "const": true } } }, "C5": { "type": "object", "additionalProperties": false, "required": ["change_workflow", "workspace_root"], "properties": { "change_workflow": { "const": ["begin", "validate", "apply"] }, "workspace_root": { "const": ".skill-knowledge/workspaces/<change-id>" } } }, "C6": { "type": "object", "additionalProperties": false, "required": ["algorithm", "authored_manifest_kinds", "change_head_digest_excludes", "identity_set_fields", "semantic_order_fields"], "properties": { "algorithm": { "const": "cc-master/skill-knowledge-canonical-graph-hash/v1" }, "authored_manifest_kinds": { "const": ["portfolio", "skill", "module"] }, "change_head_digest_excludes": { "const": ["result_graph_sha256"] }, "identity_set_fields": { "const": ["skills", "modules", "points", "edges", "entries", "canonical_source_inventory", "inventory", "entry_modules", "relevant_entries", "primary_points", "point_ids"] }, "semantic_order_fields": { "const": ["operations", "when", "avoid_when", "recognition_cues", "includes", "excludes", "unresolved_coverage_debt", "evidence", "verifiers", "targets", "results", "edge_rewrites", "surfaces", "host_coverage", "runtime_hosts", "scope"] } } }, "C7": { "type": "object", "additionalProperties": false, "required": ["algorithm", "newline_normalization"], "properties": { "algorithm": { "const": "cc-master/skill-knowledge-markdown-span-hash/v1" }, "newline_normalization": { "const": "crlf-to-lf" } } }, "C8": { "type": "object", "additionalProperties": false, "required": ["algorithm", "formula"], "properties": { "algorithm": { "const": "cc-master/skill-knowledge-budget-estimator/v1" }, "formula": { "const": "ceil(utf8_bytes/3)" } } }, "C9": { "type": "object", "additionalProperties": false, "required": ["hosts"], "properties": { "hosts": { "const": ["claude-code", "codex", "cursor", "kimi-code"] } } }, "C10": { "type": "object", "additionalProperties": false, "required": ["changed_scope_base_option", "immutable_chain"], "properties": { "changed_scope_base_option": { "const": "--base" }, "immutable_chain": { "const": true } } }, "C11": { "type": "object", "additionalProperties": false, "required": ["k2_allows_partial"], "properties": { "k2_allows_partial": { "const": false } } }, "C12": { "type": "object", "additionalProperties": false, "required": ["report_tracks"], "properties": { "report_tracks": { "const": ["structural_status", "behavioral_evidence_status"] } } }, "C13": { "type": "object", "additionalProperties": false, "required": ["research_supersession_required"], "properties": { "research_supersession_required": { "const": true } } }, "C14": { "type": "object", "additionalProperties": false, "required": ["runtime_skill_count", "governance_meta_skill_is_runtime"], "properties": { "runtime_skill_count": { "const": 8 }, "governance_meta_skill_is_runtime": { "const": false } } } } }, "structuralStatus": { "type": "object", "additionalProperties": false, "required": ["state"], "properties": { "state": { "enum": ["pass", "fail", "debt", "not_run"] } } }, "behavioralEvidenceStatus": { "type": "object", "additionalProperties": false, "required": ["state", "evidence"], "properties": { "state": { "enum": ["not_run", "baseline", "candidate", "holdout_verdict"] }, "evidence": { "type": "array", "items": { "$ref": "#/$defs/repoPath" }, "uniqueItems": true }, "verdict": { "enum": ["improved", "regressed", "no_material_change", "inconclusive"] } }, "allOf": [{ "if": { "properties": { "state": { "const": "holdout_verdict" } }, "required": ["state"] }, "then": { "required": ["verdict"] } }] }, "summary": { "type": "object", "additionalProperties": false, "required": ["documents", "portfolio", "skill", "module", "change", "errors", "debts"], "properties": { "documents": { "type": "integer", "minimum": 0 }, "portfolio": { "type": "integer", "minimum": 0 }, "skill": { "type": "integer", "minimum": 0 }, "module": { "type": "integer", "minimum": 0 }, "change": { "type": "integer", "minimum": 0 }, "errors": { "type": "integer", "minimum": 0 }, "debts": { "type": "integer", "minimum": 0 } } }, "diagnostic": { "type": "object", "additionalProperties": false, "required": ["severity", "code", "message", "location", "witness", "remediation"], "properties": { "severity": { "enum": ["error", "warning", "debt", "info"] }, "code": { "type": "string", "pattern": "^SKG-[A-Z0-9-]+$" }, "message": { "type": "string", "minLength": 1 }, "location": { "type": "string", "minLength": 1 }, "witness": { "type": "object" }, "remediation": { "type": "string", "minLength": 1 } } } } };
var schema45 = { "type": "object", "additionalProperties": false, "required": ["source_json_parse", "source_envelope_validation", "global_id_uniqueness", "full_json_schema_validation", "markdown_binding", "graph_invariants", "runtime_projection", "hop_analysis", "typed_change_transactions", "entry_surface_binding", "canonical_source_inventory", "derived_freshness", "canonical_graph_hash", "deterministic_budget_estimator", "host_portability_probe", "semantic_coverage", "behavioral_evidence_tracking"], "properties": { "source_json_parse": { "type": "boolean" }, "source_envelope_validation": { "type": "boolean" }, "global_id_uniqueness": { "type": "boolean" }, "full_json_schema_validation": { "type": "boolean" }, "markdown_binding": { "type": "boolean" }, "graph_invariants": { "type": "boolean" }, "runtime_projection": { "type": "boolean" }, "hop_analysis": { "type": "boolean" }, "typed_change_transactions": { "type": "boolean" }, "entry_surface_binding": { "type": "boolean" }, "canonical_source_inventory": { "type": "boolean" }, "derived_freshness": { "type": "boolean" }, "canonical_graph_hash": { "type": "boolean" }, "deterministic_budget_estimator": { "type": "boolean" }, "host_portability_probe": { "type": "boolean" }, "semantic_coverage": { "type": "boolean" }, "behavioral_evidence_tracking": { "type": "boolean" } } };
var schema46 = { "type": "object", "additionalProperties": false, "required": ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11", "C12", "C13", "C14"], "properties": { "C1": { "type": "object", "additionalProperties": false, "required": ["entry_surface_fields"], "properties": { "entry_surface_fields": { "const": ["host", "source_file", "binding", "surface_kind", "targets", "lifecycle"] } } }, "C2": { "type": "object", "additionalProperties": false, "required": ["coverage_states", "denominator"], "properties": { "coverage_states": { "const": ["full", "partial", "non_knowledge", "excluded"] }, "denominator": { "const": "git_canonical_markdown" } } }, "C3": { "type": "object", "additionalProperties": false, "required": ["derived_fields"], "properties": { "derived_fields": { "const": ["canonical", "review_policy", "reviewed_canonical_sha256"] } } }, "C4": { "type": "object", "additionalProperties": false, "required": ["accepted_skill_requires_admission"], "properties": { "accepted_skill_requires_admission": { "const": true } } }, "C5": { "type": "object", "additionalProperties": false, "required": ["change_workflow", "workspace_root"], "properties": { "change_workflow": { "const": ["begin", "validate", "apply"] }, "workspace_root": { "const": ".skill-knowledge/workspaces/<change-id>" } } }, "C6": { "type": "object", "additionalProperties": false, "required": ["algorithm", "authored_manifest_kinds", "change_head_digest_excludes", "identity_set_fields", "semantic_order_fields"], "properties": { "algorithm": { "const": "cc-master/skill-knowledge-canonical-graph-hash/v1" }, "authored_manifest_kinds": { "const": ["portfolio", "skill", "module"] }, "change_head_digest_excludes": { "const": ["result_graph_sha256"] }, "identity_set_fields": { "const": ["skills", "modules", "points", "edges", "entries", "canonical_source_inventory", "inventory", "entry_modules", "relevant_entries", "primary_points", "point_ids"] }, "semantic_order_fields": { "const": ["operations", "when", "avoid_when", "recognition_cues", "includes", "excludes", "unresolved_coverage_debt", "evidence", "verifiers", "targets", "results", "edge_rewrites", "surfaces", "host_coverage", "runtime_hosts", "scope"] } } }, "C7": { "type": "object", "additionalProperties": false, "required": ["algorithm", "newline_normalization"], "properties": { "algorithm": { "const": "cc-master/skill-knowledge-markdown-span-hash/v1" }, "newline_normalization": { "const": "crlf-to-lf" } } }, "C8": { "type": "object", "additionalProperties": false, "required": ["algorithm", "formula"], "properties": { "algorithm": { "const": "cc-master/skill-knowledge-budget-estimator/v1" }, "formula": { "const": "ceil(utf8_bytes/3)" } } }, "C9": { "type": "object", "additionalProperties": false, "required": ["hosts"], "properties": { "hosts": { "const": ["claude-code", "codex", "cursor", "kimi-code"] } } }, "C10": { "type": "object", "additionalProperties": false, "required": ["changed_scope_base_option", "immutable_chain"], "properties": { "changed_scope_base_option": { "const": "--base" }, "immutable_chain": { "const": true } } }, "C11": { "type": "object", "additionalProperties": false, "required": ["k2_allows_partial"], "properties": { "k2_allows_partial": { "const": false } } }, "C12": { "type": "object", "additionalProperties": false, "required": ["report_tracks"], "properties": { "report_tracks": { "const": ["structural_status", "behavioral_evidence_status"] } } }, "C13": { "type": "object", "additionalProperties": false, "required": ["research_supersession_required"], "properties": { "research_supersession_required": { "const": true } } }, "C14": { "type": "object", "additionalProperties": false, "required": ["runtime_skill_count", "governance_meta_skill_is_runtime"], "properties": { "runtime_skill_count": { "const": 8 }, "governance_meta_skill_is_runtime": { "const": false } } } } };
var schema47 = { "type": "object", "additionalProperties": false, "required": ["state"], "properties": { "state": { "enum": ["pass", "fail", "debt", "not_run"] } } };
var schema52 = { "type": "object", "additionalProperties": false, "required": ["severity", "code", "message", "location", "witness", "remediation"], "properties": { "severity": { "enum": ["error", "warning", "debt", "info"] }, "code": { "type": "string", "pattern": "^SKG-[A-Z0-9-]+$" }, "message": { "type": "string", "minLength": 1 }, "location": { "type": "string", "minLength": 1 }, "witness": { "type": "object" }, "remediation": { "type": "string", "minLength": 1 } } };
var func1 = require_ucs2length().default;
var func16 = Object.prototype.hasOwnProperty;
var func0 = require_equal().default;
var pattern4 = new RegExp("^[A-Za-z0-9._<>/-]+$", "u");
var pattern14 = new RegExp("^[a-f0-9]{64}$", "u");
var pattern15 = new RegExp("^SKG-[A-Z0-9-]+$", "u");
var schema48 = { "type": "object", "additionalProperties": false, "required": ["state", "evidence"], "properties": { "state": { "enum": ["not_run", "baseline", "candidate", "holdout_verdict"] }, "evidence": { "type": "array", "items": { "$ref": "#/$defs/repoPath" }, "uniqueItems": true }, "verdict": { "enum": ["improved", "regressed", "no_material_change", "inconclusive"] } }, "allOf": [{ "if": { "properties": { "state": { "const": "holdout_verdict" } }, "required": ["state"] }, "then": { "required": ["verdict"] } }] };
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
  const _errs2 = errors;
  let valid1 = true;
  const _errs3 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    let missing0;
    if (data.state === void 0 && (missing0 = "state")) {
      const err0 = {};
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    } else {
      if (data.state !== void 0) {
        if ("holdout_verdict" !== data.state) {
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
      if (data.verdict === void 0) {
        const err2 = { instancePath, schemaPath: "#/allOf/0/then/required", keyword: "required", params: { missingProperty: "verdict" }, message: "must have required property 'verdict'" };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
    }
    var _valid0 = _errs5 === errors;
    valid1 = _valid0;
  }
  if (!valid1) {
    const err3 = { instancePath, schemaPath: "#/allOf/0/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err3];
    } else {
      vErrors.push(err3);
    }
    errors++;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.state === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "state" }, message: "must have required property 'state'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.evidence === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "evidence" }, message: "must have required property 'evidence'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "state" || key0 === "evidence" || key0 === "verdict")) {
        const err6 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.state !== void 0) {
      let data1 = data.state;
      if (!(data1 === "not_run" || data1 === "baseline" || data1 === "candidate" || data1 === "holdout_verdict")) {
        const err7 = { instancePath: instancePath + "/state", schemaPath: "#/properties/state/enum", keyword: "enum", params: { allowedValues: schema48.properties.state.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.evidence !== void 0) {
      let data2 = data.evidence;
      if (Array.isArray(data2)) {
        const len0 = data2.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data3 = data2[i0];
          if (typeof data3 === "string") {
            if (func1(data3) < 1) {
              const err8 = { instancePath: instancePath + "/evidence/" + i0, schemaPath: "#/$defs/repoPath/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err8];
              } else {
                vErrors.push(err8);
              }
              errors++;
            }
            if (!pattern4.test(data3)) {
              const err9 = { instancePath: instancePath + "/evidence/" + i0, schemaPath: "#/$defs/repoPath/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9._<>/-]+$" }, message: 'must match pattern "^[A-Za-z0-9._<>/-]+$"' };
              if (vErrors === null) {
                vErrors = [err9];
              } else {
                vErrors.push(err9);
              }
              errors++;
            }
          } else {
            const err10 = { instancePath: instancePath + "/evidence/" + i0, schemaPath: "#/$defs/repoPath/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err10];
            } else {
              vErrors.push(err10);
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
                const err11 = { instancePath: instancePath + "/evidence", schemaPath: "#/properties/evidence/uniqueItems", keyword: "uniqueItems", params: { i: i1, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i1 + " are identical)" };
                if (vErrors === null) {
                  vErrors = [err11];
                } else {
                  vErrors.push(err11);
                }
                errors++;
                break outer0;
              }
            }
          }
        }
      } else {
        const err12 = { instancePath: instancePath + "/evidence", schemaPath: "#/properties/evidence/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
    }
    if (data.verdict !== void 0) {
      let data4 = data.verdict;
      if (!(data4 === "improved" || data4 === "regressed" || data4 === "no_material_change" || data4 === "inconclusive")) {
        const err13 = { instancePath: instancePath + "/verdict", schemaPath: "#/properties/verdict/enum", keyword: "enum", params: { allowedValues: schema48.properties.verdict.enum }, message: "must be equal to one of the allowed values" };
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
  validate21.errors = vErrors;
  return errors === 0;
}
validate21.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
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
  const _errs2 = errors;
  let valid1 = true;
  const _errs3 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    let missing0;
    if (data.result_kind === void 0 && (missing0 = "result_kind")) {
      const err0 = {};
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    } else {
      if (data.result_kind !== void 0) {
        if ("change" !== data.result_kind) {
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
      if (data.action === void 0) {
        const err2 = { instancePath, schemaPath: "#/allOf/0/then/required", keyword: "required", params: { missingProperty: "action" }, message: "must have required property 'action'" };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
      if (data.diagnostics === void 0) {
        const err3 = { instancePath, schemaPath: "#/allOf/0/then/required", keyword: "required", params: { missingProperty: "diagnostics" }, message: "must have required property 'diagnostics'" };
        if (vErrors === null) {
          vErrors = [err3];
        } else {
          vErrors.push(err3);
        }
        errors++;
      }
    }
    var _valid0 = _errs5 === errors;
    valid1 = _valid0;
  }
  if (!valid1) {
    const err4 = { instancePath, schemaPath: "#/allOf/0/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err4];
    } else {
      vErrors.push(err4);
    }
    errors++;
  }
  const _errs7 = errors;
  let valid3 = true;
  const _errs8 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    let missing1;
    if (data.result_kind === void 0 && (missing1 = "result_kind") || data.ok === void 0 && (missing1 = "ok")) {
      const err5 = {};
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    } else {
      if (data.result_kind !== void 0) {
        const _errs9 = errors;
        if ("contract" !== data.result_kind) {
          const err6 = {};
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
        var valid4 = _errs9 === errors;
      } else {
        var valid4 = true;
      }
      if (valid4) {
        if (data.ok !== void 0) {
          const _errs10 = errors;
          if (true !== data.ok) {
            const err7 = {};
            if (vErrors === null) {
              vErrors = [err7];
            } else {
              vErrors.push(err7);
            }
            errors++;
          }
          var valid4 = _errs10 === errors;
        } else {
          var valid4 = true;
        }
      }
    }
  }
  var _valid1 = _errs8 === errors;
  errors = _errs7;
  if (vErrors !== null) {
    if (_errs7) {
      vErrors.length = _errs7;
    } else {
      vErrors = null;
    }
  }
  if (_valid1) {
    const _errs11 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.implemented_commands === void 0) {
        const err8 = { instancePath, schemaPath: "#/allOf/1/then/required", keyword: "required", params: { missingProperty: "implemented_commands" }, message: "must have required property 'implemented_commands'" };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
      if (data.declared_commands === void 0) {
        const err9 = { instancePath, schemaPath: "#/allOf/1/then/required", keyword: "required", params: { missingProperty: "declared_commands" }, message: "must have required property 'declared_commands'" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
      if (data.operations === void 0) {
        const err10 = { instancePath, schemaPath: "#/allOf/1/then/required", keyword: "required", params: { missingProperty: "operations" }, message: "must have required property 'operations'" };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
      if (data.planes === void 0) {
        const err11 = { instancePath, schemaPath: "#/allOf/1/then/required", keyword: "required", params: { missingProperty: "planes" }, message: "must have required property 'planes'" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
      if (data.invariants === void 0) {
        const err12 = { instancePath, schemaPath: "#/allOf/1/then/required", keyword: "required", params: { missingProperty: "invariants" }, message: "must have required property 'invariants'" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
      if (data.exit_codes === void 0) {
        const err13 = { instancePath, schemaPath: "#/allOf/1/then/required", keyword: "required", params: { missingProperty: "exit_codes" }, message: "must have required property 'exit_codes'" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
      if (data.schemas === void 0) {
        const err14 = { instancePath, schemaPath: "#/allOf/1/then/required", keyword: "required", params: { missingProperty: "schemas" }, message: "must have required property 'schemas'" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
      if (data.source_layout === void 0) {
        const err15 = { instancePath, schemaPath: "#/allOf/1/then/required", keyword: "required", params: { missingProperty: "source_layout" }, message: "must have required property 'source_layout'" };
        if (vErrors === null) {
          vErrors = [err15];
        } else {
          vErrors.push(err15);
        }
        errors++;
      }
      if (data.capabilities === void 0) {
        const err16 = { instancePath, schemaPath: "#/allOf/1/then/required", keyword: "required", params: { missingProperty: "capabilities" }, message: "must have required property 'capabilities'" };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
      if (data.hardening_contract === void 0) {
        const err17 = { instancePath, schemaPath: "#/allOf/1/then/required", keyword: "required", params: { missingProperty: "hardening_contract" }, message: "must have required property 'hardening_contract'" };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
    }
    var _valid1 = _errs11 === errors;
    valid3 = _valid1;
  }
  if (!valid3) {
    const err18 = { instancePath, schemaPath: "#/allOf/1/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err18];
    } else {
      vErrors.push(err18);
    }
    errors++;
  }
  const _errs13 = errors;
  let valid5 = true;
  const _errs14 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    let missing2;
    if (data.result_kind === void 0 && (missing2 = "result_kind")) {
      const err19 = {};
      if (vErrors === null) {
        vErrors = [err19];
      } else {
        vErrors.push(err19);
      }
      errors++;
    } else {
      if (data.result_kind !== void 0) {
        if ("report" !== data.result_kind) {
          const err20 = {};
          if (vErrors === null) {
            vErrors = [err20];
          } else {
            vErrors.push(err20);
          }
          errors++;
        }
      }
    }
  }
  var _valid2 = _errs14 === errors;
  errors = _errs13;
  if (vErrors !== null) {
    if (_errs13) {
      vErrors.length = _errs13;
    } else {
      vErrors = null;
    }
  }
  if (_valid2) {
    const _errs16 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.structural_status === void 0) {
        const err21 = { instancePath, schemaPath: "#/allOf/2/then/required", keyword: "required", params: { missingProperty: "structural_status" }, message: "must have required property 'structural_status'" };
        if (vErrors === null) {
          vErrors = [err21];
        } else {
          vErrors.push(err21);
        }
        errors++;
      }
      if (data.behavioral_evidence_status === void 0) {
        const err22 = { instancePath, schemaPath: "#/allOf/2/then/required", keyword: "required", params: { missingProperty: "behavioral_evidence_status" }, message: "must have required property 'behavioral_evidence_status'" };
        if (vErrors === null) {
          vErrors = [err22];
        } else {
          vErrors.push(err22);
        }
        errors++;
      }
      if (data.diagnostics === void 0) {
        const err23 = { instancePath, schemaPath: "#/allOf/2/then/required", keyword: "required", params: { missingProperty: "diagnostics" }, message: "must have required property 'diagnostics'" };
        if (vErrors === null) {
          vErrors = [err23];
        } else {
          vErrors.push(err23);
        }
        errors++;
      }
    }
    var _valid2 = _errs16 === errors;
    valid5 = _valid2;
  }
  if (!valid5) {
    const err24 = { instancePath, schemaPath: "#/allOf/2/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err24];
    } else {
      vErrors.push(err24);
    }
    errors++;
  }
  const _errs18 = errors;
  let valid7 = true;
  const _errs19 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    let missing3;
    if (data.result_kind === void 0 && (missing3 = "result_kind")) {
      const err25 = {};
      if (vErrors === null) {
        vErrors = [err25];
      } else {
        vErrors.push(err25);
      }
      errors++;
    } else {
      if (data.result_kind !== void 0) {
        if ("check" !== data.result_kind) {
          const err26 = {};
          if (vErrors === null) {
            vErrors = [err26];
          } else {
            vErrors.push(err26);
          }
          errors++;
        }
      }
    }
  }
  var _valid3 = _errs19 === errors;
  errors = _errs18;
  if (vErrors !== null) {
    if (_errs18) {
      vErrors.length = _errs18;
    } else {
      vErrors = null;
    }
  }
  if (_valid3) {
    const _errs21 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.stage === void 0) {
        const err27 = { instancePath, schemaPath: "#/allOf/3/then/required", keyword: "required", params: { missingProperty: "stage" }, message: "must have required property 'stage'" };
        if (vErrors === null) {
          vErrors = [err27];
        } else {
          vErrors.push(err27);
        }
        errors++;
      }
      if (data.source_root === void 0) {
        const err28 = { instancePath, schemaPath: "#/allOf/3/then/required", keyword: "required", params: { missingProperty: "source_root" }, message: "must have required property 'source_root'" };
        if (vErrors === null) {
          vErrors = [err28];
        } else {
          vErrors.push(err28);
        }
        errors++;
      }
      if (data.summary === void 0) {
        const err29 = { instancePath, schemaPath: "#/allOf/3/then/required", keyword: "required", params: { missingProperty: "summary" }, message: "must have required property 'summary'" };
        if (vErrors === null) {
          vErrors = [err29];
        } else {
          vErrors.push(err29);
        }
        errors++;
      }
      if (data.capabilities === void 0) {
        const err30 = { instancePath, schemaPath: "#/allOf/3/then/required", keyword: "required", params: { missingProperty: "capabilities" }, message: "must have required property 'capabilities'" };
        if (vErrors === null) {
          vErrors = [err30];
        } else {
          vErrors.push(err30);
        }
        errors++;
      }
      if (data.diagnostics === void 0) {
        const err31 = { instancePath, schemaPath: "#/allOf/3/then/required", keyword: "required", params: { missingProperty: "diagnostics" }, message: "must have required property 'diagnostics'" };
        if (vErrors === null) {
          vErrors = [err31];
        } else {
          vErrors.push(err31);
        }
        errors++;
      }
    }
    var _valid3 = _errs21 === errors;
    valid7 = _valid3;
  }
  if (!valid7) {
    const err32 = { instancePath, schemaPath: "#/allOf/3/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err32];
    } else {
      vErrors.push(err32);
    }
    errors++;
  }
  const _errs23 = errors;
  let valid9 = true;
  const _errs24 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    let missing4;
    if (data.ok === void 0 && (missing4 = "ok")) {
      const err33 = {};
      if (vErrors === null) {
        vErrors = [err33];
      } else {
        vErrors.push(err33);
      }
      errors++;
    } else {
      if (data.ok !== void 0) {
        if (false !== data.ok) {
          const err34 = {};
          if (vErrors === null) {
            vErrors = [err34];
          } else {
            vErrors.push(err34);
          }
          errors++;
        }
      }
    }
  }
  var _valid4 = _errs24 === errors;
  errors = _errs23;
  if (vErrors !== null) {
    if (_errs23) {
      vErrors.length = _errs23;
    } else {
      vErrors = null;
    }
  }
  if (_valid4) {
    const _errs26 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.diagnostics === void 0) {
        const err35 = { instancePath, schemaPath: "#/allOf/4/then/required", keyword: "required", params: { missingProperty: "diagnostics" }, message: "must have required property 'diagnostics'" };
        if (vErrors === null) {
          vErrors = [err35];
        } else {
          vErrors.push(err35);
        }
        errors++;
      }
      if (data.diagnostics !== void 0) {
        let data6 = data.diagnostics;
        if (Array.isArray(data6)) {
          if (data6.length < 1) {
            const err36 = { instancePath: instancePath + "/diagnostics", schemaPath: "#/allOf/4/then/properties/diagnostics/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
            if (vErrors === null) {
              vErrors = [err36];
            } else {
              vErrors.push(err36);
            }
            errors++;
          }
        }
      }
    }
    var _valid4 = _errs26 === errors;
    valid9 = _valid4;
    if (valid9) {
      var props0 = {};
      props0.diagnostics = true;
      props0.ok = true;
    }
  }
  if (!valid9) {
    const err37 = { instancePath, schemaPath: "#/allOf/4/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err37];
    } else {
      vErrors.push(err37);
    }
    errors++;
  }
  if (props0 !== true) {
    props0 = props0 || {};
    props0.result_kind = true;
    props0.ok = true;
  }
  const _errs29 = errors;
  let valid12 = true;
  const _errs30 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    let missing5;
    if (data.improvement_claim === void 0 && (missing5 = "improvement_claim")) {
      const err38 = {};
      if (vErrors === null) {
        vErrors = [err38];
      } else {
        vErrors.push(err38);
      }
      errors++;
    }
  }
  var _valid5 = _errs30 === errors;
  errors = _errs29;
  if (vErrors !== null) {
    if (_errs29) {
      vErrors.length = _errs29;
    } else {
      vErrors = null;
    }
  }
  if (_valid5) {
    const _errs31 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.behavioral_evidence_status === void 0) {
        const err39 = { instancePath, schemaPath: "#/allOf/5/then/required", keyword: "required", params: { missingProperty: "behavioral_evidence_status" }, message: "must have required property 'behavioral_evidence_status'" };
        if (vErrors === null) {
          vErrors = [err39];
        } else {
          vErrors.push(err39);
        }
        errors++;
      }
      if (data.behavioral_evidence_status !== void 0) {
        let data7 = data.behavioral_evidence_status;
        if (data7 && typeof data7 == "object" && !Array.isArray(data7)) {
          if (data7.state === void 0) {
            const err40 = { instancePath: instancePath + "/behavioral_evidence_status", schemaPath: "#/allOf/5/then/properties/behavioral_evidence_status/required", keyword: "required", params: { missingProperty: "state" }, message: "must have required property 'state'" };
            if (vErrors === null) {
              vErrors = [err40];
            } else {
              vErrors.push(err40);
            }
            errors++;
          }
          if (data7.state !== void 0) {
            if ("holdout_verdict" !== data7.state) {
              const err41 = { instancePath: instancePath + "/behavioral_evidence_status/state", schemaPath: "#/allOf/5/then/properties/behavioral_evidence_status/properties/state/const", keyword: "const", params: { allowedValue: "holdout_verdict" }, message: "must be equal to constant" };
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
    }
    var _valid5 = _errs31 === errors;
    valid12 = _valid5;
    if (valid12) {
      var props1 = {};
      props1.behavioral_evidence_status = true;
    }
  }
  if (!valid12) {
    const err42 = { instancePath, schemaPath: "#/allOf/5/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err42];
    } else {
      vErrors.push(err42);
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
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.schema === void 0) {
      const err43 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "schema" }, message: "must have required property 'schema'" };
      if (vErrors === null) {
        vErrors = [err43];
      } else {
        vErrors.push(err43);
      }
      errors++;
    }
    if (data.ok === void 0) {
      const err44 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "ok" }, message: "must have required property 'ok'" };
      if (vErrors === null) {
        vErrors = [err44];
      } else {
        vErrors.push(err44);
      }
      errors++;
    }
    if (data.command === void 0) {
      const err45 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "command" }, message: "must have required property 'command'" };
      if (vErrors === null) {
        vErrors = [err45];
      } else {
        vErrors.push(err45);
      }
      errors++;
    }
    if (data.result_kind === void 0) {
      const err46 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "result_kind" }, message: "must have required property 'result_kind'" };
      if (vErrors === null) {
        vErrors = [err46];
      } else {
        vErrors.push(err46);
      }
      errors++;
    }
    if (data.contract_version === void 0) {
      const err47 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "contract_version" }, message: "must have required property 'contract_version'" };
      if (vErrors === null) {
        vErrors = [err47];
      } else {
        vErrors.push(err47);
      }
      errors++;
    }
    if (props0 !== true) {
      props0 = props0 || {};
      props0.schema = true;
      props0.ok = true;
      props0.command = true;
      props0.result_kind = true;
      props0.contract_version = true;
      props0.implemented_commands = true;
      props0.declared_commands = true;
      props0.operations = true;
      props0.planes = true;
      props0.invariants = true;
      props0.exit_codes = true;
      props0.schemas = true;
      props0.source_layout = true;
      props0.stage = true;
      props0.source_root = true;
      props0.summary = true;
      props0.capabilities = true;
      props0.hardening_contract = true;
      props0.structural_status = true;
      props0.behavioral_evidence_status = true;
      props0.improvement_claim = true;
      props0.action = true;
      props0.workspace = true;
      props0.ledger_path = true;
      props0.result_graph_sha256 = true;
      props0.validation = true;
      props0.diagnostics = true;
    }
    if (data.schema !== void 0) {
      if ("cc-master/skill-knowledge-cli/v1alpha1" !== data.schema) {
        const err48 = { instancePath: instancePath + "/schema", schemaPath: "#/properties/schema/const", keyword: "const", params: { allowedValue: "cc-master/skill-knowledge-cli/v1alpha1" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err48];
        } else {
          vErrors.push(err48);
        }
        errors++;
      }
    }
    if (data.ok !== void 0) {
      if (typeof data.ok !== "boolean") {
        const err49 = { instancePath: instancePath + "/ok", schemaPath: "#/properties/ok/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
        if (vErrors === null) {
          vErrors = [err49];
        } else {
          vErrors.push(err49);
        }
        errors++;
      }
    }
    if (data.command !== void 0) {
      let data11 = data.command;
      if (typeof data11 === "string") {
        if (func1(data11) < 1) {
          const err50 = { instancePath: instancePath + "/command", schemaPath: "#/properties/command/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err50];
          } else {
            vErrors.push(err50);
          }
          errors++;
        }
      } else {
        const err51 = { instancePath: instancePath + "/command", schemaPath: "#/properties/command/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err51];
        } else {
          vErrors.push(err51);
        }
        errors++;
      }
    }
    if (data.result_kind !== void 0) {
      let data12 = data.result_kind;
      if (!(data12 === "contract" || data12 === "check" || data12 === "report" || data12 === "change" || data12 === "diagnostic")) {
        const err52 = { instancePath: instancePath + "/result_kind", schemaPath: "#/properties/result_kind/enum", keyword: "enum", params: { allowedValues: schema31.properties.result_kind.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err52];
        } else {
          vErrors.push(err52);
        }
        errors++;
      }
    }
    if (data.contract_version !== void 0) {
      if ("v1alpha1" !== data.contract_version) {
        const err53 = { instancePath: instancePath + "/contract_version", schemaPath: "#/properties/contract_version/const", keyword: "const", params: { allowedValue: "v1alpha1" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err53];
        } else {
          vErrors.push(err53);
        }
        errors++;
      }
    }
    if (data.implemented_commands !== void 0) {
      let data14 = data.implemented_commands;
      if (Array.isArray(data14)) {
        const len0 = data14.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data15 = data14[i0];
          if (typeof data15 === "string") {
            if (func1(data15) < 1) {
              const err54 = { instancePath: instancePath + "/implemented_commands/" + i0, schemaPath: "#/$defs/stringSet/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err54];
              } else {
                vErrors.push(err54);
              }
              errors++;
            }
          } else {
            const err55 = { instancePath: instancePath + "/implemented_commands/" + i0, schemaPath: "#/$defs/stringSet/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err55];
            } else {
              vErrors.push(err55);
            }
            errors++;
          }
        }
        let i1 = data14.length;
        let j0;
        if (i1 > 1) {
          const indices0 = {};
          for (; i1--; ) {
            let item0 = data14[i1];
            if (typeof item0 !== "string") {
              continue;
            }
            if (typeof indices0[item0] == "number") {
              j0 = indices0[item0];
              const err56 = { instancePath: instancePath + "/implemented_commands", schemaPath: "#/$defs/stringSet/uniqueItems", keyword: "uniqueItems", params: { i: i1, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i1 + " are identical)" };
              if (vErrors === null) {
                vErrors = [err56];
              } else {
                vErrors.push(err56);
              }
              errors++;
              break;
            }
            indices0[item0] = i1;
          }
        }
      } else {
        const err57 = { instancePath: instancePath + "/implemented_commands", schemaPath: "#/$defs/stringSet/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err57];
        } else {
          vErrors.push(err57);
        }
        errors++;
      }
    }
    if (data.declared_commands !== void 0) {
      let data16 = data.declared_commands;
      if (Array.isArray(data16)) {
        const len1 = data16.length;
        for (let i2 = 0; i2 < len1; i2++) {
          let data17 = data16[i2];
          if (typeof data17 === "string") {
            if (func1(data17) < 1) {
              const err58 = { instancePath: instancePath + "/declared_commands/" + i2, schemaPath: "#/$defs/stringSet/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err58];
              } else {
                vErrors.push(err58);
              }
              errors++;
            }
          } else {
            const err59 = { instancePath: instancePath + "/declared_commands/" + i2, schemaPath: "#/$defs/stringSet/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err59];
            } else {
              vErrors.push(err59);
            }
            errors++;
          }
        }
        let i3 = data16.length;
        let j1;
        if (i3 > 1) {
          const indices1 = {};
          for (; i3--; ) {
            let item1 = data16[i3];
            if (typeof item1 !== "string") {
              continue;
            }
            if (typeof indices1[item1] == "number") {
              j1 = indices1[item1];
              const err60 = { instancePath: instancePath + "/declared_commands", schemaPath: "#/$defs/stringSet/uniqueItems", keyword: "uniqueItems", params: { i: i3, j: j1 }, message: "must NOT have duplicate items (items ## " + j1 + " and " + i3 + " are identical)" };
              if (vErrors === null) {
                vErrors = [err60];
              } else {
                vErrors.push(err60);
              }
              errors++;
              break;
            }
            indices1[item1] = i3;
          }
        }
      } else {
        const err61 = { instancePath: instancePath + "/declared_commands", schemaPath: "#/$defs/stringSet/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err61];
        } else {
          vErrors.push(err61);
        }
        errors++;
      }
    }
    if (data.operations !== void 0) {
      let data18 = data.operations;
      if (Array.isArray(data18)) {
        const len2 = data18.length;
        for (let i4 = 0; i4 < len2; i4++) {
          let data19 = data18[i4];
          if (typeof data19 === "string") {
            if (func1(data19) < 1) {
              const err62 = { instancePath: instancePath + "/operations/" + i4, schemaPath: "#/$defs/stringSet/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err62];
              } else {
                vErrors.push(err62);
              }
              errors++;
            }
          } else {
            const err63 = { instancePath: instancePath + "/operations/" + i4, schemaPath: "#/$defs/stringSet/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err63];
            } else {
              vErrors.push(err63);
            }
            errors++;
          }
        }
        let i5 = data18.length;
        let j2;
        if (i5 > 1) {
          const indices2 = {};
          for (; i5--; ) {
            let item2 = data18[i5];
            if (typeof item2 !== "string") {
              continue;
            }
            if (typeof indices2[item2] == "number") {
              j2 = indices2[item2];
              const err64 = { instancePath: instancePath + "/operations", schemaPath: "#/$defs/stringSet/uniqueItems", keyword: "uniqueItems", params: { i: i5, j: j2 }, message: "must NOT have duplicate items (items ## " + j2 + " and " + i5 + " are identical)" };
              if (vErrors === null) {
                vErrors = [err64];
              } else {
                vErrors.push(err64);
              }
              errors++;
              break;
            }
            indices2[item2] = i5;
          }
        }
      } else {
        const err65 = { instancePath: instancePath + "/operations", schemaPath: "#/$defs/stringSet/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err65];
        } else {
          vErrors.push(err65);
        }
        errors++;
      }
    }
    if (data.planes !== void 0) {
      let data20 = data.planes;
      if (Array.isArray(data20)) {
        const len3 = data20.length;
        for (let i6 = 0; i6 < len3; i6++) {
          let data21 = data20[i6];
          if (typeof data21 === "string") {
            if (func1(data21) < 1) {
              const err66 = { instancePath: instancePath + "/planes/" + i6, schemaPath: "#/$defs/stringSet/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err66];
              } else {
                vErrors.push(err66);
              }
              errors++;
            }
          } else {
            const err67 = { instancePath: instancePath + "/planes/" + i6, schemaPath: "#/$defs/stringSet/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err67];
            } else {
              vErrors.push(err67);
            }
            errors++;
          }
        }
        let i7 = data20.length;
        let j3;
        if (i7 > 1) {
          const indices3 = {};
          for (; i7--; ) {
            let item3 = data20[i7];
            if (typeof item3 !== "string") {
              continue;
            }
            if (typeof indices3[item3] == "number") {
              j3 = indices3[item3];
              const err68 = { instancePath: instancePath + "/planes", schemaPath: "#/$defs/stringSet/uniqueItems", keyword: "uniqueItems", params: { i: i7, j: j3 }, message: "must NOT have duplicate items (items ## " + j3 + " and " + i7 + " are identical)" };
              if (vErrors === null) {
                vErrors = [err68];
              } else {
                vErrors.push(err68);
              }
              errors++;
              break;
            }
            indices3[item3] = i7;
          }
        }
      } else {
        const err69 = { instancePath: instancePath + "/planes", schemaPath: "#/$defs/stringSet/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err69];
        } else {
          vErrors.push(err69);
        }
        errors++;
      }
    }
    if (data.invariants !== void 0) {
      let data22 = data.invariants;
      if (Array.isArray(data22)) {
        const len4 = data22.length;
        for (let i8 = 0; i8 < len4; i8++) {
          let data23 = data22[i8];
          if (typeof data23 === "string") {
            if (func1(data23) < 1) {
              const err70 = { instancePath: instancePath + "/invariants/" + i8, schemaPath: "#/$defs/stringSet/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err70];
              } else {
                vErrors.push(err70);
              }
              errors++;
            }
          } else {
            const err71 = { instancePath: instancePath + "/invariants/" + i8, schemaPath: "#/$defs/stringSet/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err71];
            } else {
              vErrors.push(err71);
            }
            errors++;
          }
        }
        let i9 = data22.length;
        let j4;
        if (i9 > 1) {
          const indices4 = {};
          for (; i9--; ) {
            let item4 = data22[i9];
            if (typeof item4 !== "string") {
              continue;
            }
            if (typeof indices4[item4] == "number") {
              j4 = indices4[item4];
              const err72 = { instancePath: instancePath + "/invariants", schemaPath: "#/$defs/stringSet/uniqueItems", keyword: "uniqueItems", params: { i: i9, j: j4 }, message: "must NOT have duplicate items (items ## " + j4 + " and " + i9 + " are identical)" };
              if (vErrors === null) {
                vErrors = [err72];
              } else {
                vErrors.push(err72);
              }
              errors++;
              break;
            }
            indices4[item4] = i9;
          }
        }
      } else {
        const err73 = { instancePath: instancePath + "/invariants", schemaPath: "#/$defs/stringSet/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err73];
        } else {
          vErrors.push(err73);
        }
        errors++;
      }
    }
    if (data.exit_codes !== void 0) {
      let data24 = data.exit_codes;
      if (data24 && typeof data24 == "object" && !Array.isArray(data24)) {
        if (Object.keys(data24).length < 1) {
          const err74 = { instancePath: instancePath + "/exit_codes", schemaPath: "#/properties/exit_codes/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" };
          if (vErrors === null) {
            vErrors = [err74];
          } else {
            vErrors.push(err74);
          }
          errors++;
        }
        for (const key0 in data24) {
          let data25 = data24[key0];
          if (!(typeof data25 == "number" && (!(data25 % 1) && !isNaN(data25)))) {
            const err75 = { instancePath: instancePath + "/exit_codes/" + key0.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/exit_codes/additionalProperties/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err75];
            } else {
              vErrors.push(err75);
            }
            errors++;
          }
          if (typeof data25 == "number") {
            if (data25 > 255 || isNaN(data25)) {
              const err76 = { instancePath: instancePath + "/exit_codes/" + key0.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/exit_codes/additionalProperties/maximum", keyword: "maximum", params: { comparison: "<=", limit: 255 }, message: "must be <= 255" };
              if (vErrors === null) {
                vErrors = [err76];
              } else {
                vErrors.push(err76);
              }
              errors++;
            }
            if (data25 < 0 || isNaN(data25)) {
              const err77 = { instancePath: instancePath + "/exit_codes/" + key0.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/exit_codes/additionalProperties/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
              if (vErrors === null) {
                vErrors = [err77];
              } else {
                vErrors.push(err77);
              }
              errors++;
            }
          }
        }
      } else {
        const err78 = { instancePath: instancePath + "/exit_codes", schemaPath: "#/properties/exit_codes/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err78];
        } else {
          vErrors.push(err78);
        }
        errors++;
      }
    }
    if (data.schemas !== void 0) {
      let data26 = data.schemas;
      if (data26 && typeof data26 == "object" && !Array.isArray(data26)) {
        if (data26.source === void 0) {
          const err79 = { instancePath: instancePath + "/schemas", schemaPath: "#/properties/schemas/required", keyword: "required", params: { missingProperty: "source" }, message: "must have required property 'source'" };
          if (vErrors === null) {
            vErrors = [err79];
          } else {
            vErrors.push(err79);
          }
          errors++;
        }
        if (data26.change === void 0) {
          const err80 = { instancePath: instancePath + "/schemas", schemaPath: "#/properties/schemas/required", keyword: "required", params: { missingProperty: "change" }, message: "must have required property 'change'" };
          if (vErrors === null) {
            vErrors = [err80];
          } else {
            vErrors.push(err80);
          }
          errors++;
        }
        if (data26.output === void 0) {
          const err81 = { instancePath: instancePath + "/schemas", schemaPath: "#/properties/schemas/required", keyword: "required", params: { missingProperty: "output" }, message: "must have required property 'output'" };
          if (vErrors === null) {
            vErrors = [err81];
          } else {
            vErrors.push(err81);
          }
          errors++;
        }
        if (data26.cli === void 0) {
          const err82 = { instancePath: instancePath + "/schemas", schemaPath: "#/properties/schemas/required", keyword: "required", params: { missingProperty: "cli" }, message: "must have required property 'cli'" };
          if (vErrors === null) {
            vErrors = [err82];
          } else {
            vErrors.push(err82);
          }
          errors++;
        }
        for (const key1 in data26) {
          if (!(key1 === "source" || key1 === "change" || key1 === "output" || key1 === "cli")) {
            const err83 = { instancePath: instancePath + "/schemas", schemaPath: "#/properties/schemas/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err83];
            } else {
              vErrors.push(err83);
            }
            errors++;
          }
        }
        if (data26.source !== void 0) {
          let data27 = data26.source;
          if (typeof data27 === "string") {
            if (func1(data27) < 1) {
              const err84 = { instancePath: instancePath + "/schemas/source", schemaPath: "#/$defs/repoPath/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err84];
              } else {
                vErrors.push(err84);
              }
              errors++;
            }
            if (!pattern4.test(data27)) {
              const err85 = { instancePath: instancePath + "/schemas/source", schemaPath: "#/$defs/repoPath/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9._<>/-]+$" }, message: 'must match pattern "^[A-Za-z0-9._<>/-]+$"' };
              if (vErrors === null) {
                vErrors = [err85];
              } else {
                vErrors.push(err85);
              }
              errors++;
            }
          } else {
            const err86 = { instancePath: instancePath + "/schemas/source", schemaPath: "#/$defs/repoPath/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err86];
            } else {
              vErrors.push(err86);
            }
            errors++;
          }
        }
        if (data26.change !== void 0) {
          let data28 = data26.change;
          if (typeof data28 === "string") {
            if (func1(data28) < 1) {
              const err87 = { instancePath: instancePath + "/schemas/change", schemaPath: "#/$defs/repoPath/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err87];
              } else {
                vErrors.push(err87);
              }
              errors++;
            }
            if (!pattern4.test(data28)) {
              const err88 = { instancePath: instancePath + "/schemas/change", schemaPath: "#/$defs/repoPath/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9._<>/-]+$" }, message: 'must match pattern "^[A-Za-z0-9._<>/-]+$"' };
              if (vErrors === null) {
                vErrors = [err88];
              } else {
                vErrors.push(err88);
              }
              errors++;
            }
          } else {
            const err89 = { instancePath: instancePath + "/schemas/change", schemaPath: "#/$defs/repoPath/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err89];
            } else {
              vErrors.push(err89);
            }
            errors++;
          }
        }
        if (data26.output !== void 0) {
          let data29 = data26.output;
          if (typeof data29 === "string") {
            if (func1(data29) < 1) {
              const err90 = { instancePath: instancePath + "/schemas/output", schemaPath: "#/$defs/repoPath/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err90];
              } else {
                vErrors.push(err90);
              }
              errors++;
            }
            if (!pattern4.test(data29)) {
              const err91 = { instancePath: instancePath + "/schemas/output", schemaPath: "#/$defs/repoPath/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9._<>/-]+$" }, message: 'must match pattern "^[A-Za-z0-9._<>/-]+$"' };
              if (vErrors === null) {
                vErrors = [err91];
              } else {
                vErrors.push(err91);
              }
              errors++;
            }
          } else {
            const err92 = { instancePath: instancePath + "/schemas/output", schemaPath: "#/$defs/repoPath/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err92];
            } else {
              vErrors.push(err92);
            }
            errors++;
          }
        }
        if (data26.cli !== void 0) {
          let data30 = data26.cli;
          if (typeof data30 === "string") {
            if (func1(data30) < 1) {
              const err93 = { instancePath: instancePath + "/schemas/cli", schemaPath: "#/$defs/repoPath/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err93];
              } else {
                vErrors.push(err93);
              }
              errors++;
            }
            if (!pattern4.test(data30)) {
              const err94 = { instancePath: instancePath + "/schemas/cli", schemaPath: "#/$defs/repoPath/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9._<>/-]+$" }, message: 'must match pattern "^[A-Za-z0-9._<>/-]+$"' };
              if (vErrors === null) {
                vErrors = [err94];
              } else {
                vErrors.push(err94);
              }
              errors++;
            }
          } else {
            const err95 = { instancePath: instancePath + "/schemas/cli", schemaPath: "#/$defs/repoPath/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err95];
            } else {
              vErrors.push(err95);
            }
            errors++;
          }
        }
      } else {
        const err96 = { instancePath: instancePath + "/schemas", schemaPath: "#/properties/schemas/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err96];
        } else {
          vErrors.push(err96);
        }
        errors++;
      }
    }
    if (data.source_layout !== void 0) {
      let data31 = data.source_layout;
      if (data31 && typeof data31 == "object" && !Array.isArray(data31)) {
        if (data31.root === void 0) {
          const err97 = { instancePath: instancePath + "/source_layout", schemaPath: "#/properties/source_layout/required", keyword: "required", params: { missingProperty: "root" }, message: "must have required property 'root'" };
          if (vErrors === null) {
            vErrors = [err97];
          } else {
            vErrors.push(err97);
          }
          errors++;
        }
        if (data31.portfolio === void 0) {
          const err98 = { instancePath: instancePath + "/source_layout", schemaPath: "#/properties/source_layout/required", keyword: "required", params: { missingProperty: "portfolio" }, message: "must have required property 'portfolio'" };
          if (vErrors === null) {
            vErrors = [err98];
          } else {
            vErrors.push(err98);
          }
          errors++;
        }
        if (data31.changes === void 0) {
          const err99 = { instancePath: instancePath + "/source_layout", schemaPath: "#/properties/source_layout/required", keyword: "required", params: { missingProperty: "changes" }, message: "must have required property 'changes'" };
          if (vErrors === null) {
            vErrors = [err99];
          } else {
            vErrors.push(err99);
          }
          errors++;
        }
        if (data31.skills === void 0) {
          const err100 = { instancePath: instancePath + "/source_layout", schemaPath: "#/properties/source_layout/required", keyword: "required", params: { missingProperty: "skills" }, message: "must have required property 'skills'" };
          if (vErrors === null) {
            vErrors = [err100];
          } else {
            vErrors.push(err100);
          }
          errors++;
        }
        for (const key2 in data31) {
          if (!(key2 === "root" || key2 === "portfolio" || key2 === "changes" || key2 === "skills")) {
            const err101 = { instancePath: instancePath + "/source_layout", schemaPath: "#/properties/source_layout/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err101];
            } else {
              vErrors.push(err101);
            }
            errors++;
          }
        }
        if (data31.root !== void 0) {
          let data32 = data31.root;
          if (typeof data32 === "string") {
            if (func1(data32) < 1) {
              const err102 = { instancePath: instancePath + "/source_layout/root", schemaPath: "#/$defs/repoPath/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err102];
              } else {
                vErrors.push(err102);
              }
              errors++;
            }
            if (!pattern4.test(data32)) {
              const err103 = { instancePath: instancePath + "/source_layout/root", schemaPath: "#/$defs/repoPath/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9._<>/-]+$" }, message: 'must match pattern "^[A-Za-z0-9._<>/-]+$"' };
              if (vErrors === null) {
                vErrors = [err103];
              } else {
                vErrors.push(err103);
              }
              errors++;
            }
          } else {
            const err104 = { instancePath: instancePath + "/source_layout/root", schemaPath: "#/$defs/repoPath/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err104];
            } else {
              vErrors.push(err104);
            }
            errors++;
          }
        }
        if (data31.portfolio !== void 0) {
          let data33 = data31.portfolio;
          if (typeof data33 === "string") {
            if (func1(data33) < 1) {
              const err105 = { instancePath: instancePath + "/source_layout/portfolio", schemaPath: "#/$defs/repoPath/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err105];
              } else {
                vErrors.push(err105);
              }
              errors++;
            }
            if (!pattern4.test(data33)) {
              const err106 = { instancePath: instancePath + "/source_layout/portfolio", schemaPath: "#/$defs/repoPath/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9._<>/-]+$" }, message: 'must match pattern "^[A-Za-z0-9._<>/-]+$"' };
              if (vErrors === null) {
                vErrors = [err106];
              } else {
                vErrors.push(err106);
              }
              errors++;
            }
          } else {
            const err107 = { instancePath: instancePath + "/source_layout/portfolio", schemaPath: "#/$defs/repoPath/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err107];
            } else {
              vErrors.push(err107);
            }
            errors++;
          }
        }
        if (data31.changes !== void 0) {
          let data34 = data31.changes;
          if (typeof data34 === "string") {
            if (func1(data34) < 1) {
              const err108 = { instancePath: instancePath + "/source_layout/changes", schemaPath: "#/$defs/repoPath/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err108];
              } else {
                vErrors.push(err108);
              }
              errors++;
            }
            if (!pattern4.test(data34)) {
              const err109 = { instancePath: instancePath + "/source_layout/changes", schemaPath: "#/$defs/repoPath/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9._<>/-]+$" }, message: 'must match pattern "^[A-Za-z0-9._<>/-]+$"' };
              if (vErrors === null) {
                vErrors = [err109];
              } else {
                vErrors.push(err109);
              }
              errors++;
            }
          } else {
            const err110 = { instancePath: instancePath + "/source_layout/changes", schemaPath: "#/$defs/repoPath/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err110];
            } else {
              vErrors.push(err110);
            }
            errors++;
          }
        }
        if (data31.skills !== void 0) {
          let data35 = data31.skills;
          if (typeof data35 === "string") {
            if (func1(data35) < 1) {
              const err111 = { instancePath: instancePath + "/source_layout/skills", schemaPath: "#/properties/source_layout/properties/skills/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err111];
              } else {
                vErrors.push(err111);
              }
              errors++;
            }
          } else {
            const err112 = { instancePath: instancePath + "/source_layout/skills", schemaPath: "#/properties/source_layout/properties/skills/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err112];
            } else {
              vErrors.push(err112);
            }
            errors++;
          }
        }
      } else {
        const err113 = { instancePath: instancePath + "/source_layout", schemaPath: "#/properties/source_layout/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err113];
        } else {
          vErrors.push(err113);
        }
        errors++;
      }
    }
    if (data.stage !== void 0) {
      let data36 = data.stage;
      if (!(data36 === "K0" || data36 === "K1" || data36 === "K2" || data36 === "K3")) {
        const err114 = { instancePath: instancePath + "/stage", schemaPath: "#/properties/stage/enum", keyword: "enum", params: { allowedValues: schema31.properties.stage.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err114];
        } else {
          vErrors.push(err114);
        }
        errors++;
      }
    }
    if (data.source_root !== void 0) {
      let data37 = data.source_root;
      if (typeof data37 === "string") {
        if (func1(data37) < 1) {
          const err115 = { instancePath: instancePath + "/source_root", schemaPath: "#/properties/source_root/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err115];
          } else {
            vErrors.push(err115);
          }
          errors++;
        }
      } else {
        const err116 = { instancePath: instancePath + "/source_root", schemaPath: "#/properties/source_root/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err116];
        } else {
          vErrors.push(err116);
        }
        errors++;
      }
    }
    if (data.summary !== void 0) {
      let data38 = data.summary;
      if (data38 && typeof data38 == "object" && !Array.isArray(data38)) {
        if (data38.documents === void 0) {
          const err117 = { instancePath: instancePath + "/summary", schemaPath: "#/$defs/summary/required", keyword: "required", params: { missingProperty: "documents" }, message: "must have required property 'documents'" };
          if (vErrors === null) {
            vErrors = [err117];
          } else {
            vErrors.push(err117);
          }
          errors++;
        }
        if (data38.portfolio === void 0) {
          const err118 = { instancePath: instancePath + "/summary", schemaPath: "#/$defs/summary/required", keyword: "required", params: { missingProperty: "portfolio" }, message: "must have required property 'portfolio'" };
          if (vErrors === null) {
            vErrors = [err118];
          } else {
            vErrors.push(err118);
          }
          errors++;
        }
        if (data38.skill === void 0) {
          const err119 = { instancePath: instancePath + "/summary", schemaPath: "#/$defs/summary/required", keyword: "required", params: { missingProperty: "skill" }, message: "must have required property 'skill'" };
          if (vErrors === null) {
            vErrors = [err119];
          } else {
            vErrors.push(err119);
          }
          errors++;
        }
        if (data38.module === void 0) {
          const err120 = { instancePath: instancePath + "/summary", schemaPath: "#/$defs/summary/required", keyword: "required", params: { missingProperty: "module" }, message: "must have required property 'module'" };
          if (vErrors === null) {
            vErrors = [err120];
          } else {
            vErrors.push(err120);
          }
          errors++;
        }
        if (data38.change === void 0) {
          const err121 = { instancePath: instancePath + "/summary", schemaPath: "#/$defs/summary/required", keyword: "required", params: { missingProperty: "change" }, message: "must have required property 'change'" };
          if (vErrors === null) {
            vErrors = [err121];
          } else {
            vErrors.push(err121);
          }
          errors++;
        }
        if (data38.errors === void 0) {
          const err122 = { instancePath: instancePath + "/summary", schemaPath: "#/$defs/summary/required", keyword: "required", params: { missingProperty: "errors" }, message: "must have required property 'errors'" };
          if (vErrors === null) {
            vErrors = [err122];
          } else {
            vErrors.push(err122);
          }
          errors++;
        }
        if (data38.debts === void 0) {
          const err123 = { instancePath: instancePath + "/summary", schemaPath: "#/$defs/summary/required", keyword: "required", params: { missingProperty: "debts" }, message: "must have required property 'debts'" };
          if (vErrors === null) {
            vErrors = [err123];
          } else {
            vErrors.push(err123);
          }
          errors++;
        }
        for (const key3 in data38) {
          if (!(key3 === "documents" || key3 === "portfolio" || key3 === "skill" || key3 === "module" || key3 === "change" || key3 === "errors" || key3 === "debts")) {
            const err124 = { instancePath: instancePath + "/summary", schemaPath: "#/$defs/summary/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err124];
            } else {
              vErrors.push(err124);
            }
            errors++;
          }
        }
        if (data38.documents !== void 0) {
          let data39 = data38.documents;
          if (!(typeof data39 == "number" && (!(data39 % 1) && !isNaN(data39)))) {
            const err125 = { instancePath: instancePath + "/summary/documents", schemaPath: "#/$defs/summary/properties/documents/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err125];
            } else {
              vErrors.push(err125);
            }
            errors++;
          }
          if (typeof data39 == "number") {
            if (data39 < 0 || isNaN(data39)) {
              const err126 = { instancePath: instancePath + "/summary/documents", schemaPath: "#/$defs/summary/properties/documents/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
              if (vErrors === null) {
                vErrors = [err126];
              } else {
                vErrors.push(err126);
              }
              errors++;
            }
          }
        }
        if (data38.portfolio !== void 0) {
          let data40 = data38.portfolio;
          if (!(typeof data40 == "number" && (!(data40 % 1) && !isNaN(data40)))) {
            const err127 = { instancePath: instancePath + "/summary/portfolio", schemaPath: "#/$defs/summary/properties/portfolio/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err127];
            } else {
              vErrors.push(err127);
            }
            errors++;
          }
          if (typeof data40 == "number") {
            if (data40 < 0 || isNaN(data40)) {
              const err128 = { instancePath: instancePath + "/summary/portfolio", schemaPath: "#/$defs/summary/properties/portfolio/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
              if (vErrors === null) {
                vErrors = [err128];
              } else {
                vErrors.push(err128);
              }
              errors++;
            }
          }
        }
        if (data38.skill !== void 0) {
          let data41 = data38.skill;
          if (!(typeof data41 == "number" && (!(data41 % 1) && !isNaN(data41)))) {
            const err129 = { instancePath: instancePath + "/summary/skill", schemaPath: "#/$defs/summary/properties/skill/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err129];
            } else {
              vErrors.push(err129);
            }
            errors++;
          }
          if (typeof data41 == "number") {
            if (data41 < 0 || isNaN(data41)) {
              const err130 = { instancePath: instancePath + "/summary/skill", schemaPath: "#/$defs/summary/properties/skill/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
              if (vErrors === null) {
                vErrors = [err130];
              } else {
                vErrors.push(err130);
              }
              errors++;
            }
          }
        }
        if (data38.module !== void 0) {
          let data42 = data38.module;
          if (!(typeof data42 == "number" && (!(data42 % 1) && !isNaN(data42)))) {
            const err131 = { instancePath: instancePath + "/summary/module", schemaPath: "#/$defs/summary/properties/module/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err131];
            } else {
              vErrors.push(err131);
            }
            errors++;
          }
          if (typeof data42 == "number") {
            if (data42 < 0 || isNaN(data42)) {
              const err132 = { instancePath: instancePath + "/summary/module", schemaPath: "#/$defs/summary/properties/module/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
              if (vErrors === null) {
                vErrors = [err132];
              } else {
                vErrors.push(err132);
              }
              errors++;
            }
          }
        }
        if (data38.change !== void 0) {
          let data43 = data38.change;
          if (!(typeof data43 == "number" && (!(data43 % 1) && !isNaN(data43)))) {
            const err133 = { instancePath: instancePath + "/summary/change", schemaPath: "#/$defs/summary/properties/change/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err133];
            } else {
              vErrors.push(err133);
            }
            errors++;
          }
          if (typeof data43 == "number") {
            if (data43 < 0 || isNaN(data43)) {
              const err134 = { instancePath: instancePath + "/summary/change", schemaPath: "#/$defs/summary/properties/change/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
              if (vErrors === null) {
                vErrors = [err134];
              } else {
                vErrors.push(err134);
              }
              errors++;
            }
          }
        }
        if (data38.errors !== void 0) {
          let data44 = data38.errors;
          if (!(typeof data44 == "number" && (!(data44 % 1) && !isNaN(data44)))) {
            const err135 = { instancePath: instancePath + "/summary/errors", schemaPath: "#/$defs/summary/properties/errors/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err135];
            } else {
              vErrors.push(err135);
            }
            errors++;
          }
          if (typeof data44 == "number") {
            if (data44 < 0 || isNaN(data44)) {
              const err136 = { instancePath: instancePath + "/summary/errors", schemaPath: "#/$defs/summary/properties/errors/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
              if (vErrors === null) {
                vErrors = [err136];
              } else {
                vErrors.push(err136);
              }
              errors++;
            }
          }
        }
        if (data38.debts !== void 0) {
          let data45 = data38.debts;
          if (!(typeof data45 == "number" && (!(data45 % 1) && !isNaN(data45)))) {
            const err137 = { instancePath: instancePath + "/summary/debts", schemaPath: "#/$defs/summary/properties/debts/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err137];
            } else {
              vErrors.push(err137);
            }
            errors++;
          }
          if (typeof data45 == "number") {
            if (data45 < 0 || isNaN(data45)) {
              const err138 = { instancePath: instancePath + "/summary/debts", schemaPath: "#/$defs/summary/properties/debts/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
              if (vErrors === null) {
                vErrors = [err138];
              } else {
                vErrors.push(err138);
              }
              errors++;
            }
          }
        }
      } else {
        const err139 = { instancePath: instancePath + "/summary", schemaPath: "#/$defs/summary/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err139];
        } else {
          vErrors.push(err139);
        }
        errors++;
      }
    }
    if (data.capabilities !== void 0) {
      let data46 = data.capabilities;
      if (data46 && typeof data46 == "object" && !Array.isArray(data46)) {
        if (data46.source_json_parse === void 0) {
          const err140 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "source_json_parse" }, message: "must have required property 'source_json_parse'" };
          if (vErrors === null) {
            vErrors = [err140];
          } else {
            vErrors.push(err140);
          }
          errors++;
        }
        if (data46.source_envelope_validation === void 0) {
          const err141 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "source_envelope_validation" }, message: "must have required property 'source_envelope_validation'" };
          if (vErrors === null) {
            vErrors = [err141];
          } else {
            vErrors.push(err141);
          }
          errors++;
        }
        if (data46.global_id_uniqueness === void 0) {
          const err142 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "global_id_uniqueness" }, message: "must have required property 'global_id_uniqueness'" };
          if (vErrors === null) {
            vErrors = [err142];
          } else {
            vErrors.push(err142);
          }
          errors++;
        }
        if (data46.full_json_schema_validation === void 0) {
          const err143 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "full_json_schema_validation" }, message: "must have required property 'full_json_schema_validation'" };
          if (vErrors === null) {
            vErrors = [err143];
          } else {
            vErrors.push(err143);
          }
          errors++;
        }
        if (data46.markdown_binding === void 0) {
          const err144 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "markdown_binding" }, message: "must have required property 'markdown_binding'" };
          if (vErrors === null) {
            vErrors = [err144];
          } else {
            vErrors.push(err144);
          }
          errors++;
        }
        if (data46.graph_invariants === void 0) {
          const err145 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "graph_invariants" }, message: "must have required property 'graph_invariants'" };
          if (vErrors === null) {
            vErrors = [err145];
          } else {
            vErrors.push(err145);
          }
          errors++;
        }
        if (data46.runtime_projection === void 0) {
          const err146 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "runtime_projection" }, message: "must have required property 'runtime_projection'" };
          if (vErrors === null) {
            vErrors = [err146];
          } else {
            vErrors.push(err146);
          }
          errors++;
        }
        if (data46.hop_analysis === void 0) {
          const err147 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "hop_analysis" }, message: "must have required property 'hop_analysis'" };
          if (vErrors === null) {
            vErrors = [err147];
          } else {
            vErrors.push(err147);
          }
          errors++;
        }
        if (data46.typed_change_transactions === void 0) {
          const err148 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "typed_change_transactions" }, message: "must have required property 'typed_change_transactions'" };
          if (vErrors === null) {
            vErrors = [err148];
          } else {
            vErrors.push(err148);
          }
          errors++;
        }
        if (data46.entry_surface_binding === void 0) {
          const err149 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "entry_surface_binding" }, message: "must have required property 'entry_surface_binding'" };
          if (vErrors === null) {
            vErrors = [err149];
          } else {
            vErrors.push(err149);
          }
          errors++;
        }
        if (data46.canonical_source_inventory === void 0) {
          const err150 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "canonical_source_inventory" }, message: "must have required property 'canonical_source_inventory'" };
          if (vErrors === null) {
            vErrors = [err150];
          } else {
            vErrors.push(err150);
          }
          errors++;
        }
        if (data46.derived_freshness === void 0) {
          const err151 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "derived_freshness" }, message: "must have required property 'derived_freshness'" };
          if (vErrors === null) {
            vErrors = [err151];
          } else {
            vErrors.push(err151);
          }
          errors++;
        }
        if (data46.canonical_graph_hash === void 0) {
          const err152 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "canonical_graph_hash" }, message: "must have required property 'canonical_graph_hash'" };
          if (vErrors === null) {
            vErrors = [err152];
          } else {
            vErrors.push(err152);
          }
          errors++;
        }
        if (data46.deterministic_budget_estimator === void 0) {
          const err153 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "deterministic_budget_estimator" }, message: "must have required property 'deterministic_budget_estimator'" };
          if (vErrors === null) {
            vErrors = [err153];
          } else {
            vErrors.push(err153);
          }
          errors++;
        }
        if (data46.host_portability_probe === void 0) {
          const err154 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "host_portability_probe" }, message: "must have required property 'host_portability_probe'" };
          if (vErrors === null) {
            vErrors = [err154];
          } else {
            vErrors.push(err154);
          }
          errors++;
        }
        if (data46.semantic_coverage === void 0) {
          const err155 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "semantic_coverage" }, message: "must have required property 'semantic_coverage'" };
          if (vErrors === null) {
            vErrors = [err155];
          } else {
            vErrors.push(err155);
          }
          errors++;
        }
        if (data46.behavioral_evidence_tracking === void 0) {
          const err156 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "behavioral_evidence_tracking" }, message: "must have required property 'behavioral_evidence_tracking'" };
          if (vErrors === null) {
            vErrors = [err156];
          } else {
            vErrors.push(err156);
          }
          errors++;
        }
        for (const key4 in data46) {
          if (!func16.call(schema45.properties, key4)) {
            const err157 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key4 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err157];
            } else {
              vErrors.push(err157);
            }
            errors++;
          }
        }
        if (data46.source_json_parse !== void 0) {
          if (typeof data46.source_json_parse !== "boolean") {
            const err158 = { instancePath: instancePath + "/capabilities/source_json_parse", schemaPath: "#/$defs/capabilities/properties/source_json_parse/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err158];
            } else {
              vErrors.push(err158);
            }
            errors++;
          }
        }
        if (data46.source_envelope_validation !== void 0) {
          if (typeof data46.source_envelope_validation !== "boolean") {
            const err159 = { instancePath: instancePath + "/capabilities/source_envelope_validation", schemaPath: "#/$defs/capabilities/properties/source_envelope_validation/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err159];
            } else {
              vErrors.push(err159);
            }
            errors++;
          }
        }
        if (data46.global_id_uniqueness !== void 0) {
          if (typeof data46.global_id_uniqueness !== "boolean") {
            const err160 = { instancePath: instancePath + "/capabilities/global_id_uniqueness", schemaPath: "#/$defs/capabilities/properties/global_id_uniqueness/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err160];
            } else {
              vErrors.push(err160);
            }
            errors++;
          }
        }
        if (data46.full_json_schema_validation !== void 0) {
          if (typeof data46.full_json_schema_validation !== "boolean") {
            const err161 = { instancePath: instancePath + "/capabilities/full_json_schema_validation", schemaPath: "#/$defs/capabilities/properties/full_json_schema_validation/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err161];
            } else {
              vErrors.push(err161);
            }
            errors++;
          }
        }
        if (data46.markdown_binding !== void 0) {
          if (typeof data46.markdown_binding !== "boolean") {
            const err162 = { instancePath: instancePath + "/capabilities/markdown_binding", schemaPath: "#/$defs/capabilities/properties/markdown_binding/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err162];
            } else {
              vErrors.push(err162);
            }
            errors++;
          }
        }
        if (data46.graph_invariants !== void 0) {
          if (typeof data46.graph_invariants !== "boolean") {
            const err163 = { instancePath: instancePath + "/capabilities/graph_invariants", schemaPath: "#/$defs/capabilities/properties/graph_invariants/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err163];
            } else {
              vErrors.push(err163);
            }
            errors++;
          }
        }
        if (data46.runtime_projection !== void 0) {
          if (typeof data46.runtime_projection !== "boolean") {
            const err164 = { instancePath: instancePath + "/capabilities/runtime_projection", schemaPath: "#/$defs/capabilities/properties/runtime_projection/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err164];
            } else {
              vErrors.push(err164);
            }
            errors++;
          }
        }
        if (data46.hop_analysis !== void 0) {
          if (typeof data46.hop_analysis !== "boolean") {
            const err165 = { instancePath: instancePath + "/capabilities/hop_analysis", schemaPath: "#/$defs/capabilities/properties/hop_analysis/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err165];
            } else {
              vErrors.push(err165);
            }
            errors++;
          }
        }
        if (data46.typed_change_transactions !== void 0) {
          if (typeof data46.typed_change_transactions !== "boolean") {
            const err166 = { instancePath: instancePath + "/capabilities/typed_change_transactions", schemaPath: "#/$defs/capabilities/properties/typed_change_transactions/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err166];
            } else {
              vErrors.push(err166);
            }
            errors++;
          }
        }
        if (data46.entry_surface_binding !== void 0) {
          if (typeof data46.entry_surface_binding !== "boolean") {
            const err167 = { instancePath: instancePath + "/capabilities/entry_surface_binding", schemaPath: "#/$defs/capabilities/properties/entry_surface_binding/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err167];
            } else {
              vErrors.push(err167);
            }
            errors++;
          }
        }
        if (data46.canonical_source_inventory !== void 0) {
          if (typeof data46.canonical_source_inventory !== "boolean") {
            const err168 = { instancePath: instancePath + "/capabilities/canonical_source_inventory", schemaPath: "#/$defs/capabilities/properties/canonical_source_inventory/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err168];
            } else {
              vErrors.push(err168);
            }
            errors++;
          }
        }
        if (data46.derived_freshness !== void 0) {
          if (typeof data46.derived_freshness !== "boolean") {
            const err169 = { instancePath: instancePath + "/capabilities/derived_freshness", schemaPath: "#/$defs/capabilities/properties/derived_freshness/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err169];
            } else {
              vErrors.push(err169);
            }
            errors++;
          }
        }
        if (data46.canonical_graph_hash !== void 0) {
          if (typeof data46.canonical_graph_hash !== "boolean") {
            const err170 = { instancePath: instancePath + "/capabilities/canonical_graph_hash", schemaPath: "#/$defs/capabilities/properties/canonical_graph_hash/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err170];
            } else {
              vErrors.push(err170);
            }
            errors++;
          }
        }
        if (data46.deterministic_budget_estimator !== void 0) {
          if (typeof data46.deterministic_budget_estimator !== "boolean") {
            const err171 = { instancePath: instancePath + "/capabilities/deterministic_budget_estimator", schemaPath: "#/$defs/capabilities/properties/deterministic_budget_estimator/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err171];
            } else {
              vErrors.push(err171);
            }
            errors++;
          }
        }
        if (data46.host_portability_probe !== void 0) {
          if (typeof data46.host_portability_probe !== "boolean") {
            const err172 = { instancePath: instancePath + "/capabilities/host_portability_probe", schemaPath: "#/$defs/capabilities/properties/host_portability_probe/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err172];
            } else {
              vErrors.push(err172);
            }
            errors++;
          }
        }
        if (data46.semantic_coverage !== void 0) {
          if (typeof data46.semantic_coverage !== "boolean") {
            const err173 = { instancePath: instancePath + "/capabilities/semantic_coverage", schemaPath: "#/$defs/capabilities/properties/semantic_coverage/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err173];
            } else {
              vErrors.push(err173);
            }
            errors++;
          }
        }
        if (data46.behavioral_evidence_tracking !== void 0) {
          if (typeof data46.behavioral_evidence_tracking !== "boolean") {
            const err174 = { instancePath: instancePath + "/capabilities/behavioral_evidence_tracking", schemaPath: "#/$defs/capabilities/properties/behavioral_evidence_tracking/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err174];
            } else {
              vErrors.push(err174);
            }
            errors++;
          }
        }
      } else {
        const err175 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err175];
        } else {
          vErrors.push(err175);
        }
        errors++;
      }
    }
    if (data.hardening_contract !== void 0) {
      let data64 = data.hardening_contract;
      if (data64 && typeof data64 == "object" && !Array.isArray(data64)) {
        if (data64.C1 === void 0) {
          const err176 = { instancePath: instancePath + "/hardening_contract", schemaPath: "#/$defs/hardeningContract/required", keyword: "required", params: { missingProperty: "C1" }, message: "must have required property 'C1'" };
          if (vErrors === null) {
            vErrors = [err176];
          } else {
            vErrors.push(err176);
          }
          errors++;
        }
        if (data64.C2 === void 0) {
          const err177 = { instancePath: instancePath + "/hardening_contract", schemaPath: "#/$defs/hardeningContract/required", keyword: "required", params: { missingProperty: "C2" }, message: "must have required property 'C2'" };
          if (vErrors === null) {
            vErrors = [err177];
          } else {
            vErrors.push(err177);
          }
          errors++;
        }
        if (data64.C3 === void 0) {
          const err178 = { instancePath: instancePath + "/hardening_contract", schemaPath: "#/$defs/hardeningContract/required", keyword: "required", params: { missingProperty: "C3" }, message: "must have required property 'C3'" };
          if (vErrors === null) {
            vErrors = [err178];
          } else {
            vErrors.push(err178);
          }
          errors++;
        }
        if (data64.C4 === void 0) {
          const err179 = { instancePath: instancePath + "/hardening_contract", schemaPath: "#/$defs/hardeningContract/required", keyword: "required", params: { missingProperty: "C4" }, message: "must have required property 'C4'" };
          if (vErrors === null) {
            vErrors = [err179];
          } else {
            vErrors.push(err179);
          }
          errors++;
        }
        if (data64.C5 === void 0) {
          const err180 = { instancePath: instancePath + "/hardening_contract", schemaPath: "#/$defs/hardeningContract/required", keyword: "required", params: { missingProperty: "C5" }, message: "must have required property 'C5'" };
          if (vErrors === null) {
            vErrors = [err180];
          } else {
            vErrors.push(err180);
          }
          errors++;
        }
        if (data64.C6 === void 0) {
          const err181 = { instancePath: instancePath + "/hardening_contract", schemaPath: "#/$defs/hardeningContract/required", keyword: "required", params: { missingProperty: "C6" }, message: "must have required property 'C6'" };
          if (vErrors === null) {
            vErrors = [err181];
          } else {
            vErrors.push(err181);
          }
          errors++;
        }
        if (data64.C7 === void 0) {
          const err182 = { instancePath: instancePath + "/hardening_contract", schemaPath: "#/$defs/hardeningContract/required", keyword: "required", params: { missingProperty: "C7" }, message: "must have required property 'C7'" };
          if (vErrors === null) {
            vErrors = [err182];
          } else {
            vErrors.push(err182);
          }
          errors++;
        }
        if (data64.C8 === void 0) {
          const err183 = { instancePath: instancePath + "/hardening_contract", schemaPath: "#/$defs/hardeningContract/required", keyword: "required", params: { missingProperty: "C8" }, message: "must have required property 'C8'" };
          if (vErrors === null) {
            vErrors = [err183];
          } else {
            vErrors.push(err183);
          }
          errors++;
        }
        if (data64.C9 === void 0) {
          const err184 = { instancePath: instancePath + "/hardening_contract", schemaPath: "#/$defs/hardeningContract/required", keyword: "required", params: { missingProperty: "C9" }, message: "must have required property 'C9'" };
          if (vErrors === null) {
            vErrors = [err184];
          } else {
            vErrors.push(err184);
          }
          errors++;
        }
        if (data64.C10 === void 0) {
          const err185 = { instancePath: instancePath + "/hardening_contract", schemaPath: "#/$defs/hardeningContract/required", keyword: "required", params: { missingProperty: "C10" }, message: "must have required property 'C10'" };
          if (vErrors === null) {
            vErrors = [err185];
          } else {
            vErrors.push(err185);
          }
          errors++;
        }
        if (data64.C11 === void 0) {
          const err186 = { instancePath: instancePath + "/hardening_contract", schemaPath: "#/$defs/hardeningContract/required", keyword: "required", params: { missingProperty: "C11" }, message: "must have required property 'C11'" };
          if (vErrors === null) {
            vErrors = [err186];
          } else {
            vErrors.push(err186);
          }
          errors++;
        }
        if (data64.C12 === void 0) {
          const err187 = { instancePath: instancePath + "/hardening_contract", schemaPath: "#/$defs/hardeningContract/required", keyword: "required", params: { missingProperty: "C12" }, message: "must have required property 'C12'" };
          if (vErrors === null) {
            vErrors = [err187];
          } else {
            vErrors.push(err187);
          }
          errors++;
        }
        if (data64.C13 === void 0) {
          const err188 = { instancePath: instancePath + "/hardening_contract", schemaPath: "#/$defs/hardeningContract/required", keyword: "required", params: { missingProperty: "C13" }, message: "must have required property 'C13'" };
          if (vErrors === null) {
            vErrors = [err188];
          } else {
            vErrors.push(err188);
          }
          errors++;
        }
        if (data64.C14 === void 0) {
          const err189 = { instancePath: instancePath + "/hardening_contract", schemaPath: "#/$defs/hardeningContract/required", keyword: "required", params: { missingProperty: "C14" }, message: "must have required property 'C14'" };
          if (vErrors === null) {
            vErrors = [err189];
          } else {
            vErrors.push(err189);
          }
          errors++;
        }
        for (const key5 in data64) {
          if (!func16.call(schema46.properties, key5)) {
            const err190 = { instancePath: instancePath + "/hardening_contract", schemaPath: "#/$defs/hardeningContract/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key5 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err190];
            } else {
              vErrors.push(err190);
            }
            errors++;
          }
        }
        if (data64.C1 !== void 0) {
          let data65 = data64.C1;
          if (data65 && typeof data65 == "object" && !Array.isArray(data65)) {
            if (data65.entry_surface_fields === void 0) {
              const err191 = { instancePath: instancePath + "/hardening_contract/C1", schemaPath: "#/$defs/hardeningContract/properties/C1/required", keyword: "required", params: { missingProperty: "entry_surface_fields" }, message: "must have required property 'entry_surface_fields'" };
              if (vErrors === null) {
                vErrors = [err191];
              } else {
                vErrors.push(err191);
              }
              errors++;
            }
            for (const key6 in data65) {
              if (!(key6 === "entry_surface_fields")) {
                const err192 = { instancePath: instancePath + "/hardening_contract/C1", schemaPath: "#/$defs/hardeningContract/properties/C1/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key6 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err192];
                } else {
                  vErrors.push(err192);
                }
                errors++;
              }
            }
            if (data65.entry_surface_fields !== void 0) {
              if (!func0(data65.entry_surface_fields, schema46.properties.C1.properties.entry_surface_fields.const)) {
                const err193 = { instancePath: instancePath + "/hardening_contract/C1/entry_surface_fields", schemaPath: "#/$defs/hardeningContract/properties/C1/properties/entry_surface_fields/const", keyword: "const", params: { allowedValue: schema46.properties.C1.properties.entry_surface_fields.const }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err193];
                } else {
                  vErrors.push(err193);
                }
                errors++;
              }
            }
          } else {
            const err194 = { instancePath: instancePath + "/hardening_contract/C1", schemaPath: "#/$defs/hardeningContract/properties/C1/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err194];
            } else {
              vErrors.push(err194);
            }
            errors++;
          }
        }
        if (data64.C2 !== void 0) {
          let data67 = data64.C2;
          if (data67 && typeof data67 == "object" && !Array.isArray(data67)) {
            if (data67.coverage_states === void 0) {
              const err195 = { instancePath: instancePath + "/hardening_contract/C2", schemaPath: "#/$defs/hardeningContract/properties/C2/required", keyword: "required", params: { missingProperty: "coverage_states" }, message: "must have required property 'coverage_states'" };
              if (vErrors === null) {
                vErrors = [err195];
              } else {
                vErrors.push(err195);
              }
              errors++;
            }
            if (data67.denominator === void 0) {
              const err196 = { instancePath: instancePath + "/hardening_contract/C2", schemaPath: "#/$defs/hardeningContract/properties/C2/required", keyword: "required", params: { missingProperty: "denominator" }, message: "must have required property 'denominator'" };
              if (vErrors === null) {
                vErrors = [err196];
              } else {
                vErrors.push(err196);
              }
              errors++;
            }
            for (const key7 in data67) {
              if (!(key7 === "coverage_states" || key7 === "denominator")) {
                const err197 = { instancePath: instancePath + "/hardening_contract/C2", schemaPath: "#/$defs/hardeningContract/properties/C2/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key7 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err197];
                } else {
                  vErrors.push(err197);
                }
                errors++;
              }
            }
            if (data67.coverage_states !== void 0) {
              if (!func0(data67.coverage_states, schema46.properties.C2.properties.coverage_states.const)) {
                const err198 = { instancePath: instancePath + "/hardening_contract/C2/coverage_states", schemaPath: "#/$defs/hardeningContract/properties/C2/properties/coverage_states/const", keyword: "const", params: { allowedValue: schema46.properties.C2.properties.coverage_states.const }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err198];
                } else {
                  vErrors.push(err198);
                }
                errors++;
              }
            }
            if (data67.denominator !== void 0) {
              if ("git_canonical_markdown" !== data67.denominator) {
                const err199 = { instancePath: instancePath + "/hardening_contract/C2/denominator", schemaPath: "#/$defs/hardeningContract/properties/C2/properties/denominator/const", keyword: "const", params: { allowedValue: "git_canonical_markdown" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err199];
                } else {
                  vErrors.push(err199);
                }
                errors++;
              }
            }
          } else {
            const err200 = { instancePath: instancePath + "/hardening_contract/C2", schemaPath: "#/$defs/hardeningContract/properties/C2/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err200];
            } else {
              vErrors.push(err200);
            }
            errors++;
          }
        }
        if (data64.C3 !== void 0) {
          let data70 = data64.C3;
          if (data70 && typeof data70 == "object" && !Array.isArray(data70)) {
            if (data70.derived_fields === void 0) {
              const err201 = { instancePath: instancePath + "/hardening_contract/C3", schemaPath: "#/$defs/hardeningContract/properties/C3/required", keyword: "required", params: { missingProperty: "derived_fields" }, message: "must have required property 'derived_fields'" };
              if (vErrors === null) {
                vErrors = [err201];
              } else {
                vErrors.push(err201);
              }
              errors++;
            }
            for (const key8 in data70) {
              if (!(key8 === "derived_fields")) {
                const err202 = { instancePath: instancePath + "/hardening_contract/C3", schemaPath: "#/$defs/hardeningContract/properties/C3/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key8 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err202];
                } else {
                  vErrors.push(err202);
                }
                errors++;
              }
            }
            if (data70.derived_fields !== void 0) {
              if (!func0(data70.derived_fields, schema46.properties.C3.properties.derived_fields.const)) {
                const err203 = { instancePath: instancePath + "/hardening_contract/C3/derived_fields", schemaPath: "#/$defs/hardeningContract/properties/C3/properties/derived_fields/const", keyword: "const", params: { allowedValue: schema46.properties.C3.properties.derived_fields.const }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err203];
                } else {
                  vErrors.push(err203);
                }
                errors++;
              }
            }
          } else {
            const err204 = { instancePath: instancePath + "/hardening_contract/C3", schemaPath: "#/$defs/hardeningContract/properties/C3/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err204];
            } else {
              vErrors.push(err204);
            }
            errors++;
          }
        }
        if (data64.C4 !== void 0) {
          let data72 = data64.C4;
          if (data72 && typeof data72 == "object" && !Array.isArray(data72)) {
            if (data72.accepted_skill_requires_admission === void 0) {
              const err205 = { instancePath: instancePath + "/hardening_contract/C4", schemaPath: "#/$defs/hardeningContract/properties/C4/required", keyword: "required", params: { missingProperty: "accepted_skill_requires_admission" }, message: "must have required property 'accepted_skill_requires_admission'" };
              if (vErrors === null) {
                vErrors = [err205];
              } else {
                vErrors.push(err205);
              }
              errors++;
            }
            for (const key9 in data72) {
              if (!(key9 === "accepted_skill_requires_admission")) {
                const err206 = { instancePath: instancePath + "/hardening_contract/C4", schemaPath: "#/$defs/hardeningContract/properties/C4/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key9 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err206];
                } else {
                  vErrors.push(err206);
                }
                errors++;
              }
            }
            if (data72.accepted_skill_requires_admission !== void 0) {
              if (true !== data72.accepted_skill_requires_admission) {
                const err207 = { instancePath: instancePath + "/hardening_contract/C4/accepted_skill_requires_admission", schemaPath: "#/$defs/hardeningContract/properties/C4/properties/accepted_skill_requires_admission/const", keyword: "const", params: { allowedValue: true }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err207];
                } else {
                  vErrors.push(err207);
                }
                errors++;
              }
            }
          } else {
            const err208 = { instancePath: instancePath + "/hardening_contract/C4", schemaPath: "#/$defs/hardeningContract/properties/C4/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err208];
            } else {
              vErrors.push(err208);
            }
            errors++;
          }
        }
        if (data64.C5 !== void 0) {
          let data74 = data64.C5;
          if (data74 && typeof data74 == "object" && !Array.isArray(data74)) {
            if (data74.change_workflow === void 0) {
              const err209 = { instancePath: instancePath + "/hardening_contract/C5", schemaPath: "#/$defs/hardeningContract/properties/C5/required", keyword: "required", params: { missingProperty: "change_workflow" }, message: "must have required property 'change_workflow'" };
              if (vErrors === null) {
                vErrors = [err209];
              } else {
                vErrors.push(err209);
              }
              errors++;
            }
            if (data74.workspace_root === void 0) {
              const err210 = { instancePath: instancePath + "/hardening_contract/C5", schemaPath: "#/$defs/hardeningContract/properties/C5/required", keyword: "required", params: { missingProperty: "workspace_root" }, message: "must have required property 'workspace_root'" };
              if (vErrors === null) {
                vErrors = [err210];
              } else {
                vErrors.push(err210);
              }
              errors++;
            }
            for (const key10 in data74) {
              if (!(key10 === "change_workflow" || key10 === "workspace_root")) {
                const err211 = { instancePath: instancePath + "/hardening_contract/C5", schemaPath: "#/$defs/hardeningContract/properties/C5/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key10 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err211];
                } else {
                  vErrors.push(err211);
                }
                errors++;
              }
            }
            if (data74.change_workflow !== void 0) {
              if (!func0(data74.change_workflow, schema46.properties.C5.properties.change_workflow.const)) {
                const err212 = { instancePath: instancePath + "/hardening_contract/C5/change_workflow", schemaPath: "#/$defs/hardeningContract/properties/C5/properties/change_workflow/const", keyword: "const", params: { allowedValue: schema46.properties.C5.properties.change_workflow.const }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err212];
                } else {
                  vErrors.push(err212);
                }
                errors++;
              }
            }
            if (data74.workspace_root !== void 0) {
              if (".skill-knowledge/workspaces/<change-id>" !== data74.workspace_root) {
                const err213 = { instancePath: instancePath + "/hardening_contract/C5/workspace_root", schemaPath: "#/$defs/hardeningContract/properties/C5/properties/workspace_root/const", keyword: "const", params: { allowedValue: ".skill-knowledge/workspaces/<change-id>" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err213];
                } else {
                  vErrors.push(err213);
                }
                errors++;
              }
            }
          } else {
            const err214 = { instancePath: instancePath + "/hardening_contract/C5", schemaPath: "#/$defs/hardeningContract/properties/C5/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err214];
            } else {
              vErrors.push(err214);
            }
            errors++;
          }
        }
        if (data64.C6 !== void 0) {
          let data77 = data64.C6;
          if (data77 && typeof data77 == "object" && !Array.isArray(data77)) {
            if (data77.algorithm === void 0) {
              const err215 = { instancePath: instancePath + "/hardening_contract/C6", schemaPath: "#/$defs/hardeningContract/properties/C6/required", keyword: "required", params: { missingProperty: "algorithm" }, message: "must have required property 'algorithm'" };
              if (vErrors === null) {
                vErrors = [err215];
              } else {
                vErrors.push(err215);
              }
              errors++;
            }
            if (data77.authored_manifest_kinds === void 0) {
              const err216 = { instancePath: instancePath + "/hardening_contract/C6", schemaPath: "#/$defs/hardeningContract/properties/C6/required", keyword: "required", params: { missingProperty: "authored_manifest_kinds" }, message: "must have required property 'authored_manifest_kinds'" };
              if (vErrors === null) {
                vErrors = [err216];
              } else {
                vErrors.push(err216);
              }
              errors++;
            }
            if (data77.change_head_digest_excludes === void 0) {
              const err217 = { instancePath: instancePath + "/hardening_contract/C6", schemaPath: "#/$defs/hardeningContract/properties/C6/required", keyword: "required", params: { missingProperty: "change_head_digest_excludes" }, message: "must have required property 'change_head_digest_excludes'" };
              if (vErrors === null) {
                vErrors = [err217];
              } else {
                vErrors.push(err217);
              }
              errors++;
            }
            if (data77.identity_set_fields === void 0) {
              const err218 = { instancePath: instancePath + "/hardening_contract/C6", schemaPath: "#/$defs/hardeningContract/properties/C6/required", keyword: "required", params: { missingProperty: "identity_set_fields" }, message: "must have required property 'identity_set_fields'" };
              if (vErrors === null) {
                vErrors = [err218];
              } else {
                vErrors.push(err218);
              }
              errors++;
            }
            if (data77.semantic_order_fields === void 0) {
              const err219 = { instancePath: instancePath + "/hardening_contract/C6", schemaPath: "#/$defs/hardeningContract/properties/C6/required", keyword: "required", params: { missingProperty: "semantic_order_fields" }, message: "must have required property 'semantic_order_fields'" };
              if (vErrors === null) {
                vErrors = [err219];
              } else {
                vErrors.push(err219);
              }
              errors++;
            }
            for (const key11 in data77) {
              if (!(key11 === "algorithm" || key11 === "authored_manifest_kinds" || key11 === "change_head_digest_excludes" || key11 === "identity_set_fields" || key11 === "semantic_order_fields")) {
                const err220 = { instancePath: instancePath + "/hardening_contract/C6", schemaPath: "#/$defs/hardeningContract/properties/C6/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key11 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err220];
                } else {
                  vErrors.push(err220);
                }
                errors++;
              }
            }
            if (data77.algorithm !== void 0) {
              if ("cc-master/skill-knowledge-canonical-graph-hash/v1" !== data77.algorithm) {
                const err221 = { instancePath: instancePath + "/hardening_contract/C6/algorithm", schemaPath: "#/$defs/hardeningContract/properties/C6/properties/algorithm/const", keyword: "const", params: { allowedValue: "cc-master/skill-knowledge-canonical-graph-hash/v1" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err221];
                } else {
                  vErrors.push(err221);
                }
                errors++;
              }
            }
            if (data77.authored_manifest_kinds !== void 0) {
              if (!func0(data77.authored_manifest_kinds, schema46.properties.C6.properties.authored_manifest_kinds.const)) {
                const err222 = { instancePath: instancePath + "/hardening_contract/C6/authored_manifest_kinds", schemaPath: "#/$defs/hardeningContract/properties/C6/properties/authored_manifest_kinds/const", keyword: "const", params: { allowedValue: schema46.properties.C6.properties.authored_manifest_kinds.const }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err222];
                } else {
                  vErrors.push(err222);
                }
                errors++;
              }
            }
            if (data77.change_head_digest_excludes !== void 0) {
              if (!func0(data77.change_head_digest_excludes, schema46.properties.C6.properties.change_head_digest_excludes.const)) {
                const err223 = { instancePath: instancePath + "/hardening_contract/C6/change_head_digest_excludes", schemaPath: "#/$defs/hardeningContract/properties/C6/properties/change_head_digest_excludes/const", keyword: "const", params: { allowedValue: schema46.properties.C6.properties.change_head_digest_excludes.const }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err223];
                } else {
                  vErrors.push(err223);
                }
                errors++;
              }
            }
            if (data77.identity_set_fields !== void 0) {
              if (!func0(data77.identity_set_fields, schema46.properties.C6.properties.identity_set_fields.const)) {
                const err224 = { instancePath: instancePath + "/hardening_contract/C6/identity_set_fields", schemaPath: "#/$defs/hardeningContract/properties/C6/properties/identity_set_fields/const", keyword: "const", params: { allowedValue: schema46.properties.C6.properties.identity_set_fields.const }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err224];
                } else {
                  vErrors.push(err224);
                }
                errors++;
              }
            }
            if (data77.semantic_order_fields !== void 0) {
              if (!func0(data77.semantic_order_fields, schema46.properties.C6.properties.semantic_order_fields.const)) {
                const err225 = { instancePath: instancePath + "/hardening_contract/C6/semantic_order_fields", schemaPath: "#/$defs/hardeningContract/properties/C6/properties/semantic_order_fields/const", keyword: "const", params: { allowedValue: schema46.properties.C6.properties.semantic_order_fields.const }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err225];
                } else {
                  vErrors.push(err225);
                }
                errors++;
              }
            }
          } else {
            const err226 = { instancePath: instancePath + "/hardening_contract/C6", schemaPath: "#/$defs/hardeningContract/properties/C6/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err226];
            } else {
              vErrors.push(err226);
            }
            errors++;
          }
        }
        if (data64.C7 !== void 0) {
          let data83 = data64.C7;
          if (data83 && typeof data83 == "object" && !Array.isArray(data83)) {
            if (data83.algorithm === void 0) {
              const err227 = { instancePath: instancePath + "/hardening_contract/C7", schemaPath: "#/$defs/hardeningContract/properties/C7/required", keyword: "required", params: { missingProperty: "algorithm" }, message: "must have required property 'algorithm'" };
              if (vErrors === null) {
                vErrors = [err227];
              } else {
                vErrors.push(err227);
              }
              errors++;
            }
            if (data83.newline_normalization === void 0) {
              const err228 = { instancePath: instancePath + "/hardening_contract/C7", schemaPath: "#/$defs/hardeningContract/properties/C7/required", keyword: "required", params: { missingProperty: "newline_normalization" }, message: "must have required property 'newline_normalization'" };
              if (vErrors === null) {
                vErrors = [err228];
              } else {
                vErrors.push(err228);
              }
              errors++;
            }
            for (const key12 in data83) {
              if (!(key12 === "algorithm" || key12 === "newline_normalization")) {
                const err229 = { instancePath: instancePath + "/hardening_contract/C7", schemaPath: "#/$defs/hardeningContract/properties/C7/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key12 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err229];
                } else {
                  vErrors.push(err229);
                }
                errors++;
              }
            }
            if (data83.algorithm !== void 0) {
              if ("cc-master/skill-knowledge-markdown-span-hash/v1" !== data83.algorithm) {
                const err230 = { instancePath: instancePath + "/hardening_contract/C7/algorithm", schemaPath: "#/$defs/hardeningContract/properties/C7/properties/algorithm/const", keyword: "const", params: { allowedValue: "cc-master/skill-knowledge-markdown-span-hash/v1" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err230];
                } else {
                  vErrors.push(err230);
                }
                errors++;
              }
            }
            if (data83.newline_normalization !== void 0) {
              if ("crlf-to-lf" !== data83.newline_normalization) {
                const err231 = { instancePath: instancePath + "/hardening_contract/C7/newline_normalization", schemaPath: "#/$defs/hardeningContract/properties/C7/properties/newline_normalization/const", keyword: "const", params: { allowedValue: "crlf-to-lf" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err231];
                } else {
                  vErrors.push(err231);
                }
                errors++;
              }
            }
          } else {
            const err232 = { instancePath: instancePath + "/hardening_contract/C7", schemaPath: "#/$defs/hardeningContract/properties/C7/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err232];
            } else {
              vErrors.push(err232);
            }
            errors++;
          }
        }
        if (data64.C8 !== void 0) {
          let data86 = data64.C8;
          if (data86 && typeof data86 == "object" && !Array.isArray(data86)) {
            if (data86.algorithm === void 0) {
              const err233 = { instancePath: instancePath + "/hardening_contract/C8", schemaPath: "#/$defs/hardeningContract/properties/C8/required", keyword: "required", params: { missingProperty: "algorithm" }, message: "must have required property 'algorithm'" };
              if (vErrors === null) {
                vErrors = [err233];
              } else {
                vErrors.push(err233);
              }
              errors++;
            }
            if (data86.formula === void 0) {
              const err234 = { instancePath: instancePath + "/hardening_contract/C8", schemaPath: "#/$defs/hardeningContract/properties/C8/required", keyword: "required", params: { missingProperty: "formula" }, message: "must have required property 'formula'" };
              if (vErrors === null) {
                vErrors = [err234];
              } else {
                vErrors.push(err234);
              }
              errors++;
            }
            for (const key13 in data86) {
              if (!(key13 === "algorithm" || key13 === "formula")) {
                const err235 = { instancePath: instancePath + "/hardening_contract/C8", schemaPath: "#/$defs/hardeningContract/properties/C8/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key13 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err235];
                } else {
                  vErrors.push(err235);
                }
                errors++;
              }
            }
            if (data86.algorithm !== void 0) {
              if ("cc-master/skill-knowledge-budget-estimator/v1" !== data86.algorithm) {
                const err236 = { instancePath: instancePath + "/hardening_contract/C8/algorithm", schemaPath: "#/$defs/hardeningContract/properties/C8/properties/algorithm/const", keyword: "const", params: { allowedValue: "cc-master/skill-knowledge-budget-estimator/v1" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err236];
                } else {
                  vErrors.push(err236);
                }
                errors++;
              }
            }
            if (data86.formula !== void 0) {
              if ("ceil(utf8_bytes/3)" !== data86.formula) {
                const err237 = { instancePath: instancePath + "/hardening_contract/C8/formula", schemaPath: "#/$defs/hardeningContract/properties/C8/properties/formula/const", keyword: "const", params: { allowedValue: "ceil(utf8_bytes/3)" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err237];
                } else {
                  vErrors.push(err237);
                }
                errors++;
              }
            }
          } else {
            const err238 = { instancePath: instancePath + "/hardening_contract/C8", schemaPath: "#/$defs/hardeningContract/properties/C8/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err238];
            } else {
              vErrors.push(err238);
            }
            errors++;
          }
        }
        if (data64.C9 !== void 0) {
          let data89 = data64.C9;
          if (data89 && typeof data89 == "object" && !Array.isArray(data89)) {
            if (data89.hosts === void 0) {
              const err239 = { instancePath: instancePath + "/hardening_contract/C9", schemaPath: "#/$defs/hardeningContract/properties/C9/required", keyword: "required", params: { missingProperty: "hosts" }, message: "must have required property 'hosts'" };
              if (vErrors === null) {
                vErrors = [err239];
              } else {
                vErrors.push(err239);
              }
              errors++;
            }
            for (const key14 in data89) {
              if (!(key14 === "hosts")) {
                const err240 = { instancePath: instancePath + "/hardening_contract/C9", schemaPath: "#/$defs/hardeningContract/properties/C9/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key14 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err240];
                } else {
                  vErrors.push(err240);
                }
                errors++;
              }
            }
            if (data89.hosts !== void 0) {
              if (!func0(data89.hosts, schema46.properties.C9.properties.hosts.const)) {
                const err241 = { instancePath: instancePath + "/hardening_contract/C9/hosts", schemaPath: "#/$defs/hardeningContract/properties/C9/properties/hosts/const", keyword: "const", params: { allowedValue: schema46.properties.C9.properties.hosts.const }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err241];
                } else {
                  vErrors.push(err241);
                }
                errors++;
              }
            }
          } else {
            const err242 = { instancePath: instancePath + "/hardening_contract/C9", schemaPath: "#/$defs/hardeningContract/properties/C9/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err242];
            } else {
              vErrors.push(err242);
            }
            errors++;
          }
        }
        if (data64.C10 !== void 0) {
          let data91 = data64.C10;
          if (data91 && typeof data91 == "object" && !Array.isArray(data91)) {
            if (data91.changed_scope_base_option === void 0) {
              const err243 = { instancePath: instancePath + "/hardening_contract/C10", schemaPath: "#/$defs/hardeningContract/properties/C10/required", keyword: "required", params: { missingProperty: "changed_scope_base_option" }, message: "must have required property 'changed_scope_base_option'" };
              if (vErrors === null) {
                vErrors = [err243];
              } else {
                vErrors.push(err243);
              }
              errors++;
            }
            if (data91.immutable_chain === void 0) {
              const err244 = { instancePath: instancePath + "/hardening_contract/C10", schemaPath: "#/$defs/hardeningContract/properties/C10/required", keyword: "required", params: { missingProperty: "immutable_chain" }, message: "must have required property 'immutable_chain'" };
              if (vErrors === null) {
                vErrors = [err244];
              } else {
                vErrors.push(err244);
              }
              errors++;
            }
            for (const key15 in data91) {
              if (!(key15 === "changed_scope_base_option" || key15 === "immutable_chain")) {
                const err245 = { instancePath: instancePath + "/hardening_contract/C10", schemaPath: "#/$defs/hardeningContract/properties/C10/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key15 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err245];
                } else {
                  vErrors.push(err245);
                }
                errors++;
              }
            }
            if (data91.changed_scope_base_option !== void 0) {
              if ("--base" !== data91.changed_scope_base_option) {
                const err246 = { instancePath: instancePath + "/hardening_contract/C10/changed_scope_base_option", schemaPath: "#/$defs/hardeningContract/properties/C10/properties/changed_scope_base_option/const", keyword: "const", params: { allowedValue: "--base" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err246];
                } else {
                  vErrors.push(err246);
                }
                errors++;
              }
            }
            if (data91.immutable_chain !== void 0) {
              if (true !== data91.immutable_chain) {
                const err247 = { instancePath: instancePath + "/hardening_contract/C10/immutable_chain", schemaPath: "#/$defs/hardeningContract/properties/C10/properties/immutable_chain/const", keyword: "const", params: { allowedValue: true }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err247];
                } else {
                  vErrors.push(err247);
                }
                errors++;
              }
            }
          } else {
            const err248 = { instancePath: instancePath + "/hardening_contract/C10", schemaPath: "#/$defs/hardeningContract/properties/C10/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err248];
            } else {
              vErrors.push(err248);
            }
            errors++;
          }
        }
        if (data64.C11 !== void 0) {
          let data94 = data64.C11;
          if (data94 && typeof data94 == "object" && !Array.isArray(data94)) {
            if (data94.k2_allows_partial === void 0) {
              const err249 = { instancePath: instancePath + "/hardening_contract/C11", schemaPath: "#/$defs/hardeningContract/properties/C11/required", keyword: "required", params: { missingProperty: "k2_allows_partial" }, message: "must have required property 'k2_allows_partial'" };
              if (vErrors === null) {
                vErrors = [err249];
              } else {
                vErrors.push(err249);
              }
              errors++;
            }
            for (const key16 in data94) {
              if (!(key16 === "k2_allows_partial")) {
                const err250 = { instancePath: instancePath + "/hardening_contract/C11", schemaPath: "#/$defs/hardeningContract/properties/C11/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key16 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err250];
                } else {
                  vErrors.push(err250);
                }
                errors++;
              }
            }
            if (data94.k2_allows_partial !== void 0) {
              if (false !== data94.k2_allows_partial) {
                const err251 = { instancePath: instancePath + "/hardening_contract/C11/k2_allows_partial", schemaPath: "#/$defs/hardeningContract/properties/C11/properties/k2_allows_partial/const", keyword: "const", params: { allowedValue: false }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err251];
                } else {
                  vErrors.push(err251);
                }
                errors++;
              }
            }
          } else {
            const err252 = { instancePath: instancePath + "/hardening_contract/C11", schemaPath: "#/$defs/hardeningContract/properties/C11/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err252];
            } else {
              vErrors.push(err252);
            }
            errors++;
          }
        }
        if (data64.C12 !== void 0) {
          let data96 = data64.C12;
          if (data96 && typeof data96 == "object" && !Array.isArray(data96)) {
            if (data96.report_tracks === void 0) {
              const err253 = { instancePath: instancePath + "/hardening_contract/C12", schemaPath: "#/$defs/hardeningContract/properties/C12/required", keyword: "required", params: { missingProperty: "report_tracks" }, message: "must have required property 'report_tracks'" };
              if (vErrors === null) {
                vErrors = [err253];
              } else {
                vErrors.push(err253);
              }
              errors++;
            }
            for (const key17 in data96) {
              if (!(key17 === "report_tracks")) {
                const err254 = { instancePath: instancePath + "/hardening_contract/C12", schemaPath: "#/$defs/hardeningContract/properties/C12/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key17 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err254];
                } else {
                  vErrors.push(err254);
                }
                errors++;
              }
            }
            if (data96.report_tracks !== void 0) {
              if (!func0(data96.report_tracks, schema46.properties.C12.properties.report_tracks.const)) {
                const err255 = { instancePath: instancePath + "/hardening_contract/C12/report_tracks", schemaPath: "#/$defs/hardeningContract/properties/C12/properties/report_tracks/const", keyword: "const", params: { allowedValue: schema46.properties.C12.properties.report_tracks.const }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err255];
                } else {
                  vErrors.push(err255);
                }
                errors++;
              }
            }
          } else {
            const err256 = { instancePath: instancePath + "/hardening_contract/C12", schemaPath: "#/$defs/hardeningContract/properties/C12/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err256];
            } else {
              vErrors.push(err256);
            }
            errors++;
          }
        }
        if (data64.C13 !== void 0) {
          let data98 = data64.C13;
          if (data98 && typeof data98 == "object" && !Array.isArray(data98)) {
            if (data98.research_supersession_required === void 0) {
              const err257 = { instancePath: instancePath + "/hardening_contract/C13", schemaPath: "#/$defs/hardeningContract/properties/C13/required", keyword: "required", params: { missingProperty: "research_supersession_required" }, message: "must have required property 'research_supersession_required'" };
              if (vErrors === null) {
                vErrors = [err257];
              } else {
                vErrors.push(err257);
              }
              errors++;
            }
            for (const key18 in data98) {
              if (!(key18 === "research_supersession_required")) {
                const err258 = { instancePath: instancePath + "/hardening_contract/C13", schemaPath: "#/$defs/hardeningContract/properties/C13/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key18 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err258];
                } else {
                  vErrors.push(err258);
                }
                errors++;
              }
            }
            if (data98.research_supersession_required !== void 0) {
              if (true !== data98.research_supersession_required) {
                const err259 = { instancePath: instancePath + "/hardening_contract/C13/research_supersession_required", schemaPath: "#/$defs/hardeningContract/properties/C13/properties/research_supersession_required/const", keyword: "const", params: { allowedValue: true }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err259];
                } else {
                  vErrors.push(err259);
                }
                errors++;
              }
            }
          } else {
            const err260 = { instancePath: instancePath + "/hardening_contract/C13", schemaPath: "#/$defs/hardeningContract/properties/C13/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err260];
            } else {
              vErrors.push(err260);
            }
            errors++;
          }
        }
        if (data64.C14 !== void 0) {
          let data100 = data64.C14;
          if (data100 && typeof data100 == "object" && !Array.isArray(data100)) {
            if (data100.runtime_skill_count === void 0) {
              const err261 = { instancePath: instancePath + "/hardening_contract/C14", schemaPath: "#/$defs/hardeningContract/properties/C14/required", keyword: "required", params: { missingProperty: "runtime_skill_count" }, message: "must have required property 'runtime_skill_count'" };
              if (vErrors === null) {
                vErrors = [err261];
              } else {
                vErrors.push(err261);
              }
              errors++;
            }
            if (data100.governance_meta_skill_is_runtime === void 0) {
              const err262 = { instancePath: instancePath + "/hardening_contract/C14", schemaPath: "#/$defs/hardeningContract/properties/C14/required", keyword: "required", params: { missingProperty: "governance_meta_skill_is_runtime" }, message: "must have required property 'governance_meta_skill_is_runtime'" };
              if (vErrors === null) {
                vErrors = [err262];
              } else {
                vErrors.push(err262);
              }
              errors++;
            }
            for (const key19 in data100) {
              if (!(key19 === "runtime_skill_count" || key19 === "governance_meta_skill_is_runtime")) {
                const err263 = { instancePath: instancePath + "/hardening_contract/C14", schemaPath: "#/$defs/hardeningContract/properties/C14/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key19 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err263];
                } else {
                  vErrors.push(err263);
                }
                errors++;
              }
            }
            if (data100.runtime_skill_count !== void 0) {
              if (8 !== data100.runtime_skill_count) {
                const err264 = { instancePath: instancePath + "/hardening_contract/C14/runtime_skill_count", schemaPath: "#/$defs/hardeningContract/properties/C14/properties/runtime_skill_count/const", keyword: "const", params: { allowedValue: 8 }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err264];
                } else {
                  vErrors.push(err264);
                }
                errors++;
              }
            }
            if (data100.governance_meta_skill_is_runtime !== void 0) {
              if (false !== data100.governance_meta_skill_is_runtime) {
                const err265 = { instancePath: instancePath + "/hardening_contract/C14/governance_meta_skill_is_runtime", schemaPath: "#/$defs/hardeningContract/properties/C14/properties/governance_meta_skill_is_runtime/const", keyword: "const", params: { allowedValue: false }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err265];
                } else {
                  vErrors.push(err265);
                }
                errors++;
              }
            }
          } else {
            const err266 = { instancePath: instancePath + "/hardening_contract/C14", schemaPath: "#/$defs/hardeningContract/properties/C14/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err266];
            } else {
              vErrors.push(err266);
            }
            errors++;
          }
        }
      } else {
        const err267 = { instancePath: instancePath + "/hardening_contract", schemaPath: "#/$defs/hardeningContract/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err267];
        } else {
          vErrors.push(err267);
        }
        errors++;
      }
    }
    if (data.structural_status !== void 0) {
      let data103 = data.structural_status;
      if (data103 && typeof data103 == "object" && !Array.isArray(data103)) {
        if (data103.state === void 0) {
          const err268 = { instancePath: instancePath + "/structural_status", schemaPath: "#/$defs/structuralStatus/required", keyword: "required", params: { missingProperty: "state" }, message: "must have required property 'state'" };
          if (vErrors === null) {
            vErrors = [err268];
          } else {
            vErrors.push(err268);
          }
          errors++;
        }
        for (const key20 in data103) {
          if (!(key20 === "state")) {
            const err269 = { instancePath: instancePath + "/structural_status", schemaPath: "#/$defs/structuralStatus/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key20 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err269];
            } else {
              vErrors.push(err269);
            }
            errors++;
          }
        }
        if (data103.state !== void 0) {
          let data104 = data103.state;
          if (!(data104 === "pass" || data104 === "fail" || data104 === "debt" || data104 === "not_run")) {
            const err270 = { instancePath: instancePath + "/structural_status/state", schemaPath: "#/$defs/structuralStatus/properties/state/enum", keyword: "enum", params: { allowedValues: schema47.properties.state.enum }, message: "must be equal to one of the allowed values" };
            if (vErrors === null) {
              vErrors = [err270];
            } else {
              vErrors.push(err270);
            }
            errors++;
          }
        }
      } else {
        const err271 = { instancePath: instancePath + "/structural_status", schemaPath: "#/$defs/structuralStatus/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err271];
        } else {
          vErrors.push(err271);
        }
        errors++;
      }
    }
    if (data.behavioral_evidence_status !== void 0) {
      if (!validate21(data.behavioral_evidence_status, { instancePath: instancePath + "/behavioral_evidence_status", parentData: data, parentDataProperty: "behavioral_evidence_status", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate21.errors : vErrors.concat(validate21.errors);
        errors = vErrors.length;
      }
    }
    if (data.improvement_claim !== void 0) {
      let data106 = data.improvement_claim;
      if (typeof data106 === "string") {
        if (func1(data106) < 1) {
          const err272 = { instancePath: instancePath + "/improvement_claim", schemaPath: "#/properties/improvement_claim/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err272];
          } else {
            vErrors.push(err272);
          }
          errors++;
        }
      } else {
        const err273 = { instancePath: instancePath + "/improvement_claim", schemaPath: "#/properties/improvement_claim/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err273];
        } else {
          vErrors.push(err273);
        }
        errors++;
      }
    }
    if (data.action !== void 0) {
      let data107 = data.action;
      if (!(data107 === "begin" || data107 === "validate" || data107 === "apply")) {
        const err274 = { instancePath: instancePath + "/action", schemaPath: "#/properties/action/enum", keyword: "enum", params: { allowedValues: schema31.properties.action.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err274];
        } else {
          vErrors.push(err274);
        }
        errors++;
      }
    }
    if (data.workspace !== void 0) {
      let data108 = data.workspace;
      if (typeof data108 === "string") {
        if (func1(data108) < 1) {
          const err275 = { instancePath: instancePath + "/workspace", schemaPath: "#/$defs/repoPath/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err275];
          } else {
            vErrors.push(err275);
          }
          errors++;
        }
        if (!pattern4.test(data108)) {
          const err276 = { instancePath: instancePath + "/workspace", schemaPath: "#/$defs/repoPath/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9._<>/-]+$" }, message: 'must match pattern "^[A-Za-z0-9._<>/-]+$"' };
          if (vErrors === null) {
            vErrors = [err276];
          } else {
            vErrors.push(err276);
          }
          errors++;
        }
      } else {
        const err277 = { instancePath: instancePath + "/workspace", schemaPath: "#/$defs/repoPath/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err277];
        } else {
          vErrors.push(err277);
        }
        errors++;
      }
    }
    if (data.ledger_path !== void 0) {
      let data109 = data.ledger_path;
      if (typeof data109 === "string") {
        if (func1(data109) < 1) {
          const err278 = { instancePath: instancePath + "/ledger_path", schemaPath: "#/$defs/repoPath/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err278];
          } else {
            vErrors.push(err278);
          }
          errors++;
        }
        if (!pattern4.test(data109)) {
          const err279 = { instancePath: instancePath + "/ledger_path", schemaPath: "#/$defs/repoPath/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9._<>/-]+$" }, message: 'must match pattern "^[A-Za-z0-9._<>/-]+$"' };
          if (vErrors === null) {
            vErrors = [err279];
          } else {
            vErrors.push(err279);
          }
          errors++;
        }
      } else {
        const err280 = { instancePath: instancePath + "/ledger_path", schemaPath: "#/$defs/repoPath/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err280];
        } else {
          vErrors.push(err280);
        }
        errors++;
      }
    }
    if (data.result_graph_sha256 !== void 0) {
      let data110 = data.result_graph_sha256;
      if (typeof data110 === "string") {
        if (!pattern14.test(data110)) {
          const err281 = { instancePath: instancePath + "/result_graph_sha256", schemaPath: "#/properties/result_graph_sha256/pattern", keyword: "pattern", params: { pattern: "^[a-f0-9]{64}$" }, message: 'must match pattern "^[a-f0-9]{64}$"' };
          if (vErrors === null) {
            vErrors = [err281];
          } else {
            vErrors.push(err281);
          }
          errors++;
        }
      } else {
        const err282 = { instancePath: instancePath + "/result_graph_sha256", schemaPath: "#/properties/result_graph_sha256/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err282];
        } else {
          vErrors.push(err282);
        }
        errors++;
      }
    }
    if (data.validation !== void 0) {
      let data111 = data.validation;
      if (!(data111 && typeof data111 == "object" && !Array.isArray(data111))) {
        const err283 = { instancePath: instancePath + "/validation", schemaPath: "#/properties/validation/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err283];
        } else {
          vErrors.push(err283);
        }
        errors++;
      }
    }
    if (data.diagnostics !== void 0) {
      let data112 = data.diagnostics;
      if (Array.isArray(data112)) {
        const len5 = data112.length;
        for (let i10 = 0; i10 < len5; i10++) {
          let data113 = data112[i10];
          if (data113 && typeof data113 == "object" && !Array.isArray(data113)) {
            if (data113.severity === void 0) {
              const err284 = { instancePath: instancePath + "/diagnostics/" + i10, schemaPath: "#/$defs/diagnostic/required", keyword: "required", params: { missingProperty: "severity" }, message: "must have required property 'severity'" };
              if (vErrors === null) {
                vErrors = [err284];
              } else {
                vErrors.push(err284);
              }
              errors++;
            }
            if (data113.code === void 0) {
              const err285 = { instancePath: instancePath + "/diagnostics/" + i10, schemaPath: "#/$defs/diagnostic/required", keyword: "required", params: { missingProperty: "code" }, message: "must have required property 'code'" };
              if (vErrors === null) {
                vErrors = [err285];
              } else {
                vErrors.push(err285);
              }
              errors++;
            }
            if (data113.message === void 0) {
              const err286 = { instancePath: instancePath + "/diagnostics/" + i10, schemaPath: "#/$defs/diagnostic/required", keyword: "required", params: { missingProperty: "message" }, message: "must have required property 'message'" };
              if (vErrors === null) {
                vErrors = [err286];
              } else {
                vErrors.push(err286);
              }
              errors++;
            }
            if (data113.location === void 0) {
              const err287 = { instancePath: instancePath + "/diagnostics/" + i10, schemaPath: "#/$defs/diagnostic/required", keyword: "required", params: { missingProperty: "location" }, message: "must have required property 'location'" };
              if (vErrors === null) {
                vErrors = [err287];
              } else {
                vErrors.push(err287);
              }
              errors++;
            }
            if (data113.witness === void 0) {
              const err288 = { instancePath: instancePath + "/diagnostics/" + i10, schemaPath: "#/$defs/diagnostic/required", keyword: "required", params: { missingProperty: "witness" }, message: "must have required property 'witness'" };
              if (vErrors === null) {
                vErrors = [err288];
              } else {
                vErrors.push(err288);
              }
              errors++;
            }
            if (data113.remediation === void 0) {
              const err289 = { instancePath: instancePath + "/diagnostics/" + i10, schemaPath: "#/$defs/diagnostic/required", keyword: "required", params: { missingProperty: "remediation" }, message: "must have required property 'remediation'" };
              if (vErrors === null) {
                vErrors = [err289];
              } else {
                vErrors.push(err289);
              }
              errors++;
            }
            for (const key21 in data113) {
              if (!(key21 === "severity" || key21 === "code" || key21 === "message" || key21 === "location" || key21 === "witness" || key21 === "remediation")) {
                const err290 = { instancePath: instancePath + "/diagnostics/" + i10, schemaPath: "#/$defs/diagnostic/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key21 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err290];
                } else {
                  vErrors.push(err290);
                }
                errors++;
              }
            }
            if (data113.severity !== void 0) {
              let data114 = data113.severity;
              if (!(data114 === "error" || data114 === "warning" || data114 === "debt" || data114 === "info")) {
                const err291 = { instancePath: instancePath + "/diagnostics/" + i10 + "/severity", schemaPath: "#/$defs/diagnostic/properties/severity/enum", keyword: "enum", params: { allowedValues: schema52.properties.severity.enum }, message: "must be equal to one of the allowed values" };
                if (vErrors === null) {
                  vErrors = [err291];
                } else {
                  vErrors.push(err291);
                }
                errors++;
              }
            }
            if (data113.code !== void 0) {
              let data115 = data113.code;
              if (typeof data115 === "string") {
                if (!pattern15.test(data115)) {
                  const err292 = { instancePath: instancePath + "/diagnostics/" + i10 + "/code", schemaPath: "#/$defs/diagnostic/properties/code/pattern", keyword: "pattern", params: { pattern: "^SKG-[A-Z0-9-]+$" }, message: 'must match pattern "^SKG-[A-Z0-9-]+$"' };
                  if (vErrors === null) {
                    vErrors = [err292];
                  } else {
                    vErrors.push(err292);
                  }
                  errors++;
                }
              } else {
                const err293 = { instancePath: instancePath + "/diagnostics/" + i10 + "/code", schemaPath: "#/$defs/diagnostic/properties/code/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err293];
                } else {
                  vErrors.push(err293);
                }
                errors++;
              }
            }
            if (data113.message !== void 0) {
              let data116 = data113.message;
              if (typeof data116 === "string") {
                if (func1(data116) < 1) {
                  const err294 = { instancePath: instancePath + "/diagnostics/" + i10 + "/message", schemaPath: "#/$defs/diagnostic/properties/message/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err294];
                  } else {
                    vErrors.push(err294);
                  }
                  errors++;
                }
              } else {
                const err295 = { instancePath: instancePath + "/diagnostics/" + i10 + "/message", schemaPath: "#/$defs/diagnostic/properties/message/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err295];
                } else {
                  vErrors.push(err295);
                }
                errors++;
              }
            }
            if (data113.location !== void 0) {
              let data117 = data113.location;
              if (typeof data117 === "string") {
                if (func1(data117) < 1) {
                  const err296 = { instancePath: instancePath + "/diagnostics/" + i10 + "/location", schemaPath: "#/$defs/diagnostic/properties/location/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err296];
                  } else {
                    vErrors.push(err296);
                  }
                  errors++;
                }
              } else {
                const err297 = { instancePath: instancePath + "/diagnostics/" + i10 + "/location", schemaPath: "#/$defs/diagnostic/properties/location/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err297];
                } else {
                  vErrors.push(err297);
                }
                errors++;
              }
            }
            if (data113.witness !== void 0) {
              let data118 = data113.witness;
              if (!(data118 && typeof data118 == "object" && !Array.isArray(data118))) {
                const err298 = { instancePath: instancePath + "/diagnostics/" + i10 + "/witness", schemaPath: "#/$defs/diagnostic/properties/witness/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err298];
                } else {
                  vErrors.push(err298);
                }
                errors++;
              }
            }
            if (data113.remediation !== void 0) {
              let data119 = data113.remediation;
              if (typeof data119 === "string") {
                if (func1(data119) < 1) {
                  const err299 = { instancePath: instancePath + "/diagnostics/" + i10 + "/remediation", schemaPath: "#/$defs/diagnostic/properties/remediation/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err299];
                  } else {
                    vErrors.push(err299);
                  }
                  errors++;
                }
              } else {
                const err300 = { instancePath: instancePath + "/diagnostics/" + i10 + "/remediation", schemaPath: "#/$defs/diagnostic/properties/remediation/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err300];
                } else {
                  vErrors.push(err300);
                }
                errors++;
              }
            }
          } else {
            const err301 = { instancePath: instancePath + "/diagnostics/" + i10, schemaPath: "#/$defs/diagnostic/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err301];
            } else {
              vErrors.push(err301);
            }
            errors++;
          }
        }
      } else {
        const err302 = { instancePath: instancePath + "/diagnostics", schemaPath: "#/properties/diagnostics/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err302];
        } else {
          vErrors.push(err302);
        }
        errors++;
      }
    }
    if (props0 !== true) {
      for (const key22 in data) {
        if (!props0 || !props0[key22]) {
          const err303 = { instancePath, schemaPath: "#/unevaluatedProperties", keyword: "unevaluatedProperties", params: { unevaluatedProperty: key22 }, message: "must NOT have unevaluated properties" };
          if (vErrors === null) {
            vErrors = [err303];
          } else {
            vErrors.push(err303);
          }
          errors++;
        }
      }
    }
  } else {
    const err304 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err304];
    } else {
      vErrors.push(err304);
    }
    errors++;
  }
  validate20.errors = vErrors;
  return errors === 0;
}
validate20.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
