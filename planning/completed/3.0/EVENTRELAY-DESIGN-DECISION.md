# EventRelay Design Decision - Task 1.4

**Date:** 2026-02-12  
**Status:** ❓ DESIGN REVIEW NEEDED  
**Context:** Phase 1, Task 1.4 - Implement EventRelay for Session Switching

---

## Problem Statement

### What We're Trying to Achieve

**Goal:** Eliminate manual event resubscription when switching between work and plan sessions in dual-session plan mode.

**Current Pain Point:** `setupSessionEventHandlers()` is called **6 times** throughout the codebase:
1. Line 315 - After creating work session
2. Line 752 - After resuming session
3. Line 817 - After switching sessions  
4. Line 1067 - In `enablePlanMode()` 
5. Line 1172 - In `disablePlanMode()`
6. Line 357 - The method definition itself (117 lines)

Each call creates a new 117-line subscription to the SDK session's event stream.

---

## Current Implementation (Before EventRelay)

### Architecture

```typescript
class SDKSessionManager {
    private session: any | null = null;  // Current SDK session
    private sessionUnsubscribe: (() => void) | null = null;  // Cleanup function
    private readonly onMessageEmitter = new vscode.EventEmitter<CLIMessage>();
    public readonly onMessage = this.onMessageEmitter.event;
    
    // Called 6 times when session changes
    private setupSessionEventHandlers(): void {
        if (!this.session) { return; }
        
        // Dispose old subscription
        if (this.sessionUnsubscribe) {
            this.sessionUnsubscribe();
            this.sessionUnsubscribe = null;
        }
        
        // Create new subscription (117 lines!)
        this.sessionUnsubscribe = this.session.on((event: any) => {
            switch (event.type) {
                case 'assistant.message':
                    this.onMessageEmitter.fire({ type: 'output', data: event.data.content });
                    break;
                case 'assistant.reasoning':
                    this.onMessageEmitter.fire({ type: 'reasoning', data: event.data.content });
                    break;
                // ... 10+ more event types (117 lines total)
            }
        });
    }
}
```

### How Session Switching Works

```typescript
enablePlanMode() {
    this.session = this.planSession;
    this.setupSessionEventHandlers();  // Re-create all subscriptions
}

disablePlanMode() {
    this.session = this.workSession;
    this.setupSessionEventHandlers();  // Re-create all subscriptions again
}
```

### Why This Works But Is Problematic

✅ **What works:**
- Event emitters persist across switches
- Consumers don't need to resubscribe
- Old subscriptions are properly disposed

❌ **What's problematic:**
- 117-line method called repeatedly
- Manual cleanup tracking (`sessionUnsubscribe` field)
- Code duplication (same logic executed 6 times)
- Not using the disposal utilities we just created

---

## What We've Implemented (EventRelay Utility)

### The EventRelay Class

Created: `src/utilities/eventRelay.ts` (62 lines, fully tested)

```typescript
class EventRelay<T> implements vscode.Disposable {
    private readonly _emitter = new vscode.EventEmitter<T>();
    private _subscription: vscode.Disposable | undefined;
    
    readonly event = this._emitter.event;
    
    set input(source: vscode.Event<T> | undefined) {
        // Auto-dispose old subscription
        this._subscription?.dispose();
        this._subscription = undefined;
        
        // Subscribe to new source
        if (source) {
            this._subscription = source((data: T) => {
                this._emitter.fire(data);
            });
        }
    }
    
    dispose(): void { /* cleanup */ }
}
```

**Key Feature:** Setting `relay.input = newEvent` automatically disposes the old subscription.

### Test Coverage

✅ 9/9 tests passing:
- Basic event relay
- Source switching (work ↔ plan)
- Subscription disposal
- Clear/dispose lifecycle
- Type safety
- Multiple consumers
- Edge cases

---

## The Design Question

### Proposed EventRelay Pattern

**How it would work:**

