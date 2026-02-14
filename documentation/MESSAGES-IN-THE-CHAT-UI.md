# Messages in the Chat UI

## 1. Overview

The chat UI uses a client-server architecture split across a VS Code process boundary:

- **Extension (server)**: Runs in the VS Code extension host. Owns the CLI session, stores all state in `BackendState`, and pushes updates to the webview through `ExtensionRpcRouter`.
- **Webview (client)**: Runs in an isolated browser context inside a VS Code panel. Receives typed messages through `WebviewRpcClient`, translates them into `EventBus` events, and lets components render to the DOM.
- **RPC layer**: The typed API between them. `ExtensionRpcRouter` on the extension side and `WebviewRpcClient` on the webview side wrap `postMessage`/`addEventListener` with type-safe methods. Neither side touches raw `postMessage` directly.

The webview is stateless. It gets its entire state from the extension via the `init` message and then applies incremental updates as they arrive. If the webview is destroyed and recreated, the extension sends `init` again from `BackendState` and the UI rebuilds from scratch.

## 2. The Pipeline

A message from the CLI agent reaches the DOM through this pipeline:

```
CLI/SDK event
    |
    v
extension.ts (event handler)
    |
    v
BackendState (state updated)
    |
    v
ExtensionRpcRouter (typed send method, e.g. addAssistantMessage())
    |
    v
webview.postMessage()  -- crosses the VS Code process boundary --
    |
    v
WebviewRpcClient (window.addEventListener('message'), dispatches to handler)
    |
    v
main.js handler function (e.g. handleAssistantMessageMessage)
    |
    v
EventBus.emit() (e.g. 'message:add')
    |
    v
Component (e.g. MessageDisplay.addMessage())
    |
    v
DOM
```

In the reverse direction (user sends a message):

```
DOM (user clicks send)
    |
    v
InputArea emits 'input:sendMessage' on EventBus
    |
    v
main.js listener calls rpc.sendMessage()
    |
    v
WebviewRpcClient._send() via vscode.postMessage()
    |
    v
-- crosses process boundary --
    |
    v
ExtensionRpcRouter.route() dispatches to registered handler
    |
    v
extension.ts handler (updates BackendState, calls CLI)
```

### Key design rule

Components never talk to the RPC layer directly. `main.js` is the only file that touches both `WebviewRpcClient` and `EventBus`. This keeps components decoupled from the transport mechanism.

## 3. Message Types

All message types are defined in `src/shared/messages.ts` (433 lines). Every message extends `BaseMessage` which carries a `type` string and optional `timestamp`.

### Webview to Extension (11 types)

These are actions the user initiates.

| Type | Payload Interface | Purpose |
|------|-------------------|---------|
| `sendMessage` | `SendMessagePayload` | Send user text + optional file attachments to the agent |
| `abortMessage` | `AbortMessagePayload` | Cancel the current agent stream |
| `ready` | `ReadyPayload` | Webview finished loading, requesting full state |
| `switchSession` | `SwitchSessionPayload` | Switch to a different session by ID |
| `newSession` | `NewSessionPayload` | Create a new CLI session |
| `viewPlan` | `ViewPlanPayload` | Open the plan file in the VS Code editor |
| `viewDiff` | `ViewDiffPayload` | Open a diff view for a tool execution |
| `togglePlanMode` | `TogglePlanModePayload` | Enable or disable plan mode |
| `acceptPlan` | `AcceptPlanPayload` | Accept the proposed plan |
| `rejectPlan` | `RejectPlanPayload` | Reject the proposed plan |
| `pickFiles` | `PickFilesPayload` | Open the native file picker for attachments |

Union type: `WebviewMessage`

### Extension to Webview (20 types)

These are state updates pushed from the extension.

