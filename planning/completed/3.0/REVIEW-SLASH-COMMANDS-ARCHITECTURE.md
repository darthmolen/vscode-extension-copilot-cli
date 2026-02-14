# Review: SLASH-COMMANDS-ARCHITECTURE.md

**Reviewer**: Claude Opus 4.6 (Senior Code Reviewer)
**Date**: 2026-02-14
**Document Under Review**: `documentation/SLASH-COMMANDS-ARCHITECTURE.md`
**Base SHA**: `4338dce`
**HEAD SHA**: `cad7f89` (current)

---

## Executive Summary

The architecture document is well-structured and covers the system thoroughly. The design decisions are sound and the categorization scheme is clean. However, the document contains several factual inaccuracies against the codebase, a stale file reference, aspirational code samples presented as actual implementation, and a critical routing bug that is neither documented nor covered by tests. The claimed command count of 41 is wrong (actual: 40), and the not-supported subcategory counts do not add up.

**Overall Assessment**: Good architecture document with moderate accuracy issues that should be corrected before it serves as a reliable reference.

---

## 1. Accuracy Issues

### CRITICAL: Command Count is Wrong (41 vs 40)

**Document claims**: "41 different commands" (line 8), repeated throughout.
**Actual registry**: 40 commands (10 extension + 6 passthrough + 24 not-supported).

The document says 25 not-supported commands but the registry at `src/webview/app/services/CommandParser.js` (lines 94-119) contains exactly 24. The discrepancy appears to originate in the "Configuration" subcategory section (line 249), which claims "(4)" commands but only lists 3:

```
#### Configuration (4)        <-- claims 4
- `/theme`                    <-- 1
- `/terminal-setup`           <-- 2
- `/init`                     <-- 3
                              <-- missing 4th command
```

The subcategory totals are: 5 + 7 + 3 + 1 + 5 + 3 = 24 (not 25).
Therefore total commands are: 10 + 6 + 24 = 40 (not 41).

**Evidence**: Running the parser programmatically confirms 40 total and 24 not-supported. The unit tests at `tests/unit/utils/command-parser-registry.test.js` (line 80) also say "25 total" in the describe block but only enumerate 24 commands -- the forEach loop runs 24 times and all 24 pass. The test describe string is also inaccurate.

**Recommendation**: Fix all references from 41 to 40, from 25 to 24, and from "Configuration (4)" to "Configuration (3)". Also fix the test describe block at line 80.

---

### CRITICAL: Not-Supported Command Routing Bug

The document (Section 2, "Command Routing") shows code where `InputArea` checks command type and routes accordingly:

```javascript
if (type === 'extension') { ... }
else if (type === 'passthrough') { ... }
else if (type === 'not-supported') { ... }
```

**This code does not exist.** The actual `InputArea.sendMessage()` at `src/webview/app/components/InputArea/InputArea.js` (lines 188-216) does NOT check command type. It calls:

```javascript
this.commandParser.execute(cmd, this.eventBus);
```

The `execute()` method at `src/webview/app/services/CommandParser.js` (lines 192-206) does:

```javascript
eventBus.emit(commandDef.event, cmd.args);
```

For not-supported commands, `commandDef.event` is `undefined` (these commands have no `event` property). This means `eventBus.emit(undefined, [])` is called, which is a silent no-op. The user gets zero feedback.

Meanwhile, `src/webview/main.js` line 182 registers `eventBus.on('showNotSupported', ...)` -- but this event is never emitted by the CommandParser flow because there is no routing logic that detects `type === 'not-supported'` and emits `showNotSupported`.

Similarly, passthrough commands (like `/delegate`) have no `event` property -- they have `instruction` instead. So `execute()` calls `eventBus.emit(undefined, [])` for those too. The `eventBus.on('openInCLI', ...)` handler in `main.js` line 188 is also unreachable through the current CommandParser flow.

**The entire routing for not-supported and passthrough commands is dead code.** Only extension commands (which have an `event` property) actually work through `execute()`.

**Recommendation**: This is a significant bug. Either:
1. Add type-based routing to `InputArea.sendMessage()` as the doc describes (check type before calling execute), OR
2. Add synthetic `event` properties to passthrough and not-supported command definitions so `execute()` works for them.

Option 1 is cleaner and matches the documented architecture.

---

### IMPORTANT: Aspirational Code Samples Presented as Implementation

**Section 2** ("Command Routing", lines 60-82): The `handleSubmit()` method shown does not exist anywhere in the codebase. The actual flow is `sendMessage()` -> `parse()` -> `isValid()` -> `execute()` with no type-based dispatch. This is aspirational pseudocode, not documentation of existing code.

