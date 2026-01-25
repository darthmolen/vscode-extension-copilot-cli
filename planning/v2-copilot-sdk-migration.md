# V2.0: Copilot SDK Integration Plan

## Executive Summary

Migrate from CLI process spawning to the official Copilot SDK for better real-time tool execution visibility and structured event handling, while preserving the two key V1 features: session list dropdown and rich markdown rendering.

## Research Findings

### SDK Capabilities ✅

**Session Management:**
- ✅ `client.listSessions()` - Lists all sessions from `~/.copilot/session-state/`
- ✅ `client.resumeSession(sessionId)` - Resume any existing session
- ✅ `client.getLastSessionId()` - Get most recent session
- ✅ Auto-spawns CLI in server mode if not running (via JSON-RPC)
- ✅ Session workspace path available via `session.workspacePath`

**Event Streaming (Real-time Tool Visibility):**
```typescript
session.on((event: SessionEvent) => {
  // Tool execution events
  - tool.execution_start     // Tool started with args
  - tool.execution_progress  // Progress updates
  - tool.execution_partial_result // Streaming output
  - tool.execution_complete  // Result + success status
  
  // Assistant messages
  - assistant.message        // Final message (content is markdown string)
  - assistant.message_delta  // Streaming message chunks
  
  // Other useful events
  - session.start / session.resume
  - session.error
  - session.usage_info (tokens, cost)
})
```

**Markdown Preservation:**
- ✅ `event.data.content` is a **markdown string** - same as current V1
- ✅ No changes needed to markdown rendering logic

## Architecture

### V2 Architecture
```
ChatPanelProvider (webview - PRESERVED FROM V1)
        ↓
SDKSessionManager (NEW - replaces CLIProcessManager)
        ↓  
@github/copilot-sdk (CopilotClient + Session)
        ↓ JSON-RPC
Copilot CLI (server mode - auto-spawned)
```

### Key Changes from V1

| Component | V1 Approach | V2 Approach | Impact |
|-----------|-------------|-------------|--------|
| **Process Management** | Spawn `copilot --prompt` per message | Single `CopilotClient` + persistent `Session` | Better performance, real-time events |
| **Session List** | Parse `~/.copilot/session-state/` manually | `client.listSessions()` API | **PRESERVED** - cleaner code |
| **Markdown Rendering** | Parse text output, use marked.js | Same - `event.data.content` is markdown | **PRESERVED** - no changes |
| **Tool Visibility** | ❌ None (stats footer stripped) | ✅ Real-time via `tool.*` events | **NEW FEATURE** |
| **Event Handling** | Parse stdout/stderr text | Structured JSON events | More reliable |

## Implementation Plan

### Phase 1: Foundation (v2-dev branch) 🏗️

#### 1.1: Setup & Dependencies
- [ ] Create `v2-dev` branch
- [ ] Install `@github/copilot-sdk` npm package
- [ ] Update TypeScript types for SDK events
- [ ] Add SDK protocol version check

#### 1.2: Create SDKSessionManager
- [ ] Replace `CLIProcessManager` with `SDKSessionManager`
- [ ] Implement CopilotClient lifecycle (start/stop)
- [ ] Handle session creation/resumption via SDK
- [ ] Map SDK events to existing ChatPanelProvider messages

**Compatibility Goal:** Should work exactly like V1 at this stage (no new UI)

### Phase 2: Session Management Migration 🔄

#### 2.1: Session List Integration
- [ ] Replace manual `~/.copilot/session-state/` scanning
- [ ] Use `client.listSessions()` API
- [ ] Use `client.getLastSessionId()` for auto-resume
- [ ] Keep existing session dropdown UI
- [ ] Preserve folder-based session filtering (from V1.0.2)

#### 2.2: Session Metadata
- [ ] Use `session.workspacePath` for session workspace access
- [ ] Update `formatSessionLabel()` to use SDK metadata
- [ ] Test session switching with SDK

**Testing:** All V1 session features should work identically

### Phase 3: Tool Execution Panel (NEW FEATURE) 🆕

#### 3.1: Event Handling Infrastructure
- [ ] Listen to `tool.execution_start` events
- [ ] Listen to `tool.execution_progress` events
- [ ] Listen to `tool.execution_complete` events
- [ ] Track tool execution state per `toolCallId`

#### 3.2: Tool Panel UI (Webview)
- [ ] Add collapsible tool execution section to chat panel
- [ ] Show active tools with progress indicators
- [ ] Display completed tools with success/failure status
- [ ] Format tool arguments in readable way

#### 3.3: File Diff Links
- [ ] Detect `file.write` / `file.edit` tool completions
- [ ] Add "View Diff" links that open VS Code diff viewer
- [ ] Use `vscode.diff` command to show before/after
- [ ] Track file changes per conversation turn

**UX Design:**
```
┌─ Copilot CLI Chat ────────────────────────┐
│                                            │
│  User: Update the README                  │
│                                            │
│  🔧 Tool Execution:                        │
│  ├─ ✅ bash (git status)                  │
│  ├─ ⏳ file.edit README.md (in progress)  │
│  │   └─ [View Diff] (when complete)       │
│  └─ ⏸️  Pending: npm run build            │
│                                            │
│  Assistant: I've updated the README...    │
│                                            │
└────────────────────────────────────────────┘
```

#### 3.4: Markdown Re-implementation
- [ ] Keep existing `marked.js` + `dompurify` for assistant messages
- [ ] Ensure code blocks still have syntax highlighting
- [ ] Preserve existing markdown styles
- [ ] Add syntax highlighting for tool output (if needed)

