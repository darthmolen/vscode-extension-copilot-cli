# Event Architecture Recommendations for 3.0

**Date:** 2026-02-12

---

## Current State

The extension has three distinct event flows, each using a different pattern:

| Flow | Pattern | Issue |
|------|---------|-------|
| SDK → Extension Host | Single `vscode.EventEmitter<CLIMessage>` + switch | Monolithic, tight coupling |
| Extension Host → Webview | Static methods calling `postMessage()` | No disposal, no lifecycle |
| Webview internal | Custom `EventBus` pub/sub | Works well, but untyped |

---

## Recommendation 1: Split Single `onMessage` into Granular `onDid*` Events

**Current** (`sdkSessionManager.ts` lines 75-76):
```typescript
private readonly onMessageEmitter = new vscode.EventEmitter<CLIMessage>();
public readonly onMessage = this.onMessageEmitter.event;
```

**Recommended:**
```typescript
class SDKSessionManager implements vscode.Disposable {
    private readonly _disposables = new DisposableStore();

    // One emitter per event type — follows VS Code naming convention
    private readonly _onDidReceiveOutput = this._reg(new vscode.EventEmitter<string>());
    private readonly _onDidReceiveReasoning = this._reg(new vscode.EventEmitter<string>());
    private readonly _onDidReceiveError = this._reg(new vscode.EventEmitter<string>());
    private readonly _onDidChangeStatus = this._reg(new vscode.EventEmitter<StatusData>());
    private readonly _onDidStartTool = this._reg(new vscode.EventEmitter<ToolExecutionState>());
    private readonly _onDidUpdateTool = this._reg(new vscode.EventEmitter<ToolExecutionState>());
    private readonly _onDidCompleteTool = this._reg(new vscode.EventEmitter<ToolExecutionState>());
    private readonly _onDidChangeFile = this._reg(new vscode.EventEmitter<FileChangeData>());
    private readonly _onDidProduceDiff = this._reg(new vscode.EventEmitter<DiffData>());
    private readonly _onDidUpdateUsage = this._reg(new vscode.EventEmitter<UsageData>());

    // Public events
    readonly onDidReceiveOutput = this._onDidReceiveOutput.event;
    readonly onDidReceiveReasoning = this._onDidReceiveReasoning.event;
    // ... etc

    private _reg<T extends vscode.Disposable>(d: T): T {
        this._disposables.add(d);
        return d;
    }

    dispose() { this._disposables.dispose(); }
}
```

**Result in `extension.ts`** — the 87-line switch becomes clean per-event subscriptions:
```typescript
context.subscriptions.push(
    cliManager.onDidReceiveOutput((text) => {
        chatPanel.addAssistantMessage(text);
        chatPanel.setThinking(false);
    }),
    cliManager.onDidStartTool((state) => {
        chatPanel.addToolExecution(state);
    }),
    cliManager.onDidUpdateUsage((usage) => {
        chatPanel.postMessage({ type: 'usage_info', data: usage });
    })
);
```

Each consumer subscribes only to events it cares about. No switch statement. TypeScript infers the payload type from the event.

---

## Recommendation 2: Convert ChatPanelProvider to Instance-Based with Disposable

**Current:** Static class with `Set<Function>` handler collections, no `dispose()`.