| Type | Payload Interface | Purpose |
|------|-------------------|---------|
| `init` | `InitPayload` | Atomic transfer of full session state (see Section 5) |
| `userMessage` | `UserMessagePayload` | Echo a user message into the chat |
| `assistantMessage` | `AssistantMessagePayload` | Add an assistant response to the chat |
| `reasoningMessage` | `ReasoningMessagePayload` | Add a reasoning/thinking message (hidden by default) |
| `toolStart` | `ToolStartPayload` | A tool execution has started |
| `toolUpdate` | `ToolUpdatePayload` | A tool execution has progressed or completed |
| `streamChunk` | `StreamChunkPayload` | Incremental chunk of a streaming response |
| `streamEnd` | `StreamEndPayload` | Streaming response finished |
| `clearMessages` | `ClearMessagesPayload` | Remove all messages from the chat |
| `sessionStatus` | `SessionStatusPayload` | Session connected/disconnected |
| `updateSessions` | `UpdateSessionsPayload` | Refresh the session dropdown list |
| `thinking` | `ThinkingPayload` | Show or hide the "Thinking..." indicator |
| `resetPlanMode` | `ResetPlanModePayload` | Force plan mode UI back to off |
| `workspacePath` | `WorkspacePathPayload` | Update the workspace path (controls View Plan button) |
| `activeFileChanged` | `ActiveFileChangedPayload` | Active editor file changed |
| `diffAvailable` | `DiffAvailablePayload` | Diff data ready for a tool execution (includes inline diff lines) |
| `appendMessage` | `AppendMessagePayload` | Append text to the last assistant message |
| `attachmentValidation` | `AttachmentValidationPayload` | Validation result for a file attachment |
| `status` | `StatusPayload` | General status events (plan mode transitions, thinking, ready) |
| `usage_info` | `UsageInfoPayload` | Token usage and quota metrics |

Union type: `ExtensionMessage`

### Type Guards

`isWebviewMessage()` and `isExtensionMessage()` validate message objects against the known type lists. Used at the boundary when raw messages arrive.

## 4. The 18 Handlers

Each handler in `main.js` receives a typed payload from `WebviewRpcClient` and translates it into one or more `EventBus` events or direct component calls.

| # | Handler Function | RPC Registration | What It Does |
|---|-----------------|------------------|--------------|
| 1 | `handleThinkingMessage` | `rpc.onThinking()` | Shows/hides the thinking indicator; emits `session:thinking` on EventBus |
| 2 | `handleSessionStatusMessage` | `rpc.onSessionStatus()` | Updates `sessionActive` flag, toggles status indicator CSS, emits `session:active` |
| 3 | `handleAppendMessageMessage` | `rpc.onAppendMessage()` | Finds the last message DOM element and appends text to its content |
| 4 | `handleUserMessageMessage` | `rpc.onUserMessage()` | Emits `message:add` with `role: 'user'` (MessageDisplay renders it) |
| 5 | `handleAssistantMessageMessage` | `rpc.onAssistantMessage()` | Emits `message:add` with `role: 'assistant'`; clears thinking indicator |
| 6 | `handleReasoningMessageMessage` | `rpc.onReasoningMessage()` | Emits `message:add` with `role: 'reasoning'` |
| 7 | `handleWorkspacePathMessage` | `rpc.onWorkspacePath()` | Updates local `workspacePath`; tells SessionToolbar to show/hide View Plan button |
| 8 | `handleActiveFileChangedMessage` | `rpc.onActiveFileChanged()` | Delegates to `inputArea.updateFocusFile()` |
| 9 | `handleClearMessagesMessage` | `rpc.onClearMessages()` | Calls `messageDisplay.clear()` |
| 10 | `handleUpdateSessionsMessage` | `rpc.onUpdateSessions()` | Updates `currentSessionId`; calls `sessionToolbar.updateSessions()` |
| 11 | `handleToolStartMessage` | `rpc.onToolStart()` | Emits `tool:start` on EventBus (ToolExecution renders the card) |
| 12 | `handleToolUpdateMessage` | `rpc.onToolUpdate()` | Emits `tool:complete`, `tool:progress`, or `tool:start` depending on status |
| 13 | `handleDiffAvailableMessage` | `rpc.onDiffAvailable()` | Emits `tool:complete` with `hasDiff: true` and diff line data |
| 14 | `handleUsageInfoMessage` | `rpc.onUsageInfo()` | Extracts token/quota metrics, updates InputArea usage displays |
| 15 | `handleResetPlanModeMessage` | `rpc.onResetPlanMode()` | Sets `planMode = false`, updates UI, hides acceptance controls |
| 16 | `handleStatusMessage` | `rpc.onStatus()` | Dispatches plan mode transitions, thinking/ready states, plan_ready events |
| 17 | `handleFilesSelectedMessage` | `rpc.onFilesSelected()` | Delegates to `inputArea.addAttachments()` |
| 18 | `handleInitMessage` | `rpc.onInit()` | Clears display, loops through `payload.messages` emitting `message:add` for each, sets workspace path and session status |

