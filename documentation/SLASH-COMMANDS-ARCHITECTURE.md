# Slash Commands Architecture

**Version**: 3.0.0  
**Last Updated**: 2026-02-14

## Overview

The vscode-copilot-cli-extension implements comprehensive slash command support, allowing users to execute 41 different commands directly in the chat interface. Commands are categorized into three types based on how they're executed:

1. **Extension Commands** (10) - Execute within the VS Code extension/webview
2. **CLI Passthrough** (6) - Open the integrated terminal with the Copilot CLI
3. **Not Supported** (25) - Show friendly messages explaining why they're unavailable

This architecture provides a seamless user experience while maintaining clear boundaries between what the extension handles natively and what requires the CLI terminal.

## Architecture Components

### 1. Command Registry (Frontend)

**Location**: `src/webview/app/services/CommandParser.js`

The `CommandParser` class maintains a centralized registry of all 41 slash commands with metadata:

```javascript
this.commands = new Map([
    ['plan', {
        type: 'extension',
        event: 'enterPlanMode',
        requiredContext: { planMode: false },
        category: 'plan',
        description: 'Enter plan mode'
    }],
    ['delegate', {
        type: 'passthrough',
        instruction: 'The /delegate command opens GitHub Copilot coding agent...',
        category: 'cli',
        description: 'GitHub Copilot coding agent'
    }],
    ['clear', {
        type: 'not-supported'
    }]
]);
```

**Command Metadata Structure**:
- `type`: `'extension'` | `'passthrough'` | `'not-supported'`
- `event`: (extension only) RPC event name to trigger
- `instruction`: (passthrough only) Message to show before opening terminal
- `requiredContext`: (optional) Conditions required to execute command
- `category`: (extension/passthrough only) Display category: `'plan'` | `'code'` | `'config'` | `'cli'`
- `description`: (extension/passthrough only) Short human-readable description for discoverability UI

**Key Methods**:

- `parse(text)` - Parses input text into `{ command, args }` or null
- `isValid(cmd, context)` - Validates command against current context (plan mode, etc.)
- `execute(cmd, eventBus)` - Executes command via EventBus events
- `getCommandType(commandName)` - Returns command type or null
- `isExtensionCommand(commandName)` - Boolean check for extension commands
- `isPassthroughCommand(commandName)` - Boolean check for passthrough commands
- `isNotSupportedCommand(commandName)` - Boolean check for unsupported commands
- `getInstruction(commandName)` - Returns instruction text for passthrough commands
- `getVisibleCommands()` - Returns array of `{ name, description, category }` for extension + passthrough commands only (16 commands)

### 2. Command Routing (Frontend)

**Location**: `src/webview/app/components/InputArea/InputArea.js`

The `InputArea` component detects slash commands via `CommandParser` and routes them:

```javascript
sendMessage() {
    const text = this.messageInput.value.trim();
    if (!text) return;

    // Check for slash command first
    const cmd = this.commandParser.parse(text);
    if (cmd) {
        // Validate command in current context (plan mode, etc.)
        const context = { planMode: this.planMode, planReady: this.planReady };
        if (!this.commandParser.isValid(cmd, context)) return;

        // Execute command — emits appropriate EventBus events
        this.commandParser.execute(cmd, this.eventBus);
        this.messageInput.value = '';
        return;
    }

    // Regular message — needs active session
    if (!this.sessionActive) return;
    this.eventBus.emit('input:sendMessage', { text, attachments: [...] });
}
```

### 3. Backend Handlers (TypeScript)

Commands are organized into functional categories based on what they do:

#### CodeReviewSlashHandlers
**Location**: `src/extension/services/slashCommands/CodeReviewSlashHandlers.ts`

Handles file and plan operations:
- `handleReview(sessionId)` - Reads `plan.md` and displays content
- `handleDiff(file1, file2)` - Opens VS Code diff viewer

#### InfoSlashHandlers
**Location**: `src/extension/services/slashCommands/InfoSlashHandlers.ts`

Handles information retrieval:
- `handleMcp()` - Displays MCP server configuration
- `handleUsage(sessionId)` - Shows session metrics (tokens, duration)
- `handleHelp(command?)` - Provides command reference

#### CLIPassthroughService
**Location**: `src/extension/services/CLIPassthroughService.ts`

Manages terminal integration:
- `openCLI(sessionId, command, instruction)` - Creates terminal, displays instruction, runs `copilot --resume <sessionId>`

### 4. RPC Communication

**Location**: `src/extension/rpc/ExtensionRpcRouter.ts`

Bridges webview and extension with message handlers:

