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
- `src/sdkSessionManager.ts` - SDK session management
- `src/modelCapabilitiesService.ts` - Model capabilities and validation
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
src/
├── extension.ts                           # Main entry point (744 lines)
├── logger.ts                              # Structured logging
├── backendState.ts                        # Single source of truth for session state
├── sessionUtils.ts                        # Session file I/O utilities
├── authUtils.ts                           # Authentication helpers
├── chatViewProvider.ts                    # WebviewViewProvider for sidebar
├── sdkSessionManager.ts                   # Copilot SDK session lifecycle
├── shared/
│   ├── index.ts                           # Barrel exports
│   ├── models.ts                          # Domain types (Session, Message, etc.)
│   └── messages.ts                        # RPC message types (31 types, 433 lines)
├── utilities/
│   ├── disposable.ts                      # Disposable pattern helpers
│   └── bufferedEmitter.ts                 # Event buffering for race conditions
└── extension/
    ├── rpc/
    │   ├── index.ts                       # Barrel export
    │   └── ExtensionRpcRouter.ts          # Type-safe RPC (520 lines, 18 send + 11 receive)
    └── services/
        ├── SessionService.ts              # Session CRUD operations
        ├── fileSnapshotService.ts          # File snapshot for diffs
        ├── mcpConfigurationService.ts      # MCP server configuration
        ├── modelCapabilitiesService.ts     # Model feature detection
        ├── planModeToolsService.ts         # Plan mode tool filtering
        ├── messageEnhancementService.ts    # Message enrichment pipeline
        └── InlineDiffService.ts           # LCS-based inline diff (162 lines)

src/webview/
├── main.js                                # App bootstrap (526 lines)
├── styles.css                             # All webview styles
└── app/
    ├── handlers/
    │   ├── ui-handlers.js                 # UI event handlers
    │   ├── acceptance-handlers.js         # Accept/reject plan handlers
    │   ├── message-handlers.js            # Message processing
    │   ├── diff-handler.js                # Diff button click handler
    │   └── tool-group-handler.js          # Tool group expand/collapse
    ├── utils/
    │   └── webview-utils.js               # HTML escaping, formatting
    ├── state/
    │   └── EventBus.js                    # Pub/sub for component communication
    ├── rpc/
    │   └── WebviewRpcClient.js            # Type-safe RPC client (390 lines)
    ├── services/
    │   └── CommandParser.js               # Slash command parsing
    └── components/
        ├── AcceptanceControls/AcceptanceControls.js
        ├── ActiveFileDisplay/ActiveFileDisplay.js
        ├── StatusBar/StatusBar.js
        ├── InputArea/InputArea.js
        ├── SessionToolbar/SessionToolbar.js
        ├── PlanModeControls/PlanModeControls.js
        ├── MessageDisplay/MessageDisplay.js   # Message rendering + auto-scroll (292 lines)
        └── ToolExecution/ToolExecution.js     # Tool cards, inline diffs (344 lines)
```

### Build Commands

```bash
# Type-check + lint + esbuild bundle
npm run compile

# TypeScript compile to out/ (needed for server-side tests)
npm run compile-tests

# TypeScript type checking only
npm run check-types

# ESLint on src/
npm run lint

# Production build (minified esbuild)
npm run package

# Watch mode (esbuild + tsc in parallel)
npm run watch

# Build VSIX, install, ready for reload
./test-extension.sh
```

### Testing

#### Test Directory Structure

```text
tests/
├── unit/                    # Fast, isolated tests (38 files)
│   ├── extension/           # Server-side tests (13 files)
│   │   └── rpc-router, session-service, file-snapshot, plan-mode-tools, inline-diff...
│   ├── components/          # Webview component tests (13 files)
│   │   └── MessageDisplay, ToolExecution, InputArea, EventBus, inline-diff...
│   └── utils/               # Utility tests (12 files)
│       └── webview-utils, command-parser, buffered-emitter, auth-error...
├── integration/             # Cross-component tests (29 files)
│   ├── webview/             # Component integration (24 files)
│   │   └── auto-scroll, diff handling, tool groups, RPC flow...
│   ├── plan-mode/           # Plan mode workflows (3 files)
│   ├── session/             # Session lifecycle (1 file)
│   └── sidebar/             # Sidebar integration (1 file)
├── e2e/                     # End-to-end tests (9 files)
│   ├── plan-mode/           # Full plan mode flows (4 files)
│   └── session/             # Full session lifecycle (5 files)
└── helpers/                 # Test utilities (7 files)
    ├── jsdom-setup.js       # JSDOM + mock RPC creation
    ├── jsdom-component-setup.js  # Full component test environment
    ├── vscode-mock.js       # VS Code API mock
    ├── scenarios.js         # Common test scenarios
    └── ...
