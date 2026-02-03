# UI Message Loading Architecture (v2.1.0+)

## Overview

This document describes how messages are loaded and displayed in the chat panel UI for both initial load and session switching. This replaces the old architecture documented in `documentation/archive/bad-ui-interaction-workflows.md`.

## Core Principle: BackendState as Single Source of Truth

All chat history is stored in **BackendState** (`src/backendState.ts`), which acts as the single source of truth. The webview UI is stateless and gets its full state via the `init` message.

## Message Flow Architecture

### 1. Initial Load (First Time Opening Chat)

```
User clicks status bar / chat icon
    ↓
openChat command (extension.ts:29)
    ↓
ChatPanelProvider.createOrShow() (chatViewProvider.ts:17)
    ├─ Panel already exists? → REVEAL it
    └─ Panel doesn't exist? → CREATE new panel
        ↓
    Panel created → Sets HTML content
        ↓
    Webview loads → Sends 'ready' message
        ↓
    Extension handles 'ready' (chatViewProvider.ts:82)
        ├─ Gets fullState from BackendState
        ├─ Logs: "BackendState when ready: N messages"
        └─ Sends 'init' message to webview with:
            ├─ sessionId
            ├─ sessionActive
            ├─ messages[] (full chat history)
            ├─ planModeStatus
            ├─ workspacePath
            └─ activeFilePath
        ↓
    Webview receives 'init' (chatViewProvider.ts:1817)
        ├─ Clears messagesContainer.innerHTML
        ├─ Creates empty state div
        └─ For each message in init.messages:
            └─ Calls addMessage(role, content)
                ├─ Creates message div with proper HTML
                ├─ Parses markdown for assistant messages
                ├─ Escapes HTML for user messages
                └─ Appends to messagesContainer
```

**Result:** All messages from BackendState displayed in UI with proper HTML formatting.

### 2. Session Switch (User Selects Different Session)

```
User selects session from dropdown
    ↓
Webview sends {type: 'switchSession', sessionId: '...'}
    ↓
Extension executes switchSession command (extension.ts:170)
    ↓
Stops existing CLI session
    ↓
Calls loadSessionHistory(sessionId) (extension.ts:583)
    ├─ Reads ~/.copilot/session-state/{sessionId}/events.jsonl
    ├─ Parses JSONL events:
    │   ├─ user.message events → Extract content
    │   └─ assistant.message events → Extract content
    ├─ Calls backendState.clearMessages()
    └─ For each message:
        └─ backendState.addMessage({role, type, content, timestamp})
    ↓
    Logs: "Loaded N messages from session history file"
    Logs: "BackendState now has N messages"
        ↓
Calls startCLISession(context, true, sessionId)
    └─ Starts SDK session with specific session ID
        ↓
Extension sends 'init' message (extension.ts:187)
    └─ Same structure as initial load:
        ├─ Gets fullState from BackendState  
        └─ Sends init with sessionId, messages[], etc.
        ↓
    Webview receives 'init'
        ├─ Clears existing messages
        └─ Adds all messages from init.messages[]
```

**Result:** Previous session cleared, new session's messages loaded and displayed.

### 3. Panel Reopen After Close (User Hits X, Then Reopens)

```
User hits X button
    ↓
Panel disposed (chatViewProvider.ts:46)
    ├─ Logs: "PANEL DISPOSED (X BUTTON)"
    ├─ Logs BackendState stats (still has messages!)
    └─ Sets ChatPanelProvider.panel = undefined
    ↓
    **BackendState and CLI session REMAIN ACTIVE**
        ↓
User reopens (clicks status bar / chat icon)
    ↓
openChat command (extension.ts:29)
    ├─ Checks: cliManager.isRunning()? YES!
    ├─ Logs: "CLI already running, NOT loading history or starting new session"
    └─ Calls ChatPanelProvider.createOrShow()
        ↓
    Panel is undefined → CREATE new panel
        ↓
    Sets HTML content
        ↓
    Webview loads → Sends 'ready'
        ↓
    Extension handles 'ready' (chatViewProvider.ts:82)
        ├─ Gets fullState from BackendState (still has all messages!)
        ├─ Logs: "BackendState when ready: N messages"
        └─ Sends 'init' message with full state
        ↓
    Webview receives 'init'
        └─ Displays all messages from BackendState
```

**Result:** Panel recreated, all messages restored from BackendState.

## Key Implementation Details

### BackendState Message Structure

```typescript
interface Message {
    role: 'user' | 'assistant' | 'system';
    type: 'user' | 'assistant' | 'reasoning' | 'tool' | 'error';
    content: string;
    timestamp?: number;
    toolName?: string;
    status?: 'running' | 'success' | 'error';
}
```

### Init Message Structure

```typescript
{
    type: 'init',
    sessionId: string | null,
    sessionActive: boolean,
    messages: Message[],
    planModeStatus: PlanModeStatus | null,
    workspacePath: string | null,
    activeFilePath: string | null
}
```

### Webview Init Handler (chatViewProvider.ts:1817-1841)

