# Copilot CLI Chat

Interactive VS Code extension for GitHub Copilot CLI - bringing a smooth, Claude Code-inspired UX to your development workflow. Powered by the **GitHub Copilot SDK 2.0** for a richer, more responsive experience.

[![Version](https://img.shields.io/visual-studio-marketplace/v/darthmolen.copilot-cli-extension)](https://marketplace.visualstudio.com/items?itemName=darthmolen.copilot-cli-extension)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/darthmolen.copilot-cli-extension)](https://marketplace.visualstudio.com/items?itemName=darthmolen.copilot-cli-extension)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/darthmolen.copilot-cli-extension)](https://marketplace.visualstudio.com/items?itemName=darthmolen.copilot-cli-extension)

## ✨ Features

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
- ⚙️ **Complete CLI Configuration** - All Copilot CLI flags configurable via VS Code settings
- 🚀 **YOLO Mode** - Quick development mode with all permissions enabled (default, recommended)
- 🤖 **14 AI Models** - Choose from GPT-5, Claude 4.5 Sonnet/Opus, Gemini 3 Pro, and more
- 🔧 **Granular Permissions** - Control tool access, file paths, and URLs individually
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

