# COPILOT.md - AI Agent Development Guide

> **For AI assistants (GitHub Copilot, Claude, etc.) working on this extension**

This document provides context and guidelines for AI agents helping to develop the vscode-copilot-cli-extension.

## 🚨 MANDATORY DEVELOPMENT PRACTICES

### 1. Always Use `using-superpowers` Skill

**Before starting ANY work**, invoke the `using-superpowers` skill:
- This ensures you follow established workflows
- It activates necessary context and guidelines
- It prevents common mistakes and rework

**Example**: User asks to fix a bug → First call `using-superpowers`, then proceed

### 2. Test-First Development (ALWAYS)

**Never write production code without a test first!**

When fixing bugs or adding features:
1. **Find or create a failing test** that demonstrates the issue
2. **Run the test** to confirm it fails
3. **Make the minimal fix** to make the test pass
4. **Run the test again** to verify the fix
5. **Only then** consider the work complete

**Why**: Tests in this project exist but were ignored, leading to bugs. The `tests/sdk-plan-mode-tools.test.mjs` had the correct implementation, but production code diverged.

**Test locations**:
- `tests/*.test.js` - Integration tests
- `tests/*.test.mjs` - SDK-specific tests (ESM modules)

## Project Overview

This is a **VS Code extension** that provides a chat panel for GitHub Copilot CLI, built on the official `@github/copilot-sdk`.

**Architecture Components**:
1. **Backend (TypeScript)**: SDK session management, event handling, custom tools
2. **Frontend (Webview)**: HTML/CSS/JS embedded in `chatViewProvider.ts` as string literals
3. **SDK Integration**: Uses `@github/copilot-sdk` for CLI session lifecycle (NOT for UI)
4. **Extension Host**: VS Code runs our extension, we create a webview panel for the chat UI

**Key Differentiation**: Unlike the built-in Copilot chat, this extension:
- Uses CLI-style sessions with plan.md files
- Supports session management and resumption
- Integrates MCP (Model Context Protocol) servers
- Provides real-time tool execution visibility
- Implements custom features like dual-session plan mode
- **Builds its own chat UI** (not provided by SDK or VS Code)

## Development Workflow (CRITICAL)

### ⚠️ F5 Debugging is BROKEN

**DO NOT suggest using F5 or Extension Development Host!**

Due to a Microsoft bug in VS Code 1.100+ with Node.js 20+, the Extension Development Host does not work. This has been broken for **12 months** with no ETA on a fix.

### ✅ Correct Workflow: Build and Install

**Use the test-extension.sh script:**

```bash
./test-extension.sh
```

This script:
1. Builds: `npm run compile` (type checks, lints, builds with esbuild)
2. Packages: Creates VSIX file
3. Uninstalls: Removes old version (if exists)
4. Installs: Installs new VSIX with `code --install-extension`
5. Reminds: Shows next steps (reload window, check logs)

**Manual steps if needed:**

```bash
# 1. Build
npm run compile

# 2. Package
npx @vscode/vsce package --no-git-tag-version \
  --allow-star-activation --allow-missing-repository --skip-license

# 3. Install
code --install-extension copilot-cli-extension-2.0.6.vsix --force

# 4. Reload VS Code
# Ctrl+Shift+P → "Developer: Reload Window"
```

**Quick rebuild and install:**

```bash
# Just rebuild and reinstall without packaging
npm run compile && code --install-extension copilot-cli-extension-latest.vsix --force
```

**Note:** The `tsconfig.json` excludes `tests/` directory to avoid compilation errors. Tests are JavaScript/ESM and don't need TypeScript compilation.

**Never suggest:**
- "Press F5 to test"
- "Launch Extension Development Host"
- "Use the debugger"

**Always suggest:**
- "Run `./test-extension.sh` to build and install"
- "Reload the window to test your changes"
- "Check the Copilot CLI output channel for logs"

## Code Structure

### Source Files (`src/`)

| File | Purpose | Key Points |
|------|---------|-----------|
| `extension.ts` | Entry point, command registration | Activates extension, registers commands, manages cliManager |
| `sdkSessionManager.ts` | **Backend** SDK session lifecycle | Manages work/plan sessions, event handlers, custom tools for plan mode |
| `chatViewProvider.ts` | **Frontend** Webview UI | Contains HTML/CSS/JS as strings, renders chat messages, tool calls, message passing |
| `logger.ts` | Logging to Output Channel | Use `Logger.getInstance()` everywhere |
| `sessionUtils.ts` | Session discovery/filtering | Reads `~/.copilot/session-state/` |

