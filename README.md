# Copilot CLI Chat

Interactive VS Code extension for GitHub Copilot CLI - bringing a smooth, Claude Code-inspired UX to your development workflow.

## ✨ Features

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

## Quick Start

### Prerequisites

- VS Code 1.108.1 or higher
- **New Copilot CLI** installed (standalone `copilot` command)
  - **Linux/macOS**: `brew install copilot-cli`
  - **Windows**: `winget install GitHub.Copilot`
  - See: https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli
  - Note: This is NOT the old `gh extension install github/gh-copilot` (deprecated)

### Supported Platforms

- ✅ **Linux** (tested)
- ✅ **macOS** (should work, uses homebrew)
- ✅ **Windows** (should work, requires PowerShell v6+)

**Note**: Extension uses cross-platform Node.js APIs (`os.homedir()`, `path.join()`) so session state location works on all platforms:
- Linux: `~/.copilot/session-state/`
- macOS: `~/.copilot/session-state/`
- Windows: `%USERPROFILE%\.copilot\session-state\`

### Installation

1. Clone this repository
2. Run `npm install`
3. Press F5 to open Extension Development Host

### Usage

**Start a Chat Session:**
- Open Command Palette (Ctrl+Shift+P / Cmd+Shift+P)
- Run `Copilot CLI: Start Chat Session`

**Stop a Chat Session:**
- Open Command Palette
- Run `Copilot CLI: Stop Chat Session`

## Configuration

Configure the extension in VS Code settings (all Copilot CLI flags supported):

```json
{
  "copilotCLI.cliPath": "copilot",        // Path to copilot executable
  "copilotCLI.yolo": false,               // YOLO mode (all permissions)
  "copilotCLI.allowAllTools": false,      // Auto-approve all tools
  "copilotCLI.allowAllPaths": false,      // Allow access to any path
  "copilotCLI.allowAllUrls": false,       // Allow all URLs
  "copilotCLI.allowTools": [],            // Specific tools: ["shell(git)", "write"]
  "copilotCLI.denyTools": [],             // Block tools: ["shell(rm)"]
  "copilotCLI.allowUrls": [],             // Specific URLs/domains
  "copilotCLI.denyUrls": [],              // Block URLs/domains
  "copilotCLI.addDirs": [],               // Additional allowed directories
  "copilotCLI.agent": "",                 // Custom agent name
  "copilotCLI.model": "",                 // AI model (empty = default)
  "copilotCLI.noAskUser": false           // Autonomous mode (no questions)
}
```

### Tool Specification Format
- Shell commands: `"shell(COMMAND)"` - e.g., `"shell(git)"`, `"shell(git push)"`
- File writes: `"write"`
- MCP servers: `"MCP_SERVER_NAME(tool_name)"`

### Model Options
Choose from 14 models: Claude Sonnet 4.5 (default), Claude Haiku/Opus 4.5, GPT-5 variants, Gemini 3 Pro Preview

## Roadmap

- [x] Phase 1: Project setup and structure
- [x] Phase 2: CLI process management
- [🚧] Phase 3: Interactive webview chat panel (in-progress)
- [ ] Phase 4: Non-blocking file diff visualization
- [ ] Phase 5: Session history and persistence
- [ ] Phase 6: Enhanced features (inline context, file tree integration)
- [ ] Phase 7: UX polish and theme integration
- [ ] Phase 8: Testing and documentation

## Development

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode
npm run watch

# Run tests
npm test

# Package extension
npm run package
```

## Architecture

- **CLIProcessManager**: Manages Copilot CLI process lifecycle
- **Message Protocol**: Event-based communication between CLI and extension
- **Configuration**: VS Code settings for CLI flags and permissions

## Contributing

This is an experimental project. Feedback and contributions welcome!

## License

MIT