```typescript
private registerSlashCommandHandlers() {
    this.router.register('showPlanContent', async (args) => {
        return this.codeReviewHandlers.handleReview(args.sessionId);
    });
    
    this.router.register('openDiffView', async (args) => {
        return this.codeReviewHandlers.handleDiff(args.file1, args.file2);
    });
    
    this.router.register('showMcpConfig', async () => {
        return this.infoHandlers.handleMcp();
    });
    
    this.router.register('showUsageMetrics', async (args) => {
        return this.infoHandlers.handleUsage(args.sessionId);
    });
    
    this.router.register('showHelp', async (args) => {
        return this.infoHandlers.handleHelp(args.command);
    });
    
    this.router.register('openInCLI', async (args) => {
        return this.passthroughService.openCLI(
            args.sessionId,
            args.command,
            args.instruction
        );
    });
}
```

### 5. UI Feedback

**Location**: `src/webview/app/components/MessageDisplay/MessageDisplay.js`

Renders command results in the message area:
- Info banners for plan content, MCP config, usage metrics
- Help text formatting (command list, specific command help)
- Not-supported messages with explanations

### 6. Command Discoverability UI

Two complementary mechanisms help users discover available slash commands:

#### SlashCommandPanel (/ trigger)

**Location**: `src/webview/app/components/SlashCommandPanel/SlashCommandPanel.js`

A grouped command reference panel that appears above the textarea when the user types `/` as the first character:

```text
┌─────────────────────────────────────┐
│ Plan Mode                           │
│   /plan     Enter plan mode         │
│   /exit     Exit plan mode          │
│   /accept   Accept the plan         │
│   /reject   Reject the plan         │
│                                     │
│ Code & Review                       │
│   /review   View plan content       │
│   /diff     Compare two files       │
│                                     │
│ Configuration                       │
│   /mcp      MCP server config       │
│   /usage    Usage metrics           │
│   /help     Command reference       │
│   /model    Switch model            │
│                                     │
│ CLI (opens terminal)                │
│   /delegate GitHub Copilot agent    │
│   /agent    Specialized agents      │
│   ...                               │
└─────────────────────────────────────┘
```

**Behavior**:

- Shows when textarea value starts with `/` and contains no space (typing a partial command)
- Clicking a command inserts the command text into the textarea (does not execute)
- Dismissed on: Escape key, backspace removing `/`, selecting a command, or typing a space
- Only shows the 16 actionable commands (extension + passthrough), not the 25 not-supported commands
- Commands grouped by category: Plan Mode, Code & Review, Configuration, CLI (terminal)

**API**:
- `constructor(container)` — renders hidden panel
- `show(commands)` — renders grouped commands, makes visible
- `hide()` — hides panel
- `onSelect` — callback property, called with command name on click

#### StatusBar Help Icon (?)

**Location**: `src/webview/app/components/StatusBar/StatusBar.js`

A `?` icon button to the left of the usage metrics in the StatusBar. Clicking it triggers the `/help` command, which outputs the full formatted command reference to the chat area.

```text
controls-left layout:
  Row 1: [📄 filename        ]   ← ActiveFileDisplay
  Row 2: [? | Window | Used | Remaining]   ← StatusBar
```

**Wiring**: StatusBar emits `showHelp` → InputArea forwards to EventBus → main.js handles via existing `/help` infrastructure.

## Command Reference

### Extension Commands (10)

These execute within the VS Code extension and provide rich UI experiences:

| Command | Description | Handler | Notes |
|---------|-------------|---------|-------|
| `/plan` | Enter plan mode | `enterPlanMode` | Existing feature |
| `/exit` | Exit plan mode | `exitPlanMode` | Existing feature |
| `/accept` | Accept current plan | `acceptPlan` | Requires plan ready |
| `/reject` | Reject current plan | `rejectPlan` | Requires plan ready |
| `/review` | Show plan.md content | `CodeReviewSlashHandlers.handleReview()` | Displays in message area |
| `/diff <file1> <file2>` | Open diff viewer | `CodeReviewSlashHandlers.handleDiff()` | Uses VS Code diff API |
| `/mcp` | Show MCP configuration | `InfoSlashHandlers.handleMcp()` | Displays server config |
| `/usage` | Show session metrics | `InfoSlashHandlers.handleUsage()` | Tokens, duration, quota |
| `/help [command]` | Show command help | `InfoSlashHandlers.handleHelp()` | List or specific command |
| `/model` | Change AI model | `showModelSelector` | **Future**: Dropdown UI |

**Implementation Status**:

