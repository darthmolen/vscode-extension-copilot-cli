# Plan: Reload Agents on Panel Close (Abort + Resume)

## Problem Statement

When a user adds or edits a custom agent while a session is active, the change is persisted to VS Code config but the **live SDK session has no knowledge of it** — agents are registered only at session creation time. The only way to pick up the change today is to start a new session or reload the window.

**Proposed fix**: When the `CustomAgentsPanel` closes after any mutation (save or delete), abort the current session and resume it with the updated `customAgents` list. This is non-destructive (conversation history is preserved by resume) and requires no window reload.

There is also a pre-existing **gap**: `customAgents` is passed to `createSession` but is missing from the `resumeSession` calls in the startup path and timeout-recovery path.

---

## Approach

1. Fix the two `customAgents` resume gaps first (defensive correctness).
2. Add a `reloadAgents()` method to `SDKSessionManager` — mirrors the timeout-recovery destroy+resume pattern.
3. Track a `_mutatedSinceOpen` dirty flag in `CustomAgentsPanel`; emit `agents:panelClosed` with `{ mutated }` from `hide()`.
4. Wire `agents:panelClosed` in `main.js` → `rpc.agentsPanelClosed()` (only if mutated).
5. Add `agentsPanelClosed` RPC message type; wire in `chatViewProvider.ts` to call `reloadAgents()`.

The close button is the natural commit point — one abort+resume per editing session, not one per save.

---

## Tasks

### Phase 1 — RED: Write failing tests first

- [ ] **1a. `tests/unit/extension/agent-panel-reload.test.js`** (new file)
  - `reloadAgents` is a function on `SDKSessionManager.prototype`
  - When `session` is null → no-op, does not throw
  - When session is active: calls `session.destroy()` then `client.resumeSession(sessionId, opts)`
  - The `opts` passed to `resumeSession` includes a `customAgents` key from `customAgentsService.toSDKAgents()`
  - After reload, `_restoreStickyAgentIfNeeded()` is called (agent selection survives)
  - Emits `status: 'thinking'` before resume, `status: 'ready'` after

- [ ] **1b. Additions to `tests/unit/components/CustomAgentsPanel.test.js`** (new `describe` block)
  - `_mutatedSinceOpen` starts false after construction
  - Emitting `agents:save` (simulating a panel save flow) sets `_mutatedSinceOpen = true`
  - Emitting `agents:delete` sets `_mutatedSinceOpen = true`
  - Calling `hide()` when `_mutatedSinceOpen = true` emits `agents:panelClosed` on EventBus with `{ mutated: true }`
  - Calling `hide()` when `_mutatedSinceOpen = false` emits `agents:panelClosed` with `{ mutated: false }`
  - After `hide()`, `_mutatedSinceOpen` resets to `false`

- [ ] **1c. `tests/unit/extension/rpc-agent-reload.test.js`** (new file or add to `rpc-router.test.js`)
  - `'agentsPanelClosed'` is in `WEBVIEW_TO_EXTENSION_MESSAGES` (messages.ts)
  - `onAgentsPanelClosed` is a function on `ExtensionRpcRouter.prototype`

- [ ] **Run all three test suites → confirm RED** (failure messages match the missing functionality)

### Phase 2 — Gap Fix: `customAgents` missing from resume paths

- [ ] **`src/sdkSessionManager.ts` line ~516-521** (startup resume):
  Add `customAgents: this.customAgentsService.toSDKAgents()` to the `attemptSessionResumeWithUserRecovery` options object.

- [ ] **`src/sdkSessionManager.ts` line ~1174** (timeout-recovery resume):
  Add `customAgents: this.customAgentsService.toSDKAgents()` to the `resumeOptions` object.

- [ ] Run `npm run compile` — no type errors.

### Phase 3 — GREEN: Implement `reloadAgents()`

