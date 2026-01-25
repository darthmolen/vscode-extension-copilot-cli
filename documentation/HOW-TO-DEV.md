# Development Guide

## 🚨 Important: F5 Debugging is Broken

**VS Code 1.100+ with Node.js 20+ has a critical bug** that prevents extension debugging from working:

- **Error**: `PendingMigrationError` in Remote-WSL extension
- **Impact**: Cannot use F5 / Extension Development Host
- **Cause**: Microsoft's Remote-WSL extension uses `navigator` as a variable name (now a reserved global)
- **Status**: No ETA on fix from Microsoft

## Development Workflow: VSIX-Based Testing

Since F5 debugging doesn't work, we use a VSIX-based workflow instead.

### Prerequisites

- VS Code 1.108.1 or higher
- Node.js 20+
- npm

### Setup

```bash
# Clone repository
git clone https://github.com/darthmolen/vscode-extension-copilot-cli.git
cd vscode-extension-copilot-cli

# Install dependencies
npm install

# Install vsce for packaging
npm install --save-dev @vscode/vsce
```

### Development Cycle

#### 1. Make Code Changes

Edit files in `src/`:
- `src/extension.ts` - Main extension entry point
- `src/chatViewProvider.ts` - Webview chat panel
- `src/cliProcessManager.ts` - CLI process management
- `src/logger.ts` - Logging to Output Channel

#### 2. Build and Install

Use the provided script to build, package, and install:

```bash
./test-extension.sh
```

This script:
1. Compiles TypeScript (`npm run compile`)
2. Packages VSIX with vsce
3. Uninstalls old version
4. Installs new version
5. Outputs installation instructions

#### 3. Reload VS Code

After installation:
1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
2. Run `Developer: Reload Window`
3. Your changes are now active!

#### 4. Test Your Changes

1. Open Output panel: `Ctrl+Shift+U`
2. Select "Copilot CLI" from dropdown
3. Watch logs in real-time
4. Test your features

#### 5. Debug with Logging

Since we can't use the debugger, use comprehensive logging:

```typescript
import { Logger } from './logger';

const logger = Logger.getInstance();

// Four log levels available
logger.debug('Detailed info for debugging');
logger.info('General information');
logger.warn('Warning messages');
logger.error('Error details', error);
```

All logs appear in the "Copilot CLI" Output Channel.

### Quick Iteration Tips

1. **Keep VS Code open** - Just reload window after each build
2. **Watch the logs** - Output Channel shows all activity
3. **Test incrementally** - Make small changes and test frequently
4. **Use the script** - `./test-extension.sh` automates everything

### Package Structure

```
vscode-extension-copilot-cli/
├── src/                    # TypeScript source
│   ├── extension.ts        # Main entry point
│   ├── chatViewProvider.ts # Chat UI
│   ├── cliProcessManager.ts# CLI integration
│   └── logger.ts           # Logging utility
├── dist/                   # Compiled JavaScript
├── images/                 # Extension icon
├── documentation/          # Developer docs
├── test-extension.sh       # Build/install script
├── package.json            # Extension manifest
├── tsconfig.json           # TypeScript config
└── esbuild.js              # Build configuration
```

### Build Commands

```bash
# Compile TypeScript
npm run compile

# Watch mode (auto-compile on save)
npm run watch

# Type checking only
npm run check-types

# Lint code
npm run lint

# Production build (minified)
npm run package

# Package VSIX manually
npx vsce package
```

### Testing Different Scenarios

#### Test New Session
1. Open chat panel: `Ctrl+Shift+P` → `Copilot CLI: Open Chat`
2. Click the `+` button in header
3. Verify new session starts

#### Test Session Switching
1. Open chat panel
2. Use session dropdown
3. Verify history loads correctly

#### Test Configuration
1. Open Settings: `Ctrl+,`
2. Search "Copilot CLI"
3. Change settings (e.g., toggle YOLO mode)
4. Test behavior changes

### Common Issues

**Issue: Extension not updating**
- Solution: Ensure old version is uninstalled before installing new one
- The script handles this automatically

**Issue: Commands not found**
- Solution: Check package.json `contributes.commands` matches command IDs in code

**Issue: Webview not loading**
- Solution: Check Output Channel for CSP violations or JavaScript errors

**Issue: Session not resuming**
- Solution: Verify `~/.copilot/session-state/` exists and has session folders

### Publishing Updates

When ready to publish a new version:

```bash
# 1. Update version in package.json
npm version patch  # or minor, or major

# 2. Update CHANGELOG.md with changes

# 3. Commit changes
git add -A
git commit -m "v1.0.X: Description"
git push

# 4. Publish to marketplace
npx vsce publish

# Or publish specific version
npx vsce publish 1.0.1
```

### Environment Variables

If you have a `.env` file (for tokens, etc.), it's automatically excluded:
- Listed in `.gitignore`
- Listed in `.vscodeignore`

## Architecture Notes

### CLI Integration Pattern

We use **`--prompt` mode** with **session resumption**:

1. Spawn CLI per message: `copilot --prompt "user message"`
2. Resume session: `copilot --resume <sessionId> --prompt "next message"`
3. Track session via `~/.copilot/session-state/<uuid>/`
4. Load history from `events.jsonl`

**Why not interactive PTY?**
- PTY gives raw terminal output (ANSI codes, box drawing, prompts)
- `--prompt` mode gives clean text responses
- Trade-off: No real-time tool execution visibility

### Session Management

Sessions are managed by Copilot CLI:
- Directory: `~/.copilot/session-state/<uuid>/`
- Files: `events.jsonl`, `plan.md`, `workspace.yaml`
- Extension loads conversation from `events.jsonl`
- Session dropdown shows all available sessions

### Webview Communication

```
User Input → Webview → Extension → CLI Process
                ↓           ↓           ↓
           postMessage  spawn CLI   stdout
                ↓           ↓           ↓
           Markdown ← Extension ← CLI Output
```

Messages use VS Code's webview messaging API with types:
- `sendMessage` - User sends message
- `userMessage` - Display user message
- `assistantMessage` - Display AI response
- `updateSessions` - Update session dropdown
- `clearMessages` - Clear chat history

## Contributing

We welcome contributions! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes using the VSIX workflow
4. Test thoroughly
5. Submit a pull request

## Support

- **Issues**: https://github.com/darthmolen/vscode-extension-copilot-cli/issues
- **Discussions**: https://github.com/darthmolen/vscode-extension-copilot-cli/discussions

## Resources

- [VS Code Extension API](https://code.visualstudio.com/api)
- [Copilot CLI Documentation](https://docs.github.com/copilot/concepts/agents/about-copilot-cli)
- [vsce Publishing Tool](https://github.com/microsoft/vscode-vsce)
