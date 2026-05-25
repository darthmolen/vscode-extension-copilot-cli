# Fix: Windows CMD Window Popping on Session Start

## Problem Statement

On Windows, every time a Copilot CLI session starts, a `cmd.exe` console window appears. If the user closes it, the session dies. This started after we bundled the CLI.

## Root Cause

**The bug chain:**

1. `CliBundleService` sets `cliPath = path/to/@github/copilot/npm-loader.js`
2. The SDK spawns `node npm-loader.js --stdio` with `windowsHide: true` ✅ (no window)
3. `npm-loader.js` (third-party, minified, unmodifiable) calls:
   ```js
   spawnSync(nativeBinary, process.argv.slice(2), { stdio: 'inherit' })
   //                                               ↑ NO windowsHide: true ❌
   ```
4. The native binary (`@github/copilot-win32-x64`) is spawned **without `CREATE_NO_WINDOW`** → CMD window appears.

**Secondary CMD windows** (version checks, npm install):
- `defaultRunNpmInstall` uses `spawn('npm', ..., { shell: true })` on Windows — no `windowsHide: true`
- `execFileSync(cliPath, ['--version'])` in `sdkSessionManager.ts` — no `windowsHide: true`
- `execFileSync(cmd, ['copilot'])` (`where copilot`) in `sdkSessionManager.ts` — no `windowsHide: true`
- `execFileSync('where', ['copilot'])` in `cliBundleService.ts` — no `windowsHide: true`

## Solution

### Primary Fix: Use `index.js` instead of `npm-loader.js` on Windows

`@github/copilot/index.js` is the pure Node.js entrypoint. The SDK spawns it as `node index.js --stdio` with `windowsHide: true` — no secondary spawn, no CMD window.

`npm-loader.js` exists solely to prefer a native binary for performance. On Windows that native binary spawning is the bug. Using `index.js` avoids it entirely. Both files are valid CLI entrypoints; the SDK comment explicitly notes "Uses index.js directly rather than npm-loader.js (which spawns the native binary)."

### Secondary Fix: Add `windowsHide: true` everywhere

Add `windowsHide: true` to all remaining `spawn`/`execFileSync`/`spawnSync` calls in our code.

## Files to Change

### 1. `src/extension/services/cliBundleService.ts`

**a) `checkLocalNodeModules()`** — change cliPath for Windows:
```typescript
// Before:
cliPath: path.join(cliPkgDir, 'npm-loader.js'),

// After:
cliPath: path.join(cliPkgDir, process.platform === 'win32' ? 'index.js' : 'npm-loader.js'),
```

**b) `checkManaged()`** — same change:
```typescript
// Before:
cliPath: path.join(cliPkgDir, 'npm-loader.js'),

// After:
cliPath: path.join(cliPkgDir, process.platform === 'win32' ? 'index.js' : 'npm-loader.js'),
```

**c) `defaultRunNpmInstall()`** — add `windowsHide`:
```typescript
spawn('npm', [...], {
    stdio: 'pipe',
    shell: process.platform === 'win32',
    windowsHide: true,   // ← ADD
})
```

**d) `defaultProbeSystemCli()`** — add `windowsHide` to both execFileSync calls:
```typescript
execFileSync(which, ['copilot'], { encoding: 'utf-8', timeout: 5000, windowsHide: true })
execFileSync(cliPath, ['--version', '--no-auto-update'], { encoding: 'utf-8', timeout: 5000, windowsHide: true })
```

### 2. `src/sdkSessionManager.ts`

**a) `resolveCliPath()`** (`where copilot`):
```typescript
execFileSync(cmd, ['copilot'], { encoding: 'utf-8', timeout: 5000, windowsHide: true })
```

**b) `logCliVersion()`** — both exec calls:
```typescript
execFileSync(cliPath, ['--version', '--no-auto-update'], { encoding: 'utf-8', timeout: 5000, windowsHide: true })
execFileSync(cliPath, ['--version'], { encoding: 'utf-8', timeout: 5000, windowsHide: true })
```

## Testing Strategy

- Build and install VSIX on Windows
- Open VS Code, start a new session — verify no CMD window appears
- The session should stay alive without issue
- Verify version logging still works (logs in Output Channel)
- Trigger a first-install scenario (or check managed install path) — verify no CMD window during npm install

## Version Bump

Patch release (bug fix, no new features): `3.8.x → 3.8.1` (or whatever is next).

---

## Plan Review

**Reviewed:** 2026-05-24 (intake skill)
**Reviewer:** Claude Code (plan-review-intake)

### Strengths

- **Root cause analysis is excellent.** The plan correctly identifies the bug chain — SDK spawns `node npm-loader.js` with `windowsHide:true`, but `npm-loader.js` internally calls `spawnSync(nativeBinary, …, {stdio:"inherit"})` without `windowsHide`. The minified `npm-loader.js` source matches the plan's claim exactly.
- **The primary fix is SDK-aligned.** The SDK source itself (`research/copilot-sdk/nodejs/src/client.ts:160`) carries the comment *"Uses index.js directly rather than npm-loader.js (which spawns the native binary)"* — the SDK team already endorses this exact strategy for its own bundled-CLI path. Plan effectively mirrors that.
- **All file paths and line targets exist.** Verified every referenced call site:
  - `cliBundleService.ts:101` (`checkManaged`), `:173` (`checkLocalNodeModules`), `:187` (`spawn('npm', …)`), `:207`/`:212` (`defaultProbeSystemCli`)
  - `sdkSessionManager.ts:154` (`resolveCliPath`), `:463`/`:468` (`logCliVersion`)