**Section 4** ("RPC Communication", lines 116-144): The `registerSlashCommandHandlers()` method with `this.router.register(...)` calls does not exist in `ExtensionRpcRouter.ts`. The actual `ExtensionRpcRouter` uses typed `on*` handler methods (e.g., `onShowPlanContent`, `onOpenDiffView`), and the wiring is done in `src/chatViewProvider.ts` in the `_setupRpcHandlers()` method (lines 205-301), not in the router itself.

The actual RPC router pattern is:
```typescript
// In chatViewProvider.ts (not in ExtensionRpcRouter)
this.rpcRouter.onShowPlanContent(async () => {
    const result = await this.codeReviewHandlers!.handleReview();
    // ...
});
```

This is fundamentally different from the `this.router.register('showPlanContent', ...)` pattern shown in the doc.

**Recommendation**: Either label code samples as "Design Intent / Pseudocode" or replace them with actual code from the codebase.

---

### IMPORTANT: Stale File Reference

**Line 470**: `planning/BUG-PLAN-MODE-HAS-FULL-TOOLS.md`
**Actual location**: `documentation/issues/BUG-PLAN-MODE-HAS-FULL-TOOLS.md`

The file does not exist at the documented path:
```
ls planning/BUG-PLAN-MODE-HAS-FULL-TOOLS.md  -> No such file
ls documentation/issues/BUG-PLAN-MODE-HAS-FULL-TOOLS.md  -> EXISTS (5602 bytes)
```

**Recommendation**: Update the reference to `documentation/issues/BUG-PLAN-MODE-HAS-FULL-TOOLS.md`.

---

### IMPORTANT: NotSupportedSlashHandlers Not Documented

The file `src/extension/services/slashCommands/NotSupportedSlashHandlers.ts` exists and is actively used in `chatViewProvider.ts` (lines 221, 273-279), but the architecture document's "Backend Handlers" section (lines 84-107) only lists `CodeReviewSlashHandlers` and `InfoSlashHandlers`. The `NotSupportedSlashHandlers` class is completely omitted from the document.

**Recommendation**: Add a subsection for NotSupportedSlashHandlers:

```markdown
#### NotSupportedSlashHandlers
**Location**: `src/extension/services/slashCommands/NotSupportedSlashHandlers.ts`

Handles commands that are not applicable to the extension context:
- `handleNotSupported(commandName)` - Returns friendly message explaining unavailability
```

---

### IMPORTANT: handleReview Signature Mismatch

**Document** (line 96): `handleReview(sessionId)` -- implies it takes a sessionId parameter.
**Actual** (`CodeReviewSlashHandlers.ts` line 15): `async handleReview(): Promise<...>` -- takes no parameters. The session is retrieved internally via `this.sessionService.getCurrentSession()`.

**Document** (line 100): `handleUsage(sessionId)` -- implies it takes a sessionId parameter.
**Actual** (`InfoSlashHandlers.ts` line 38): `async handleUsage(): Promise<...>` -- takes no parameters. Session start time is retrieved via `this.backendState.getSessionStartTime()`.

**Recommendation**: Remove the `sessionId` parameters from the documented signatures to match reality.

---

### IMPORTANT: CLIPassthroughService Signature Mismatch

**Document** (line 107): `openCLI(sessionId, command, instruction)` -- parameter order is sessionId first.
**Actual** (`CLIPassthroughService.ts` line 42): `openCLI(fullCommand, sessionId, workspacePath)` -- fullCommand is first, and the third parameter is workspacePath (not instruction). The instruction is derived internally.

**Recommendation**: Update the documented signature to match the actual implementation.

---

## 2. Completeness Issues

### Missing: showModelSelector Has No Backend Handler

The `/model` command is registered in CommandParser with `event: 'showModelSelector'`, but:
- No handler for `showModelSelector` exists in `main.js` event wiring
- No `onShowModelSelector` method exists in `ExtensionRpcRouter.ts`
- No backend handler exists in `chatViewProvider.ts`

The event will be emitted by `execute()` into the EventBus but nothing listens for it. The doc notes "Future: Dropdown UI" in the table but does not flag this as unimplemented in the Implementation Status section (line 179 shows only `/model` dropdown as "Backlog").

**Recommendation**: Add a note that `/model` is registered but has no wiring or handler yet. Consider whether it should emit a "not yet implemented" message instead of silently doing nothing.

---

### Missing: Usage Metrics Are Simpler Than Documented

**Document** (lines 313-339, "Session Metrics Tracking"): Claims comprehensive metrics including input/output/total tokens, quota percentage, and refresh time.

