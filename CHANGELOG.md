# Change Log

All notable changes to the Copilot CLI Chat extension.

## [3.0.0] - 2026-02-14

### 🚀 Major Release - Complete Architectural Overhaul

This is the biggest transformation in the extension's history — a complete rewrite that makes it faster, more reliable, and infinitely more maintainable.

#### **THE FOUNDATIONAL CHANGE - Sidebar Integration**

Migrated from standalone panel (`ChatViewPanel`) to Activity Bar sidebar (`WebviewViewProvider`):
- **Lives in Activity Bar** — Same location as native Copilot Chat and Claude Code
- **Drag Between Sidebars** — Move between left/right sidebars freely via View → Chat
- **Native Chat Experience** — Proper VS Code sidebar integration, not a floating panel
- **Complete Webview Lifecycle Rewrite** — Proper disposal chain, resource management, and state preservation
- **Fixed Massive Memory Leak** — MutableDisposable pattern eliminates accumulating event handlers from session switches

**Why this matters**: Provides a native VS Code chat experience and solves the memory leak that would crash the extension after multiple session switches.

### ✨ Features

#### Inline Diff Display in Chat Stream
- **In-Stream Diffs** — File edits show compact inline diffs directly in chat (up to 10 lines with +/- prefixes)
- **Truncation for Large Changes** — Diffs over 10 lines show "... N more lines" with "View Diff" button
- **Decision-Making in Flow** — Review, approve, or redirect the agent without leaving the conversation
- **InlineDiffService** — Dedicated service for git-based diff generation and formatting

#### Slash Commands (41 Commands) with Discovery Panel
- **CommandParser** — Unified parser for 41 slash commands with type-safe execution
- **SlashCommandPanel** — Type `/` to see a grouped command reference above the input; click to insert
- **Help Icon (?)** — StatusBar help button triggers `/help` for full formatted command reference in chat
- **User Commands**: `/help`, `/usage`, `/review`, `/diff`, `/mcp`, `/plan`, `/exit`, `/accept`, `/reject`, `/model`
- **CLI Passthrough**: `/delegate`, `/agent`, `/skills`, `/plugin`, `/login`, `/logout` (opens terminal)
- **Improved UX**: Unsupported commands show friendly help message instead of being sent to AI

#### Claude Opus 4.6 Model Support
- **Latest Models**: Added `claude-opus-4.6` and `claude-opus-4.6-fast`
- **Model Capabilities Service** — Caches model info to reduce API calls
- **Smart Attachment Validation** — Checks model vision capabilities before sending images

#### Auto-Resume After VS Code Reload
- **Automatic Reconnection** — CLI session resumes when VS Code reloads with sidebar open
- **History Restoration** — Previous conversation loads from Copilot CLI's event log
- **State Preservation** — Active file, plan mode status, and metrics restored across reloads

### 🏗️ Architecture

#### Component-Based UI (9 Components)
Replaced 1200+ line monolithic script with modular component architecture:
- **MessageDisplay** — Renders user/assistant messages, reasoning traces, tool execution groups
- **ToolExecution** — Collapsible tool groups with expand/collapse, diff buttons, result display
- **InputArea** — Message input with @file references, image attachments, `/` trigger panel
- **SessionToolbar** — Session dropdown, model selector, new session button, view plan button
- **AcceptanceControls** — Plan acceptance UI (accept/reject buttons, plan summary)
- **StatusBar** — Usage metrics (window %, tokens used, quota remaining), help icon (?)
- **ActiveFileDisplay** — Shows filename with full path tooltip
- **PlanModeControls** — Plan mode toggle with separate model selector
- **SlashCommandPanel** — Grouped slash command reference panel for discoverability

**EventBus Pattern** — Decoupled pub/sub communication between components and extension:
- 45+ event types defined in shared/messages.ts
- Components emit events, extension and other components listen
- Eliminates tight coupling and circular dependencies

#### Type-Safe RPC Layer
- **ExtensionRpcRouter** (520 lines) — Typed send/receive methods replacing raw postMessage
  - 31 message types with TypeScript interfaces
  - `send()`, `receive()`, `request()` methods with full type safety
  - Message tracking and debugging built-in
- **WebviewRpcClient** (390 lines) — Typed callback registration for webview
  - `on()`, `emit()`, `call()` methods matching extension router
  - Automatic message ID generation for request/response matching