```

#### Test Runners

- `npm test` -- Runs unit + integration tests via Mocha (main CI target, ~710 tests)
- `npm run test:unit` -- Unit tests only (`tests/unit/**/*.test.js`)
- `npm run test:integration` -- Integration tests only (`tests/integration/**/*.test.js`)
- `npm run test:e2e:plan-mode` -- E2E plan mode tests (requires compiled output)
- `npm run test:e2e:session` -- E2E session lifecycle tests (requires compiled output)
- `npm run test:verify` -- Verify test setup (checks helpers load correctly)

#### Test Utilities

**`tests/helpers/jsdom-setup.js`**:

- `createTestDOM(html)` -- Spins up a JSDOM instance, sets `global.window` and `global.document`
- `cleanupTestDOM(dom)` -- Tears down globals, closes JSDOM window
- `createMockRpc()` -- Mock RPC client with call tracking (records method calls and arguments)

**`tests/helpers/jsdom-component-setup.js`**:

- `createComponentDOM()` -- Full page structure with all component mount points (messages container, input area, session toolbar, etc.)
- `cleanupComponentDOM(dom)` -- Full cleanup including global polyfills
- `setScrollProperties(element, props)` -- Simulates scroll geometry (JSDOM doesn't compute layout)
- Mock `ResizeObserver` and `MutationObserver` with manual trigger support
- Polyfills for `requestAnimationFrame` and `marked.js`

**`tests/helpers/vscode-mock.js`**:

- Full VS Code API mock: `workspace`, `EventEmitter`, `Uri`, `window`, `commands`
- Configuration defaults matching `copilotCLI` settings
- Output channel mock, webview provider registration

#### Key Testing Patterns

- Server-side tests (`tests/unit/extension/`) require compiled TypeScript (`npm run compile-tests` first, outputs to `out/`)
- Webview tests use JSDOM to simulate browser environment
- Components are tested by importing directly and rendering into mock DOM
- Tests skip gracefully if module not found (supports TDD red phase)

### Testing Different Scenarios

#### Test MCP Server Integration

The extension supports MCP (Model Context Protocol) servers. To test with the included hello-mcp server:

1. **Configure MCP Server in VS Code Settings**:
   - Open Settings: `Ctrl+,` → Search "MCP Servers"
   - Or edit `.vscode/settings.json`:

   ```json
   {
     "copilotCLI.mcpServers": {
       "hello-mcp": {
         "type": "local",
         "command": "node",
         "args": ["${workspaceFolder}/tests/mcp-server/hello-mcp/index.js"],
         "enabled": true
       }
     }
   }
   ```

2. **Start New Session**:
   - MCP servers are initialized when session starts
   - Click the `+` button to create a new session
   - Check Output Channel for "MCP Servers configured: hello-mcp"

3. **Test MCP Tools**:
   - Ask: "Use the hello-mcp-get_test_data tool"
   - Verify tool executes and returns test data
   - Check logs for MCP tool execution events

4. **Run MCP Integration Test**:
   ```bash
   npm run test:mcp
   ```

**Note**: The GitHub MCP server is built-in to Copilot CLI and doesn't need configuration.

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

### v2.0 SDK Architecture

**v2.0 uses the official @github/copilot-sdk** instead of spawning CLI processes:

1. **SDK Session Manager** (`src/sdkSessionManager.ts`)
   - Creates/resumes sessions via SDK API
   - Handles event streaming (tool execution, assistant messages, reasoning)
   - Manages MCP server configuration passthrough

2. **Event-Driven Communication**
   - Session emits events: `tool.execution_start`, `assistant.message`, `session.idle`
   - Extension listens and updates UI in real-time
   - No parsing of CLI output needed

3. **MCP Server Support**
   - Reads `copilotCLI.mcpServers` from VS Code settings
   - Passes configuration directly to SDK
   - Supports local (stdio) and HTTP/SSE server types
   - Built-in GitHub MCP server (no config needed)

### v1.0 CLI Integration Pattern (Deprecated)

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
