# Copilot CLI Extension

Interactive VS Code extension for GitHub Copilot CLI - bringing a smooth, Claude Code-inspired UX to your development workflow.

## Features

- 🚀 **Seamless CLI Integration** - Start and stop Copilot CLI sessions directly from VS Code
- ⚙️ **Full Flag Support** - All Copilot CLI flags configurable via VS Code settings
- 🔧 **Tool Control** - Granular allow/deny for specific tools, URLs, and directories
- 🤖 **Model Selection** - Choose from 14 AI models including GPT-5, Claude 4.5, and Gemini
- 🔄 **Auto-apply Changes** - View diffs for awareness, no approval prompts to interrupt flow (coming soon)
- 💬 **Chat Interface** - Coming soon: Interactive chat panel with history

## Quick Start

### Prerequisites

- VS Code 1.108.1 or higher
- **New Copilot CLI** installed (standalone `copilot` command)
  - Install from: https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli
  - Note: This is NOT the old `gh extension install github/gh-copilot` (deprecated)

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
- [ ] Phase 3: Interactive webview chat panel
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