- **shared/messages.ts** — Central type definitions for all 31 message types
  - Request/response pairs: `SessionListRequest`/`SessionListResponse`
  - Event notifications: `AssistantMessageEvent`, `ToolStartEvent`, etc.
  - Type guards for runtime validation

#### Service Extraction (7 Services)
Extracted from monolithic `extension.ts` for clean separation of concerns:
- **SessionService** — Session lifecycle, creation, switching, resume logic
- **InlineDiffService** — Git-based diff generation, formatting, and display
- **fileSnapshotService** — Git snapshots for file state tracking
- **mcpConfigurationService** — MCP server configuration and discovery
- **modelCapabilitiesService** — Model info caching and attachment validation
- **planModeToolsService** — Plan mode tool definitions and whitelisting
- **messageEnhancementService** — Message formatting, @file resolution, active file injection

Each service is independently testable with clear boundaries and responsibilities.

#### MutableDisposable Pattern - Memory Leak Fix
- **Problem**: Event handlers accumulated on every session switch, causing memory growth
- **Solution**: `MutableDisposable` wrapper that disposes old handlers before setting new ones
- **Impact**: Extension can run indefinitely without memory leaks
- **Clean Disposal Chain**: Extension → Services → Components → DOM
  - Each layer properly disposes its resources when deactivated
  - No orphaned event listeners or subscriptions

### 🧪 Testing

#### Comprehensive Test Suite (710+ Tests)
- **Unit Tests** — All components, services, and utilities
- **Integration Tests** — Cross-component flows (EventBus, RPC layer)
- **E2E Tests** — Full user scenarios (session creation, message sending, plan acceptance)
- **JSDOM-Based Component Testing** — Real DOM manipulation testing without browser
- **Test Helpers Library** — Reusable mocks for scroll geometry, VS Code API, RPC clients

#### TDD Methodology Enforced
- **RED-GREEN-REFACTOR** — Every feature starts with a failing test
- **Integration Tests** — Import actual production code, not mocks
- **Flow Testing** — Tests execute full user interaction flows (click → event → handler → UI)
- **Mandatory Checklist** — Every PR must pass test quality checklist

**Test locations**:
- `tests/*.test.js` — Integration tests (must import production code)
- `tests/*.test.mjs` — SDK-specific tests (ESM modules)
- Webview tests use JSDOM to test actual DOM manipulation

### 🐛 Bug Fixes

#### Session Dropdown Fixes
- Fixed session list not updating when creating new session
- Fixed dropdown not showing current session on initial load
- Fixed race condition between session creation and dropdown render

#### View Plan Button Fixes
- Fixed button showing when no plan.md exists
- Fixed button click not opening correct plan file
- Added proper state tracking for plan file existence

#### RPC Message Extraction Fixes
- Fixed message content extraction for streaming messages
- Fixed tool execution result display for complex nested structures
- Added proper type guards for message format validation

#### Scroll Geometry Fixes
- Fixed auto-scroll not triggering after new message added
- Fixed scroll position jumping when expanding/collapsing tool groups
- Added proper scroll threshold detection (within 50px of bottom)

### 📝 Documentation

#### Updated Architecture Documentation
- Added component architecture diagram
- Documented RPC layer and message types
- Explained service layer responsibilities
- Added EventBus communication patterns

#### Test Quality Standards
- Documented TDD methodology requirements
- Added anti-patterns guide (2026-02-09 diff button bug lessons)
- Created mandatory test quality checklist
- Defined integration test requirements (JSDOM, production code import)

### 💥 Breaking Changes

- **UI Location Changed** — Extension now lives in Activity Bar sidebar (not floating panel)
  - Click icon in Activity Bar (left side by default) to show/hide chat
  - Users may need to drag to preferred sidebar location (View → Chat for right sidebar)
  - No configuration changes needed — extension automatically appears in Activity Bar

### 🔄 Migration

- **Automatic Migration** — Extension appears in Activity Bar on first launch after update
- **Session Preservation** — Previous sessions remain accessible and auto-resume works
- **No Config Changes** — All existing settings and configurations carry over
- **Sidebar Preference** — Drag to right sidebar if preferred (View → Chat)

## [2.2.3] - 2026-02-08

### ✨ Features

