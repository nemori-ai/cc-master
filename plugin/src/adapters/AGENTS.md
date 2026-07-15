# Origin adapters

`plugin/src/adapters/` contains host-native invocation mappings for cross-surface capabilities.
Each capability keeps per-host strategies under `<capability>/adapters/<host>/`; projection copies
only `mode: host_native` payloads into `plugin/dist/<host>/adapters/`.

Adapters may call host-native tools and normalize observations. They must not implement ccm route
selection, attempt transitions, board writes, account mutation, or task acceptance.
