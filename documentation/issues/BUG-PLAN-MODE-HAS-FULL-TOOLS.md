# BUG: Plan Mode Has Full Tool Access (Edge Case)

**Date**: 2026-02-14
**Severity**: Medium (downgraded from Critical)
**Status**: Investigated — green path confirmed, edge case unreproducible

## Problem

During an extended planning session (~10 minutes), the AI agent broke out of plan mode tool restrictions and began implementing with full tool access (bash, edit, create). The plan was never formally presented via the `present_plan` tool. When the user hit the accept plan checkmark, VS Code showed "Previous session not found."

## Investigation Results

### Code Review: Implementation Is Correct

Investigation of `src/sdkSessionManager.ts` confirmed:

- **`enablePlanMode()` (lines 934-1109)**: Correctly creates a plan session with `availableTools` whitelist (12 tools: 6 custom + 6 safe SDK tools). Has 7-step logging. Error handler reverts to work mode.
- **Session recovery (lines 686-854)**: Correctly preserves plan mode via `wasPlanMode` flag at line 702. Recovery recreates plan session with restricted tools.
- **`planModeToolsService.getAvailableToolNames()`**: Returns the correct 12-tool whitelist.

### Diagnostic Logging Added

Two diagnostic log lines were added to `sdkSessionManager.ts`:

1. **`sendMessage()` (~line 641)**: `[sendMessage] mode=${currentMode} sessionId=${sessionId} isRetry=${isRetry}` — logs mode and session on every message.
2. **`handleToolStart()` (~line 534)**: `[Tool Start] tool=${toolName} mode=${currentMode} session=${sessionId}` — logs every tool execution with mode context.

### Green Path Test: PASSED (2026-02-14)

Clean diagnostic test with full server and client logs confirmed:

- All plan-mode messages logged `mode=plan` with correct plan session ID
- Only whitelisted tools were used: `report_intent`, `update_work_plan`, `present_plan`, `edit_plan_file`
- `edit_plan_file` on a non-plan file was correctly **BLOCKED** by the tool handler
- `present_plan` was called correctly with plan summary
- Accept plan correctly switched to `mode=work`
- `bash` and `view` tools only appeared AFTER acceptance in work mode
- No timeout recovery or session recreation events

**Logs preserved**: `tests/logs/server/planning-green-path-confirmed.log`, `tests/logs/client/planning-green-path-confirmed.log`

## Original Incident Details

**Session**: `dd99ae75-6e5f-4d99-99ef-465a2dcf9460`
**Context**: Pre-existing work session → Developer Reload → entered plan mode → planned for ~10 minutes → agent broke out and started implementing

During the incident, the agent was able to:

1. Edit production code: `src/webview/app/services/CommandParser.js`
2. Create test files: `tests/unit/utils/command-parser-registry.test.js`
3. Run tests: `npx mocha tests/unit/utils/command-parser-registry.test.js`
4. Commit changes: `git commit -m "feat: CommandParser with 41 slash commands"`

**Commit hash**: `4338dce` — committed while nominally in plan mode.

**Notable**: Session ID `dd99ae75` has no `-plan` suffix, suggesting the agent may have been running on the work session rather than the plan session.

## Root Cause Hypotheses

Since the code is correct and the green path works, the edge case is likely triggered by one of:

1. **SDK `availableTools` soft enforcement**: The Copilot SDK may surface `availableTools` as a system prompt hint rather than hard-enforcing it. After extended context (~10 min), the LLM "forgets" the restriction and uses blocked tools, which the CLI executes because there's no server-side enforcement.

2. **Mid-session recovery dropping restrictions**: A silent error during the extended session triggered session recovery that recreated the session without the `availableTools` restriction. The recovery code has hardcoded tool lists (lines 722-736 and 791-804) that could drift.

3. **Developer Reload + pre-existing session**: The combination of Developer Reload → resume → enter plan mode on a pre-existing session may create a state desync where `resumeAndStartSession()` (which always starts in work mode at line 363: `this.currentMode = 'work'`) conflicts with the plan mode activation.

## Planned Fixes (Defense-in-Depth)

These should be implemented regardless of reproduction, as they harden plan mode:

### 1. Server-side tool enforcement

Add a tool execution interceptor in `sdkSessionManager.ts` that rejects non-whitelisted tools when `currentMode === 'plan'`, independent of SDK enforcement.

### 2. DRY recovery tool lists

Replace hardcoded `availableTools` arrays in recovery paths (lines 722-736, 791-804) with `planModeToolsService.getAvailableToolNames()`.

### 3. Work session health check in `acceptPlan()`

Before switching from plan to work session, verify the work session is still alive. Handle the "Previous session not found" gracefully.

## Reproduction Steps (Edge Case — Not Yet Reproducible)

1. Start a work session, interact for a while
2. Developer Reload
3. Enter plan mode
4. Give a complex planning task that takes ~10 minutes
5. Observe if agent breaks out of plan mode tool restrictions

## Monitoring

Diagnostic logging is in place. Next occurrence will show in server logs as:

- `[Tool Start] tool=bash mode=plan` or `tool=edit mode=plan` — confirms the bug
- Any `[Timeout Recovery]` or `Recreating` logs — indicates mid-session recovery
- `[sendMessage] mode=work` during what should be plan mode — indicates mode desync

---

**Discovered by**: User testing (2026-02-14)
**Investigated by**: Systematic debugging (2026-02-14)
**Green path confirmed**: 2026-02-14
**Next**: Implement defense-in-depth fixes, wait for edge case reproduction
