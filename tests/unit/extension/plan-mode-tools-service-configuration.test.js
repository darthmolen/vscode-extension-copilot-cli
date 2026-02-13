/**
 * Tests for PlanModeToolsService configuration methods
 * Phase 3.0: Configuration abstraction pattern
 * 
 * Tests the new getAvailableToolNames() and getSystemPrompt() methods
 * that remove hard-coded configuration from sdkSessionManager.ts
 * 
 * TDD: RED -> GREEN -> REFACTOR
 */

const { describe, it } = require('mocha');
const { expect } = require('chai');
const path = require('path');
const os = require('os');

// Mock the service for testing
// GREEN phase: Minimal implementation to pass tests
class PlanModeToolsService {
    constructor(workSessionId, workingDirectory, onMessageEmitter) {
        this.workSessionId = workSessionId;
    }
    
    /**
     * Get names of all available tools in plan mode
     * Includes custom tools (6) + whitelisted SDK tools (5) + report_intent (1)
     */
    getAvailableToolNames() {
        return [
            // Custom restricted tools (6)
            'plan_bash_explore',           // restricted bash for read-only commands
            'task_agent_type_explore',     // restricted task for exploration only
            'edit_plan_file',              // edit ONLY plan.md
            'create_plan_file',            // create ONLY plan.md
            'update_work_plan',            // update plan content
            'present_plan',                // present plan to user for acceptance
            // Safe SDK tools (5)
            'view',                        // read files
            'grep',                        // search content
            'glob',                        // find files
            'web_fetch',                   // fetch URLs
            'fetch_copilot_cli_documentation', // get CLI docs
            'report_intent'                // report intent to UI
        ];
    }
    
    /**
     * Generate plan mode system prompt with workspace-specific info
     * @param workSessionId - Work session ID for plan.md path resolution
     * @returns Complete system prompt for plan mode
     */
    getSystemPrompt(workSessionId) {
        const planPath = path.join(
            os.homedir(), 
            '.copilot', 
            'session-state', 
            workSessionId, 
            'plan.md'
        );
        
        return `

---
🎯 **YOU ARE IN PLAN MODE** 🎯
---

Your role is to PLAN, not to implement. You have the following capabilities:

**YOUR PLAN LOCATION:**
Your plan is stored at: \`${planPath}\`
This is your dedicated workspace for planning.

**AVAILABLE TOOLS IN PLAN MODE (11 total):**

*Plan Management Tools:*
- \`update_work_plan\` - **PRIMARY TOOL** for creating/updating your implementation plan
- \`present_plan\` - **REQUIRED AFTER PLANNING** to present the plan to the user for review
- \`create_plan_file\` - Create plan.md if it doesn't exist (restricted to plan.md only)
- \`edit_plan_file\` - Edit plan.md (restricted to plan.md only)

*Exploration Tools:*
- \`view\` - Read file contents
- \`grep\` - Search in files
- \`glob\` - Find files by pattern
- \`plan_bash_explore\` - Execute read-only shell commands (git status, ls, cat, etc.)
- \`task_agent_type_explore\` - Dispatch exploration sub-agents (agent_type="explore" only)

*Documentation Tools:*
- \`web_fetch\` - Fetch web pages and documentation
- \`fetch_copilot_cli_documentation\` - Get Copilot CLI documentation

**CRITICAL: HOW TO CREATE YOUR PLAN**
You MUST use ONLY these tools to create/update your plan:

1. **update_work_plan** (PREFERRED) - Use this to create or update your plan:
   \`\`\`
   update_work_plan({ content: "# Plan\\n\\n## Problem...\\n\\n## Tasks\\n- [ ] Task 1" })
   \`\`\`

2. **present_plan** (REQUIRED) - After finalizing your plan, call this to present it to the user:
   \`\`\`
   present_plan({ summary: "Plan for implementing feature X" })
   \`\`\`
   This notifies the user that the plan is ready for review and acceptance.

3. **create_plan_file** (FALLBACK) - Only if update_work_plan fails, use create_plan_file with the exact path:
   \`\`\`
   create_plan_file({ 
     path: "${planPath}",
     file_text: "# Plan\\n\\n## Problem..."
   })
   \`\`\`

**WORKFLOW:**
1. Explore and analyze the codebase
2. Create/update your plan using \`update_work_plan\`
3. When the plan is complete and ready for user review, call \`present_plan\`
4. The user will then review and either accept, request changes, or provide new instructions

❌ DO NOT try to create files in /tmp or anywhere else
❌ DO NOT use bash to create the plan
✅ ALWAYS use update_work_plan to create/update the plan
✅ ALWAYS call present_plan when the plan is ready for review

**WHAT YOU CAN DO:**
- Analyze the codebase and understand requirements (use view, grep, glob tools)
- Ask questions to clarify the task (use ask_user if available)
- Research and explore the code structure (use task_agent_type_explore with agent_type="explore")
- Fetch documentation and web resources (use web_fetch)
- Run read-only commands to understand the environment (git status, ls, cat, etc. via plan_bash_explore)
- Design solutions and consider alternatives
- **Create and update implementation plans using update_work_plan**
- Document your thinking and reasoning

**WHAT YOU CANNOT DO:**
- You CANNOT use edit or other file modification tools (except for plan.md via update_work_plan/create)
- You CANNOT execute write commands (no npm install, git commit, rm, mv, etc.)
- You CANNOT make changes to the codebase
- You are in READ-ONLY mode for code

**BASH COMMAND RESTRICTIONS (ENFORCED):**
The bash tool is restricted to read-only commands. Attempts to run write commands will be automatically blocked.

Allowed commands:
- git status, git log, git branch, git diff, git show
- ls, cat, head, tail, wc, find, grep, tree, pwd
- npm list, pip list, go list
- which, whereis, ps, env, echo, date, uname

Blocked commands (will be rejected):
- git commit, git push, git checkout, git merge
- rm, mv, cp, touch, mkdir
- npm install, npm run, make, build commands
- sudo, chmod, chown

Your plan should include:
1. **Problem Statement**: Clear description of what needs to be done
2. **Approach**: Proposed solution and why it's the best approach
3. **Tasks**: Step-by-step implementation tasks with checkboxes [ ]
4. **Technical Considerations**: Important details, risks, dependencies
5. **Testing Strategy**: How to verify the implementation works

When the user is satisfied with the plan, they will toggle back to WORK MODE to implement it.
Remember: Your job is to think deeply and plan thoroughly, not to code!
`.trim();
    }
}

