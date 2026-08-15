# Shared spine S1–S3, shipping as v3.12.0

## Context

The dual-stream work order serializes a shared spine before Lane A (v4.0 protocol) and Lane B
(chat-in-a-tab) can run in parallel. S0 landed with PR #40. This plan covers **S3a, S2 and S1** — the
two internal shared items first, then the user-facing fork change — and ships all three as a full
Marketplace release.

Ordering is deliberate: S3a and S2 are internal, touch no user-visible behaviour, and are independent
of the fork work. Landing them first means the fork change is the only risky thing in the release.

S4 (`CopilotClientProvider`) is explicitly **not** here. Its exploration showed six interleaved seams
in `start()` alone plus a live bug (`stop()` never resets `_lifecycleListenersAttached`, so lifecycle
listeners never re-attach after a stop/start cycle). It gets its own plan once these land.

**TDD throughout.** Every step below is RED → verify-the-failure → GREEN. Tests import compiled
`out/`, so `npm run compile-tests` precedes any test run.

### Two findings that change the plan

**The existing fork test cannot fail.** `tests/unit/extension/session-fork.test.js:75-78` calls
`this.skip()` when `typeof SessionService.forkSession !== 'function'`. Delete or rename that method
and all 8 tests **silently green-skip** rather than failing. That guard must go first — a test that
can't fail is worse than no test, and it would hide exactly the regression this work risks.

**The review's C4 fix names a function that doesn't exist.** It suggests `setSessionName`; the real
pair is `writeSessionName` (clobbering, `SessionService.ts:136`) and `ensureSessionName` (no-clobber,
`:144`). The fix uses `writeSessionName`.

## S3a — decouple `getActiveAgent` from global state

`hostBridge.ts:126-129` reaches into `getBackendState()` — the one host coupling left in the file
whose purpose is to have none, and Lane B's only reason to touch a Lane A file (review item I1).

- **RED:** `createVSCodeHostBridge(context, deps)` returns a bridge whose `getActiveAgent()` calls the
  injected provider; and the `hostBridge` module does not require `backendState`.
- **GREEN:** add an optional second parameter carrying `getActiveAgent`. `src/extension.ts` supplies
  it — it already holds `backendState` at `:57`.

## S2 — one sub-agent palette

Three copies of the same ten hex values: `extension.ts:41` (authoritative — `assignSubagentColor`
assigns per `agentId` and rides the color on the event payload at `:716`), `SubagentPanelService.ts:23`
and `SubagentDock.js:24`. The latter two are `d.color || PALETTE[...]` fallbacks that are dead in the
wired path, because `extension.ts:716` always assigns before dispatch.

The webview cannot import from `src/` — esbuild **copies** webview files rather than bundling them.
So a genuine single source of truth across all three would need a new webview directory and the
`esbuild.js` triple (dist-dir const, `mkdirSync`, `copyFileSync`) for a ten-element array. Not worth it.

- **RED:** a drift-guard test asserting the webview's `PALETTE` literal matches the shared TypeScript
  constant. Fails now — no shared constant exists.
- **GREEN:** extract `src/shared/subagentPalette.ts` (that directory is already TS and already imported
  by both extension-side files); import it in `extension.ts` and `SubagentPanelService.ts`. The webview
  keeps its literal, now guarded against drift and commented with the source of truth.

Leave the two fallbacks in place. They are unreachable today, but removing them changes behaviour for
a hypothetical un-colored start event, which is not this step's business.

## S1 — SDK-native fork (the v3.12.0 feature)

### Spike first

Per CLAUDE.md's SDK-first rule, `planning/spikes/session-fork-rpc/`. The API is already verified
present in installed SDK 1.0.5 — `fork: async (params) => connection.sendRequest("sessions.fork", params)`
at `dist/generated/rpc.js:379`, typed at `rpc.d.ts:14531` — so the spike proves three things the docs
can't, against the **bundled CLI 1.0.68**:

1. `sessions.fork` succeeds and returns `{ sessionId, name? }`
2. the `name` we pass actually lands on the new session
3. a fork is resumable while the parent is still live on the same client

Drop the "`toEventId` is exclusive" objective (review M6) — `rpc.d.ts:11384` documents it, and Slice 3
will verify it empirically when it needs it.

### Where it goes

`sessions.fork` is a **client-level** RPC, the same level as `mcp.config` — not session-level.

**Do not copy the existing probe idiom.** `sdkSessionManager.ts:1579` writes
`(this.client as any)?.rpc?.mcp?.config`, which is doubly pointless: `client` is already declared
`any` at `:312`, so the cast erases nothing that was ever checked. It is a smell, not a house style
worth propagating.

The SDK gives us better. `CopilotClient` is `export declare class` and re-exported from the package
root, and `get rpc(): ReturnType<typeof createServerRpc>` is fully typed — `sessions.fork` included,
as `(params: SessionsForkRequest) => Promise<SessionsForkResult>`. A **type-only** import is erased at
compile time, so it adds no runtime dependency (the same trick already used for `vscode`).

The one genuine uncertainty is that `sessions` is `@experimental`: the types *promise* `fork`, but an
older CLI may not implement it. Model exactly that gap and nothing more — no cast:

```ts
import type { CopilotClient } from '@github/copilot-sdk';

// The SDK type declares `fork` unconditionally, but the running CLI may predate it.
// Partial<> says "same shape, may be absent" while keeping full parameter and return typing.
const sessionsRpc: Partial<CopilotClient['rpc']['sessions']> | undefined = this.client?.rpc?.sessions;
if (typeof sessionsRpc?.fork !== 'function') { /* fall back */ }
const { sessionId: forkedId } = await sessionsRpc.fork({ sessionId, name });
```

`this.client` is `any`, so the annotated local needs no cast — and `forkedId` and the request object
are both type-checked, which the `as any` version never was.

**Out of scope:** retyping the `client` field itself from `any` to `CopilotClient`. It has ~20 touch
points including `(this.client as any).cliProcess` and `.connection`, which reach into SDK internals
absent from the public type — a cascade of new errors in a release branch. That belongs with S4, which
takes ownership of the client anyway. Same for giving `listConfiguredMcpServers` this treatment: real,
but not this step's business.

**Skip the `CliCapabilityService` flag entirely** (review C3, option b). Confirmed: the service is
constructed in `cliBundleBootstrap.ts:39`, injected only into `ChatViewProvider`, and is **not
reachable from `SDKSessionManager`** — no constructor param, no `HostBridge` member, and `semver` is
never imported there. Adding a seam purely to gate one `@experimental` call is unjustified when the
runtime probe already degrades correctly, which is precisely what `listConfiguredMcpServers()` does.

### TDD cycles

1. **Un-skip the existing guard.** Remove the `this.skip()` at `session-fork.test.js:75-78` so the
   suite fails loudly if `SessionService.forkSession` disappears. It stays as the **fallback**
   regression guard; its 8 assertions remain valid for the cpSync path.
2. **RED:** `SDKSessionManager.forkSession(sessionId, opts?)` calls `client.rpc.sessions.fork` with
   `{ sessionId, name }` and returns the new id. Test via prototype-call with a fake client, the
   pattern already used in `sdk-event-subscription-double.test.js`.
3. **RED:** falls back to `SessionService.forkSession` when the RPC is absent.
4. **RED (the C4 fix):** the **fallback** path gives the fork a distinct name. Today `cpSync` copies
   `session-name.txt`, so `ensureSessionName`'s existence check at `:152` short-circuits and the fork
   inherits the parent's label verbatim. Replace that call with `writeSessionName(destDir, \`${parentName} (fork)\`)`.
5. **RED:** `handleForkSession` (`extension.ts:446-464`) is **entirely untested today** — no coverage
   of the no-active-session guard, the switch-to-fork, or the error toast. Add those, since this step
   changes the function.