### Handler registration

All 18 handlers are wired at the bottom of `main.js` in a flat list:

```javascript
rpc.onThinking(handleThinkingMessage);
rpc.onSessionStatus(handleSessionStatusMessage);
// ... 16 more ...
rpc.onInit(handleInitMessage);
```

No switch statement. Each message type maps to exactly one handler function.

## 5. Three Flow Scenarios

### 5.1 Initial Load

User opens the chat panel for the first time (or the extension activates).

```
1. VS Code creates the webview panel
2. Webview HTML loads, main.js executes
3. main.js calls rpc.ready()
4. Extension receives 'ready' via ExtensionRpcRouter
5. Extension calls backendState.getFullState()
6. Extension sends 'init' with full state via rpc.sendInit()
7. Webview receives 'init'
8. handleInitMessage() runs:
   a. messageDisplay.clear()         -- wipe any stale DOM
   b. for each message in payload:
      eventBus.emit('message:add')   -- MessageDisplay renders each one
   c. setSessionActive()             -- update connection indicator
```

Result: All messages from BackendState appear in the UI. The webview is fully synchronized.

### 5.2 Session Switch

User selects a different session from the dropdown.

```
1. SessionToolbar emits 'switchSession' with sessionId
2. main.js calls rpc.switchSession(sessionId)
3. Extension receives 'switchSession' via ExtensionRpcRouter
4. Extension stops current CLI session
5. Extension reads ~/.copilot/session-state/{id}/events.jsonl
6. Extension parses JSONL, calls backendState.clearMessages(), then
   backendState.addMessage() for each parsed event
7. Extension starts new CLI session with the target sessionId
8. Extension sends 'init' with the new BackendState
9. Webview receives 'init' -- same path as Initial Load step 7+
```

Result: Previous session's messages are cleared. New session's history is loaded and rendered.

### 5.3 Panel Reopen

User closed the panel (hit X), then reopens it. The CLI session kept running in the background.

```
1. User closes panel -- panel is disposed, webview DOM is destroyed
   BackendState and CLI session remain active
2. Messages from the CLI continue arriving; extension updates BackendState
3. User reopens the panel (clicks status bar item or command)
4. New webview is created, main.js executes again
5. main.js calls rpc.ready()
6. Extension sends 'init' from BackendState (which accumulated messages
   while the panel was closed)
7. Webview renders all messages including ones that arrived while closed
```

Result: No messages are lost. BackendState acts as a buffer between the CLI session lifecycle and the webview lifecycle.

### Why `init` instead of individual messages?

The previous architecture sent individual `userMessage`/`assistantMessage` payloads for each message in the history. This caused race conditions with 100+ messages, no ordering guarantee, and inconsistent webview state. The `init` message is an atomic state transfer: one message carries everything, the webview clears and rebuilds in one operation.

## 6. Component Architecture

### Component list

Components are instantiated in `main.js` and each owns a section of the DOM:

| Component | Mount Point | Responsibility |
|-----------|-------------|----------------|
| `MessageDisplay` | `#messages-mount` | Renders user, assistant, and reasoning messages. Manages auto-scroll, empty state, reasoning visibility toggle. |
| `ToolExecution` | Created as child of MessageDisplay's container | Renders tool execution cards with status icons, argument previews, inline diffs, diff buttons, and expand/collapse groups. |
| `InputArea` | `#input-mount` | Text input, send/stop button, file attachments, focus file display, plan mode controls, usage metrics. |
| `SessionToolbar` | `#session-toolbar-mount` | Session dropdown, new session button, plan mode toggle, view plan button. |
| `AcceptanceControls` | `#acceptance-mount` | Accept/reject buttons for plan review. |

