Plan Mode Safe Tool Implementation - Test-First Approach
Here's the complete plan:

Phase 1: Validate the Solution ✅ (Already Done)
✅ Confirmed custom tools must be in availableTools
✅ Confirmed availableTools works as complete whitelist
✅ Confirmed both custom + SDK tools can coexist
Phase 2: Create Comprehensive Test Suite (Do First)
Test 1: tests/plan-mode-safe-tools.test.mjs

Test session creation with renamed tools + availableTools
Verify all expected tools work:
plan_bash_explore - executes read-only commands (pwd, ls, git status, cat)
task_agent_type_explore - dispatches exploration sub-agents only
edit_plan_file - edits only plan.md
create_plan_file - creates only plan.md
update_work_plan - updates plan content
view - reads any file (SDK)
grep - searches content (SDK)
glob - finds files (SDK)
web_fetch - fetches URLs (SDK)
fetch_copilot_cli_documentation - gets docs (SDK)
Verify blocked tools fail:
bash (SDK version) - not available
create (SDK version) - not available
edit (SDK version) - not available
task (SDK version) - not available
Test 2: tests/plan-mode-restrictions.test.mjs

Test plan_bash_explore blocks dangerous commands (rm, mv, npm install, git commit, etc.)
Test task_agent_type_explore blocks non-explore agent types (code, fix, debug, etc.)
Test edit_plan_file blocks editing non-plan files
Test create_plan_file blocks creating non-plan files
Verify error messages are clear and helpful
Test 3: tests/plan-mode-integration.test.mjs

Enable plan mode
Create plan using create_plan_file
Update plan using update_work_plan
Edit plan using edit_plan_file
Explore codebase using:
plan_bash_explore for quick shell commands
task_agent_type_explore for deep codebase investigation
view, grep, glob for reading code
web_fetch for documentation
Verify cannot escape restrictions
Phase 3: Implement Custom Tools (After Tests Written)
In src/sdkSessionManager.ts:

Rename/update tool creation methods:

createRestrictedBashTool() → returns tool named plan_bash_explore
createRestrictedTaskTool() → returns tool named task_agent_type_explore
createRestrictedEditTool() → returns tool named edit_plan_file
createRestrictedCreateTool() → returns tool named create_plan_file
Keep createUpdateWorkPlanTool() → returns update_work_plan
Update getCustomTools() to return all 5 renamed tools

Update plan session creation to use availableTools:

this.planSession = await this.client.createSession({
    sessionId: planSessionId,
    model: this.config.model || undefined,
    tools: customTools, // 5 custom tools
    availableTools: [
        // Custom restricted tools (5)
        'plan_bash_explore',           // restricted bash for read-only commands
        'task_agent_type_explore',     // restricted task for exploration only
        'edit_plan_file',              // edit ONLY plan.md
        'create_plan_file',            // create ONLY plan.md
        'update_work_plan',            // update plan content
        // Safe SDK tools (5)
        'view',                        // read files
        'grep',                        // search content
        'glob',                        // find files
        'web_fetch',                   // fetch URLs
        'fetch_copilot_cli_documentation' // get CLI docs
    ],
    systemMessage: { /* ... */ }
});
Update system message to document the 10 available tools with clear descriptions
Phase 4: Verify & Document
Run all tests to confirm everything works
Update PLAN_MODE_FIX_SUMMARY.md with new approach
Document the tool renaming rationale and security guarantees
Test manually in VS Code with real planning scenarios
Update COPILOT.md to explain plan mode tools
Tool Summary (10 Total)
Custom Restricted Tools (5):

plan_bash_explore - Safe shell commands only
task_agent_type_explore - Exploration sub-agents only
edit_plan_file - Edit plan.md only
create_plan_file - Create plan.md only
update_work_plan - Update plan content
SDK Safe Tools (5): 6. view - Read any file 7. grep - Search content 8. glob - Find files 9. web_fetch - Fetch URLs 10. fetch_copilot_cli_documentation - Get CLI docs

Blocked Tools:

bash, create, edit, task (SDK versions)
All write/modify operations except plan.md
All installation/package management commands
All git write operations (commit, push, etc.)
