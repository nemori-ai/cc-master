# Viewer Performance Fixture

This directory holds the first large-board baseline for viewer v2 performance work.

- The large-board fixture is deterministic and generated from `generate-large-board.mjs`.
- The fixture has 224 tasks, nested owner/child groups, a mixed status distribution, and six awaiting-user decision gates with `decision_package` payloads.
- `tests/content/viewer-performance-smoke.test.mjs` is the non-browser baseline smoke. It parses the board, validates it with the vendored `@ccm/engine` IIFE, exercises graph analysis paths, and fetches the fixture through the read-only viewer server board route.

Commands:

```bash
node examples/viewer-performance/generate-large-board.mjs --check
node --test tests/content/viewer-performance-smoke.test.mjs
```

Regenerate the fixture after intentional shape changes:

```bash
node examples/viewer-performance/generate-large-board.mjs --write
```

TODO(WV2): extend the smoke to cover the future view-model route after that route lands.
