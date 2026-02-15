# v4.0 Event Architecture Transition: Typed Event Bus + RxJS

**Date:** 2026-02-14
**Status:** Planning
**Branch:** `planning/4.0`
**Prerequisite:** v3.0 complete and stable

---

## 1. Executive Summary

The v3.0 release established a clean event-driven architecture with 10 granular `BufferedEmitter` events in `SDKSessionManager`, 4 `EventEmitter` events in `ChatViewProvider`, and a `TypedRpcRouter` bridging the webview boundary. The manual event wiring in `extension.ts` — specifically `wireManagerEvents()` and `registerChatProviderHandlers()` — acts as a hand-coded mediator, subscribing to each source event and routing data to the appropriate destination. This works, but it doesn't scale: every new event requires modifying `extension.ts`, there's no compositional tooling for combining or transforming event streams, and the growing file increasingly mixes orchestration with business logic.

Version 4.0 introduces a **typed event bus** backed by **RxJS Observables** to replace the manual wiring. Think of this as moving from hand-wired `event?.Invoke()` delegates in C# to a formal event bus — except instead of request/response (MediatR), we're dealing with event streams. RxJS provides the compositional operators (`map`, `filter`, `switchMap`, `debounce`, `buffer`) that `vscode.EventEmitter` and our custom `BufferedEmitter` cannot offer. The discriminated union event registry provides the type safety that C# developers expect from strongly-typed event arguments.

The migration is **incremental across 4 phases**, each independently shippable. No existing tests break at any phase boundary. The RPC layer (`ExtensionRpcRouter`) stays unchanged — it handles the webview `postMessage` boundary and is not part of this refactor.

### Why Revisit 3.0's Recommendation 7?

v3.0's code review explicitly recommended against external event libraries including RxJS, citing:
- VS Code's `EventEmitter` provides needed functionality
- Third-party systems don't integrate with VS Code's `Disposable` lifecycle
- Bundle size concerns

These concerns are addressed in this document (see Section 5). The key insight: the extension has grown past the point where raw EventEmitters are sufficient, and the Disposable integration is trivially solvable.

---

## 2. Current Architecture (Post-3.0)

### 2.1 What 3.0 Established

**SDKSessionManager** (`src/sdkSessionManager.ts`):
- 10 `BufferedEmitter<T>` instances with typed payloads
- All registered to `DisposableStore` via `_reg()` helper
- Session switching uses `MutableDisposable` (4 lines, down from 117)
- Single `_handleSDKEvent(event)` routes SDK events to correct emitter

| Event | Payload Type |
|-------|-------------|
| `onDidReceiveOutput` | `string` |
| `onDidReceiveReasoning` | `string` |
| `onDidReceiveError` | `string` |
| `onDidChangeStatus` | `StatusData` |
| `onDidStartTool` | `ToolExecutionState` |
| `onDidUpdateTool` | `ToolExecutionState` |
| `onDidCompleteTool` | `ToolExecutionState` |
| `onDidChangeFile` | `FileChangeData` |
| `onDidProduceDiff` | `DiffData` |
| `onDidUpdateUsage` | `UsageData` |

**ChatViewProvider** (`src/chatViewProvider.ts`):
- 4 `vscode.EventEmitter<T>` instances

| Event | Payload Type |
|-------|-------------|
| `onDidReceiveUserMessage` | `{text, attachments?}` |
| `onDidRequestAbort` | `void` |
| `onDidRequestViewPlan` | `void` |
| `onDidBecomeReady` | `void` |

**extension.ts Mediator**:
- `wireManagerEvents()`: 10 `context.subscriptions.push()` calls (~107 lines of wiring)
- `registerChatProviderHandlers()`: 4 subscriptions (~70 lines)
- `safeHandler()` wrapper for error isolation
- Status handler contains a 30-line switch statement
- Total: ~180 lines of pure event wiring code

**RPC Layer** (`src/extension/rpc/ExtensionRpcRouter.ts`):
- 19 send methods (extension → webview)
- 18 receive handlers (webview → extension)
- Fully typed via discriminated unions in `src/shared/messages.ts`

