# Fix: Agent select/deselect — sticky vs one-shot

## Problem

The current implementation calls `session.rpc.agent.select()` + `deselect()` on **every message**, even when the agent was set via `/agent` (sticky). This is wrong — the SDK's `agent.select()` is session-level and persistent. Calling `deselect()` after every message defeats the sticky semantics entirely: the agent is cleared as soon as the first reply lands.

**Correct behavior:**
- `/agent reviewer` → `agent.select('reviewer')` once → stays selected for all subsequent messages
- `/agent` (clear) → `agent.deselect()` once → back to auto-inference
- `@reviewer fix this` (one-shot) → `select('reviewer')` → `sendAndWait()` → restore previous state in `finally` (re-select sticky if one was active, otherwise `deselect()`)

## Root Cause

Two problems:
1. `sdkSessionManager.sendMessage()` does `select/deselect` per message regardless of whether the agent came from a one-shot `@mention` or a sticky session agent.
2. The `/agent` slash command handler in `chatViewProvider.ts` only updates `backendState` and sends the webview badge update — it **never calls** `session.rpc.agent.select()`. The SDK session is never actually told about the sticky agent until the next message fires.

## Approach

- Add `selectAgent(name)` and `deselectAgent()` public methods to `SDKSessionManager` that call the SDK RPC directly and track `_sessionAgent` state.
- Wire `/agent` handler in `chatViewProvider` to call `cliManager.selectAgent/deselectAgent()` — add `onDidSelectAgent` event to `ChatViewProvider`, handle in `extension.ts`.
- In `sendMessage()`: `agentName` param becomes one-shot only (`@mention`). If a one-shot overrides a sticky, restore the sticky in `finally` instead of blindly deselecting.
- In `main.js`: stop passing sticky `_activeAgent.name` as `agentName` in the send RPC. The SDK already has it selected. Only `@mention` produces `agentName` in the payload.

## TDD Iron Laws

1. Write the test FIRST — import actual production code, not mocks
2. Watch the test FAIL before writing any fix
3. Minimal code change — only what makes the test pass

---

## Tasks (RED → GREEN order)

### Phase 1: SDKSessionManager — selectAgent/deselectAgent methods

