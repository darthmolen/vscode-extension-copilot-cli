# Bundling the Copilot CLI: Architecture & Lessons

> **TL;DR**: SDK 0.3.0 changed the JSON-RPC permission protocol and broke every tool call against CLI 1.0.5. We don't trust the user's global `copilot` install anymore — the extension owns its CLI version via lazy install into `globalStorage`, with the version pinned by the SDK's own `dependencies`/`peerDependencies` declaration. This document is the post-mortem and the runbook.

## What Broke (The Symptom)

After bumping `@github/copilot-sdk` from `^0.2.1` → `^0.3.0`, every tool call failed:

```text
[SDK Event] tool.execution_complete: { success: false,
  error: { message: "Unhandled permission result kind: [object Object]", code: "failure" } }
```

The error came from inside the CLI's permission switch. The SDK was sending a structured `PermissionDecision` object (`{ kind: "approve-once" }`) and the CLI was crashing because the shape didn't match what its switch statement expected.

## What Caused It (The Root)

Two facts collided:

1. **SDK 0.3.0** declares a dependency on `@github/copilot@^1.0.36-0`. The JSON-RPC protocol between SDK and CLI changed in that range — both sides must be in sync.
2. **The user's CLI was stuck at 1.0.5.** The Go launcher (`npm install -g @github/copilot`) auto-updates conservatively and was not promoting newer versions. CLI 1.0.5 didn't speak the new protocol.

Even though `node_modules/@github/copilot` locally installed 1.0.44 (matching the SDK), the **installed VSIX had `node_modules/**` stripped** by `.vscodeignore`, so the running extension had nothing to spawn except the system `copilot` binary on PATH — which was 1.0.5.

## Why Bundling, Not Reverting

Options considered:

| Approach | Outcome |
|----------|---------|
| Revert SDK to 0.2.1 | Hides the problem; SDK ↔ CLI version skew will bite us again on the next upgrade |
| Force `npm install -g @github/copilot@latest` from the extension | Modifies the user's global state without consent |
| Per-platform VSIX (Pylance model, `vsce --target`) | Correct but heavy: 3× CI builds, ~150MB per VSIX, marketplace per-platform publishing |
| **Lazy-install + `cliPath` override** ✅ | Single VSIX (~217KB), one-time ~150MB download into `globalStorage`, version pinned by the SDK |

The `@github/copilot` npm package is shaped for self-contained spawning (it has its own `npm-loader.js`). The SDK already accepts a `cliPath` parameter. The pieces were there; we just had to wire them.

## The Architecture

```text
                            ┌─────────────────────────────────────────────┐
                            │  Activation (extension.ts)                  │
                            │  ──────────────────────────────────────────│
                            │  initCliBundle() runs in background — does │
                            │  not block sidebar/webview rendering.       │
                            └────────────────┬────────────────────────────┘
                                             │
                                             ▼
                            ┌─────────────────────────────────────────────┐
                            │  CliBundleService.ensureBundled()           │
                            │                                             │
                            │  Resolution priority:                       │
                            │    1. local   — extensionPath/node_modules  │
                            │    2. managed — globalStorage/cli/<range>/  │
                            │    3. system  — `which copilot` (warn)      │
                            │    4. install — npm into managed location   │
                            │                                             │
                            │  Returns ResolvedCli {                      │
                            │    cliPath, cliVersion, source,             │
                            │    sdkPeerRange, satisfiesPeerDep           │
                            │  }                                          │
                            └────────────────┬────────────────────────────┘
                                             │
                            ┌────────────────┴────────────────┐
                            ▼                                 ▼
              ┌──────────────────────────┐      ┌─────────────────────────────┐
              │  CliCapabilityService    │      │  SDKSessionManager          │
              │  ─────────────────────── │      │  ─────────────────────────  │
              │  supportsMcpListRpc()    │      │  Constructor accepts the    │
              │  supportsMcpStatusEvents │      │  resolved cliPath as a 5th  │
              │  satisfiesSdkPeerDep     │      │  argument. Falls back to    │
              │  cliVersion / sourceLabel│      │  resolveCliPath() if absent.│
              └──────────────┬───────────┘      └─────────────────────────────┘
                             │
                             ▼
              ┌──────────────────────────────────────────┐
              │  ChatViewProvider                        │
              │  ───────────────────────────────────────│
              │  setCliCapability(cap)                   │
              │  setMcpListProvider(() => session.rpc.   │
              │                          mcp.list())     │
              │                                          │
              │  /mcp now tries live SDK RPC if          │
              │  supported, else falls back to config    │
              │  view with status='unknown'              │
              │                                          │
              │  /usage prints CLI version + verdict     │
              └──────────────────────────────────────────┘
```

