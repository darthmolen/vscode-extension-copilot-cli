# IN-4 — Webview becomes an AHP client

**Category:** c · **Difficulty:** High · **Blocking:** yes (client half)
**Status:** blocked — needs IN-3 and a host to talk to
**Overlaps:** the v4.1 ServiceBus + React rewrite. **Plan them as one job.**

## Why this is the largest item

The webview has **no state model to migrate**. Today:

- 66 message types across a bespoke, fire-and-forget RPC with no correlation IDs
- **No store, no reducer, no reconciliation** anywhere — all imperative DOM
- State scattered across three tiers: module-level `let`s in `main.js`,
  per-component fields, and the DOM itself (`.expanded`, `data-agent-id`, …)
- Three parallel messaging idioms coexisting: the global `EventBus`,
  per-component private emitters, and plain callback properties
- No replay or rehydration: on reload only `subagentDockMinimized` survives

AHP demands the opposite: channels, subscriptions, immutable state, action
envelopes, and write-ahead reconciliation. This is not a transport swap — it is
the state model the webview never had.

Which is exactly what the v4.1 rewrite was already going to build. Doing them
separately means building a store twice.

## What we get for free

- **`@microsoft/agent-host-protocol`** ships `AhpClient` + `WebSocketTransport`
  on npm. The reducer/reconciliation machinery is not ours to write.
- The **sub-agent dock maps natively**: AHP models a sub-agent as a separate chat
  with `origin: { kind: Tool, chat, toolCallId }` — our `agentId` **is** that
  `toolCallId`. `ChatInteractivity` (`Full`/`ReadOnly`/`Hidden`) encodes the
  dock's visibility rule.
- **Changesets** replace the hand-rolled diff plumbing: `ChangesetFile { id, edit, reviewed? }`, per-turn slices, and a review capability we do not currently have.
- **Aggregated session rollup** ("needs input" bubbling up) is something the dock
  does not do today.

## What we must build

1. Replace `WebviewRpcClient` with `AhpClient` over the host transport.
2. A real state model — subscriptions in, rendering derived from state, rather
   than events mutating the DOM directly.
3. **Recursive sub-agent ancestry.** AHP permits unbounded nesting and
   `origin.chat` references that may dangle (a parent can be pruned while its
   worker lives). Our dock is flat and `agentId`-keyed. Needs cycle guards and
   missing-reference tolerance (IN-7 folds in here).
4. Keep the dock's discipline: extras ride `_meta`, and a session must still read
   coherently in a client that ignores them.
5. Preserve the VS Code integration half — inline diffs, `vscode.diff`, active
   file, file picker. Those stay extension-side; the webview subscribes to the
   changeset channel instead of to our own RPC.

## Design constraint to hold

**The dock stays a depth view.** The Agents window is the breadth surface —
many sessions at once, lower feature density. The dock is one session, fully
instrumented. Do not grow the dock into a session browser; it is structurally
worse at that (one window, one focus), and the complementarity is the point.

## Prerequisites

- IN-3 shipped (something to speak AHP *about*)
- A host that will front our agent — OUT-1/2/3, or IN-9
- AHP nearer 1.0; the spec still promises breaking changes to wire types,
  actions, and state shapes

Starting this before those land means rewriting it.
