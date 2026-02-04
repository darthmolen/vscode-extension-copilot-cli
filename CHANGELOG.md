# Change Log

All notable changes to the Copilot CLI Chat extension.

## [2.1.3] - 2026-02-04

### 🐛 Bug Fixes

### Session List Filtering

- Fixed session dropdown showing all sessions regardless of workspace folder filtering setting
- When `copilotCLI.filterSessionsByFolder` is enabled, the dropdown now correctly shows only sessions for the current workspace
- Previously: Dropdown showed ALL sessions, but only workspace-specific ones were resumable (confusing UI)
- Now: Dropdown only shows sessions that match the current workspace folder (when filtering is enabled)
- Technical: `updateSessionsList()` now uses the same `filterSessionsByFolder()` utility as session resumption logic
- Added logging to show filtering status and session count changes

## [2.1.2] - 2026-02-04

### ✨ Features

### Plan Mode Model Configuration

- Added `copilotCLI.planModel` setting to use different AI models for planning vs implementation
- Plan mode can now use a faster/cheaper model (e.g., Claude Haiku 4.5) while work mode uses a more powerful one (e.g., Claude Sonnet 4.5)
- Falls back to work mode model if not specified
- Example: Use Haiku for exploration and planning, Sonnet for code implementation

### 🐛 Bug Fixes

### Session Expiration Recovery

- Fixed CLI exiting after one message following session timeout
- Session recreation now properly maintains the client connection
- Previous issue: After timeout, only one message could be sent before CLI became unresponsive
- Now: Session recreates seamlessly and continues working indefinitely
- Technical: Changed from `stop()/start()` to in-place session recreation keeping client alive

### 📝 Documentation

- Updated README.md with 2.1.1 feature highlights
- Added release process reminder to update both CHANGELOG.md and README.md before publishing

## [2.1.1] - 2026-02-04

### 🐛 Bug Fixes

### Active File Persistence

- Fixed active file disappearing when clicking in the text input box
- Active file now persists when webview gets focus (previously cleared to null)
- Only clears active file when all text editors are actually closed
- Improved logic tracks last known text editor to distinguish between "focus moved to webview" vs "all files closed"

### Session State Management

- Fixed session automatically reloading when closing and reopening the chat panel
- Chat panel now correctly preserves the active session state instead of reloading from disk
- Closing the panel with X button no longer triggers session history reload on reopen
- Session continues running in background; panel just reconnects to existing state

### Session List Cleanup

- Empty sessions (no messages) are now filtered out of the session dropdown
- Corrupt sessions that fail to parse are excluded from the session list
- Session list only shows valid, non-empty sessions
- Improved error handling when reading session metadata

### 🔧 Technical Changes

- Added `lastKnownTextEditor` module-level variable in `src/extension.ts`
- Modified `updateActiveFile()` to check `visibleTextEditors.length` before clearing
- Better handling of `onDidChangeActiveTextEditor` event when editor is undefined
- Refactored session state logic to prevent unnecessary history reloads and separate state management from webview
- Enhanced session listing with validation and filtering for empty/corrupt sessions

## [2.0.6] - 2026-02-01

### 📋 Plan Mode Enhancements

**ACE-FCA Methodology Support**

- Dedicated planning session separate from work session
- Automatically injects plan file path when accepting plan
- Work session receives message with plan location and implementation instructions
- Eliminates confusion when switching from planning to implementation

**Improved Planning UI**

- All planning buttons converted to compact icons (📝, ✅, ❌, 📋)
- Prevents text overflow when resizing window
- Tooltips provide full descriptions on hover
- Planning buttons align horizontally with other controls
- "Planning" title overlays buttons without affecting vertical position

**Enhanced Safety**

- Sandboxed environment with 11 safe tools (read-only operations only)
- Cannot modify code, install packages, or commit changes in plan mode
- Can explore codebase, read files, and create implementation plans
- Defense-in-depth validation prevents accidental modifications

**See [PLAN_MODE.md](./PLAN_MODE.md) for complete guide**

### 🎨 UI/UX Improvements

**Tool Group Behavior**

- Tool groups now default to collapsed state when overflowing
- "Expand (x more)" button correctly shows collapsed initially
- Improved visual organization of multiple tool executions

**Better Alignment**

- Consistent baseline alignment for all controls
- Metrics, Show Reasoning, and Planning controls in same row

### 🐛 Bug Fixes

- Fixed View Plan button alignment (moved into Planning group)
- Fixed tool group expand/collapse state synchronization
- Fixed plan context loss when switching from plan to work mode

## [2.0.2] - 2026-01-31

### ✨ New Features

**Active File Context**

