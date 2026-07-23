/**
 * Generated standalone Draft 2020-12 validator (bundled).
 * Source: design_docs/skill-knowledge-graph/schemas/knowledge-cli-output.schema.json
 * Source-schema-sha256: 9b2a9892e33d5401f76d103a8536ee501b5dd874993b46e5191e0a774700ef9a
 * Schema-fingerprint: 2f0e10244faad75d6d43d6773f35494ceb4c27f16425896f58261521c90a0dd6
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
var schema31 = { "$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "https://cc-master.dev/schemas/skill-knowledge-cli-output-v1alpha1.json", "title": "cc-master skill knowledge CLI output", "description": "Machine-readable envelope for contract, check, usage, and fail-closed capability results.", "type": "object", "unevaluatedProperties": false, "required": ["schema", "ok", "command", "result_kind", "contract_version"], "properties": { "schema": { "const": "cc-master/skill-knowledge-cli/v1alpha1" }, "ok": { "type": "boolean" }, "command": { "type": "string", "minLength": 1 }, "result_kind": { "enum": ["contract", "check", "report", "change", "path", "explain", "diagnostic"] }, "graph_hash": { "type": "string", "pattern": "^[a-f0-9]{64}$" }, "path_query": { "$ref": "#/$defs/pathQuery" }, "path_result": { "$ref": "#/$defs/pathResult" }, "explain_target": { "type": "string", "minLength": 1 }, "entity": { "$ref": "#/$defs/explainedEntity" }, "contract_version": { "const": "v1alpha1" }, "implemented_commands": { "$ref": "#/$defs/stringSet" }, "declared_commands": { "$ref": "#/$defs/stringSet" }, "operations": { "$ref": "#/$defs/stringSet" }, "planes": { "$ref": "#/$defs/stringSet" }, "invariants": { "$ref": "#/$defs/stringSet" }, "exit_codes": { "type": "object", "minProperties": 1, "additionalProperties": { "type": "integer", "minimum": 0, "maximum": 255 } }, "schemas": { "type": "object", "additionalProperties": false, "required": ["source", "change", "output", "cli"], "properties": { "source": { "$ref": "#/$defs/repoPath" }, "change": { "$ref": "#/$defs/repoPath" }, "output": { "$ref": "#/$defs/repoPath" }, "cli": { "$ref": "#/$defs/repoPath" } } }, "source_layout": { "type": "object", "additionalProperties": false, "required": ["root", "portfolio", "changes", "skills"], "properties": { "root": { "$ref": "#/$defs/repoPath" }, "portfolio": { "$ref": "#/$defs/repoPath" }, "changes": { "$ref": "#/$defs/repoPath" }, "skills": { "type": "string", "minLength": 1 } } }, "stage": { "enum": ["K0", "K1", "K2", "K3"] }, "source_root": { "type": "string", "minLength": 1 }, "summary": { "$ref": "#/$defs/summary" }, "capabilities": { "$ref": "#/$defs/capabilities" }, "hardening_contract": { "$ref": "#/$defs/hardeningContract" }, "structural_status": { "$ref": "#/$defs/structuralStatus" }, "behavioral_evidence_status": { "$ref": "#/$defs/behavioralEvidenceStatus" }, "improvement_claim": { "type": "string", "minLength": 1 }, "action": { "enum": ["begin", "validate", "apply"] }, "workspace": { "$ref": "#/$defs/repoPath" }, "ledger_path": { "$ref": "#/$defs/repoPath" }, "result_graph_sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }, "validation": { "type": "object" }, "diagnostics": { "type": "array", "items": { "$ref": "#/$defs/diagnostic" } } }, "allOf": [{ "if": { "properties": { "result_kind": { "const": "change" } }, "required": ["result_kind"] }, "then": { "required": ["action", "diagnostics"] } }, { "if": { "properties": { "result_kind": { "const": "contract" }, "ok": { "const": true } }, "required": ["result_kind", "ok"] }, "then": { "required": ["implemented_commands", "declared_commands", "operations", "planes", "invariants", "exit_codes", "schemas", "source_layout", "capabilities", "hardening_contract"] } }, { "if": { "properties": { "result_kind": { "const": "report" } }, "required": ["result_kind"] }, "then": { "required": ["structural_status", "behavioral_evidence_status", "diagnostics"] } }, { "if": { "properties": { "result_kind": { "const": "path" }, "ok": { "const": true } }, "required": ["result_kind", "ok"] }, "then": { "required": ["path_query", "path_result", "diagnostics"] } }, { "if": { "properties": { "result_kind": { "const": "explain" }, "ok": { "const": true } }, "required": ["result_kind", "ok"] }, "then": { "required": ["explain_target", "entity", "diagnostics"] } }, { "if": { "properties": { "result_kind": { "const": "check" } }, "required": ["result_kind"] }, "then": { "required": ["stage", "source_root", "summary", "capabilities", "diagnostics"] } }, { "if": { "properties": { "ok": { "const": false } }, "required": ["ok"] }, "then": { "required": ["diagnostics"], "properties": { "diagnostics": { "minItems": 1 } } } }, { "if": { "required": ["improvement_claim"] }, "then": { "properties": { "behavioral_evidence_status": { "properties": { "state": { "const": "holdout_verdict" } }, "required": ["state"] } }, "required": ["behavioral_evidence_status"] } }], "$defs": { "repoPath": { "type": "string", "minLength": 1, "pattern": "^[A-Za-z0-9._<>/-]+$" }, "stringSet": { "type": "array", "items": { "type": "string", "minLength": 1 }, "uniqueItems": true }, "capabilities": { "type": "object", "additionalProperties": false, "required": ["source_json_parse", "source_envelope_validation", "global_id_uniqueness", "full_json_schema_validation", "markdown_binding", "graph_invariants", "runtime_projection", "hop_analysis", "typed_change_transactions", "entry_surface_binding", "canonical_source_inventory", "derived_freshness", "canonical_graph_hash", "deterministic_budget_estimator", "host_portability_probe", "semantic_coverage", "behavioral_evidence_tracking"], "properties": { "source_json_parse": { "type": "boolean" }, "source_envelope_validation": { "type": "boolean" }, "global_id_uniqueness": { "type": "boolean" }, "full_json_schema_validation": { "type": "boolean" }, "markdown_binding": { "type": "boolean" }, "graph_invariants": { "type": "boolean" }, "runtime_projection": { "type": "boolean" }, "hop_analysis": { "type": "boolean" }, "typed_change_transactions": { "type": "boolean" }, "entry_surface_binding": { "type": "boolean" }, "canonical_source_inventory": { "type": "boolean" }, "derived_freshness": { "type": "boolean" }, "canonical_graph_hash": { "type": "boolean" }, "deterministic_budget_estimator": { "type": "boolean" }, "host_portability_probe": { "type": "boolean" }, "semantic_coverage": { "type": "boolean" }, "behavioral_evidence_tracking": { "type": "boolean" } } }, "hardeningContract": { "type": "object", "additionalProperties": false, "required": ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11", "C12", "C13", "C14"], "properties": { "C1": { "type": "object", "additionalProperties": false, "required": ["entry_surface_fields"], "properties": { "entry_surface_fields": { "const": ["host", "source_file", "binding", "surface_kind", "targets", "lifecycle"] } } }, "C2": { "type": "object", "additionalProperties": false, "required": ["coverage_states", "denominator"], "properties": { "coverage_states": { "const": ["full", "partial", "non_knowledge", "excluded"] }, "denominator": { "const": "git_canonical_markdown" } } }, "C3": { "type": "object", "additionalProperties": false, "required": ["derived_fields"], "properties": { "derived_fields": { "const": ["canonical", "review_policy", "reviewed_canonical_sha256"] } } }, "C4": { "type": "object", "additionalProperties": false, "required": ["accepted_skill_requires_admission"], "properties": { "accepted_skill_requires_admission": { "const": true } } }, "C5": { "type": "object", "additionalProperties": false, "required": ["change_workflow", "workspace_root"], "properties": { "change_workflow": { "const": ["begin", "validate", "apply"] }, "workspace_root": { "const": ".skill-knowledge/workspaces/<change-id>" } } }, "C6": { "type": "object", "additionalProperties": false, "required": ["algorithm", "authored_manifest_kinds", "change_head_digest_excludes", "identity_set_fields", "semantic_order_fields"], "properties": { "algorithm": { "const": "cc-master/skill-knowledge-canonical-graph-hash/v1" }, "authored_manifest_kinds": { "const": ["portfolio", "skill", "module"] }, "change_head_digest_excludes": { "const": ["result_graph_sha256"] }, "identity_set_fields": { "const": ["skills", "modules", "points", "edges", "entries", "canonical_source_inventory", "inventory", "entry_modules", "relevant_entries", "primary_points", "point_ids"] }, "semantic_order_fields": { "const": ["operations", "when", "avoid_when", "recognition_cues", "includes", "excludes", "unresolved_coverage_debt", "evidence", "verifiers", "targets", "results", "edge_rewrites", "surfaces", "host_coverage", "runtime_hosts", "scope"] } } }, "C7": { "type": "object", "additionalProperties": false, "required": ["algorithm", "newline_normalization"], "properties": { "algorithm": { "const": "cc-master/skill-knowledge-markdown-span-hash/v1" }, "newline_normalization": { "const": "crlf-to-lf" } } }, "C8": { "type": "object", "additionalProperties": false, "required": ["algorithm", "formula"], "properties": { "algorithm": { "const": "cc-master/skill-knowledge-budget-estimator/v1" }, "formula": { "const": "ceil(utf8_bytes/3)" } } }, "C9": { "type": "object", "additionalProperties": false, "required": ["hosts", "worker_allowlist", "payload_modes", "anchor_form", "path_policy"], "properties": { "hosts": { "const": ["claude-code", "codex", "cursor", "kimi-code"] }, "worker_allowlist": { "const": ["codex", "cursor"] }, "payload_modes": { "const": ["canonical", "partial", "stub"] }, "anchor_form": { "const": "explicit-html-id" }, "path_policy": { "const": "relative-final-host-path" } } }, "C10": { "type": "object", "additionalProperties": false, "required": ["changed_scope_base_option", "immutable_chain"], "properties": { "changed_scope_base_option": { "const": "--base" }, "immutable_chain": { "const": true } } }, "C11": { "type": "object", "additionalProperties": false, "required": ["k2_allows_partial"], "properties": { "k2_allows_partial": { "const": false } } }, "C12": { "type": "object", "additionalProperties": false, "required": ["report_tracks"], "properties": { "report_tracks": { "const": ["structural_status", "behavioral_evidence_status"] } } }, "C13": { "type": "object", "additionalProperties": false, "required": ["research_supersession_required"], "properties": { "research_supersession_required": { "const": true } } }, "C14": { "type": "object", "additionalProperties": false, "required": ["runtime_skill_count", "governance_meta_skill_is_runtime"], "properties": { "runtime_skill_count": { "const": 8 }, "governance_meta_skill_is_runtime": { "const": false } } } } }, "structuralStatus": { "type": "object", "additionalProperties": false, "required": ["state"], "properties": { "state": { "enum": ["pass", "fail", "debt", "not_run"] }, "counts": { "type": "object", "additionalProperties": { "type": "integer", "minimum": 0 } }, "graph_hash": { "type": "string", "pattern": "^[a-f0-9]{64}$" } } }, "behavioralEvidenceStatus": { "type": "object", "additionalProperties": false, "required": ["state", "evidence"], "properties": { "state": { "enum": ["not_run", "baseline", "candidate", "holdout_verdict"] }, "evidence": { "type": "array", "items": { "$ref": "#/$defs/repoPath" }, "uniqueItems": true }, "verdict": { "enum": ["improved", "regressed", "no_material_change", "inconclusive"] } }, "allOf": [{ "if": { "properties": { "state": { "const": "holdout_verdict" } }, "required": ["state"] }, "then": { "required": ["verdict"] } }] }, "pathQuery": { "type": "object", "additionalProperties": false, "required": ["from", "to", "host", "plane"], "properties": { "from": { "type": "string", "minLength": 1 }, "to": { "type": "string", "minLength": 1 }, "host": { "type": "string", "minLength": 1 }, "plane": { "const": "navigation" } } }, "pathHop": { "type": "object", "additionalProperties": false, "required": ["from", "to", "edge_id", "type"], "properties": { "from": { "type": "string", "minLength": 1 }, "to": { "type": "string", "minLength": 1 }, "edge_id": { "type": "string", "minLength": 1 }, "type": { "type": "string", "minLength": 1 } } }, "pathResult": { "type": "object", "additionalProperties": false, "required": ["reachable", "hops", "witness"], "properties": { "reachable": { "type": "boolean" }, "hops": { "type": ["integer", "null"], "minimum": 0 }, "nodes": { "type": "array", "items": { "type": "string", "minLength": 1 } }, "edges": { "type": "array", "items": { "$ref": "#/$defs/pathHop" } }, "witness": { "type": "object" } }, "allOf": [{ "if": { "properties": { "reachable": { "const": true } }, "required": ["reachable"] }, "then": { "properties": { "hops": { "type": "integer", "minimum": 0 } } } }, { "if": { "properties": { "reachable": { "const": false } }, "required": ["reachable"] }, "then": { "properties": { "hops": { "type": "null" } } } }] }, "explainedEntity": { "type": "object", "additionalProperties": false, "required": ["id", "kind"], "properties": { "id": { "type": "string", "minLength": 1 }, "kind": { "enum": ["portfolio", "skill", "module", "point", "edge", "entry", "diagnostic"] }, "owner_skill": { "type": "string", "minLength": 1 }, "module": { "type": "string", "minLength": 1 }, "authority": { "type": "object" }, "binding": { "type": "object" }, "recognition_cues": { "type": "array", "items": { "type": "string" } }, "inbound": { "type": "array", "items": { "type": "string" } }, "outbound": { "type": "array", "items": { "type": "string" } }, "access": { "type": "object" }, "witness": { "type": "object" } } }, "summary": { "type": "object", "additionalProperties": false, "required": ["documents", "portfolio", "skill", "module", "change", "errors", "debts"], "properties": { "documents": { "type": "integer", "minimum": 0 }, "portfolio": { "type": "integer", "minimum": 0 }, "skill": { "type": "integer", "minimum": 0 }, "module": { "type": "integer", "minimum": 0 }, "change": { "type": "integer", "minimum": 0 }, "errors": { "type": "integer", "minimum": 0 }, "debts": { "type": "integer", "minimum": 0 } } }, "diagnostic": { "type": "object", "additionalProperties": false, "required": ["severity", "code", "message", "location", "witness", "remediation"], "properties": { "severity": { "enum": ["error", "warning", "debt", "info"] }, "code": { "type": "string", "pattern": "^SKG-[A-Z0-9-]+$" }, "message": { "type": "string", "minLength": 1 }, "location": { "type": "string", "minLength": 1 }, "witness": { "type": "object" }, "remediation": { "type": "string", "minLength": 1 } } } } };
var schema35 = { "type": "object", "additionalProperties": false, "required": ["id", "kind"], "properties": { "id": { "type": "string", "minLength": 1 }, "kind": { "enum": ["portfolio", "skill", "module", "point", "edge", "entry", "diagnostic"] }, "owner_skill": { "type": "string", "minLength": 1 }, "module": { "type": "string", "minLength": 1 }, "authority": { "type": "object" }, "binding": { "type": "object" }, "recognition_cues": { "type": "array", "items": { "type": "string" } }, "inbound": { "type": "array", "items": { "type": "string" } }, "outbound": { "type": "array", "items": { "type": "string" } }, "access": { "type": "object" }, "witness": { "type": "object" } } };
var schema49 = { "type": "object", "additionalProperties": false, "required": ["source_json_parse", "source_envelope_validation", "global_id_uniqueness", "full_json_schema_validation", "markdown_binding", "graph_invariants", "runtime_projection", "hop_analysis", "typed_change_transactions", "entry_surface_binding", "canonical_source_inventory", "derived_freshness", "canonical_graph_hash", "deterministic_budget_estimator", "host_portability_probe", "semantic_coverage", "behavioral_evidence_tracking"], "properties": { "source_json_parse": { "type": "boolean" }, "source_envelope_validation": { "type": "boolean" }, "global_id_uniqueness": { "type": "boolean" }, "full_json_schema_validation": { "type": "boolean" }, "markdown_binding": { "type": "boolean" }, "graph_invariants": { "type": "boolean" }, "runtime_projection": { "type": "boolean" }, "hop_analysis": { "type": "boolean" }, "typed_change_transactions": { "type": "boolean" }, "entry_surface_binding": { "type": "boolean" }, "canonical_source_inventory": { "type": "boolean" }, "derived_freshness": { "type": "boolean" }, "canonical_graph_hash": { "type": "boolean" }, "deterministic_budget_estimator": { "type": "boolean" }, "host_portability_probe": { "type": "boolean" }, "semantic_coverage": { "type": "boolean" }, "behavioral_evidence_tracking": { "type": "boolean" } } };
var schema50 = { "type": "object", "additionalProperties": false, "required": ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11", "C12", "C13", "C14"], "properties": { "C1": { "type": "object", "additionalProperties": false, "required": ["entry_surface_fields"], "properties": { "entry_surface_fields": { "const": ["host", "source_file", "binding", "surface_kind", "targets", "lifecycle"] } } }, "C2": { "type": "object", "additionalProperties": false, "required": ["coverage_states", "denominator"], "properties": { "coverage_states": { "const": ["full", "partial", "non_knowledge", "excluded"] }, "denominator": { "const": "git_canonical_markdown" } } }, "C3": { "type": "object", "additionalProperties": false, "required": ["derived_fields"], "properties": { "derived_fields": { "const": ["canonical", "review_policy", "reviewed_canonical_sha256"] } } }, "C4": { "type": "object", "additionalProperties": false, "required": ["accepted_skill_requires_admission"], "properties": { "accepted_skill_requires_admission": { "const": true } } }, "C5": { "type": "object", "additionalProperties": false, "required": ["change_workflow", "workspace_root"], "properties": { "change_workflow": { "const": ["begin", "validate", "apply"] }, "workspace_root": { "const": ".skill-knowledge/workspaces/<change-id>" } } }, "C6": { "type": "object", "additionalProperties": false, "required": ["algorithm", "authored_manifest_kinds", "change_head_digest_excludes", "identity_set_fields", "semantic_order_fields"], "properties": { "algorithm": { "const": "cc-master/skill-knowledge-canonical-graph-hash/v1" }, "authored_manifest_kinds": { "const": ["portfolio", "skill", "module"] }, "change_head_digest_excludes": { "const": ["result_graph_sha256"] }, "identity_set_fields": { "const": ["skills", "modules", "points", "edges", "entries", "canonical_source_inventory", "inventory", "entry_modules", "relevant_entries", "primary_points", "point_ids"] }, "semantic_order_fields": { "const": ["operations", "when", "avoid_when", "recognition_cues", "includes", "excludes", "unresolved_coverage_debt", "evidence", "verifiers", "targets", "results", "edge_rewrites", "surfaces", "host_coverage", "runtime_hosts", "scope"] } } }, "C7": { "type": "object", "additionalProperties": false, "required": ["algorithm", "newline_normalization"], "properties": { "algorithm": { "const": "cc-master/skill-knowledge-markdown-span-hash/v1" }, "newline_normalization": { "const": "crlf-to-lf" } } }, "C8": { "type": "object", "additionalProperties": false, "required": ["algorithm", "formula"], "properties": { "algorithm": { "const": "cc-master/skill-knowledge-budget-estimator/v1" }, "formula": { "const": "ceil(utf8_bytes/3)" } } }, "C9": { "type": "object", "additionalProperties": false, "required": ["hosts", "worker_allowlist", "payload_modes", "anchor_form", "path_policy"], "properties": { "hosts": { "const": ["claude-code", "codex", "cursor", "kimi-code"] }, "worker_allowlist": { "const": ["codex", "cursor"] }, "payload_modes": { "const": ["canonical", "partial", "stub"] }, "anchor_form": { "const": "explicit-html-id" }, "path_policy": { "const": "relative-final-host-path" } } }, "C10": { "type": "object", "additionalProperties": false, "required": ["changed_scope_base_option", "immutable_chain"], "properties": { "changed_scope_base_option": { "const": "--base" }, "immutable_chain": { "const": true } } }, "C11": { "type": "object", "additionalProperties": false, "required": ["k2_allows_partial"], "properties": { "k2_allows_partial": { "const": false } } }, "C12": { "type": "object", "additionalProperties": false, "required": ["report_tracks"], "properties": { "report_tracks": { "const": ["structural_status", "behavioral_evidence_status"] } } }, "C13": { "type": "object", "additionalProperties": false, "required": ["research_supersession_required"], "properties": { "research_supersession_required": { "const": true } } }, "C14": { "type": "object", "additionalProperties": false, "required": ["runtime_skill_count", "governance_meta_skill_is_runtime"], "properties": { "runtime_skill_count": { "const": 8 }, "governance_meta_skill_is_runtime": { "const": false } } } } };
var schema51 = { "type": "object", "additionalProperties": false, "required": ["state"], "properties": { "state": { "enum": ["pass", "fail", "debt", "not_run"] }, "counts": { "type": "object", "additionalProperties": { "type": "integer", "minimum": 0 } }, "graph_hash": { "type": "string", "pattern": "^[a-f0-9]{64}$" } } };
var schema56 = { "type": "object", "additionalProperties": false, "required": ["severity", "code", "message", "location", "witness", "remediation"], "properties": { "severity": { "enum": ["error", "warning", "debt", "info"] }, "code": { "type": "string", "pattern": "^SKG-[A-Z0-9-]+$" }, "message": { "type": "string", "minLength": 1 }, "location": { "type": "string", "minLength": 1 }, "witness": { "type": "object" }, "remediation": { "type": "string", "minLength": 1 } } };
var func1 = require_ucs2length().default;
var func11 = Object.prototype.hasOwnProperty;
var func0 = require_equal().default;
var pattern4 = new RegExp("^[a-f0-9]{64}$", "u");
var pattern5 = new RegExp("^[A-Za-z0-9._<>/-]+$", "u");
var pattern17 = new RegExp("^SKG-[A-Z0-9-]+$", "u");
var schema33 = { "type": "object", "additionalProperties": false, "required": ["reachable", "hops", "witness"], "properties": { "reachable": { "type": "boolean" }, "hops": { "type": ["integer", "null"], "minimum": 0 }, "nodes": { "type": "array", "items": { "type": "string", "minLength": 1 } }, "edges": { "type": "array", "items": { "$ref": "#/$defs/pathHop" } }, "witness": { "type": "object" } }, "allOf": [{ "if": { "properties": { "reachable": { "const": true } }, "required": ["reachable"] }, "then": { "properties": { "hops": { "type": "integer", "minimum": 0 } } } }, { "if": { "properties": { "reachable": { "const": false } }, "required": ["reachable"] }, "then": { "properties": { "hops": { "type": "null" } } } }] };
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
    if (data.reachable === void 0 && (missing0 = "reachable")) {
      const err0 = {};
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    } else {
      if (data.reachable !== void 0) {
        if (true !== data.reachable) {
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
      if (data.hops !== void 0) {
        let data1 = data.hops;
        if (!(typeof data1 == "number" && (!(data1 % 1) && !isNaN(data1)))) {
          const err2 = { instancePath: instancePath + "/hops", schemaPath: "#/allOf/0/then/properties/hops/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
          if (vErrors === null) {
            vErrors = [err2];
          } else {
            vErrors.push(err2);
          }
          errors++;
        }
        if (typeof data1 == "number") {
          if (data1 < 0 || isNaN(data1)) {
            const err3 = { instancePath: instancePath + "/hops", schemaPath: "#/allOf/0/then/properties/hops/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
            if (vErrors === null) {
              vErrors = [err3];
            } else {
              vErrors.push(err3);
            }
            errors++;
          }
        }
      }
    }
    var _valid0 = _errs5 === errors;
    valid1 = _valid0;
    if (valid1) {
      var props0 = {};
      props0.hops = true;
      props0.reachable = true;
    }
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
  const _errs9 = errors;
  let valid4 = true;
  const _errs10 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    let missing1;
    if (data.reachable === void 0 && (missing1 = "reachable")) {
      const err5 = {};
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    } else {
      if (data.reachable !== void 0) {
        if (false !== data.reachable) {
          const err6 = {};
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
      }
    }
  }
  var _valid1 = _errs10 === errors;
  errors = _errs9;
  if (vErrors !== null) {
    if (_errs9) {
      vErrors.length = _errs9;
    } else {
      vErrors = null;
    }
  }
  if (_valid1) {
    const _errs12 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.hops !== void 0) {
        if (data.hops !== null) {
          const err7 = { instancePath: instancePath + "/hops", schemaPath: "#/allOf/1/then/properties/hops/type", keyword: "type", params: { type: "null" }, message: "must be null" };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
      }
    }
    var _valid1 = _errs12 === errors;
    valid4 = _valid1;
    if (valid4) {
      var props1 = {};
      props1.hops = true;
      props1.reachable = true;
    }
  }
  if (!valid4) {
    const err8 = { instancePath, schemaPath: "#/allOf/1/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err8];
    } else {
      vErrors.push(err8);
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
    if (data.reachable === void 0) {
      const err9 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "reachable" }, message: "must have required property 'reachable'" };
      if (vErrors === null) {
        vErrors = [err9];
      } else {
        vErrors.push(err9);
      }
      errors++;
    }
    if (data.hops === void 0) {
      const err10 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "hops" }, message: "must have required property 'hops'" };
      if (vErrors === null) {
        vErrors = [err10];
      } else {
        vErrors.push(err10);
      }
      errors++;
    }
    if (data.witness === void 0) {
      const err11 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "witness" }, message: "must have required property 'witness'" };
      if (vErrors === null) {
        vErrors = [err11];
      } else {
        vErrors.push(err11);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "reachable" || key0 === "hops" || key0 === "nodes" || key0 === "edges" || key0 === "witness")) {
        const err12 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
    }
    if (data.reachable !== void 0) {
      if (typeof data.reachable !== "boolean") {
        const err13 = { instancePath: instancePath + "/reachable", schemaPath: "#/properties/reachable/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
    if (data.hops !== void 0) {
      let data5 = data.hops;
      if (!(typeof data5 == "number" && (!(data5 % 1) && !isNaN(data5))) && data5 !== null) {
        const err14 = { instancePath: instancePath + "/hops", schemaPath: "#/properties/hops/type", keyword: "type", params: { type: schema33.properties.hops.type }, message: "must be integer,null" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
      if (typeof data5 == "number") {
        if (data5 < 0 || isNaN(data5)) {
          const err15 = { instancePath: instancePath + "/hops", schemaPath: "#/properties/hops/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
      }
    }
    if (data.nodes !== void 0) {
      let data6 = data.nodes;
      if (Array.isArray(data6)) {
        const len0 = data6.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data7 = data6[i0];
          if (typeof data7 === "string") {
            if (func1(data7) < 1) {
              const err16 = { instancePath: instancePath + "/nodes/" + i0, schemaPath: "#/properties/nodes/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err16];
              } else {
                vErrors.push(err16);
              }
              errors++;
            }
          } else {
            const err17 = { instancePath: instancePath + "/nodes/" + i0, schemaPath: "#/properties/nodes/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err17];
            } else {
              vErrors.push(err17);
            }
            errors++;
          }
        }
      } else {
        const err18 = { instancePath: instancePath + "/nodes", schemaPath: "#/properties/nodes/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err18];
        } else {
          vErrors.push(err18);
        }
        errors++;
      }
    }
    if (data.edges !== void 0) {
      let data8 = data.edges;
      if (Array.isArray(data8)) {
        const len1 = data8.length;
        for (let i1 = 0; i1 < len1; i1++) {
          let data9 = data8[i1];
          if (data9 && typeof data9 == "object" && !Array.isArray(data9)) {
            if (data9.from === void 0) {
              const err19 = { instancePath: instancePath + "/edges/" + i1, schemaPath: "#/$defs/pathHop/required", keyword: "required", params: { missingProperty: "from" }, message: "must have required property 'from'" };
              if (vErrors === null) {
                vErrors = [err19];
              } else {
                vErrors.push(err19);
              }
              errors++;
            }
            if (data9.to === void 0) {
              const err20 = { instancePath: instancePath + "/edges/" + i1, schemaPath: "#/$defs/pathHop/required", keyword: "required", params: { missingProperty: "to" }, message: "must have required property 'to'" };
              if (vErrors === null) {
                vErrors = [err20];
              } else {
                vErrors.push(err20);
              }
              errors++;
            }
            if (data9.edge_id === void 0) {
              const err21 = { instancePath: instancePath + "/edges/" + i1, schemaPath: "#/$defs/pathHop/required", keyword: "required", params: { missingProperty: "edge_id" }, message: "must have required property 'edge_id'" };
              if (vErrors === null) {
                vErrors = [err21];
              } else {
                vErrors.push(err21);
              }
              errors++;
            }
            if (data9.type === void 0) {
              const err22 = { instancePath: instancePath + "/edges/" + i1, schemaPath: "#/$defs/pathHop/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
              if (vErrors === null) {
                vErrors = [err22];
              } else {
                vErrors.push(err22);
              }
              errors++;
            }
            for (const key1 in data9) {
              if (!(key1 === "from" || key1 === "to" || key1 === "edge_id" || key1 === "type")) {
                const err23 = { instancePath: instancePath + "/edges/" + i1, schemaPath: "#/$defs/pathHop/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err23];
                } else {
                  vErrors.push(err23);
                }
                errors++;
              }
            }
            if (data9.from !== void 0) {
              let data10 = data9.from;
              if (typeof data10 === "string") {
                if (func1(data10) < 1) {
                  const err24 = { instancePath: instancePath + "/edges/" + i1 + "/from", schemaPath: "#/$defs/pathHop/properties/from/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err24];
                  } else {
                    vErrors.push(err24);
                  }
                  errors++;
                }
              } else {
                const err25 = { instancePath: instancePath + "/edges/" + i1 + "/from", schemaPath: "#/$defs/pathHop/properties/from/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err25];
                } else {
                  vErrors.push(err25);
                }
                errors++;
              }
            }
            if (data9.to !== void 0) {
              let data11 = data9.to;
              if (typeof data11 === "string") {
                if (func1(data11) < 1) {
                  const err26 = { instancePath: instancePath + "/edges/" + i1 + "/to", schemaPath: "#/$defs/pathHop/properties/to/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err26];
                  } else {
                    vErrors.push(err26);
                  }
                  errors++;
                }
              } else {
                const err27 = { instancePath: instancePath + "/edges/" + i1 + "/to", schemaPath: "#/$defs/pathHop/properties/to/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err27];
                } else {
                  vErrors.push(err27);
                }
                errors++;
              }
            }
            if (data9.edge_id !== void 0) {
              let data12 = data9.edge_id;
              if (typeof data12 === "string") {
                if (func1(data12) < 1) {
                  const err28 = { instancePath: instancePath + "/edges/" + i1 + "/edge_id", schemaPath: "#/$defs/pathHop/properties/edge_id/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err28];
                  } else {
                    vErrors.push(err28);
                  }
                  errors++;
                }
              } else {
                const err29 = { instancePath: instancePath + "/edges/" + i1 + "/edge_id", schemaPath: "#/$defs/pathHop/properties/edge_id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err29];
                } else {
                  vErrors.push(err29);
                }
                errors++;
              }
            }
            if (data9.type !== void 0) {
              let data13 = data9.type;
              if (typeof data13 === "string") {
                if (func1(data13) < 1) {
                  const err30 = { instancePath: instancePath + "/edges/" + i1 + "/type", schemaPath: "#/$defs/pathHop/properties/type/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err30];
                  } else {
                    vErrors.push(err30);
                  }
                  errors++;
                }
              } else {
                const err31 = { instancePath: instancePath + "/edges/" + i1 + "/type", schemaPath: "#/$defs/pathHop/properties/type/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err31];
                } else {
                  vErrors.push(err31);
                }
                errors++;
              }
            }
          } else {
            const err32 = { instancePath: instancePath + "/edges/" + i1, schemaPath: "#/$defs/pathHop/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err32];
            } else {
              vErrors.push(err32);
            }
            errors++;
          }
        }
      } else {
        const err33 = { instancePath: instancePath + "/edges", schemaPath: "#/properties/edges/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err33];
        } else {
          vErrors.push(err33);
        }
        errors++;
      }
    }
    if (data.witness !== void 0) {
      let data14 = data.witness;
      if (!(data14 && typeof data14 == "object" && !Array.isArray(data14))) {
        const err34 = { instancePath: instancePath + "/witness", schemaPath: "#/properties/witness/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err34];
        } else {
          vErrors.push(err34);
        }
        errors++;
      }
    }
  } else {
    const err35 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err35];
    } else {
      vErrors.push(err35);
    }
    errors++;
  }
  validate21.errors = vErrors;
  return errors === 0;
}
validate21.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var schema52 = { "type": "object", "additionalProperties": false, "required": ["state", "evidence"], "properties": { "state": { "enum": ["not_run", "baseline", "candidate", "holdout_verdict"] }, "evidence": { "type": "array", "items": { "$ref": "#/$defs/repoPath" }, "uniqueItems": true }, "verdict": { "enum": ["improved", "regressed", "no_material_change", "inconclusive"] } }, "allOf": [{ "if": { "properties": { "state": { "const": "holdout_verdict" } }, "required": ["state"] }, "then": { "required": ["verdict"] } }] };
function validate23(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate23.evaluated;
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
        const err7 = { instancePath: instancePath + "/state", schemaPath: "#/properties/state/enum", keyword: "enum", params: { allowedValues: schema52.properties.state.enum }, message: "must be equal to one of the allowed values" };
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
            if (!pattern5.test(data3)) {
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
        const err13 = { instancePath: instancePath + "/verdict", schemaPath: "#/properties/verdict/enum", keyword: "enum", params: { allowedValues: schema52.properties.verdict.enum }, message: "must be equal to one of the allowed values" };
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
  validate23.errors = vErrors;
  return errors === 0;
}
validate23.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
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
    if (data.result_kind === void 0 && (missing3 = "result_kind") || data.ok === void 0 && (missing3 = "ok")) {
      const err25 = {};
      if (vErrors === null) {
        vErrors = [err25];
      } else {
        vErrors.push(err25);
      }
      errors++;
    } else {
      if (data.result_kind !== void 0) {
        const _errs20 = errors;
        if ("path" !== data.result_kind) {
          const err26 = {};
          if (vErrors === null) {
            vErrors = [err26];
          } else {
            vErrors.push(err26);
          }
          errors++;
        }
        var valid8 = _errs20 === errors;
      } else {
        var valid8 = true;
      }
      if (valid8) {
        if (data.ok !== void 0) {
          const _errs21 = errors;
          if (true !== data.ok) {
            const err27 = {};
            if (vErrors === null) {
              vErrors = [err27];
            } else {
              vErrors.push(err27);
            }
            errors++;
          }
          var valid8 = _errs21 === errors;
        } else {
          var valid8 = true;
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
    const _errs22 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.path_query === void 0) {
        const err28 = { instancePath, schemaPath: "#/allOf/3/then/required", keyword: "required", params: { missingProperty: "path_query" }, message: "must have required property 'path_query'" };
        if (vErrors === null) {
          vErrors = [err28];
        } else {
          vErrors.push(err28);
        }
        errors++;
      }
      if (data.path_result === void 0) {
        const err29 = { instancePath, schemaPath: "#/allOf/3/then/required", keyword: "required", params: { missingProperty: "path_result" }, message: "must have required property 'path_result'" };
        if (vErrors === null) {
          vErrors = [err29];
        } else {
          vErrors.push(err29);
        }
        errors++;
      }
      if (data.diagnostics === void 0) {
        const err30 = { instancePath, schemaPath: "#/allOf/3/then/required", keyword: "required", params: { missingProperty: "diagnostics" }, message: "must have required property 'diagnostics'" };
        if (vErrors === null) {
          vErrors = [err30];
        } else {
          vErrors.push(err30);
        }
        errors++;
      }
    }
    var _valid3 = _errs22 === errors;
    valid7 = _valid3;
  }
  if (!valid7) {
    const err31 = { instancePath, schemaPath: "#/allOf/3/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err31];
    } else {
      vErrors.push(err31);
    }
    errors++;
  }
  const _errs24 = errors;
  let valid9 = true;
  const _errs25 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    let missing4;
    if (data.result_kind === void 0 && (missing4 = "result_kind") || data.ok === void 0 && (missing4 = "ok")) {
      const err32 = {};
      if (vErrors === null) {
        vErrors = [err32];
      } else {
        vErrors.push(err32);
      }
      errors++;
    } else {
      if (data.result_kind !== void 0) {
        const _errs26 = errors;
        if ("explain" !== data.result_kind) {
          const err33 = {};
          if (vErrors === null) {
            vErrors = [err33];
          } else {
            vErrors.push(err33);
          }
          errors++;
        }
        var valid10 = _errs26 === errors;
      } else {
        var valid10 = true;
      }
      if (valid10) {
        if (data.ok !== void 0) {
          const _errs27 = errors;
          if (true !== data.ok) {
            const err34 = {};
            if (vErrors === null) {
              vErrors = [err34];
            } else {
              vErrors.push(err34);
            }
            errors++;
          }
          var valid10 = _errs27 === errors;
        } else {
          var valid10 = true;
        }
      }
    }
  }
  var _valid4 = _errs25 === errors;
  errors = _errs24;
  if (vErrors !== null) {
    if (_errs24) {
      vErrors.length = _errs24;
    } else {
      vErrors = null;
    }
  }
  if (_valid4) {
    const _errs28 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.explain_target === void 0) {
        const err35 = { instancePath, schemaPath: "#/allOf/4/then/required", keyword: "required", params: { missingProperty: "explain_target" }, message: "must have required property 'explain_target'" };
        if (vErrors === null) {
          vErrors = [err35];
        } else {
          vErrors.push(err35);
        }
        errors++;
      }
      if (data.entity === void 0) {
        const err36 = { instancePath, schemaPath: "#/allOf/4/then/required", keyword: "required", params: { missingProperty: "entity" }, message: "must have required property 'entity'" };
        if (vErrors === null) {
          vErrors = [err36];
        } else {
          vErrors.push(err36);
        }
        errors++;
      }
      if (data.diagnostics === void 0) {
        const err37 = { instancePath, schemaPath: "#/allOf/4/then/required", keyword: "required", params: { missingProperty: "diagnostics" }, message: "must have required property 'diagnostics'" };
        if (vErrors === null) {
          vErrors = [err37];
        } else {
          vErrors.push(err37);
        }
        errors++;
      }
    }
    var _valid4 = _errs28 === errors;
    valid9 = _valid4;
  }
  if (!valid9) {
    const err38 = { instancePath, schemaPath: "#/allOf/4/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err38];
    } else {
      vErrors.push(err38);
    }
    errors++;
  }
  const _errs30 = errors;
  let valid11 = true;
  const _errs31 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    let missing5;
    if (data.result_kind === void 0 && (missing5 = "result_kind")) {
      const err39 = {};
      if (vErrors === null) {
        vErrors = [err39];
      } else {
        vErrors.push(err39);
      }
      errors++;
    } else {
      if (data.result_kind !== void 0) {
        if ("check" !== data.result_kind) {
          const err40 = {};
          if (vErrors === null) {
            vErrors = [err40];
          } else {
            vErrors.push(err40);
          }
          errors++;
        }
      }
    }
  }
  var _valid5 = _errs31 === errors;
  errors = _errs30;
  if (vErrors !== null) {
    if (_errs30) {
      vErrors.length = _errs30;
    } else {
      vErrors = null;
    }
  }
  if (_valid5) {
    const _errs33 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.stage === void 0) {
        const err41 = { instancePath, schemaPath: "#/allOf/5/then/required", keyword: "required", params: { missingProperty: "stage" }, message: "must have required property 'stage'" };
        if (vErrors === null) {
          vErrors = [err41];
        } else {
          vErrors.push(err41);
        }
        errors++;
      }
      if (data.source_root === void 0) {
        const err42 = { instancePath, schemaPath: "#/allOf/5/then/required", keyword: "required", params: { missingProperty: "source_root" }, message: "must have required property 'source_root'" };
        if (vErrors === null) {
          vErrors = [err42];
        } else {
          vErrors.push(err42);
        }
        errors++;
      }
      if (data.summary === void 0) {
        const err43 = { instancePath, schemaPath: "#/allOf/5/then/required", keyword: "required", params: { missingProperty: "summary" }, message: "must have required property 'summary'" };
        if (vErrors === null) {
          vErrors = [err43];
        } else {
          vErrors.push(err43);
        }
        errors++;
      }
      if (data.capabilities === void 0) {
        const err44 = { instancePath, schemaPath: "#/allOf/5/then/required", keyword: "required", params: { missingProperty: "capabilities" }, message: "must have required property 'capabilities'" };
        if (vErrors === null) {
          vErrors = [err44];
        } else {
          vErrors.push(err44);
        }
        errors++;
      }
      if (data.diagnostics === void 0) {
        const err45 = { instancePath, schemaPath: "#/allOf/5/then/required", keyword: "required", params: { missingProperty: "diagnostics" }, message: "must have required property 'diagnostics'" };
        if (vErrors === null) {
          vErrors = [err45];
        } else {
          vErrors.push(err45);
        }
        errors++;
      }
    }
    var _valid5 = _errs33 === errors;
    valid11 = _valid5;
  }
  if (!valid11) {
    const err46 = { instancePath, schemaPath: "#/allOf/5/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err46];
    } else {
      vErrors.push(err46);
    }
    errors++;
  }
  const _errs35 = errors;
  let valid13 = true;
  const _errs36 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    let missing6;
    if (data.ok === void 0 && (missing6 = "ok")) {
      const err47 = {};
      if (vErrors === null) {
        vErrors = [err47];
      } else {
        vErrors.push(err47);
      }
      errors++;
    } else {
      if (data.ok !== void 0) {
        if (false !== data.ok) {
          const err48 = {};
          if (vErrors === null) {
            vErrors = [err48];
          } else {
            vErrors.push(err48);
          }
          errors++;
        }
      }
    }
  }
  var _valid6 = _errs36 === errors;
  errors = _errs35;
  if (vErrors !== null) {
    if (_errs35) {
      vErrors.length = _errs35;
    } else {
      vErrors = null;
    }
  }
  if (_valid6) {
    const _errs38 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.diagnostics === void 0) {
        const err49 = { instancePath, schemaPath: "#/allOf/6/then/required", keyword: "required", params: { missingProperty: "diagnostics" }, message: "must have required property 'diagnostics'" };
        if (vErrors === null) {
          vErrors = [err49];
        } else {
          vErrors.push(err49);
        }
        errors++;
      }
      if (data.diagnostics !== void 0) {
        let data10 = data.diagnostics;
        if (Array.isArray(data10)) {
          if (data10.length < 1) {
            const err50 = { instancePath: instancePath + "/diagnostics", schemaPath: "#/allOf/6/then/properties/diagnostics/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
            if (vErrors === null) {
              vErrors = [err50];
            } else {
              vErrors.push(err50);
            }
            errors++;
          }
        }
      }
    }
    var _valid6 = _errs38 === errors;
    valid13 = _valid6;
    if (valid13) {
      var props0 = {};
      props0.diagnostics = true;
      props0.ok = true;
    }
  }
  if (!valid13) {
    const err51 = { instancePath, schemaPath: "#/allOf/6/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err51];
    } else {
      vErrors.push(err51);
    }
    errors++;
  }
  if (props0 !== true) {
    props0 = props0 || {};
    props0.result_kind = true;
    props0.ok = true;
  }
  const _errs41 = errors;
  let valid16 = true;
  const _errs42 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    let missing7;
    if (data.improvement_claim === void 0 && (missing7 = "improvement_claim")) {
      const err52 = {};
      if (vErrors === null) {
        vErrors = [err52];
      } else {
        vErrors.push(err52);
      }
      errors++;
    }
  }
  var _valid7 = _errs42 === errors;
  errors = _errs41;
  if (vErrors !== null) {
    if (_errs41) {
      vErrors.length = _errs41;
    } else {
      vErrors = null;
    }
  }
  if (_valid7) {
    const _errs43 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.behavioral_evidence_status === void 0) {
        const err53 = { instancePath, schemaPath: "#/allOf/7/then/required", keyword: "required", params: { missingProperty: "behavioral_evidence_status" }, message: "must have required property 'behavioral_evidence_status'" };
        if (vErrors === null) {
          vErrors = [err53];
        } else {
          vErrors.push(err53);
        }
        errors++;
      }
      if (data.behavioral_evidence_status !== void 0) {
        let data11 = data.behavioral_evidence_status;
        if (data11 && typeof data11 == "object" && !Array.isArray(data11)) {
          if (data11.state === void 0) {
            const err54 = { instancePath: instancePath + "/behavioral_evidence_status", schemaPath: "#/allOf/7/then/properties/behavioral_evidence_status/required", keyword: "required", params: { missingProperty: "state" }, message: "must have required property 'state'" };
            if (vErrors === null) {
              vErrors = [err54];
            } else {
              vErrors.push(err54);
            }
            errors++;
          }
          if (data11.state !== void 0) {
            if ("holdout_verdict" !== data11.state) {
              const err55 = { instancePath: instancePath + "/behavioral_evidence_status/state", schemaPath: "#/allOf/7/then/properties/behavioral_evidence_status/properties/state/const", keyword: "const", params: { allowedValue: "holdout_verdict" }, message: "must be equal to constant" };
              if (vErrors === null) {
                vErrors = [err55];
              } else {
                vErrors.push(err55);
              }
              errors++;
            }
          }
        }
      }
    }
    var _valid7 = _errs43 === errors;
    valid16 = _valid7;
    if (valid16) {
      var props1 = {};
      props1.behavioral_evidence_status = true;
    }
  }
  if (!valid16) {
    const err56 = { instancePath, schemaPath: "#/allOf/7/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err56];
    } else {
      vErrors.push(err56);
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
      const err57 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "schema" }, message: "must have required property 'schema'" };
      if (vErrors === null) {
        vErrors = [err57];
      } else {
        vErrors.push(err57);
      }
      errors++;
    }
    if (data.ok === void 0) {
      const err58 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "ok" }, message: "must have required property 'ok'" };
      if (vErrors === null) {
        vErrors = [err58];
      } else {
        vErrors.push(err58);
      }
      errors++;
    }
    if (data.command === void 0) {
      const err59 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "command" }, message: "must have required property 'command'" };
      if (vErrors === null) {
        vErrors = [err59];
      } else {
        vErrors.push(err59);
      }
      errors++;
    }
    if (data.result_kind === void 0) {
      const err60 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "result_kind" }, message: "must have required property 'result_kind'" };
      if (vErrors === null) {
        vErrors = [err60];
      } else {
        vErrors.push(err60);
      }
      errors++;
    }
    if (data.contract_version === void 0) {
      const err61 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "contract_version" }, message: "must have required property 'contract_version'" };
      if (vErrors === null) {
        vErrors = [err61];
      } else {
        vErrors.push(err61);
      }
      errors++;
    }
    if (props0 !== true) {
      props0 = props0 || {};
      props0.schema = true;
      props0.ok = true;
      props0.command = true;
      props0.result_kind = true;
      props0.graph_hash = true;
      props0.path_query = true;
      props0.path_result = true;
      props0.explain_target = true;
      props0.entity = true;
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
        const err62 = { instancePath: instancePath + "/schema", schemaPath: "#/properties/schema/const", keyword: "const", params: { allowedValue: "cc-master/skill-knowledge-cli/v1alpha1" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err62];
        } else {
          vErrors.push(err62);
        }
        errors++;
      }
    }
    if (data.ok !== void 0) {
      if (typeof data.ok !== "boolean") {
        const err63 = { instancePath: instancePath + "/ok", schemaPath: "#/properties/ok/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
        if (vErrors === null) {
          vErrors = [err63];
        } else {
          vErrors.push(err63);
        }
        errors++;
      }
    }
    if (data.command !== void 0) {
      let data15 = data.command;
      if (typeof data15 === "string") {
        if (func1(data15) < 1) {
          const err64 = { instancePath: instancePath + "/command", schemaPath: "#/properties/command/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err64];
          } else {
            vErrors.push(err64);
          }
          errors++;
        }
      } else {
        const err65 = { instancePath: instancePath + "/command", schemaPath: "#/properties/command/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err65];
        } else {
          vErrors.push(err65);
        }
        errors++;
      }
    }
    if (data.result_kind !== void 0) {
      let data16 = data.result_kind;
      if (!(data16 === "contract" || data16 === "check" || data16 === "report" || data16 === "change" || data16 === "path" || data16 === "explain" || data16 === "diagnostic")) {
        const err66 = { instancePath: instancePath + "/result_kind", schemaPath: "#/properties/result_kind/enum", keyword: "enum", params: { allowedValues: schema31.properties.result_kind.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err66];
        } else {
          vErrors.push(err66);
        }
        errors++;
      }
    }
    if (data.graph_hash !== void 0) {
      let data17 = data.graph_hash;
      if (typeof data17 === "string") {
        if (!pattern4.test(data17)) {
          const err67 = { instancePath: instancePath + "/graph_hash", schemaPath: "#/properties/graph_hash/pattern", keyword: "pattern", params: { pattern: "^[a-f0-9]{64}$" }, message: 'must match pattern "^[a-f0-9]{64}$"' };
          if (vErrors === null) {
            vErrors = [err67];
          } else {
            vErrors.push(err67);
          }
          errors++;
        }
      } else {
        const err68 = { instancePath: instancePath + "/graph_hash", schemaPath: "#/properties/graph_hash/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err68];
        } else {
          vErrors.push(err68);
        }
        errors++;
      }
    }
    if (data.path_query !== void 0) {
      let data18 = data.path_query;
      if (data18 && typeof data18 == "object" && !Array.isArray(data18)) {
        if (data18.from === void 0) {
          const err69 = { instancePath: instancePath + "/path_query", schemaPath: "#/$defs/pathQuery/required", keyword: "required", params: { missingProperty: "from" }, message: "must have required property 'from'" };
          if (vErrors === null) {
            vErrors = [err69];
          } else {
            vErrors.push(err69);
          }
          errors++;
        }
        if (data18.to === void 0) {
          const err70 = { instancePath: instancePath + "/path_query", schemaPath: "#/$defs/pathQuery/required", keyword: "required", params: { missingProperty: "to" }, message: "must have required property 'to'" };
          if (vErrors === null) {
            vErrors = [err70];
          } else {
            vErrors.push(err70);
          }
          errors++;
        }
        if (data18.host === void 0) {
          const err71 = { instancePath: instancePath + "/path_query", schemaPath: "#/$defs/pathQuery/required", keyword: "required", params: { missingProperty: "host" }, message: "must have required property 'host'" };
          if (vErrors === null) {
            vErrors = [err71];
          } else {
            vErrors.push(err71);
          }
          errors++;
        }
        if (data18.plane === void 0) {
          const err72 = { instancePath: instancePath + "/path_query", schemaPath: "#/$defs/pathQuery/required", keyword: "required", params: { missingProperty: "plane" }, message: "must have required property 'plane'" };
          if (vErrors === null) {
            vErrors = [err72];
          } else {
            vErrors.push(err72);
          }
          errors++;
        }
        for (const key0 in data18) {
          if (!(key0 === "from" || key0 === "to" || key0 === "host" || key0 === "plane")) {
            const err73 = { instancePath: instancePath + "/path_query", schemaPath: "#/$defs/pathQuery/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err73];
            } else {
              vErrors.push(err73);
            }
            errors++;
          }
        }
        if (data18.from !== void 0) {
          let data19 = data18.from;
          if (typeof data19 === "string") {
            if (func1(data19) < 1) {
              const err74 = { instancePath: instancePath + "/path_query/from", schemaPath: "#/$defs/pathQuery/properties/from/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err74];
              } else {
                vErrors.push(err74);
              }
              errors++;
            }
          } else {
            const err75 = { instancePath: instancePath + "/path_query/from", schemaPath: "#/$defs/pathQuery/properties/from/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err75];
            } else {
              vErrors.push(err75);
            }
            errors++;
          }
        }
        if (data18.to !== void 0) {
          let data20 = data18.to;
          if (typeof data20 === "string") {
            if (func1(data20) < 1) {
              const err76 = { instancePath: instancePath + "/path_query/to", schemaPath: "#/$defs/pathQuery/properties/to/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err76];
              } else {
                vErrors.push(err76);
              }
              errors++;
            }
          } else {
            const err77 = { instancePath: instancePath + "/path_query/to", schemaPath: "#/$defs/pathQuery/properties/to/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err77];
            } else {
              vErrors.push(err77);
            }
            errors++;
          }
        }
        if (data18.host !== void 0) {
          let data21 = data18.host;
          if (typeof data21 === "string") {
            if (func1(data21) < 1) {
              const err78 = { instancePath: instancePath + "/path_query/host", schemaPath: "#/$defs/pathQuery/properties/host/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err78];
              } else {
                vErrors.push(err78);
              }
              errors++;
            }
          } else {
            const err79 = { instancePath: instancePath + "/path_query/host", schemaPath: "#/$defs/pathQuery/properties/host/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err79];
            } else {
              vErrors.push(err79);
            }
            errors++;
          }
        }
        if (data18.plane !== void 0) {
          if ("navigation" !== data18.plane) {
            const err80 = { instancePath: instancePath + "/path_query/plane", schemaPath: "#/$defs/pathQuery/properties/plane/const", keyword: "const", params: { allowedValue: "navigation" }, message: "must be equal to constant" };
            if (vErrors === null) {
              vErrors = [err80];
            } else {
              vErrors.push(err80);
            }
            errors++;
          }
        }
      } else {
        const err81 = { instancePath: instancePath + "/path_query", schemaPath: "#/$defs/pathQuery/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err81];
        } else {
          vErrors.push(err81);
        }
        errors++;
      }
    }
    if (data.path_result !== void 0) {
      if (!validate21(data.path_result, { instancePath: instancePath + "/path_result", parentData: data, parentDataProperty: "path_result", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate21.errors : vErrors.concat(validate21.errors);
        errors = vErrors.length;
      }
    }
    if (data.explain_target !== void 0) {
      let data24 = data.explain_target;
      if (typeof data24 === "string") {
        if (func1(data24) < 1) {
          const err82 = { instancePath: instancePath + "/explain_target", schemaPath: "#/properties/explain_target/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err82];
          } else {
            vErrors.push(err82);
          }
          errors++;
        }
      } else {
        const err83 = { instancePath: instancePath + "/explain_target", schemaPath: "#/properties/explain_target/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err83];
        } else {
          vErrors.push(err83);
        }
        errors++;
      }
    }
    if (data.entity !== void 0) {
      let data25 = data.entity;
      if (data25 && typeof data25 == "object" && !Array.isArray(data25)) {
        if (data25.id === void 0) {
          const err84 = { instancePath: instancePath + "/entity", schemaPath: "#/$defs/explainedEntity/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
          if (vErrors === null) {
            vErrors = [err84];
          } else {
            vErrors.push(err84);
          }
          errors++;
        }
        if (data25.kind === void 0) {
          const err85 = { instancePath: instancePath + "/entity", schemaPath: "#/$defs/explainedEntity/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
          if (vErrors === null) {
            vErrors = [err85];
          } else {
            vErrors.push(err85);
          }
          errors++;
        }
        for (const key1 in data25) {
          if (!func11.call(schema35.properties, key1)) {
            const err86 = { instancePath: instancePath + "/entity", schemaPath: "#/$defs/explainedEntity/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err86];
            } else {
              vErrors.push(err86);
            }
            errors++;
          }
        }
        if (data25.id !== void 0) {
          let data26 = data25.id;
          if (typeof data26 === "string") {
            if (func1(data26) < 1) {
              const err87 = { instancePath: instancePath + "/entity/id", schemaPath: "#/$defs/explainedEntity/properties/id/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err87];
              } else {
                vErrors.push(err87);
              }
              errors++;
            }
          } else {
            const err88 = { instancePath: instancePath + "/entity/id", schemaPath: "#/$defs/explainedEntity/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err88];
            } else {
              vErrors.push(err88);
            }
            errors++;
          }
        }
        if (data25.kind !== void 0) {
          let data27 = data25.kind;
          if (!(data27 === "portfolio" || data27 === "skill" || data27 === "module" || data27 === "point" || data27 === "edge" || data27 === "entry" || data27 === "diagnostic")) {
            const err89 = { instancePath: instancePath + "/entity/kind", schemaPath: "#/$defs/explainedEntity/properties/kind/enum", keyword: "enum", params: { allowedValues: schema35.properties.kind.enum }, message: "must be equal to one of the allowed values" };
            if (vErrors === null) {
              vErrors = [err89];
            } else {
              vErrors.push(err89);
            }
            errors++;
          }
        }
        if (data25.owner_skill !== void 0) {
          let data28 = data25.owner_skill;
          if (typeof data28 === "string") {
            if (func1(data28) < 1) {
              const err90 = { instancePath: instancePath + "/entity/owner_skill", schemaPath: "#/$defs/explainedEntity/properties/owner_skill/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err90];
              } else {
                vErrors.push(err90);
              }
              errors++;
            }
          } else {
            const err91 = { instancePath: instancePath + "/entity/owner_skill", schemaPath: "#/$defs/explainedEntity/properties/owner_skill/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err91];
            } else {
              vErrors.push(err91);
            }
            errors++;
          }
        }
        if (data25.module !== void 0) {
          let data29 = data25.module;
          if (typeof data29 === "string") {
            if (func1(data29) < 1) {
              const err92 = { instancePath: instancePath + "/entity/module", schemaPath: "#/$defs/explainedEntity/properties/module/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err92];
              } else {
                vErrors.push(err92);
              }
              errors++;
            }
          } else {
            const err93 = { instancePath: instancePath + "/entity/module", schemaPath: "#/$defs/explainedEntity/properties/module/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err93];
            } else {
              vErrors.push(err93);
            }
            errors++;
          }
        }
        if (data25.authority !== void 0) {
          let data30 = data25.authority;
          if (!(data30 && typeof data30 == "object" && !Array.isArray(data30))) {
            const err94 = { instancePath: instancePath + "/entity/authority", schemaPath: "#/$defs/explainedEntity/properties/authority/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err94];
            } else {
              vErrors.push(err94);
            }
            errors++;
          }
        }
        if (data25.binding !== void 0) {
          let data31 = data25.binding;
          if (!(data31 && typeof data31 == "object" && !Array.isArray(data31))) {
            const err95 = { instancePath: instancePath + "/entity/binding", schemaPath: "#/$defs/explainedEntity/properties/binding/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err95];
            } else {
              vErrors.push(err95);
            }
            errors++;
          }
        }
        if (data25.recognition_cues !== void 0) {
          let data32 = data25.recognition_cues;
          if (Array.isArray(data32)) {
            const len0 = data32.length;
            for (let i0 = 0; i0 < len0; i0++) {
              if (typeof data32[i0] !== "string") {
                const err96 = { instancePath: instancePath + "/entity/recognition_cues/" + i0, schemaPath: "#/$defs/explainedEntity/properties/recognition_cues/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err96];
                } else {
                  vErrors.push(err96);
                }
                errors++;
              }
            }
          } else {
            const err97 = { instancePath: instancePath + "/entity/recognition_cues", schemaPath: "#/$defs/explainedEntity/properties/recognition_cues/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err97];
            } else {
              vErrors.push(err97);
            }
            errors++;
          }
        }
        if (data25.inbound !== void 0) {
          let data34 = data25.inbound;
          if (Array.isArray(data34)) {
            const len1 = data34.length;
            for (let i1 = 0; i1 < len1; i1++) {
              if (typeof data34[i1] !== "string") {
                const err98 = { instancePath: instancePath + "/entity/inbound/" + i1, schemaPath: "#/$defs/explainedEntity/properties/inbound/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err98];
                } else {
                  vErrors.push(err98);
                }
                errors++;
              }
            }
          } else {
            const err99 = { instancePath: instancePath + "/entity/inbound", schemaPath: "#/$defs/explainedEntity/properties/inbound/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err99];
            } else {
              vErrors.push(err99);
            }
            errors++;
          }
        }
        if (data25.outbound !== void 0) {
          let data36 = data25.outbound;
          if (Array.isArray(data36)) {
            const len2 = data36.length;
            for (let i2 = 0; i2 < len2; i2++) {
              if (typeof data36[i2] !== "string") {
                const err100 = { instancePath: instancePath + "/entity/outbound/" + i2, schemaPath: "#/$defs/explainedEntity/properties/outbound/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err100];
                } else {
                  vErrors.push(err100);
                }
                errors++;
              }
            }
          } else {
            const err101 = { instancePath: instancePath + "/entity/outbound", schemaPath: "#/$defs/explainedEntity/properties/outbound/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err101];
            } else {
              vErrors.push(err101);
            }
            errors++;
          }
        }
        if (data25.access !== void 0) {
          let data38 = data25.access;
          if (!(data38 && typeof data38 == "object" && !Array.isArray(data38))) {
            const err102 = { instancePath: instancePath + "/entity/access", schemaPath: "#/$defs/explainedEntity/properties/access/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err102];
            } else {
              vErrors.push(err102);
            }
            errors++;
          }
        }
        if (data25.witness !== void 0) {
          let data39 = data25.witness;
          if (!(data39 && typeof data39 == "object" && !Array.isArray(data39))) {
            const err103 = { instancePath: instancePath + "/entity/witness", schemaPath: "#/$defs/explainedEntity/properties/witness/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err103];
            } else {
              vErrors.push(err103);
            }
            errors++;
          }
        }
      } else {
        const err104 = { instancePath: instancePath + "/entity", schemaPath: "#/$defs/explainedEntity/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err104];
        } else {
          vErrors.push(err104);
        }
        errors++;
      }
    }
    if (data.contract_version !== void 0) {
      if ("v1alpha1" !== data.contract_version) {
        const err105 = { instancePath: instancePath + "/contract_version", schemaPath: "#/properties/contract_version/const", keyword: "const", params: { allowedValue: "v1alpha1" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err105];
        } else {
          vErrors.push(err105);
        }
        errors++;
      }
    }
    if (data.implemented_commands !== void 0) {
      let data41 = data.implemented_commands;
      if (Array.isArray(data41)) {
        const len3 = data41.length;
        for (let i3 = 0; i3 < len3; i3++) {
          let data42 = data41[i3];
          if (typeof data42 === "string") {
            if (func1(data42) < 1) {
              const err106 = { instancePath: instancePath + "/implemented_commands/" + i3, schemaPath: "#/$defs/stringSet/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err106];
              } else {
                vErrors.push(err106);
              }
              errors++;
            }
          } else {
            const err107 = { instancePath: instancePath + "/implemented_commands/" + i3, schemaPath: "#/$defs/stringSet/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err107];
            } else {
              vErrors.push(err107);
            }
            errors++;
          }
        }
        let i4 = data41.length;
        let j0;
        if (i4 > 1) {
          const indices0 = {};
          for (; i4--; ) {
            let item0 = data41[i4];
            if (typeof item0 !== "string") {
              continue;
            }
            if (typeof indices0[item0] == "number") {
              j0 = indices0[item0];
              const err108 = { instancePath: instancePath + "/implemented_commands", schemaPath: "#/$defs/stringSet/uniqueItems", keyword: "uniqueItems", params: { i: i4, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i4 + " are identical)" };
              if (vErrors === null) {
                vErrors = [err108];
              } else {
                vErrors.push(err108);
              }
              errors++;
              break;
            }
            indices0[item0] = i4;
          }
        }
      } else {
        const err109 = { instancePath: instancePath + "/implemented_commands", schemaPath: "#/$defs/stringSet/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err109];
        } else {
          vErrors.push(err109);
        }
        errors++;
      }
    }
    if (data.declared_commands !== void 0) {
      let data43 = data.declared_commands;
      if (Array.isArray(data43)) {
        const len4 = data43.length;
        for (let i5 = 0; i5 < len4; i5++) {
          let data44 = data43[i5];
          if (typeof data44 === "string") {
            if (func1(data44) < 1) {
              const err110 = { instancePath: instancePath + "/declared_commands/" + i5, schemaPath: "#/$defs/stringSet/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err110];
              } else {
                vErrors.push(err110);
              }
              errors++;
            }
          } else {
            const err111 = { instancePath: instancePath + "/declared_commands/" + i5, schemaPath: "#/$defs/stringSet/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err111];
            } else {
              vErrors.push(err111);
            }
            errors++;
          }
        }
        let i6 = data43.length;
        let j1;
        if (i6 > 1) {
          const indices1 = {};
          for (; i6--; ) {
            let item1 = data43[i6];
            if (typeof item1 !== "string") {
              continue;
            }
            if (typeof indices1[item1] == "number") {
              j1 = indices1[item1];
              const err112 = { instancePath: instancePath + "/declared_commands", schemaPath: "#/$defs/stringSet/uniqueItems", keyword: "uniqueItems", params: { i: i6, j: j1 }, message: "must NOT have duplicate items (items ## " + j1 + " and " + i6 + " are identical)" };
              if (vErrors === null) {
                vErrors = [err112];
              } else {
                vErrors.push(err112);
              }
              errors++;
              break;
            }
            indices1[item1] = i6;
          }
        }
      } else {
        const err113 = { instancePath: instancePath + "/declared_commands", schemaPath: "#/$defs/stringSet/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err113];
        } else {
          vErrors.push(err113);
        }
        errors++;
      }
    }
    if (data.operations !== void 0) {
      let data45 = data.operations;
      if (Array.isArray(data45)) {
        const len5 = data45.length;
        for (let i7 = 0; i7 < len5; i7++) {
          let data46 = data45[i7];
          if (typeof data46 === "string") {
            if (func1(data46) < 1) {
              const err114 = { instancePath: instancePath + "/operations/" + i7, schemaPath: "#/$defs/stringSet/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err114];
              } else {
                vErrors.push(err114);
              }
              errors++;
            }
          } else {
            const err115 = { instancePath: instancePath + "/operations/" + i7, schemaPath: "#/$defs/stringSet/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err115];
            } else {
              vErrors.push(err115);
            }
            errors++;
          }
        }
        let i8 = data45.length;
        let j2;
        if (i8 > 1) {
          const indices2 = {};
          for (; i8--; ) {
            let item2 = data45[i8];
            if (typeof item2 !== "string") {
              continue;
            }
            if (typeof indices2[item2] == "number") {
              j2 = indices2[item2];
              const err116 = { instancePath: instancePath + "/operations", schemaPath: "#/$defs/stringSet/uniqueItems", keyword: "uniqueItems", params: { i: i8, j: j2 }, message: "must NOT have duplicate items (items ## " + j2 + " and " + i8 + " are identical)" };
              if (vErrors === null) {
                vErrors = [err116];
              } else {
                vErrors.push(err116);
              }
              errors++;
              break;
            }
            indices2[item2] = i8;
          }
        }
      } else {
        const err117 = { instancePath: instancePath + "/operations", schemaPath: "#/$defs/stringSet/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err117];
        } else {
          vErrors.push(err117);
        }
        errors++;
      }
    }
    if (data.planes !== void 0) {
      let data47 = data.planes;
      if (Array.isArray(data47)) {
        const len6 = data47.length;
        for (let i9 = 0; i9 < len6; i9++) {
          let data48 = data47[i9];
          if (typeof data48 === "string") {
            if (func1(data48) < 1) {
              const err118 = { instancePath: instancePath + "/planes/" + i9, schemaPath: "#/$defs/stringSet/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err118];
              } else {
                vErrors.push(err118);
              }
              errors++;
            }
          } else {
            const err119 = { instancePath: instancePath + "/planes/" + i9, schemaPath: "#/$defs/stringSet/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err119];
            } else {
              vErrors.push(err119);
            }
            errors++;
          }
        }
        let i10 = data47.length;
        let j3;
        if (i10 > 1) {
          const indices3 = {};
          for (; i10--; ) {
            let item3 = data47[i10];
            if (typeof item3 !== "string") {
              continue;
            }
            if (typeof indices3[item3] == "number") {
              j3 = indices3[item3];
              const err120 = { instancePath: instancePath + "/planes", schemaPath: "#/$defs/stringSet/uniqueItems", keyword: "uniqueItems", params: { i: i10, j: j3 }, message: "must NOT have duplicate items (items ## " + j3 + " and " + i10 + " are identical)" };
              if (vErrors === null) {
                vErrors = [err120];
              } else {
                vErrors.push(err120);
              }
              errors++;
              break;
            }
            indices3[item3] = i10;
          }
        }
      } else {
        const err121 = { instancePath: instancePath + "/planes", schemaPath: "#/$defs/stringSet/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err121];
        } else {
          vErrors.push(err121);
        }
        errors++;
      }
    }
    if (data.invariants !== void 0) {
      let data49 = data.invariants;
      if (Array.isArray(data49)) {
        const len7 = data49.length;
        for (let i11 = 0; i11 < len7; i11++) {
          let data50 = data49[i11];
          if (typeof data50 === "string") {
            if (func1(data50) < 1) {
              const err122 = { instancePath: instancePath + "/invariants/" + i11, schemaPath: "#/$defs/stringSet/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err122];
              } else {
                vErrors.push(err122);
              }
              errors++;
            }
          } else {
            const err123 = { instancePath: instancePath + "/invariants/" + i11, schemaPath: "#/$defs/stringSet/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err123];
            } else {
              vErrors.push(err123);
            }
            errors++;
          }
        }
        let i12 = data49.length;
        let j4;
        if (i12 > 1) {
          const indices4 = {};
          for (; i12--; ) {
            let item4 = data49[i12];
            if (typeof item4 !== "string") {
              continue;
            }
            if (typeof indices4[item4] == "number") {
              j4 = indices4[item4];
              const err124 = { instancePath: instancePath + "/invariants", schemaPath: "#/$defs/stringSet/uniqueItems", keyword: "uniqueItems", params: { i: i12, j: j4 }, message: "must NOT have duplicate items (items ## " + j4 + " and " + i12 + " are identical)" };
              if (vErrors === null) {
                vErrors = [err124];
              } else {
                vErrors.push(err124);
              }
              errors++;
              break;
            }
            indices4[item4] = i12;
          }
        }
      } else {
        const err125 = { instancePath: instancePath + "/invariants", schemaPath: "#/$defs/stringSet/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err125];
        } else {
          vErrors.push(err125);
        }
        errors++;
      }
    }
    if (data.exit_codes !== void 0) {
      let data51 = data.exit_codes;
      if (data51 && typeof data51 == "object" && !Array.isArray(data51)) {
        if (Object.keys(data51).length < 1) {
          const err126 = { instancePath: instancePath + "/exit_codes", schemaPath: "#/properties/exit_codes/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" };
          if (vErrors === null) {
            vErrors = [err126];
          } else {
            vErrors.push(err126);
          }
          errors++;
        }
        for (const key2 in data51) {
          let data52 = data51[key2];
          if (!(typeof data52 == "number" && (!(data52 % 1) && !isNaN(data52)))) {
            const err127 = { instancePath: instancePath + "/exit_codes/" + key2.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/exit_codes/additionalProperties/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err127];
            } else {
              vErrors.push(err127);
            }
            errors++;
          }
          if (typeof data52 == "number") {
            if (data52 > 255 || isNaN(data52)) {
              const err128 = { instancePath: instancePath + "/exit_codes/" + key2.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/exit_codes/additionalProperties/maximum", keyword: "maximum", params: { comparison: "<=", limit: 255 }, message: "must be <= 255" };
              if (vErrors === null) {
                vErrors = [err128];
              } else {
                vErrors.push(err128);
              }
              errors++;
            }
            if (data52 < 0 || isNaN(data52)) {
              const err129 = { instancePath: instancePath + "/exit_codes/" + key2.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/exit_codes/additionalProperties/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
              if (vErrors === null) {
                vErrors = [err129];
              } else {
                vErrors.push(err129);
              }
              errors++;
            }
          }
        }
      } else {
        const err130 = { instancePath: instancePath + "/exit_codes", schemaPath: "#/properties/exit_codes/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err130];
        } else {
          vErrors.push(err130);
        }
        errors++;
      }
    }
    if (data.schemas !== void 0) {
      let data53 = data.schemas;
      if (data53 && typeof data53 == "object" && !Array.isArray(data53)) {
        if (data53.source === void 0) {
          const err131 = { instancePath: instancePath + "/schemas", schemaPath: "#/properties/schemas/required", keyword: "required", params: { missingProperty: "source" }, message: "must have required property 'source'" };
          if (vErrors === null) {
            vErrors = [err131];
          } else {
            vErrors.push(err131);
          }
          errors++;
        }
        if (data53.change === void 0) {
          const err132 = { instancePath: instancePath + "/schemas", schemaPath: "#/properties/schemas/required", keyword: "required", params: { missingProperty: "change" }, message: "must have required property 'change'" };
          if (vErrors === null) {
            vErrors = [err132];
          } else {
            vErrors.push(err132);
          }
          errors++;
        }
        if (data53.output === void 0) {
          const err133 = { instancePath: instancePath + "/schemas", schemaPath: "#/properties/schemas/required", keyword: "required", params: { missingProperty: "output" }, message: "must have required property 'output'" };
          if (vErrors === null) {
            vErrors = [err133];
          } else {
            vErrors.push(err133);
          }
          errors++;
        }
        if (data53.cli === void 0) {
          const err134 = { instancePath: instancePath + "/schemas", schemaPath: "#/properties/schemas/required", keyword: "required", params: { missingProperty: "cli" }, message: "must have required property 'cli'" };
          if (vErrors === null) {
            vErrors = [err134];
          } else {
            vErrors.push(err134);
          }
          errors++;
        }
        for (const key3 in data53) {
          if (!(key3 === "source" || key3 === "change" || key3 === "output" || key3 === "cli")) {
            const err135 = { instancePath: instancePath + "/schemas", schemaPath: "#/properties/schemas/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err135];
            } else {
              vErrors.push(err135);
            }
            errors++;
          }
        }
        if (data53.source !== void 0) {
          let data54 = data53.source;
          if (typeof data54 === "string") {
            if (func1(data54) < 1) {
              const err136 = { instancePath: instancePath + "/schemas/source", schemaPath: "#/$defs/repoPath/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err136];
              } else {
                vErrors.push(err136);
              }
              errors++;
            }
            if (!pattern5.test(data54)) {
              const err137 = { instancePath: instancePath + "/schemas/source", schemaPath: "#/$defs/repoPath/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9._<>/-]+$" }, message: 'must match pattern "^[A-Za-z0-9._<>/-]+$"' };
              if (vErrors === null) {
                vErrors = [err137];
              } else {
                vErrors.push(err137);
              }
              errors++;
            }
          } else {
            const err138 = { instancePath: instancePath + "/schemas/source", schemaPath: "#/$defs/repoPath/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err138];
            } else {
              vErrors.push(err138);
            }
            errors++;
          }
        }
        if (data53.change !== void 0) {
          let data55 = data53.change;
          if (typeof data55 === "string") {
            if (func1(data55) < 1) {
              const err139 = { instancePath: instancePath + "/schemas/change", schemaPath: "#/$defs/repoPath/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err139];
              } else {
                vErrors.push(err139);
              }
              errors++;
            }
            if (!pattern5.test(data55)) {
              const err140 = { instancePath: instancePath + "/schemas/change", schemaPath: "#/$defs/repoPath/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9._<>/-]+$" }, message: 'must match pattern "^[A-Za-z0-9._<>/-]+$"' };
              if (vErrors === null) {
                vErrors = [err140];
              } else {
                vErrors.push(err140);
              }
              errors++;
            }
          } else {
            const err141 = { instancePath: instancePath + "/schemas/change", schemaPath: "#/$defs/repoPath/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err141];
            } else {
              vErrors.push(err141);
            }
            errors++;
          }
        }
        if (data53.output !== void 0) {
          let data56 = data53.output;
          if (typeof data56 === "string") {
            if (func1(data56) < 1) {
              const err142 = { instancePath: instancePath + "/schemas/output", schemaPath: "#/$defs/repoPath/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err142];
              } else {
                vErrors.push(err142);
              }
              errors++;
            }
            if (!pattern5.test(data56)) {
              const err143 = { instancePath: instancePath + "/schemas/output", schemaPath: "#/$defs/repoPath/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9._<>/-]+$" }, message: 'must match pattern "^[A-Za-z0-9._<>/-]+$"' };
              if (vErrors === null) {
                vErrors = [err143];
              } else {
                vErrors.push(err143);
              }
              errors++;
            }
          } else {
            const err144 = { instancePath: instancePath + "/schemas/output", schemaPath: "#/$defs/repoPath/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err144];
            } else {
              vErrors.push(err144);
            }
            errors++;
          }
        }
        if (data53.cli !== void 0) {
          let data57 = data53.cli;
          if (typeof data57 === "string") {
            if (func1(data57) < 1) {
              const err145 = { instancePath: instancePath + "/schemas/cli", schemaPath: "#/$defs/repoPath/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err145];
              } else {
                vErrors.push(err145);
              }
              errors++;
            }
            if (!pattern5.test(data57)) {
              const err146 = { instancePath: instancePath + "/schemas/cli", schemaPath: "#/$defs/repoPath/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9._<>/-]+$" }, message: 'must match pattern "^[A-Za-z0-9._<>/-]+$"' };
              if (vErrors === null) {
                vErrors = [err146];
              } else {
                vErrors.push(err146);
              }
              errors++;
            }
          } else {
            const err147 = { instancePath: instancePath + "/schemas/cli", schemaPath: "#/$defs/repoPath/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err147];
            } else {
              vErrors.push(err147);
            }
            errors++;
          }
        }
      } else {
        const err148 = { instancePath: instancePath + "/schemas", schemaPath: "#/properties/schemas/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err148];
        } else {
          vErrors.push(err148);
        }
        errors++;
      }
    }
    if (data.source_layout !== void 0) {
      let data58 = data.source_layout;
      if (data58 && typeof data58 == "object" && !Array.isArray(data58)) {
        if (data58.root === void 0) {
          const err149 = { instancePath: instancePath + "/source_layout", schemaPath: "#/properties/source_layout/required", keyword: "required", params: { missingProperty: "root" }, message: "must have required property 'root'" };
          if (vErrors === null) {
            vErrors = [err149];
          } else {
            vErrors.push(err149);
          }
          errors++;
        }
        if (data58.portfolio === void 0) {
          const err150 = { instancePath: instancePath + "/source_layout", schemaPath: "#/properties/source_layout/required", keyword: "required", params: { missingProperty: "portfolio" }, message: "must have required property 'portfolio'" };
          if (vErrors === null) {
            vErrors = [err150];
          } else {
            vErrors.push(err150);
          }
          errors++;
        }
        if (data58.changes === void 0) {
          const err151 = { instancePath: instancePath + "/source_layout", schemaPath: "#/properties/source_layout/required", keyword: "required", params: { missingProperty: "changes" }, message: "must have required property 'changes'" };
          if (vErrors === null) {
            vErrors = [err151];
          } else {
            vErrors.push(err151);
          }
          errors++;
        }
        if (data58.skills === void 0) {
          const err152 = { instancePath: instancePath + "/source_layout", schemaPath: "#/properties/source_layout/required", keyword: "required", params: { missingProperty: "skills" }, message: "must have required property 'skills'" };
          if (vErrors === null) {
            vErrors = [err152];
          } else {
            vErrors.push(err152);
          }
          errors++;
        }
        for (const key4 in data58) {
          if (!(key4 === "root" || key4 === "portfolio" || key4 === "changes" || key4 === "skills")) {
            const err153 = { instancePath: instancePath + "/source_layout", schemaPath: "#/properties/source_layout/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key4 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err153];
            } else {
              vErrors.push(err153);
            }
            errors++;
          }
        }
        if (data58.root !== void 0) {
          let data59 = data58.root;
          if (typeof data59 === "string") {
            if (func1(data59) < 1) {
              const err154 = { instancePath: instancePath + "/source_layout/root", schemaPath: "#/$defs/repoPath/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err154];
              } else {
                vErrors.push(err154);
              }
              errors++;
            }
            if (!pattern5.test(data59)) {
              const err155 = { instancePath: instancePath + "/source_layout/root", schemaPath: "#/$defs/repoPath/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9._<>/-]+$" }, message: 'must match pattern "^[A-Za-z0-9._<>/-]+$"' };
              if (vErrors === null) {
                vErrors = [err155];
              } else {
                vErrors.push(err155);
              }
              errors++;
            }
          } else {
            const err156 = { instancePath: instancePath + "/source_layout/root", schemaPath: "#/$defs/repoPath/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err156];
            } else {
              vErrors.push(err156);
            }
            errors++;
          }
        }
        if (data58.portfolio !== void 0) {
          let data60 = data58.portfolio;
          if (typeof data60 === "string") {
            if (func1(data60) < 1) {
              const err157 = { instancePath: instancePath + "/source_layout/portfolio", schemaPath: "#/$defs/repoPath/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err157];
              } else {
                vErrors.push(err157);
              }
              errors++;
            }
            if (!pattern5.test(data60)) {
              const err158 = { instancePath: instancePath + "/source_layout/portfolio", schemaPath: "#/$defs/repoPath/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9._<>/-]+$" }, message: 'must match pattern "^[A-Za-z0-9._<>/-]+$"' };
              if (vErrors === null) {
                vErrors = [err158];
              } else {
                vErrors.push(err158);
              }
              errors++;
            }
          } else {
            const err159 = { instancePath: instancePath + "/source_layout/portfolio", schemaPath: "#/$defs/repoPath/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err159];
            } else {
              vErrors.push(err159);
            }
            errors++;
          }
        }
        if (data58.changes !== void 0) {
          let data61 = data58.changes;
          if (typeof data61 === "string") {
            if (func1(data61) < 1) {
              const err160 = { instancePath: instancePath + "/source_layout/changes", schemaPath: "#/$defs/repoPath/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err160];
              } else {
                vErrors.push(err160);
              }
              errors++;
            }
            if (!pattern5.test(data61)) {
              const err161 = { instancePath: instancePath + "/source_layout/changes", schemaPath: "#/$defs/repoPath/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9._<>/-]+$" }, message: 'must match pattern "^[A-Za-z0-9._<>/-]+$"' };
              if (vErrors === null) {
                vErrors = [err161];
              } else {
                vErrors.push(err161);
              }
              errors++;
            }
          } else {
            const err162 = { instancePath: instancePath + "/source_layout/changes", schemaPath: "#/$defs/repoPath/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err162];
            } else {
              vErrors.push(err162);
            }
            errors++;
          }
        }
        if (data58.skills !== void 0) {
          let data62 = data58.skills;
          if (typeof data62 === "string") {
            if (func1(data62) < 1) {
              const err163 = { instancePath: instancePath + "/source_layout/skills", schemaPath: "#/properties/source_layout/properties/skills/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err163];
              } else {
                vErrors.push(err163);
              }
              errors++;
            }
          } else {
            const err164 = { instancePath: instancePath + "/source_layout/skills", schemaPath: "#/properties/source_layout/properties/skills/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err164];
            } else {
              vErrors.push(err164);
            }
            errors++;
          }
        }
      } else {
        const err165 = { instancePath: instancePath + "/source_layout", schemaPath: "#/properties/source_layout/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err165];
        } else {
          vErrors.push(err165);
        }
        errors++;
      }
    }
    if (data.stage !== void 0) {
      let data63 = data.stage;
      if (!(data63 === "K0" || data63 === "K1" || data63 === "K2" || data63 === "K3")) {
        const err166 = { instancePath: instancePath + "/stage", schemaPath: "#/properties/stage/enum", keyword: "enum", params: { allowedValues: schema31.properties.stage.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err166];
        } else {
          vErrors.push(err166);
        }
        errors++;
      }
    }
    if (data.source_root !== void 0) {
      let data64 = data.source_root;
      if (typeof data64 === "string") {
        if (func1(data64) < 1) {
          const err167 = { instancePath: instancePath + "/source_root", schemaPath: "#/properties/source_root/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err167];
          } else {
            vErrors.push(err167);
          }
          errors++;
        }
      } else {
        const err168 = { instancePath: instancePath + "/source_root", schemaPath: "#/properties/source_root/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err168];
        } else {
          vErrors.push(err168);
        }
        errors++;
      }
    }
    if (data.summary !== void 0) {
      let data65 = data.summary;
      if (data65 && typeof data65 == "object" && !Array.isArray(data65)) {
        if (data65.documents === void 0) {
          const err169 = { instancePath: instancePath + "/summary", schemaPath: "#/$defs/summary/required", keyword: "required", params: { missingProperty: "documents" }, message: "must have required property 'documents'" };
          if (vErrors === null) {
            vErrors = [err169];
          } else {
            vErrors.push(err169);
          }
          errors++;
        }
        if (data65.portfolio === void 0) {
          const err170 = { instancePath: instancePath + "/summary", schemaPath: "#/$defs/summary/required", keyword: "required", params: { missingProperty: "portfolio" }, message: "must have required property 'portfolio'" };
          if (vErrors === null) {
            vErrors = [err170];
          } else {
            vErrors.push(err170);
          }
          errors++;
        }
        if (data65.skill === void 0) {
          const err171 = { instancePath: instancePath + "/summary", schemaPath: "#/$defs/summary/required", keyword: "required", params: { missingProperty: "skill" }, message: "must have required property 'skill'" };
          if (vErrors === null) {
            vErrors = [err171];
          } else {
            vErrors.push(err171);
          }
          errors++;
        }
        if (data65.module === void 0) {
          const err172 = { instancePath: instancePath + "/summary", schemaPath: "#/$defs/summary/required", keyword: "required", params: { missingProperty: "module" }, message: "must have required property 'module'" };
          if (vErrors === null) {
            vErrors = [err172];
          } else {
            vErrors.push(err172);
          }
          errors++;
        }
        if (data65.change === void 0) {
          const err173 = { instancePath: instancePath + "/summary", schemaPath: "#/$defs/summary/required", keyword: "required", params: { missingProperty: "change" }, message: "must have required property 'change'" };
          if (vErrors === null) {
            vErrors = [err173];
          } else {
            vErrors.push(err173);
          }
          errors++;
        }
        if (data65.errors === void 0) {
          const err174 = { instancePath: instancePath + "/summary", schemaPath: "#/$defs/summary/required", keyword: "required", params: { missingProperty: "errors" }, message: "must have required property 'errors'" };
          if (vErrors === null) {
            vErrors = [err174];
          } else {
            vErrors.push(err174);
          }
          errors++;
        }
        if (data65.debts === void 0) {
          const err175 = { instancePath: instancePath + "/summary", schemaPath: "#/$defs/summary/required", keyword: "required", params: { missingProperty: "debts" }, message: "must have required property 'debts'" };
          if (vErrors === null) {
            vErrors = [err175];
          } else {
            vErrors.push(err175);
          }
          errors++;
        }
        for (const key5 in data65) {
          if (!(key5 === "documents" || key5 === "portfolio" || key5 === "skill" || key5 === "module" || key5 === "change" || key5 === "errors" || key5 === "debts")) {
            const err176 = { instancePath: instancePath + "/summary", schemaPath: "#/$defs/summary/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key5 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err176];
            } else {
              vErrors.push(err176);
            }
            errors++;
          }
        }
        if (data65.documents !== void 0) {
          let data66 = data65.documents;
          if (!(typeof data66 == "number" && (!(data66 % 1) && !isNaN(data66)))) {
            const err177 = { instancePath: instancePath + "/summary/documents", schemaPath: "#/$defs/summary/properties/documents/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err177];
            } else {
              vErrors.push(err177);
            }
            errors++;
          }
          if (typeof data66 == "number") {
            if (data66 < 0 || isNaN(data66)) {
              const err178 = { instancePath: instancePath + "/summary/documents", schemaPath: "#/$defs/summary/properties/documents/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
              if (vErrors === null) {
                vErrors = [err178];
              } else {
                vErrors.push(err178);
              }
              errors++;
            }
          }
        }
        if (data65.portfolio !== void 0) {
          let data67 = data65.portfolio;
          if (!(typeof data67 == "number" && (!(data67 % 1) && !isNaN(data67)))) {
            const err179 = { instancePath: instancePath + "/summary/portfolio", schemaPath: "#/$defs/summary/properties/portfolio/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err179];
            } else {
              vErrors.push(err179);
            }
            errors++;
          }
          if (typeof data67 == "number") {
            if (data67 < 0 || isNaN(data67)) {
              const err180 = { instancePath: instancePath + "/summary/portfolio", schemaPath: "#/$defs/summary/properties/portfolio/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
              if (vErrors === null) {
                vErrors = [err180];
              } else {
                vErrors.push(err180);
              }
              errors++;
            }
          }
        }
        if (data65.skill !== void 0) {
          let data68 = data65.skill;
          if (!(typeof data68 == "number" && (!(data68 % 1) && !isNaN(data68)))) {
            const err181 = { instancePath: instancePath + "/summary/skill", schemaPath: "#/$defs/summary/properties/skill/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err181];
            } else {
              vErrors.push(err181);
            }
            errors++;
          }
          if (typeof data68 == "number") {
            if (data68 < 0 || isNaN(data68)) {
              const err182 = { instancePath: instancePath + "/summary/skill", schemaPath: "#/$defs/summary/properties/skill/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
              if (vErrors === null) {
                vErrors = [err182];
              } else {
                vErrors.push(err182);
              }
              errors++;
            }
          }
        }
        if (data65.module !== void 0) {
          let data69 = data65.module;
          if (!(typeof data69 == "number" && (!(data69 % 1) && !isNaN(data69)))) {
            const err183 = { instancePath: instancePath + "/summary/module", schemaPath: "#/$defs/summary/properties/module/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err183];
            } else {
              vErrors.push(err183);
            }
            errors++;
          }
          if (typeof data69 == "number") {
            if (data69 < 0 || isNaN(data69)) {
              const err184 = { instancePath: instancePath + "/summary/module", schemaPath: "#/$defs/summary/properties/module/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
              if (vErrors === null) {
                vErrors = [err184];
              } else {
                vErrors.push(err184);
              }
              errors++;
            }
          }
        }
        if (data65.change !== void 0) {
          let data70 = data65.change;
          if (!(typeof data70 == "number" && (!(data70 % 1) && !isNaN(data70)))) {
            const err185 = { instancePath: instancePath + "/summary/change", schemaPath: "#/$defs/summary/properties/change/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err185];
            } else {
              vErrors.push(err185);
            }
            errors++;
          }
          if (typeof data70 == "number") {
            if (data70 < 0 || isNaN(data70)) {
              const err186 = { instancePath: instancePath + "/summary/change", schemaPath: "#/$defs/summary/properties/change/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
              if (vErrors === null) {
                vErrors = [err186];
              } else {
                vErrors.push(err186);
              }
              errors++;
            }
          }
        }
        if (data65.errors !== void 0) {
          let data71 = data65.errors;
          if (!(typeof data71 == "number" && (!(data71 % 1) && !isNaN(data71)))) {
            const err187 = { instancePath: instancePath + "/summary/errors", schemaPath: "#/$defs/summary/properties/errors/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err187];
            } else {
              vErrors.push(err187);
            }
            errors++;
          }
          if (typeof data71 == "number") {
            if (data71 < 0 || isNaN(data71)) {
              const err188 = { instancePath: instancePath + "/summary/errors", schemaPath: "#/$defs/summary/properties/errors/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
              if (vErrors === null) {
                vErrors = [err188];
              } else {
                vErrors.push(err188);
              }
              errors++;
            }
          }
        }
        if (data65.debts !== void 0) {
          let data72 = data65.debts;
          if (!(typeof data72 == "number" && (!(data72 % 1) && !isNaN(data72)))) {
            const err189 = { instancePath: instancePath + "/summary/debts", schemaPath: "#/$defs/summary/properties/debts/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err189];
            } else {
              vErrors.push(err189);
            }
            errors++;
          }
          if (typeof data72 == "number") {
            if (data72 < 0 || isNaN(data72)) {
              const err190 = { instancePath: instancePath + "/summary/debts", schemaPath: "#/$defs/summary/properties/debts/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
              if (vErrors === null) {
                vErrors = [err190];
              } else {
                vErrors.push(err190);
              }
              errors++;
            }
          }
        }
      } else {
        const err191 = { instancePath: instancePath + "/summary", schemaPath: "#/$defs/summary/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err191];
        } else {
          vErrors.push(err191);
        }
        errors++;
      }
    }
    if (data.capabilities !== void 0) {
      let data73 = data.capabilities;
      if (data73 && typeof data73 == "object" && !Array.isArray(data73)) {
        if (data73.source_json_parse === void 0) {
          const err192 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "source_json_parse" }, message: "must have required property 'source_json_parse'" };
          if (vErrors === null) {
            vErrors = [err192];
          } else {
            vErrors.push(err192);
          }
          errors++;
        }
        if (data73.source_envelope_validation === void 0) {
          const err193 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "source_envelope_validation" }, message: "must have required property 'source_envelope_validation'" };
          if (vErrors === null) {
            vErrors = [err193];
          } else {
            vErrors.push(err193);
          }
          errors++;
        }
        if (data73.global_id_uniqueness === void 0) {
          const err194 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "global_id_uniqueness" }, message: "must have required property 'global_id_uniqueness'" };
          if (vErrors === null) {
            vErrors = [err194];
          } else {
            vErrors.push(err194);
          }
          errors++;
        }
        if (data73.full_json_schema_validation === void 0) {
          const err195 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "full_json_schema_validation" }, message: "must have required property 'full_json_schema_validation'" };
          if (vErrors === null) {
            vErrors = [err195];
          } else {
            vErrors.push(err195);
          }
          errors++;
        }
        if (data73.markdown_binding === void 0) {
          const err196 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "markdown_binding" }, message: "must have required property 'markdown_binding'" };
          if (vErrors === null) {
            vErrors = [err196];
          } else {
            vErrors.push(err196);
          }
          errors++;
        }
        if (data73.graph_invariants === void 0) {
          const err197 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "graph_invariants" }, message: "must have required property 'graph_invariants'" };
          if (vErrors === null) {
            vErrors = [err197];
          } else {
            vErrors.push(err197);
          }
          errors++;
        }
        if (data73.runtime_projection === void 0) {
          const err198 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "runtime_projection" }, message: "must have required property 'runtime_projection'" };
          if (vErrors === null) {
            vErrors = [err198];
          } else {
            vErrors.push(err198);
          }
          errors++;
        }
        if (data73.hop_analysis === void 0) {
          const err199 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "hop_analysis" }, message: "must have required property 'hop_analysis'" };
          if (vErrors === null) {
            vErrors = [err199];
          } else {
            vErrors.push(err199);
          }
          errors++;
        }
        if (data73.typed_change_transactions === void 0) {
          const err200 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "typed_change_transactions" }, message: "must have required property 'typed_change_transactions'" };
          if (vErrors === null) {
            vErrors = [err200];
          } else {
            vErrors.push(err200);
          }
          errors++;
        }
        if (data73.entry_surface_binding === void 0) {
          const err201 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "entry_surface_binding" }, message: "must have required property 'entry_surface_binding'" };
          if (vErrors === null) {
            vErrors = [err201];
          } else {
            vErrors.push(err201);
          }
          errors++;
        }
        if (data73.canonical_source_inventory === void 0) {
          const err202 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "canonical_source_inventory" }, message: "must have required property 'canonical_source_inventory'" };
          if (vErrors === null) {
            vErrors = [err202];
          } else {
            vErrors.push(err202);
          }
          errors++;
        }
        if (data73.derived_freshness === void 0) {
          const err203 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "derived_freshness" }, message: "must have required property 'derived_freshness'" };
          if (vErrors === null) {
            vErrors = [err203];
          } else {
            vErrors.push(err203);
          }
          errors++;
        }
        if (data73.canonical_graph_hash === void 0) {
          const err204 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "canonical_graph_hash" }, message: "must have required property 'canonical_graph_hash'" };
          if (vErrors === null) {
            vErrors = [err204];
          } else {
            vErrors.push(err204);
          }
          errors++;
        }
        if (data73.deterministic_budget_estimator === void 0) {
          const err205 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "deterministic_budget_estimator" }, message: "must have required property 'deterministic_budget_estimator'" };
          if (vErrors === null) {
            vErrors = [err205];
          } else {
            vErrors.push(err205);
          }
          errors++;
        }
        if (data73.host_portability_probe === void 0) {
          const err206 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "host_portability_probe" }, message: "must have required property 'host_portability_probe'" };
          if (vErrors === null) {
            vErrors = [err206];
          } else {
            vErrors.push(err206);
          }
          errors++;
        }
        if (data73.semantic_coverage === void 0) {
          const err207 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "semantic_coverage" }, message: "must have required property 'semantic_coverage'" };
          if (vErrors === null) {
            vErrors = [err207];
          } else {
            vErrors.push(err207);
          }
          errors++;
        }
        if (data73.behavioral_evidence_tracking === void 0) {
          const err208 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/required", keyword: "required", params: { missingProperty: "behavioral_evidence_tracking" }, message: "must have required property 'behavioral_evidence_tracking'" };
          if (vErrors === null) {
            vErrors = [err208];
          } else {
            vErrors.push(err208);
          }
          errors++;
        }
        for (const key6 in data73) {
          if (!func11.call(schema49.properties, key6)) {
            const err209 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key6 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err209];
            } else {
              vErrors.push(err209);
            }
            errors++;
          }
        }
        if (data73.source_json_parse !== void 0) {
          if (typeof data73.source_json_parse !== "boolean") {
            const err210 = { instancePath: instancePath + "/capabilities/source_json_parse", schemaPath: "#/$defs/capabilities/properties/source_json_parse/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err210];
            } else {
              vErrors.push(err210);
            }
            errors++;
          }
        }
        if (data73.source_envelope_validation !== void 0) {
          if (typeof data73.source_envelope_validation !== "boolean") {
            const err211 = { instancePath: instancePath + "/capabilities/source_envelope_validation", schemaPath: "#/$defs/capabilities/properties/source_envelope_validation/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err211];
            } else {
              vErrors.push(err211);
            }
            errors++;
          }
        }
        if (data73.global_id_uniqueness !== void 0) {
          if (typeof data73.global_id_uniqueness !== "boolean") {
            const err212 = { instancePath: instancePath + "/capabilities/global_id_uniqueness", schemaPath: "#/$defs/capabilities/properties/global_id_uniqueness/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err212];
            } else {
              vErrors.push(err212);
            }
            errors++;
          }
        }
        if (data73.full_json_schema_validation !== void 0) {
          if (typeof data73.full_json_schema_validation !== "boolean") {
            const err213 = { instancePath: instancePath + "/capabilities/full_json_schema_validation", schemaPath: "#/$defs/capabilities/properties/full_json_schema_validation/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err213];
            } else {
              vErrors.push(err213);
            }
            errors++;
          }
        }
        if (data73.markdown_binding !== void 0) {
          if (typeof data73.markdown_binding !== "boolean") {
            const err214 = { instancePath: instancePath + "/capabilities/markdown_binding", schemaPath: "#/$defs/capabilities/properties/markdown_binding/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err214];
            } else {
              vErrors.push(err214);
            }
            errors++;
          }
        }
        if (data73.graph_invariants !== void 0) {
          if (typeof data73.graph_invariants !== "boolean") {
            const err215 = { instancePath: instancePath + "/capabilities/graph_invariants", schemaPath: "#/$defs/capabilities/properties/graph_invariants/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err215];
            } else {
              vErrors.push(err215);
            }
            errors++;
          }
        }
        if (data73.runtime_projection !== void 0) {
          if (typeof data73.runtime_projection !== "boolean") {
            const err216 = { instancePath: instancePath + "/capabilities/runtime_projection", schemaPath: "#/$defs/capabilities/properties/runtime_projection/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err216];
            } else {
              vErrors.push(err216);
            }
            errors++;
          }
        }
        if (data73.hop_analysis !== void 0) {
          if (typeof data73.hop_analysis !== "boolean") {
            const err217 = { instancePath: instancePath + "/capabilities/hop_analysis", schemaPath: "#/$defs/capabilities/properties/hop_analysis/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err217];
            } else {
              vErrors.push(err217);
            }
            errors++;
          }
        }
        if (data73.typed_change_transactions !== void 0) {
          if (typeof data73.typed_change_transactions !== "boolean") {
            const err218 = { instancePath: instancePath + "/capabilities/typed_change_transactions", schemaPath: "#/$defs/capabilities/properties/typed_change_transactions/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err218];
            } else {
              vErrors.push(err218);
            }
            errors++;
          }
        }
        if (data73.entry_surface_binding !== void 0) {
          if (typeof data73.entry_surface_binding !== "boolean") {
            const err219 = { instancePath: instancePath + "/capabilities/entry_surface_binding", schemaPath: "#/$defs/capabilities/properties/entry_surface_binding/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err219];
            } else {
              vErrors.push(err219);
            }
            errors++;
          }
        }
        if (data73.canonical_source_inventory !== void 0) {
          if (typeof data73.canonical_source_inventory !== "boolean") {
            const err220 = { instancePath: instancePath + "/capabilities/canonical_source_inventory", schemaPath: "#/$defs/capabilities/properties/canonical_source_inventory/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err220];
            } else {
              vErrors.push(err220);
            }
            errors++;
          }
        }
        if (data73.derived_freshness !== void 0) {
          if (typeof data73.derived_freshness !== "boolean") {
            const err221 = { instancePath: instancePath + "/capabilities/derived_freshness", schemaPath: "#/$defs/capabilities/properties/derived_freshness/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err221];
            } else {
              vErrors.push(err221);
            }
            errors++;
          }
        }
        if (data73.canonical_graph_hash !== void 0) {
          if (typeof data73.canonical_graph_hash !== "boolean") {
            const err222 = { instancePath: instancePath + "/capabilities/canonical_graph_hash", schemaPath: "#/$defs/capabilities/properties/canonical_graph_hash/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err222];
            } else {
              vErrors.push(err222);
            }
            errors++;
          }
        }
        if (data73.deterministic_budget_estimator !== void 0) {
          if (typeof data73.deterministic_budget_estimator !== "boolean") {
            const err223 = { instancePath: instancePath + "/capabilities/deterministic_budget_estimator", schemaPath: "#/$defs/capabilities/properties/deterministic_budget_estimator/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err223];
            } else {
              vErrors.push(err223);
            }
            errors++;
          }
        }
        if (data73.host_portability_probe !== void 0) {
          if (typeof data73.host_portability_probe !== "boolean") {
            const err224 = { instancePath: instancePath + "/capabilities/host_portability_probe", schemaPath: "#/$defs/capabilities/properties/host_portability_probe/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err224];
            } else {
              vErrors.push(err224);
            }
            errors++;
          }
        }
        if (data73.semantic_coverage !== void 0) {
          if (typeof data73.semantic_coverage !== "boolean") {
            const err225 = { instancePath: instancePath + "/capabilities/semantic_coverage", schemaPath: "#/$defs/capabilities/properties/semantic_coverage/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err225];
            } else {
              vErrors.push(err225);
            }
            errors++;
          }
        }
        if (data73.behavioral_evidence_tracking !== void 0) {
          if (typeof data73.behavioral_evidence_tracking !== "boolean") {
            const err226 = { instancePath: instancePath + "/capabilities/behavioral_evidence_tracking", schemaPath: "#/$defs/capabilities/properties/behavioral_evidence_tracking/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err226];
            } else {
              vErrors.push(err226);
            }
            errors++;
          }
        }
      } else {
        const err227 = { instancePath: instancePath + "/capabilities", schemaPath: "#/$defs/capabilities/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err227];
        } else {
          vErrors.push(err227);
        }
        errors++;
      }
    }
    if (data.hardening_contract !== void 0) {
      let data91 = data.hardening_contract;
      if (data91 && typeof data91 == "object" && !Array.isArray(data91)) {
        if (data91.C1 === void 0) {
          const err228 = { instancePath: instancePath + "/hardening_contract", schemaPath: "#/$defs/hardeningContract/required", keyword: "required", params: { missingProperty: "C1" }, message: "must have required property 'C1'" };
          if (vErrors === null) {
            vErrors = [err228];
          } else {
            vErrors.push(err228);
          }
          errors++;
        }
        if (data91.C2 === void 0) {
          const err229 = { instancePath: instancePath + "/hardening_contract", schemaPath: "#/$defs/hardeningContract/required", keyword: "required", params: { missingProperty: "C2" }, message: "must have required property 'C2'" };
          if (vErrors === null) {
            vErrors = [err229];
          } else {
            vErrors.push(err229);
          }
          errors++;
        }
        if (data91.C3 === void 0) {
          const err230 = { instancePath: instancePath + "/hardening_contract", schemaPath: "#/$defs/hardeningContract/required", keyword: "required", params: { missingProperty: "C3" }, message: "must have required property 'C3'" };
          if (vErrors === null) {
            vErrors = [err230];
          } else {
            vErrors.push(err230);
          }
          errors++;
        }
        if (data91.C4 === void 0) {
          const err231 = { instancePath: instancePath + "/hardening_contract", schemaPath: "#/$defs/hardeningContract/required", keyword: "required", params: { missingProperty: "C4" }, message: "must have required property 'C4'" };
          if (vErrors === null) {
            vErrors = [err231];
          } else {
            vErrors.push(err231);
          }
          errors++;
        }
        if (data91.C5 === void 0) {
          const err232 = { instancePath: instancePath + "/hardening_contract", schemaPath: "#/$defs/hardeningContract/required", keyword: "required", params: { missingProperty: "C5" }, message: "must have required property 'C5'" };
          if (vErrors === null) {
            vErrors = [err232];
          } else {
            vErrors.push(err232);
          }
          errors++;
        }
        if (data91.C6 === void 0) {
          const err233 = { instancePath: instancePath + "/hardening_contract", schemaPath: "#/$defs/hardeningContract/required", keyword: "required", params: { missingProperty: "C6" }, message: "must have required property 'C6'" };
          if (vErrors === null) {
            vErrors = [err233];
          } else {
            vErrors.push(err233);
          }
          errors++;
        }
        if (data91.C7 === void 0) {
          const err234 = { instancePath: instancePath + "/hardening_contract", schemaPath: "#/$defs/hardeningContract/required", keyword: "required", params: { missingProperty: "C7" }, message: "must have required property 'C7'" };
          if (vErrors === null) {
            vErrors = [err234];
          } else {
            vErrors.push(err234);
          }
          errors++;
        }
        if (data91.C8 === void 0) {
          const err235 = { instancePath: instancePath + "/hardening_contract", schemaPath: "#/$defs/hardeningContract/required", keyword: "required", params: { missingProperty: "C8" }, message: "must have required property 'C8'" };
          if (vErrors === null) {
            vErrors = [err235];
          } else {
            vErrors.push(err235);
          }
          errors++;
        }
        if (data91.C9 === void 0) {
          const err236 = { instancePath: instancePath + "/hardening_contract", schemaPath: "#/$defs/hardeningContract/required", keyword: "required", params: { missingProperty: "C9" }, message: "must have required property 'C9'" };
          if (vErrors === null) {
            vErrors = [err236];
          } else {
            vErrors.push(err236);
          }
          errors++;
        }
        if (data91.C10 === void 0) {
          const err237 = { instancePath: instancePath + "/hardening_contract", schemaPath: "#/$defs/hardeningContract/required", keyword: "required", params: { missingProperty: "C10" }, message: "must have required property 'C10'" };
          if (vErrors === null) {
            vErrors = [err237];
          } else {
            vErrors.push(err237);
          }
          errors++;
        }
        if (data91.C11 === void 0) {
          const err238 = { instancePath: instancePath + "/hardening_contract", schemaPath: "#/$defs/hardeningContract/required", keyword: "required", params: { missingProperty: "C11" }, message: "must have required property 'C11'" };
          if (vErrors === null) {
            vErrors = [err238];
          } else {
            vErrors.push(err238);
          }
          errors++;
        }
        if (data91.C12 === void 0) {
          const err239 = { instancePath: instancePath + "/hardening_contract", schemaPath: "#/$defs/hardeningContract/required", keyword: "required", params: { missingProperty: "C12" }, message: "must have required property 'C12'" };
          if (vErrors === null) {
            vErrors = [err239];
          } else {
            vErrors.push(err239);
          }
          errors++;
        }
        if (data91.C13 === void 0) {
          const err240 = { instancePath: instancePath + "/hardening_contract", schemaPath: "#/$defs/hardeningContract/required", keyword: "required", params: { missingProperty: "C13" }, message: "must have required property 'C13'" };
          if (vErrors === null) {
            vErrors = [err240];
          } else {
            vErrors.push(err240);
          }
          errors++;
        }
        if (data91.C14 === void 0) {
          const err241 = { instancePath: instancePath + "/hardening_contract", schemaPath: "#/$defs/hardeningContract/required", keyword: "required", params: { missingProperty: "C14" }, message: "must have required property 'C14'" };
          if (vErrors === null) {
            vErrors = [err241];
          } else {
            vErrors.push(err241);
          }
          errors++;
        }
        for (const key7 in data91) {
          if (!func11.call(schema50.properties, key7)) {
            const err242 = { instancePath: instancePath + "/hardening_contract", schemaPath: "#/$defs/hardeningContract/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key7 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err242];
            } else {
              vErrors.push(err242);
            }
            errors++;
          }
        }
        if (data91.C1 !== void 0) {
          let data92 = data91.C1;
          if (data92 && typeof data92 == "object" && !Array.isArray(data92)) {
            if (data92.entry_surface_fields === void 0) {
              const err243 = { instancePath: instancePath + "/hardening_contract/C1", schemaPath: "#/$defs/hardeningContract/properties/C1/required", keyword: "required", params: { missingProperty: "entry_surface_fields" }, message: "must have required property 'entry_surface_fields'" };
              if (vErrors === null) {
                vErrors = [err243];
              } else {
                vErrors.push(err243);
              }
              errors++;
            }
            for (const key8 in data92) {
              if (!(key8 === "entry_surface_fields")) {
                const err244 = { instancePath: instancePath + "/hardening_contract/C1", schemaPath: "#/$defs/hardeningContract/properties/C1/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key8 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err244];
                } else {
                  vErrors.push(err244);
                }
                errors++;
              }
            }
            if (data92.entry_surface_fields !== void 0) {
              if (!func0(data92.entry_surface_fields, schema50.properties.C1.properties.entry_surface_fields.const)) {
                const err245 = { instancePath: instancePath + "/hardening_contract/C1/entry_surface_fields", schemaPath: "#/$defs/hardeningContract/properties/C1/properties/entry_surface_fields/const", keyword: "const", params: { allowedValue: schema50.properties.C1.properties.entry_surface_fields.const }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err245];
                } else {
                  vErrors.push(err245);
                }
                errors++;
              }
            }
          } else {
            const err246 = { instancePath: instancePath + "/hardening_contract/C1", schemaPath: "#/$defs/hardeningContract/properties/C1/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err246];
            } else {
              vErrors.push(err246);
            }
            errors++;
          }
        }
        if (data91.C2 !== void 0) {
          let data94 = data91.C2;
          if (data94 && typeof data94 == "object" && !Array.isArray(data94)) {
            if (data94.coverage_states === void 0) {
              const err247 = { instancePath: instancePath + "/hardening_contract/C2", schemaPath: "#/$defs/hardeningContract/properties/C2/required", keyword: "required", params: { missingProperty: "coverage_states" }, message: "must have required property 'coverage_states'" };
              if (vErrors === null) {
                vErrors = [err247];
              } else {
                vErrors.push(err247);
              }
              errors++;
            }
            if (data94.denominator === void 0) {
              const err248 = { instancePath: instancePath + "/hardening_contract/C2", schemaPath: "#/$defs/hardeningContract/properties/C2/required", keyword: "required", params: { missingProperty: "denominator" }, message: "must have required property 'denominator'" };
              if (vErrors === null) {
                vErrors = [err248];
              } else {
                vErrors.push(err248);
              }
              errors++;
            }
            for (const key9 in data94) {
              if (!(key9 === "coverage_states" || key9 === "denominator")) {
                const err249 = { instancePath: instancePath + "/hardening_contract/C2", schemaPath: "#/$defs/hardeningContract/properties/C2/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key9 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err249];
                } else {
                  vErrors.push(err249);
                }
                errors++;
              }
            }
            if (data94.coverage_states !== void 0) {
              if (!func0(data94.coverage_states, schema50.properties.C2.properties.coverage_states.const)) {
                const err250 = { instancePath: instancePath + "/hardening_contract/C2/coverage_states", schemaPath: "#/$defs/hardeningContract/properties/C2/properties/coverage_states/const", keyword: "const", params: { allowedValue: schema50.properties.C2.properties.coverage_states.const }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err250];
                } else {
                  vErrors.push(err250);
                }
                errors++;
              }
            }
            if (data94.denominator !== void 0) {
              if ("git_canonical_markdown" !== data94.denominator) {
                const err251 = { instancePath: instancePath + "/hardening_contract/C2/denominator", schemaPath: "#/$defs/hardeningContract/properties/C2/properties/denominator/const", keyword: "const", params: { allowedValue: "git_canonical_markdown" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err251];
                } else {
                  vErrors.push(err251);
                }
                errors++;
              }
            }
          } else {
            const err252 = { instancePath: instancePath + "/hardening_contract/C2", schemaPath: "#/$defs/hardeningContract/properties/C2/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err252];
            } else {
              vErrors.push(err252);
            }
            errors++;
          }
        }
        if (data91.C3 !== void 0) {
          let data97 = data91.C3;
          if (data97 && typeof data97 == "object" && !Array.isArray(data97)) {
            if (data97.derived_fields === void 0) {
              const err253 = { instancePath: instancePath + "/hardening_contract/C3", schemaPath: "#/$defs/hardeningContract/properties/C3/required", keyword: "required", params: { missingProperty: "derived_fields" }, message: "must have required property 'derived_fields'" };
              if (vErrors === null) {
                vErrors = [err253];
              } else {
                vErrors.push(err253);
              }
              errors++;
            }
            for (const key10 in data97) {
              if (!(key10 === "derived_fields")) {
                const err254 = { instancePath: instancePath + "/hardening_contract/C3", schemaPath: "#/$defs/hardeningContract/properties/C3/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key10 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err254];
                } else {
                  vErrors.push(err254);
                }
                errors++;
              }
            }
            if (data97.derived_fields !== void 0) {
              if (!func0(data97.derived_fields, schema50.properties.C3.properties.derived_fields.const)) {
                const err255 = { instancePath: instancePath + "/hardening_contract/C3/derived_fields", schemaPath: "#/$defs/hardeningContract/properties/C3/properties/derived_fields/const", keyword: "const", params: { allowedValue: schema50.properties.C3.properties.derived_fields.const }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err255];
                } else {
                  vErrors.push(err255);
                }
                errors++;
              }
            }
          } else {
            const err256 = { instancePath: instancePath + "/hardening_contract/C3", schemaPath: "#/$defs/hardeningContract/properties/C3/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err256];
            } else {
              vErrors.push(err256);
            }
            errors++;
          }
        }
        if (data91.C4 !== void 0) {
          let data99 = data91.C4;
          if (data99 && typeof data99 == "object" && !Array.isArray(data99)) {
            if (data99.accepted_skill_requires_admission === void 0) {
              const err257 = { instancePath: instancePath + "/hardening_contract/C4", schemaPath: "#/$defs/hardeningContract/properties/C4/required", keyword: "required", params: { missingProperty: "accepted_skill_requires_admission" }, message: "must have required property 'accepted_skill_requires_admission'" };
              if (vErrors === null) {
                vErrors = [err257];
              } else {
                vErrors.push(err257);
              }
              errors++;
            }
            for (const key11 in data99) {
              if (!(key11 === "accepted_skill_requires_admission")) {
                const err258 = { instancePath: instancePath + "/hardening_contract/C4", schemaPath: "#/$defs/hardeningContract/properties/C4/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key11 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err258];
                } else {
                  vErrors.push(err258);
                }
                errors++;
              }
            }
            if (data99.accepted_skill_requires_admission !== void 0) {
              if (true !== data99.accepted_skill_requires_admission) {
                const err259 = { instancePath: instancePath + "/hardening_contract/C4/accepted_skill_requires_admission", schemaPath: "#/$defs/hardeningContract/properties/C4/properties/accepted_skill_requires_admission/const", keyword: "const", params: { allowedValue: true }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err259];
                } else {
                  vErrors.push(err259);
                }
                errors++;
              }
            }
          } else {
            const err260 = { instancePath: instancePath + "/hardening_contract/C4", schemaPath: "#/$defs/hardeningContract/properties/C4/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err260];
            } else {
              vErrors.push(err260);
            }
            errors++;
          }
        }
        if (data91.C5 !== void 0) {
          let data101 = data91.C5;
          if (data101 && typeof data101 == "object" && !Array.isArray(data101)) {
            if (data101.change_workflow === void 0) {
              const err261 = { instancePath: instancePath + "/hardening_contract/C5", schemaPath: "#/$defs/hardeningContract/properties/C5/required", keyword: "required", params: { missingProperty: "change_workflow" }, message: "must have required property 'change_workflow'" };
              if (vErrors === null) {
                vErrors = [err261];
              } else {
                vErrors.push(err261);
              }
              errors++;
            }
            if (data101.workspace_root === void 0) {
              const err262 = { instancePath: instancePath + "/hardening_contract/C5", schemaPath: "#/$defs/hardeningContract/properties/C5/required", keyword: "required", params: { missingProperty: "workspace_root" }, message: "must have required property 'workspace_root'" };
              if (vErrors === null) {
                vErrors = [err262];
              } else {
                vErrors.push(err262);
              }
              errors++;
            }
            for (const key12 in data101) {
              if (!(key12 === "change_workflow" || key12 === "workspace_root")) {
                const err263 = { instancePath: instancePath + "/hardening_contract/C5", schemaPath: "#/$defs/hardeningContract/properties/C5/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key12 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err263];
                } else {
                  vErrors.push(err263);
                }
                errors++;
              }
            }
            if (data101.change_workflow !== void 0) {
              if (!func0(data101.change_workflow, schema50.properties.C5.properties.change_workflow.const)) {
                const err264 = { instancePath: instancePath + "/hardening_contract/C5/change_workflow", schemaPath: "#/$defs/hardeningContract/properties/C5/properties/change_workflow/const", keyword: "const", params: { allowedValue: schema50.properties.C5.properties.change_workflow.const }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err264];
                } else {
                  vErrors.push(err264);
                }
                errors++;
              }
            }
            if (data101.workspace_root !== void 0) {
              if (".skill-knowledge/workspaces/<change-id>" !== data101.workspace_root) {
                const err265 = { instancePath: instancePath + "/hardening_contract/C5/workspace_root", schemaPath: "#/$defs/hardeningContract/properties/C5/properties/workspace_root/const", keyword: "const", params: { allowedValue: ".skill-knowledge/workspaces/<change-id>" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err265];
                } else {
                  vErrors.push(err265);
                }
                errors++;
              }
            }
          } else {
            const err266 = { instancePath: instancePath + "/hardening_contract/C5", schemaPath: "#/$defs/hardeningContract/properties/C5/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err266];
            } else {
              vErrors.push(err266);
            }
            errors++;
          }
        }
        if (data91.C6 !== void 0) {
          let data104 = data91.C6;
          if (data104 && typeof data104 == "object" && !Array.isArray(data104)) {
            if (data104.algorithm === void 0) {
              const err267 = { instancePath: instancePath + "/hardening_contract/C6", schemaPath: "#/$defs/hardeningContract/properties/C6/required", keyword: "required", params: { missingProperty: "algorithm" }, message: "must have required property 'algorithm'" };
              if (vErrors === null) {
                vErrors = [err267];
              } else {
                vErrors.push(err267);
              }
              errors++;
            }
            if (data104.authored_manifest_kinds === void 0) {
              const err268 = { instancePath: instancePath + "/hardening_contract/C6", schemaPath: "#/$defs/hardeningContract/properties/C6/required", keyword: "required", params: { missingProperty: "authored_manifest_kinds" }, message: "must have required property 'authored_manifest_kinds'" };
              if (vErrors === null) {
                vErrors = [err268];
              } else {
                vErrors.push(err268);
              }
              errors++;
            }
            if (data104.change_head_digest_excludes === void 0) {
              const err269 = { instancePath: instancePath + "/hardening_contract/C6", schemaPath: "#/$defs/hardeningContract/properties/C6/required", keyword: "required", params: { missingProperty: "change_head_digest_excludes" }, message: "must have required property 'change_head_digest_excludes'" };
              if (vErrors === null) {
                vErrors = [err269];
              } else {
                vErrors.push(err269);
              }
              errors++;
            }
            if (data104.identity_set_fields === void 0) {
              const err270 = { instancePath: instancePath + "/hardening_contract/C6", schemaPath: "#/$defs/hardeningContract/properties/C6/required", keyword: "required", params: { missingProperty: "identity_set_fields" }, message: "must have required property 'identity_set_fields'" };
              if (vErrors === null) {
                vErrors = [err270];
              } else {
                vErrors.push(err270);
              }
              errors++;
            }
            if (data104.semantic_order_fields === void 0) {
              const err271 = { instancePath: instancePath + "/hardening_contract/C6", schemaPath: "#/$defs/hardeningContract/properties/C6/required", keyword: "required", params: { missingProperty: "semantic_order_fields" }, message: "must have required property 'semantic_order_fields'" };
              if (vErrors === null) {
                vErrors = [err271];
              } else {
                vErrors.push(err271);
              }
              errors++;
            }
            for (const key13 in data104) {
              if (!(key13 === "algorithm" || key13 === "authored_manifest_kinds" || key13 === "change_head_digest_excludes" || key13 === "identity_set_fields" || key13 === "semantic_order_fields")) {
                const err272 = { instancePath: instancePath + "/hardening_contract/C6", schemaPath: "#/$defs/hardeningContract/properties/C6/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key13 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err272];
                } else {
                  vErrors.push(err272);
                }
                errors++;
              }
            }
            if (data104.algorithm !== void 0) {
              if ("cc-master/skill-knowledge-canonical-graph-hash/v1" !== data104.algorithm) {
                const err273 = { instancePath: instancePath + "/hardening_contract/C6/algorithm", schemaPath: "#/$defs/hardeningContract/properties/C6/properties/algorithm/const", keyword: "const", params: { allowedValue: "cc-master/skill-knowledge-canonical-graph-hash/v1" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err273];
                } else {
                  vErrors.push(err273);
                }
                errors++;
              }
            }
            if (data104.authored_manifest_kinds !== void 0) {
              if (!func0(data104.authored_manifest_kinds, schema50.properties.C6.properties.authored_manifest_kinds.const)) {
                const err274 = { instancePath: instancePath + "/hardening_contract/C6/authored_manifest_kinds", schemaPath: "#/$defs/hardeningContract/properties/C6/properties/authored_manifest_kinds/const", keyword: "const", params: { allowedValue: schema50.properties.C6.properties.authored_manifest_kinds.const }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err274];
                } else {
                  vErrors.push(err274);
                }
                errors++;
              }
            }
            if (data104.change_head_digest_excludes !== void 0) {
              if (!func0(data104.change_head_digest_excludes, schema50.properties.C6.properties.change_head_digest_excludes.const)) {
                const err275 = { instancePath: instancePath + "/hardening_contract/C6/change_head_digest_excludes", schemaPath: "#/$defs/hardeningContract/properties/C6/properties/change_head_digest_excludes/const", keyword: "const", params: { allowedValue: schema50.properties.C6.properties.change_head_digest_excludes.const }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err275];
                } else {
                  vErrors.push(err275);
                }
                errors++;
              }
            }
            if (data104.identity_set_fields !== void 0) {
              if (!func0(data104.identity_set_fields, schema50.properties.C6.properties.identity_set_fields.const)) {
                const err276 = { instancePath: instancePath + "/hardening_contract/C6/identity_set_fields", schemaPath: "#/$defs/hardeningContract/properties/C6/properties/identity_set_fields/const", keyword: "const", params: { allowedValue: schema50.properties.C6.properties.identity_set_fields.const }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err276];
                } else {
                  vErrors.push(err276);
                }
                errors++;
              }
            }
            if (data104.semantic_order_fields !== void 0) {
              if (!func0(data104.semantic_order_fields, schema50.properties.C6.properties.semantic_order_fields.const)) {
                const err277 = { instancePath: instancePath + "/hardening_contract/C6/semantic_order_fields", schemaPath: "#/$defs/hardeningContract/properties/C6/properties/semantic_order_fields/const", keyword: "const", params: { allowedValue: schema50.properties.C6.properties.semantic_order_fields.const }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err277];
                } else {
                  vErrors.push(err277);
                }
                errors++;
              }
            }
          } else {
            const err278 = { instancePath: instancePath + "/hardening_contract/C6", schemaPath: "#/$defs/hardeningContract/properties/C6/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err278];
            } else {
              vErrors.push(err278);
            }
            errors++;
          }
        }
        if (data91.C7 !== void 0) {
          let data110 = data91.C7;
          if (data110 && typeof data110 == "object" && !Array.isArray(data110)) {
            if (data110.algorithm === void 0) {
              const err279 = { instancePath: instancePath + "/hardening_contract/C7", schemaPath: "#/$defs/hardeningContract/properties/C7/required", keyword: "required", params: { missingProperty: "algorithm" }, message: "must have required property 'algorithm'" };
              if (vErrors === null) {
                vErrors = [err279];
              } else {
                vErrors.push(err279);
              }
              errors++;
            }
            if (data110.newline_normalization === void 0) {
              const err280 = { instancePath: instancePath + "/hardening_contract/C7", schemaPath: "#/$defs/hardeningContract/properties/C7/required", keyword: "required", params: { missingProperty: "newline_normalization" }, message: "must have required property 'newline_normalization'" };
              if (vErrors === null) {
                vErrors = [err280];
              } else {
                vErrors.push(err280);
              }
              errors++;
            }
            for (const key14 in data110) {
              if (!(key14 === "algorithm" || key14 === "newline_normalization")) {
                const err281 = { instancePath: instancePath + "/hardening_contract/C7", schemaPath: "#/$defs/hardeningContract/properties/C7/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key14 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err281];
                } else {
                  vErrors.push(err281);
                }
                errors++;
              }
            }
            if (data110.algorithm !== void 0) {
              if ("cc-master/skill-knowledge-markdown-span-hash/v1" !== data110.algorithm) {
                const err282 = { instancePath: instancePath + "/hardening_contract/C7/algorithm", schemaPath: "#/$defs/hardeningContract/properties/C7/properties/algorithm/const", keyword: "const", params: { allowedValue: "cc-master/skill-knowledge-markdown-span-hash/v1" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err282];
                } else {
                  vErrors.push(err282);
                }
                errors++;
              }
            }
            if (data110.newline_normalization !== void 0) {
              if ("crlf-to-lf" !== data110.newline_normalization) {
                const err283 = { instancePath: instancePath + "/hardening_contract/C7/newline_normalization", schemaPath: "#/$defs/hardeningContract/properties/C7/properties/newline_normalization/const", keyword: "const", params: { allowedValue: "crlf-to-lf" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err283];
                } else {
                  vErrors.push(err283);
                }
                errors++;
              }
            }
          } else {
            const err284 = { instancePath: instancePath + "/hardening_contract/C7", schemaPath: "#/$defs/hardeningContract/properties/C7/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err284];
            } else {
              vErrors.push(err284);
            }
            errors++;
          }
        }
        if (data91.C8 !== void 0) {
          let data113 = data91.C8;
          if (data113 && typeof data113 == "object" && !Array.isArray(data113)) {
            if (data113.algorithm === void 0) {
              const err285 = { instancePath: instancePath + "/hardening_contract/C8", schemaPath: "#/$defs/hardeningContract/properties/C8/required", keyword: "required", params: { missingProperty: "algorithm" }, message: "must have required property 'algorithm'" };
              if (vErrors === null) {
                vErrors = [err285];
              } else {
                vErrors.push(err285);
              }
              errors++;
            }
            if (data113.formula === void 0) {
              const err286 = { instancePath: instancePath + "/hardening_contract/C8", schemaPath: "#/$defs/hardeningContract/properties/C8/required", keyword: "required", params: { missingProperty: "formula" }, message: "must have required property 'formula'" };
              if (vErrors === null) {
                vErrors = [err286];
              } else {
                vErrors.push(err286);
              }
              errors++;
            }
            for (const key15 in data113) {
              if (!(key15 === "algorithm" || key15 === "formula")) {
                const err287 = { instancePath: instancePath + "/hardening_contract/C8", schemaPath: "#/$defs/hardeningContract/properties/C8/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key15 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err287];
                } else {
                  vErrors.push(err287);
                }
                errors++;
              }
            }
            if (data113.algorithm !== void 0) {
              if ("cc-master/skill-knowledge-budget-estimator/v1" !== data113.algorithm) {
                const err288 = { instancePath: instancePath + "/hardening_contract/C8/algorithm", schemaPath: "#/$defs/hardeningContract/properties/C8/properties/algorithm/const", keyword: "const", params: { allowedValue: "cc-master/skill-knowledge-budget-estimator/v1" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err288];
                } else {
                  vErrors.push(err288);
                }
                errors++;
              }
            }
            if (data113.formula !== void 0) {
              if ("ceil(utf8_bytes/3)" !== data113.formula) {
                const err289 = { instancePath: instancePath + "/hardening_contract/C8/formula", schemaPath: "#/$defs/hardeningContract/properties/C8/properties/formula/const", keyword: "const", params: { allowedValue: "ceil(utf8_bytes/3)" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err289];
                } else {
                  vErrors.push(err289);
                }
                errors++;
              }
            }
          } else {
            const err290 = { instancePath: instancePath + "/hardening_contract/C8", schemaPath: "#/$defs/hardeningContract/properties/C8/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err290];
            } else {
              vErrors.push(err290);
            }
            errors++;
          }
        }
        if (data91.C9 !== void 0) {
          let data116 = data91.C9;
          if (data116 && typeof data116 == "object" && !Array.isArray(data116)) {
            if (data116.hosts === void 0) {
              const err291 = { instancePath: instancePath + "/hardening_contract/C9", schemaPath: "#/$defs/hardeningContract/properties/C9/required", keyword: "required", params: { missingProperty: "hosts" }, message: "must have required property 'hosts'" };
              if (vErrors === null) {
                vErrors = [err291];
              } else {
                vErrors.push(err291);
              }
              errors++;
            }
            if (data116.worker_allowlist === void 0) {
              const err292 = { instancePath: instancePath + "/hardening_contract/C9", schemaPath: "#/$defs/hardeningContract/properties/C9/required", keyword: "required", params: { missingProperty: "worker_allowlist" }, message: "must have required property 'worker_allowlist'" };
              if (vErrors === null) {
                vErrors = [err292];
              } else {
                vErrors.push(err292);
              }
              errors++;
            }
            if (data116.payload_modes === void 0) {
              const err293 = { instancePath: instancePath + "/hardening_contract/C9", schemaPath: "#/$defs/hardeningContract/properties/C9/required", keyword: "required", params: { missingProperty: "payload_modes" }, message: "must have required property 'payload_modes'" };
              if (vErrors === null) {
                vErrors = [err293];
              } else {
                vErrors.push(err293);
              }
              errors++;
            }
            if (data116.anchor_form === void 0) {
              const err294 = { instancePath: instancePath + "/hardening_contract/C9", schemaPath: "#/$defs/hardeningContract/properties/C9/required", keyword: "required", params: { missingProperty: "anchor_form" }, message: "must have required property 'anchor_form'" };
              if (vErrors === null) {
                vErrors = [err294];
              } else {
                vErrors.push(err294);
              }
              errors++;
            }
            if (data116.path_policy === void 0) {
              const err295 = { instancePath: instancePath + "/hardening_contract/C9", schemaPath: "#/$defs/hardeningContract/properties/C9/required", keyword: "required", params: { missingProperty: "path_policy" }, message: "must have required property 'path_policy'" };
              if (vErrors === null) {
                vErrors = [err295];
              } else {
                vErrors.push(err295);
              }
              errors++;
            }
            for (const key16 in data116) {
              if (!(key16 === "hosts" || key16 === "worker_allowlist" || key16 === "payload_modes" || key16 === "anchor_form" || key16 === "path_policy")) {
                const err296 = { instancePath: instancePath + "/hardening_contract/C9", schemaPath: "#/$defs/hardeningContract/properties/C9/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key16 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err296];
                } else {
                  vErrors.push(err296);
                }
                errors++;
              }
            }
            if (data116.hosts !== void 0) {
              if (!func0(data116.hosts, schema50.properties.C9.properties.hosts.const)) {
                const err297 = { instancePath: instancePath + "/hardening_contract/C9/hosts", schemaPath: "#/$defs/hardeningContract/properties/C9/properties/hosts/const", keyword: "const", params: { allowedValue: schema50.properties.C9.properties.hosts.const }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err297];
                } else {
                  vErrors.push(err297);
                }
                errors++;
              }
            }
            if (data116.worker_allowlist !== void 0) {
              if (!func0(data116.worker_allowlist, schema50.properties.C9.properties.worker_allowlist.const)) {
                const err298 = { instancePath: instancePath + "/hardening_contract/C9/worker_allowlist", schemaPath: "#/$defs/hardeningContract/properties/C9/properties/worker_allowlist/const", keyword: "const", params: { allowedValue: schema50.properties.C9.properties.worker_allowlist.const }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err298];
                } else {
                  vErrors.push(err298);
                }
                errors++;
              }
            }
            if (data116.payload_modes !== void 0) {
              if (!func0(data116.payload_modes, schema50.properties.C9.properties.payload_modes.const)) {
                const err299 = { instancePath: instancePath + "/hardening_contract/C9/payload_modes", schemaPath: "#/$defs/hardeningContract/properties/C9/properties/payload_modes/const", keyword: "const", params: { allowedValue: schema50.properties.C9.properties.payload_modes.const }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err299];
                } else {
                  vErrors.push(err299);
                }
                errors++;
              }
            }
            if (data116.anchor_form !== void 0) {
              if ("explicit-html-id" !== data116.anchor_form) {
                const err300 = { instancePath: instancePath + "/hardening_contract/C9/anchor_form", schemaPath: "#/$defs/hardeningContract/properties/C9/properties/anchor_form/const", keyword: "const", params: { allowedValue: "explicit-html-id" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err300];
                } else {
                  vErrors.push(err300);
                }
                errors++;
              }
            }
            if (data116.path_policy !== void 0) {
              if ("relative-final-host-path" !== data116.path_policy) {
                const err301 = { instancePath: instancePath + "/hardening_contract/C9/path_policy", schemaPath: "#/$defs/hardeningContract/properties/C9/properties/path_policy/const", keyword: "const", params: { allowedValue: "relative-final-host-path" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err301];
                } else {
                  vErrors.push(err301);
                }
                errors++;
              }
            }
          } else {
            const err302 = { instancePath: instancePath + "/hardening_contract/C9", schemaPath: "#/$defs/hardeningContract/properties/C9/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err302];
            } else {
              vErrors.push(err302);
            }
            errors++;
          }
        }
        if (data91.C10 !== void 0) {
          let data122 = data91.C10;
          if (data122 && typeof data122 == "object" && !Array.isArray(data122)) {
            if (data122.changed_scope_base_option === void 0) {
              const err303 = { instancePath: instancePath + "/hardening_contract/C10", schemaPath: "#/$defs/hardeningContract/properties/C10/required", keyword: "required", params: { missingProperty: "changed_scope_base_option" }, message: "must have required property 'changed_scope_base_option'" };
              if (vErrors === null) {
                vErrors = [err303];
              } else {
                vErrors.push(err303);
              }
              errors++;
            }
            if (data122.immutable_chain === void 0) {
              const err304 = { instancePath: instancePath + "/hardening_contract/C10", schemaPath: "#/$defs/hardeningContract/properties/C10/required", keyword: "required", params: { missingProperty: "immutable_chain" }, message: "must have required property 'immutable_chain'" };
              if (vErrors === null) {
                vErrors = [err304];
              } else {
                vErrors.push(err304);
              }
              errors++;
            }
            for (const key17 in data122) {
              if (!(key17 === "changed_scope_base_option" || key17 === "immutable_chain")) {
                const err305 = { instancePath: instancePath + "/hardening_contract/C10", schemaPath: "#/$defs/hardeningContract/properties/C10/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key17 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err305];
                } else {
                  vErrors.push(err305);
                }
                errors++;
              }
            }
            if (data122.changed_scope_base_option !== void 0) {
              if ("--base" !== data122.changed_scope_base_option) {
                const err306 = { instancePath: instancePath + "/hardening_contract/C10/changed_scope_base_option", schemaPath: "#/$defs/hardeningContract/properties/C10/properties/changed_scope_base_option/const", keyword: "const", params: { allowedValue: "--base" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err306];
                } else {
                  vErrors.push(err306);
                }
                errors++;
              }
            }
            if (data122.immutable_chain !== void 0) {
              if (true !== data122.immutable_chain) {
                const err307 = { instancePath: instancePath + "/hardening_contract/C10/immutable_chain", schemaPath: "#/$defs/hardeningContract/properties/C10/properties/immutable_chain/const", keyword: "const", params: { allowedValue: true }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err307];
                } else {
                  vErrors.push(err307);
                }
                errors++;
              }
            }
          } else {
            const err308 = { instancePath: instancePath + "/hardening_contract/C10", schemaPath: "#/$defs/hardeningContract/properties/C10/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err308];
            } else {
              vErrors.push(err308);
            }
            errors++;
          }
        }
        if (data91.C11 !== void 0) {
          let data125 = data91.C11;
          if (data125 && typeof data125 == "object" && !Array.isArray(data125)) {
            if (data125.k2_allows_partial === void 0) {
              const err309 = { instancePath: instancePath + "/hardening_contract/C11", schemaPath: "#/$defs/hardeningContract/properties/C11/required", keyword: "required", params: { missingProperty: "k2_allows_partial" }, message: "must have required property 'k2_allows_partial'" };
              if (vErrors === null) {
                vErrors = [err309];
              } else {
                vErrors.push(err309);
              }
              errors++;
            }
            for (const key18 in data125) {
              if (!(key18 === "k2_allows_partial")) {
                const err310 = { instancePath: instancePath + "/hardening_contract/C11", schemaPath: "#/$defs/hardeningContract/properties/C11/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key18 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err310];
                } else {
                  vErrors.push(err310);
                }
                errors++;
              }
            }
            if (data125.k2_allows_partial !== void 0) {
              if (false !== data125.k2_allows_partial) {
                const err311 = { instancePath: instancePath + "/hardening_contract/C11/k2_allows_partial", schemaPath: "#/$defs/hardeningContract/properties/C11/properties/k2_allows_partial/const", keyword: "const", params: { allowedValue: false }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err311];
                } else {
                  vErrors.push(err311);
                }
                errors++;
              }
            }
          } else {
            const err312 = { instancePath: instancePath + "/hardening_contract/C11", schemaPath: "#/$defs/hardeningContract/properties/C11/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err312];
            } else {
              vErrors.push(err312);
            }
            errors++;
          }
        }
        if (data91.C12 !== void 0) {
          let data127 = data91.C12;
          if (data127 && typeof data127 == "object" && !Array.isArray(data127)) {
            if (data127.report_tracks === void 0) {
              const err313 = { instancePath: instancePath + "/hardening_contract/C12", schemaPath: "#/$defs/hardeningContract/properties/C12/required", keyword: "required", params: { missingProperty: "report_tracks" }, message: "must have required property 'report_tracks'" };
              if (vErrors === null) {
                vErrors = [err313];
              } else {
                vErrors.push(err313);
              }
              errors++;
            }
            for (const key19 in data127) {
              if (!(key19 === "report_tracks")) {
                const err314 = { instancePath: instancePath + "/hardening_contract/C12", schemaPath: "#/$defs/hardeningContract/properties/C12/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key19 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err314];
                } else {
                  vErrors.push(err314);
                }
                errors++;
              }
            }
            if (data127.report_tracks !== void 0) {
              if (!func0(data127.report_tracks, schema50.properties.C12.properties.report_tracks.const)) {
                const err315 = { instancePath: instancePath + "/hardening_contract/C12/report_tracks", schemaPath: "#/$defs/hardeningContract/properties/C12/properties/report_tracks/const", keyword: "const", params: { allowedValue: schema50.properties.C12.properties.report_tracks.const }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err315];
                } else {
                  vErrors.push(err315);
                }
                errors++;
              }
            }
          } else {
            const err316 = { instancePath: instancePath + "/hardening_contract/C12", schemaPath: "#/$defs/hardeningContract/properties/C12/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err316];
            } else {
              vErrors.push(err316);
            }
            errors++;
          }
        }
        if (data91.C13 !== void 0) {
          let data129 = data91.C13;
          if (data129 && typeof data129 == "object" && !Array.isArray(data129)) {
            if (data129.research_supersession_required === void 0) {
              const err317 = { instancePath: instancePath + "/hardening_contract/C13", schemaPath: "#/$defs/hardeningContract/properties/C13/required", keyword: "required", params: { missingProperty: "research_supersession_required" }, message: "must have required property 'research_supersession_required'" };
              if (vErrors === null) {
                vErrors = [err317];
              } else {
                vErrors.push(err317);
              }
              errors++;
            }
            for (const key20 in data129) {
              if (!(key20 === "research_supersession_required")) {
                const err318 = { instancePath: instancePath + "/hardening_contract/C13", schemaPath: "#/$defs/hardeningContract/properties/C13/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key20 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err318];
                } else {
                  vErrors.push(err318);
                }
                errors++;
              }
            }
            if (data129.research_supersession_required !== void 0) {
              if (true !== data129.research_supersession_required) {
                const err319 = { instancePath: instancePath + "/hardening_contract/C13/research_supersession_required", schemaPath: "#/$defs/hardeningContract/properties/C13/properties/research_supersession_required/const", keyword: "const", params: { allowedValue: true }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err319];
                } else {
                  vErrors.push(err319);
                }
                errors++;
              }
            }
          } else {
            const err320 = { instancePath: instancePath + "/hardening_contract/C13", schemaPath: "#/$defs/hardeningContract/properties/C13/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err320];
            } else {
              vErrors.push(err320);
            }
            errors++;
          }
        }
        if (data91.C14 !== void 0) {
          let data131 = data91.C14;
          if (data131 && typeof data131 == "object" && !Array.isArray(data131)) {
            if (data131.runtime_skill_count === void 0) {
              const err321 = { instancePath: instancePath + "/hardening_contract/C14", schemaPath: "#/$defs/hardeningContract/properties/C14/required", keyword: "required", params: { missingProperty: "runtime_skill_count" }, message: "must have required property 'runtime_skill_count'" };
              if (vErrors === null) {
                vErrors = [err321];
              } else {
                vErrors.push(err321);
              }
              errors++;
            }
            if (data131.governance_meta_skill_is_runtime === void 0) {
              const err322 = { instancePath: instancePath + "/hardening_contract/C14", schemaPath: "#/$defs/hardeningContract/properties/C14/required", keyword: "required", params: { missingProperty: "governance_meta_skill_is_runtime" }, message: "must have required property 'governance_meta_skill_is_runtime'" };
              if (vErrors === null) {
                vErrors = [err322];
              } else {
                vErrors.push(err322);
              }
              errors++;
            }
            for (const key21 in data131) {
              if (!(key21 === "runtime_skill_count" || key21 === "governance_meta_skill_is_runtime")) {
                const err323 = { instancePath: instancePath + "/hardening_contract/C14", schemaPath: "#/$defs/hardeningContract/properties/C14/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key21 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err323];
                } else {
                  vErrors.push(err323);
                }
                errors++;
              }
            }
            if (data131.runtime_skill_count !== void 0) {
              if (8 !== data131.runtime_skill_count) {
                const err324 = { instancePath: instancePath + "/hardening_contract/C14/runtime_skill_count", schemaPath: "#/$defs/hardeningContract/properties/C14/properties/runtime_skill_count/const", keyword: "const", params: { allowedValue: 8 }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err324];
                } else {
                  vErrors.push(err324);
                }
                errors++;
              }
            }
            if (data131.governance_meta_skill_is_runtime !== void 0) {
              if (false !== data131.governance_meta_skill_is_runtime) {
                const err325 = { instancePath: instancePath + "/hardening_contract/C14/governance_meta_skill_is_runtime", schemaPath: "#/$defs/hardeningContract/properties/C14/properties/governance_meta_skill_is_runtime/const", keyword: "const", params: { allowedValue: false }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err325];
                } else {
                  vErrors.push(err325);
                }
                errors++;
              }
            }
          } else {
            const err326 = { instancePath: instancePath + "/hardening_contract/C14", schemaPath: "#/$defs/hardeningContract/properties/C14/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err326];
            } else {
              vErrors.push(err326);
            }
            errors++;
          }
        }
      } else {
        const err327 = { instancePath: instancePath + "/hardening_contract", schemaPath: "#/$defs/hardeningContract/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err327];
        } else {
          vErrors.push(err327);
        }
        errors++;
      }
    }
    if (data.structural_status !== void 0) {
      let data134 = data.structural_status;
      if (data134 && typeof data134 == "object" && !Array.isArray(data134)) {
        if (data134.state === void 0) {
          const err328 = { instancePath: instancePath + "/structural_status", schemaPath: "#/$defs/structuralStatus/required", keyword: "required", params: { missingProperty: "state" }, message: "must have required property 'state'" };
          if (vErrors === null) {
            vErrors = [err328];
          } else {
            vErrors.push(err328);
          }
          errors++;
        }
        for (const key22 in data134) {
          if (!(key22 === "state" || key22 === "counts" || key22 === "graph_hash")) {
            const err329 = { instancePath: instancePath + "/structural_status", schemaPath: "#/$defs/structuralStatus/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key22 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err329];
            } else {
              vErrors.push(err329);
            }
            errors++;
          }
        }
        if (data134.state !== void 0) {
          let data135 = data134.state;
          if (!(data135 === "pass" || data135 === "fail" || data135 === "debt" || data135 === "not_run")) {
            const err330 = { instancePath: instancePath + "/structural_status/state", schemaPath: "#/$defs/structuralStatus/properties/state/enum", keyword: "enum", params: { allowedValues: schema51.properties.state.enum }, message: "must be equal to one of the allowed values" };
            if (vErrors === null) {
              vErrors = [err330];
            } else {
              vErrors.push(err330);
            }
            errors++;
          }
        }
        if (data134.counts !== void 0) {
          let data136 = data134.counts;
          if (data136 && typeof data136 == "object" && !Array.isArray(data136)) {
            for (const key23 in data136) {
              let data137 = data136[key23];
              if (!(typeof data137 == "number" && (!(data137 % 1) && !isNaN(data137)))) {
                const err331 = { instancePath: instancePath + "/structural_status/counts/" + key23.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/$defs/structuralStatus/properties/counts/additionalProperties/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                if (vErrors === null) {
                  vErrors = [err331];
                } else {
                  vErrors.push(err331);
                }
                errors++;
              }
              if (typeof data137 == "number") {
                if (data137 < 0 || isNaN(data137)) {
                  const err332 = { instancePath: instancePath + "/structural_status/counts/" + key23.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/$defs/structuralStatus/properties/counts/additionalProperties/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
                  if (vErrors === null) {
                    vErrors = [err332];
                  } else {
                    vErrors.push(err332);
                  }
                  errors++;
                }
              }
            }
          } else {
            const err333 = { instancePath: instancePath + "/structural_status/counts", schemaPath: "#/$defs/structuralStatus/properties/counts/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err333];
            } else {
              vErrors.push(err333);
            }
            errors++;
          }
        }
        if (data134.graph_hash !== void 0) {
          let data138 = data134.graph_hash;
          if (typeof data138 === "string") {
            if (!pattern4.test(data138)) {
              const err334 = { instancePath: instancePath + "/structural_status/graph_hash", schemaPath: "#/$defs/structuralStatus/properties/graph_hash/pattern", keyword: "pattern", params: { pattern: "^[a-f0-9]{64}$" }, message: 'must match pattern "^[a-f0-9]{64}$"' };
              if (vErrors === null) {
                vErrors = [err334];
              } else {
                vErrors.push(err334);
              }
              errors++;
            }
          } else {
            const err335 = { instancePath: instancePath + "/structural_status/graph_hash", schemaPath: "#/$defs/structuralStatus/properties/graph_hash/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err335];
            } else {
              vErrors.push(err335);
            }
            errors++;
          }
        }
      } else {
        const err336 = { instancePath: instancePath + "/structural_status", schemaPath: "#/$defs/structuralStatus/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err336];
        } else {
          vErrors.push(err336);
        }
        errors++;
      }
    }
    if (data.behavioral_evidence_status !== void 0) {
      if (!validate23(data.behavioral_evidence_status, { instancePath: instancePath + "/behavioral_evidence_status", parentData: data, parentDataProperty: "behavioral_evidence_status", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate23.errors : vErrors.concat(validate23.errors);
        errors = vErrors.length;
      }
    }
    if (data.improvement_claim !== void 0) {
      let data140 = data.improvement_claim;
      if (typeof data140 === "string") {
        if (func1(data140) < 1) {
          const err337 = { instancePath: instancePath + "/improvement_claim", schemaPath: "#/properties/improvement_claim/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err337];
          } else {
            vErrors.push(err337);
          }
          errors++;
        }
      } else {
        const err338 = { instancePath: instancePath + "/improvement_claim", schemaPath: "#/properties/improvement_claim/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err338];
        } else {
          vErrors.push(err338);
        }
        errors++;
      }
    }
    if (data.action !== void 0) {
      let data141 = data.action;
      if (!(data141 === "begin" || data141 === "validate" || data141 === "apply")) {
        const err339 = { instancePath: instancePath + "/action", schemaPath: "#/properties/action/enum", keyword: "enum", params: { allowedValues: schema31.properties.action.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err339];
        } else {
          vErrors.push(err339);
        }
        errors++;
      }
    }
    if (data.workspace !== void 0) {
      let data142 = data.workspace;
      if (typeof data142 === "string") {
        if (func1(data142) < 1) {
          const err340 = { instancePath: instancePath + "/workspace", schemaPath: "#/$defs/repoPath/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err340];
          } else {
            vErrors.push(err340);
          }
          errors++;
        }
        if (!pattern5.test(data142)) {
          const err341 = { instancePath: instancePath + "/workspace", schemaPath: "#/$defs/repoPath/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9._<>/-]+$" }, message: 'must match pattern "^[A-Za-z0-9._<>/-]+$"' };
          if (vErrors === null) {
            vErrors = [err341];
          } else {
            vErrors.push(err341);
          }
          errors++;
        }
      } else {
        const err342 = { instancePath: instancePath + "/workspace", schemaPath: "#/$defs/repoPath/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err342];
        } else {
          vErrors.push(err342);
        }
        errors++;
      }
    }
    if (data.ledger_path !== void 0) {
      let data143 = data.ledger_path;
      if (typeof data143 === "string") {
        if (func1(data143) < 1) {
          const err343 = { instancePath: instancePath + "/ledger_path", schemaPath: "#/$defs/repoPath/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err343];
          } else {
            vErrors.push(err343);
          }
          errors++;
        }
        if (!pattern5.test(data143)) {
          const err344 = { instancePath: instancePath + "/ledger_path", schemaPath: "#/$defs/repoPath/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9._<>/-]+$" }, message: 'must match pattern "^[A-Za-z0-9._<>/-]+$"' };
          if (vErrors === null) {
            vErrors = [err344];
          } else {
            vErrors.push(err344);
          }
          errors++;
        }
      } else {
        const err345 = { instancePath: instancePath + "/ledger_path", schemaPath: "#/$defs/repoPath/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err345];
        } else {
          vErrors.push(err345);
        }
        errors++;
      }
    }
    if (data.result_graph_sha256 !== void 0) {
      let data144 = data.result_graph_sha256;
      if (typeof data144 === "string") {
        if (!pattern4.test(data144)) {
          const err346 = { instancePath: instancePath + "/result_graph_sha256", schemaPath: "#/properties/result_graph_sha256/pattern", keyword: "pattern", params: { pattern: "^[a-f0-9]{64}$" }, message: 'must match pattern "^[a-f0-9]{64}$"' };
          if (vErrors === null) {
            vErrors = [err346];
          } else {
            vErrors.push(err346);
          }
          errors++;
        }
      } else {
        const err347 = { instancePath: instancePath + "/result_graph_sha256", schemaPath: "#/properties/result_graph_sha256/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err347];
        } else {
          vErrors.push(err347);
        }
        errors++;
      }
    }
    if (data.validation !== void 0) {
      let data145 = data.validation;
      if (!(data145 && typeof data145 == "object" && !Array.isArray(data145))) {
        const err348 = { instancePath: instancePath + "/validation", schemaPath: "#/properties/validation/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err348];
        } else {
          vErrors.push(err348);
        }
        errors++;
      }
    }
    if (data.diagnostics !== void 0) {
      let data146 = data.diagnostics;
      if (Array.isArray(data146)) {
        const len8 = data146.length;
        for (let i13 = 0; i13 < len8; i13++) {
          let data147 = data146[i13];
          if (data147 && typeof data147 == "object" && !Array.isArray(data147)) {
            if (data147.severity === void 0) {
              const err349 = { instancePath: instancePath + "/diagnostics/" + i13, schemaPath: "#/$defs/diagnostic/required", keyword: "required", params: { missingProperty: "severity" }, message: "must have required property 'severity'" };
              if (vErrors === null) {
                vErrors = [err349];
              } else {
                vErrors.push(err349);
              }
              errors++;
            }
            if (data147.code === void 0) {
              const err350 = { instancePath: instancePath + "/diagnostics/" + i13, schemaPath: "#/$defs/diagnostic/required", keyword: "required", params: { missingProperty: "code" }, message: "must have required property 'code'" };
              if (vErrors === null) {
                vErrors = [err350];
              } else {
                vErrors.push(err350);
              }
              errors++;
            }
            if (data147.message === void 0) {
              const err351 = { instancePath: instancePath + "/diagnostics/" + i13, schemaPath: "#/$defs/diagnostic/required", keyword: "required", params: { missingProperty: "message" }, message: "must have required property 'message'" };
              if (vErrors === null) {
                vErrors = [err351];
              } else {
                vErrors.push(err351);
              }
              errors++;
            }
            if (data147.location === void 0) {
              const err352 = { instancePath: instancePath + "/diagnostics/" + i13, schemaPath: "#/$defs/diagnostic/required", keyword: "required", params: { missingProperty: "location" }, message: "must have required property 'location'" };
              if (vErrors === null) {
                vErrors = [err352];
              } else {
                vErrors.push(err352);
              }
              errors++;
            }
            if (data147.witness === void 0) {
              const err353 = { instancePath: instancePath + "/diagnostics/" + i13, schemaPath: "#/$defs/diagnostic/required", keyword: "required", params: { missingProperty: "witness" }, message: "must have required property 'witness'" };
              if (vErrors === null) {
                vErrors = [err353];
              } else {
                vErrors.push(err353);
              }
              errors++;
            }
            if (data147.remediation === void 0) {
              const err354 = { instancePath: instancePath + "/diagnostics/" + i13, schemaPath: "#/$defs/diagnostic/required", keyword: "required", params: { missingProperty: "remediation" }, message: "must have required property 'remediation'" };
              if (vErrors === null) {
                vErrors = [err354];
              } else {
                vErrors.push(err354);
              }
              errors++;
            }
            for (const key24 in data147) {
              if (!(key24 === "severity" || key24 === "code" || key24 === "message" || key24 === "location" || key24 === "witness" || key24 === "remediation")) {
                const err355 = { instancePath: instancePath + "/diagnostics/" + i13, schemaPath: "#/$defs/diagnostic/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key24 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err355];
                } else {
                  vErrors.push(err355);
                }
                errors++;
              }
            }
            if (data147.severity !== void 0) {
              let data148 = data147.severity;
              if (!(data148 === "error" || data148 === "warning" || data148 === "debt" || data148 === "info")) {
                const err356 = { instancePath: instancePath + "/diagnostics/" + i13 + "/severity", schemaPath: "#/$defs/diagnostic/properties/severity/enum", keyword: "enum", params: { allowedValues: schema56.properties.severity.enum }, message: "must be equal to one of the allowed values" };
                if (vErrors === null) {
                  vErrors = [err356];
                } else {
                  vErrors.push(err356);
                }
                errors++;
              }
            }
            if (data147.code !== void 0) {
              let data149 = data147.code;
              if (typeof data149 === "string") {
                if (!pattern17.test(data149)) {
                  const err357 = { instancePath: instancePath + "/diagnostics/" + i13 + "/code", schemaPath: "#/$defs/diagnostic/properties/code/pattern", keyword: "pattern", params: { pattern: "^SKG-[A-Z0-9-]+$" }, message: 'must match pattern "^SKG-[A-Z0-9-]+$"' };
                  if (vErrors === null) {
                    vErrors = [err357];
                  } else {
                    vErrors.push(err357);
                  }
                  errors++;
                }
              } else {
                const err358 = { instancePath: instancePath + "/diagnostics/" + i13 + "/code", schemaPath: "#/$defs/diagnostic/properties/code/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err358];
                } else {
                  vErrors.push(err358);
                }
                errors++;
              }
            }
            if (data147.message !== void 0) {
              let data150 = data147.message;
              if (typeof data150 === "string") {
                if (func1(data150) < 1) {
                  const err359 = { instancePath: instancePath + "/diagnostics/" + i13 + "/message", schemaPath: "#/$defs/diagnostic/properties/message/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err359];
                  } else {
                    vErrors.push(err359);
                  }
                  errors++;
                }
              } else {
                const err360 = { instancePath: instancePath + "/diagnostics/" + i13 + "/message", schemaPath: "#/$defs/diagnostic/properties/message/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err360];
                } else {
                  vErrors.push(err360);
                }
                errors++;
              }
            }
            if (data147.location !== void 0) {
              let data151 = data147.location;
              if (typeof data151 === "string") {
                if (func1(data151) < 1) {
                  const err361 = { instancePath: instancePath + "/diagnostics/" + i13 + "/location", schemaPath: "#/$defs/diagnostic/properties/location/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err361];
                  } else {
                    vErrors.push(err361);
                  }
                  errors++;
                }
              } else {
                const err362 = { instancePath: instancePath + "/diagnostics/" + i13 + "/location", schemaPath: "#/$defs/diagnostic/properties/location/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err362];
                } else {
                  vErrors.push(err362);
                }
                errors++;
              }
            }
            if (data147.witness !== void 0) {
              let data152 = data147.witness;
              if (!(data152 && typeof data152 == "object" && !Array.isArray(data152))) {
                const err363 = { instancePath: instancePath + "/diagnostics/" + i13 + "/witness", schemaPath: "#/$defs/diagnostic/properties/witness/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err363];
                } else {
                  vErrors.push(err363);
                }
                errors++;
              }
            }
            if (data147.remediation !== void 0) {
              let data153 = data147.remediation;
              if (typeof data153 === "string") {
                if (func1(data153) < 1) {
                  const err364 = { instancePath: instancePath + "/diagnostics/" + i13 + "/remediation", schemaPath: "#/$defs/diagnostic/properties/remediation/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err364];
                  } else {
                    vErrors.push(err364);
                  }
                  errors++;
                }
              } else {
                const err365 = { instancePath: instancePath + "/diagnostics/" + i13 + "/remediation", schemaPath: "#/$defs/diagnostic/properties/remediation/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err365];
                } else {
                  vErrors.push(err365);
                }
                errors++;
              }
            }
          } else {
            const err366 = { instancePath: instancePath + "/diagnostics/" + i13, schemaPath: "#/$defs/diagnostic/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err366];
            } else {
              vErrors.push(err366);
            }
            errors++;
          }
        }
      } else {
        const err367 = { instancePath: instancePath + "/diagnostics", schemaPath: "#/properties/diagnostics/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err367];
        } else {
          vErrors.push(err367);
        }
        errors++;
      }
    }
    if (props0 !== true) {
      for (const key25 in data) {
        if (!props0 || !props0[key25]) {
          const err368 = { instancePath, schemaPath: "#/unevaluatedProperties", keyword: "unevaluatedProperties", params: { unevaluatedProperty: key25 }, message: "must NOT have unevaluated properties" };
          if (vErrors === null) {
            vErrors = [err368];
          } else {
            vErrors.push(err368);
          }
          errors++;
        }
      }
    }
  } else {
    const err369 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err369];
    } else {
      vErrors.push(err369);
    }
    errors++;
  }
  validate20.errors = vErrors;
  return errors === 0;
}
validate20.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