**Recommended:**
```typescript
class ChatPanelProvider implements vscode.Disposable {
    private readonly _disposables = new DisposableStore();
    private _panel: vscode.WebviewPanel | undefined;
    private _rpcRouter: ExtensionRpcRouter | undefined;

    // Events emitted by the panel (webview intents)
    private readonly _onDidReceiveUserMessage = this._reg(new vscode.EventEmitter<UserMessageData>());
    private readonly _onDidRequestAbort = this._reg(new vscode.EventEmitter<void>());
    private readonly _onDidRequestViewPlan = this._reg(new vscode.EventEmitter<void>());
    private readonly _onDidBecomeReady = this._reg(new vscode.EventEmitter<void>());

    readonly onDidReceiveUserMessage = this._onDidReceiveUserMessage.event;
    readonly onDidRequestAbort = this._onDidRequestAbort.event;
    readonly onDidRequestViewPlan = this._onDidRequestViewPlan.event;
    readonly onDidBecomeReady = this._onDidBecomeReady.event;

    createOrShow(): void {
        if (this._panel) { this._panel.reveal(); return; }

        this._panel = vscode.window.createWebviewPanel(/* ... */);
        this._disposables.add(this._panel.onDidDispose(() => this._handleDispose()));
        this._disposables.add(this._panel.onDidChangeViewState(e => this._handleViewState(e)));

        this._rpcRouter = new ExtensionRpcRouter(this._panel.webview);
        this._disposables.add(this._rpcRouter);

        // All handler disposables tracked
        this._disposables.add(this._rpcRouter.onReady(() => this._onDidBecomeReady.fire()));
        this._disposables.add(this._rpcRouter.onSendMessage(p => this._onDidReceiveUserMessage.fire(p)));
        this._disposables.add(this._rpcRouter.listen());
    }

    dispose(): void {
        this._panel?.dispose();
        this._disposables.dispose();
    }

    private _reg<T extends vscode.Disposable>(d: T): T {
        this._disposables.add(d); return d;
    }
}
```

**Impact:** Eliminates all 6 `Set<Function>` collections. Enables proper cleanup. Makes the class a proper VS Code citizen.

---

## Recommendation 3: Implement EventRelay for Session Switching

**Problem:** `enablePlanMode()` and `disablePlanMode()` manually call `setupSessionEventHandlers()` to unsubscribe from the old session and resubscribe to the new one. This pattern repeats at 4 call sites.