**Actual** (`InfoSlashHandlers.ts` lines 38-77): The `handleUsage()` implementation only shows: start time, duration, message count, and tool call count. It does NOT include token counts (input/output/total) or quota information. The display format shown in the doc (lines 327-339) is aspirational.

**Recommendation**: Either update the doc to match the actual simpler implementation, or flag the richer display as "planned enhancement".

---

### Missing: Per-Category Not-Supported Messages Not Implemented

**Document** (lines 215, 226, 233, 238, 247, 254): Claims different category-specific messages (e.g., "Session management commands are not supported in the extension. Use the session management UI in the sidebar.").

**Actual** (`NotSupportedSlashHandlers.ts`): Uses a single generic message for ALL not-supported commands: "The /X command is not available in this extension. This is a CLI-specific command..."

The per-category messages documented are aspirational -- they do not exist in the implementation.

**Recommendation**: Either implement category-specific messages or update the doc to show the actual generic message.

---

## 3. Architecture Quality Assessment

### What Was Done Well

1. **Three-tier categorization** (Extension / Passthrough / Not-Supported) is a clean design that maps well to the product's constraints. The rationale provided is sound.

2. **Centralized registry** in CommandParser is the right pattern -- single source of truth, easy to test, easy to extend.

3. **Functional handler organization** (CodeReview, Info, Passthrough) rather than by execution type is a good choice that will scale.

4. **Backend wiring in chatViewProvider.ts** is well-implemented -- each slash command type has proper null-checking, error handling, and result forwarding to the webview.

5. **CLIPassthroughService** has good terminal reuse logic and clean separation from the rest of the system.

6. **Test coverage for CommandParser** is thorough -- 51 tests cover all 40 commands plus edge cases.

### Design Concerns

1. **execute() method is too naive**: The `CommandParser.execute()` method blindly calls `eventBus.emit(commandDef.event)` without checking command type. This works for extension commands but fails silently for passthrough and not-supported commands. The method should either refuse to execute non-extension commands or handle all three types.

2. **Instruction text is duplicated**: Passthrough command instructions exist in both `CommandParser.js` (the registry) and `CLIPassthroughService.ts` (the `getInstructionMessage()` method). The CLIPassthroughService has its own hardcoded copy of instruction strings. This violates single-source-of-truth. The doc's "Design Decision 4" (line 297) says instructions are stored in the registry, but they are also in the service.

3. **showModelSelector is a dead event**: Registering a command with an event that nothing handles creates a silent failure. Better to either wire it up with a "coming soon" message or not register it at all until it is ready.

---

## 4. Implementation Timeline Accuracy

### Phase 3 Status: More Complete Than Documented

**Document** (lines 410-414): Claims Phase 3 (Backend Handlers) is "In Progress" with all items showing the pending icon.

**Actual state**: The backend handlers are substantially implemented:

| Component | Doc Status | Actual Status |
|-----------|-----------|---------------|
| CodeReviewSlashHandlers | Pending | Implemented and wired in chatViewProvider.ts |
| InfoSlashHandlers | Pending | Implemented and wired in chatViewProvider.ts |
| NotSupportedSlashHandlers | Not mentioned | Implemented and wired in chatViewProvider.ts |
| CLIPassthroughService | Pending | Implemented with tests (20 tests) and wired |
| Session metrics tracking | Pending | Partially implemented (basic metrics, no tokens) |

The files all have "MINIMAL IMPLEMENTATION" headers but they are functional and wired into the backend. The RPC routing is also done (Phase 4 item), and `main.js` event wiring is complete.

**Recommendation**: Update Phase 3 to show most items as complete. Update Phase 4 to show RPC wiring and event wiring as complete. The frontend routing (InputArea type-based dispatch) is NOT complete (see the routing bug above).

---

## 5. Test Claims

### Test Count: Accurate

**Document** (line 393): Claims "51/51 passing".
**Actual**: Running `npx mocha tests/unit/utils/command-parser-registry.test.js` produces `51 passing (17ms)`.

The count is correct. However, the 51 tests verify 40 commands (not 41 as the doc claims), plus edge cases and helper methods.

Note: The test file describe block at line 80 says "Not Supported Commands (25 total)" but the forEach loop only iterates 24 commands. The describe string should be updated.

### Missing Tests

The following are implemented but have no test coverage:
- `NotSupportedSlashHandlers.handleNotSupported()` -- no unit tests found
- `InfoSlashHandlers` methods -- no unit tests found
- `CodeReviewSlashHandlers` methods -- no unit tests found
- The routing logic in `InputArea.sendMessage()` for slash commands -- no unit tests