- ✅ `/plan`, `/exit`, `/accept`, `/reject` - Implemented in v2.0
- ✅ Command registry with description/category metadata - Implemented in v3.0
- ✅ Backend handlers (CodeReview, Info, CLIPassthrough) - Implemented in v3.0
- ✅ Discoverability UI (SlashCommandPanel + help icon) - Implemented in v3.0
- 📋 `/model` dropdown - Backlog (future release)
- 📋 Intellisense/autocomplete - Backlog (see ROADMAP.md)

### CLI Passthrough Commands (6)

These open the VS Code integrated terminal with instructions and run the Copilot CLI:

| Command | Description | Instruction |
|---------|-------------|-------------|
| `/delegate` | Open coding agent in new PR | "The /delegate command opens GitHub Copilot coding agent in a new PR. Opening terminal..." |
| `/agent` | Select specialized agents | "The /agent command lets you select specialized agents (refactoring, code-review, etc.). Opening terminal..." |
| `/skills` | Manage custom scripts | "The /skills command manages custom scripts and resources. Opening terminal..." |
| `/plugin` | Install CLI extensions | "The /plugin command installs extensions from the marketplace. Opening terminal..." |
| `/login` | Authenticate with GitHub | "Opening terminal to authenticate with GitHub Copilot..." |
| `/logout` | Log out of GitHub | "Opening terminal to log out of GitHub Copilot..." |

**Terminal Command Pattern**:
```bash
copilot --resume <sessionId> /command [args]
```

**Special Case - `/login`**:
- Checks extension configuration for enterprise SSO slug
- If configured, appends enterprise URL parameter
- Supports seamless enterprise authentication flow

### Not Supported Commands (25)

These commands are CLI-specific and don't apply to the extension context. When used, a friendly message explains why:

#### Session Management (5)
- `/clear` - Extension has its own session UI
- `/new` - Use "New Session" button
- `/resume` - Use "Resume Session" dropdown
- `/rename` - Use session management UI
- `/session` - Use session management UI

**Message**: "Session management commands are not supported in the extension. Use the session management UI in the sidebar."

#### Context & Files (7)
- `/add-dir` - VS Code workspace handles this
- `/list-dirs` - VS Code file explorer
- `/cwd` - VS Code shows current directory
- `/cd` - Use VS Code file explorer
- `/context` - Extension manages context automatically
- `/compact` - Extension uses infinite sessions
- `/lsp` - VS Code provides language servers

**Message**: "File and context commands are not supported. VS Code manages your workspace, files, and language features automatically."

#### Permissions (3)
- `/allow-all` - Extension uses VS Code's permission model
- `/yolo` - Same as allow-all
- `/reset-allowed-tools` - Extension handles permissions

**Message**: "Permission commands are not supported. The extension uses VS Code's permission system."

#### User Management (1)
- `/user` - VS Code handles authentication

**Message**: "User management is handled by VS Code. Use 'GitHub Copilot' in the VS Code Accounts menu."

#### Utility (5)
- `/feedback` - Use VS Code's feedback system
- `/share` - Use VS Code's sharing features
- `/experimental` - Extension has its own feature flags
- `/ide` - Already in VS Code!
- `/quit` - Close the panel

**Message**: "This utility command is CLI-specific and doesn't apply to the extension."

#### Configuration (4)
- `/theme` - Use VS Code themes
- `/terminal-setup` - VS Code manages terminal
- `/init` - Extension auto-configures

**Message**: "Configuration commands are not supported. The extension auto-configures itself within VS Code."

## Design Decisions

### 1. Functional Categorization

**Decision**: Organize handlers by function (CodeReview, Info, Passthrough) instead of execution location (Extension vs CLI).

**Rationale**:
- Related commands share implementation patterns
- Easier to test (similar test structure)
- More maintainable (changes affect related commands)
- Clearer separation of concerns

**Example**: `/review` and `/diff` both work with files, so they belong together even though they do different things.

### 2. Centralized Command Registry

**Decision**: Single source of truth in `CommandParser` for all command metadata.

**Rationale**:
- Easy to add new commands (one place to update)
- Consistent type checking across codebase
- Self-documenting (registry shows all commands)
- Testable (51 tests verify registry completeness)

### 3. Three-Tier Categorization

**Decision**: Split commands into Extension, Passthrough, and Not-Supported (not just Extension vs CLI).

**Rationale**:
- User experience clarity (know what to expect)
- Different UI patterns for each type
- Prevents confusion ("why doesn't /clear work?")
- Future-proof (easy to move commands between categories)

### 4. Instruction Templates

**Decision**: Store user-facing instruction text in command registry, not in handlers.

**Rationale**:
- Keeps UI text close to command definition
- Easy to update instructions without touching handlers
- Testable (verify instruction exists for passthrough commands)
- Consistent wording across all passthrough commands