```typescript
class SDKSessionManager {
    // Create intermediate EventEmitters for each session
    private _workOutputEmitter = new vscode.EventEmitter<string>();
    private _planOutputEmitter = new vscode.EventEmitter<string>();
    
    // EventRelay switches between them
    private readonly _outputRelay = new EventRelay<string>();
    public readonly onDidReceiveOutput = this._outputRelay.event;
    
    constructor() {
        // Set up ONCE per session (not on every switch)
        this.workSession.on((event) => {
            if (event.type === 'assistant.message') {
                this._workOutputEmitter.fire(event.data.content);
            }
        });
        
        this.planSession.on((event) => {
            if (event.type === 'assistant.message') {
                this._planOutputEmitter.fire(event.data.content);
            }
        });
        
        // Point relay at work session initially
        this._outputRelay.input = this._workOutputEmitter.event;
    }
    
    enablePlanMode() {
        // Just switch the relay input - NO re-subscription!
        this._outputRelay.input = this._planOutputEmitter.event;
    }
    
    disablePlanMode() {
        this._outputRelay.input = this._workOutputEmitter.event;
    }
}
```

**Result:**
- ✅ No `setupSessionEventHandlers()` calls
- ✅ Subscriptions created once
- ✅ Session switching is just `relay.input = otherEmitter.event`
- ✅ Clean, minimal code

### The Implementation Challenge

**Problem:** SDK's `session.on()` returns a **cleanup function**, not a `vscode.Event<T>`.

```typescript
// SDK API
const unsubscribe = session.on((event) => { /* handle event */ });
// returns: () => void (cleanup function)
// NOT: vscode.Event<T>
```

**This means:**
1. We can't directly use `EventRelay` with SDK sessions
2. We need intermediate `EventEmitter` instances
3. We need to track subscriptions to those intermediate emitters

**Architecture becomes:**

```
SDK Session.on()
  └─> (handler) ──fires──> Intermediate EventEmitter
                              └─> relay.input ──fires──> Public Event
                                                            └─> Consumers
```

### The Confusion

**What I got stuck on:**

1. **EventRelay works with vscode.Event<T>**, not SDK's `session.on()`
2. Need intermediate EventEmitters for **each session** (work + plan)
3. Need intermediate EventEmitters for **each event type** (10 types × 2 sessions = 20 emitters!)
4. This is getting complex - is it actually cleaner?

---

## The Trade-offs

### Option A: Keep Current Implementation

**Current:** `setupSessionEventHandlers()` + manual `sessionUnsubscribe`

**Pros:**
- ✅ Already works
- ✅ Simple architecture (1 emitter per event type)
- ✅ No intermediate emitters needed
- ✅ Easy to understand

**Cons:**
- ❌ 117-line method called 6 times
- ❌ Manual disposal tracking
- ❌ Not using our new utilities
- ❌ Plan says "remove 4 manual resubscription call sites"

### Option B: Apply EventRelay Pattern

**Proposed:** EventRelay + intermediate EventEmitters

**Pros:**
- ✅ No repeated `setupSessionEventHandlers()` calls
- ✅ Uses our new utilities
- ✅ Subscriptions created once, switched cleanly
- ✅ Aligns with plan's vision

**Cons:**
- ❌ Requires 20 intermediate EventEmitters (10 types × 2 sessions)
- ❌ More complex architecture
- ❌ More code to write
- ❌ Harder to understand

### Option C: Hybrid - MutableDisposable Pattern

**Alternative:** Use `MutableDisposable` from our utilities instead of manual `sessionUnsubscribe`

```typescript
class SDKSessionManager {
    private readonly _sessionSub = new MutableDisposable<vscode.Disposable>();
    
    private setupSessionEventHandlers(): void {
        // Auto-disposes old value when set
        this._sessionSub.value = toDisposable(
            this.session.on((event) => { /* ... */ })
        );
    }
}
```

**Pros:**
- ✅ Uses our disposal utilities
- ✅ Minimal changes to current code
- ✅ Auto-disposal built-in
- ✅ Simple, understandable

**Cons:**
- ❌ Still calls `setupSessionEventHandlers()` 6 times
- ❌ Doesn't fully eliminate the pattern plan wanted gone

---

## The Question for Review

**Which option should we choose?**

1. **Keep current** - Works, simple, but not using new utilities
2. **Full EventRelay** - Aligns with plan but complex (20 intermediate emitters)
3. **Hybrid MutableDisposable** - Middle ground, uses utilities, less complex

**Or is there a 4th option I'm missing?**

---

## Code References

### Current Implementation
- `src/sdkSessionManager.ts` lines 357-473: `setupSessionEventHandlers()`
- 6 call sites: lines 315, 752, 817, 1067, 1172

### EventRelay Implementation
- `src/utilities/eventRelay.ts` (62 lines)
- `tests/event-relay.test.js` (9 tests, all passing)

