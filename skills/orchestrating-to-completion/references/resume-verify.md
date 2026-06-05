# Resume + endpoint verification

Make resume cheap (O(changeset), not O(everything)) and make verification trustworthy
(endpoint-only, never agent self-report). This is lens 6 — "trust only endpoint verification;
outputs are accountable and resumable" — made operational.

Source: research report 3 (the Joiner loop-until-converged) + report 4 (content-addressable
cache / the end-to-end argument).

---

## 1. Content-hash resume — the build-system action key

Treat the dynamic workflow as an **incremental build engine**. Each node gets a
**content-hash** = `hash(spec + upstream outputs + key context)`, exactly Bazel's **action
key**.

- **Check the journal before running**: hash hit → the node is already done → **reuse the
  already-landed artifact** (commit / PR / output) and **skip**; miss → execute and write a
  journal entry (with the output ref).
- **Resume after compaction / interruption = O(changeset)**: only re-run nodes whose inputs
  changed or that never finished (Bazel incremental build).
- **Determinism guard** (handling AI non-determinism): what you cache is **not** "re-running
  yields the same bytes" — it is "an already-landed artifact that passed end-to-end
  verification". The verification step *is* the cache's validation. Once the artifact exists
  and passes the endpoint check, the node is done and is not re-run.

---

## 2. Dependency pinning / stale detection

- **Pin upstream**: each node binds the version / hash of the upstream artifacts it consumes
  (`dep_pins` on the board's flexible edges).
- **Stale → re-run**: when an upstream artifact changes, mark the dependent node `stale` and
  re-run it. This guards against a "coherent but wrong result built on a stale snapshot" — the
  node looks done but was computed against inputs that no longer hold.

---

## 3. Endpoint verification — the only reliable correctness point

The **end-to-end argument** (Saltzer-Reed-Clark, 1984): a function placed in a low layer is
often redundant relative to implementing it at the endpoint; the final guarantee of
correctness must live at the endpoint.

- **The orchestrator verifies independently** — it runs the gate itself **and reads the
  diff**. The low-layer agent's "all quality gates green" is an untrustworthy performance
  optimization (agent self-reports have been wrong repeatedly).
- **Gate-green is necessary, not sufficient** — passing the gate does not mean the change is
  correct; you still read the diff.
- **A null / empty review counts as NOT passed** — an empty or absent review is never silent
  approval. This is the silent-pass-through guard.

Verification is the validation step of the resume cache (§1): only an artifact that exists
**and** passes this endpoint check is treated as done.

---

## 4. Loop convergence — structured gate + fuse + dedup

When a node's execution graph depends on intermediate results not known in advance (branching),
loop until converged — the Joiner pattern:

- **Structured gate**: a structured two-way choice — `FinalResponse` (converged → finish) vs
  `Replan(feedback)` (carry a diagnosis of prior attempts + what to fix → recompile a new DAG →
  reschedule). The decision is by **type**, never by a fuzzy/empty judgement — this is the same
  structural defense as "a null review = not passed".
- **`Replan.feedback` is the key design** — not a blind retry, but a **diagnosis-bearing
  replan signal** (this is the impl → review → verify → amender inner loop: the verify gate ≈
  the Joiner, the amender feedback ≈ `Replan.feedback`).
- **max-rounds fuse** — every inner loop must have a fuse (until the round / call ceiling is
  hit). No loop runs unbounded.
- **dedup-against-seen** — track rejected items so a vetoed option does not reappear every
  round.
