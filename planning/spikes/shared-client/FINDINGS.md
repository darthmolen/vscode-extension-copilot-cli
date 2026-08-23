# S-A — one provider, two managers

**Run:** 2026-08-22 · bundled CLI `@github/copilot` 1.0.68 · SDK 0.3.x · Node 24.13.1
**Script:** `spike-shared-client.mjs` · **Raw:** `results/result.json`
**Verdict: the sharing path works.** Every objective passed.

## Why it was run

`CopilotClientProvider`'s own header says it *"lets N `SDKSessionManager`s share one CLI
process"*, and `SDKSessionManager` carries `ownsClientProvider` guarding `stop()`. The
seam is complete — and the single construction site in `extension.ts` passed six arguments
where the provider is the seventh. **It had never been shared.** Every manager spawned its
own CLI, and nobody had ever executed the path the design was built around.

## What it proved

| | Result |
| --- | --- |
| Two consumers, one provider | the **same** client object, not two |
| Two sessions over that client | distinct ids, both answered independently |
| **Process count while both live** | **+1, not +2** — one CLI serving two sessions |
| `sessionA.disconnect()` | session B kept working (`STILL HERE`) |
| `provider.stop()` | process count back to baseline |

The disconnect result is the load-bearing one: it is what makes `ownsClientProvider`
meaningful rather than decorative.

## What it did NOT unblock, and this is the point

§4.7 stays **out of v3.13.0**, for a reason the spike found on the way past rather than
in its own results:

> `onClientStarted: client => this.modelCapabilitiesService.initialize(client)` is wired
> **only** inside `createOwnClientProvider()` (`sdkSessionManager.ts:507`). A manager given
> an injected provider never initialises its own `ModelCapabilitiesService` — so model
> fallback, vision support, `getMaxImages`, `getSupportedMediaTypes` and
> `validateAttachments` all degrade silently.

Injecting a shared provider on this branch would therefore ship that bug. The fix belongs
in `sdkSessionManager.ts`, which is **Lane A's file** — and Lane A has already made it on
`feature/4.0-in3-acp-server`, found from the other direction by the ACP agent (cross-talk
thread 02, "one of two bugs a second consumer found"). Making it here as well would be a
duplicate fix and a merge conflict on work that is already done.

**So the sequencing is: Lane A's branch merges, then §4.7 becomes a one-line change at the
composition root.** The spike's value is that when that day comes, nobody has to wonder
whether the path works. It does.

Until then every manager spawns its own CLI. That is a cost, not a correctness problem,
which is exactly how P3 §5 scoped this spike's downside.