### Plan Reference
- `planning/in-progress/3.0-FOUNDATION-FIX-PLUS.md` Task 1.4
- Goal: "Remove 4 manual resubscription call sites"

---

## Request

**Please review and advise:**
1. Which architectural approach is cleanest?
2. Is the complexity of EventRelay worth it for this use case?
3. Should we just use MutableDisposable and call it done?
4. Is there a simpler pattern I'm not seeing?

**Current Status:** EventRelay utility is built and tested. Just need to decide if/how to apply it.

---

## Second Opinion: External Review (Claude Opus 4.6, 2026-02-12)

**Reviewer:** Fresh Claude session, reviewing all code review documents, source code, and progress.

### Critical Finding: The Code Is Currently Broken

Before addressing the design question, I need to flag a blocking issue.

**`extension.ts` references methods that don't exist on `SDKSessionManager`:**

```
extension.ts:411  cliManager.onDidReceiveOutput(...)
extension.ts:418  cliManager.onDidReceiveReasoning(...)
extension.ts:424  cliManager.onDidReceiveError(...)
extension.ts:430  cliManager.onDidChangeStatus(...)
extension.ts:440  cliManager.onDidStartTool(...)
extension.ts:445  cliManager.onDidUpdateTool(...)
extension.ts:450  cliManager.onDidCompleteTool(...)
extension.ts:455  cliManager.onDidChangeFile(...)
extension.ts:459  cliManager.onDidProduceDiff(...)
extension.ts:464  cliManager.onDidUpdateUsage(...)
```

**`sdkSessionManager.ts` still only has:**
```typescript
private readonly onMessageEmitter = new vscode.EventEmitter<CLIMessage>();
public readonly onMessage = this.onMessageEmitter.event;
private sessionUnsubscribe: (() => void) | null = null;
```

None of the granular events exist. None of the disposal utilities are imported. The `_reg` helper doesn't exist. **Task 1.3 ("Split onMessage into granular events") and Task 1.6 ("Fix session unsubscribe pattern") are marked COMPLETE but the changes were never applied to `sdkSessionManager.ts`.**

The extension will crash on startup if compiled in its current state.

### Critical Finding #2: Status Event Handlers Were Dropped

The old `extension.ts` switch statement handled these status types that the new code **does not**:

| Lost Status Handler | What It Did |
|---|---|
| `exited` / `stopped` | Set session inactive, update status bar, notify user |
| `aborted` | Show "Generation stopped by user" message |
| `session_expired` | Update backend state, show visual separator, auto-start new session |
| `plan_mode_enabled/disabled` | Forward to webview for UI state changes |
| `plan_accepted/rejected` | Forward to webview |
| `reset_metrics` | Forward to webview |
| `plan_ready` | Forward to webview |

The new `onDidChangeStatus` handler only handles `thinking` and `ready`. **This is a significant regression that will break plan mode, session recovery, and abort functionality.**

---

### The Answer: Option C (MutableDisposable), But With a Crucial Insight

**You're already doing what EventRelay does. You just don't realize it.**

Here's what the current architecture looks like:

```
SDK session.on(handler)           <- Single subscription per session
  |
  v
setupSessionEventHandlers()       <- Creates new subscription
  |
  v
handler fires onMessageEmitter    <- STABLE emitter, persists across switches
  |
  v
Consumers (extension.ts)          <- Subscribe once, never resubscribe
```

**The `onMessageEmitter` IS the relay.** It's a stable event source that consumers subscribe to once, and the upstream source (which SDK session feeds it) changes when you call `setupSessionEventHandlers()`. This is conceptually identical to what EventRelay does.

After Task 1.3 is actually applied, the architecture becomes:

```
SDK session.on(handler)
  |
  v
_handleSDKEvent(event)            <- Extracted handler method
  |
  v
switch → _onDidReceiveOutput.fire()   <- 10 STABLE granular emitters
       → _onDidReceiveReasoning.fire()
       → _onDidChangeStatus.fire()
       → ...etc
  |
  v
Consumers (extension.ts)          <- Subscribe once to granular events
```

**The granular emitters ARE the relays.** They persist across session switches. Consumers subscribe once. When you switch sessions, you just change which SDK session feeds into the same dispatch handler.

The only thing `setupSessionEventHandlers()` does on a session switch is:
1. Unsubscribe from old `session.on()`
2. Subscribe to new `session.on()` with the same handler