### Communication pattern

Components do not know about the RPC layer. They communicate through EventBus:

```
Extension message arrives
    |
    v
WebviewRpcClient dispatches to handler in main.js
    |
    v
Handler emits EventBus event (e.g. 'message:add', 'tool:start')
    |
    v
Component subscribed to that event updates its DOM
```

For user-initiated actions, the flow reverses:

```
Component emits EventBus event (e.g. 'input:sendMessage', 'viewDiff')
    |
    v
main.js listener calls WebviewRpcClient method (e.g. rpc.sendMessage())
    |
    v
WebviewRpcClient sends to extension via postMessage
```

### EventBus events

Key events flowing through the EventBus:

| Event | Producer | Consumer | Data |
|-------|----------|----------|------|
| `message:add` | main.js handlers | MessageDisplay, ToolExecution | `{ role, content, attachments?, timestamp }` |
| `tool:start` | main.js handlers | ToolExecution | `ToolState` object |
| `tool:complete` | main.js handlers | ToolExecution | `ToolState` with status, diff data |
| `tool:progress` | main.js handlers | ToolExecution | `ToolState` with progress |
| `reasoning:toggle` | (currently unused) | MessageDisplay | `boolean` |
| `session:active` | main.js | InputArea | `boolean` |
| `session:thinking` | main.js | InputArea | `boolean` |
| `input:sendMessage` | InputArea | main.js | `{ text, attachments }` |
| `input:abort` | InputArea | main.js | (none) |
| `input:attachFiles` | InputArea | main.js | (none) |
| `viewDiff` | ToolExecution | main.js | diff data object |
| `enterPlanMode` | InputArea | main.js | (none) |
| `acceptPlan` | InputArea | main.js | (none) |
| `rejectPlan` | InputArea | main.js | (none) |
| `exitPlanMode` | InputArea | main.js | (none) |

### Message rendering rules

MessageDisplay applies different rendering based on message role:

- **User messages**: Content is passed through `escapeHtml()` -- no markdown, no HTML injection.
- **Assistant messages**: Content is parsed with `marked.parse()` for full Markdown rendering (code blocks, links, lists, etc.).
- **Reasoning messages**: Content is escaped with `escapeHtml()` and displayed in italic. Hidden by default; toggled with the reasoning visibility control.

### ToolExecution grouping

ToolExecution groups consecutive tool executions into collapsible tool groups. When a user or assistant message arrives (`message:add` with role `user` or `assistant`), the current tool group is closed and subsequent tools start a new group. Groups with more than 3 tools or content taller than 200px get an expand/collapse toggle.

## File References

| File | Lines | Role |
|------|-------|------|
| `src/backendState.ts` | 146 | Single source of truth for session state |
| `src/extension.ts` | 744 | Event handlers, CLI lifecycle, BackendState updates |
| `src/extension/rpc/ExtensionRpcRouter.ts` | 520 | Type-safe extension-to-webview messaging (18 send methods, 11 receive handlers) |
| `src/shared/messages.ts` | 433 | All message type definitions, payload interfaces, type guards |
| `src/webview/main.js` | 526 | Bootstrap, 18 message handlers, EventBus wiring, component initialization |
| `src/webview/app/rpc/WebviewRpcClient.js` | 478 | Type-safe webview-to-extension messaging (11 send methods, 20 receive handlers) |
| `src/webview/app/state/EventBus.js` | 69 | Pub/sub for component communication |
| `src/webview/app/components/MessageDisplay/MessageDisplay.js` | 292 | Chat message rendering, auto-scroll, empty state |
| `src/webview/app/components/ToolExecution/ToolExecution.js` | 344 | Tool execution cards, grouping, inline diffs |

## Supersedes

This document replaces `documentation/ui-message-loading-architecture.md`, which described the pre-3.0 architecture using `chatViewProvider.ts` with an inline webview script and a monolithic switch statement for message handling. That architecture has been replaced by the RPC layer, EventBus, and component system described here.