### 5. Help System Design

**Decision**: `/help` without arguments shows categorized list, `/help <command>` shows detailed usage.

**Rationale**:
- Discoverability (users can explore all commands)
- Context-specific help (detailed when needed)
- CLI compatibility (same pattern as Copilot CLI)
- Self-documenting (help text lives with command definition)

## Session Metrics Tracking

The `/usage` command provides comprehensive session metrics:

**Tracked Metrics**:
- **Session Start Time**: Recorded in `BackendState.sessionStartTime`
  - Set on session start (`SDKSessionManager.startSession()`)
  - Set on session resume (`SDKSessionManager.resumeSession()`)
- **Session Duration**: Calculated as `Date.now() - sessionStartTime`
- **Token Usage**: Captured from SDK events
  - Input tokens
  - Output tokens
  - Total tokens
- **Message Count**: Number of user/assistant exchanges
- **Tool Calls**: Number of tools executed

**Display Format**:

```text
Session Usage Metrics
---------------------
Duration: 1h 23m 45s
Messages: 42 exchanges
Tool Calls: 156 executions

Tokens:
  Input:  12,345 tokens
  Output: 23,456 tokens
  Total:  35,801 tokens
  
Quota: 85% used (refresh in 2h 15m)
```

## Testing Strategy

### Test-Driven Development (TDD)

All slash command implementation follows strict TDD:

**RED Phase**: Write failing tests first
```javascript
describe('CommandParser Registry', () => {
    it('recognizes /review as extension command', () => {
        expect(parser.getCommandType('review')).to.equal('extension');
    });
});
// Run: 0 passing, 1 failing ✅
```

**GREEN Phase**: Implement minimal code to pass
```javascript
this.commands.set('review', { type: 'extension', event: 'showPlanContent' });
// Run: 1 passing ✅
```

**REFACTOR Phase**: Clean up and optimize
```javascript
// Extract shared patterns, improve naming, add comments
```

### Test Coverage

**Unit Tests**:

- `tests/unit/utils/command-parser-registry.test.js` (51 tests) — Command type detection, helpers, instruction templates, edge cases
- `tests/unit/utils/command-parser.test.js` (7 tests) — `getVisibleCommands()`, description/category fields, exclusion of not-supported commands
- `tests/unit/components/slash-command-panel.test.js` (8 tests) — Panel show/hide, grouped rendering, category headers, onSelect callback
- `tests/unit/components/input-area-slash-panel.test.js` (8 tests) — `/` trigger detection, Escape dismiss, command insertion, placeholder text
- `tests/unit/components/status-bar-help.test.js` (4 tests) — `?` icon rendering, showHelp event emission

**Integration Tests**:

- `tests/integration/webview/slash-command-routing.test.js` — InputArea routing, RPC message flow, UI feedback

**E2E Tests** (planned):

- Full command execution flow
- Terminal creation for passthrough commands

### Test Results

Current status: **896 passing, 3 pending** (full test suite including slash command tests)

## Implementation Timeline

**Phase 1: Research & Planning** (Complete)

- ✅ Researched all 41 Copilot CLI slash commands
- ✅ Categorized into extension/passthrough/not-supported
- ✅ Designed functional architecture
- ✅ Created implementation plan

**Phase 2: Frontend Foundation** (Complete)

- ✅ Extended CommandParser with 41 commands
- ✅ Implemented type detection methods
- ✅ Added instruction templates
- ✅ 51 unit tests passing
- ✅ Committed: `4338dce`

**Phase 3: Backend Handlers** (Complete)

- ✅ CodeReviewSlashHandlers (TDD)
- ✅ InfoSlashHandlers (TDD)
- ✅ CLIPassthroughService (TDD)
- ✅ Session metrics tracking
- ✅ Committed: `cad7f89`

**Phase 4: Integration** (Complete)

- ✅ RPC handler wiring
- ✅ InputArea routing via CommandParser.parse/isValid/execute
- ✅ MessageDisplay UI feedback

**Phase 5: Discoverability** (Complete)

- ✅ CommandParser: description/category metadata, `getVisibleCommands()`
- ✅ SlashCommandPanel component (grouped `/` trigger panel)
- ✅ StatusBar `?` help icon
- ✅ InputArea wiring (`/` detection, panel mount, Escape dismiss)
- ✅ CSS styles (VS Code theme variables)
- ✅ 27 new tests across 4 test files
- ✅ Committed: `575edd4`

## Future Enhancements

### Model Selection Dropdown

**Status**: Backlog (see `planning/backlog/model-selection-dropdown.md`)