### Phase 4: Advanced Features (Optional) 🚀

#### 4.1: Custom Tools (VS Code Integration)
- [ ] Define custom tools that use VS Code APIs
- [ ] Example: `open_file` tool that opens files in editor
- [ ] Example: `run_test` tool that runs VS Code test tasks
- [ ] Pass custom tools to `client.createSession({ tools })`

#### 4.2: Better Error Handling
- [ ] Parse `session.error` events
- [ ] Show friendly error messages in chat
- [ ] Handle permission requests via `onPermissionRequest`

#### 4.3: Performance Monitoring
- [ ] Listen to `assistant.usage` events
- [ ] Show token usage per message (collapsible)
- [ ] Display cost estimates (if available)

### Phase 5: Testing & Migration 🧪

#### 5.1: Functional Testing
- [ ] Test session creation/resumption
- [ ] Test session switching
- [ ] Test markdown rendering (code blocks, lists, links)
- [ ] Test folder-based session filtering
- [ ] Test tool execution panel with real tools
- [ ] Test file diff links

#### 5.2: Performance Testing
- [ ] Compare V1 vs V2 startup time
- [ ] Test with long conversations (100+ messages)
- [ ] Test with rapid-fire messages
- [ ] Check memory usage

#### 5.3: Migration Decision
- [ ] If V2 is better → Merge to main, bump to 2.0.0
- [ ] If V2 needs work → Keep in v2-dev, iterate
- [ ] If V2 isn't worth it → Archive branch, keep V1

## Configuration Changes

### New Settings (V2)

```json
{
  "copilotCLI.sdk.cliPath": "",
  "copilotCLI.sdk.cliArgs": [],
  "copilotCLI.sdk.autoStart": true,
  "copilotCLI.showToolExecution": true,
  "copilotCLI.showFileDiffs": true,
  "copilotCLI.showTokenUsage": false
}
```

### Preserved Settings (from V1)
- All permission settings (yolo, allowAllTools, etc.)
- Model selection
- Agent selection
- Resume last session
- Filter sessions by folder ✅

## Breaking Changes (None Expected)

**Backward Compatibility:**
- Session format unchanged (still uses `~/.copilot/session-state/`)
- Markdown rendering unchanged
- All V1 settings mapped to SDK equivalents
- No data migration needed

**User-Visible Changes:**
- ✅ Tool execution panel (NEW)
- ✅ File diff links (NEW)
- ✅ More responsive UI (streaming events vs batch updates)
- ⚠️ May need to update CLI if SDK requires newer version

## Success Criteria

### Must Have (V2.0 Release)
- ✅ Session list works exactly like V1
- ✅ Markdown rendering identical to V1
- ✅ Folder-based session filtering works
- ✅ Tool execution panel shows real-time progress
- ✅ File diff links work for edited files
- ✅ No regressions in core functionality

### Nice to Have (Future 2.x)
- Custom VS Code tools integration
- Token usage display
- Better error messages
- Performance improvements over V1

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| SDK has bugs/limitations | High | Keep V1 in main, develop V2 in branch |
| SDK requires newer CLI version | Medium | Document minimum CLI version, add version check |
| Performance worse than V1 | Medium | Profile early, optimize or abort if needed |
| Tool panel is too noisy | Low | Make it collapsible, add toggle setting |
| File diff links don't work reliably | Low | Fall back to "file changed" indicator |

## Timeline Estimate

- Phase 1 (Foundation): **3-5 hours** - Basic SDK integration
- Phase 2 (Session Management): **2-3 hours** - Migrate session list
- Phase 3 (Tool Panel): **4-6 hours** - New UI for tool execution
- Phase 4 (Advanced): **2-4 hours** - Optional features
- Phase 5 (Testing): **2-3 hours** - Thorough testing

**Total: 13-21 hours** (assuming no major blockers)

## References

### SDK Documentation
- **Node.js SDK**: `research/copilot-sdk/nodejs/README.md`
- **Session Events**: `research/copilot-sdk/nodejs/src/generated/session-events.ts`
- **Example**: `research/copilot-sdk/nodejs/examples/basic-example.ts`
- **Getting Started**: `research/copilot-sdk/docs/getting-started.md`

### V1 Code to Preserve
- `src/chatViewProvider.ts` - Webview + markdown rendering ✅
- `src/sessionUtils.ts` - Folder-based filtering ✅
- Markdown rendering with `marked.js` + `dompurify` ✅

### V1 Code to Replace
- `src/cliProcessManager.ts` → `src/sdkSessionManager.ts`
- `updateSessionsList()` in `extension.ts` → Use `client.listSessions()`

## Decision Log

1. **Use SDK instead of CLI shelling** - Approved ✅
   - Reason: Real-time tool execution visibility addresses #1 pain point from research
   
2. **Preserve session list + markdown** - Approved ✅
   - Reason: These are the two best features of V1
   
3. **V2 in separate branch** - Approved ✅
   - Reason: Don't break working V1, evaluate before committing
   
4. **Tool execution panel with file diffs** - Approved ✅
   - Reason: Main value-add of V2, addresses "no visibility" problem

## Next Steps

1. ✅ Create this plan
2. ⏭️ Get approval to start Phase 1
3. ⏭️ Create `v2-dev` branch
4. ⏭️ Install SDK and start SDKSessionManager implementation
