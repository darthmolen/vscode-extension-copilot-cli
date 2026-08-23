---
type: plan
status: backlog
---

# Show MCP server attribution on tool chips

**Ask:** When a tool call fires in the chat transcript, indicate which MCP server it came from. Surface MCP server connection failures as inline status in the chat rather than only in the `/mcp` panel.

---

## Current state

- The `/mcp` panel (`mcpStatus` message + `McpServerStatus[]`) already knows each server's name, connection state, and tool list. This data is sent on demand via `registerChatHandlers → sendMcpStatus`.
- Tool chips in the transcript receive a `ToolState` (see `src/shared/models.ts`). `ToolState.toolName` is the bare tool name (e.g. `list_issues`); there is **no `mcpServer` field**.
- `McpServerStatus.tools: string[]` maps server → tool list, so the mapping exists — it just isn't carried onto the tool chip.

## What's missing

1. **Attribution in `ToolState`** — `sdkSessionManager.ts` fires `_onDidStartTool` with whatever the SDK gives. The SDK event for `tool.execution_start` likely includes the server name (or tool namespace). Check `session-events.ts` in `research/copilot-sdk/` to confirm.
2. **`mcpServer?: string` on `ToolState`** — needs adding to `src/shared/models.ts` and populated in `sdkSessionManager.ts` `_handleSDKEvent` at the `tool.execution_start` case.
3. **Rendering in `ToolExecution.js`** — tool chip HTML doesn't render an MCP badge yet.

---

## Event flow (current, v3.13.0)

```
SDK session.on('tool.execution_start')
  → sdkSessionManager._handleSDKEvent()            src/sdkSessionManager.ts
  → _onDidStartTool.fire(toolState)                BufferedEmitter<ToolExecutionState>

ChatSessionHost.subscribe(manager.onDidStartTool)  src/extension/session/ChatSessionHost.ts:601
  → recordTool(toolState)                          writes to session transcript
  → surface?.notifyToolStart(toolState)

WebviewChatSurface.notifyToolStart()               src/extension/webview/webviewChatSurface.ts
  → rpcRouter.toolStart(toolState)

ExtensionRpcRouter.toolStart()                     src/extension/rpc/ExtensionRpcRouter.ts:174
  → postMessage({ type: 'toolStart', toolState })

WebviewRpcClient.onToolStart(handler)              src/webview/app/rpc/WebviewRpcClient.js
  → registered handler in main.js

main.js handleToolStartMessage()                   src/webview/main.js
  → eventBus.emit('tool:start', toolState)

ToolExecution component listens 'tool:start'       src/webview/app/components/ToolExecution/ToolExecution.js
  → renders tool chip in DOM
```

---

## Implementation sketch

### Step 1 — Confirm SDK payload

Read `research/copilot-sdk/nodejs/src/generated/session-events.ts`, find `tool.execution_start`. Check whether `data.serverName` or a namespace prefix on `data.toolName` (e.g. `mcp__github__list_issues`) is available.

### Step 2 — Extend `ToolState`

```ts
// src/shared/models.ts
export interface ToolState {
    // ... existing fields ...
    mcpServer?: string;   // name of the MCP server, if tool is MCP-sourced
}
```

Also extend `ToolExecutionState` in `sdkSessionManager.ts` to match (the comment at line 72 of `models.ts` says keep them in sync).

### Step 3 — Populate in `sdkSessionManager`

In `_handleSDKEvent`, at the `tool.execution_start` / `tool.execution_complete` cases, extract the server name from the SDK event and set `mcpServer` on the state before firing.

If the SDK doesn't provide a server name directly, fall back to a lookup against `this.managedMCPRegistry` (already in scope) using the tool name.

### Step 4 — Render MCP badge in `ToolExecution.js`

When `toolState.mcpServer` is set, add a small badge to the tool chip:

```html
<span class="tool-mcp-badge" title="MCP: github">⚡ github</span>
```

Style consistently with existing chip design (see `ToolExecution.js` chip HTML).

### Step 5 (optional) — MCP server failure in chat

If `McpServerStatus.status === 'failed'` when the `/mcp` panel data is refreshed, emit a one-line status message into the chat transcript (`rpcRouter.setStatus(...)`) so the user doesn't need to open `/mcp` to notice a broken server.

---

## Affected files

| File | Change |
|---|---|
| `research/copilot-sdk/nodejs/src/generated/session-events.ts` | Read-only — confirm `tool.execution_start` payload shape |
| `src/shared/models.ts` | Add `mcpServer?: string` to `ToolState` |
| `src/sdkSessionManager.ts` | Populate `mcpServer` in `_handleSDKEvent` tool cases |
| `src/webview/app/components/ToolExecution/ToolExecution.js` | Render MCP badge when `toolState.mcpServer` is set |
| `tests/unit/components/ToolExecution*.test.js` | Add assertion: chip shows server name when `mcpServer` is set |

No new message types, no new RPC methods — `mcpServer` rides existing `toolStart` / `toolUpdate` payloads.
