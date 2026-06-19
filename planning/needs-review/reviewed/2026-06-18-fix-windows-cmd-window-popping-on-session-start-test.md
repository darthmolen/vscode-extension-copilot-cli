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

---

## Plan Review

**Reviewed:** 2026-06-18 18:03
**Reviewer:** Claude Code (plan-review-intake)

### Strengths

- **Root cause correctly identified** — npm-loader.js calls spawnSync without windowsHide, confirmed in minified source. The bug chain is accurate.
- **Solution is architecturally sound** — Using index.js on Windows bypasses the third-party spawn entirely. More robust than patching external behavior.
- **All referenced functions verified** — checkLocalNodeModules(), checkManaged(), defaultRunNpmInstall(), defaultProbeSystemCli(), resolveCliPath(), logCliVersion() all exist in the codebase.
- **index.js verified present** — @github/copilot package contains both index.js and npm-loader.js.

### Issues

#### Critical (Must Address Before Implementation)

**Plan's code changes target the wrong location**
- Section: Files to Change / cliBundleService.ts sections a and b
- What's wrong: The plan shows inline cliPath construction in checkLocalNodeModules() and checkManaged() like . But these functions don't construct cliPath directly — they call . The inline construction doesn't exist.
- Why it matters: An implementer following these instructions literally will search for code that doesn't exist.
- Fix: The correct target is  itself. Modify it to unconditionally return index.js on Windows, keeping the existing Node 24+ / native binary logic for other platforms.

**Plan introduces npm-loader.js which was never used**
- Section: Primary Fix / Files to Change
- What's wrong: Plan proposes using npm-loader.js on non-Windows platforms as the fallback. The existing code never uses npm-loader.js — it uses either index.js (Node 24+) or the native binary directly. npm-loader.js has the same windowless-spawn bug on all platforms; it just doesn't produce a visible window on Unix.
- Why it matters: The plan would regress non-Windows behavior by introducing a new code path that was deliberately avoided.
- Fix: Non-Windows should keep the existing logic (index.js when Node >= 24, else native binary). Only add the Windows-specific branch to force index.js unconditionally.

**Node version requirement for index.js is unverified**
- Section: Primary Fix
- What's wrong: The current code gates index.js on Node 24+. The plan proposes using index.js unconditionally on Windows. If index.js requires Node 24+, Windows users on Node < 24 will get a broken CLI with no fallback.
- Why it matters: Silent breakage for a subset of Windows users.
- Fix: Before implementing, verify whether index.js works on Node < 24. If not, the Windows fix needs a fallback: index.js when Node >= 24, else show a clear error or fall back to native binary despite the CMD window.

#### Important (Should Address)

**Native binary fallback strategy not addressed**
- Section: Primary Fix
- What's wrong: Current logic provides a fallback to native binary (copilot.exe on Windows) for users without Node 24+. The plan removes this for Windows without stating whether it's acceptable. Windows users without Node 24+ currently get a working CLI (with CMD window). Post-fix they may get a broken CLI.
- Fix: Explicitly state the Node version requirement and what happens for Windows users who don't meet it. If the extension already requires Node 24+ (verify via package.json engines field), this is a non-issue.

**pickCliPath() comments will be incorrect after the change**
- Section: Files to Change
- What's wrong: Lines 339–350 of cliBundleService.ts have detailed comments explaining the current index.js / native binary logic. They will need updating.
- Fix: Add task: "Update comments in pickCliPath() to reflect the new Windows-specific logic."

#### Minor (Consider)

**Version number in plan is stale**
- Section: Version Bump
- What's wrong: Plan says "3.8.x → 3.8.1" but current version is 3.11.0. Should be 3.11.0 → 3.11.1.
- Patch bump is correct per CLAUDE.md (bug fix, no new features).

**Testing strategy missing Node version edge case**
- Section: Testing Strategy
- Fix: Add: "Test on Windows with Node < 24 to verify CLI still launches (or produces a clear error) after the index.js change."

### Recommendations

1. Rewrite "Files to Change" section to target  directly with the correct conditional logic: return index.js on Windows unconditionally; keep existing Node 24+ / native binary logic for all other platforms.
2. Verify the Node version requirement for index.js before implementing.
3. Confirm the extension's minimum Node requirement (package.json engines field) to determine whether the fallback gap matters.
4. Update pickCliPath() comments as part of the change.

### Assessment

**Implementable as written?** No

**Reasoning:** The proposed code changes target nonexistent inline cliPath construction in checkLocalNodeModules()/checkManaged(), when the actual fix belongs in pickCliPath(). Additionally, the non-Windows fallback to npm-loader.js would regress a code path the project deliberately avoids. Root cause analysis is excellent — the implementation instructions need correction before work can begin.
