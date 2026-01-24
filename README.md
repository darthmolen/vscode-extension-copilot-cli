# Copilot CLI Extension

Interactive VS Code extension for GitHub Copilot CLI - bringing a smooth, Claude Code-inspired UX to your development workflow.

## Features

- 🚀 **Seamless CLI Integration** - Start and stop Copilot CLI sessions directly from VS Code
- ⚙️ **Configurable Permissions** - Control tool and URL access with granular settings
- 🔄 **Auto-apply Changes** - View diffs for awareness, no approval prompts to interrupt flow
- 💬 **Chat Interface** - Coming soon: Interactive chat panel with history

## Quick Start

### Prerequisites

- VS Code 1.108.1 or higher
- GitHub CLI (`gh`) installed and authenticated
- GitHub Copilot CLI extension installed (`gh extension install github/gh-copilot`)

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

Configure the extension in VS Code settings:

```json
{
  "copilotCLI.cliPath": "gh",  // Path to gh executable
  "copilotCLI.allowAllTools": false,  // Allow all tools
  "copilotCLI.allowAllUrls": false,   // Allow all URLs
  "copilotCLI.yolo": false,           // YOLO mode (max permissions)
  "copilotCLI.allowedTools": [],      // Specific allowed tools
  "copilotCLI.allowedUrls": []        // Specific allowed URLs
}
```

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