Leave the sidebar switching to the fork as-is. Lane B's Slice 2f flips that to open a tab; changing
it here would collide.

## Release — v3.12.0

Use the `publish-release` skill for the runbook. Two things it won't know:

- **The CHANGELOG has no `[3.11.0]` entry.** It jumps from `[Unreleased]` to `[3.10.0] - 2026-06-15`,
  yet 3.11.0 is the version live on the Marketplace. Backfill it while writing 3.12.0's entry.
- **`CHANGELOG.md:112` documents a false claim** — it says v3.7.0's fork gives the copy "a distinct
  label". It never has. The 3.12.0 entry should say so plainly rather than quietly starting to be true.

## Critical files

`src/extension/hostBridge.ts` · `src/extension.ts` · `src/shared/subagentPalette.ts` (new) ·
`src/extension/services/SubagentPanelService.ts` · `src/sdkSessionManager.ts` (adds `forkSession`) ·
`src/extension/services/SessionService.ts` (the `writeSessionName` fix) ·
`tests/unit/extension/session-fork.test.js` (un-skip) · `planning/spikes/session-fork-rpc/` (new) ·
`CHANGELOG.md` · `package.json`

Reuse rather than rewrite: the prototype-call test pattern in `sdk-event-subscription-double.test.js`,
the temp-dir filesystem fixtures in `session-fork.test.js`, and `tests/helpers/without-vscode.js`.
Deliberately **not** reused: the `as any` probe idiom at `sdkSessionManager.ts:1579`.

## Verification

1. `npm run compile-tests` before every test run — all manager tests load `out/`.
2. `npm test` green. Expect ~1780 passing. **The JSDOM component tests are order-dependent** and flake
   between 0 and 3 failures with no code change; re-run before believing any failure, and confirm the
   named test passes in isolation.
3. `npm run compile` and `npm run lint` — 15 warnings is the baseline, 0 errors.
4. Spike runs standalone against the bundled CLI and prints the fork's id **and assigned name**.
5. Manual, in the Extension Development Host: fork from the sidebar and confirm the new session shows a
   **distinct** name in the dropdown — the bug this release fixes. Then force the fallback (stub the
   probe to return undefined) and confirm the name is still distinct.
6. `./test-extension.sh`, reload the window, confirm the sub-agent dock still colors agents correctly
   after the palette change.
7. Watch for `sdk-upgrade-0126.test.js` / `sdk-upgrade-0132.test.js` — they assert on the **raw text**
   of `src/sdkSessionManager.ts` and will fail on code movement alone. Adding a method is safe; moving
   existing code is not.
8. `npm run check-types` must pass with the fork call **fully typed** — no `any` on the request object
   or the result. If a cast is needed to make it compile, the approach is wrong; stop and reconsider
   rather than reaching for `as any`.

---

## Plan Review

**Reviewed:** 2026-08-15 17:04
**Reviewer:** Claude Code (plan-review-intake)

### Strengths

- **Context / ordering is strong.** The S3a → S2 → S1 sequencing is sensible: it isolates two internal changes before the user-facing fork change and reduces release risk.
- **The plan is grounded in the actual codebase.** Referenced seams all verified as real: `createVSCodeHostBridge()` / `getBackendState()` reach-in, the three palette copies, `writeSessionName`, `ensureSessionName`, `SessionService.forkSession()`, and `CopilotClient` / `client.rpc.sessions.fork` in the installed SDK typings.
- **TDD / verification mostly matches repo conventions.** Correctly calls out `compile-tests`, `out/`-based tests, JSDOM flake risk, and the raw-text `sdk-upgrade-*` test fragility.

### Issues

#### Critical (Must Address Before Implementation)