- [ ] **`src/sdkSessionManager.ts`** — add public method:
  ```typescript
  public async reloadAgents(): Promise<void> {
      if (!this.session || !this.sessionId) {
          this.logger.info('[Agent Reload] No active session, skipping reload');
          return;
      }
      const sessionId = this.sessionId;
      this.logger.info('[Agent Reload] Reloading agents: destroy + resume');
      this._onDidChangeStatus.fire({ status: 'thinking' });
      try {
          await this.session.destroy();
          this.session = null;
          const mcpServers = this.getEnabledMCPServers();
          const hasMcpServers = Object.keys(mcpServers).length > 0;
          this.session = await this.attemptSessionResumeWithUserRecovery(sessionId, {
              model: this.config.model || undefined,
              tools: this.getCustomTools(),
              hooks: this.getSessionHooks(),
              ...(hasMcpServers ? { mcpServers } : {}),
              customAgents: this.customAgentsService.toSDKAgents(),
          });
          this.sessionId = this.session.sessionId;
          await this._restoreStickyAgentIfNeeded();
          this._setupSessionEventHandlers(this.session);
          this.logger.info('[Agent Reload] ✅ Session resumed with updated agents');
          this._onDidChangeStatus.fire({ status: 'ready' });
      } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          this.logger.error('[Agent Reload] Failed: ' + msg);
          this._onDidChangeStatus.fire({ status: 'error' });
      }
  }
  ```

- [ ] Run Phase 1a tests → confirm GREEN.

### Phase 4 — GREEN: RPC message type + router

- [ ] **`src/shared/messages.ts`**:
  - Add `'agentsPanelClosed'` to `WEBVIEW_TO_EXTENSION_MESSAGES` array.
  - Add interface: `export interface AgentsPanelClosedPayload extends BaseMessage { type: 'agentsPanelClosed'; }`
  - Add to `WebviewToExtensionMessage` union type.

- [ ] **`src/extension/rpc/ExtensionRpcRouter.ts`**:
  - Add `onAgentsPanelClosed(handler: MessageHandler<AgentsPanelClosedPayload>): Disposable` method.

- [ ] **`src/chatViewProvider.ts`**:
  - Register handler:
    ```typescript
    this._reg(this.rpcRouter.onAgentsPanelClosed(async () => {
        await this.cliManager?.reloadAgents();
    }));
    ```

- [ ] Run Phase 1c tests → confirm GREEN.

### Phase 5 — GREEN: Panel dirty flag + close event

- [ ] **`src/webview/app/components/CustomAgentsPanel/CustomAgentsPanel.js`**:
  - Add `this._mutatedSinceOpen = false;` in constructor.
  - In `_handleSave()` after `this.eventBus.emit('agents:save', agent)`, add: `this._mutatedSinceOpen = true;`
  - In the delete button click handler after `this.eventBus.emit('agents:delete', agent.name)`, add: `this._mutatedSinceOpen = true;`
  - In `hide()`, before (or after) the DOM manipulation:
    ```javascript
    const mutated = this._mutatedSinceOpen;
    this._mutatedSinceOpen = false;
    this.eventBus.emit('agents:panelClosed', { mutated });
    ```

- [ ] **`src/webview/main.js`**:
  - Add after the existing `agents:delete` wiring:
    ```javascript
    eventBus.on('agents:panelClosed', ({ mutated }) => {
        if (mutated) rpc.agentsPanelClosed();
    });
    ```

- [ ] Run Phase 1b tests → confirm GREEN.

### Phase 6 — Regression

- [ ] `npm test` — all existing tests pass (no regressions).
- [ ] `npm run compile` — no TypeScript errors.

### Phase 7 — Manual verification

- [ ] `./test-extension.sh` — build, package, install VSIX.
- [ ] Reload VS Code window.
- [ ] Open chat, send a message to confirm session is active.
- [ ] Open CustomAgents panel, add a new agent, click close.
- [ ] Check Output Channel — confirm `[Agent Reload] ✅ Session resumed with updated agents`.
- [ ] Send another message — confirm conversation history is preserved.
- [ ] Open panel again without changing anything, close → confirm no reload triggered (Output Channel silent).

