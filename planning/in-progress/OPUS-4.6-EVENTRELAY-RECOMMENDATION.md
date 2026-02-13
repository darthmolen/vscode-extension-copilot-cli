# EventRelay Design Decision: Recommendation

**Date:** 2026-02-12  
**Reviewer:** Claude Opus 4.6  
**Status:** ✅ DECISION MADE  

---

## TL;DR

**Option C (MutableDisposable + extracted handler). Not close.**

EventRelay is the wrong tool for this problem. The SDK's `session.on(callback) → unsubscribe` API doesn't produce `vscode.Event<T>`, so EventRelay can't bridge it without 20 intermediate emitters — a complexity explosion that solves nothing the current architecture doesn't already solve.

---

## The Core Insight

**Your existing `onMessageEmitter` already IS a relay.** It's a stable event source that consumers subscribe to once. When you switch sessions, you just change which SDK session feeds into it. That's the relay pattern — you've already implemented it, just without the EventRelay class.

After Task 1.3 splits `onMessageEmitter` into 10 granular emitters, those emitters become 10 relays:

```
SDK session.on(handler)          ← changes on session switch
  │
  ▼
_handleSDKEvent(event)           ← extracted handler (same logic, any session)
  │
  ▼
switch → _onDidReceiveOutput.fire()    ← STABLE, consumers subscribe once
       → _onDidReceiveReasoning.fire()
       → _onDidChangeStatus.fire()
       → ...10 total
  │
  ▼
extension.ts consumers            ← never resubscribe
```

The only thing `setupSessionEventHandlers()` does on switch is: unsubscribe old `session.on()`, subscribe new `session.on()` with the same handler. That's a 4-line method with `MutableDisposable`.

---

## Why EventRelay Is Wrong Here

### 1. Interface Mismatch

EventRelay expects `vscode.Event<T>` inputs. The SDK gives you `session.on(callback) → () => void`. To bridge this gap, you'd need:

- 10 intermediate `EventEmitter` instances per session × 2 sessions = **20 emitters**
- 10 `EventRelay` instances to switch between them
- Manual subscription management for the SDK→emitter bridge

That's **30 new objects** vs. **1 MutableDisposable** for Option C.

### 2. The Problem EventRelay Solves Doesn't Exist Here

EventRelay solves: "I have two `vscode.Event<T>` sources and need consumers to transparently switch between them."

What you actually have: "I have one `session.on()` subscription that needs to point at a different session object." That's pointer reassignment, not event relay.

### 3. Both Sessions Are Never Active Simultaneously

You're never routing traffic from two live sources. In plan mode, only the plan session fires events. In work mode, only the work session fires. You're always subscribed to exactly one `session.on()` at a time. EventRelay's "transparent switching" capability is solving a concurrency problem that doesn't exist.

---

## The Recommendation: Concrete Implementation

### Step 1: Add granular emitters to `sdkSessionManager.ts` (Task 1.3 — currently broken)

```typescript
import { DisposableStore, MutableDisposable, toDisposable } from './utilities/disposable';

export class SDKSessionManager {
    // Replace manual cleanup tracking
    private readonly _disposables = new DisposableStore();
    private readonly _sessionSub = this._reg(new MutableDisposable<vscode.Disposable>());

    // Granular emitters (created once, survive session switches)
    private readonly _onDidReceiveOutput = this._reg(new vscode.EventEmitter<string>());
    readonly onDidReceiveOutput = this._onDidReceiveOutput.event;

    private readonly _onDidReceiveReasoning = this._reg(new vscode.EventEmitter<string>());
    readonly onDidReceiveReasoning = this._onDidReceiveReasoning.event;

    private readonly _onDidReceiveError = this._reg(new vscode.EventEmitter<string>());
    readonly onDidReceiveError = this._onDidReceiveError.event;

    private readonly _onDidChangeStatus = this._reg(new vscode.EventEmitter<any>());
    readonly onDidChangeStatus = this._onDidChangeStatus.event;

    private readonly _onDidStartTool = this._reg(new vscode.EventEmitter<ToolExecutionState>());
    readonly onDidStartTool = this._onDidStartTool.event;

    private readonly _onDidUpdateTool = this._reg(new vscode.EventEmitter<ToolExecutionState>());
    readonly onDidUpdateTool = this._onDidUpdateTool.event;

    private readonly _onDidCompleteTool = this._reg(new vscode.EventEmitter<ToolExecutionState>());
    readonly onDidCompleteTool = this._onDidCompleteTool.event;

    private readonly _onDidChangeFile = this._reg(new vscode.EventEmitter<any>());
    readonly onDidChangeFile = this._onDidChangeFile.event;

    private readonly _onDidProduceDiff = this._reg(new vscode.EventEmitter<any>());
    readonly onDidProduceDiff = this._onDidProduceDiff.event;

    private readonly _onDidUpdateUsage = this._reg(new vscode.EventEmitter<any>());
    readonly onDidUpdateUsage = this._onDidUpdateUsage.event;

    private _reg<T extends vscode.Disposable>(d: T): T {
        this._disposables.add(d);
        return d;
    }
```

### Step 2: Extract handler + use MutableDisposable (Task 1.4 + 1.6)

