# IN-3 — Wrap SDKSessionManager as an ACP server

**Category:** c · **Difficulty:** Medium · **Blocking:** yes (agent half)
**Status:** ready to start — no external dependency
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

1. **ACP server transport.** NDJSON JSON-RPC over stdio. Reuse the framing
   knowledge already proven in `tests/harness/acp-spike.mjs`: NDJSON not
   `Content-Length`, cancel arrives as a **notification**, permission replies use
   the double-nested `{ outcome: { outcome, optionId } }` shape.
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

## Out of scope

- The AHP client (IN-4) — different half, different ticket.
- `FileSnapshotService` across a real process boundary (IN-6) — depends on the
  shape this ticket settles.
- Publishing to the ACP agent registry — trivial once the agent exists, and the
  registry RFD is already Completed upstream.

## Verification

- TDD throughout, per repo convention.
- Extend `planning/spikes/acp-agent/spike-out-of-host.mjs`: the same 8 assertions
  must hold **through the ACP wire** rather than through direct method calls.
  Plan-mode step 5 is the regression guard that matters.
- `npm test` green; `tests/e2e/plan-mode/` unaffected.
- An ACP client (Zed, or a scripted harness) can complete one prompt end to end.