### 2.2 What Works Well

- **Type safety within each layer** — `BufferedEmitter<T>` gives typed payloads
- **Disposable lifecycle** — `DisposableStore`, `MutableDisposable`, `toDisposable()` handle cleanup
- **Session switching** — 4-line `setupSessionEventHandlers()` with `MutableDisposable`
- **Startup race prevention** — `BufferedEmitter` buffers events until first listener
- **Error isolation** — `safeHandler()` prevents one handler from breaking others

### 2.3 What's Fragile

1. **extension.ts grows with every new event** — Adding a new event means touching 4 files: emitter declaration, subscription wiring, provider method, RPC send method.

2. **No event composition** — The status handler has a 30-line switch to dispatch different status types. There's no way to subscribe to "only plan mode status changes" without filtering manually.

3. **Business logic in wiring code** — Diff computation (file reading, inline diff generation) happens inline in a subscription handler. That's domain logic mixed into orchestration.

4. **No declarative subscriptions** — Each subscription is imperative. Compare to Angular's `this.store.select(selectUsers).pipe(takeUntil(this.destroy$))`.

5. **Scattered state updates** — `backendState.setSessionActive(false)` appears in the status handler, `backendState.setSessionId()` in `onSessionStarted()` — side effects buried in handlers.

---

## 3. Target Architecture

### 3.1 Conceptual Model (C# Analogy)