#### Session Resume Retry with Circuit Breaker
- Added intelligent retry logic for session resume failures
  - **Circuit Breaker Pattern:** Retries up to 3 times with exponential backoff (1s, 2s delays)
  - **Smart Error Classification:** Different strategies for different error types:
    - `session_expired`: Skip retries, create new session immediately
    - `authentication`: Fail fast (requires user to fix auth)
    - `network_timeout`: Retry with backoff (transient network issues)
    - `session_not_ready`: Retry with backoff (CLI still starting)
    - `unknown`: Retry with backoff (conservative approach)
  - **User Recovery Dialog:** When all retries fail, shows contextual dialog:
    - "Previous session not found" for expired sessions
    - "Cannot connect to Copilot CLI" for network errors
    - "Copilot CLI not ready" for CLI connection issues
    - User can choose "Try Again" or "Start New Session"
  - **Comprehensive Logging:** Detailed retry timeline in output channel for debugging

### 🐛 Bug Fixes

#### Session Resume Reliability
- Fixed session resume giving up immediately on transient errors
  - Previously: One error = new session (lost conversation history)
  - Now: Retries transient failures automatically before giving up
  - Better UX: User has final say on session fate via recovery dialog
  - No infinite loops: Maximum 3 retry attempts enforced

## [2.2.2] - 2026-02-07

### 🐛 Bug Fixes

#### Active File Display
- Fixed "Active File" showing output channel name on extension start
  - Now correctly filters initial `activeTextEditor` by scheme ('file' or 'untitled')
  - Previously only filtered in change listener, not initial value
  - Prevents output channels from being displayed as "active file"

#### Metrics Reset on New Session
- Session-level metrics (Window %, Used tokens) now reset when creating new session
  - Fixed metrics persisting across session changes
  - Account-level metric (Remaining %) correctly preserved
  - Added `resetMetrics` flag to status events

#### Image Thumbnail Positioning
- Fixed uploaded image thumbnails appearing outside user's message bubble
  - Attachments now rendered inside `.message-content` div
  - Properly contained within chat bubble styling
  - Visual grouping with message text

#### Planning Test Suite
- Fixed failing test for edit tool restriction in plan mode
  - Updated test to verify configuration instead of relying on message failures
  - Test now correctly validates that SDK whitelist excludes 'edit' tool
  - All 12 plan mode tests passing

#### View Plan Button
- Fixed "View Plan" button failing to open plan.md file
  - Was using VS Code workspace path instead of session state directory
  - Now uses correct path: `~/.copilot/session-state/{sessionId}/plan.md`
  - Works correctly when in plan mode (uses work session ID, not plan session ID)
  - Added file existence check - shows helpful message if plan.md doesn't exist yet
  - Prevents confusing "file not found" errors when no plan has been created

#### Session History Loading Race Condition
- Fixed critical bug where session history wasn't loaded on extension startup
  - **Root Cause:** Webview was created before history finished loading
  - **Symptom:** Opening chat showed blank history until switching sessions
  - **Fix:** Load history into BackendState BEFORE creating webview panel
  - Now history loads reliably on first open instead of requiring session switch
  - Prevents 138ms race condition between webview ready and file stream close events

## [Unreleased]

### 🧹 Chore

- Removed deprecated `cliProcessManager.ts` (v1.0 legacy implementation)
  - This file was superseded by `sdkSessionManager.ts` in v2.0 (January 2026)
  - No functionality lost - all features are in the SDK-based implementation
  - Historical reference preserved in git history (pre-v2.0 commits)

## [2.2.1] - 2026-02-06

### 🔐 Authentication & Enterprise Support

#### Authentication Detection & Guidance
- 🔍 **Smart Error Detection** - Automatically detects authentication failures
  - Classifies errors: authentication, session expired, network, or unknown
  - Comprehensive logging with error context for debugging
  - Different handling for environment variable auth vs. OAuth
  - **Test Coverage**: 9/9 tests passing for error classification and env var detection

#### Terminal-Based Authentication Flow
- ✨ **Interactive Authentication** - One-click authentication setup
  - Click "Authenticate Now" button in error dialog
  - Extension opens terminal with `copilot login` command pre-filled
  - Clear instructions guide users through the process
  - "Retry" button to test authentication after completion

#### Environment Variable Support
- 🔑 **Token-Based Authentication** - Detects and validates environment variables
  - Checks `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN` (in priority order)
  - Logs which variable is detected (without exposing token value)
  - Shows helpful error if token is invalid or expired
  - Suggests updating token or using interactive login