- **S1 — native fork path does not define the naming source or wiring clearly enough**
  - *Section:* S1 / TDD cycles #2
  - *What's missing:* The plan says `SDKSessionManager.forkSession(sessionId, opts?)` should call RPC with `{ sessionId, name }`, but never defines where that `name` comes from on the native path. The fallback path gets an explicit `${parentName} (fork)` fix; the native path does not.
  - *Why it matters:* "Distinct name" is the core user-visible requirement of v3.12.0. An implementer could wire the RPC call with `name: undefined` and still follow the plan.
  - *Suggested fix:* Add one explicit naming rule used by **both** paths, e.g. "derive `parentName` from the current session label, compute `${parentName} (fork)`, pass it to `SDKSessionManager.forkSession`, and reuse the same value in the filesystem fallback."

- **S1 — failure policy for the experimental RPC is incomplete**
  - *Section:* S1 / "Where it goes"
  - *What's missing:* The plan only falls back when `sessionsRpc?.fork` is absent. It does not say what to do when `fork` exists but throws at runtime.
  - *Why it matters:* Non-bundled/custom CLI users may have a CLI that exposes the method but fails the call. Without a defined policy, existing working fork behavior can silently regress.
  - *Suggested fix:* Specify a concrete error-handling rule (either fallback on narrow "unsupported" RPC errors, or explicitly don't fallback on runtime errors and explain why), then add a RED test for that case.

#### Important (Should Address)

- **S1 / `handleForkSession` — the wiring change is implied but never stated explicitly**
  - *Section:* S1 / TDD cycles #5
  - *What's missing:* `src/extension.ts` currently calls `SessionService.forkSession(...)` directly. The plan says `handleForkSession` changes and adds tests, but does not explicitly say "replace that call with `await sessionManager.forkSession(...)`."
  - *Suggested fix:* Add one concrete bullet: "Update `handleForkSession()` to call `sessionManager.forkSession(...)` and keep `handleSwitchSession()` behavior unchanged."

- **S2 — the drift-guard test is under-specified and likely to tempt a banned source-scan approach**
  - *Section:* S2 / RED step
  - *What's missing:* The plan wants a test asserting the webview `PALETTE` literal matches the shared TS constant, but doesn't say how — and the obvious path (source-text `.includes()`) is explicitly banned by CLAUDE.md / COPILOT.md.
  - *Suggested fix:* Spell out a behavior-level test approach, e.g. compare colors emitted by `SubagentDock` across N agents against the compiled shared palette constant, or explicitly allow exporting the palette for test import.

- **Spike — "against bundled CLI 1.0.68" is not operationalized**
  - *Section:* S1 / Spike first
  - *What's missing:* The plan says to validate against the bundled CLI, but not how the spike ensures it uses that binary rather than a system-installed CLI.
  - *Suggested fix:* Add an explicit requirement that the spike resolves and prints the CLI path/version it uses, and that it must match the bundled CLI artifact.

- **Release — depends on `publish-release` skill without an inline fallback**
  - *Section:* Release — v3.12.0
  - *What's missing:* "Use the `publish-release` skill" is not executable if that skill is unavailable.
  - *Suggested fix:* Inline the minimum release checklist (version bump, changelog edits, compile/test/package commands, Marketplace publish step) or reference a concrete repo path for the runbook.

#### Minor (Consider)

- **Critical files — some new test locations are implied, not named**
  - S3a and S2 test tasks reference production files but not the corresponding test file paths.
  - *Suggested fix:* Name the intended test files or say "new test file under `tests/unit/extension/`."

### Recommendations

- Add a short **"Native fork naming contract"** subsection defining: how the name is derived, who computes it, which layer passes it, and how both native and fallback paths stay consistent.
- Add a short **"RPC failure policy"** subsection for the experimental `sessions.fork` call.
- Make the spike and release steps self-contained so they are executable without tribal knowledge.

### Assessment

**Implementable as written?** With fixes

**Reasoning:** The plan is codebase-aware and technically grounded, but the core S1 path leaves two substantive ambiguities — how the distinct fork name is produced on the native path, and what happens when the experimental RPC exists but fails. Both should be resolved before implementation starts.
