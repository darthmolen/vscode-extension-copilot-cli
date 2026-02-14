# 🚨 BUG: Plan Mode Has Full Tool Access

**Date**: 2026-02-14  
**Severity**: CRITICAL  
**Status**: Discovered

## Problem

Plan mode is **NOT restricting tool access** as designed. The AI agent has full access to all tools including write operations, when it should only have read-only exploration tools.

## Expected Behavior

When in plan mode, the AI should only have access to:
- ✅ `view`, `grep`, `glob` - Read-only file exploration
- ✅ `plan_bash_explore` - Read-only bash commands
- ✅ `create_plan_file`, `edit_plan_file` - ONLY for editing plan.md
- ✅ `task_agent_type_explore` - Exploration agents only

## Actual Behavior

The AI has FULL access to:
- ❌ `bash` - Can execute ANY bash command (builds, tests, commits)
- ❌ `create`, `edit` - Can modify ANY file in the codebase
- ❌ `task` - Can dispatch ANY agent type (including implementation agents)

## Evidence

During session `dd99ae75-6e5f-4d99-99ef-465a2dcf9460`, while in plan mode, the AI was able to:

1. **Edit production code**: Modified `src/webview/app/services/CommandParser.js`
2. **Create test files**: Created `tests/unit/utils/command-parser-registry.test.js`
3. **Run tests**: Executed `npx mocha tests/unit/utils/command-parser-registry.test.js`
4. **Commit changes**: Ran `git commit -m "feat: CommandParser with 41 slash commands"`

All of these operations should have been **blocked** by plan mode restrictions.

**Commit hash**: `4338dce` - This commit was made while in plan mode!

## Root Cause (Hypothesis)

The tool restriction layer is either:
1. Not implemented in the extension's plan mode
2. Not being enforced by the SDK session
3. Being bypassed somehow

**Key question**: Is the extension actually creating a plan-mode session with `availableTools` whitelist? Or is it just setting a `currentMode` flag without SDK enforcement?

## Impact

**Security**: Plan mode's safety sandbox is completely broken. The AI can:
- Modify production code
- Delete files
- Install packages
- Execute arbitrary commands
- Commit dangerous changes

This defeats the entire purpose of plan mode as a "safe exploration" environment.

## Reproduction Steps

1. Start a new session
2. Enter plan mode (should trigger dual-session plan mode)
3. Ask the AI to "implement X" or "edit Y file"
4. Observe: AI can freely edit files, run commands, commit changes

## Related Code

**Extension files to investigate**:
- `src/sdkSessionManager.ts` - `enablePlanMode()` method
  - Does it properly set `availableTools` whitelist?
  - Does it create a separate plan session?
- `src/extension.ts` - Plan mode activation
- Custom tool definitions - Are they respecting mode restrictions?

**SDK session creation**:
```typescript
// Expected in enablePlanMode():
const planSession = await client.createSession({
    availableTools: [
        'view', 'grep', 'glob',
        'plan_bash_explore',
        'create_plan_file', 'edit_plan_file',
        'task_agent_type_explore'
    ],
    tools: [/* only safe custom tools */]
});
```

## Next Steps

1. **Verify**: Check if `sdkSessionManager.enablePlanMode()` is actually creating restricted session
2. **Test**: Add unit test that verifies plan mode blocks write operations
3. **Fix**: Ensure `availableTools` whitelist is properly enforced
4. **Validate**: Manually test that AI cannot edit files in plan mode

## Workaround (None)

There is no workaround. Users should **not trust plan mode** until this is fixed.

## Priority

**P0 - Critical**: This breaks a core safety feature and could lead to:
- Accidental code modification during planning
- Users losing trust in plan mode
- Dangerous operations executed in "safe" context

---

**Discovered by**: User testing (2026-02-14)  
**Needs**: Immediate investigation and fix