**Current: each class declares its own events (like C# delegates)**

```csharp
// Current: each class owns its events
public class SDKSessionManager {
    public event EventHandler<string> OutputReceived;
    public event EventHandler<StatusData> StatusChanged;
}

// Consumer manually wires each one in Startup.cs
manager.OutputReceived += (s, e) => chatView.AddMessage(e);
manager.StatusChanged += (s, e) => HandleStatus(e);
```

**Target: single bus with typed events (like a typed event bus / INotification)**

```csharp
// Target: events are typed records published to a bus
public record OutputReceived(string Content) : INotification;
public record StatusChanged(StatusData Data) : INotification;

// Consumer declares interest
bus.Subscribe<OutputReceived>(e => chatView.AddMessage(e.Content));
```

But with RxJS, we gain operators that a simple bus doesn't have — `filter`, `map`, `switchMap`, `debounceTime`, `buffer`, `takeUntil`. This is exactly the RxJS you know from Angular services.

### 3.2 Typed Event Registry (Discriminated Union)

All extension-side events are unified into a single discriminated union — the TypeScript equivalent of a sealed hierarchy of C# records implementing `INotification`.

We already have this pattern in `src/shared/messages.ts` for RPC messages. We apply the same pattern to extension-side events.

```typescript
// src/events/types.ts

interface BaseEvent {
    readonly type: string;
    readonly timestamp: number;
}

// SDK events
interface OutputReceivedEvent extends BaseEvent {
    type: 'sdk.output.received';
    content: string;
}

interface ReasoningReceivedEvent extends BaseEvent {
    type: 'sdk.reasoning.received';
    content: string;
}

interface ErrorReceivedEvent extends BaseEvent {
    type: 'sdk.error.received';
    message: string;
}

interface StatusChangedEvent extends BaseEvent {
    type: 'sdk.status.changed';
    data: StatusData;
}

interface ToolStartedEvent extends BaseEvent {
    type: 'sdk.tool.started';
    state: ToolExecutionState;
}

interface ToolUpdatedEvent extends BaseEvent {
    type: 'sdk.tool.updated';
    state: ToolExecutionState;
}

interface ToolCompletedEvent extends BaseEvent {
    type: 'sdk.tool.completed';
    state: ToolExecutionState;
}

interface FileChangedEvent extends BaseEvent {
    type: 'sdk.file.changed';
    data: FileChangeData;
}

interface DiffProducedEvent extends BaseEvent {
    type: 'sdk.diff.produced';
    data: DiffData;
}

interface UsageUpdatedEvent extends BaseEvent {
    type: 'sdk.usage.updated';
    data: UsageData;
}

// ChatView events
interface UserMessageReceivedEvent extends BaseEvent {
    type: 'chatview.user.message';
    text: string;
    attachments?: Array<{type: 'file'; path: string; displayName?: string}>;
}

interface AbortRequestedEvent extends BaseEvent {
    type: 'chatview.abort.requested';
}

interface ViewPlanRequestedEvent extends BaseEvent {
    type: 'chatview.viewplan.requested';
}

interface WebviewReadyEvent extends BaseEvent {
    type: 'chatview.webview.ready';
}

// The discriminated union
type ExtensionEvent =
    | OutputReceivedEvent
    | ReasoningReceivedEvent
    | ErrorReceivedEvent
    | StatusChangedEvent
    | ToolStartedEvent
    | ToolUpdatedEvent
    | ToolCompletedEvent
    | FileChangedEvent
    | DiffProducedEvent
    | UsageUpdatedEvent
    | UserMessageReceivedEvent
    | AbortRequestedEvent
    | ViewPlanRequestedEvent
    | WebviewReadyEvent;

// Type-safe extraction
type EventOfType<T extends ExtensionEvent['type']> =
    Extract<ExtensionEvent, { type: T }>;
```

### 3.3 RxJS Event Bus

The bus is a thin wrapper around an RxJS `Subject<ExtensionEvent>`:

```typescript
// src/events/EventBus.ts
import { Subject, Observable } from 'rxjs';
import { filter } from 'rxjs/operators';
import * as vscode from 'vscode';

export class EventBus implements vscode.Disposable {
    private readonly _subject = new Subject<ExtensionEvent>();
    private _disposed = false;

    /** Publish an event (like C# event.Invoke() or MediatR Publish()) */
    publish(event: ExtensionEvent): void {
        if (!this._disposed) {
            this._subject.next(event);
        }
    }

    /** Subscribe to ALL events (rarely needed) */
    get events$(): Observable<ExtensionEvent> {
        return this._subject.asObservable();
    }

    /** Type-safe subscribe to a specific event type */
    on<T extends ExtensionEvent['type']>(
        type: T
    ): Observable<EventOfType<T>> {
        return this._subject.pipe(
            filter((e): e is EventOfType<T> => e.type === type)
        );
    }

    dispose(): void {
        this._disposed = true;
        this._subject.complete();
    }
}
```

### 3.4 How extension.ts Shrinks

```typescript
// BEFORE: ~107 lines of imperative wiring in wireManagerEvents()
context.subscriptions.push(manager.onDidReceiveOutput(safeHandler('output', (content) => {
    logger.debug(`[CLI Output] ${content}`);
    chatProvider.addAssistantMessage(content);
    chatProvider.setThinking(false);
})));
// ... 9 more of these

// AFTER: ~30 lines of declarative composition
function setupEventPipelines(bus: EventBus, chatProvider: ChatViewProvider): vscode.Disposable {
    const store = new DisposableStore();

    // Output -> UI
    store.add(toDisposable(
        bus.on('sdk.output.received').subscribe(e => {
            logger.debug(`[CLI Output] ${e.content}`);
            chatProvider.addAssistantMessage(e.content);
            chatProvider.setThinking(false);
        })
    ));

    // Status: thinking
    store.add(toDisposable(
        bus.on('sdk.status.changed').pipe(
            filter(e => e.data.status === 'thinking')
        ).subscribe(() => chatProvider.setThinking(true))
    ));

    // Status: plan mode events
    store.add(toDisposable(
        bus.on('sdk.status.changed').pipe(
            filter(e => ['plan_mode_enabled', 'plan_mode_disabled'].includes(e.data.status))
        ).subscribe(e => chatProvider.resetPlanMode(e.data))
    ));

    // Diff: compute inline diff, then notify UI
    store.add(toDisposable(
        bus.on('sdk.diff.produced').pipe(
            map(e => ({ ...e, inlineDiff: computeInlineDiff(e.data) }))
        ).subscribe(e => chatProvider.notifyDiffAvailable(e))
    ));

    return store;
}
```

### 3.5 Adding New Events (Open/Closed Principle)

In the current architecture, adding a "model changed" event requires touching 4 files. With the bus:

1. Add `ModelChangedEvent` to the discriminated union in `types.ts`
2. Publish `bus.publish({ type: 'sdk.model.changed', ... })` from SDKSessionManager
3. Subscribe `bus.on('sdk.model.changed').subscribe(...)` wherever you need it

No changes to extension.ts orchestration. The bus is open for extension, closed for modification.

---

## 4. Migration Strategy

Each phase is independently shippable. No existing tests break at any phase boundary.

### Phase 1: Foundation (Add RxJS, Create Adapters)

**Goal**: Add RxJS dependency, create `EventBus` class, create adapters. No behavior changes.

**C# Analogy**: Adding MediatR to your solution and creating the first `INotificationHandler` wrapper. Nothing changes yet.

**Files to create**:
| File | Purpose | Est. Lines |
|------|---------|-----------|
| `src/events/types.ts` | Discriminated union of all 14 event types | ~120 |
| `src/events/EventBus.ts` | RxJS Subject wrapper with typed `on<T>()` | ~50 |
| `src/events/adapters.ts` | Bridge existing emitters to bus | ~40 |
| `src/events/disposable.ts` | RxJS Subscription → vscode.Disposable adapters | ~30 |
| `src/events/index.ts` | Barrel export | ~10 |
| `tests/unit/events/event-bus.test.js` | EventBus unit tests | ~80 |
| `tests/unit/events/adapters.test.js` | Adapter tests | ~60 |
| `tests/unit/events/disposable.test.js` | Disposable adapter tests | ~40 |

**Files to modify**:
| File | Change |
|------|--------|
| `package.json` | Add `rxjs` to dependencies |

**esbuild.js**: No changes needed — rxjs is bundled by esbuild (Node target), not a webview ES module.

**Verification**:
```bash
npx tsc --noEmit          # No type errors
npx mocha tests/unit/events/**/*.test.js  # New tests pass
npm test                   # All existing tests pass (no regressions)
node esbuild.js            # Bundle builds
./test-extension.sh        # VSIX packages
```

**Rollback**: Revert the commit. RxJS is only referenced by new files.

---

### Phase 2: Dual-Write (Publish to Bus Alongside Existing Emitters)

**Goal**: Wire the `EventBus` into `SDKSessionManager` and `ChatViewProvider` so they **publish** to the bus alongside their existing emitters. Both old emitters and new bus fire. No consumers change.

**C# Analogy**: Adding `_mediator.Publish(new OrderCreated(...))` alongside `OrderCreated?.Invoke(...)` in your domain service. Both fire, nobody listens to the bus yet.

**Files to modify**:
| File | Change |
|------|--------|
| `src/sdkSessionManager.ts` | Accept `EventBus` in constructor, add `bus.publish()` next to each `fire()` in `_handleSDKEvent()` |
| `src/chatViewProvider.ts` | Accept `EventBus` (via constructor or setter), add `bus.publish()` next to each `fire()` |
| `src/extension.ts` | Create `EventBus` instance, pass to both constructors |

**Estimated scope**: ~50 lines of additions (mostly `bus.publish()` calls).

**Verification**:
```bash
npm test                   # All existing tests pass (dual-write = no behavior change)
# New integration tests verify bus receives events
```

**Rollback**: Remove `bus.publish()` calls. No consumer depends on the bus yet.

---

### Phase 3: Replace Manual Wiring in extension.ts

**Goal**: Replace `wireManagerEvents()` and `registerChatProviderHandlers()` with bus subscriptions. The bus becomes the primary routing mechanism.

**C# Analogy**: Removing manual event subscriptions and letting the mediator route everything.

**Key transformations**:

1. **Status switch statement** → multiple focused subscriptions with `filter()`:
   ```typescript
   bus.on('sdk.status.changed').pipe(
       filter(e => e.data.status === 'thinking')
   ).subscribe(...)

   bus.on('sdk.status.changed').pipe(
       filter(e => ['plan_mode_enabled', 'plan_mode_disabled'].includes(e.data.status))
   ).subscribe(...)
   ```

2. **Diff computation** → `map()` operator:
   ```typescript
   bus.on('sdk.diff.produced').pipe(
       map(e => computeInlineDiffForEvent(e))
   ).subscribe(e => chatProvider.notifyDiffAvailable(e))
   ```

3. **All subscriptions** → `subscriptionToDisposable()` adapter + `context.subscriptions`

**Files to modify**:
| File | Change |
|------|--------|
| `src/extension.ts` | Replace `wireManagerEvents()` (~107 lines) with `setupEventPipelines()` (~40 lines). Replace `registerChatProviderHandlers()` (~70 lines) with bus subscriptions (~25 lines). |

**Expected result**: extension.ts shrinks by ~100+ lines net.

**Verification**:
```bash
npm test                   # All tests pass
npx tsc --noEmit           # Type checks
# Manual smoke test: send message, tool execution, diff view, plan mode, abort
wc -l src/extension.ts     # Should be < 600 lines (down from 752)
```

**Rollback**: Revert extension.ts. Phase 2's dual-write means old emitters still work.

---

### Phase 4: Remove Legacy Emitters (Optional Cleanup)

**Goal**: Remove `BufferedEmitter` instances from `SDKSessionManager` and `EventEmitter` instances from `ChatViewProvider`. The bus is the single source of truth.

**C# Analogy**: Removing old `event EventHandler<T>` declarations after all consumers migrated.

**Why optional**: The dual-write from Phase 2 is harmless. If removing emitters introduces risk, skip this phase entirely.

**Files to modify**:
| File | Change |
|------|--------|
| `src/sdkSessionManager.ts` | Remove 10 `BufferedEmitter` instances and public accessors |
| `src/chatViewProvider.ts` | Remove 4 `EventEmitter` instances and public accessors |
| `src/utilities/bufferedEmitter.ts` | Can be deleted (replaced by RxJS operators) |

**Replaced concepts**:
| v3.0 Concept | v4.0 Replacement |
|-------------|------------------|
| `BufferedEmitter<T>` | `ReplaySubject<T>(1)` or `shareReplay(1)` |
| `EventRelay` (built, unused) | `switchMap` over session observable |
| `safeHandler()` wrapper | `catchError` operator |

**Verification**:
```bash
npm test
npx tsc --noEmit
grep -r "BufferedEmitter" src/   # Zero results
./test-extension.sh              # VSIX packages
```

---

## 5. RxJS + VS Code Disposable Integration

This section directly addresses v3.0 Recommendation 7's concern: *"Third-party systems don't integrate with VS Code's Disposable lifecycle."*

### 5.1 The Concern

VS Code's lifecycle management relies on `vscode.Disposable` — objects with a `dispose()` method. RxJS `Subscription` has `unsubscribe()`, not `dispose()`. This creates a lifecycle mismatch.

### 5.2 The Solution: One-Line Adapter

We already have `toDisposable()` in `src/utilities/disposable.ts`:

```typescript
export function toDisposable(fn: () => void): vscode.Disposable {
    return { dispose: fn };
}
```

Wrapping an RxJS subscription:

```typescript
// src/events/disposable.ts
import { Subscription } from 'rxjs';

export function subscriptionToDisposable(sub: Subscription): vscode.Disposable {
    return { dispose: () => sub.unsubscribe() };
}

// Usage:
const sub = bus.on('sdk.output.received').subscribe(handler);
context.subscriptions.push(subscriptionToDisposable(sub));
```

### 5.3 The takeUntil(dispose$) Pattern (Angular Developers Know This)

For component-scoped cleanup — identical to Angular's `takeUntil(this.destroy$)` in `ngOnDestroy`:

```typescript
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

class MyService implements vscode.Disposable {
    private readonly _dispose$ = new Subject<void>();

    constructor(private bus: EventBus) {
        // All subscriptions auto-cleanup on dispose()
        bus.on('sdk.output.received').pipe(
            takeUntil(this._dispose$)
        ).subscribe(e => this.handleOutput(e));

        bus.on('sdk.status.changed').pipe(
            takeUntil(this._dispose$)
        ).subscribe(e => this.handleStatus(e));
    }

    dispose(): void {
        this._dispose$.next();
        this._dispose$.complete();
    }
}
```

### 5.4 Comparison: Current vs Target

| Aspect | Current (EventEmitter) | Target (RxJS + Bus) |
|--------|----------------------|---------------------|
| Cleanup | Manual: push each disposable to list | Automatic: `takeUntil(dispose$)` cleans all |
| Error isolation | Manual: `safeHandler()` wrapper | Built-in: `catchError` operator |
| Composition | None: each subscription is independent | Full: `filter`, `map`, `switchMap`, `debounce` |
| Buffering | Custom: `BufferedEmitter` class | Built-in: `ReplaySubject`, `shareReplay` |
| Session switching | Custom: `MutableDisposable` | Built-in: `switchMap` over session observable |
| Testing | Mock each emitter separately | Single bus, publish test events |

**Bottom line**: RxJS integration with VS Code's Disposable lifecycle is a solved problem, not a blocker.

---

## 6. Event Naming Convention

Events follow `{source}.{domain}.{action}` in past tense:

| Event Type | Source | Domain | Action |
|-----------|--------|--------|--------|
| `sdk.output.received` | SDK | output | received |
| `sdk.reasoning.received` | SDK | reasoning | received |
| `sdk.error.received` | SDK | error | received |
| `sdk.status.changed` | SDK | status | changed |
| `sdk.tool.started` | SDK | tool | started |
| `sdk.tool.updated` | SDK | tool | updated |
| `sdk.tool.completed` | SDK | tool | completed |
| `sdk.file.changed` | SDK | file | changed |
| `sdk.diff.produced` | SDK | diff | produced |
| `sdk.usage.updated` | SDK | usage | updated |
| `chatview.user.message` | chatview | user | message |
| `chatview.abort.requested` | chatview | abort | requested |
| `chatview.viewplan.requested` | chatview | viewplan | requested |
| `chatview.webview.ready` | chatview | webview | ready |

### Extensibility

Adding a future "model changed" event:

```typescript
interface ModelChangedEvent extends BaseEvent {
    type: 'sdk.model.changed';
    modelId: string;
    capabilities: ModelCapabilities;
}

// Add to union:
type ExtensionEvent = ... | ModelChangedEvent;
```

Two changes. No wiring files touched.

---

## 7. What Changes, What Stays

### Stays Unchanged

| Component | Why |
|-----------|-----|
| **ExtensionRpcRouter** | Bridges webview `postMessage` boundary. RxJS can't cross `postMessage`. Already has its own typed message system. |
| **Webview EventBus** (`src/webview/app/state/EventBus.js`) | Webview-side pub/sub in a separate browser runtime. Stays as-is. |
| **Shared message types** (`src/shared/messages.ts`, `src/shared/models.ts`) | RPC contract, orthogonal to extension-side events. |
| **BackendState** (`src/backendState.ts`) | State store. Bus subscriptions update it; it doesn't need to know about the bus. |
| **Service layer** (SessionService, MCPConfigurationService, etc.) | Called by handlers, not event sources. |

### Changes

| Component | What Changes |
|-----------|-------------|
| **extension.ts** | `wireManagerEvents()` + `registerChatProviderHandlers()` → declarative bus subscriptions. Shrinks by ~100+ lines. |
| **SDKSessionManager** | Publishes to EventBus (Phase 2). Optionally removes BufferedEmitters (Phase 4). |
| **ChatViewProvider** | Publishes to EventBus (Phase 2). Optionally removes EventEmitters (Phase 4). |
| **BufferedEmitter** | Absorbed by RxJS `ReplaySubject(1)`. Removed in Phase 4. |
| **safeHandler()** | Replaced by RxJS `catchError` operator. Removed in Phase 3. |

---

## 8. Risk Assessment

### Bundle Size

**Risk**: Low. RxJS tree-shakes well with esbuild. Importing `Subject`, `Observable`, `filter`, `map`, `takeUntil`, `switchMap`, `catchError` adds ~15-25KB minified to the extension bundle.

**Note**: The `main.js size constraint` test already has a pre-existing failure, so this is tracked but not a new concern.

### Learning Curve

**Risk**: Low. The developer has Angular/RxJS background. The patterns used (`Subject`, `filter`, `map`, `takeUntil`, `switchMap`) are Angular fundamentals.

### Debugging

**Risk**: Medium. RxJS stack traces can be harder to read than synchronous event handler stacks.

**Mitigation**:
- Use named functions in subscribe callbacks (not anonymous arrows)
- Add `tap(e => logger.debug(...))` operators for tracing
- Keep operator chains simple (avoid deeply nested pipes)

### Testing

**Risk**: Low. RxJS observables are *more* testable than event emitters — publish a typed event to the bus, assert on the outcome. No need to mock individual emitter sources.

### Webview Boundary

**Risk**: None. The RPC layer is explicitly out of scope. RxJS does not cross `postMessage`.

---

## 9. Verification Plan

### Per-Phase Checks

Every phase runs this full regression:

```bash
npm test                   # Unit + integration tests
npx tsc --noEmit           # Type checking
node esbuild.js            # Bundle build
./test-extension.sh        # Full VSIX package
```

The pre-existing `main.js size constraint` failure is expected and not a regression.

### Phase-Specific Verification

| Phase | Additional Checks |
|-------|------------------|
| **1** | New event bus unit tests pass. Bundle size increase < 30KB. |
| **2** | Bus integration tests verify events are published. Existing tests prove no behavior change. |
| **3** | Manual smoke test: send message, tool execution, diff view, plan mode toggle, abort. `extension.ts` < 600 lines. |
| **4** | `grep -r "BufferedEmitter" src/` returns zero results. |

### Manual Smoke Test Checklist (Phase 3)

- [ ] Start new session, send message, receive output
- [ ] Tool execution renders (start, progress, complete)
- [ ] Diff view works (file change → diff available → view diff)
- [ ] Plan mode: toggle on, accept plan, toggle off
- [ ] Abort generation mid-stream
- [ ] Session resume after reload
- [ ] Status bar updates correctly
- [ ] Usage metrics display
- [ ] Error handling (disconnect, auth failure)

---

## Appendix A: Relationship to 3.0 Utilities

The following 3.0 utilities evolve in 4.0:

| Utility | 3.0 Role | 4.0 Fate |
|---------|---------|----------|
| `DisposableStore` | Tracks multiple disposables | **Stays** — wraps RxJS subscriptions too |
| `MutableDisposable` | Session switching | **Stays through Phase 3**, replaced by `switchMap` in Phase 4 |
| `toDisposable()` | Wraps cleanup functions | **Stays** — used for `subscriptionToDisposable()` |
| `BufferedEmitter` | Buffers pre-listener events | **Removed Phase 4** — replaced by `ReplaySubject(1)` |
| `EventRelay` | Built for session switching, unused | **Removed Phase 4** — replaced by `switchMap` |
| `safeHandler()` | Error isolation in handlers | **Removed Phase 3** — replaced by `catchError` operator |

## Appendix B: Critical File Paths

| File | Role in Transition |
|------|-------------------|
| `src/extension.ts` | Primary refactor target — manual wiring → bus subscriptions |
| `src/sdkSessionManager.ts` | Source of 10 events, 29 fire() calls → bus.publish() |
| `src/chatViewProvider.ts` | Source of 4 events → bus.publish() |
| `src/shared/messages.ts` | Existing discriminated union pattern to follow |
| `src/utilities/disposable.ts` | Extend with RxJS subscription adapter |
| `src/utilities/bufferedEmitter.ts` | Removed in Phase 4 |
| `src/extension/rpc/ExtensionRpcRouter.ts` | **Not modified** — stays as-is |