- Automatically includes the currently active file in VS Code as context
- If text is selected, includes the selection with line numbers
- Can be disabled via `copilotCLI.includeActiveFile` setting (enabled by default)
- Provides seamless context awareness for file-specific questions

**@file_name Reference Resolution**

- Support for `@file_name` syntax in messages
- Automatically resolves file references to relative workspace paths
- Searches workspace for matching files if not found directly
- Can be disabled via `copilotCLI.resolveFileReferences` setting (enabled by default)
- Example: `@src/extension.ts` resolves to the correct path

### 🐛 Bug Fixes

**Plan Mode Timeout Fix**
- Fixed "Tool names must be unique" error causing timeouts in plan mode
- Removed duplicate `update_work_plan` tool from availableTools list
- Plan mode now works reliably without API errors

**Plan Mode Tool Improvements**
- Added `explore` tool to available tools in plan mode
- Improved system message to clearly indicate `update_work_plan` must be used instead of `create`
- Added explicit tool list to help agent understand available capabilities
- Better error guidance when wrong tools are attempted

## [2.0.1] - 2026-01-28

### ✨ New Features

**Real-Time Usage Statistics**
- Context window usage percentage (shows how much of 128k token limit is used)
- Total tokens used in session (displayed in compact k/m/b format)
- Remaining request quota percentage
- All metrics update in real-time in the status bar
- Tooltips show full numbers with details

**Tool Grouping with Expand/Collapse**
- All tool executions group into collapsible containers
- Tools stay together until user or assistant message (prevents tool spam)
- Fixed height shows 2-3 tools by default (200px max)
- "Expand (X more)" link appears when tools overflow
- Click to expand shows all tools, dynamically grows as new tools arrive
- "Contract" link to collapse back
- Smart grouping: user/assistant messages close groups, tools intersperse naturally

**Stop Button**
- Send button transforms to red Stop button while thinking
- Click to abort current generation using `session.abort()`
- Enter key still works to queue messages while thinking
- Session remains active after stopping

### 🐛 Bug Fixes

**Session Expiration Handling**
- Fixed "session not found" errors when window stays open for extended periods
- Extension now automatically creates new session when old one expires
- Shows clear visual separator between expired and new session
- Preserves conversation history for reference
- Seamless recovery without manual intervention

**Session.idle Timeout Suppression**
- Suppressed confusing timeout errors during long-running commands
- Long operations (like `code --install-extension`) now complete silently
- Only real errors are shown to users

### 📚 Documentation

**Updated Links**
- Changed feedback link from GitHub Discussions to VS Code Marketplace Q&A
- Updated README with current support channels

## [2.0.0] - 2026-01-26

### 🚀 Major Release - SDK Integration & MCP Support

Complete architectural rewrite using the official @github/copilot-sdk with extensive new features.

#### ✨ New Features

**SDK 2.0 Integration**
- Migrated from CLI process spawning to official @github/copilot-sdk v0.1.18
- Real-time event streaming (tool execution, assistant messages, reasoning)
- Event-driven architecture with JSON-RPC communication
- Better performance and reliability

**Tool Execution Visibility**
- Real-time tool execution display with status indicators (⏳ Running → ✅ Success / ❌ Failed)
- Progress updates during tool execution
- Duration tracking for each tool
- Intent display showing what the assistant is trying to accomplish

**File Diff Viewer**
- "📄 View Diff" button on file edit/create operations
- Side-by-side before/after comparison using VS Code's native diff viewer
- Supports all edit types: create, add lines, remove lines, modify
- Smart snapshot capture with automatic cleanup on session end

**MCP Server Integration**
- Built-in GitHub MCP server enabled by default (access to repos, issues, PRs)
- Configure custom MCP servers via `copilotCLI.mcpServers` setting
- Support for local (stdio) and remote (HTTP/SSE) servers
- Variable expansion (`${workspaceFolder}`) in server configuration
- Enable/disable servers individually
- Integration test with hello-mcp test server

**Reasoning Display**
- Toggle to show/hide assistant's reasoning process
- See how the assistant thinks through problems
- Persistent visibility state during session

**Prompt History Navigation**
- Use Up/Down arrow keys to cycle through last 20 messages
- Saves current draft when navigating history
- Smart boundary behavior (no wrapping)
- Auto-resizes textarea

**Planning Mode Enhancements**
- Toggle to auto-prefix messages with `[[PLAN]]`
- "📋 View Plan" button for quick access to plan.md
- Session-aware visibility

**UI Improvements**
- Right-aligned input controls with clean visual hierarchy
- Reorganized layout: Show Reasoning | Plan Mode | View Plan
- Improved thinking indicator with proper state management

