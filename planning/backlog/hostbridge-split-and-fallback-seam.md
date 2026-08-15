# HostBridge — split the file, drop the VS Code fallback

**Status:** deferred by decision, 2026-08-15.
**Revisit:** at the Lane A completion gate, **before moving off v3.12.0**.

## Read this first: `HostBridge` is already an interface

This question keeps coming back, so answer it once. Phase 0 (PR #40) did not ship a
concrete class named after nothing. `src/extension/hostBridge.ts` contains both halves:

| Line | What |
| --- | --- |
| [`:27`](../../src/extension/hostBridge.ts#L27) | `export interface HostBridge` — the contract |
| [`:94`](../../src/extension/hostBridge.ts#L94) | `export function createVSCodeHostBridge(...)` — the VS Code implementation |

So the open question is **file organization**, not abstraction. Why isn't the factory in
`vscodeHostBridge.ts`?

Because at Phase 0 there was exactly one implementation, and the hazard a split would
normally prevent is already neutralized inside the single file:

- `vscode` is a **type-only** import at [`:14`](../../src/extension/hostBridge.ts#L14)
  (`import type * as vscode`), which TypeScript erases at compile time.
- The factory `require`s it **lazily**, at [`:98`](../../src/extension/hostBridge.ts#L98),
  inside the function body rather than at module scope.

A non-VS Code host can therefore `import` this module today and pay nothing. Co-locating
the implementation costs no load-time coupling. A one-implementation contract file with
its implementation beside it is the right default until the second one shows up.

## The gotcha

The naming question is cosmetic. This one is not.

`src/sdkSessionManager.ts:436` — the module whose entire purpose is to not know about
VS Code, naming the VS Code host:

```ts
this.host = hostBridge ?? createVSCodeHostBridge(context as vscode.ExtensionContext);
```

backed by a **static** import at the top of the file:

```ts
import { HostBridge, MessageEnhancerLike, NoopMessageEnhancer, createVSCodeHostBridge } from './extension/hostBridge';
```

**Why it is harmless today.** Production always injects. `src/extension.ts:596` constructs
the manager and passes a real bridge built at `:604`, and the constructor guard at
`sdkSessionManager.ts:429-433` requires one of the two:

```ts
if (!hostBridge && !context) {
    throw new Error('SDKSessionManager requires either a vscode.ExtensionContext or an injected HostBridge.');
}
```

The fallback exists for **test ergonomics** — a dozen suites construct the manager with a
`context` and no bridge — not for any production path.

**Why it still matters.** It is a static reference, so it survives a rename. Splitting the
file without removing it just means `sdkSessionManager.ts` imports
`createVSCodeHostBridge` from a differently-named file, and the dependency arrow points
exactly where it did before.

> **Do not do the rename on its own.** Rename-only is pure cosmetics and buys nothing.
> The split is worth doing when — and only when — the fallback goes with it.

This is also the clause that will contradict IN-3's stated premise
([IN-3:21](../4.0/issues/IN-3-acp-server-wrapper.md#L21)):

> The manager runs with `vscode` absent and takes a `HostBridge` (IN-1).

True in practice as long as the caller injects, but not enforced by the module graph while
the fallback stands.

## Proposed solution (for the gate, not now)

1. `hostBridge.ts` keeps the contract + `NoopMessageEnhancer`.
2. `vscodeHostBridge.ts` takes `createVSCodeHostBridge` and `HostBridgeDeps`.
3. The ACP host gets its own file alongside.
4. Drop the fallback: `SDKSessionManager` imports the contract as a **type only**, and the
   bridge becomes a required constructor argument. The `context` parameter's remaining
   justification goes with it.

After (4), no import path leads from `sdkSessionManager.ts` to `require('vscode')` at all.
That is the structural win; steps 1–3 alone are not.

## Cost — and why it bundles with IN-3

Verify before acting on this number, it will drift:

```bash
grep -rn "new SDKSessionManager" tests/ | grep -v "undefined, undefined,"
```

At time of writing: **13 construction sites across 11 files** build the manager with a
`context` and no bridge, and each needs one supplied. They are the e2e set
(`tests/e2e/plan-mode/*`, `tests/e2e/session/*`) plus
`tests/unit/extension/sdk-upgrade-0126.test.js`.

One test needs judgement rather than mechanical edit:
`tests/unit/extension/sdk-session-manager-host-decoupling.test.js:108` asserts the
both-arguments-missing guard throws. If the bridge becomes required, that guard's shape
changes and the expectation must be rewritten, not deleted — it is still the assertion
that a manager cannot be built hostless.

There is already a reusable fake: `createFakeHost()` in that same file, and `fakeHost()` in
`sdk-session-manager-mcp-events.test.js`. Promote one to a shared helper rather than
writing a fourteenth inline stub.

That test cost is the whole reason to defer. When IN-3 introduces the second `HostBridge`
implementation it will be editing these seams anyway, and the split plus the fallback
removal come nearly free with work already in flight. Doing it early on
`feature/3.12.0-shared-spine` means paying it twice and adding churn to a release whose
remaining risk (S1, SDK-native fork) is meant to be the only risky thing in it.

## Lane note

`src/extension/hostBridge.ts` is **Lane A exclusive** per the cut-out table
([work order:72](../acp-ahp-chat-tabs-dual-stream-work-order.md#L72)). This work is in-lane
for A. Lane B has no reason to touch it — its one former need, `getActiveAgent`, was
relocated by S3a (`fd300a6`) and now arrives through injected `HostBridgeDeps`.
