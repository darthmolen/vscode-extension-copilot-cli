# PR Plan: CJS Compatibility for @github/copilot-sdk

**Issue**: [copilot-sdk #528](https://github.com/github/copilot-sdk/issues/528)
**Status**: Steve open to a PR
**Priority**: High — affects all VS Code extensions using esbuild/CJS bundles

## Problem

The SDK is ESM-only (`"type": "module"` in package.json, esbuild config `format: "esm"`).
`getBundledCliPath()` uses `import.meta.resolve("@github/copilot/sdk")` which throws
in CJS contexts (VS Code extensions bundled with esbuild `format: "cjs"`).

Our workaround: bypass `getBundledCliPath()` entirely and resolve the binary path ourselves
via `resolveCliPath()` in `sdkSessionManager.ts`. This works but couples us to internal
SDK directory structure (`node_modules/@github/copilot-linux-x64/copilot`).

## Root Cause

Four `import.meta` usages in the SDK source:

1. `src/client.ts` line ~121-128: `getBundledCliPath()` — uses `import.meta.resolve("@github/copilot/sdk")`
2. `src/client.ts` line ~136: `import.meta.dirname` — used for relative path resolution
3. `test/` files — not relevant for published package

The esbuild config (`esbuild.mjs`) outputs only ESM:
```js
format: "esm"
```

`package.json` exports map has no CJS entry:
```json
"exports": {
  ".": { "import": "./dist/index.js" }
}
```

## Proposed Changes

### 1. Add CJS build output

Modify `esbuild.mjs` to produce dual outputs:

```js
// ESM (existing)
{ format: "esm", outdir: "dist/esm", ... }

// CJS (new)
{ format: "cjs", outdir: "dist/cjs", ... }
```

### 2. Replace `import.meta.resolve` with portable alternative

In `getBundledCliPath()`, replace:
```typescript
// Before
const sdkPath = import.meta.resolve("@github/copilot/sdk");

// After
import { createRequire } from 'module';
function getBundledCliPath(): string {
    try {
        // ESM
        const sdkPath = import.meta.resolve("@github/copilot/sdk");
        return resolveBinaryFromSdkPath(sdkPath);
    } catch {
        // CJS fallback
        const require = createRequire(import.meta.url || __filename);
        const sdkPath = require.resolve("@github/copilot/sdk");
        return resolveBinaryFromSdkPath(sdkPath);
    }
}
```

Alternative (simpler, preferred): use `createRequire` unconditionally since it works in both ESM and CJS:
```typescript
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

function getBundledCliPath(): string {
    const sdkPath = require.resolve("@github/copilot/sdk");
    // ... rest of path resolution
}
```

### 3. Update package.json exports

Add conditional exports for CJS consumers:
```json
"exports": {
  ".": {
    "import": "./dist/esm/index.js",
    "require": "./dist/cjs/index.cjs"
  }
}
```

### 4. Replace `import.meta.dirname`

```typescript
// Before
import.meta.dirname

// After
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __dirname = typeof import.meta.dirname === 'string'
    ? import.meta.dirname
    : dirname(fileURLToPath(import.meta.url));
```

Or, for the CJS build, esbuild handles `__dirname` natively.

## Testing

1. Existing ESM tests should continue passing
2. Add a CJS integration test: `require("@github/copilot-sdk")` in a Node CJS script
3. Verify `getBundledCliPath()` resolves correctly in both ESM and CJS contexts
4. Test with a real esbuild CJS bundle (mimicking VS Code extension bundling)

## Files to Modify (in copilot-sdk repo)

| File | Change |
|------|--------|
| `esbuild.mjs` | Add CJS output format |
| `src/client.ts` | Replace `import.meta.resolve` with `createRequire` |
| `src/client.ts` | Replace `import.meta.dirname` with portable shim |
| `package.json` | Add `"require"` conditional export |
| `test/cjs-compat.test.cjs` | New: CJS import smoke test |

## Risks

- **Breaking existing ESM consumers**: Mitigated by keeping ESM as the default export. CJS is additive.
- **`createRequire` portability**: Part of Node `module` built-in, available since Node 12.2+. Safe.
- **esbuild version**: SDK uses esbuild already, dual output is well-supported.

## PR Strategy

1. Fork `github/copilot-sdk`
2. Branch from `main`
3. Make changes incrementally (esbuild first, then source, then exports)
4. Reference #528 in PR description
5. Include before/after evidence: `require("@github/copilot-sdk")` throws → works
