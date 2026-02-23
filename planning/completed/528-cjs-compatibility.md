# PR: CJS Compatibility for @github/copilot-sdk

**Issue**: [copilot-sdk #528](https://github.com/github/copilot-sdk/issues/528)
**PR**: [copilot-sdk #546](https://github.com/github/copilot-sdk/pull/546)
**Status**: PR submitted, awaiting review
**Branch**: `darthmolen/copilot-sdk:fix/528-cjs-compatibility`

## Problem

`getBundledCliPath()` used `import.meta.resolve("@github/copilot/sdk")` which fails
in CJS contexts (VS Code extensions bundled with esbuild `format: "cjs"`).

Introduced by Steve Sanderson in PR #382 (Feb 6, "Bundling") — before that, the SDK
defaulted to `"copilot"` on PATH with no bundled binary resolution.

## What We Changed

### 1. `nodejs/src/client.ts` — `getBundledCliPath()`

Replaced `import.meta.resolve` with `createRequire` + module resolution path walking.

The `@github/copilot` package has strict ESM-only exports (`"./sdk": { "import": ... }`).
Neither `require.resolve("@github/copilot/sdk")` nor `require.resolve("@github/copilot/package.json")`
work — all subpaths are blocked. So we walk `require.resolve.paths()` and check with `existsSync`.

```typescript
const require = createRequire(import.meta.url ?? pathToFileURL(__filename).href);
const searchPaths = require.resolve.paths("@github/copilot") ?? [];
for (const base of searchPaths) {
    const candidate = join(base, "@github", "copilot", "index.js");
    if (existsSync(candidate)) return candidate;
}
```

### 2. `nodejs/esbuild-copilotsdk-nodejs.ts` — Dual build

- ESM: per-file output to `dist/esm/` (same as before, new path)
- CJS: single bundled file at `dist/cjs/index.cjs` (avoids `.cjs` cross-file require issues)

### 3. `nodejs/package.json` — Conditional exports

```json
"exports": {
  ".": {
    "import": { "types": "./dist/index.d.ts", "default": "./dist/esm/index.js" },
    "require": { "types": "./dist/index.d.ts", "default": "./dist/cjs/index.cjs" }
  }
}
```

`main` stays ESM (`./dist/esm/index.js`) to avoid pushback.

### 4. `nodejs/test/cjs-compat.test.ts` — 4 new tests

Runs CJS imports in a subprocess to get a genuine CJS context.

## Key Discoveries During Implementation

1. **Only one `import.meta` usage** in SDK source — `import.meta.resolve` in `getBundledCliPath()`. No `import.meta.dirname`.
2. **`@github/copilot` package blocks all CJS resolution** — strict `exports` with ESM-only conditions. Even `package.json` isn't exposed.
3. **esbuild CJS per-file output** generates `require("./client.js")` but files are `.cjs` — cross-file resolution fails. Bundling into a single `.cjs` file solves this.
4. **esbuild replaces `import.meta` with `{}`** in CJS mode — `import.meta.url` becomes `undefined`, handled by `??` fallback to `pathToFileURL(__filename).href`.

## Test Results

- Existing unit tests: 19/19 passing (3 CLI spawn failures pre-existing on main)
- New CJS tests: 4/4 passing
- Zero regressions
