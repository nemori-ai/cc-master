# @ccm/web-viewer

Vite + React + TypeScript frontend app for `ccm web-viewer`.

Build output is written to `dist/` with `base: "./"` so WV23 can serve it from a local static ccm service without absolute asset paths. The app consumes relative endpoints:

- `/boards.json`
- `/view-model.json`
- `/task.json`
- `/status-report.json`

When those endpoints are unavailable in standalone dev or preview, deterministic fixtures are used so the operational workspace can still be visually tested.