---

## Technical Considerations

**Why not reload on every save/delete?**
A save triggers an RPC round-trip (`saveCustomAgent` → `customAgentsChanged` → `setAgents`). Triggering a destroy+resume mid-RPC flight adds complexity. The panel close is a clean, synchronous, single-point commit.

**What if a message is in-flight when the panel closes?**
The `CustomAgentsPanel` is only accessible while the session is idle (the input is blocked during `thinking` status). If somehow the panel is closed mid-flight, `session.destroy()` will cleanly terminate the in-flight message. The `reloadAgents()` method emits `thinking` status first, so the UI will block until resume completes.

**Why emit `agents:panelClosed` always (not just when mutated)?**
The EventBus event is always emitted. Only `main.js` gates the RPC call on `{ mutated: true }`. This keeps the panel's responsibility narrow (track its own state), and lets other future listeners react to every close if needed.

**The `_setupSessionEventHandlers` call in `reloadAgents()`**
The destroy+resume creates a new session object. The existing event handler re-setup pattern used in timeout recovery must be mirrored here. Check `sdkSessionManager.ts` for the exact call signature before implementing.

**Source-string tests in `custom-agents-sdk-wiring.test.js`**
That file contains banned `fs.readFileSync` + `src.includes()` patterns. Do not add more of that pattern. The new tests in Phase 1 use behavioral testing only (prototype method calls, mock contexts).

---

## Files Changed

| File | Change |
|------|--------|
| `src/sdkSessionManager.ts` | Add `customAgents` to 2 resume paths; add `reloadAgents()` |
| `src/shared/messages.ts` | Add `agentsPanelClosed` type + payload interface |
| `src/extension/rpc/ExtensionRpcRouter.ts` | Add `onAgentsPanelClosed()` handler registration |
| `src/chatViewProvider.ts` | Register `onAgentsPanelClosed` → `reloadAgents()` |
| `src/webview/app/components/CustomAgentsPanel/CustomAgentsPanel.js` | Dirty flag + emit `agents:panelClosed` from `hide()` |
| `src/webview/main.js` | Wire `agents:panelClosed` → `rpc.agentsPanelClosed()` |
| `tests/unit/extension/agent-panel-reload.test.js` | New — tests for `reloadAgents()` |
| `tests/unit/components/CustomAgentsPanel.test.js` | Additions — dirty flag + panelClosed tests |
| `tests/unit/extension/rpc-agent-reload.test.js` | New — RPC type + handler registration |

---

## Plan Review

**Reviewed:** 2026-03-15 (auto)
**Reviewer:** Claude Code (plan-review-intake)

### Strengths

1. **Well-identified root cause.** The plan correctly identifies that `customAgents` are only registered at session creation and that resume paths are missing them. The two-gap fix in Phase 2 is a genuine pre-existing bug worth fixing.
2. **Correct commit-point design.** Using panel close as the single reload trigger (rather than per-save or per-delete) avoids mid-RPC-flight complexity and is architecturally clean.
3. **Good TDD structure.** Follows the project's TDD conventions (Red then Green), and correctly notes behavioral testing over string-matching tests.
4. **Mirrors existing patterns.** The `reloadAgents()` method is modeled after the timeout-recovery destroy+resume pattern already in `sdkSessionManager.ts`.
5. **Accurate gap identification at lines ~516-521 and ~1174.** Confirmed: startup resume and timeout-recovery paths both omit `customAgents`, while `createSession` calls include it.

### Issues

#### Critical (Must Address Before Implementation)

