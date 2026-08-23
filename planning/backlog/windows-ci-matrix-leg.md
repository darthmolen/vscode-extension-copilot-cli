# CI has no Windows leg, and this project keeps shipping Windows bugs

**Found:** 2026-08-17, while checking whether ACP test fixtures were portable
**Size:** small (a `strategy.matrix` addition) · **Priority:** medium, rising with IN-3

## The gap

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs `runs-on: ubuntu-latest` and
nothing else. Type-check, lint and bundle are verified on Linux only. Nothing automated has ever
executed this codebase on Windows.

## Why that matters here specifically

This is not a theoretical portability worry — **the repo has a history of Windows-only defects, all
found by a human hitting them rather than by CI:**

| Release | What broke |
| --- | --- |
| v3.8.1 | "Windows CLI bundling hardened (popup fix, hybrid spawn, latest-stable install)" |
| — | `ensureNodeExecPath` / `findSystemNodeRuntime`, added because Electron's Node and system Node disagree on argv. The code comment calls it "the Windows argv bug this PR fixes." |
| v3.2.x era | "Fix CLI not found on Windows (winget installs)" (#23) |

The common thread is **process spawning and path resolution**, which is exactly the surface that
diverges between platforms — and exactly what `CliBundleService`, `buildCliSpawnCommand` and
`resolveCliPath` do.

**IN-3 raises the stakes.** The ACP agent is a *separate process* with its own argv, its own stdio
framing and its own working-directory handling. Every historical Windows failure in this repo lives
in that neighbourhood.

## What triggered the find

The ACP tests used `/tmp/...` literals. They turned out to be harmless — verified by swapping every
literal for `C:\Users\dev\...`, which left all six composition tests green, because nothing in the
ACP chain performs path operations. Fixed to `os.tmpdir()` anyway, since they only passed by
accident of the code not touching them yet.

But chasing that surfaced the real issue: **had they been genuinely broken, nothing would have told
us.**

## Proposal

Add a matrix leg. Keep it narrow at first:

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, windows-latest]
runs-on: ${{ matrix.os }}
```

**Start with `check-types` + `lint` + `node esbuild.js` only — not the full suite.** The suite is
flaky enough on Linux (see
[test-suite-flake-cross-file-global-pollution.md](test-suite-flake-cross-file-global-pollution.md))
that adding a second platform before that is fixed would produce noise nobody trusts, which is worse
than no signal.

Then consider, in order:

1. **The unit tests only** (`npm run test:unit`), once the flake is understood — most of the
   platform-sensitive logic (`cliPathResolution`, `copilotClientOptions`, `SessionService`) has unit
   coverage.
2. **A smoke test that actually spawns the CLI**, which is where every historical failure actually
   lived. This is the highest-value leg and the hardest to make reliable.

## Caveat worth stating

A green Windows type-check would **not** have caught any of the three defects above — they were all
runtime spawn/path behaviour. So this is a floor, not a fix. The honest framing: it makes Windows a
platform we *test*, rather than one we *react to*, and gives somewhere for the spawn smoke test to
live later.
