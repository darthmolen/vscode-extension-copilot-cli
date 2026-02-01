# Plan Mode Safe Tool Implementation - Complete

## Problem
Plan mode needs to be sandboxed - it should only allow exploration and planning, not implementation. Previous approach tried to override SDK tools (bash, create, edit, task) with restricted versions, but this had limitations.

## Solution: Renamed Tools + availableTools Whitelist
Instead of trying to override SDK tools with the same name, we:
1. **Rename custom tools** to unique identifiers that won't conflict with SDK tools
2. **Use availableTools whitelist** to explicitly control which tools are available
3. **Block SDK versions** of dangerous tools (bash, create, edit, task) by excluding them from availableTools

## Implementation

### Tool Renaming (src/sdkSessionManager.ts)
**Custom Restricted Tools (5):**
- `plan_bash_explore` - Restricted bash (read-only commands only)
- `task_agent_type_explore` - Restricted task (explore agent type only)
- `edit_plan_file` - Restricted edit (plan.md only)
- `create_plan_file` - Restricted create (plan.md only)
- `update_work_plan` - Update plan content (unchanged name)

**Safe SDK Tools (6):**
- `view` - Read any file
- `grep` - Search content
- `glob` - Find files by pattern
- `web_fetch` - Fetch URLs
- `fetch_copilot_cli_documentation` - Get CLI docs
- `report_intent` - Report current intent

**Blocked Tools (SDK versions):**
- ❌ `bash` - Not in availableTools
- ❌ `create` - Not in availableTools
- ❌ `edit` - Not in availableTools
- ❌ `task` - Not in availableTools

### availableTools Whitelist
```typescript
this.planSession = await this.client.createSession({
    sessionId: planSessionId,
    model: this.config.model || undefined,
    tools: customTools, // 5 custom restricted tools
    availableTools: [
        // Custom restricted tools (5)
        'plan_bash_explore',
        'task_agent_type_explore',
        'edit_plan_file',
        'create_plan_file',
        'update_work_plan',
        // Safe SDK tools (6)
        'view',
        'grep',
        'glob',
        'web_fetch',
        'fetch_copilot_cli_documentation',
        'report_intent'
    ],
    systemMessage: { /* ... */ }
});
```

## Test Suite (Phase 2 - TDD Approach)

### Test 1: plan-mode-safe-tools.test.mjs
Tests that the correct tools are available:
- ✅ Custom tools work (plan_bash_explore, task_agent_type_explore, etc.)
- ✅ SDK tools work (view, grep, glob, web_fetch, docs)
- ✅ Blocked tools fail (SDK bash, create, edit, task)

### Test 2: plan-mode-restrictions.test.mjs
Tests that restrictions actually block dangerous operations:
- ✅ Blocks 9 dangerous bash commands (rm, mv, npm install, git commit, etc.)
- ✅ Blocks 6 non-explore agent types (code, fix, debug, implement, etc.)
- ✅ Blocks editing 5 non-plan files
- ✅ Blocks creating 5 non-plan files
- ✅ Error messages are clear and helpful
- **Total: 26/26 tests passed**

### Test 3: plan-mode-integration.test.mjs
End-to-end workflow test:
- ✅ Create plan using create_plan_file
- ✅ Update plan using update_work_plan
- ✅ Edit plan using edit_plan_file
- ✅ Execute safe bash commands
- ✅ Block dangerous bash commands
- ✅ Dispatch explore agents
- ✅ Block non-explore agents
- ✅ Cannot escape restrictions (non-plan files blocked)
- **Total: 9/9 tests passed**

## Security Guarantees

### What Plan Mode CAN Do:
✅ Read any file (view, grep, glob)
✅ Execute read-only commands (git status, ls, cat, etc.)
✅ Dispatch exploration sub-agents
✅ Fetch documentation from web
✅ Create/edit/update ONLY plan.md

### What Plan Mode CANNOT Do:
❌ Write/modify any code files
❌ Install packages (npm install, pip install, etc.)
❌ Commit or push to git
❌ Execute dangerous commands (rm, mv, chmod, etc.)
❌ Dispatch implementation agents (code, fix, debug, etc.)
❌ Use SDK bash/create/edit/task tools (not in availableTools)

## How It Works

### 1. Tool Name Uniqueness
By using unique names (plan_bash_explore vs bash), we avoid conflicts:
- Custom tools and SDK tools can coexist
- No "Tool names must be unique" errors
- Clear which tool is which in logs

### 2. availableTools as Complete Whitelist
The SDK respects availableTools as the COMPLETE list of allowed tools:
- Only listed tools are available
- SDK's bash, create, edit, task are NOT listed → blocked
- Custom plan_bash_explore, etc. ARE listed → available

### 3. Restrictions in Custom Tool Handlers
Each custom tool enforces its restrictions:
```typescript
// plan_bash_explore - whitelist of allowed commands
const allowedCommands = ['pwd', 'ls', 'cat', 'git status', ...];

// task_agent_type_explore - only allow "explore"
if (agentType !== 'explore') {
    return { textResultForLlm: '❌ Blocked...', resultType: 'denied' };
}

// edit_plan_file - only allow session plan.md
if (filePath !== sessionPlanPath) {
    return { textResultForLlm: '❌ Blocked...', resultType: 'denied' };
}
```

## Files Changed

### Phase 2 (Tests - TDD)
- `tests/plan-mode-safe-tools.test.mjs` - NEW
- `tests/plan-mode-restrictions.test.mjs` - NEW
- `tests/plan-mode-integration.test.mjs` - NEW

### Phase 3 (Implementation)
- `src/sdkSessionManager.ts` - Updated:
  - Renamed 4 tool creation methods (bash → plan_bash_explore, etc.)
  - Added availableTools whitelist to plan session creation
  - Updated system message with new tool names
  - Updated logging to reflect availableTools enforcement

### Phase 4 (Documentation)
- `PLAN_MODE_FIX_SUMMARY.md` - Updated (this file)
- `COPILOT.md` - To be updated with plan mode tool documentation

## Verification

### Run Tests
```bash
node tests/plan-mode-restrictions.test.mjs  # 26/26 passed
node tests/plan-mode-integration.test.mjs   # 9/9 passed
node tests/plan-mode-safe-tools.test.mjs    # 7/7 passed
```

### Manual Testing in VS Code
1. Reload extension: `Developer: Reload Window`
2. Open Copilot CLI chat
3. Enable plan mode (toggle button)
4. Try commands:
   - ✅ Should work: "use plan_bash_explore to run git status"
   - ❌ Should fail: "use bash to run rm -rf test"
   - ✅ Should work: "create a plan using update_work_plan"
   - ❌ Should fail: "use create to make a new file in src/"

## Git Checkpoints
- ✅ Phase 2 committed: "Create comprehensive test suite for plan mode safe tools"
- ✅ Phase 3 committed: "Implement renamed tools with availableTools whitelist"
- ⏳ Phase 4 in progress: Documentation and final verification

## Technical Notes

### Why This Approach Works
1. **No Name Conflicts**: Unique names prevent tool collision
2. **Complete Whitelist**: availableTools acts as security boundary
3. **Defense in Depth**: Tool handlers enforce restrictions even if called
4. **Clear Intent**: Tool names clearly indicate their purpose (plan_bash_explore)

### Previous Approaches Tried
1. ❌ Override SDK tools with same name → Unclear if custom or SDK version used
2. ❌ availableTools without rename → Custom tools blocked when SDK tools excluded
3. ✅ Rename + availableTools → Both custom and SDK tools work together safely