**Solution — EventRelay (from VS Code's internal `Relay<T>` pattern):**

```typescript
class EventRelay<T> implements vscode.Disposable {
    private readonly _emitter = new vscode.EventEmitter<T>();
    private _subscription: vscode.Disposable | undefined;

    readonly event = this._emitter.event;

    set input(source: vscode.Event<T>) {
        this._subscription?.dispose();
        this._subscription = source((data) => this._emitter.fire(data));
    }

    clear(): void {
        this._subscription?.dispose();
        this._subscription = undefined;
    }

    dispose(): void {
        this._subscription?.dispose();
        this._emitter.dispose();
    }
}
```

**Usage:**
```typescript
// One relay per event type
private readonly _outputRelay = new EventRelay<string>();
readonly onDidReceiveOutput = this._outputRelay.event;

enablePlanMode() {
    const planSession = await this.createPlanSession();
    this._outputRelay.input = planSession.onDidReceiveOutput;
    // Existing listeners continue working — no resubscription needed
}

disablePlanMode() {
    this._outputRelay.input = this._workSession.onDidReceiveOutput;
    // Seamless switch back
}
```

**Result:** Eliminates all 4 manual resubscription sites. Existing listeners survive session switches transparently.

---

## Recommendation 4: Add Event Buffering for Startup Race

**Problem:** SDK events can fire before the webview sends `ready`.

**Solution — BufferedEmitter:**

```typescript
class BufferedEmitter<T> implements vscode.Disposable {
    private _buffer: T[] = [];
    private _hasListener = false;
    private readonly _emitter = new vscode.EventEmitter<T>();

    get event(): vscode.Event<T> {
        return (listener, thisArgs?, disposables?) => {
            if (!this._hasListener && this._buffer.length > 0) {
                // Flush buffered events to first listener
                for (const item of this._buffer) {
                    listener.call(thisArgs, item);
                }
                this._buffer = [];
            }
            this._hasListener = true;
            return this._emitter.event(listener, thisArgs, disposables);
        };
    }

    fire(data: T) {
        if (!this._hasListener) {
            this._buffer.push(data);
        } else {
            this._emitter.fire(data);
        }
    }

    dispose() {
        this._buffer = [];
        this._emitter.dispose();
    }
}
```

**Usage:** Replace `vscode.EventEmitter` with `BufferedEmitter` for events that may fire before the webview is ready.

---

## Recommendation 5: Add MutableDisposable for Session Subscriptions

**Current** (`sdkSessionManager.ts` line 92):
```typescript
private sessionUnsubscribe: (() => void) | null = null;
```

**Recommended:**
```typescript
function toDisposable(fn: () => void): vscode.Disposable {
    return { dispose: fn };
}

class SDKSessionManager {
    private readonly _sessionSub = new MutableDisposable<vscode.Disposable>();

    setupSessionEventHandlers(): void {
        // MutableDisposable auto-disposes the previous value
        this._sessionSub.value = toDisposable(
            this.session.on((event) => this._handleSDKEvent(event))
        );
    }

    dispose() {
        this._sessionSub.dispose();
    }
}
```

---

## Recommendation 6: Typed RPC Router with Mapped Types

**Current:** 11 individual `on*` methods (onSendMessage, onAbortMessage, etc.)

**Recommended — single typed `on<K>()` method:**

```typescript
interface WebviewMessageMap {
    sendMessage: SendMessagePayload;
    abortMessage: AbortMessagePayload;
    ready: ReadyPayload;
    switchSession: SwitchSessionPayload;
    newSession: NewSessionPayload;
    viewPlan: ViewPlanPayload;
    viewDiff: ViewDiffPayload;
    togglePlanMode: TogglePlanModePayload;
    acceptPlan: AcceptPlanPayload;
    rejectPlan: RejectPlanPayload;
    pickFiles: PickFilesPayload;
}

class TypedRouter implements vscode.Disposable {
    private readonly _disposables = new DisposableStore();
    private handlers = new Map<string, Function>();

    on<K extends keyof WebviewMessageMap>(
        type: K,
        handler: (payload: WebviewMessageMap[K]) => void
    ): vscode.Disposable {
        this.handlers.set(type, handler);
        const d = { dispose: () => { this.handlers.delete(type); } };
        this._disposables.add(d);
        return d;
    }

    route(msg: WebviewMessage) {
        const handler = this.handlers.get(msg.type);
        if (handler) {
            try { handler(msg); }
            catch (e) { console.error(`[RPC] Error in ${msg.type}:`, e); }
        }
    }

    dispose() { this._disposables.dispose(); this.handlers.clear(); }
}
```

Reduces 11 methods to 1 with full type inference at every call site.

---

## Recommendation 7: Do NOT Add External Event Libraries

After evaluating ts-bus, Typed-Event-Bus, ts-event-bus, and RxJS:

- VS Code's `EventEmitter<T>` already provides the needed functionality
- The webview boundary requires `postMessage` regardless — no library bypasses this
- Each library adds bundle size without proportional benefit
- Third-party event systems don't integrate with VS Code's `Disposable` lifecycle
- The per-event typed emitter pattern provides equivalent type safety

**Verdict:** Use VS Code's native event primitives exclusively.

---

## Event Flow: Before vs After

### Before (Current)
```
SDK Event → single onMessage emitter → 87-line switch in extension.ts
    → static ChatPanelProvider methods → postMessage → webview
    → scroll event handler → EventBus → components
```

### After (Recommended)
```
SDK Event → granular onDid* emitters → per-event subscriptions in extension.ts
    → instance ChatPanelProvider methods → TypedRouter.send() → webview
    → EventBus → components (unchanged)
```

Key difference: every subscription returns a `Disposable`, every `Disposable` is tracked in a `DisposableStore`, every class implements `vscode.Disposable`.

---

## Utility Types to Implement

```typescript
// DisposableStore — manages multiple disposables
class DisposableStore implements vscode.Disposable {
    private _disposables = new Set<vscode.Disposable>();
    add<T extends vscode.Disposable>(d: T): T {
        this._disposables.add(d);
        return d;
    }
    dispose() {
        for (const d of this._disposables) d.dispose();
        this._disposables.clear();
    }
}

// MutableDisposable — manages a single changeable disposable
class MutableDisposable<T extends vscode.Disposable> implements vscode.Disposable {
    private _value: T | undefined;
    get value(): T | undefined { return this._value; }
    set value(newValue: T | undefined) {
        this._value?.dispose();
        this._value = newValue;
    }
    dispose() { this._value?.dispose(); this._value = undefined; }
}

// toDisposable — wraps a plain function
function toDisposable(fn: () => void): vscode.Disposable {
    return { dispose: fn };
}
```

These three utilities cover all the patterns needed. Total: ~30 lines.
