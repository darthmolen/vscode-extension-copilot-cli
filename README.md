# Copilot CLI Chat

Interactive VS Code extension for GitHub Copilot CLI - bringing a smooth, Claude Code-inspired UX to your development workflow. Powered by the **GitHub Copilot SDK 2.0** for a richer, more responsive experience.

[![Version](https://img.shields.io/visual-studio-marketplace/v/darthmolen.copilot-cli-extension)](https://marketplace.visualstudio.com/items?itemName=darthmolen.copilot-cli-extension)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/darthmolen.copilot-cli-extension)](https://marketplace.visualstudio.com/items?itemName=darthmolen.copilot-cli-extension)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/darthmolen.copilot-cli-extension)](https://marketplace.visualstudio.com/items?itemName=darthmolen.copilot-cli-extension)

## ✨ Features

### v2.2.2 - Bug Fixes & Polish 🐛

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

### Open the Chat Panel

**Option 1: Command Palette**

1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
2. Type "Copilot CLI: Open Chat"
3. Press Enter

**Option 2: Status Bar**

- Click the "💬 Copilot CLI" item in the status bar

**Option 3: Editor Toolbar**

- Click the chat icon in the editor toolbar

### Start Chatting

1. The chat panel opens on the right side (dockable anywhere)
2. Your last session automatically resumes (if enabled)
3. Type your message and press Enter or click Send
4. View AI responses with full markdown formatting

### Manage Sessions

- **Session Dropdown**: Select from previous conversations
- **New Session** (+): Start a fresh conversation
- **Auto-resume**: Toggle in settings to auto-load last session

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

Choose from 14 AI models in settings:

- Claude Sonnet 4.5 (default), Claude Haiku 4.5, Claude Opus 4.5
- GPT-5, GPT-5.1, GPT-5.2, GPT-5 mini, GPT-4.1
- GPT Codex variants (5.1, 5.2, mini)
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

### v2.0 SDK Architecture

```
VS Code Extension (UI Layer)
       ↓
@github/copilot-sdk (v0.1.18)
       ↓ JSON-RPC
Copilot CLI (server mode)
```

The extension provides:

- **UI/UX Layer**: Chat panel, markdown rendering, session selector
- **Configuration Bridge**: VS Code settings → SDK/CLI options
- **Event Handling**: Real-time streaming, reasoning display, inline tool execution visibility
- **Session Persistence**: Auto-resume, history loading, workspace filtering
- **Planning Mode**: Separate session for planning with limited tools and alternate model. Plan juggling back to main session.

The SDK provides:
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

