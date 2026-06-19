---
type: plan
---

# Sub-Agent Dock: Live Status and Tool Calls

## Context

When a skill or fleet spawns sub-agents (e.g. `plan-intake-review` → a background reviewer),
the webview shows nothing for the whole run — the user perceived "sub-agent communication
changed / silent until timeout." Spikes (June 2026, SDK 0.3.0 / CLI 1.0.44) proved the SDK
already streams everything we need; the extension just ignores it. Findings:
`planning/spikes/adhoc-subagent/FINDINGS.md`.

**Proven facts the design rests on:**
- Every event a sub-agent emits carries a top-level envelope **`event.agentId`**, equal to the
  spawning `task` tool's `toolCallId`, stable for the sub-agent's whole lifetime, present on
  **tool events AND messages**. Main/session events have `agentId` absent.
- `subagent.started` data: `{ toolCallId, agentName, agentDisplayName, agentDescription }`.
- `subagent.completed` data (the receipt): `{ toolCallId, agentName, agentDisplayName, model,
  totalToolCalls, totalTokens, durationMs }`; `subagent.failed` adds `error`.
- Concurrent sub-agents get distinct `agentId`s and complete **out of order**.
- Ad-hoc (`task` tool) and fleet (`rpc.fleet.start`) emit the **identical** contract → one dock
  renders both.

**Goal:** a **pinned, non-scrolling Sub-Agent Dock** in the webview with **one tile per
`agentId`**, showing live **status** (running → done/failed), a live **tool-call feed +
counter**, and a **completion receipt** (model · N tool calls · tokens · duration). The dock is
fleet-ready (same path).

**Settled design decisions (from spikes + user):**
1. Attribution key = envelope **`event.agentId`** (`data.parentToolCallId` is a redundant fallback).
2. **One shared dock** for sub-agents and fleet.
3. Completion is **event-driven per tile** via `subagent.completed`/`subagent.failed` — **not**
   count-based (counting is a stopgap, not production-worthy; we react to the per-agent event).
4. **Pinned dock outside the transcript** → immune to `closeCurrentToolGroup()`; `agentId`-less
   events keep the existing flat `ToolExecution` path **unchanged**.
5. No new capability gate needed — SDK 0.3.0 streams these by default (we ship `^0.3.0`).

**TDD is mandatory** (per CLAUDE.md + test-driven-development skill): every task writes a
failing test first, watches it fail, then writes minimal code. Server tests
(`tests/unit/extension/`) need `npm run compile-tests` (compiles to `out/`); webview tests use
JSDOM (`createComponentDOM`, `createMockRpc`). Baseline-known failure: `main.js size constraint`.

## Architecture (data flow)

```
subagent.started/completed/failed ─┐
tool.execution_* (event.agentId)  ─┼─ sdkSessionManager ── emitters ── ExtensionRpcRouter
assistant.message (event.agentId) ─┘        (capture agentId)              │ subagentStart/Complete
                                                                            │ toolStart/Update (+agentId)
                                              WebviewRpcClient ── EventBus ─┴─ route by agentId:
                                                 agentId set → SubagentDock tile
                                                 agentId absent → ToolExecution (flat, unchanged)
```

## Tasks (each: RED → GREEN → REFACTOR)

### Task 1 — Shared types carry `agentId`
- **RED:** `tests/unit/shared/subagent-types.test.js` — assert a `ToolState` accepts `agentId`/
  `parentToolCallId`, and that `SubagentStartPayload`/`SubagentCompletePayload` exist in the
  message-type union + `EXTENSION_MESSAGE_TYPES`.
- **GREEN:** `src/shared/models.ts` — add `agentId?: string; parentToolCallId?: string;` to
  `ToolState` (lines ~41-48). `src/shared/messages.ts` — add `'subagentStart'`/`'subagentComplete'`
  to the type union + `EXTENSION_MESSAGE_TYPES`; define `SubagentStartPayload { subagent: {
  agentId, agentDisplayName, agentName, agentDescription } }` and `SubagentCompletePayload {
  subagent: { agentId, status:'complete'|'failed', model?, totalToolCalls?, totalTokens?,
  durationMs?, error? } }`.

### Task 2 — Extension captures `agentId` on tool events
- **RED:** `tests/unit/extension/sdkSessionManager.subagent.test.js` — feed a fake
  `tool.execution_start` with `event.agentId` + `data.parentToolCallId`; subscribe
  `onDidStartTool`; assert the fired `ToolExecutionState` carries both.
- **GREEN:** `src/sdkSessionManager.ts` — add `agentId?`, `parentToolCallId?` to
  `ToolExecutionState` (~205-216); in `handleToolStart` (~952) set `agentId: event.agentId`,
  `parentToolCallId: data.parentToolCallId`. (`handleToolComplete/Progress` re-fire same state.)

### Task 3 — Extension emits sub-agent lifecycle
- **RED:** same test file — inject a fake `subagent.started`; assert a new
  `onDidStartSubagent` fires with `{ agentId, agentName, agentDisplayName, agentDescription }`.
  Then `subagent.completed` → `onDidCompleteSubagent` with the receipt fields; `subagent.failed`
  → `onDidCompleteSubagent` with `status:'failed'`, `error`.
- **GREEN:** `src/sdkSessionManager.ts` — add `BufferedEmitter`s `onDidStartSubagent`/
  `onDidCompleteSubagent` (match existing emitter convention, ~287-294); split
  `subagent.started`/`completed`/`failed` out of the log-only block (~883-899) and fire the
  emitters with `event.agentId ?? event.data.toolCallId` as the key.