- [ ] **1a. RED** — Add to `tests/unit/extension/custom-agents-sdk-wiring.test.js`:
  - `sdkSessionManager.selectAgent` is a function
  - `sdkSessionManager.deselectAgent` is a function
  - Calling `selectAgent('reviewer')` calls `session.rpc.agent.select({ name: 'reviewer' })`
  - Calling `deselectAgent()` calls `session.rpc.agent.deselect()`
  - `selectAgent()` stores name internally (verify via `_sessionAgent` or subsequent behavior)
  - Run → FAIL (methods don't exist) ✅

- [ ] **1b. GREEN** — Add to `src/sdkSessionManager.ts`:
  ```typescript
  private _sessionAgent: string | null = null;

  public async selectAgent(name: string): Promise<void> {
      if (!this.session) return;
      await this.session.rpc.agent.select({ name });
      this._sessionAgent = name;
      this.logger.info(`[Agent] Session agent selected: ${name}`);
  }

  public async deselectAgent(): Promise<void> {
      if (!this.session) return;
      await this.session.rpc.agent.deselect();
      this._sessionAgent = null;
      this.logger.info(`[Agent] Session agent cleared`);
  }
  ```
  - Run tests → GREEN ✅

### Phase 2: sendMessage — fix per-message select/deselect

- [ ] **2a. RED** — Add to `tests/unit/extension/custom-agents-sdk-wiring.test.js`:
  - When `_sessionAgent` is null and no `agentName` passed → `agent.select` NOT called
  - When `_sessionAgent = 'reviewer'` and no `agentName` passed → `agent.select` NOT called (already selected)
  - When `agentName = 'planner'` (one-shot) and `_sessionAgent = null` → `select('planner')` called, `deselect()` called in finally
  - When `agentName = 'planner'` (one-shot) and `_sessionAgent = 'reviewer'` → `select('planner')` called, `select('reviewer')` called in finally (restore, not deselect)
  - Run → FAIL ✅

- [ ] **2b. GREEN** — Update `sendMessage()` in `src/sdkSessionManager.ts`:
  - Replace the current select/deselect block:
    ```typescript
    // One-shot @mention override
    const isOneShot = !!agentName && agentName !== this._sessionAgent;
    if (isOneShot) {
        try {
            await this.session.rpc.agent.select({ name: agentName! });
        } catch (e) {
            this.logger.warn(`[Agent] Failed to select one-shot agent "${agentName}": ...`);
        }
    }

    try {
        await this.session.sendAndWait(sendOptions);
    } finally {
        if (isOneShot) {
            try {
                if (this._sessionAgent) {
                    // Restore the sticky agent
                    await this.session.rpc.agent.select({ name: this._sessionAgent });
                } else {
                    await this.session.rpc.agent.deselect();
                }
            } catch { /* ignore */ }
        }
    }
    ```
  - Run tests → GREEN ✅

### Phase 3: ChatViewProvider — wire /agent to SDK

- [ ] **3a. RED** — Add to `tests/unit/extension/slash-command-agent.test.js`:
  - `chatViewProvider.ts` source includes `onDidSelectAgent` event emitter
  - `chatViewProvider.ts` fires `onDidSelectAgent` with agent name in `onSelectAgent` handler
  - Run → FAIL ✅

- [ ] **3b. GREEN** — Add to `src/chatViewProvider.ts`:
  ```typescript
  private readonly _onDidSelectAgent = this._reg(new vscode.EventEmitter<string | null>());
  readonly onDidSelectAgent = this._onDidSelectAgent.event;
  ```
  - In `onSelectAgent` handler, after setting `backendState` and sending webview update, add:
    ```typescript
    this._onDidSelectAgent.fire(agentName || null);
    ```
  - Run tests → GREEN ✅

- [ ] **3c. RED** — Add to `tests/unit/extension/slash-command-agent.test.js`:
  - `extension.ts` source subscribes to `chatProvider.onDidSelectAgent`
  - `extension.ts` source calls `cliManager.selectAgent` or `cliManager.deselectAgent` in the handler
  - Run → FAIL ✅

- [ ] **3d. GREEN** — Add to `src/extension.ts` (near `onDidReceiveUserMessage` subscription):
  ```typescript
  context.subscriptions.push(chatProvider.onDidSelectAgent(async (agentName) => {
      try {
          if (agentName) {
              await cliManager.selectAgent(agentName);
          } else {
              await cliManager.deselectAgent();
          }
      } catch (e) {
          logger.warn(`[Agent] SDK select/deselect failed: ${e}`);
      }
  }));
  ```
  - Run tests → GREEN ✅

### Phase 4: main.js — stop passing sticky agent through sendMessage RPC

- [ ] **4a. RED** — Add to `tests/unit/components/main-integration.test.js` (or InputArea test):
  - When `_activeAgent` is set (sticky) and user sends plain text (no `@mention`), `rpc.sendMessage` is called WITHOUT `agentName` in payload
  - When user sends `@reviewer fix this` with no sticky agent, `rpc.sendMessage` IS called with `agentName: 'reviewer'`
  - When user sends `@reviewer fix this` with sticky `planner` active, `rpc.sendMessage` IS called with `agentName: 'reviewer'` (mention wins)
  - Run → FAIL ✅

- [ ] **4b. GREEN** — Update `src/webview/main.js` send handler:
  ```javascript
  // BEFORE (wrong — passes sticky through RPC):
  const agentName = data.agentName || (_activeAgent ? _activeAgent.name : undefined);
  rpc.sendMessage(data.text, ..., agentName);

  // AFTER (correct — only @mention goes through RPC):
  // Sticky agent is already selected at SDK session level via selectAgent().
  // Only one-shot @mention overrides need to be passed here.
  rpc.sendMessage(data.text, ..., data.agentName);
  ```
  - Run tests → GREEN ✅

### Phase 5: Session resume/create — restore sticky agent

- [ ] **5. Update `src/sdkSessionManager.ts`**:
  - Clear `_sessionAgent = null` when session is destroyed/recreated (in `start()`, `stop()`, or wherever session teardown happens)
  - On session resume: if `backendState.getActiveAgent()` is set, call `selectAgent()` after session is established
  - This ensures the sticky agent survives reconnects/session resumes

### Phase 6: Run full test suite

- [ ] `npm test` — zero new failures vs baseline (1388 passing)
- [ ] Manual: `/agent reviewer` → send messages → SDK keeps reviewer selected (no deselect/reselect on each turn)
- [ ] Manual: `@planner do X` with no sticky → planner used once, back to auto-infer
- [ ] Manual: `/agent reviewer` sticky → `@planner do X` → planner used once, reviewer restored
- [ ] Manual: `/agent` (no args) → session agent cleared, back to auto-infer

---

## Files to Change

| File | Change |
|---|---|
| `src/sdkSessionManager.ts` | Add `selectAgent()`, `deselectAgent()`, `_sessionAgent` field; fix `sendMessage()` select/deselect logic; clear on reset; restore on resume |
| `src/chatViewProvider.ts` | Add `_onDidSelectAgent` emitter; fire it in `onSelectAgent` handler |
| `src/extension.ts` | Subscribe to `onDidSelectAgent`; call `cliManager.selectAgent/deselectAgent` |
| `src/webview/main.js` | Remove sticky `_activeAgent` from RPC send payload; only `@mention` passes `agentName` |
| `tests/unit/extension/custom-agents-sdk-wiring.test.js` | New tests for `selectAgent`, `deselectAgent`, one-shot restore behavior |
| `tests/unit/extension/slash-command-agent.test.js` | New tests for `onDidSelectAgent` event, extension.ts wiring |
| `tests/unit/components/main-integration.test.js` | New tests for sticky vs @mention payload behavior |

## Anti-Patterns to Avoid

- ❌ Testing that `select()` is called N times in a loop — test the outcome (correct agent active after N messages)
- ❌ Skipping the RED phase — every new test must fail before the fix
- ❌ Mocking `session.rpc.agent` with a stub that always returns success — use a spy that records calls
- ❌ Assuming `_sessionAgent` and `backendState.activeAgent` are the same thing — they are parallel: `backendState` drives UI, `_sessionAgent` drives SDK

---

## Plan Review

**Reviewed:** 2026-03-15
**Reviewer:** Claude Code (plan-review-intake)

### Strengths

1. **Accurate root cause analysis.** The plan correctly identifies both problems: (a) `sendMessage()` does select/deselect on every message regardless of sticky state (confirmed at `sdkSessionManager.ts` lines 1085-1103), and (b) the `/agent` handler only updates `backendState` and sends the webview badge but never calls `session.rpc.agent.select()` (confirmed at `chatViewProvider.ts` lines 368-385).

2. **Correct SDK API usage.** References to `session.rpc.agent.select({ name })` and `session.rpc.agent.deselect()` verified against `research/copilot-sdk/nodejs/src/generated/rpc.ts` lines 579-582 with exact signatures.

3. **Well-structured TDD phases.** RED-GREEN ordering in Phases 1-4 follows the project's strict TDD conventions with explicit failure expectations.

4. **Correct data flow architecture.** The event emitter pattern (`onDidSelectAgent` on ChatViewProvider, subscribed in `extension.ts`) follows the existing codebase pattern — matches how `onDidReceiveUserMessage` works.

5. **Anti-Patterns section.** The distinction between `_sessionAgent` (SDK state) and `backendState.activeAgent` (UI state) is important and correctly called out.

### Issues

#### Critical (Must Address Before Implementation)

**1. Phase 3 tests (3a, 3c) use string-includes assertions against source code — violates CLAUDE.md conventions.**
- **Section:** Phase 3, tasks 3a and 3c
- **What's wrong:** Tests like `chatViewProvider.ts source includes 'onDidSelectAgent'` and `extension.ts source calls 'cliManager.selectAgent'` are source-string assertions. CLAUDE.md explicitly prohibits this: "Tests that assert the presence of string literals, import statements, or commented-out code are not testing anything real."
- **Why it matters:** These tests can pass when the string appears in a comment. The project has documented history of this exact failure mode (the StatusBar incident in CLAUDE.md).
- **Fix:** Phase 3a should instantiate `ChatViewProvider` with mocks, subscribe to `onDidSelectAgent`, trigger the `onSelectAgent` handler, and assert the event fires. Phase 3c should test the wiring behaviorally.

#### Important (Should Address)

**2. Phase 5 lacks tests — breaks TDD contract.**
- **Section:** Phase 5
- **What's wrong:** No RED phase. Only implementation bullets with no test task. Violates the plan's own "TDD Iron Laws" section.
- **Fix:** Add Phase 5a RED: test that after `stop()`, `_sessionAgent` is null; test that after session resume with `backendState.getActiveAgent()` returning `'reviewer'`, `selectAgent('reviewer')` is called.

**3. Missing test case: one-shot same as sticky agent.**
- **Section:** Phase 2a
- **What's wrong:** The `isOneShot` logic (`agentName !== this._sessionAgent`) means `@reviewer` with sticky `reviewer` is a no-op. This edge case is unstated and untested.
- **Fix:** Add test: "When `agentName = 'reviewer'` and `_sessionAgent = 'reviewer'`, `agent.select` NOT called, `agent.deselect` NOT called."

**4. Race condition on rapid `/agent` switching.**
- **Section:** Phase 1b
- **What's wrong:** If user types `/agent reviewer` then immediately `/agent planner` before first `selectAgent()` RPC resolves, `_sessionAgent` could be inconsistent.
- **Fix:** Document as known limitation (acceptable since UI serializes user actions), or add simple guard.

**5. Silent no-op when session is null needs documentation.**
- **Section:** Phase 1b
- **What's wrong:** `if (!this.session) return;` silently does nothing. If `/agent reviewer` runs before session exists, SDK is never told. Phase 5 handles deferred select, but this connection is implicit.
- **Fix:** Add a note in Phase 1b that the silent return is intentional because Phase 5 handles deferred select on session start.

**6. Version number: labeled 3.6.0 but that version is already released.**
- **Section:** Filename
- **What's wrong:** `package.json` is already at `3.6.0` and the latest commit is `docs: 3.6.0 README and CHANGELOG updates`. This is a bug fix → should be `3.6.1` per CLAUDE.md semver rules.
- **Fix:** Rename plan to `3-6-1-agent-select-deselect-bug.md` and bump version accordingly.

#### Minor (Consider)

**7.** Existing `custom-agents-sdk-wiring.test.js` string-includes tests (lines 45-67) could be refactored to behavioral tests while touching this file.

**8.** Logging in `selectAgent`/`deselectAgent` could include session ID for debugging dual-session (plan mode) scenarios.

### Recommendations

1. **Rewrite Phase 3 tests as behavioral tests.** Most impactful improvement. Do not perpetuate the source-includes pattern.
2. **Add Phase 5 tests.** Session resume is a real user scenario (sidebar hide/show, VS Code restart). Skipping TDD undermines the plan's discipline.
3. **Correct the version number to 3.6.1.** This is clearly a bug fix, not a new feature.

### Assessment
**Implementable as written?** With fixes.
**Reasoning:** The core architecture (new methods on SDKSessionManager, event emitter on ChatViewProvider, wiring in extension.ts, webview payload change) is sound and follows established patterns. Two blocking issues: (1) Phase 3's tests use source-includes assertions that violate explicit project conventions, and (2) Phase 5 has no tests, breaking the plan's own TDD contract. Fix those and this plan is ready to execute.