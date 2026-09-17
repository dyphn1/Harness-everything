# Probe control experiment — `.mjs` vs `.js` plugin discovery (opencode 1.18.31)

Date: 2026-09-16
Host: opencode 1.18.31, macOS, Node v24.14.1
Sandbox: throwaway git repo with `.opencode/plugins/` and no other plugins.

## Method

A minimal probe plugin writes one line per lifecycle touch to
`/tmp/opencode-probe.log` (outside opencode's own logging, so host
permission-log lines cannot pollute the signal):

```js
import { appendFileSync } from "node:fs"
const MARK = "/tmp/opencode-probe.log"
const w = (m) => { try { appendFileSync(MARK, `${new Date().toISOString()} ${m}\n`) } catch {} }
w("factory-import")
export const ProbePlugin = async () => {
  w("factory-called")
  return {
    event: async ({ event }) => w(`event:${event.type}`),
    "tool.execute.before": async (input) => w(`before:${input.tool}`),
    "tool.execute.after": async (input) => w(`after:${input.tool}`),
  }
}
```

Run 1: probe saved as `.opencode/plugins/zz-probe.mjs`, log file removed first.
Run 2: identical probe saved as `.opencode/plugins/zz-probe.js`, log file
removed first. Both runs executed `opencode run "Reply PONG6"` in the same
sandbox (no tools were invoked in either probe session).

## Results

### Run 1 — `.mjs`

`/tmp/opencode-probe.log` did not exist after the run: no factory import, no
factory call, no hook ever fired. The plugin was **silently not loaded**.

### Run 2 — `.js`

`/tmp/opencode-probe.log` (verbatim, truncated to the interesting parts):

```
2026-09-16T15:38:48.487Z factory-import
2026-09-16T15:38:48.493Z factory-called
2026-09-16T15:38:48.549Z event:session.created
2026-09-16T15:38:52.098Z event:session.idle
```

…plus the full bus-event stream. Identical module source; the only
difference is the file extension. Note that the probe registered
`tool.execute.before/after` handlers, but no tool call ever occurred in
either probe run, so those handlers were never exercised. The probe
demonstrates plugin discovery and event wiring only.

## Root cause (upstream, opencode dev branch)

`packages/opencode/src/config/plugin.ts` (v1 loader) discovers local plugins
with:

```ts
Glob.scan("{plugin,plugins}/*.{ts,js}", { cwd: dir, ... })
```

Only `.ts` and `.js` children are scanned; `.mjs` is not matched. The public
plugin docs say "Place **JavaScript or TypeScript** files in the plugin
directory", which a `.mjs` reader can reasonably interpret as covered —
host behavior says otherwise.

## Upstream issue check (2026-09-16)

No existing anomalyco/opencode issue mentions `.mjs` plugin discovery
(searched issue titles/bodies). Related-but-different known issues:

- #41530 / #33390 — v2 does not discover plugin *directories* (same glob, directory gap)
- #33455 — plugins listed in the config `plugin` array silently not loaded since v1.17.0
- #20153 — `resolveExportPath` resolved bare `main` paths from CWD (fixed on dev)

## Conclusion for this repository

Installing `opencode-plugin/index.mjs` by copying it with a `.mjs` extension
(the documented installation command in `opencode-plugin/README.md`) results
in silent no-op on opencode 1.18.31. The enforcement chain documented in
`README.md` of this directory is only reachable when the file is named
`*.js` (or loaded via an explicit config/`plugin` entry). The
live-host evidence in the parent directory was obtained with the
`harness-enforcement.js` filename.