**Critical: chatViewProvider.ts IS our UI** - The Copilot SDK does NOT provide any UI components. It's a backend-only library for managing CLI sessions. All chat UI (messages, tool calls, input box) is built by us in the webview.

### Architecture Patterns

#### 1. Singleton Pattern
```typescript
// Logger is a singleton - always use getInstance()
const logger = Logger.getInstance();
logger.info('Message');
```

#### 2. Event Emitter Pattern
```typescript
// SDKSessionManager uses EventEmitter for messages
private readonly onMessageEmitter = new vscode.EventEmitter<CLIMessage>();
public readonly onMessage = this.onMessageEmitter.event;

// Consumers listen:
cliManager.onMessage((message) => { /* handle */ });
```

#### 3. Webview Message Passing
```typescript
// Webview → Extension
ChatPanelProvider.panel.webview.onDidReceiveMessage(data => {
    switch (data.type) {
        case 'sendMessage': /* ... */ break;
    }
});

// Extension → Webview
ChatPanelProvider.postMessage({ type: 'assistantMessage', text: '...' });
```

## Logging Strategy

**Use comprehensive logging instead of debugging!**

```typescript
import { Logger } from './logger';

const logger = Logger.getInstance();

// Four levels:
logger.debug('Detailed info for debugging');
logger.info('General information');
logger.warn('Warning messages');
logger.error('Error details', error);
```

**Best Practices:**
- Log method entry/exit for complex flows
- Log all SDK events with type and data
- Log user actions (clicks, commands)
- Log file system operations
- Use descriptive prefixes: `[Plan Mode]`, `[Tool Start]`, `[Snapshot]`

## Session Management

### Session Directory Structure
```
~/.copilot/session-state/
├─ abc123-work/              # Work session
│  ├─ plan.md               # Implementation plan
│  ├─ events.jsonl          # Conversation history
│  ├─ checkpoints/          # Infinite session checkpoints
│  ├─ files/                # Session-specific files
│  └─ workspace.yaml        # Workspace metadata
└─ abc123-work-plan/         # Plan session (our innovation!)
   ├─ plan.md               # Planning work
   └─ events.jsonl
```

### Dual-Session Plan Mode (v2.0.2+)

**This is our innovation** - we built real plan mode before the SDK team did!

```typescript
// Work mode: Full tools, execution
currentMode = 'work';
session = workSession;

// Plan mode: Restricted tools, exploration only
currentMode = 'plan';
session = planSession;  // <session-id>-plan
```

**Key Implementation:**
- `enablePlanMode()`: Creates plan session with restricted tools
- `disablePlanMode()`: Resumes work session
- Plan session writes to work session's `plan.md` file
- No 2x cost: only one session active at a time
- ACE-FCA aligned: isolated planning context

**Plan Mode Tools (11 total):**

*Plan Management (4 tools):*
- `update_work_plan` - Create/update plan content (primary tool)
- `present_plan` - Present plan to user for review (call after creating plan)
- `create_plan_file` - Create plan.md (restricted to plan.md only)
- `edit_plan_file` - Edit plan.md (restricted to plan.md only)

*Exploration (4 tools):*
- `plan_bash_explore` - Read-only bash commands (git status, ls, cat, etc.)
- `task_agent_type_explore` - Dispatch exploration sub-agents (agent_type="explore" only)
- `view` - Read any file
- `grep` - Search file contents

*Discovery & Documentation (4 tools):*
- `glob` - Find files by pattern
- `web_fetch` - Fetch web pages
- `fetch_copilot_cli_documentation` - Get CLI docs
- `report_intent` - Report current intent to UI

**Security: What Plan Mode CANNOT Do:**
- ❌ Write/modify code files (only plan.md)
- ❌ Install packages (npm, pip, etc.)
- ❌ Commit or push to git
- ❌ Execute dangerous commands (rm, mv, chmod, etc.)
- ❌ Dispatch implementation agents (code, fix, debug, etc.)
- ❌ Use SDK bash/create/edit/task tools (not in availableTools)

