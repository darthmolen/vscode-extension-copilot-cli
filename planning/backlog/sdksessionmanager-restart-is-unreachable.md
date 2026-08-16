# `SDKSessionManager.restart()` has no callers

**Found:** 2026-08-16, during S4 · **Size:** small · **Priority:** low

[`restart()`](../../src/sdkSessionManager.ts#L1889) is `public`, three lines, and invoked from
nowhere in `src/`:

```ts
public async restart(): Promise<void> {
    await this.stop();
    await this.start();
}
```

Every real restart in the extension goes the other way — throw the manager away and build a new one.
All three `stop()` call sites ([extension.ts:396](../../src/extension.ts#L396), `:421`, `:473`) set
`sessionManager = null` immediately, and `startCLISession` (`:597`) constructs a fresh
`SDKSessionManager`.

## Why it is worth a note rather than a silent delete

It cost real credibility once. S4 fixed a `_lifecycleListenersAttached` desync that only manifests on
a stop-then-start of the *same* instance, and the fix was written up — in a PR body and in the work
order — as repairing a live bug that "`restart()` hit every time." It doesn't, because nothing calls
`restart()`. The claim survived until someone read a log looking for the symptom and could not find
the code path.

Dead public methods invite exactly that: they read as supported surface, so the next person reasons
about the system as if they were reachable.

## Options

- **Delete it.** `stop()` + `start()` are both public, so anything that wants the behaviour can
  compose it. Cheapest, and removes the trap.
- **Wire it up.** A "Copilot CLI: Restart Session" command is plausibly useful and would make the
  method real — it is now correct after S4, where before it would have produced a client with no
  diagnostics. Needs a `package.json` command contribution and a handler.

Not done inside S4 deliberately: S4's virtue was touching nothing it did not need to, and this is
neither a blocker nor in its path.

## Check before acting

`restart()` is public API on a class the ACP work (Lane A) will drive out-of-host, so confirm no
planned ACP surface wants it before deleting. See
[the work order](../acp-ahp-chat-tabs-dual-stream-work-order.md).