1. **Wrong method name: `_setupSessionEventHandlers` does not exist.** The plan's `reloadAgents()` code calls `this._setupSessionEventHandlers(this.session)`. The actual method is `this.setupSessionEventHandlers()` (no underscore prefix, no parameters — see line 640, 646, and 1225 of sdkSessionManager.ts). Will cause a compile error.
   - **Fix:** Change to `this.setupSessionEventHandlers()`.

2. **`WEBVIEW_TO_EXTENSION_MESSAGES` does not exist.** Phase 1c test asserts membership in a non-existent constant. The file uses a `WebviewMessageType` union and a `validTypes` array inside `isWebviewMessage()`.
   - **Fix:** Test behaviorally: pass `{ type: 'agentsPanelClosed' }` to `isWebviewMessage()` and assert it returns `true`.

3. **`chatViewProvider.ts` has no `cliManager` reference.** The plan's Phase 4 handler shows `this.cliManager?.reloadAgents()`, but `ChatViewProvider` has no `cliManager` property. Other features use an event emitter pattern: emitter in ChatViewProvider, handler in extension.ts where `cliManager` is accessible.
   - **Fix:** Add `_onDidRequestReloadAgents` emitter to `ChatViewProvider`, wire in `extension.ts` via `chatProvider.onDidRequestReloadAgents`.

#### Important (Should Address)

4. **Missing `WebviewRpcClient.agentsPanelClosed()` method.** The plan adds the RPC message type and extension-side handler but never mentions adding `agentsPanelClosed()` to `WebviewRpcClient.js`. Without it, `rpc.agentsPanelClosed()` in main.js would be `undefined`.
   - **Fix:** Add task in Phase 4 for `WebviewRpcClient.js`.

5. **Missing `workSession`/`workSessionId`/`currentMode` updates after resume.** The plan sets `this.sessionId` but doesn't update `this.workSession`, `this.workSessionId`, or `this.currentMode`. The timeout-recovery pattern (lines 1217-1221) always updates these.
   - **Fix:** Add `this.workSession = this.session; this.workSessionId = this.sessionId; this.currentMode = 'work';`

6. **Plan mode interaction unaddressed.** If user is in plan mode when editing agents, `reloadAgents()` would destroy the plan session and resume as work session. Timeout-recovery has specific plan-mode branches (lines 1213-1221).
   - **Fix:** Guard `reloadAgents()` to skip or warn if `this.currentMode === 'plan'`, or add plan-mode-aware logic.

7. **`agentsPanelClosed` must be added to `validTypes` in `isWebviewMessage()`.** The hardcoded array at line 617-648 must include the new type or the message will be rejected.

#### Minor (Consider)

8. **Emoji in log message.** CLAUDE.md says "Only use emojis if the user explicitly requests it." Consider `[OK]` or `[Success]` instead of `✅`.
9. **`agents:panelClosed` always emitted but only consumed when mutated.** Could simplify by only emitting when `mutated === true`.
10. **Test file naming for Phase 1c.** Decide whether new file or addition to existing before implementation.

### Recommendations

1. Rename `_setupSessionEventHandlers` to the actual `setupSessionEventHandlers()` in code snippets.
2. Rewrite `chatViewProvider.ts` wiring to use event emitter pattern (emitter in ChatViewProvider, handler in extension.ts).
3. Add `WebviewRpcClient.agentsPanelClosed()` to Files Changed table and Phase 4 tasks.
4. Add `workSession`/`workSessionId`/`currentMode` updates to `reloadAgents()`, matching timeout-recovery pattern.
5. Add plan-mode guard or handling to `reloadAgents()`.
6. Fix Phase 1c test to use `isWebviewMessage()` behavioral assertion.

### Assessment
**Implementable as written?** With fixes
**Reasoning:** The plan's architecture and approach are sound, but three issues would cause compile/runtime failures if implemented literally: wrong method name (`_setupSessionEventHandlers`), missing `cliManager` reference in `chatViewProvider.ts`, and missing `WebviewRpcClient` method. With the fixes above (all straightforward), the plan becomes directly implementable.