## The Three Services

| File | Role |
|------|------|
| [src/extension/services/cliBundleService.ts](../src/extension/services/cliBundleService.ts) | Resolve / lazy-install / version-check the CLI. Concurrent install protection via in-flight Promise cache. |
| [src/extension/services/cliCapabilityService.ts](../src/extension/services/cliCapabilityService.ts) | Pure feature flags derived from the resolved CLI version. Single source of truth for "does feature X work on this CLI?" |
| [src/extension/services/cliBundleBootstrap.ts](../src/extension/services/cliBundleBootstrap.ts) | Glue: runs `ensureBundled()`, constructs the capability service, surfaces a warning toast on peer-dep mismatch. |

Supporting:

- [src/utilities/cliVersion.ts](../src/utilities/cliVersion.ts) — extracted `parseCliVersion` shared by both services.
- [src/extension/services/mcpStatusBuilder.ts](../src/extension/services/mcpStatusBuilder.ts) — pure functions that drive `/mcp` panel rendering, capability-aware.

## Resolution Priority (and Why Each Layer Exists)

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. LOCAL — extensionPath/node_modules/@github/copilot                       │
│                                                                             │
│ When it hits: F5 dev mode. We ran `npm install` so node_modules is here.    │
│ Why it's first: Zero download cost, exact dev/prod parity for testing.      │
└─────────────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. MANAGED — globalStorageUri/cli/<sanitized-peer-range>/node_modules/...   │
│                                                                             │
│ When it hits: VSIX install path after the first activation completes.       │
│ Why it's second: Survives extension upgrades (different peer-range = new    │
│ directory), survives launcher updates (we never look at ~/.copilot/pkg/).   │
└─────────────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. SYSTEM — `which copilot`                                                 │
│                                                                             │
│ When it hits: Last-resort fallback. We probe `--version` and check the      │
│ SDK peer-dep range. If it satisfies, we use it (with an info log). If not,  │
│ a warning toast tells the user; tools may fail.                             │
│ Why it exists: Graceful degradation. The user can override via              │
│ copilotCLI.cliPath if they have a known-good install elsewhere.             │
└─────────────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4. INSTALL — npm install --prefix <managed-dir> @github/copilot@<range>    │
│                                                                             │
│ When it hits: Nothing satisfied above. First-run on a fresh install.        │
│ UX: Wrapped in vscode.window.withProgress (~150MB download).                │
│ Concurrent safety: In-flight Promise cache prevents two windows from        │
│ racing the same install.                                                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

## The `.vscodeignore` Gotcha (and the Fix)

The first cut of the bundle service read the SDK peer-dep at runtime:

```ts
const sdkPkgPath = path.join(extensionPath, 'node_modules/@github/copilot-sdk/package.json');
const pkg = JSON.parse(fs.readFileSync(sdkPkgPath, 'utf-8'));
return pkg.dependencies['@github/copilot'];   // "^1.0.36-0"
```