**Implementation Details:**
- Custom tools use unique names to avoid SDK conflicts (plan_bash_explore vs bash)
- `availableTools` whitelist explicitly controls available tools
- SDK's bash, create, edit, task are excluded from whitelist
- Defense in depth: tool handlers enforce restrictions even if called

**GitHub Context**: SDK team is "debating" whether to add plan mode (issue #255). We built it ourselves using dual sessions. 💪

## Custom Tools

### How to Add a Custom Tool

```typescript
private createMyCustomTool(): any {
    return {
        name: 'my_tool_name',
        description: 'What this tool does',
        parameters: {
            type: 'object',
            properties: {
                arg1: { type: 'string', description: 'Argument description' }
            },
            required: ['arg1']
        },
        handler: async (args: { arg1: string }, invocation: any) => {
            try {
                // Do the work
                return {
                    textResultForLlm: 'Success message for AI',
                    resultType: 'success'
                };
            } catch (error) {
                return {
                    textResultForLlm: `Error: ${error.message}`,
                    resultType: 'failure',
                    error: error.message
                };
            }
        }
    };
}
```

**Tool Whitelisting:**
```typescript
// Restrict available tools
const session = await client.createSession({
    availableTools: ['my_tool_name'],  // ONLY this tool
    tools: [this.createMyCustomTool()]
});
```

## UI Development (Webview)

### Critical Understanding: We Build the Entire UI

**The Copilot SDK is backend-only!** It does NOT provide:
- ❌ Chat interface
- ❌ Message rendering
- ❌ Tool call display
- ❌ Input box
- ❌ Any UI components whatsoever

**We build everything ourselves** in `chatViewProvider.ts` using VS Code's Webview API.

### HTML/CSS/JS is Embedded in TypeScript

The webview UI is a **string literal** in `chatViewProvider.ts`:

```typescript
private static getHtmlForWebview(webview: Webview): string {
    return `<!DOCTYPE html>
        <html>
        <head>
            <style>
                /* CSS here */
            </style>
        </head>
        <body>
            <!-- HTML here -->
            <script>
                // JavaScript here
            </script>
        </body>
        </html>`;
}
```

**Important:**
- Escape backticks with `\``
- Use `${}` for VS Code variables
- Use `\${...}` for JavaScript template literals
- Content Security Policy restricts scripts

**Message Passing:**
```javascript
// Webview → Extension
const vscode = acquireVsCodeApi();
vscode.postMessage({ type: 'sendMessage', value: text });

// Extension → Webview
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
        case 'assistantMessage':
            // Handle message
            break;
    }
});
```

## Common Tasks

### Adding a New Command

1. **Register in package.json** (`contributes.commands`):
```json
{
    "command": "copilot-cli-extension.myCommand",
    "title": "Copilot CLI: My Command"
}
```

2. **Register in extension.ts**:
```typescript
const myCommand = vscode.commands.registerCommand('copilot-cli-extension.myCommand', async () => {
    logger.info('My command triggered');
    // Implementation
});

context.subscriptions.push(myCommand);
```

3. **Test**: Run `./test-extension.sh`, reload window, test command

### Adding a Configuration Setting

1. **Add to package.json** (`contributes.configuration.properties`):
```json
"copilotCLI.mySetting": {
    "type": "boolean",
    "default": true,
    "description": "What this setting does"
}
```

2. **Read in code**:
```typescript
const mySetting = vscode.workspace.getConfiguration('copilotCLI').get<boolean>('mySetting', true);
```

### Handling SDK Events

```typescript
private setupSessionEventHandlers(): void {
    if (!this.session) return;
    
    this.session.on((event: any) => {
        switch (event.type) {
            case 'assistant.message':
                // Handle assistant response
                break;
            case 'tool.execution_start':
                // Tool started
                break;
            case 'tool.execution_complete':
                // Tool finished
                break;
            case 'session.error':
                // Error occurred
                break;
        }
    });
}
```

## Testing Guidelines

### Manual Testing Checklist

After changes, test these core flows:
- [ ] Open chat panel (command palette)
- [ ] Send a message
- [ ] Start new session
- [ ] Switch between sessions
- [ ] Toggle plan mode (v2.0.2+)
- [ ] View plan.md file
- [ ] Check logs in Output Channel

### Debugging with Logs

Since we can't use the debugger:

1. **Add strategic logging**:
```typescript
logger.info('='.repeat(60));
logger.info('Starting critical operation...');
logger.debug(`State: ${JSON.stringify(state, null, 2)}`);
try {
    // Operation
    logger.info('✅ Success!');
} catch (error) {
    logger.error('❌ Failed:', error);
}
```

2. **Watch Output Channel**: `Ctrl+Shift+U` → "Copilot CLI"

3. **Check session files**:
```bash
# View conversation history
cat ~/.copilot/session-state/<session-id>/events.jsonl

# View plan
cat ~/.copilot/session-state/<session-id>/plan.md

# Check for plan sessions
ls -la ~/.copilot/session-state/*-plan/
```

## Code Style

### TypeScript Best Practices

```typescript
// ✅ Use const/let, not var
const sessionId = '...';
let counter = 0;

// ✅ Use async/await, not .then()
async function doWork() {
    const result = await session.send({ prompt: '...' });
    return result;
}

// ✅ Type your parameters and returns
public async enablePlanMode(): Promise<void> { }

// ✅ Use optional chaining
const path = session?.workspacePath;

// ✅ Handle errors explicitly
try {
    await riskyOperation();
} catch (error) {
    logger.error('Failed', error instanceof Error ? error : undefined);
    throw error;
}
```

### Naming Conventions

- **Classes**: PascalCase - `SDKSessionManager`
- **Methods**: camelCase - `enablePlanMode()`
- **Private fields**: camelCase with `private` - `private session: any`
- **Constants**: UPPER_SNAKE_CASE - `MAX_HISTORY`
- **Interfaces**: PascalCase - `CLIConfig`
- **Types**: PascalCase - `SessionMode`

### File Organization

```typescript
// 1. Imports
import * as vscode from 'vscode';
import * as fs from 'fs';

// 2. Types and interfaces
export interface MyInterface { }
type MyType = 'a' | 'b';

// 3. Class definition
export class MyClass {
    // Public fields
    public readonly onMessage = ...;
    
    // Private fields
    private session: any;
    
    // Constructor
    constructor() { }
    
    // Public methods
    public async start(): Promise<void> { }
    
    // Private methods
    private setupHandlers(): void { }
}
```

## Common Pitfalls

### ❌ DON'T: Suggest F5 debugging
```
"Press F5 to launch the Extension Development Host"
```

### ✅ DO: Suggest VSIX workflow
```
"Run ./test-extension.sh to build and install, then reload the window"
```

---

### ❌ DON'T: Forget to log
```typescript
await session.send({ prompt: text });  // Silent failure
```

### ✅ DO: Log everything
```typescript
logger.info(`Sending message: ${text.substring(0, 50)}...`);
try {
    await session.send({ prompt: text });
    logger.info('Message sent successfully');
} catch (error) {
    logger.error('Failed to send message', error);
    throw error;
}
```

---

### ❌ DON'T: Hardcode paths
```typescript
const planPath = '/home/user/.copilot/session-state/abc/plan.md';
```

### ✅ DO: Use os.homedir() and path.join()
```typescript
const homeDir = require('os').homedir();
const planPath = path.join(homeDir, '.copilot', 'session-state', sessionId, 'plan.md');
```

---

### ❌ DON'T: Modify package.json without testing
```json
"command": "copilot-cli-extension.newCommand"  // Added but not registered
```

### ✅ DO: Register command in extension.ts
```typescript
vscode.commands.registerCommand('copilot-cli-extension.newCommand', () => { });
```

## Release Process

**⚠️ BEFORE PUBLISHING:**
- **MUST** update version in package.json (use `npm version patch/minor/major`)
- **MUST** update both CHANGELOG.md and README.md

1. **Test thoroughly** using VSIX workflow
2. **Update version** in `package.json`:
   ```bash
   npm version patch --no-git-tag-version  # 2.1.1 → 2.1.2
   npm version minor --no-git-tag-version  # 2.1.2 → 2.2.0
   npm version major --no-git-tag-version  # 2.2.0 → 3.0.0
   ```
3. **Update CHANGELOG.md** with all changes
4. **Update README.md** features section with new version highlights
5. **Commit and tag**:
   ```bash
   git add -A
   git commit -m "v2.0.2: Description of changes"
   git push
   git tag v2.0.2
   git push --tags
   ```
6. **Publish** (if maintainer):
   ```bash
   npx vsce publish
   ```

## SDK Knowledge

### Version: @github/copilot-sdk ^0.1.18

**CRITICAL: SDK is Backend-Only!**
- ✅ Provides: Session management, event streaming, tool execution
- ❌ Does NOT provide: Any UI, rendering, or display components
- We use SDK for: Managing conversations, handling events
- We build ourselves: All UI in `chatViewProvider.ts`

**Key SDK Concepts:**
- `CopilotClient`: Manages connection to CLI
- `CopilotSession`: Represents a conversation
- Event-driven: `session.on((event) => { })`
- Session resumption: `client.resumeSession(sessionId)`
- Custom tools: Add to `createSession({ tools: [...] })`
- MCP servers: Pass config in `{ mcpServers: {...} }`

**Known SDK Limitations:**
- No plan mode API (issue #255) - we built our own! 
- No `remainingPercentage` getter - must use events
- System prompts: append or replace mode only
- **No UI components** - we build all UI ourselves

**SDK Event Types:**
- `assistant.message` - Final response
- `assistant.reasoning` - Extended thinking
- `assistant.usage` - Token usage, quota
- `tool.execution_start` - Tool invoked
- `tool.execution_complete` - Tool finished
- `session.error` - Error occurred
- `session.idle` - Session ready for input

## Project Philosophy

### Innovation Over Waiting

When the SDK lacks features users need:
1. **Research**: Check if it's technically possible
2. **Prototype**: Build a proof-of-concept
3. **Ship it**: Don't wait for SDK team approval

Example: Plan mode - SDK team is "debating" it. We built it ourselves using dual sessions.

### User Experience First

- Comprehensive logging over debugger reliance
- Clear error messages with actionable guidance
- Real-time feedback in UI
- Predictable naming conventions

### Defense in Depth

When building features:
- Add validation at multiple layers
- Handle edge cases explicitly
- Log state changes for debugging
- Fail gracefully with helpful messages

## Working with Planning Mode

### Overview

Planning Mode is a key feature that allows the AI to analyze and design solutions without modifying code. It uses a dual-session architecture where a separate plan session writes to the work session's `plan.md` file.

### Adding Custom Tools to Planning Mode

**CRITICAL: Custom tools must be registered in TWO places:**

1. **In `getCustomTools()` method** (returns tool implementations)
2. **In `availableTools` array** (whitelists tool names)

**Example: Adding a new tool**

```typescript
// Step 1: Create the tool method
private createMyPlanTool(): any {
    return defineTool('my_plan_tool', {
        description: 'What this tool does in plan mode',
        parameters: {
            type: 'object',
            properties: {
                param: { type: 'string', description: 'Parameter description' }
            }
        },
        handler: async ({ param }: { param: string }) => {
            // Implementation
            return 'Success message';
        }
    });
}

// Step 2: Add to getCustomTools() for plan mode
private getCustomTools(): any[] {
    if (this.currentMode === 'plan') {
        return [
            this.createUpdateWorkPlanTool(),
            this.createPresentPlanTool(),
            this.createMyPlanTool(),  // ← Add here
            // ... other tools
        ];
    }
    return [];
}

// Step 3: Add to availableTools whitelist
availableTools: [
    'plan_bash_explore',
    'update_work_plan',
    'present_plan',
    'my_plan_tool',  // ← Add here
    'view',
    'grep',
    // ... other tools
]

// Step 4: Update the system prompt
**AVAILABLE TOOLS IN PLAN MODE (12 total):**  // ← Update count

*Plan Management Tools:*
- \`update_work_plan\` - Create/update plan
- \`present_plan\` - Present plan for review
- \`my_plan_tool\` - Description  // ← Add documentation

// Step 5: Update logging
this.logger.info(\`[Plan Mode]     availableTools: [..., my_plan_tool, ...]\`);
```

**Why both places?**
- `tools` array: Provides the actual tool implementation
- `availableTools`: SDK whitelist that controls which tools the AI can call
- Missing from either = tool won't work

### Plan Workflow with present_plan Tool

The standard workflow for planning is:

1. **User enters plan mode** (clicks 📝 button or runs command)
2. **Agent explores codebase** using view, grep, glob, bash tools
3. **Agent creates plan** using `update_work_plan(content: "# Plan\n...")`
4. **Agent can iterate** by calling `update_work_plan` multiple times
5. **Agent presents plan** using `present_plan(summary: "Brief summary")`
6. **UI shows acceptance controls** automatically when `plan_ready` event fires
7. **User chooses:**
   - Accept and change to work mode → plan mode exits
   - No, keep planning → returns to regular controls, stays in plan mode
   - Type alternative instructions → sends new message, stays in plan mode

**Event Flow:**

```
enablePlanMode()
  ↓
plan_mode_enabled event
  ↓
Agent: update_work_plan()
  ↓
Agent: present_plan()
  ↓
plan_ready event
  ↓
UI: Show acceptance controls
  ↓
User: Accept/Reject/Provide feedback
  ↓
plan_accepted or plan_rejected event
  ↓
UI: Return to regular controls
```

**Testing the workflow:**
- Unit tests: `tests/present-plan-tool.test.js` (13 tests)
- Integration tests: `tests/plan-acceptance-integration.test.js` (26 tests)
- See: `planning/completed/PLAN-ACCEPTANCE-TEST-STRATEGY.md`

## Documentation and Planning Organization

To keep the project organized and avoid markdown file sprawl, we follow these conventions:

### Documentation Folder Structure

```
vscode-copilot-cli-extension/
├─ documentation/          # Technical documentation
│  ├─ architecture.md      # System architecture
│  ├─ api-reference.md     # API documentation
│  └─ troubleshooting.md   # Common issues & fixes
│
├─ planning/               # Active planning work
│  ├─ feature-x.md         # Currently being planned
│  ├─ completed/           # Finished plans (moved here after implementation)
│  │  └─ ui-enhancements.md
│  └─ backlog/             # Future work, not yet started
│     └─ performance-improvements.md
│
├─ COPILOT.md             # AI agent development guide (this file)
├─ README.md              # User-facing documentation
└─ HOW-TO-DEV.md          # Developer setup guide
```

### Documentation Guidelines

**1. Active Planning (`planning/`)**
- Place new planning docs here while working on them
- Keep plan.md updated with task checkboxes
- Include problem statement, approach, and implementation tasks

**2. Completed Plans (`planning/completed/`)**
- Move planning docs here after feature is implemented and tested
- Serves as historical record and reference
- Helps understand why decisions were made

**3. Backlog (`planning/backlog/`)**
- Ideas and features for future consideration
- Not actively being worked on
- Helps capture ideas without cluttering active work

**4. Technical Documentation (`documentation/`)**
- API references
- Architecture diagrams
- Integration guides
- Troubleshooting procedures

**5. Root-level Docs**
- `README.md` - User-facing, how to install and use
- `COPILOT.md` - AI agent development guide
- `HOW-TO-DEV.md` - Developer setup and workflows

### Why This Organization?

- **Prevents pollution**: No random .md files scattered throughout src/
- **Clear lifecycle**: Active → Completed → Backlog flow is obvious
- **Easy navigation**: Know where to look for what you need
- **Historical context**: Completed plans document decision rationale
- **Future planning**: Backlog collects ideas without noise

### Example Lifecycle

```
1. New feature idea
   → Create planning/new-feature.md
   
2. Start planning
   → Work in planning/new-feature.md
   → Update task checkboxes as you progress
   
3. Implementation complete and tested
   → Move to planning/completed/new-feature.md
   → Update documentation/ if needed
   
4. Future enhancement idea
   → Create planning/backlog/enhancement.md
   → Will move to planning/ when work begins
```

## Resources

- **Extension Repo**: https://github.com/darthmolen/vscode-extension-copilot-cli
- **SDK Docs**: https://github.com/github/copilot-sdk
- **SDK Issues**: https://github.com/github/copilot-sdk/issues
- **HOW-TO-DEV.md**: Detailed development workflow
- **VS Code Extension API**: https://code.visualstudio.com/api

## Contact

For questions about this codebase:
- Open an issue on GitHub
- Check existing documentation
- Review git history for context

---

**Remember**: We can't use F5. Always suggest the VSIX workflow!