That's it. That's a 3-line operation with `MutableDisposable`:

```typescript
private readonly _sessionSub = new MutableDisposable<vscode.Disposable>();

private setupSessionEventHandlers(): void {
    if (!this.session) { return; }
    this._sessionSub.value = toDisposable(
        this.session.on((event: any) => this._handleSDKEvent(event))
    );
}
```

`setupSessionEventHandlers()` is no longer a 117-line method. It's 4 lines. Calling it 6 times is trivial.

### Why EventRelay Is Wrong For This Use Case

EventRelay solves the problem of switching between **two `vscode.Event<T>` sources**. But:

1. **The SDK doesn't give you `vscode.Event<T>`.** It gives you `session.on(callback) => unsubscribe`. You can't plug this directly into EventRelay.

2. **To use EventRelay, you'd need intermediate emitters.** You'd need one `EventEmitter` per event type per session (10 types x 2 sessions = 20 emitters), plus 10 relays. That's 30 new objects to manage vs. 0 new objects with Option C.

3. **The problem EventRelay solves doesn't exist here.** The granular emitters themselves are already the stable interface that consumers subscribe to. There's nothing to relay between.

4. **Both sessions can't be active simultaneously anyway.** You're never routing traffic from two live sources. You're always subscribing to exactly one `session.on()` at a time.

### Recommendation: What To Actually Do

**Step 1: Finish Task 1.3 for real.** Add the granular events to `sdkSessionManager.ts`:

```typescript
// In SDKSessionManager class:
private readonly _disposables = new DisposableStore();
private readonly _sessionSub = this._reg(new MutableDisposable<vscode.Disposable>());

// Granular emitters (created once, persist across session switches)
private readonly _onDidReceiveOutput = this._reg(new vscode.EventEmitter<string>());
readonly onDidReceiveOutput = this._onDidReceiveOutput.event;
// ... repeat for all 10 event types

private _reg<T extends vscode.Disposable>(d: T): T {
    this._disposables.add(d);
    return d;
}

private setupSessionEventHandlers(): void {
    if (!this.session) { return; }
    this._sessionSub.value = toDisposable(
        this.session.on((event: any) => this._handleSDKEvent(event))
    );
}

private _handleSDKEvent(event: any): void {
    // Extracted from old setupSessionEventHandlers - same switch logic
    // but firing granular emitters instead of monolithic onMessageEmitter
    switch (event.type) {
        case 'assistant.message':
            if (event.data.content?.trim().length > 0) {
                this._onDidReceiveOutput.fire(event.data.content);
            }
            break;
        case 'assistant.reasoning':
            this._onDidReceiveReasoning.fire(event.data.content);
            break;
        // ... etc
    }
}
```

**Step 2: Fix the missing status handlers in `extension.ts`.** Re-add ALL the status event handling that was dropped. The `onDidChangeStatus` handler needs to handle `exited`, `stopped`, `aborted`, `session_expired`, `plan_mode_enabled/disabled`, `plan_accepted/rejected`, `reset_metrics`, and `plan_ready` - exactly as the old switch statement did.

**Step 3: Mark Task 1.4 as COMPLETE** without applying EventRelay to session switching. The task's goal was "eliminate manual resubscription" and that's achieved by Task 1.3 + MutableDisposable. The `setupSessionEventHandlers()` call sites remain, but the method is now 4 lines instead of 117, and cleanup is automatic.

**Step 4: Keep EventRelay in the utilities folder.** It's a well-built, well-tested utility. It may prove useful later (e.g., if you ever need to relay between two `vscode.Event<T>` sources, like switching between webview panels). No need to delete good code.

### Summary

| Question | Answer |
|---|---|
| Which approach is cleanest? | **Option C** (MutableDisposable + extracted handler) |
| Is EventRelay worth it here? | **No.** The SDK interface makes it unnecessary. The granular emitters already serve as the stable relay point. |
| Should we just use MutableDisposable? | **Yes.** Combined with extracting `_handleSDKEvent()`, this gives you everything the plan wanted. |
| Is there a 4th option? | **Not needed.** Option C, done right, achieves all the plan's goals. |
| What's the immediate blocker? | **Task 1.3 was never applied to `sdkSessionManager.ts`.** Do that first. Everything else follows. |
| What's the hidden regression? | **Status handlers dropped in `extension.ts`.** Plan mode, abort, session expiry all broken. |
