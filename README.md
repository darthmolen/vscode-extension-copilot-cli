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
- **Mermaid Diagrams** — Mermaid code blocks render as interactive diagrams with a toolbar to view source or save as SVG/`.mmd`.
- **Image Attachments** — Send screenshots and diagrams to vision-capable models with preview thumbnails.
- **Active File Context** — The agent always knows which file you're working on, even when chat has focus.
- **@file References** — Reference files directly in your messages.
- **Mid-Session Model Switching** — Switch AI models mid-conversation without losing context. Models are grouped by cost tier (Fast/Standard/Premium) with multiplier badges showing request cost. The session resumes with the new model, preserving all messages and tool state.
- **17 AI Models** — GPT-5, Claude Sonnet 4.6/4.5, Claude Opus 4.6, Gemini 3 Pro, and more.
- **MCP Server Integration** — GitHub MCP built-in by default, add custom servers for filesystem, memory, fetch, and more.

### ⚡ Developer Control

- **YOLO Mode** — All permissions enabled for fast iteration (default, recommended).
- **Granular Permissions** — Or lock it down: control tool access, file paths, and URLs individually.
- **Enterprise SSO** — First-class GitHub Enterprise support for sso authentication.
- **Cross-Platform** — Linux, macOS, and Windows (PowerShell v6+).

### v3.3.0 - Mid-Session Model Switching

- **Model switching without losing context** — New ModelSelector dropdown in the controls bar lets you switch AI models mid-conversation. The SDK resumes the session with the new model, preserving all previous messages and tool state.
- **Tier-grouped model selector** — Models grouped by cost tier (Fast/Standard/Premium) with multiplier badges (0.5x, 1x, 3x) showing request cost.
- **Responsive header** — Session toolbar adapts to narrow sidebars; label wraps above the dropdown instead of truncating.
- **SDK 0.1.26 reliability** — Permission handler, client name header, fixed `--yolo` flag logic, and accurate compaction metrics.

### v3.0.1

- **SDK Upgrade to 0.1.22** — Enables first-class hooks system for reliable tool interception
- **File Diff Fix** — View Diff now correctly shows original file content via `onPreToolUse` hook (fixes race condition where snapshots captured empty/modified files)
- **Plan Mode Diff for update_work_plan** — Custom plan-mode tool now emits file diffs when writing plan.md (captures pre-write snapshot and shows Before ↔ After)

### v3.0.0 - Complete Architectural Overhaul 🚀

#### Inline Diffs in Chat Stream

- File edits show compact inline diffs directly in chat (up to 10 lines with +/- prefixes)
- Larger diffs show "... N more lines" with "View Diff" button for full picture
- Review, approve, or redirect the agent without leaving the conversation
- Decision-making stays in the chat flow

#### Slash Commands (41 Commands) with Discovery Panel

- Type `/` in the chat input to see a grouped command reference panel
- Click any command to insert it, or use the `?` icon next to metrics for full `/help` output
- `/help` — Show all available commands
- `/usage` — View session metrics (tokens, context window)
- `/review` — Show current plan
- `/diff file1 file2` — Compare two files
- `/mcp` — Show MCP server configuration
- And 36 more commands for debugging, inspection, and control

#### Auto-Resume After Reload

- CLI session automatically resumes when VS Code reloads
- Previous conversation history loads from Copilot CLI's event log
- No more lost sessions when restarting VS Code

#### Claude Opus 4.6 Support

- Added latest `claude-opus-4.6` and `claude-opus-4.6-fast` models
- Smart model capability detection for image attachments
- Now supporting 17 AI models total

#### Reliability & Performance

- Component-based architecture (9 components) for maintainability
- Type-safe RPC layer (31 message types) eliminates message bugs
- Service extraction (7 services) with clear boundaries
- 710+ tests ensure quality (unit, integration, e2e)
- Memory leak fixed — runs indefinitely without crashes

### 🧠 Copilot Memory

Copilot learns about your codebase across sessions — coding agent, code review, and CLI all contribute to a shared memory. Memories auto-expire after 28 days and are validated against current code before use.

**Status:** Public preview (Copilot Pro, Pro+, Business, Enterprise)

**How to enable:**

1. Enterprise admins enable at the enterprise level
2. Org owners enable for their organization
3. Individual users enable in their Copilot settings

**Managing memories:** Repository owners can view memories chronologically, delete individual entries, or batch-delete.

See: [Copilot Memory documentation](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/copilot-memory)

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
  - See: [Copilot CLI docs](https://docs.github.com/copilot/concepts/agents/about-copilot-cli)
- **Active Copilot subscription**

⚠️ **Important**: This extension requires the **new standalone Copilot CLI**, NOT the deprecated `gh copilot` extension.

### Troubleshooting: Session Won't Start

If the extension hangs on "Starting CLI process..." or times out with "Connection is closed", your Copilot CLI binary is likely too old. The extension requires **v0.0.403 or newer**.

Check your version:

```bash
copilot --version --no-auto-update
```

To upgrade:

```bash
# Update the npm package
npm install -g @github/copilot@latest

# Then let the CLI self-update its runtime
copilot upgrade
```

After upgrading, reload VS Code (`Ctrl+Shift+P` → "Developer: Reload Window").

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
   - Go to: [GitHub token settings](https://github.com/settings/tokens?type=beta)
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

#### Option 1: Activity Bar Icon (NEW in v3.0.0)

1. Look for the Copilot CLI icon in the Activity Bar (left side by default)
2. Click the icon to show/hide the chat sidebar
3. **Drag to right sidebar**: View → Appearance → Move Side Bar Right (or drag the icon)

#### Option 2: Command Palette

1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
2. Type "Copilot CLI: Open Chat"
3. Press Enter

#### Option 3: Status Bar

- Click the "💬 Copilot CLI" item in the status bar

#### Option 4: Editor Toolbar

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

Choose from 17 AI models in settings:

- Claude Sonnet 4.6, Claude Sonnet 4.5 (default), Claude Sonnet 4, Claude Haiku 4.5, Claude Opus 4.5
- Claude Opus 4.6, Claude Opus 4.6 Fast
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

```text
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

- **Report bugs**: [GitHub Issues](https://github.com/darthmolen/vscode-extension-copilot-cli/issues)
- **Ask questions**: [Marketplace Q&A](https://marketplace.visualstudio.com/items?itemName=darthmolen.copilot-cli-extension&ssr=false#qna)
- **Marketplace**: [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=darthmolen.copilot-cli-extension)

## ⭐ Support

If you find this extension helpful, please:

- ⭐ Star the [GitHub repository](https://github.com/darthmolen/vscode-extension-copilot-cli)
- ✍️ Leave a review on the [marketplace](https://marketplace.visualstudio.com/items?itemName=darthmolen.copilot-cli-extension)
- 🐦 Share with others!

---

Made with ❤️ by [darthmolen](https://github.com/darthmolen)
