# UI Interaction Workflows (pre 2.0.7)

This document describes the technical workflows that occured pre 2.0.7 when users interact with the VS Code Copilot CLI extension's UI elements. This caused a major bug because session creation and webView were tied to the cli events with no clear separation of concerns. so when a user clicked "x" on the window and re-opened it, it would create the webview, but would get no session state because the cli was already running.

## Table of Contents

- [Status Bar Click: "CLI Running"](#status-bar-click-cli-running)
- [Chat Icon Click](#chat-icon-click)
- [Message Send Workflow](#message-send-workflow)
- [Plan Mode Toggle](#plan-mode-toggle)

---

## Status Bar Click: "CLI Running"

The status bar item at the bottom of VS Code displays the CLI session status and is clickable.

### Status Bar States

The status bar displays different text based on the CLI state:

- `$(comment-discussion) Copilot CLI` - Initial state, session not running
- `$(debug-start) CLI Running` - Active CLI session
- `$(error) CLI Failed` - CLI failed to start
- `$(comment-discussion) CLI Exited` - CLI session ended

### Click Handler

**Location:** `src/extension.ts:52-57`

When clicked, the status bar executes the command `copilot-cli-extension.openChat`:

```typescript
statusBarItem.command = 'copilot-cli-extension.openChat';
```

### Technical Workflow

**EVENT TRIGGER:** `copilot-cli-extension.openChat` command handler executes (`src/extension.ts:25-49`)

The command handler does 5 things synchronously:

1. **Show/Create Chat Panel** (`src/extension.ts:27`)
   - Calls `ChatPanelProvider.createOrShow(context.extensionUri)`
   - Creates or reveals webview panel in ViewColumn.Two (right side)
   - This is JUST the UI - no CLI session yet

2. **Update Active File Context** (`src/extension.ts:30`)
   - Sends currently active file path to chat panel (if `includeActiveFile` setting enabled)

3. **Update Sessions List** (`src/extension.ts:33`)
   - Scans `~/.copilot/session-state/` and sends session list to webview

4. **Check If CLI Session Running** (`src/extension.ts:36`)
   - **If already running:** Does nothing, returns
   - **If NOT running:** Proceeds to step 5 ⬇️

5. **🔑 SESSION RESUME TRIGGER** (`src/extension.ts:36-48`)
   - Reads `copilotCLI.resumeLastSession` setting (default: true)
   - Logs: "Auto-starting CLI session (resume={value})..."
   - Calls `startCLISession(context, resumeLastSession)` asynchronously
   - When complete: If `resumeLastSession=true` AND `sessionId` exists, calls `loadSessionHistory(sessionId)`
**This is where session resume actually happens!**

### Start CLI Session Flow

**Location:** `src/extension.ts:307-426`

1. **Create SDK Session Manager** (`src/sdkSessionManager.ts:89-115`)
   - Loads configuration from VS Code settings
   - Sets working directory to workspace root
   - Initializes temporary directory for file snapshots
   - **Determines session ID to use:**
     **If `specificSessionId` provided:** Uses that exact session
     **Else if `resumeLastSession = true`:** Calls `loadLastSessionId()` which:
     - Checks `copilotCLI.filterSessionsByFolder` setting (default: true)
     - Calls `getMostRecentSession(workingDirectory, filterByFolder)` (`src/sessionUtils.ts:128-156`)
     - **Session Discovery Process:**
       1. Scans `~/.copilot/session-state/` for all session directories
       2. Reads first line of each `events.jsonl` file to extract `session.start` event
       3. Extracts `context.cwd` (working directory) from each session
       4. Sorts sessions by modification time (most recent first)
       5. If `filterByFolder = true`: Returns most recent session matching current workspace folder
       6. If `filterByFolder = false` OR no folder match: Returns most recent session globally
       7. If no sessions exist: `sessionId` remains null, will create new session  
     **Else:** `sessionId` remains null, will create new session

2. **Start SDK Session** (`src/sdkSessionManager.ts:133-215`)
   - Loads `@github/copilot-sdk` dynamically
   - Creates `CopilotClient` instance with config
   - **Resume or Create Session:** 
     **If `sessionId` is set (from step 1):**
     - Attempts `client.resumeSession(sessionId)` (`src/sdkSessionManager.ts:169`)
     - **Success:** Session resumed, existing context preserved
     - **Failure (session not found/expired):**
       - Logs warning: "Session {id} not found (likely expired), creating new session"
       - Sets `sessionId = null`
       - Creates new session with `client.createSession()`
       - Fires `session_expired` status event to UI (shows warning message)
     **If `sessionId` is null:**
     - Creates new session with `client.createSession()`
     - Generates new session ID

3. **Register Message Handlers** (`src/extension.ts:321-399`)
   - Listens for CLI messages:
     - `output` - Assistant text responses
     - `reasoning` - Internal thinking/reasoning
     - `error` - Error messages
     - `status` - Session state changes
     - `tool_start`, `tool_progress`, `tool_complete` - Tool execution events
     - `diff_available` - File change notifications
     - `usage_info` - Token usage statistics

4. **Load Session History** (`src/extension.ts:40-46`)
   - **Only if resuming AND sessionId exists**
   - After session starts successfully
   - Calls `loadSessionHistory(sessionId)` (`src/extension.ts:508-569`)
   - **History Loading Process:**
     1. Opens `~/.copilot/session-state/{sessionId}/events.jsonl`
     2. Reads file line-by-line (JSONL format)
     3. Parses each JSON event:
        - `user.message` events → Extract `content`, add as user message
        - `assistant.message` events → Extract text `content`, add as assistant message
        - Skips tool requests and other event types
     4. Replays messages in chronological order to chat panel
     5. Logs: "Loaded {N} messages from session history"
   - **Result:** Chat UI shows full conversation history from previous session

5. **Update Status Bar**
   - Changes text to `$(debug-start) CLI Running`
   - Updates tooltip to "Copilot CLI is active"
   - Sets `ChatPanelProvider.setSessionActive(true)` to show green indicator

6. **Send Initial Message**
   - Posts "Copilot CLI session started! How can I help you?" to chat panel
   - Shows output channel for logging

---

## Chat Icon Click

The chat icon in the VS Code activity bar or command palette.

### Technical Workflow

Same as [Status Bar Click](#status-bar-click-cli-running) - both execute the `copilot-cli-extension.openChat` command.

**Note:** The chat icon typically refers to:
- Command Palette: `Copilot CLI: Open Chat`
- Activity Bar icon (if configured)

Both trigger the exact same workflow described above.

---

## Message Send Workflow

When a user types a message and presses Enter or clicks Send.

### Webview → Extension Communication

**Location:** `src/chatViewProvider.ts:41-56`

1. **User Input in Webview**
   - User types in webview input field
   - Webview JavaScript sends message to extension:
     ```javascript
     vscode.postMessage({ type: 'sendMessage', value: userText })
     ```

2. **Webview Message Handler** (`src/chatViewProvider.ts:44-56`)
   - Receives `sendMessage` event
   - Duplicate detection: ignores if same message sent within 1 second
   - Updates tracking: `lastSentMessage` and `lastSentTime`
   - Invokes all registered message handlers

3. **Extension Message Handler** (`src/extension.ts:62-74`)
   - Registered during extension activation
   - Logger records: "Sending user message to CLI: {text}"
   - Adds user message to chat UI: `ChatPanelProvider.addUserMessage(text)`
   - Sets thinking indicator: `ChatPanelProvider.setThinking(true)`
   - Checks if CLI is running

4. **Send to CLI Session** (`src/extension.ts:68`)
   - Calls `cliManager.sendMessage(text)`
   - SDK sends message to Copilot API
   - Triggers assistant response generation

### Response Flow

1. **Status Update** - `status: 'thinking'`
   - CLI indicates it's processing
   - Webview shows thinking indicator (animated dots)

2. **Tool Executions** (if tools are called)
   - `tool_start` - Tool begins execution, UI shows tool card
   - `tool_progress` - Progress updates (optional)
   - `tool_complete` - Tool finishes, UI updates status

3. **Reasoning Output** (if enabled)
   - `type: 'reasoning'` messages
   - Displayed in collapsible reasoning sections

4. **Assistant Response**
   - `type: 'output'` message
   - Text added to chat via `ChatPanelProvider.addAssistantMessage()`
   - Thinking indicator disabled

5. **File Changes** (if any)
   - `type: 'diff_available'` messages
   - UI shows "View Diff" button
   - Clicking opens VS Code diff viewer

---

## Plan Mode Toggle

Special workflow for Plan Mode - a mode where the assistant creates plans without modifying files.

### Enable Plan Mode

**Location:** `src/chatViewProvider.ts:83-86` → `src/extension.ts:242-263`

1. **UI Interaction**
   - User clicks "Enable Plan Mode" button in webview
   - Webview sends: `{ type: 'togglePlanMode', enabled: true }`

2. **Command Execution**
   - Extension receives message
   - Executes command: `copilot-cli-extension.togglePlanMode` with `enabled: true`

3. **Dual Session Creation** (`src/sdkSessionManager.ts`)
   - Creates snapshot of current work session
   - Creates new "plan session" in isolated state
   - Switches active session to plan session
   - Sets `currentMode = 'plan'`

4. **CLI Configuration**
   - Enables plan mode via SDK
   - All subsequent messages go to plan session
   - File modifications are blocked

5. **Status Update**
   - Posts `plan_mode_enabled` status to webview
   - UI shows "Plan Mode Active" indicator
   - Shows "Accept Plan" and "Reject Plan" buttons

### Accept Plan

1. **User clicks "Accept Plan"**
2. **Extension Command** (`src/extension.ts:265-281`)
   - Calls `cliManager.acceptPlan()`
   - Copies plan session state to work session
   - Switches back to work mode
   - Disables plan mode restrictions

3. **UI Update**
   - Shows success message: "Plan accepted! Ready to implement."
   - Hides plan mode controls

### Reject Plan

1. **User clicks "Reject Plan"**
2. **Extension Command** (`src/extension.ts:283-299`)
   - Calls `cliManager.rejectPlan()`
   - Discards plan session
   - Restores work session state
   - Switches back to work mode

3. **UI Update**
   - Shows message: "Plan rejected. Changes discarded."
   - Hides plan mode controls

---

## Session Management

### New Session

**Command:** `copilot-cli-extension.newSession`

**Location:** `src/extension.ts:129-148`

1. Stop existing session if running
2. Clear chat messages: `ChatPanelProvider.clearMessages()`
3. Reset plan mode state: `ChatPanelProvider.resetPlanMode()`
4. Create new session: `startCLISession(context, false)` (false = new session, don't resume)
5. Update sessions list
6. Show notification: "New Copilot CLI session started!"

### Switch Session

**Command:** `copilot-cli-extension.switchSession`

**Location:** `src/extension.ts:151-167`

1. Stop current session
2. Clear chat messages and plan mode state
3. Start specific session: `startCLISession(context, true, sessionId)`
4. Load session history from `~/.copilot/session-state/{sessionId}/events.jsonl`
5. Parse JSONL events for user/assistant messages
6. Replay messages in chat panel
7. Update sessions list with current session highlighted

### Load Session History

**Location:** `src/extension.ts:508-569`

1. Read `events.jsonl` file line by line
2. Parse JSON events:
   - `user.message` events → user messages
   - `assistant.message` events → assistant messages
3. Skip tool requests, only show text content
4. Replay in chronological order
5. Add each message to chat panel

---

## Event Flow Diagram

```
User Clicks Status Bar
        ↓
openChat Command
        ↓
    ┌───────────────────────┐
    │ Create/Show Chat Panel│
    │  (ViewColumn.Two)     │
    └───────────────────────┘
        ↓
    ┌───────────────────────┐
    │ Update Active File    │
    │ Update Sessions List  │
    └───────────────────────┘
        ↓
    Is CLI Running?
        ↓
    NO → Start CLI Session
        ↓
    ┌───────────────────────┐
    │ Load Copilot SDK      │
    │ Create Client         │
    │ Create/Resume Session │
    └───────────────────────┘
        ↓
    ┌───────────────────────┐
    │ Register Handlers:    │
    │  - output             │
    │  - reasoning          │
    │  - tool_*             │
    │  - status             │
    │  - diff_available     │
    └───────────────────────┘
        ↓
    Update Status Bar
    "$(debug-start) CLI Running"
        ↓
    Show Welcome Message
```

## Key Files

- **`src/extension.ts`** - Main extension activation, command registration, CLI lifecycle
- **`src/chatViewProvider.ts`** - Webview panel management, message routing
- **`src/sdkSessionManager.ts`** - Copilot SDK integration, session management, plan mode
- **`src/logger.ts`** - Logging infrastructure
- **`src/sessionUtils.ts`** - Session utility functions (resume, list sessions)

## Configuration Settings

Referenced in workflows:

- `copilotCLI.resumeLastSession` (default: true) - Auto-resume last session on panel open
- `copilotCLI.filterSessionsByFolder` (default: true) - Only resume sessions from current workspace folder
- `copilotCLI.includeActiveFile` (default: true) - Send active file context to chat
- `copilotCLI.yolo` (default: false) - Allow all tools/paths/URLs
- `copilotCLI.allowAllTools` - Allow all CLI tools
- `copilotCLI.allowAllPaths` - Allow access to all file paths
- `copilotCLI.allowAllUrls` - Allow all URL fetching
- `copilotCLI.noAskUser` - Disable interactive prompts

## Session State Location

All session data stored in: `~/.copilot/session-state/{session-id}/`

Files:
- `events.jsonl` - Session event log (messages, tool calls, context)
  - **First line:** `session.start` event with `context.cwd` (working directory)
  - **Subsequent lines:** User/assistant messages, tool calls, status events
- `plan.md` - Plan mode planning document
- File snapshots (for diff viewing)

## Session Resume Trigger Summary

**EVENT:** User clicks status bar or chat icon → Executes `openChat` command

**TRIGGER POINT:** Command handler at `src/extension.ts:36-48`

**CONDITIONS:**
- CLI session is NOT already running
- `copilotCLI.resumeLastSession = true` (default)

**FLOW:**
1. Command handler calls `startCLISession(context, resumeLastSession=true)`
2. SDKSessionManager constructor calls `loadLastSessionId()` (`src/sdkSessionManager.ts:112-114`)
3. `loadLastSessionId()` calls `getMostRecentSession()` (`src/sessionUtils.ts:128`)
4. Scan `~/.copilot/session-state/` for all sessions
5. Read first line of each `events.jsonl` to extract workspace folder
6. Filter by current workspace (if `filterSessionsByFolder = true`)
7. Select most recent matching session → stores in `this.sessionId`
8. SDK calls `client.resumeSession(sessionId)` (`src/sdkSessionManager.ts:169`)
9. After session starts, command handler calls `loadSessionHistory(sessionId)` (`src/extension.ts:44`)
10. Load and replay conversation history from `events.jsonl`

**RESULT:** Chat panel shows previous conversation, session context preserved

**KEY INSIGHT:** The session resume is triggered by the `openChat` command handler checking if CLI is running (line 36), NOT by the webview creation itself.
