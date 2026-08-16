# Test suite flake — cross-file global pollution

**Status:** root cause characterised, **not fixed**. Two attempted fixes reverted or neutral.
**Investigated:** 2026-08-15 · **Priority:** high — this blocks trusting the suite, and two lanes are about to depend on it.

## The finding that matters most

**The suite fails on essentially every full run.** Measured baseline, six consecutive runs, no code
changes: **6/6 runs had 1–2 failures.** Earlier "1800 passing, 0 failing" runs — including the one
that gated the v3.12.0 release — were luck, not signal.

Anyone treating a single green run as proof is being misled. Re-run before believing either colour.

## Signature

Always the same shape, which is what makes it diagnosable:

- **Always a timeout**, never an assertion failure.
- **Victims rotate** between runs and across families: synchronous DOM `before each` hooks,
  async retry/backoff tests, session tests. Every one passes in isolation.
- **The machine is idle** — load average 0.13 on 32 cores while a test hangs. It is a hang, not
  slowness.
- **No uncaught exceptions and no unhandled rejections** (verified with a process-level probe).
- The clearest single observation: a `before` hook whose only wait is
  `await new Promise(r => setTimeout(r, 100))` took **37,920 ms**. That promise never resolved.

## Confirmed global-pollution mechanisms

Mocha runs ~1800 tests across ~90 files in **one process**, so anything left on `global` outlives the
file that set it. Four confirmed leaks:

1. **`requestAnimationFrame` is permanently disabled after the first component file.**
   `cleanupComponentDOM` sets `global.requestAnimationFrame = () => {}`
   ([jsdom-component-setup.js:108](../../tests/helpers/jsdom-component-setup.js#L108)) and never
   deletes it, while `createComponentDOM` only installs one `if (!global.requestAnimationFrame)`
   (:82). The guard sees the no-op as "already set", so every later file gets an rAF whose callbacks
   never fire.
2. **`Module.prototype.require` is patched and never restored by ~10 files** — including
   `custom-agents-sdk-wiring`, `cli-path-resolution`, `session-service`,
   `plan-mode-tools-service-di`. Each captures the previous patch as its "original", so the wrappers
   stack for the remainder of the process.
3. **`global.setTimeout` / `clearTimeout` are replaced by three files**
   (`MessageDisplay-typing-indicator`, `MessageDisplay-inactivity-flush`, `sdk-timeout`). They do
   restore, but each captures "the real one" fresh at `beforeEach`, so any ordering that nests two
   installs would restore a fake as real.
4. **Session integration tests mutated the developer's live `~/.copilot/session-state`** — 1263
   directories, 284 MB, concurrently written by the running extension. **Fixed** (see below).

## What was tried

| Attempt | Result |
| --- | --- |
| Make session tests hermetic (temp `os.homedir`) | **Kept.** Correct on its own merits — those tests went from scanning 1263 live session dirs to 110 ms, and no longer race a live writer. Effect on flake: neutral (6/6 → 5/6, within noise). |
| Install `requestAnimationFrame` unconditionally, fixing leak #1 | **Reverted — made it strictly worse: 10/10 runs failing, up to 6 failures each.** With a working rAF, callbacks that were previously silently dropped now fire into DOMs that have been torn down. The no-op was *masking* a deeper defect. |
| `mocha --parallel` (file-per-process isolation) | **Did not fix it.** 4/4 runs failed, one with 16 failures. So it is not purely cross-file leakage, or parallelism adds its own contention. |

**The reverted rAF fix is the most informative result.** It proves components schedule callbacks that
outlive their DOM, and that the suite currently depends on those callbacks being swallowed. Only
`MessageDisplay` has a `dispose()`, and **47 of 50 component test files never call it.**

## Why this needs a design decision, not another patch

Three attempts, each surfacing a different problem in a different place. That is the signature of an
architectural issue rather than a bug: the suite's correctness currently depends on a specific
interleaving of ~90 files sharing one mutable global environment.

Options worth weighing, cheapest first:

- **Dispose components in test teardown.** Addresses the defect the rAF revert exposed. Touches ~47
  files but is mechanical, and would let leak #1 be fixed afterwards.
- **A shared teardown helper that snapshots and restores the global environment** (`require`,
  timers, rAF, `os.homedir`) around every file. Fixes leaks 1–3 as a class rather than one at a time.
- **Split the suite by domain** (components / extension / integration) into separate mocha
  invocations. Weaker than `--parallel` in theory, but `--parallel` failing suggests contention
  worth understanding before scaling isolation up.

## Reproduction

```bash
# ~6/6 runs will show 1-2 failures, with a different victim each time
for i in $(seq 1 6); do
  npx mocha "tests/unit/**/*.test.js" "tests/integration/**/*.test.js" \
    --recursive --timeout 10000 2>&1 | grep -E "^\s+[0-9]+ (passing|failing)"
done
```

Any individual failing file passes alone — always verify in isolation before blaming a code change.