**Design**:
- Dropdown UI above input area
- List of available models (Sonnet, Opus, GPT-4, etc.)
- Mid-session model switching
- User preference persistence
- Real-time model capability display

**Why not passthrough?**:
- Better UX (visual selection vs typing)
- Shows model capabilities (context window, speed, cost)
- Persists user preference
- Validates model availability before switching

### Intellisense / Autocomplete

**Status**: Roadmap (see `planning/roadmap/`)

Full inline autocomplete as the user types partial commands (e.g., typing `/pl` narrows to `/plan`). The current SlashCommandPanel is an interim solution showing all commands; intellisense would provide filtered, context-aware suggestions.

### Help System Enhancements

**Ideas**:

- Keyboard shortcut reference
- Recently used commands
- Command aliases (e.g., `/p` for `/plan`)

### Terminal Integration Improvements

**Ideas**:
- Terminal reuse (don't create new terminal each time)
- Command history in terminal
- Terminal output capture (show results in webview)
- Enterprise SSO auto-configuration

## Known Issues

### Plan Mode Tool Access Bug

**Issue**: Plan mode currently has full tool access (should be restricted to read-only exploration).

**Impact**: AI can edit files, run tests, and commit changes while in plan mode, defeating the safety sandbox.

**Status**: Fixed in v3.0 via `planModeToolsService.ts` (see `documentation/issues/BUG-PLAN-MODE-HAS-FULL-TOOLS.md`)

**Related Code**: `src/extension/services/planModeToolsService.ts` - Filters tools to read-only subset when plan mode is active.

## Performance Considerations

**Command Registry Lookup**: O(1) HashMap lookup
**Memory Footprint**: ~2KB for registry (41 commands × ~50 bytes metadata)
**Command Parsing**: Single regex match, no heavy computation
**Terminal Creation**: Async, non-blocking
**File Operations**: Async with proper error handling

## Security Considerations

**Input Validation**:
- Command names sanitized (alphanumeric + hyphen only)
- File paths validated before passing to diff viewer
- No arbitrary code execution from user input

**Terminal Isolation**:
- Passthrough commands run in user's own authenticated session
- No credential passing from extension to terminal
- User must authenticate separately in terminal

**MCP Configuration Display**:
- Read-only display (no editing)
- No sensitive data exposure (API keys masked)
- Configuration validation before display

## Maintenance Guide

### Adding a New Command

1. **Add to CommandParser registry**:
```javascript
this.commands.set('newcommand', {
    type: 'extension', // or 'passthrough' or 'not-supported'
    event: 'newCommandEvent', // if extension type
    instruction: 'Instruction text...', // if passthrough type
    category: 'config', // plan | code | config | cli (for visible commands)
    description: 'Short description' // shown in discoverability panel
});
```

2. **Write tests** (TDD RED phase):
```javascript
it('recognizes /newcommand as extension command', () => {
    expect(parser.getCommandType('newcommand')).to.equal('extension');
});
```

3. **Implement handler** (if extension command):
```typescript
// In appropriate handler file
async handleNewCommand(args: any) {
    // Implementation
}
```

4. **Wire RPC handler**:
```typescript
this.router.register('newCommandEvent', async (args) => {
    return this.handler.handleNewCommand(args);
});
```

5. **Update documentation**:
- Add to command reference in this file
- Update CHANGELOG.md
- Update README.md if user-facing

### Updating Instruction Templates

Edit instruction text in CommandParser registry:
```javascript
['delegate', {
    type: 'passthrough',
    instruction: 'Updated instruction text here...'
}]
```

No other code changes needed - instruction propagates automatically.

### Moving Command Between Categories

To move a command from passthrough to extension (or vice versa):

1. Update registry type
2. Add/remove instruction or event as appropriate
3. Implement handler if moving to extension
4. Update tests
5. Update documentation

Example:
```javascript
// Before: passthrough
['somecommand', { type: 'passthrough', instruction: '...' }]

// After: extension
['somecommand', { type: 'extension', event: 'someCommandEvent' }]
```

## References

- **GitHub Copilot CLI Documentation**: https://docs.github.com/copilot/cli
- **VS Code Terminal API**: https://code.visualstudio.com/api/references/vscode-api#window.createTerminal
- **VS Code Diff API**: https://code.visualstudio.com/api/references/vscode-api#commands.executeCommand
- **Extension Architecture**: `documentation/ARCHITECTURE.md`
- **Testing Guide**: `documentation/TESTING.md`

---

**Document Status**: Living document (update as architecture evolves)  
**Maintained By**: Extension development team  
**Review Frequency**: After each major release
