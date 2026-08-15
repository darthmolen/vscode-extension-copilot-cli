# IN-5 — Collapse the duplicate CLI resolution

**Category:** c · **Difficulty:** Low · **Blocking:** no
**Status:** **deliberately deferred out of Phase 0.1**

## The duplication

Two independent CLI-resolution paths coexist:

| Path | Owner | Notes |
| --- | --- | --- |
| `CliBundleService.ensureBundled()` | `src/extension/services/cliBundleService.ts` | local → managed → system → lazy `npm install`. Already vscode-free via injected `ExtensionLike`/`LoggerLike`. Feeds `CliCapabilityService`. |
| `resolveCliPath()` | `src/sdkSessionManager.ts` | configured path → SDK platform binary → PATH lookup → throw |

`SDKSessionManager` does **not** consume `CliBundleService`'s result; it resolves
independently. `extension.ts` runs the bundle service and passes a `cliPath` in,
so in practice the injected value usually wins — but the fallback path is live
code that can diverge.

Related: `ensureNodeExecPath()` **mutates the global `process.execPath`** to work
around an Electron/Node argv bug on Windows. That behaves differently once the
SDK is spawned from a dedicated agent process rather than the extension host, so
it needs revisiting under IN-3 regardless.

## Why it was deferred

Phase 0.1 was executed unattended. CLI resolution is load-bearing for the
extension launching *at all*, carries platform-specific subtleties (Windows argv,
Node 24 requirement, native binary vs loader shim), and is **thinly covered by
tests** — the failure mode is "extension silently cannot start on someone else's
machine", which no unit test in this repo would catch.

That is a poor risk to take without someone watching. The decoupling work in
0.1 stands on its own and did not require this.

Evidence the divergence is real: the Phase 0.2 spike initially failed because it
guessed `node_modules/@github/copilot/index.js`, which does not exist — the
package ships only `npm-loader.js`, and the actual binary lives in
`@github/copilot-linux-x64/copilot`. Two resolution strategies, two different
answers.

## Scope when picked up

1. Make `SDKSessionManager` consume a resolved CLI descriptor rather than
   resolving one; `CliBundleService` becomes the single source of truth.
2. Fold `pickCliPath` / `findSystemNodeRuntime` behaviour into that one path.
3. Decide what `ensureNodeExecPath` means for an agent subprocess — mutating a
   global in a process we own is more defensible than in the extension host, but
   it should be explicit.
4. Tests across all three resolution sources (local / managed / system), which do
   not exist today.

## Verification

`./test-extension.sh`, then reload the window and confirm a session starts —
with someone watching, on both Linux and Windows if possible.