```typescript
    // setupSessionEventHandlers shrinks from 117 lines to 4
    private setupSessionEventHandlers(): void {
        if (!this.session) { return; }
        this._sessionSub.value = toDisposable(
            this.session.on((event: any) => this._handleSDKEvent(event))
        );
    }

    // Extracted handler — identical logic, just fires granular emitters
    private _handleSDKEvent(event: any): void {
        this.logger.debug(`[SDK Event] ${event.type}: ${JSON.stringify(event.data)}`);

        switch (event.type) {
            case 'assistant.message':
                // intent extraction logic stays here
                if (event.data.content?.trim().length > 0) {
                    this._onDidReceiveOutput.fire(event.data.content);
                }
                break;
            case 'assistant.reasoning':
                this._onDidReceiveReasoning.fire(event.data.content);
                break;
            case 'session.error':
                this._onDidReceiveError.fire(event.data.message);
                break;
            case 'tool.execution_start':
                this.handleToolStart(event);  // fires _onDidStartTool internally
                break;
            case 'tool.execution_progress':
                this.handleToolProgress(event);  // fires _onDidUpdateTool
                break;
            case 'tool.execution_complete':
                this.handleToolComplete(event);  // fires _onDidCompleteTool + _onDidChangeFile + _onDidProduceDiff
                break;
            case 'assistant.turn_start':
                this._onDidChangeStatus.fire({ status: 'thinking', turnId: event.data.turnId });
                break;
            case 'assistant.turn_end':
                this._onDidChangeStatus.fire({ status: 'ready', turnId: event.data.turnId });
                break;
            case 'session.usage_info':
                this._onDidUpdateUsage.fire({
                    currentTokens: event.data.currentTokens,
                    tokenLimit: event.data.tokenLimit,
                    messagesLength: event.data.messagesLength
                });
                break;
            case 'assistant.usage':
                // quota logic → fire _onDidUpdateUsage
                break;
            // session.start, session.resume, session.idle → log only
        }
    }
```

### Step 3: Update dispose()

```typescript
    public dispose(): void {
        this.stop();
        this.messageEnhancementService.dispose();
        this.fileSnapshotService.dispose();
        if (this.planModeToolsService) {
            this.planModeToolsService.dispose();
        }
        this._disposables.dispose();  // cleans up ALL emitters + _sessionSub
    }
```

Remove `sessionUnsubscribe` field entirely. Remove `onMessageEmitter` once all consumers are migrated.

### Step 4: Keep EventRelay in utilities

It's well-built (62 lines, 9/9 tests). It'll be useful when you genuinely need `vscode.Event<T>` → `vscode.Event<T>` relay, such as switching between webview panel instances or MCP server connections. Don't delete good code just because it's not the right tool for this specific job.

---

## Addressing the "6 Call Sites" Concern

The plan's goal was "remove 4 manual resubscription call sites." After this refactor:

- `setupSessionEventHandlers()` is **4 lines** instead of 117
- Each call site is a trivial `_sessionSub.value = toDisposable(...)` under the hood
- No manual unsubscribe tracking — `MutableDisposable` handles it
- No risk of forgetting cleanup — disposal is automatic

The 6 call sites remain, but they're now **trivially cheap** to execute and **impossible to leak**. The plan's spirit (eliminate manual resubscription complexity) is fully achieved even though the method still gets called.

If you want to reduce call sites further, you could consolidate them by having `setActiveSession(session)` as a single method that both reassigns `this.session` and calls `setupSessionEventHandlers()`. That takes 6 call sites to 1 definition + 5 callers of a 2-line method. But that's cosmetic — the architectural problem is already solved.

---

## Blocking Issue: The Code Doesn't Compile

`extension.ts` references 10 granular events (`onDidReceiveOutput`, etc.) that don't exist on `SDKSessionManager`. TypeScript confirms: 20 compilation errors. **Task 1.3 was marked complete but never applied.**

This must be fixed before anything else. The implementation above IS the fix for Task 1.3 + 1.4 + 1.6 combined.

### Also: Missing Status Handlers in extension.ts

The current `onDidChangeStatus` handler only handles `thinking` and `ready`. The old monolithic switch used to handle:

| Status | What It Did |
|--------|-------------|
| `exited` / `stopped` | Set session inactive, update status bar |
| `aborted` | Show "Generation stopped" message |
| `session_expired` | Auto-start new session |
| `plan_mode_enabled/disabled` | Forward to webview |
| `plan_accepted/rejected` | Forward to webview |
| `plan_ready` | Forward to webview |
| `reset_metrics` | Forward to webview |

These were fired as `type: 'status'` through `onMessageEmitter`. After the split to `onDidChangeStatus`, these MUST be re-added to the handler in `extension.ts`, OR the status events in `sdkSessionManager.ts` must continue firing through a separate channel (like keeping `onMessage` for status events that go to the webview).

**Recommendation:** Keep `onMessageEmitter` temporarily as a compatibility layer for status→webview forwarding, or add dedicated handlers for each status type. Don't silently drop functionality.

---

## Summary

| Question | Answer |
|----------|--------|
| Which option? | **C: MutableDisposable + extracted handler** |
| Is EventRelay worth it? | **No.** SDK interface makes it unnecessary. 20 intermediate emitters for zero benefit. |
| Is the complexity worth the benefit? | **MutableDisposable is negative complexity** — it removes the manual `sessionUnsubscribe` tracking. Net simplification. |
| What about EventRelay? | **Keep it.** Good utility, wrong problem. Will find use later. |
| What's blocking? | **Task 1.3 was never applied.** Fix that first — everything else follows. |