#### 🐛 Bug Fixes
- Fixed duplicate message sends (handler registration issue)
- Fixed session timeout errors (session.idle event handling)
- Fixed thinking indicator disappearing after tools
- Fixed file diff race condition (snapshot cleanup timing)
- Fixed working directory (files now created in workspace folder)
- Fixed yolo setting name (copilotCLI.yolo)

#### 🔧 Technical Changes
- Added working directory support (`cwd` parameter to SDK)
- Enhanced error handling and logging
- Session turn event tracking (assistant.turn_start/end)
- Token usage monitoring (session.usage_info)
- Improved event handler lifecycle management

#### 📦 Dependencies
- Added: @github/copilot-sdk ^0.1.18
- Added: vscode-jsonrpc ^8.2.1
- Removed: node-pty (unused from v1.0)
- Updated: dompurify, marked (latest versions)

#### 📚 Documentation
- Updated README with SDK architecture and MCP configuration
- Added MCP server testing guide to HOW-TO-DEV.md
- Created 3 implementation checkpoints documenting the journey
- Updated test documentation

#### ✅ Backward Compatibility
All v1.0 settings work unchanged in v2.0:
- Session management preserved
- Markdown rendering identical
- All permission settings (yolo, allowTools, etc.)
- Model and agent selection
- Folder-based session filtering

#### 🧪 Testing
- New MCP integration test (tests/mcp-integration.test.js)
- hello-mcp test server (Node.js)
- End-to-end UAT validation
- All v1.0 features verified working

### Migration Notes
No migration needed - v2.0 is fully backward compatible. Sessions in `~/.copilot/session-state/` work as-is.

New optional setting:
```json
{
  "copilotCLI.mcpServers": {
    "my-server": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "${workspaceFolder}"],
      "enabled": true
    }
  }
}
```

## [1.0.2] - 2026-01-25

### Added
- **Folder-Specific Session Selection** - Sessions now filtered by workspace folder on startup
  - Automatically resumes the most recent session from the current workspace folder
  - Prevents sessions from other projects being selected when opening a workspace
  - Falls back to global latest session if no folder-specific sessions exist
  - New setting: `copilotCLI.filterSessionsByFolder` (default: `true`) to toggle this behavior
  - Session metadata extracted from `events.jsonl` without requiring CLI schema changes

### Changed
- Session selection now workspace-aware by default
- Improved logging for session selection debugging

### Technical
- Created `sessionUtils.ts` module for session metadata operations
- Refactored `loadLastSessionId()` in `cliProcessManager.ts` to use new utility functions
- Performance optimized: only reads first ~2KB of each session's `events.jsonl` file

## [1.0.1] - 2026-01-24

### Documentation
- Updated README with marketplace installation instructions
- Added marketplace badges (version, installs, rating)
- Created comprehensive development guide (HOW-TO-DEV.md)
- Removed roadmap (v1.0 is complete!)
- Fixed outdated F5 debugging instructions (now uses VSIX workflow)
- Improved Quick Start and configuration examples

## [1.0.0] - 2026-01-24

### 🎉 Initial Release

#### Features
- **Interactive Chat Panel** - Dockable webview with full markdown rendering
  - Code blocks with syntax highlighting
  - Lists, headers, links, and formatted text
  - Auto-scrolling and message history
  
- **Session Management**
  - Session dropdown showing all available sessions
  - Resume last session automatically (configurable)
  - Switch between sessions with full history loading
  - Session labels from plan.md or short ID
  - New session button (+) in header
  
- **Complete CLI Integration**
  - Uses Copilot CLI's `--prompt` mode with session resumption
  - Tracks session state via `~/.copilot/session-state/`
  - Loads full conversation history from `events.jsonl`
  - Clean text output (stats footer stripped)
  
- **Full Configuration Support**
  - All Copilot CLI flags configurable
  - YOLO mode (all permissions) - default: true
  - Auto-resume last session - default: true
  - Granular tool, path, and URL permissions
  - 14 AI models to choose from
  - Agent and custom flags support
  
- **Accessibility**
  - Screen reader optimizations
  - ARIA labels and semantic HTML
  - Live regions for dynamic content
  - Keyboard navigation support
  
- **Cross-Platform**
  - Works on Linux, macOS, and Windows
  - Uses cross-platform Node.js APIs
  - Automatic path handling for all platforms

#### Technical Details
- TypeScript with esbuild bundling
- VSIX-based development workflow (F5 debugging broken in VS Code 1.100+)
- Comprehensive logging via Output Channel
- marked.js for markdown rendering
- No dependencies on deprecated `gh copilot` extension

#### Requirements
- VS Code 1.108.1 or higher
- GitHub Copilot CLI (standalone `copilot` command)
- Active Copilot subscription

#### Known Limitations
- No real-time tool execution visibility (trade-off for clean output)
- No structured output API from CLI yet (v0.0.394)
- File change visualization not yet implemented