This worked in F5 dev mode (where `node_modules` exists) but **threw `ENOENT` in the installed VSIX** because `.vscodeignore` strips `node_modules/**`. The bootstrap caught the error and continued without setting `resolvedCli`, which silently fell back to spawning the system PATH `copilot` (1.0.5) — exactly the broken state we were trying to fix.

**The fix: build-time injection via esbuild `define`.**

[esbuild.js](../esbuild.js) reads `node_modules/@github/copilot-sdk/package.json` at build time (when `node_modules` exists) and inlines the value as a constant in the bundled `extension.js`:

```js
// esbuild.js
const sdkPeerRange =
    sdkPkg.peerDependencies?.['@github/copilot'] ||
    sdkPkg.dependencies?.['@github/copilot'];

const extensionCtx = await esbuild.context({
    // ...
    define: {
        '__SDK_PEER_RANGE__': JSON.stringify(sdkPeerRange),
    },
});
```

```ts
// extension.ts
declare const __SDK_PEER_RANGE__: string | undefined;

const sdkPeerRange = typeof __SDK_PEER_RANGE__ !== 'undefined' ? __SDK_PEER_RANGE__ : undefined;
const bundle = new CliBundleService(/* … */, { sdkPeerRange });
```

`CliBundleService` uses the injected value if present and only falls back to filesystem reads if it isn't — keeping unit tests (which run un-bundled) working without change.

**Subtle catch on the same pass**: SDK 0.3.0's `package.json` puts `@github/copilot` in `dependencies`, not `peerDependencies` as we'd assumed. Both reads (build and runtime) now check `peerDependencies` first then fall back to `dependencies`.

## What the VSIX Ships (and Doesn't)

```text
copilot-cli-extension-3.8.0.vsix (217 KB, 49 files)
├── dist/
│   ├── extension.js             ← bundled, has __SDK_PEER_RANGE__ inlined
│   └── webview/...              ← copied per-file by esbuild.js
├── package.json
├── changelog.md
├── readme.md
└── images/

NOT shipped (intentionally):
├── node_modules/                ← stripped by .vscodeignore
├── src/                         ← source
└── tests/                       ← tests
```

The total VSIX stays tiny because `@github/copilot` (the actual CLI, ~180MB) is fetched on demand into `globalStorage`, not bundled into the VSIX.

## MCP Status Panel: The Same Problem, Different Symptom

While we were here, the same SDK ↔ CLI version mismatch made the `/mcp` panel show every server as 🟡 "configured" forever — because `session.mcp_servers_loaded` events only fire on CLI ≥ 1.0.36. CLI 1.0.5 just stayed silent.

The fix uses the same capability service:

- New status value `'unknown'` (rendered ⚪) for the older-CLI fallback case — distinct from yellow/configured.
- `/mcp` handler tries `session.rpc.mcp.list()` when `capability.supportsMcpListRpc()` returns true; on success, the panel reflects live SDK data.
- On older CLI, the config-only fallback path uses `'unknown'` instead of the misleading `'configured'`.

See [src/extension/services/mcpStatusBuilder.ts](../src/extension/services/mcpStatusBuilder.ts) for the pure functions and [tests/unit/extension/mcp-status-handler.test.js](../tests/unit/extension/mcp-status-handler.test.js) for the contract.

## Operational Runbook: Upgrading the SDK

When bumping `@github/copilot-sdk`:

1. `npm install @github/copilot-sdk@<new-version>`. npm will pull the matching `@github/copilot` into `node_modules` automatically.
2. Run the full test suite: `npm test` and `npm run check-types`.
3. Build & install the VSIX: `./test-extension.sh`.
4. Reload the VS Code window. Watch the Output Channel:
   - `[CLI Bundle] source=local version=X.Y.Z satisfies=true` — F5 dev path.
   - `[CLI Bundle] source=managed version=X.Y.Z satisfies=true` — VSIX path after first-run install.
   - `[CLI Bundle] source=system version=1.0.5 satisfies=false` — degraded path; the warning toast fires.