- **Defense-in-depth.** Even after the primary fix removes the popup-causing path, plan still adds `windowsHide:true` to every remaining `execFileSync`/`spawn` — that's the right call because version probes and `where copilot` are independent popup vectors.
- **Versioning correctly classified** as patch per CLAUDE.md (no new features, no API surface).

### Issues

#### Critical (Must Address Before Implementation)

None. The fix is architecturally sound, the API surface exists, and the change is minimal and localized.

#### Important (Should Address)

1. **No TDD / verification artifact for the primary behavioral claim.** Section: "Testing Strategy".
   - CLAUDE.md mandates strict TDD: *"Tests must import production code, not mocks. A test that passes immediately without failing first is not valid."* The plan's verification is entirely manual ("build VSIX on Windows, observe no CMD window"). Add a unit test for `cliBundleService.checkLocalNodeModules()` / `checkManaged()` that asserts the returned `cliPath` ends with `index.js` on Windows (`process.platform === 'win32'` mock) and `npm-loader.js` otherwise.
   - Suggested fix: add a task *"Add tests in `tests/unit/extension/cliBundleService.test.*` covering platform-conditional cliPath selection"* before the implementation tasks.

2. **No Linux/WSL regression verification step.** Section: "Testing Strategy".
   - This developer works on Linux/WSL. The plan only describes Windows manual verification. Add an explicit step: *"Run `npm test` and `npm run compile` on Linux — confirm no regressions in CLI bundle resolution path (should still pick `npm-loader.js` on non-Windows)."*
   - Why it matters: Linux path must remain `npm-loader.js`. If anyone later refactors `checkLocal/checkManaged` they need a test guarding both branches.

3. **Missing edge case: does `index.js` accept the same args the SDK passes?** Section: "Solution → Primary Fix".
   - Plan asserts both files are equivalent entrypoints. The SDK invocation (`client.ts:1588`): `spawn(node, [cliPath, ...args])` where `args` includes `--stdio` (and possibly others). `npm-loader.js` forwards `process.argv.slice(2)` to the native binary; `index.js` must accept the same CLI flags. Add a one-line verification: *"Confirm `node node_modules/@github/copilot/index.js --version --no-auto-update` returns sensible output before/after"* — useful for both `logCliVersion()` and to prove flag parity.

4. **`defaultProbeSystemCli` change has an unaddressed consequence.** Section: Files to Change 1(d).
   - Plan adds `windowsHide:true` to `execFileSync(cliPath, ['--version', …])` — but `cliPath` here is the user's *system* `copilot`, which on Windows is the npm wrapper. For the system case there's no `index.js` swap available — this exec will still briefly spawn a child. `windowsHide:true` on the parent suppresses the *parent's* console; whether it cascades to the grandchild spawn inside `npm-loader.js` is not guaranteed.
   - Suggested fix: acknowledge *"system CLI path still has a residual popup risk during version probing because the wrapper re-spawns; rare (only triggered when local/managed both miss) and out of scope."*

#### Minor (Consider)

1. **Plan doesn't mention build/CI impact.** No changes to `esbuild.js` are needed (consistent with CLAUDE.md's webview-build caveat), but a single line stating *"No esbuild.js changes — this is server-side TypeScript only"* would forestall the question.

2. **Version bump line is hedged** (*"3.8.x → 3.8.1 (or whatever is next)"*). Last commit was `v3.8.0`, so bump to `3.8.1`. Also remind to update `CHANGELOG.md` and `package.json`.

3. **No mention of updating tests that may currently hardcode `npm-loader.js`.** Grep `npm-loader` in `tests/` would be a 5-second check that should be a task line.

### Recommendations

- Reorder into explicit numbered tasks. "Files to Change" 1a–1d, 2a–2b are effectively six tasks but aren't framed that way. Each task should be: *file*, *change*, *test*, *verify*. This helps the executing agent in `superpowers:executing-plans`.
- Add a final task: *"Run `npm test`, `npm run compile`, `npm run lint`"* with expected outcomes (full pass minus the known `main.js size constraint` baseline failure).
- Consider that `defaultRunNpmInstall` uses `shell: true` on Windows, which spawns `cmd.exe` and can flash even with `windowsHide:true`. Worth a brief note.

### Assessment

**Implementable as written?** With fixes.

**Reasoning:** The root cause is correctly diagnosed (verified against the minified `npm-loader.js` source) and the chosen fix mirrors what the SDK already does for its bundled-CLI resolution. The plan needs (a) a unit test for the platform-conditional cliPath swap to satisfy this project's TDD requirement, (b) a Linux/WSL regression-verification step since the developer cannot observe the Windows-only symptom locally, and (c) a brief acknowledgment that the system-CLI fallback path retains residual popup risk. Those are tightening, not rework.
