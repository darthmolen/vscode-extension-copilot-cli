# Copilot CLI Chat for VS Code

## Why This Extension?

VS Code already ships a native Copilot chat — and it's great as a general-purpose tool. This extension takes a different approach: a focused, session-driven workflow designed to keep you in flow while coding.

Think of it as the difference between a Swiss Army knife and a purpose-built tool. Where the native experience covers everything, this extension is optimized for deep think sessions — rich streaming, plan-vs-implement separation, and a Claude Code-inspired UX that stays out of your way.

Your decisions stay where your focus is. When the agent edits a file, you see the diff right in the chat stream — review it, tell the agent what to change, or click through to edit it yourself. No context-switching to scattered inline annotations. No accept/reject popups pulling you out of your conversation. You're already talking to the agent — that's where your decisions should happen.

And you don't have to choose. Sessions created in this extension appear in the official Copilot extension's session list, so you can switch between both seamlessly. Don't worry, this extension will wait. We know you'll be back for the more focused experience.

[![Version](https://img.shields.io/visual-studio-marketplace/v/darthmolen.copilot-cli-extension)](https://marketplace.visualstudio.com/items?itemName=darthmolen.copilot-cli-extension)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/darthmolen.copilot-cli-extension)](https://marketplace.visualstudio.com/items?itemName=darthmolen.copilot-cli-extension)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/darthmolen.copilot-cli-extension)](https://marketplace.visualstudio.com/items?itemName=darthmolen.copilot-cli-extension)

## ✨ Features

### 📌 Activity Bar Sidebar

The extension lives in the VS Code Activity Bar — same location as native Copilot Chat and Claude Code. Click the icon to show/hide, drag between left and right sidebars. Native chat experience with proper lifecycle management and zero memory leaks.

### 🎯 Focused by Design

- **In-Stream Diffs** — File edits show compact inline diffs (+/- prefixes) directly in the chat stream. Larger diffs truncate with a "View Diff" button. Review, approve, or redirect the agent without leaving your conversation.
- **Plan Mode (ACE-FCA)** — Separate planning and implementation into dual sessions. Explore with read-only tools, then hand off a solid plan to your work session.
- **Plan Model Selection** — Use different AI models for planning vs. implementation. Think with Opus, build with Sonnet, explore with Haiku.
- **Reasoning Visibility** — Watch the agent think in real-time with streaming reasoning traces.

### 🔄 Session-First Workflow

- **Session Interop** — Sessions appear in the official Copilot extension's session list. Switch between both experiences freely.
- **Auto-Resume** — Picks up where you left off, even after VS Code reloads. Full conversation history loads from Copilot CLI's event log.
- **Session Resilience** — Smart retry logic handles transient failures automatically (v2.2.3+).
- **Session Management** — Create, switch, and resume sessions from a dropdown. Filtered by workspace folder.
- **Usage Metrics** — Live context window percentage, token usage, and quota tracking per session.

### 🛠️ Rich Agent Experience

- **In-Stream Tool Execution** — Collapsible tool groups show exactly what the agent is doing, inline with the conversation.
- **Image Attachments** — Send screenshots and diagrams to vision-capable models with preview thumbnails.
- **Active File Context** — The agent always knows which file you're working on, even when chat has focus.
- **@file References** — Reference files directly in your messages.
- **15 AI Models** — GPT-5, Claude Sonnet 4.6/4.5, Claude Opus 4.6, Gemini 3 Pro, and more.
- **MCP Server Integration** — GitHub MCP built-in by default, add custom servers for filesystem, memory, fetch, and more.

### ⚡ Developer Control

- **YOLO Mode** — All permissions enabled for fast iteration (default, recommended).
- **Granular Permissions** — Or lock it down: control tool access, file paths, and URLs individually.
- **Enterprise SSO** — First-class GitHub Enterprise support for sso authentication.
- **Cross-Platform** — Linux, macOS, and Windows (PowerShell v6+).

### v3.1.1 - Claude Sonnet 4.6 + Model Fallback

- **Claude Sonnet 4.6** — Added `claude-sonnet-4.6` to both work and plan mode model selection dropdowns.
- **Automatic model fallback** — If the selected model is not available on your enterprise or was mistyped, the extension falls back to `claude-sonnet-4.5` automatically and shows a warning notification.

### v3.1.0 - Inline Image Rendering

- **Agent-created images render in chat** — When the agent creates SVG, PNG, or other image files and mentions the path, the image renders inline in the sidebar. Supports bare paths (`images/chart.svg`) and markdown image syntax.
- **Clickable file path links** — Image paths display as clickable links that open the file in a VS Code editor tab.
- **"File not found" annotation** — When a referenced image doesn't exist on disk, the path is annotated with *file not found* so you know the tool execution failed.
- **SVG code block rendering** — SVG content in code blocks renders as actual images in the chat.
- **Paste images from clipboard** — Ctrl+V to paste images directly into the chat input.
- **Individual tool card collapse** — Click any tool execution header to collapse/expand that specific card.
- **Tool group stability** — Expanded tool groups no longer auto-collapse when messages arrive.
- **URL overflow fix** — Long URLs no longer break out of message bubbles.

### v3.0.1

- **SDK Upgrade to 0.1.22** — Enables first-class hooks system for reliable tool interception
- **File Diff Fix** — View Diff now correctly shows original file content via `onPreToolUse` hook (fixes race condition where snapshots captured empty/modified files)
- **Plan Mode Diff for update_work_plan** — Custom plan-mode tool now emits file diffs when writing plan.md (captures pre-write snapshot and shows Before ↔ After)

### v3.0.0 - Complete Architectural Overhaul 🚀

**Inline Diffs in Chat Stream**
- File edits show compact inline diffs directly in chat (up to 10 lines with +/- prefixes)
- Larger diffs show "... N more lines" with "View Diff" button for full picture
- Review, approve, or redirect the agent without leaving the conversation
- Decision-making stays in the chat flow

**Slash Commands (41 Commands) with Discovery Panel**
- Type `/` in the chat input to see a grouped command reference panel
- Click any command to insert it, or use the `?` icon next to metrics for full `/help` output
- `/help` — Show all available commands
- `/usage` — View session metrics (tokens, context window)
- `/review` — Show current plan
- `/diff file1 file2` — Compare two files
- `/mcp` — Show MCP server configuration
- And 36 more commands for debugging, inspection, and control

**Auto-Resume After Reload**
- CLI session automatically resumes when VS Code reloads
- Previous conversation history loads from Copilot CLI's event log
- No more lost sessions when restarting VS Code

**Claude Opus 4.6 Support**
- Added latest `claude-opus-4.6` and `claude-opus-4.6-fast` models
- Smart model capability detection for image attachments
- Now supporting 16 AI models total

**Reliability & Performance**
- Component-based architecture (9 components) for maintainability
- Type-safe RPC layer (31 message types) eliminates message bugs
- Service extraction (7 services) with clear boundaries
- 710+ tests ensure quality (unit, integration, e2e)
- Memory leak fixed — runs indefinitely without crashes

### v2.2.3 - Session Resume Resilience 🔄

- 🔁 **Smart Retry Logic** - Automatic recovery from transient failures
  - Circuit breaker pattern retries up to 3 times with exponential backoff (1s, 2s delays)
  - Handles network drops, CLI startup delays, and temporary connection issues
  - No more lost sessions from transient errors
  - Detailed retry timeline in output logs for debugging
  
- 🎯 **Intelligent Error Classification** - Different strategies for different errors
  - Session expired → Creates new session immediately (no retries)
  - Authentication errors → Fails fast (requires user to fix auth)
  - Network timeouts → Retries automatically (transient issue)
  - CLI not ready → Retries with patience (CLI still starting)
  - Unknown errors → Retries conservatively (safe default)
  
- 💬 **User Recovery Dialog** - You decide what happens after retries
  - Shows contextual error message based on failure type
  - "Try Again" button → Retries the resume operation
  - "Start New Session" button → Creates fresh session
  - Appears only after automatic retries are exhausted
  - Never lose conversation history without your decision

### v2.2.2 - Bug Fixes & Polish 🐛

- 🔄 **Session History Loading Fixed** - Chat history now loads immediately
  - Fixed issue where previous conversation didn't appear until switching sessions
  - History now loads reliably when opening chat panel
  - No more workaround of switching away and back to see your messages
  
- 🐛 **Active File Display Fixed** - Correct file shown at extension start
  - No longer shows output channel name as "active file"
  - Filters initial editor by scheme (file/untitled only)
  - Cleaner, more accurate status display
  
- 📊 **Metrics Reset on New Session** - Fresh metrics for each session
  - Session-level metrics (Window %, Used tokens) reset when starting new session
  - Account-level metric (Remaining %) correctly preserved
  - No more stale metrics from previous sessions
  
- 🎨 **Image Thumbnail Positioning** - Better visual grouping
  - Uploaded image thumbnails now inside user's message bubble
  - Properly aligned with message text
  - Consistent styling across all attachments
  
- 📋 **View Plan Button Fixed** - Opens plan.md from correct location
  - Now opens plan files from session state directory
  - Shows helpful message when no plan exists yet
  - Works correctly in both work and plan modes
  
- ✅ **Test Suite Fixed** - All 12 plan mode tests passing
  - Corrected edit tool restriction test logic
  - Verifies SDK whitelist correctly excludes edit tool in plan mode

### v2.2.1 - Authentication Detection & Enterprise Support 🔐

- 🔍 **Smart Authentication Detection** - Automatic error detection and guidance
  - Extension detects when Copilot CLI is not authenticated
  - Clear, actionable error messages instead of generic failures
  - Different handling for OAuth vs. environment variable authentication
  - Comprehensive logging for debugging authentication issues
  
- ✨ **One-Click Authentication** - Terminal-based interactive setup
  - Click "Authenticate Now" button in error dialog
  - Extension opens terminal with `copilot login` command pre-filled
  - Follow device code flow in browser to complete authentication
  - "Retry" button to test authentication after completion
  
- 🔑 **Environment Variable Support** - Token-based authentication detection
  - Detects `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN` (priority order)
  - Validates tokens and shows helpful error if invalid/expired
  - Suggests updating token or using interactive login
  - Supports automation and CI/CD scenarios
  
- 🏢 **GitHub Enterprise SSO** - First-class enterprise support
  - New setting: `copilotCLI.ghSsoEnterpriseSlug` for SSO-enabled enterprises
  - Auto-generates SSO login command with enterprise slug
  - Example: `copilot login --host https://github.com/enterprises/acme/sso`
  - Clear documentation for when SSO configuration is needed
  - Works seamlessly with standard GitHub Enterprise (no SSO)

### v2.2.0 - Image Attachment Support 🎨

- 📎 **Attach Images to Messages** - Send images to vision-capable AI models
  - Click attachment button (📎) next to chat input box
  - Select PNG, JPEG, GIF, or WebP images from file picker
  - Preview thumbnails with filename and size before sending
  - Remove individual attachments before sending
  - Automatic validation (size, count, type) prevents errors
  - Works with GPT-4o, Claude Sonnet 4, and other vision-capable models
  
- 🤖 **Vision Model Detection** - Smart capability detection
  - Extension automatically detects which models support image analysis
  - Model capabilities cached for performance
  - Clear error messages when model doesn't support images
  - Session remains functional after validation errors
  
- 🏗️ **Architecture Refactor** - Cleaner, more maintainable code
  - SDKSessionManager reduced by 31% (1946 → 1345 lines)
  - 4 new services with single responsibilities
  - 39 new tests ensuring quality
  - Test-driven development throughout

**Known Limitations** (coming in v2.2.1):
- Attachment button doesn't disable for non-vision models
- Tool-returned images not displayed yet
- Attachment history not persisted in session resume

### v2.1.4 - Active File Context Fix

- 🐛 **Active File Context Preserved** - AI now knows which file you're working on
  - Fixed: Active file context not sent to LLM when chat panel has focus
  - Extension tracks last active text editor, preserves context across focus changes
  - Works in both work mode and plan mode
  - No need to manually specify filenames anymore!

### v2.1.3 - Session Filtering Fix

- 🐛 **Session Dropdown Filtering** - Fixed workspace folder filtering
  - Dropdown now correctly shows only workspace-specific sessions when filtering is enabled
  - Previously showed all sessions but only workspace ones were resumable (confusing)
  - Setting: `copilotCLI.filterSessionsByFolder`

### v2.1.2 - Plan Mode Model & Bug Fixes

- ⚙️ **Plan Mode Model Configuration** - Use different AI models for planning vs implementation
  - Added `copilotCLI.planModel` setting for model selection in planning mode
  - Cost optimization: Use Haiku for planning, Sonnet for work
  - Extensive planning: Use Opus for planning, Sonnet for work
  - Falls back to work mode model if not specified

- 🐛 **Session Expiration Recovery** - Fixed CLI becoming unresponsive after timeout
  - Session recreation now maintains client connection
  - Seamless recovery without manual intervention

- 🎨 **UI Polish** - Larger planning mode icons for better visibility

### v2.1.1 - Stability & Polish

- 🐛 **Bug Fixes** - Enhanced reliability and user experience
  - **Active File Persistence**: File context no longer disappears when clicking in input box
  - **Session State**: Chat panel properly preserves session when closed and reopened
  - **Session List Cleanup**: Empty and corrupt sessions filtered from dropdown
  - **Auto-Recovery**: Gracefully handles expired sessions without manual intervention

### v2.0.6 - Plan Mode & UI Enhancements

- 📋 **Plan Mode (ACE-FCA)** - Dedicated planning session separate from implementation
  - **Dual Sessions**: Work session for coding, plan session for exploration
  - **Sandboxed Tools**: 11 safe tools in plan mode (read-only, exploration only)
  - **Auto-Context**: Automatically injects plan path when switching to work mode
  - **Icon Buttons**: Compact planning controls (📝, ✅, ❌, 📋)
  - See [PLAN_MODE.md](./PLAN_MODE.md) for complete guide

### v2.0 - Now Powered by Copilot SDK

- ⚡ **SDK 2.0 Integration** - Built on official [@github/copilot-sdk](https://github.com/github/copilot-sdk) for production-ready agent runtime
- 🎯 **Real-time Streaming** - See AI responses as they're generated with `assistant.message_delta` events
- 🧠 **Reasoning Visibility** - Watch Copilot think with `assistant.reasoning_delta` events (when available)
- 📡 **Event-Driven Architecture** - JSON-RPC communication with Copilot CLI server mode

### Core Features

- 💬 **Interactive Chat Panel** - Dockable chat interface with full markdown rendering (code blocks, lists, headers, links)
- 📜 **Session Management** - Resume previous conversations, switch between sessions with dropdown selector
- 🔄 **Auto-resume** - Automatically picks up where you left off (configurable)
- 📚 **Full History** - Loads complete conversation history from Copilot CLI's events.jsonl
- 📊 **Usage Statistics** - Real-time context window, token usage, and quota tracking
- 🔧 **Tool Grouping** - Collapsible tool execution groups with expand/collapse
- ⚙️ **Complete CLI Configuration** - All Copilot CLI flags configurable via VS Code settings
- 🚀 **YOLO Mode** - Quick development mode with all permissions enabled (default, recommended)
- 🤖 **14 AI Models** - Choose from GPT-5, Claude 4.5 Sonnet/Opus, Gemini 3 Pro, and more
- 🔧 **Granular Permissions** - Control tool access, file paths, and URLs individually
- 📂 **Active File Context** - Automatically includes current file and selection
- 🔗 **@file References** - Resolve file references in messages
- ♿ **Accessibility** - Screen reader optimizations, ARIA labels, semantic HTML
- 🌍 **Cross-Platform** - Works on Linux, macOS, and Windows

## 📦 Installation

### From VS Code Marketplace

1. Open VS Code
2. Press `Ctrl+Shift+X` (or `Cmd+Shift+X` on Mac)
3. Search for "Copilot CLI Chat"
4. Click **Install**

### From Command Line

```bash
code --install-extension darthmolen.copilot-cli-extension
```

### Prerequisites

- **VS Code** 1.108.1 or higher
- **GitHub Copilot CLI** (standalone `copilot` command)
  - **Linux/macOS**: `brew install copilot-cli`
  - **Windows**: `winget install GitHub.Copilot`
  - **Note**: Requires PowerShell v6+ on Windows
  - See: https://docs.github.com/copilot/concepts/agents/about-copilot-cli
- **Active Copilot subscription**

⚠️ **Important**: This extension requires the **new standalone Copilot CLI**, NOT the deprecated `gh copilot` extension.

### Authentication

Before using the extension, you must authenticate the Copilot CLI with GitHub.

#### Option 1: Interactive Login (Recommended)

The extension will automatically guide you if authentication is needed:

1. Open the chat panel (Ctrl+Shift+P → "Copilot CLI: Open Chat")
2. If not authenticated, click **"Authenticate Now"** in the error dialog
3. The extension opens a terminal with the `copilot login` command pre-filled
4. Follow the device code flow in your browser to complete authentication
5. Click **"Retry"** in VS Code to start your session

**Manual authentication**: You can also run `copilot login` in any terminal, then restart the extension.

#### Option 2: Environment Variable

For automation or CI/CD scenarios, set an authentication token as an environment variable:

1. Create a fine-grained Personal Access Token (PAT) with "Copilot Requests" permission
   - Go to: https://github.com/settings/tokens?type=beta
   - Generate new token → Select "Copilot Requests" scope
2. Set the environment variable (priority order):
   - **`COPILOT_GITHUB_TOKEN`** (highest priority)
   - **`GH_TOKEN`**
   - **`GITHUB_TOKEN`** (lowest priority)
3. Restart VS Code to pick up the environment variable

**Linux/macOS**:
```bash
export GH_TOKEN="ghp_your_token_here"
code  # Restart VS Code from terminal to inherit env vars
```

**Windows (PowerShell)**:
```powershell
$env:GH_TOKEN="ghp_your_token_here"
code  # Restart VS Code
```

**Note**: If a token is set but authentication fails, the extension will notify you that the token appears invalid or expired.

#### GitHub Enterprise with SSO

**Only for enterprises with SSO enabled** (most enterprises don't need this):

If your GitHub Enterprise organization requires SSO and uses the `/enterprises/{slug}/sso` authentication path:

1. Get your enterprise slug from your admin (e.g., `acme`)
2. Configure in VS Code settings:
   - Open Settings (Ctrl+,)
   - Search for "Copilot CLI GH SSO Enterprise Slug"
   - Enter just the slug: `acme`
3. When authenticating, the extension will automatically generate:
   ```bash
   copilot login --host https://github.com/enterprises/acme/sso
   ```

**When to use this**:
- ✅ Your enterprise has SSO enabled and requires `/enterprises/{slug}/sso` path
- ❌ Using github.com (public GitHub) - leave empty
- ❌ Using GitHub Enterprise Server (self-hosted) - leave empty
- ❌ Using GitHub Enterprise Cloud without SSO - leave empty

**Regular GitHub Enterprise** (without SSO): Just use the standard `copilot login` command - no configuration needed.

## 🚀 Quick Start

### Open the Chat Sidebar

**Option 1: Activity Bar Icon (NEW in v3.0.0)**

1. Look for the Copilot CLI icon in the Activity Bar (left side by default)
2. Click the icon to show/hide the chat sidebar
3. **Drag to right sidebar**: View → Appearance → Move Side Bar Right (or drag the icon)

**Option 2: Command Palette**

1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
2. Type "Copilot CLI: Open Chat"
3. Press Enter

**Option 3: Status Bar**

- Click the "💬 Copilot CLI" item in the status bar

**Option 4: Editor Toolbar**

- Click the chat icon in the editor toolbar

### Start Chatting

1. The chat sidebar opens in the Activity Bar (left or right side)
2. Your last session automatically resumes (if enabled)
3. Type your message and press Enter or click Send
4. View AI responses with full markdown formatting
5. See inline diffs when the agent edits files

### Manage Sessions

- **Session Dropdown**: Select from previous conversations
- **New Session** (+): Start a fresh conversation
- **Auto-resume**: Toggle in settings to auto-load last session
- **Slash Commands**: Type `/help` to see all available commands

## ⚙️ Configuration

All Copilot CLI flags are configurable via VS Code settings:

```json
{
  "copilotCLI.yolo": true,                // YOLO mode (all permissions) - recommended
  "copilotCLI.resumeLastSession": true,   // Auto-resume last session on open
  "copilotCLI.cliPath": "copilot",        // Path to copilot executable
  "copilotCLI.model": "",                 // AI model (empty = default claude-sonnet-4.5)
  "copilotCLI.planModel": "",             // AI model for planning mode (empty = use same as work mode)
  "copilotCLI.allowAllTools": false,      // Auto-approve all tools
  "copilotCLI.allowTools": [],            // Specific tools: ["shell(git)", "write"]
  "copilotCLI.denyTools": [],             // Block tools: ["shell(rm)"]
  "copilotCLI.allowUrls": [],             // Specific URLs/domains
  "copilotCLI.denyUrls": [],              // Block URLs/domains
  "copilotCLI.addDirs": [],               // Additional allowed directories
  "copilotCLI.noAskUser": false           // Autonomous mode (no questions)
}
```

### Tool Specification Format

- Shell commands: `"shell(COMMAND)"` - e.g., `"shell(git)"`, `"shell(npm)"`
- File writes: `"write"`
- MCP servers: `"MCP_SERVER_NAME(tool_name)"`

### Available Models

Choose from 16 AI models in settings:

- Claude Sonnet 4.5 (default), Claude Haiku 4.5, Claude Opus 4.5
- **Claude Opus 4.6, Claude Opus 4.6 Fast** (NEW in v3.0.0)
- GPT-5, GPT-5.1, GPT-5.2, GPT-5 mini, GPT-4.1
- GPT Codex variants (5.1, 5.1 max, 5.1 mini, 5.2)
- Gemini 3 Pro Preview

### Plan Mode Model

Use a different AI model for planning mode vs work mode. This allows you to optimize for speed and cost or extensive planning and easy implementation.

If `copilotCLI.planModel` is not set, planning mode uses the same model as work mode.

#### Cost Optimization

- **Cost optimization**: Use cheaper models for planning, premium models for implementation
- **Speed**: Use faster models for exploratory planning
- **Flexibility**: Different models may excel at different tasks

```json
{
  "copilotCLI.model": "claude-sonnet-4.5",        // For work mode (implementation)
  "copilotCLI.planModel": "claude-haiku-4.5"      // For plan mode (faster/cheaper exploration)
}
```

#### Extensive Planning

- **Deep Dive Concepts** - Maybe you really want the agent to pull down tons of research and put together the monster roadmap for a product
- **Unravel Complex Code** - Deep code bases require more thought so having a larger and newer LLM aids in less rework.
- **Refactor** - it's always best to think more and write less when refactoring.

```text
"Better to plan once well than implement twice"
-- Every experienced developer
```

```json
{
  "copilotCLI.model": "claude-sonnet-4.5",        // For work mode (faster implementation. might even consider haiku if your plan is good enough)
  "copilotCLI.planModel": "claude-opus-4.5"      // For plan mode (extensive exploration/research/planning)
}
```

### MCP Server Integration

**Model Context Protocol (MCP)** servers provide pre-built tools for AI agents. The GitHub MCP Server is **built-in and enabled by default**, giving Copilot access to repositories, issues, and pull requests automatically.

#### Configure Additional MCP Servers

Add custom MCP servers via settings:

```json
{
  "copilotCLI.mcpServers": {
    "filesystem": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "${workspaceFolder}"],
      "tools": ["*"]
    },
    "memory": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"],
      "tools": ["*"]
    }
  }
}
```

#### Popular MCP Servers

**Official Reference Servers**:

- `@modelcontextprotocol/server-filesystem` - Secure file operations with access controls
- `@modelcontextprotocol/server-fetch` - Web content fetching and conversion
- `@modelcontextprotocol/server-git` - Git repository operations and search
- `@modelcontextprotocol/server-memory` - Knowledge graph-based persistent memory

**MCP Server Types**:
- **Local (stdio)**: Execute a command locally (e.g., npx, python, node)
- **Remote (HTTP/SSE)**: Connect to a remote server via URL

Browse more servers at the [MCP Registry](https://registry.modelcontextprotocol.io/).

**Note**: Each server can be enabled/disabled via the `enabled: false` property.

## 🔧 Architecture

### v3.0 Architecture

```
VS Code Activity Bar
        ↓
  WebviewViewProvider (sidebar integration)
        ↓
Extension Host (Node.js)
  extension.ts orchestrator
       ↓
  Extracted Services (7)
    SessionService, InlineDiffService, fileSnapshotService,
    mcpConfigurationService, modelCapabilitiesService,
    planModeToolsService, messageEnhancementService
       ↓
  ExtensionRpcRouter (typed send/receive)
       ↓ postMessage
Webview (Browser)
  WebviewRpcClient (typed callbacks)
       ↓
  EventBus (decoupled pub/sub)
       ↓
  Components (9)
    MessageDisplay, ToolExecution, InputArea, SessionToolbar,
    AcceptanceControls, StatusBar, ActiveFileDisplay, PlanModeControls,
    SlashCommandPanel
       ↓
  DOM

Shared: TypeScript interfaces in src/shared/ defining the RPC contract
  31 message types with TypeScript interfaces (shared/messages.ts)
```

**Sidebar Integration** (v3.0.0):

- **WebviewViewProvider**: Extension now lives in Activity Bar sidebar (not floating panel)
- **Activity Bar Icon**: Click to show/hide chat, drag between left/right sidebars
- **Native Experience**: Proper VS Code sidebar integration with resource management
- **MutableDisposable Pattern**: Fixes memory leak from accumulating event handlers

**Extension Host** provides:

- **Orchestration**: extension.ts coordinates services and routes messages
- **Services**: 7 extracted services with clear boundaries and independent testability
- **Type-Safe RPC**: ExtensionRpcRouter with typed send/receive methods replacing raw postMessage
- **Session Persistence**: Auto-resume, history loading, workspace filtering
- **Planning Mode**: Separate session for planning with limited tools and alternate model

**Webview** provides:

- **Component Architecture**: 9 independent components, each owning its DOM section and lifecycle
- **EventBus**: Decoupled component communication via pub/sub
- **Type-Safe RPC**: WebviewRpcClient with typed callback registration
- **Inline Diffs**: Compact diff display directly in the chat stream
- **Slash Commands**: 41 commands via CommandParser (type `/help` for list)

**Copilot SDK** provides:
- **Agent Runtime**: Production-tested orchestration engine
- **Tool Invocation**: File edits, shell commands, web searches, MCP servers
- **Model Access**: All Copilot CLI models via unified API

## 🌍 Platform Support

- ✅ **Linux** - Fully tested
- ✅ **macOS** - Fully supported
- ✅ **Windows** - Fully supported (PowerShell v6+)

Session state location:
- **Linux/macOS**: `~/.copilot/session-state/`
- **Windows**: `%USERPROFILE%\.copilot\session-state\`

## 📚 Documentation

- **[Development Guide](documentation/HOW-TO-DEV.md)** - Build and test the extension
- **[Changelog](CHANGELOG.md)** - Version history and release notes
- **[GitHub Repository](https://github.com/darthmolen/vscode-extension-copilot-cli)** - Source code
- **[Copilot SDK Docs](https://github.com/github/copilot-sdk)** - Official SDK documentation

## 🤝 Contributing

Contributions welcome! Please see [HOW-TO-DEV.md](documentation/HOW-TO-DEV.md) for development setup.

**Note**: F5 debugging is broken in VS Code 1.100+. We use a VSIX-based development workflow instead.

## 📝 License

MIT - See [LICENSE](LICENSE) for details

## 🐛 Issues & Feedback

- **Report bugs**: https://github.com/darthmolen/vscode-extension-copilot-cli/issues
- **Ask questions**: https://marketplace.visualstudio.com/items?itemName=darthmolen.copilot-cli-extension&ssr=false#qna
- **Marketplace**: https://marketplace.visualstudio.com/items?itemName=darthmolen.copilot-cli-extension

## ⭐ Support

If you find this extension helpful, please:

- ⭐ Star the [GitHub repository](https://github.com/darthmolen/vscode-extension-copilot-cli)
- ✍️ Leave a review on the [marketplace](https://marketplace.visualstudio.com/items?itemName=darthmolen.copilot-cli-extension)
- 🐦 Share with others!

---

Made with ❤️ by [darthmolen](https://github.com/darthmolen)