5. If the resolved CLI version moves, no other code change is needed — `__SDK_PEER_RANGE__` reflects the new range and managed installs land in a new `globalStorage/cli/<range>/` directory automatically.
6. If the SDK starts gating new features behind a CLI version, add a flag in [src/extension/services/cliCapabilityService.ts](../src/extension/services/cliCapabilityService.ts) and gate call sites on it.

## Lessons

| Lesson | What we did about it |
|--------|----------------------|
| Trusting a user's global toolchain that has its own auto-update logic is fragile. | Own the version in `globalStorage`, install via npm. |
| `.vscodeignore` interacts with runtime filesystem reads. Anything `package.json`-shaped you read in production must also exist in production. | esbuild `define` constants for build-time data; runtime reads only on paths the VSIX actually ships. |
| "It worked in F5" is not "it works in the VSIX." | Always verify in installed-VSIX mode: `./test-extension.sh` + reload + check Output Channel. |
| Pure functions are the easiest thing to test. | Status-building extracted into pure helpers (`buildMcpServerStatusList`, `mergeMcpListWithConfig`); the wiring inside `chatViewProvider.ts` is thin glue. |
| When SDK and a coupled binary are both proprietary and protocol-versioned, the SDK's `dependencies`/`peerDependencies` is the contract. | Use that range as the source of truth. Don't hardcode versions. |

## Related Files

| Path | Purpose |
|------|---------|
| [src/extension/services/cliBundleService.ts](../src/extension/services/cliBundleService.ts) | Resolution + lazy install |
| [src/extension/services/cliCapabilityService.ts](../src/extension/services/cliCapabilityService.ts) | Feature flags from CLI version |
| [src/extension/services/cliBundleBootstrap.ts](../src/extension/services/cliBundleBootstrap.ts) | Activation glue + warning toast |
| [src/extension/services/mcpStatusBuilder.ts](../src/extension/services/mcpStatusBuilder.ts) | Pure status-list builders |
| [src/utilities/cliVersion.ts](../src/utilities/cliVersion.ts) | Shared `parseCliVersion` |
| [src/extension.ts](../src/extension.ts) | `initCliBundle()` wiring |
| [src/sdkSessionManager.ts](../src/sdkSessionManager.ts) | Accepts injected `cliPath`; exposes `hasActiveSession()` and `listMcpServers()` |
| [esbuild.js](../esbuild.js) | `__SDK_PEER_RANGE__` define |
| [.vscodeignore](../.vscodeignore) | Excludes `node_modules` from VSIX (intentional) |
| [tests/unit/extension/cli-bundle-service.test.js](../tests/unit/extension/cli-bundle-service.test.js) | Resolution / install / VSIX-path tests |
| [tests/unit/extension/cli-capability-service.test.js](../tests/unit/extension/cli-capability-service.test.js) | Feature flag thresholds |
| [tests/unit/extension/mcp-status-handler.test.js](../tests/unit/extension/mcp-status-handler.test.js) | Status builder + live-merge tests |

## Diagnostic: How to Tell What Layer You're Hitting

Open the Copilot CLI Output Channel (`Ctrl+Shift+U` → "Copilot CLI"). On reload, exactly one of:

```text
[CLI Bundle] source=local version=1.0.44 satisfies=true peerRange=^1.0.36-0
[CLI Bundle] source=managed version=1.0.44 satisfies=true peerRange=^1.0.36-0
[CLI Bundle] source=system version=1.0.5 satisfies=false peerRange=^1.0.36-0
```

`/usage` shows the same diagnostic in-chat:

```text
## Copilot CLI
CLI version: **1.0.44** (local, satisfies ^1.0.36-0)
```

If you see `satisfies=false`, the warning toast fires and tools will likely fail with the original "Unhandled permission result kind" error — the system CLI is too old and our managed install hasn't completed.
