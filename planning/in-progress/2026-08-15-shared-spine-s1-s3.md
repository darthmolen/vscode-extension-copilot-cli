# Shared spine S1–S3, shipping as v3.12.0

## Progress

**Branch:** `feature/3.12.0-shared-spine` · **Started:** 2026-08-15 · one commit per phase.

| Phase | State | Commit |
| --- | --- | --- |
| S3a — decouple `getActiveAgent` | ✅ done | `451a7c3` |
| S2 — one sub-agent palette | ✅ done | `c3f0c9b` |
| S1 — spike: `sessions.fork` | ✅ done, 8/8 | `ecf93eb` |
| S1 — SDK-native fork | ✅ done | `eda08d2` |
| Release — v3.12.0 | ⬜ not started | — |

Review applied: 6 accepted + 1 merged, from
`planning/needs-review/completed/2026-08-15-shared-spine-s1-s3-shipping-as-v3-12-0.md`.

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

- **RED:** a drift-guard test comparing the webview's `PALETTE` against the shared TypeScript constant.
  Fails now — no shared constant exists.

  **Do not scan source text for this.** CLAUDE.md bans it, with the cautionary tale of a test passing
  because the string sat inside a `//` comment. `PALETTE` is currently module-private in
  `SubagentDock.js` (only the class is exported at `:29`), so **export it** and have the test import
  both it and the compiled shared constant, comparing arrays. That is importing production code, which
  is what the convention actually asks for.
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

0. **it is talking to the bundled CLI.** Resolve the candidates, then **print the resolved path and
   its `--version`**, and assert it matches the bundled artifact (currently **1.0.68**). Not optional
   bookkeeping: the Phase 0.2 spike failed exactly here, guessing
   `@github/copilot/index.js`, which does not exist — the binary lives at
   `@github/copilot-{platform}-{arch}/copilot`. Reuse the step-0 resolution already written in
   `planning/spikes/acp-agent/spike-out-of-host.mjs`.
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

### Naming contract — one rule, both paths

The distinct fork name is the user-visible point of this release, so it gets defined once and
consumed twice rather than being an implementation detail of each path.

- **Source:** `SessionService.formatSessionLabel(sessionId, sessionPath)` (`SessionService.ts:180`)
  is the existing label resolver and already runs the priority chain
  (`session-name.txt` → `plan.md` H1 → `workspace.yaml` summary → 8-char id prefix).
- **Rule:** `SDKSessionManager.forkSession` computes `` `${parentLabel} (fork)` `` **once**, before
  branching.
- **Native path:** passes it as the RPC's `name`, **then also calls
  `writeSessionName(forkDir, name)`.**
- **Fallback path:** hands the same string to `writeSessionName(destDir, name)`.

**Why the native path must write the file too — proven by the spike, not assumed.** The CLI honours
`name` and persists it to the fork's `workspace.yaml` as `name:`, but it never writes
`session-name.txt`. `formatSessionLabel` reads `session-name.txt` → `plan.md` H1 → workspace.yaml's
**`summary`** → id prefix, so the CLI's `name:` field is invisible to it and a purely-RPC fork still
renders as `385d7269`. Measured directly in
[the spike findings](../spikes/session-fork-rpc/FINDINGS.md). Passing `name` to the RPC is necessary
but not sufficient.

Never leave `name` undefined on the native path — that reintroduces the exact bug this release fixes.

### RPC failure policy

The probe handles *absent*. Present-but-failing needs its own answer, and the tempting one is wrong:
falling back on any error would run a `cpSync` after a legitimate failure, producing a **wrong result**
instead of an error. That is worse than failing loudly.

- **Fall back** only on JSON-RPC **method-not-found (`-32601`)** — the same "older CLI" condition the
  `typeof` probe catches, arriving over the wire instead.
- **Propagate** every other error. A genuine fork failure surfaces as a failure.

### TDD cycles

1. **Un-skip the existing guard.** Remove the `this.skip()` at `session-fork.test.js:75-78` so the
   suite fails loudly if `SessionService.forkSession` disappears. It stays as the **fallback**
   regression guard; its 8 assertions remain valid for the cpSync path.
2. **RED:** `SDKSessionManager.forkSession(sessionId, opts?)` calls `client.rpc.sessions.fork` with
   `{ sessionId, name }` where `name` is the contract value above — **assert the name is passed**, not
   merely that the RPC was called. Prototype-call with a fake client, the pattern already used in
   `sdk-event-subscription-double.test.js`.
3. **RED:** falls back to `SessionService.forkSession` when `fork` is absent.
4. **RED:** falls back when `fork` exists but rejects with a `-32601` method-not-found error.
5. **RED:** **propagates** when `fork` exists and rejects with any other error — no silent `cpSync`.
6. **RED (the C4 fix):** the **fallback** path gives the fork a distinct name. Today `cpSync` copies
   `session-name.txt`, so `ensureSessionName`'s existence check at `:152` short-circuits and the fork
   inherits the parent's label verbatim. Replace that call with `writeSessionName(destDir, name)`.
7. **RED:** `handleForkSession` (`extension.ts:446-464`) is **entirely untested today** — no coverage
   of the no-active-session guard, the switch-to-fork, or the error toast. Add those, then **rewire it**:
   replace the direct `SessionService.forkSession(...)` call at `:457` with
   `await sessionManager.forkSession(...)`. Leave `handleSwitchSession` behaviour unchanged.

Leave the sidebar switching to the fork as-is. Lane B's Slice 2f flips that to open a tab; changing
it here would collide.

## Release — v3.12.0

Use the `publish-release` skill — it is authoritative and encodes repo-specific ordering (bump from
the *last published* version, gate on tests, PR, poll, squash-merge, publish, tag + GitHub release).

**Fallback if the skill is unavailable**, minimum viable checklist:

1. `package.json` version → `3.12.0`
2. CHANGELOG entry (see the two gaps below)
3. `npm run compile-tests && npm test` green · `npm run compile` clean
4. `npx @vscode/vsce package` — sanity-check the VSIX contents
5. PR → squash-merge to `main`
6. `npx @vscode/vsce publish`
7. `git tag v3.12.0 && git push --tags`, then a GitHub release

Two things the skill won't know:

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

New test files: `tests/unit/extension/host-bridge-active-agent.test.js` (S3a) ·
`tests/unit/components/subagent-palette-drift.test.js` (S2) ·
`tests/unit/extension/sdk-session-manager-fork.test.js` (S1 cycles 2–6) ·
`tests/unit/extension/handle-fork-session.test.js` (S1 cycle 7).

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
