# IN-3 — Wrap SDKSessionManager as an ACP server

**Category:** c · **Difficulty:** Medium · **Blocking:** yes (agent half)
**Status:** in progress — spike done 12/12, no *blocking* external dependency
**Uses:** `@agentclientprotocol/sdk` (Apache-2.0, zero deps) — added 2026-08-16
**Depends on:** IN-1 (done), IN-2 (done)

## Why this is next

It is the only substantial item that **pays off under every outcome** of the
outbound asks:

- VS Code opens up → we plug straight in
- It does not → any other AHP host can front us, and Zed and other ACP clients
  can drive us directly
- Neither → IN-9 (our own host) consumes it unchanged

That is the whole basis of the hybrid posture. Nothing here waits on Microsoft.

## What Phase 0 already established

- The manager runs with `vscode` absent and takes a `HostBridge` (IN-1) — true as long as
  the caller injects one, but not yet enforced by the module graph: `sdkSessionManager.ts`
  still statically falls back to `createVSCodeHostBridge`. Removing that, and splitting
  `vscodeHostBridge.ts` out, belongs to this issue —
  [backlog memo](../../backlog/hostbridge-split-and-fallback-seam.md).
- Its 16 `BufferedEmitter` events carry **plain JSON-serializable structs** — no
  `vscode.Uri`, no `Disposable`, no functions cross the boundary. This is the
  natural `session/update` mapping.
- **Plan mode's tool closures fire out-of-host** — verified live, 8/8, with a
  real `plan.md` write ([FINDINGS](../../spikes/acp-agent/FINDINGS.md)).
- `copilot --acp` is never invoked, so cli#1574 and cli#1607 are off our path.

## Orientation — do not confuse this with the dead branch

```text
DEAD (feature/4.0-acp-migration):  our client ──ACP──▶ copilot --acp
THIS:                              host ──ACP──▶ our agent ──SDK──▶ CLI
```

The abandoned branch replaced the SDK with an ACP client. This wraps the SDK in
an ACP server. Opposite direction, different blockers.

## Scope

1. ~~**ACP server transport.** NDJSON JSON-RPC over stdio, hand-rolled.~~
   **Superseded 2026-08-16 — use `@agentclientprotocol/sdk`.** The protocol
   authors publish a zero-dependency Apache-2.0 TypeScript SDK whose agent half is
   exactly this surface, proven 12/12 in
   [FINDINGS-acp-sdk.md](../../spikes/acp-agent/FINDINGS-acp-sdk.md). Framing
   collapses to `acp.agent()` + `ndJsonStream()`. Two invariants it imposes are
   **not** optional — see "Invariants" below.
   *(Note `@zed-industries/agent-client-protocol` is deprecated; it was renamed.)*
2. **Method surface.** `initialize`, `session/new`, `session/load`,
   `session/prompt`, `session/cancel`.
3. **Event mapping.** The 16 emitters → `session/update` variants
   (`agent_message_chunk`, `tool_call`, `tool_call_update`, `plan_update`).
   Sub-agent traffic keeps `agentId == toolCallId`; carry dock extras in `_meta`
   (the ACP `_meta` RFD is Completed), and ensure the transcript still reads
   correctly when `_meta` is ignored.
4. **Permissions.** Today the manager hard-codes `onPermissionRequest: approveAll`.
   An ACP agent should forward to `session/request_permission` instead. Note the
   permission-interaction spike finding: `--yolo` does **not** suppress
   `onPermissionRequest`, so a handler is always required.
5. **Headless host bridge** (IN-8, folds in here): a settings snapshot passed at
   startup, and `askSessionRecovery` resolving without a UI.

## Invariants the SDK imposes

Both are cheap to honour up front and expensive to retrofit. Both are testable in-process, with no
CLI, via `clientApp.connect(agentApp)`. Evidence:
[FINDINGS-acp-sdk.md](../../spikes/acp-agent/FINDINGS-acp-sdk.md).

**1. Fence `notify()` behind a typed facade.** There is no `client.sessionUpdate()`; notifications
go through `client.notify('session/update', …)`, whose second overload
(`notify<Params = unknown>(method: string, …)`) swallows every mistake. Verified with `tsc --strict`:
a **typo'd method name compiles clean**, and so do **garbage params**. So the literal appears in
exactly one helper, everything else calls a real method, and one test covers that crossing.

**2. `initialize` may never run — default deny, upgrade on receipt.** `buildSession().start()`
issues `session/new` only. Handlers must work uninitialized. This is security-adjacent:
`clientCapabilities` gates whether we forward to `session/request_permission` (item 4) or fall back
to `approveAll`, and branching on an unset capability silently auto-approves rather than crashing —
the same failure class as **cli#1607**. Initialise the capability record to the schema's own default
(`fs: { readTextFile: false, writeTextFile: false }`) and let `initialize` upgrade it.

**Cancellation is an `AbortSignal`**, delivered on the handler context as `signal` — nothing to
correlate by hand. (Ergonomics only: the wire still carries cancel as a notification.)

**Module format is settled.** The SDK is ESM, our extension is CJS, and that is fine — the agent is
its own process and an ESM entry point `require()`s our compiled `out/` manager and the S4
`CopilotClientProvider` (spike steps 5a/5b). The agent never enters the extension bundle.

## Out of scope

- The AHP client (IN-4) — different half, different ticket.
- `FileSnapshotService` across a real process boundary (IN-6) — depends on the
  shape this ticket settles.
- Publishing to the ACP agent registry — trivial once the agent exists, and the
  registry RFD is already Completed upstream.

## Verification

- TDD throughout, per repo convention.
- **Test in-process first.** `clientApp.connect(agentApp)` needs no transport, no
  subprocess and no CLI, so the protocol surface — including both invariants above —
  is unit-testable against the protocol authors' own client. This is the cheap tier
  and most of IN-3 should be verified here.
- Extend `planning/spikes/acp-agent/spike-out-of-host.mjs`: the same 8 assertions
  must hold **through the ACP wire** rather than through direct method calls.
  Plan-mode step 5 is the regression guard that matters.
- `npm test` green; `tests/e2e/plan-mode/` unaffected.
- An ACP client (Zed, or a scripted harness) can complete one prompt end to end.
  **Re-rated 2026-08-16:** Zed was the only way to escape testing our own reading of
  the spec back to us. The SDK's `ClientApp` is the authors' reading, so it now covers
  that risk; Zed drops from *essential honesty check* to *end-to-end confirmation*.
  Still worth one run, no longer the gating tier.