`CLIPassthroughService` has good test coverage at `tests/unit/extension/services/cli-passthrough-service.test.js` (20 tests).

---

## 6. Summary of Issues by Severity

### Critical (Must Fix)

| # | Issue | Location |
|---|-------|----------|
| C1 | Command count is 40, not 41 (24 not-supported, not 25) | Throughout document |
| C2 | Not-supported and passthrough commands silently fail -- `execute()` emits `undefined` event | `CommandParser.js` execute() + `InputArea.js` sendMessage() |

### Important (Should Fix)

| # | Issue | Location |
|---|-------|----------|
| I1 | Code samples are aspirational pseudocode, not actual implementation | Sections 2 and 4 |
| I2 | Stale file reference: `planning/BUG-PLAN-MODE-HAS-FULL-TOOLS.md` moved | Line 470 |
| I3 | NotSupportedSlashHandlers not documented in Backend Handlers section | Section 3 |
| I4 | handleReview/handleUsage signatures show incorrect parameters | Lines 96, 100 |
| I5 | CLIPassthroughService.openCLI signature is wrong (parameter order/names) | Line 107 |
| I6 | Phase 3 status is outdated -- handlers are implemented | Lines 410-414 |
| I7 | Usage metrics display format is aspirational (token counts not implemented) | Lines 313-339 |
| I8 | Per-category not-supported messages not implemented (generic message used) | Lines 215-254 |
| I9 | Instruction text duplicated between CommandParser and CLIPassthroughService | Design concern |

### Suggestions (Nice to Have)

| # | Issue | Location |
|---|-------|----------|
| S1 | `/model` command is registered but has dead event -- add "coming soon" handler | CommandParser.js line 64 |
| S2 | Test describe block says "25 total" not-supported -- should be 24 | Test file line 80 |
| S3 | Add unit tests for NotSupportedSlashHandlers, InfoSlashHandlers, CodeReviewSlashHandlers | Test directory |
| S4 | Label code samples as "Design Intent" or replace with actual code | Sections 2, 4 |

---

## 7. Files Referenced in This Review

- `/home/smolen/dev/vscode-copilot-cli-extension/documentation/SLASH-COMMANDS-ARCHITECTURE.md` -- document under review
- `/home/smolen/dev/vscode-copilot-cli-extension/src/webview/app/services/CommandParser.js` -- command registry (40 commands, not 41)
- `/home/smolen/dev/vscode-copilot-cli-extension/src/webview/app/components/InputArea/InputArea.js` -- sendMessage() has no type-based routing
- `/home/smolen/dev/vscode-copilot-cli-extension/src/webview/main.js` -- event wiring (dead handlers for showNotSupported and openInCLI)
- `/home/smolen/dev/vscode-copilot-cli-extension/src/extension/services/slashCommands/CodeReviewSlashHandlers.ts` -- handleReview() takes no params
- `/home/smolen/dev/vscode-copilot-cli-extension/src/extension/services/slashCommands/InfoSlashHandlers.ts` -- handleUsage() takes no params
- `/home/smolen/dev/vscode-copilot-cli-extension/src/extension/services/slashCommands/NotSupportedSlashHandlers.ts` -- exists but not in doc
- `/home/smolen/dev/vscode-copilot-cli-extension/src/extension/services/CLIPassthroughService.ts` -- openCLI(fullCommand, sessionId, workspacePath)
- `/home/smolen/dev/vscode-copilot-cli-extension/src/extension/rpc/ExtensionRpcRouter.ts` -- uses on* pattern, not register()
- `/home/smolen/dev/vscode-copilot-cli-extension/src/chatViewProvider.ts` -- actual RPC handler wiring location
- `/home/smolen/dev/vscode-copilot-cli-extension/src/webview/app/rpc/WebviewRpcClient.js` -- has slash command send methods
- `/home/smolen/dev/vscode-copilot-cli-extension/tests/unit/utils/command-parser-registry.test.js` -- 51/51 passing, "25 total" string is wrong
- `/home/smolen/dev/vscode-copilot-cli-extension/tests/unit/extension/services/cli-passthrough-service.test.js` -- 20 tests, solid coverage
- `/home/smolen/dev/vscode-copilot-cli-extension/documentation/issues/BUG-PLAN-MODE-HAS-FULL-TOOLS.md` -- actual bug file location
- `/home/smolen/dev/vscode-copilot-cli-extension/planning/backlog/model-selection-dropdown.md` -- this reference IS valid

---

**Review complete.** The two critical issues (wrong command count and the routing bug) should be addressed before this document is used as an authoritative reference.