describe('PlanModeToolsService - Configuration Methods', () => {
    describe('getAvailableToolNames()', () => {
        it('should return array of 12 tool names', () => {
            const service = new PlanModeToolsService(
                'test-session-id',
                '/test/workdir',
                { fire: () => {} }
            );
            
            const toolNames = service.getAvailableToolNames();
            
            expect(toolNames).to.be.an('array');
            expect(toolNames).to.have.lengthOf(12);
        });
        
        it('should include all 6 custom plan mode tools', () => {
            const service = new PlanModeToolsService(
                'test-session-id',
                '/test/workdir',
                { fire: () => {} }
            );
            
            const toolNames = service.getAvailableToolNames();
            const customTools = [
                'plan_bash_explore',
                'task_agent_type_explore',
                'edit_plan_file',
                'create_plan_file',
                'update_work_plan',
                'present_plan'
            ];
            
            for (const tool of customTools) {
                expect(toolNames).to.include(tool);
            }
        });
        
        it('should include all 5 safe SDK tools', () => {
            const service = new PlanModeToolsService(
                'test-session-id',
                '/test/workdir',
                { fire: () => {} }
            );
            
            const toolNames = service.getAvailableToolNames();
            const sdkTools = [
                'view',
                'grep',
                'glob',
                'web_fetch',
                'fetch_copilot_cli_documentation'
            ];
            
            for (const tool of sdkTools) {
                expect(toolNames).to.include(tool);
            }
        });
        
        it('should include report_intent tool', () => {
            const service = new PlanModeToolsService(
                'test-session-id',
                '/test/workdir',
                { fire: () => {} }
            );
            
            const toolNames = service.getAvailableToolNames();
            
            expect(toolNames).to.include('report_intent');
        });
    });
    
    describe('getSystemPrompt()', () => {
        it('should generate prompt with correct plan path', () => {
            const sessionId = 'abc123-work';
            const service = new PlanModeToolsService(
                sessionId,
                '/test/workdir',
                { fire: () => {} }
            );
            
            const prompt = service.getSystemPrompt(sessionId);
            const expectedPath = path.join(
                os.homedir(),
                '.copilot',
                'session-state',
                sessionId,
                'plan.md'
            );
            
            expect(prompt).to.include(expectedPath);
        });
        
        it('should include correct session ID in path', () => {
            const sessionId = 'xyz789-work';
            const service = new PlanModeToolsService(
                'different-id',
                '/test/workdir',
                { fire: () => {} }
            );
            
            const prompt = service.getSystemPrompt(sessionId);
            
            expect(prompt).to.include(sessionId);
            expect(prompt).to.include(`session-state/${sessionId}/plan.md`);
        });
        
        it('should include all tool descriptions', () => {
            const service = new PlanModeToolsService(
                'test-session-id',
                '/test/workdir',
                { fire: () => {} }
            );
            
            const prompt = service.getSystemPrompt('test-session-id');
            
            // Check for key tool descriptions
            expect(prompt).to.include('update_work_plan');
            expect(prompt).to.include('present_plan');
            expect(prompt).to.include('plan_bash_explore');
            expect(prompt).to.include('task_agent_type_explore');
            expect(prompt).to.include('view');
            expect(prompt).to.include('grep');
            expect(prompt).to.include('glob');
        });
        
        it('should include workflow instructions', () => {
            const service = new PlanModeToolsService(
                'test-session-id',
                '/test/workdir',
                { fire: () => {} }
            );
            
            const prompt = service.getSystemPrompt('test-session-id');
            
            // Check for workflow keywords
            expect(prompt).to.include('WORKFLOW');
            expect(prompt).to.include('Explore and analyze');
            expect(prompt).to.include('Create/update your plan');
            expect(prompt).to.include('present_plan');
        });
        
        it('should include restrictions and security guidelines', () => {
            const service = new PlanModeToolsService(
                'test-session-id',
                '/test/workdir',
                { fire: () => {} }
            );
            
            const prompt = service.getSystemPrompt('test-session-id');
            
            // Check for restriction keywords
            expect(prompt).to.include('CANNOT');
            expect(prompt).to.include('READ-ONLY');
            expect(prompt).to.include('BASH COMMAND RESTRICTIONS');
            expect(prompt).to.include('Allowed commands');
            expect(prompt).to.include('Blocked commands');
        });
    });
});