### Task 4 — RPC forwards lifecycle + attributed tools
- **RED:** `tests/unit/extension/ExtensionRpcRouter.subagent.test.js` — `subagentStart(data)`
  posts `{type:'subagentStart', subagent:data}`; `subagentComplete(data)` likewise. Existing
  `toolStart` now includes `agentId` passthrough.
- **GREEN:** `src/extension/rpc/ExtensionRpcRouter.ts` — add `subagentStart`/`subagentComplete`
  (after `toolUpdate` ~186). `src/chatViewProvider.ts` — `startSubagent`/`completeSubagent` →
  router (~700). `src/extension.ts` — subscribe `onDidStartSubagent`/`onDidCompleteSubagent` →
  chatProvider (~684). `src/webview/app/rpc/WebviewRpcClient.js` — `onSubagentStart`/
  `onSubagentComplete` handler registration.

### Task 5 — Dock tile renders on start
- **RED:** `tests/unit/components/SubagentDock.test.js` (JSDOM) — `new SubagentDock(container,
  eventBus)`; emit `subagent:start {agentId:'a1', agentDisplayName:'General Purpose Agent',
  agentDescription:'…'}`; assert a `.subagent-dock__tile[data-agent-id="a1"]` exists showing the
  display name + a running status icon, and the dock is visible.
- **GREEN:** new `src/webview/app/components/SubagentDock/SubagentDock.js` — pinned container
  (top of panel, **not** inside the transcript); `this.tiles = new Map()`; on `subagent:start`
  build a tile (header: status icon + `agentDisplayName` + live counter `0 tool calls`; collapsed
  child feed). **Update `esbuild.js`** (dist dir var + `mkdirSync` + `copyFileSync` — REQUIRED or
  the webview silently fails). Add `.subagent-dock*` CSS. Wire `main.js` to construct the dock and
  emit `subagent:start`/`subagent:complete` from the RPC handlers.

### Task 6 — Child tool calls nest + live counter
- **RED:** emit `subagent:start a1`, then `tool:start {toolCallId:'t1', toolName:'grep',
  agentId:'a1'}`; assert the grep card is inside tile `a1`'s child feed (NOT in a top-level
  `.tool-group`) and the counter reads `1 tool call`. A second child → `2 tool calls`.
- **GREEN:** in `ToolExecution.js` (or main.js routing) add an early guard: a `toolState` with
  `agentId` matching a known tile routes to `SubagentDock.addChildTool(agentId, toolState)`
  (reuse `buildToolHtml`), incrementing the counter; otherwise the existing flat path runs
  unchanged.

### Task 7 — Tile survives main-agent messages (pinned)
- **RED:** emit `subagent:start a1`, one child, then `message:add` with assistant content, then
  another child; assert tile `a1` still present and counter `2` (proves the dock is outside the
  `closeCurrentToolGroup()` lifecycle).
- **GREEN:** ensure dock tiles live in the dock container only; `closeCurrentToolGroup()` never
  references them (no code change if Task 5 placed the dock correctly — the test guards it).

### Task 8 — Completion receipt + failure
- **RED:** emit `subagent:complete {agentId:'a1', status:'complete', durationMs:87168,
  totalToolCalls:13, totalTokens:282777, model:'claude-sonnet-4.6'}`; assert the tile header
  flips to a done icon and shows `13 tool calls · 1m27s · 282,777 tokens · claude-sonnet-4.6`.
  Then `status:'failed', error:'boom'` on another tile → failed icon + error text.
- **GREEN:** `SubagentDock.handleComplete` — look up tile by `agentId`; render receipt; flip icon.

### Task 9 — Concurrency + out-of-order + flat-path regression
- **RED:** emit three `subagent:start` (a1/a2/a3) → 3 tiles; complete in order a2, a3, a1 → each
  tile finalizes independently. Separately: a `tool:start` with **no** `agentId` renders in the
  flat `.tool-group` exactly as before (regression guard); and the dock is hidden when no tiles.
- **GREEN:** keyed-by-`agentId` Map already yields independent tiles; add the empty-dock hide and
  confirm the flat path is untouched.

## Verification
- `npm run compile-tests` then `npm run test:unit` (extension tests) — Tasks 2-4 green.
- `npx mocha tests/unit/components/SubagentDock.test.js` and the ToolExecution suite — Tasks 5-9
  green; existing ToolExecution tests still pass (flat path unchanged).
- `npm run compile` (type-check + lint + esbuild) and full `npm test` — only the known
  `main.js size constraint` baseline failure red.
- **End-to-end:** `./test-extension.sh` → reload → run `plan-intake-review` with a plan in
  `planning/needs-review/`. Confirm: a dock tile appears the instant the reviewer sub-agent
  spawns, its tool calls + counter tick live, and it flips to the receipt on completion — no
  silent window. Cross-check the "Copilot CLI" Output Channel for `[Subagent …]` lines.

## Out of scope (separate backlog)
- SDK examples/docs contribution + close #2261 + lodge the `IdleData` issue →
  `planning/backlog/sdk-contribution-and-close-2261.md`.
- Streaming the sub-agent's **message/reasoning text** into the tile (events already carry
  `agentId`; this builds on the same routing) — fast-follow after status + tool calls land.

## Versioning
Minor — new feature/UI. Suggest **v3.10.0**.