#### GitHub Enterprise SSO
- 🏢 **Enterprise SSO Support** - First-class support for SSO-enabled enterprises
  - New setting: `copilotCLI.ghSsoEnterpriseSlug`
  - Automatically generates SSO login command with enterprise slug
  - Example: `copilot login --host https://github.com/enterprises/acme/sso`
  - Regex validation ensures slug format is correct
  - Clear documentation for when to use (SSO-enabled enterprises only)

#### User Experience Improvements
- 📚 **Comprehensive Documentation** - Clear auth instructions in README
  - Step-by-step guide for interactive OAuth login
  - Environment variable setup for automation/CI
  - GitHub Enterprise SSO configuration guide
  - Troubleshooting section with common issues
  - Links to official GitHub documentation

### 🐛 Bug Fixes

- Fixed: Generic "Failed to start SDK session" errors with no actionable guidance
- Fixed: No detection of authentication vs. other error types
- Fixed: No support for GitHub Enterprise SSO authentication paths
- Fixed: "Retry" button in notification disappears - now shows clear instructions in chat panel with "Start New Session" guidance

## [2.2.0] - 2026-02-06

### 🎨 New Features

#### Image Attachment Support
- 📎 **Attach Images to Messages** - Send images to vision-capable AI models
  - Click attachment button (📎) next to input box to select images
  - Preview thumbnails with filename and size before sending
  - Remove individual attachments before sending message
  - Supports PNG, JPEG, GIF, WebP formats
  - Validated against model capabilities (size limits, count limits, types)

#### Vision Model Detection
- 🤖 **Automatic Vision Capability Detection**
  - Extension detects which models support image analysis
  - Model capabilities cached for performance
  - Real-time validation prevents errors before sending
  - Clear error messages when model doesn't support images

#### Error Handling & Validation
- ✅ **Comprehensive Attachment Validation**
  - File size validation (enforced by model capabilities)
  - Image count validation (enforced by model capabilities)
  - File type validation (images only for now)
  - Clear error dialogs guide users when validation fails
  - Session remains functional after validation errors

### 🏗️ Architecture Improvements

#### Services Refactor (Phase 5.5)
- 🧹 **SDKSessionManager Reduced by 31%** (1946 → 1345 lines)
  - Extracted 4 new services with single responsibilities:
    - `MessageEnhancementService` - Message formatting and context injection
    - `FileSnapshotService` - Git snapshot generation (8/8 tests ✅)
    - `MCPConfigurationService` - MCP server configuration (9/9 tests ✅)
    - `PlanModeToolsService` - Custom tools for plan mode (22/22 tests ✅)
  - Better separation of concerns and maintainability
  - Test-driven development: 39 new tests passing

### 🐛 Bug Fixes

#### Model Capabilities Service
- Fixed critical bug in `ModelCapabilitiesService.fetchAllModels()`
  - SDK's `listModels()` returns `ModelInfo[]` directly, not `{models: []}`
  - Bug caused 0 models to be cached, resulting in "Model not found" warnings
  - All models now correctly cached and detected

### 🧪 Testing

#### Integration Tests
- Created `tests/attachment-non-vision-e2e.test.js` (5/5 tests passing)
  - Tests non-vision model (gpt-3.5-turbo) rejecting attachments
  - Validates error propagation through all layers
  - Verifies session resilience after validation errors
  - New npm script: `npm run test:attachment-error`
- Test fixture: `tests/fixtures/test-icon.png` (4.32 KB)

### 📝 Known Limitations

The following features are deferred to v2.2.1:
- Attachment button doesn't disable for non-vision models (shows error after file selection instead)
- Tool-returned images not displayed (AI can receive images but cannot return them yet)
- Attachment history not persisted (attachments don't show in session resume)
- Plan mode attachment support not tested (should work but needs validation)

## [2.1.4] - 2026-02-04

### 🐛 Bug Fixes

### Active File Context Fix

- Fixed active file context not being sent to the LLM when chat panel has focus
- Extension now tracks the last active text editor via `onDidChangeActiveTextEditor` event
- Active file context is preserved even when focus moves to the chat webview
- Plan mode sessions now receive workspace root and active file context (matching work mode)
- Added comprehensive diagnostic logging in `enhanceMessageWithContext()` method
- Technical: Both backend (`SDKSessionManager`) and UI (`extension.ts`) now use consistent `lastActiveTextEditor` pattern

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