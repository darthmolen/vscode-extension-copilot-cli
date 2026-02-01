# Plan Mode Duplicate Tool Fix - Summary

## Problem
When enabling plan mode, the extension was failing with:
```
CAPIError: 400 tools: Tool names must be unique.
Unknown tool name in the tool allowlist: "explore"
```

## Root Cause
1. **'explore' was incorrectly added to availableTools** - 'explore' is an agent type for the `task` tool, not a standalone tool
2. **Missing tools** - `web_fetch` and `fetch_copilot_cli_documentation` were not in the allowed tools list
3. **Insufficient logging** - Hard to debug which tools were being sent to the API

## Changes Made

### 1. Fixed availableTools Array (`src/sdkSessionManager.ts` lines 1113-1121)
**Before:**
```typescript
availableTools: [
    'view',
    'grep',
    'glob',
    'task',
    'explore'  // ❌ ERROR: Not a tool!
],
```

**After:**
```typescript
const availableTools = [
    'view',
    'grep',
    'glob',
    'task',
    'web_fetch',                      // ✅ Added
    'fetch_copilot_cli_documentation' // ✅ Added
];
```

### 2. Added Structured Logging (`src/sdkSessionManager.ts` lines 1123-1127)
```typescript
// Log structured tool configuration
this.logger.info(`[Plan Mode] Tool Configuration:`);
this.logger.info(`[Plan Mode]   Custom tools (${customTools.length}): ${customTools.map(t => t.name).join(', ')}`);
this.logger.info(`[Plan Mode]   Available tools (${availableTools.length}): ${availableTools.join(', ')}`);
this.logger.info(`[Plan Mode]   MCP servers enabled: ${hasMcpServers}`);
```

Expected output:
```
[Plan Mode] Tool Configuration:
[Plan Mode]   Custom tools (3): update_work_plan, bash, create
[Plan Mode]   Available tools (6): view, grep, glob, task, web_fetch, fetch_copilot_cli_documentation
[Plan Mode]   MCP servers enabled: true
```

### 3. Updated System Message
- Removed reference to 'explore' tool
- Added `web_fetch` and `fetch_copilot_cli_documentation` to documentation
- Clarified that `task` agent should be used for exploration

### 4. Created Integration Test (`tests/plan-mode-user-prompt.test.js`)
- Tests plan mode with a real user prompt
- 120-second timeout
- Verifies no duplicate tool errors
- Checks successful AI response
- **Result: 4/4 iterations passed ✅**

## How to Test

### Option 1: Reload Extension in VS Code (Recommended)
1. The code has already been compiled
2. In VS Code, press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
3. Type: `Developer: Reload Window`
4. Press Enter
5. Open Copilot CLI chat
6. Toggle Plan Mode
7. Check the output channel for the new structured logs

### Option 2: Run Integration Test
```bash
cd /home/smolen/dev/vscode-copilot-cli-extension
node tests/plan-mode-user-prompt.test.js
```

Expected output:
```
✅ Response received within timeout
✅ PASSED
Errors: 0
```

## Verification Checklist
After reloading VS Code:
- [ ] No "Tool names must be unique" error
- [ ] No "Unknown tool name: explore" warning  
- [ ] Structured logging appears in output channel
- [ ] Plan mode works without errors
- [ ] AI responds successfully to prompts in plan mode

## Files Changed
- `src/sdkSessionManager.ts` - Fixed tool configuration and added logging
- `tests/plan-mode-user-prompt.test.js` - New integration test
- `reload-extension.sh` - Helper script for reloading

## Technical Details
- **Tool vs Agent Type**: 'explore' is an agent type used with `task` tool, not a standalone tool
- **Custom tools**: update_work_plan, bash, create (3 tools)
- **Available tools**: view, grep, glob, task, web_fetch, fetch_copilot_cli_documentation (6 tools)
- **Total tools in plan mode**: 9 tools (3 custom + 6 available)
