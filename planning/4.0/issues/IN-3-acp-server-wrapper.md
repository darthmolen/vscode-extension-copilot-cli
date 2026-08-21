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

- The manager runs with `vscode` absent and takes a `HostBridge` (IN-1) — and since 2026-08-19 this
  is **enforced by the module graph**, not merely true by convention. The static fallback to
  `createVSCodeHostBridge` is gone, the bridge is a required constructor argument, and
  `vscodeHostBridge.ts` is its own file. Done as part of this issue, since it was the second
  `HostBridge` implementation that made it cheap —
  [memo](../../completed/hostbridge-split-and-fallback-seam.md).
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
   **Done 2026-08-21.** All of these plus `session/set_mode` and `session/close`. `session/load`
   replays the stored conversation as `session/update` notifications during the request;
   `session/close` cancels, releases and forgets, which the schema says an agent **must** do. See
   [continuance §4c](../../in-progress/v4.0-in3-acp-agent.md).
3. **Event mapping.** The 16 emitters → `session/update` variants
   (`agent_message_chunk`, `tool_call`, `tool_call_update`, `plan_update`).
   Sub-agent traffic keeps `agentId == toolCallId`; carry dock extras in `_meta`
   (the ACP `_meta` RFD is Completed), and ensure the transcript still reads
   correctly when `_meta` is ignored.
   **Done 2026-08-21 for the variants a host can act on** — this item was once marked done when it
   was not, which is why it now names what it covers. Diffs cross as ACP `diff` content, and plans as
   `plan` entries (from `session.todos_changed`, which is signal-only: the manager fetches the state
   the event does not carry). `onDidReceiveError` and `onDidUpdateUsage` have ACP homes and remain
   open; the rest have no obvious variant and that is recorded rather than left implicit. See
   [continuance §4c](../../in-progress/v4.0-in3-acp-agent.md).
4. **Permissions.** ~~Today the manager hard-codes `onPermissionRequest: approveAll`.~~
   **Done 2026-08-19.** The manager takes an injected handler; an ACP agent forwards to
   `session/request_permission`; the extension's path is unchanged. Two spike findings shaped it:
   `--yolo` does **not** suppress `onPermissionRequest`, so a handler is always required; and our own
   `onPreToolUse` hook, returning `{ permissionDecision: 'allow' }` at every session-creation site,
   made the CLI emit **no permission event whatsoever** — the feature was dead on arrival until the
   hook stopped pre-deciding. When the host cannot be reached the answer is
   `{ kind: 'user-not-available' }`, never an approval; `yolo` flips that fallback and nothing else.
   See [IN-3 continuance §4](../../in-progress/v4.0-in3-acp-agent.md) and
   [FINDINGS](../../spikes/acp-agent/FINDINGS.md).
5. **Headless host bridge** (IN-8, folds in here): a settings snapshot passed at
   startup, and `askSessionRecovery` resolving without a UI.

## Invariants the SDK imposes

Both are cheap to honour up front and expensive to retrofit. Both are testable in-process, with no
CLI, via `clientApp.connect(agentApp)`. Evidence:
[FINDINGS-acp-sdk.md](../../spikes/acp-agent/FINDINGS-acp-sdk.md).

**1. Never pass a method name as a string literal — use `acp.methods`.** There is no
`client.sessionUpdate()`; notifications go through `client.notify(method, params)`, whose second
overload (`notify<Params = unknown>(method: string, …)`) swallows every mistake — verified with
`tsc --strict`, a **typo'd string compiles clean**. But the SDK exports typed constants, and its own
example uses them (`research/acp-sdk/src/examples/agent.ts:98`):
`cx.notify(acp.methods.client.session.update, …)`. A typo on the constant is `TS2551`. **No facade
needed** — an earlier revision of this ticket prescribed one before the SDK source was in the corpus.

**2. `initialize` may never run — default deny, upgrade on receipt.** `buildSession().start()`
issues `session/new` only. Handlers must work uninitialized. Initialise the capability record to the
schema's own default (`fs: { readTextFile: false, writeTextFile: false }`) and let `initialize`
upgrade it.

> **Correction, 2026-08-19 — capabilities do NOT gate permission forwarding.** This paragraph used
> to say `clientCapabilities` decides whether we forward to `session/request_permission` (item 4) or
> fall back to `approveAll`. That is false, and it was repeated into two other documents before
> anyone checked it. Verified twice against `research/acp-sdk/src/`: `ClientCapabilities`
> (`schema/types.gen.ts:4462`) carries `fs`, `terminal`, `session`, `plan`, `auth`, `elicitation`,
> `nes` and `positionEncodings` — nothing permission-shaped — and on the `Client` interface
> (`acp.ts:3740`) `requestPermission` is one of only **two non-optional members**, while every
> capability-gated method is declared `?`. `session/request_permission` is baseline protocol
> surface, so **forwarding is unconditional**.
>
> The default-deny record above is still right; it gates `fs` and `terminal`, which is what it was
> always for. The security worry is also still real — it just relocates. The failure is not
> "we branched on an unset capability", it is **"we could not ask, so we approved"**, and the answer
> is a deny fallback (`{ kind: 'user-not-available' }`) rather than a capability branch. Guarded by
> two tests: a permission forwarded with no `initialize` at all, and one after an `initialize` that
> advertises nothing.

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
  **Met 2026-08-19: `spike-through-the-wire.mjs` → 17/17** against a real CLI, including step 5 and
  a real `shell` permission forwarded to the client and answered back down the same pipe.
- `npm test` green; `tests/e2e/plan-mode/` unaffected.
  **Met 2026-08-21: 26/26**, extended to cover the things it used to leave out — loading a session
  with history, closing one, a file diff arriving as ACP diff content, and a plan as ACP plan
  entries. `stopReason` reports `cancelled` honestly; `max_tokens` and `refusal` are still not
  claimed, because no manager signal supports them.
- An ACP client (Zed, or a scripted harness) can complete one prompt end to end.
  **Re-rated 2026-08-16:** Zed was the only way to escape testing our own reading of
  the spec back to us. The SDK's `ClientApp` is the authors' reading, so it now covers
  that risk; Zed drops from *essential honesty check* to *end-to-end confirmation*.
  Still worth one run, no longer the gating tier.