```javascript
case 'init':
    // Clear existing messages
    messagesContainer.innerHTML = '';
    const emptyStateDiv = document.createElement('div');
    emptyStateDiv.className = 'empty-state';
    emptyStateDiv.id = 'emptyState';
    emptyStateDiv.innerHTML = `...`;
    messagesContainer.appendChild(emptyStateDiv);
    
    // Add messages from init
    if (message.messages && message.messages.length > 0) {
        for (const msg of message.messages) {
            const role = msg.type || msg.role;
            addMessage(role, msg.content);
        }
    }
    
    setSessionActive(message.sessionActive);
    break;
```

### Message Rendering (chatViewProvider.ts:1472-1502)

```javascript
function addMessage(role, text) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    
    if (role === 'reasoning') {
        // Italic styling for reasoning
        messageDiv.innerHTML = `
            <div class="message-header" style="font-style: italic;">Assistant Reasoning</div>
            <div class="message-content" style="font-style: italic;">${escapeHtml(text)}</div>
        `;
    } else {
        // Use marked.js for assistant markdown, escape HTML for user
        const content = role === 'assistant' ? marked.parse(text) : escapeHtml(text);
        messageDiv.innerHTML = `
            <div class="message-header">${role === 'user' ? 'You' : 'Assistant'}</div>
            <div class="message-content">${content}</div>
        `;
    }
    
    messagesContainer.appendChild(messageDiv);
}
```

## Critical Design Decisions

### 1. Why Init Instead of Individual Messages?

**Before:** Extension sent individual `{type: 'userMessage'}` and `{type: 'assistantMessage'}` for each message in history.

**Problem:** 
- Race conditions when sending 100+ individual messages
- No guarantee of order
- Webview state could be inconsistent

**After:** Extension sends single `{type: 'init'}` with full message array.

**Benefits:**
- Atomic update - all or nothing
- Guaranteed order
- Webview can clear and rebuild in one operation

### 2. Why BackendState Persists When Panel Closes?

The CLI session continues running even when the panel is closed (X button). Messages continue to arrive from the assistant. BackendState buffers these messages so they can be displayed when the panel reopens.

**Lifecycle:**
- Panel lifecycle: Create → Dispose → Recreate
- BackendState lifecycle: Create on extension activate → Persist until session stops
- CLI session lifecycle: Start → Run → Stop (independent of panel)

### 3. Why retainContextWhenHidden: true?

```typescript
{
    enableScripts: true,
    localResourceRoots: [extensionUri],
    retainContextWhenHidden: true  // ← Why?
}
```

**Reason:** When the panel is hidden (not closed), the webview context is preserved. This prevents:
- Losing input field state
- Losing scroll position  
- Re-rendering cost when panel becomes visible again

**Note:** This does NOT prevent disposal when X is clicked. The `retainContextWhenHidden` option only applies to hiding (e.g., switching to another tab), not disposal.

## Common Issues and Solutions

### Issue: Messages appear as raw text without formatting

**Cause:** Webview received messages but didn't parse markdown.

**Debug:**
1. Check logs for "Sent init message to webview with N messages"
2. Check if `addMessage` was called with correct role
3. Verify `marked.parse()` is called for assistant messages

**Solution:** Ensure `role === 'assistant'` for assistant messages, not `'reasoning'` or other type.

### Issue: Panel blank after reopening

**Cause:** BackendState empty or init message not sent.

**Debug:**
1. Check logs for "BackendState when ready: N messages"
2. If N=0, BackendState was cleared incorrectly
3. Check if `ready` event fired

**Solution:** Ensure BackendState is not cleared when panel closes, only when session switches or new session starts.

### Issue: Duplicate messages

**Cause:** Multiple init messages sent or individual messages sent after init.

**Debug:**
1. Check for duplicate `'ready'` events
2. Check for `addUserMessage`/`addAssistantMessage` calls after init

**Solution:** Only send init once per webview creation. Don't send individual messages when loading history.

## Testing

See `tests/webview-init-handler.test.ts` for unit tests covering:
- Init clears before adding messages
- Init handles empty message arrays
- Init handles large message counts (100+)
- Both initial load and session switch code paths documented

See `tests/webview-lifecycle-integration.test.js` for integration tests covering:
- Full lifecycle from panel creation to disposal
- Session switch with history loading
- Panel reopen after disposal

## File References

- `src/extension.ts:29-68` - openChat command (initial load)
- `src/extension.ts:170-198` - switchSession command
- `src/extension.ts:583-663` - loadSessionHistory function
- `src/chatViewProvider.ts:17-150` - Panel creation and message handling
- `src/chatViewProvider.ts:1813-1875` - Webview message handlers (including init)
- `src/chatViewProvider.ts:1472-1502` - addMessage function (rendering)
- `src/backendState.ts` - BackendState singleton

## Migration from Old Architecture

The old architecture (pre-2.0.7) had these problems:

1. **Session creation tied to webview creation** - Opening panel created new session
2. **No state persistence** - Closing panel lost all state
3. **Individual message sends** - History sent as individual messages, causing races

The new architecture (2.0.7+) fixes these:

1. **Session independent of webview** - CLI session persists when panel closes
2. **BackendState as single source** - State persists independently
3. **Atomic init message** - Full state sent in one message

For details on the old architecture, see `documentation/archive/bad-ui-interaction-workflows.md`.
