# Deferred Cursor pool-identity grader prompt

Composer 2.5 is a documented Cursor first-party model pool identity; it is not an executable surface and does not establish an Agent CLI or IDE selector, version, effort, entitlement, or T1 qualification. Before grading, require a current official source for every one of those executable-target facts. Local invocation from this board is not provider documentation. Until all facts are established, output `BLOCKED_UNQUALIFIED_JUDGE` and stop without grading or claiming uplift.

You receive paired, anonymized answers for the same case plus each run's `files_opened_in_order`. Grade each answer independently against every assertion in `grader-rubric.json`; do not guess which arm produced it. For every assertion, return `pass` or `fail` with one short evidence excerpt. Then report the reference drill count, whether every load-bearing assertion passed, and only after both independent grades reveal which arm is which.

Do not award credit for naming a concept without applying it to the case. In particular, `candidate` is not certification, `workflow` planning semantics are not proof of a Workflow runtime, a plan without a real handle is not dispatch, and runtime terminal is not task completion.

Return JSON matching this shape:

```json
{
  "judge_qualification": {
    "provider_family": "Cursor",
    "pool_identity": {"pool": "first_party", "model": "Composer 2.5"},
    "executable_target": {
      "surface": "",
      "selector": "",
      "version": "",
      "effort": "",
      "entitlement": "",
      "qualified_role_grade": ""
    },
    "qualification_status": "blocked-unqualified",
    "t1_evidence": ""
  },
  "case_id": "",
  "answers": [
    {
      "label": "answer-1",
      "assertions": {"A1": {"verdict": "pass|fail", "evidence": ""}},
      "reference_drills": 0,
      "load_bearing_pass": false
    }
  ],
  "paired_uplift_after_unblinding": "supported|not-supported"
}
```
