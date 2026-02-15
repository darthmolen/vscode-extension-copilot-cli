# ADR-004: Component and Event-Based Architecture

**Status**: Accepted
**Date**: 2026-02-08 (v3.0.0)
**Driver**: Files were getting massive, spaghetti was real, cross-cutting concerns were everywhere, and the AI's context window is small. We couldn't test, extend, or reason about the codebase.

## Context

Our files were getting massive. The spaghetti was real. Cross-cutting concerns all over the place.

By v2.2, `extension.ts` was 800 lines, `chatViewProvider.ts` was growing unchecked, and the webview's `main.js` was 2,500 lines of UI logic, business logic, network code, and state management tangled together. A 200-line untyped switch statement routed messages. Event handlers had side effects buried six levels deep. Adding a feature meant understanding the entire file because everything touched everything.

The AI's context window made this worse. When the LLM looked at a 2,500-line file, it couldn't hold the whole thing in context. It would fix something on line 200 and break something on line 1,800 that it had already forgotten about. We'd already adopted TDD (ADR-002), but we couldn't even write tests — you can't unit test a monolith because you can't isolate anything.

We had also started to see communication reliability problems. The extension host, the SDK, and the webview were all passing untyped messages using magic strings. A typo in a message type string would silently fail. The wrong payload shape would blow up at runtime. There was no contract between the pieces.

## Decision

**Mandate separation of concerns through componentization, service extraction, and a typed event bus for communication.**

### Three-Part Refactor

#### 1. Webview Componentization

Extract the monolithic `main.js` into focused, testable UI components:

| Component | Responsibility |
| ------ | ------ |
| `MessageDisplay` | Renders user/assistant messages, reasoning, tool groups |
| `ToolExecution` | Collapsible tool execution with diff buttons |
| `InputArea` | Message input with @file references, attachments |
| `SessionToolbar` | Session dropdown, model selector, new session |
| `AcceptanceControls` | Plan accept/reject buttons |
| `StatusBar` | Usage metrics, help icon |
| `ActiveFileDisplay` | Current file with tooltip |
| `PlanModeControls` | Plan mode toggle with model selector |
| `SlashCommandPanel` | Grouped slash command reference |

Each component owns its DOM, its event listeners, and its lifecycle. Components communicate through the EventBus, not by reaching into each other's DOM.

#### 2. Extension Service Extraction

Extract business logic from `extension.ts` and `sdkSessionManager.ts` into focused services:

| Service | Responsibility |
| ------ | ------ |
| `SessionService` | Session lifecycle, creation, switching, resume |
| `InlineDiffService` | LCS-based diff generation and formatting |
| `FileSnapshotService` | Git snapshots for before/after file state |
| `MCPConfigurationService` | MCP server configuration and discovery |
| `ModelCapabilitiesService` | Model info caching, attachment validation |
| `PlanModeToolsService` | Plan mode tool definitions and whitelisting |
| `MessageEnhancementService` | @file resolution, active file context |
| `CLIPassthroughService` | Slash command terminal delegation |

Each service has a single responsibility, is independently testable, and is injected where needed.

#### 3. Typed Communication

Replace magic strings with typed contracts:

- **Shared types** (`src/shared/messages.ts`) — Discriminated union of all 31+ message types with TypeScript payload types. Both extension and webview import the same definitions.
- **ExtensionRpcRouter** — Type-safe handler registration on the extension side. Each message type maps to exactly one handler.
- **WebviewRpcClient** — Type-safe callback registration on the webview side.
- **Webview EventBus** — Decoupled pub/sub between components (45+ event types). Components publish and subscribe without direct references to each other.

The bus made sense because we were having problems with magic strings and communicating reliably between the different constituents — the extension host, the SDK, and the webview. A typo in a message type now fails at compile time, not at runtime.

### Architecture Result

```text
Extension Host (Server)
├── extension.ts (~750 lines) — Composition root + event wiring
├── chatViewProvider.ts — Controller (WebviewViewProvider)
├── sdkSessionManager.ts — SDK facade with granular events
├── extension/services/ — 8 extracted services (1,813 lines total)
├── extension/rpc/ — ExtensionRpcRouter (typed message handling)
└── shared/ — Message types + domain models (shared with client)

Webview (Client)
├── main.js — Component orchestrator
├── components/ — 9 focused UI components
├── handlers/ — 5 event handlers
├── services/ — CommandParser (41 slash commands)
├── state/ — EventBus + state management
└── rpc/ — WebviewRpcClient (typed callbacks)
```

## Consequences

**Positive:**

- Every component and service is independently testable — TDD (ADR-002) is now possible across the entire codebase
- Context window efficiency — the AI can focus on one 150-line component instead of a 2,500-line monolith
- Compile-time message validation — typos in message types are caught by TypeScript, not at runtime
- New features are additive — add a component, add a service, wire it up. No need to modify existing files.
- Debugging is localized — a bug in `AcceptanceControls` doesn't require reading `MessageDisplay`

**Negative:**

- More files to navigate — 9 components + 8 services + RPC layer is more surface area than 3 big files
- The webview uses ES modules (not bundled), so `esbuild.js` must be updated when adding new directories under `src/webview/app/`
- The event wiring in `extension.ts` grows with every new event (addressed in the v4.0 event bus planning)
- Initial refactor was expensive — the v3.0 refactor took significant effort across multiple phases

## Notes

- Component extraction started with `MessageDisplay` (commit `5093d55`) and expanded to all 9 components over multiple phases (commits `5093d55` through `3c84aa5`)
- The EventBus was introduced in commit `df21968` as the first step toward decoupled component communication
- The 3.0 code review (`planning/completed/3.0/code_review/`) identified the architecture problems and produced the recommendations that drove this refactor
- The webview ES module caveat (must update `esbuild.js` for new directories) is documented in project memory to prevent silent failures
- This ADR's consequence — "event wiring in extension.ts grows" — is the direct motivation for the v4.0 typed event bus + RxJS planning (see `planning/4.0/event-architecture-transition.md`)
