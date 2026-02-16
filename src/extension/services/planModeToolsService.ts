/**
 * PlanModeToolsService
 * 
 * Provides 6 custom tools for plan mode with security restrictions:
 * 1. update_work_plan - Write to work session's plan.md
 * 2. present_plan - Notify UI that plan is ready for review
 * 3. plan_bash_explore - Execute read-only bash commands
 * 4. create_plan_file - Create session plan.md (restricted)
 * 5. edit_plan_file - Edit session plan.md (restricted)  
 * 6. task_agent_type_explore - Dispatch explore agents only
 * 
 * Extracted from SDKSessionManager for Phase 1.4 (3.0 Refactor)
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../../logger';
import { FileSnapshotService } from './fileSnapshotService';

// Dynamic import for SDK
let defineTool: any;

async function loadSDK() {
    if (!defineTool) {
        const sdk = await import('@github/copilot-sdk');
        defineTool = sdk.defineTool;
    }
}

export class PlanModeToolsService {
    private logger: Logger;
    
    constructor(
        private readonly workSessionId: string,
        private readonly workingDirectory: string,
        private readonly onDidChangeStatus: vscode.EventEmitter<any>,
        private readonly fileSnapshotService: FileSnapshotService,
        private readonly emitDiff: (diffData: { toolCallId: string; beforeUri: string; afterUri: string; title: string }) => void,
        logger?: Logger
    ) {
        this.logger = logger || Logger.getInstance();
        this.logger.debug(`[PlanModeToolsService] Created for session: ${workSessionId}`);
    }
    
    /**
     * Initialize SDK - must be called before creating tools
     */
    async initialize(): Promise<void> {
        await loadSDK();
    }
    
    /**
     * Get all 6 plan mode custom tools
     */
    getTools(): any[] {
        if (!defineTool) {
            throw new Error('PlanModeToolsService not initialized - call initialize() first');
        }
        
        return [
            this.createUpdateWorkPlanTool(),
            this.createPresentPlanTool(),
            this.createRestrictedBashTool(),
            this.createRestrictedCreateTool(),
            this.createRestrictedEditTool(),
            this.createRestrictedTaskTool()
        ];
    }
    
    /**
     * Tool 1: update_work_plan
     * Writes plan content to the work session's plan.md file
     */
    private createUpdateWorkPlanTool(): any {
        return defineTool('update_work_plan', {
            description: 'Update the implementation plan for the work session. Use this to document your planning, analysis, and design work. This plan will be available when switching back to work mode.',
            parameters: {
                type: 'object',
                properties: {
                    content: {
                        type: 'string',
                        description: 'The complete plan content in markdown format. Should include problem statement, approach, tasks with checkboxes, and technical considerations.'
                    }
                },
                required: ['content']
            },
            handler: async ({ content }: { content: string }, invocation: any) => {
                try {
                    const homeDir = require('os').homedir();
                    const workSessionPath = path.join(homeDir, '.copilot', 'session-state', this.workSessionId);
                    const planPath = path.join(workSessionPath, 'plan.md');
                    
                    this.logger.info(`[Plan Mode] Updating work plan at: ${planPath}`);
                    
                    // Ensure session directory exists
                    if (!fs.existsSync(workSessionPath)) {
                        this.logger.warn(`[Plan Mode] Work session directory doesn't exist: ${workSessionPath}`);
                        return `Error: Work session directory not found. Session may not exist yet.`;
                    }
                    
                    // Extract toolCallId or generate fallback
                    const toolCallId = invocation?.toolCallId || `custom-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                    
                    // STEP 1: Capture BEFORE state
                    const beforeContent = fs.existsSync(planPath) ? await fs.promises.readFile(planPath, 'utf-8') : '';
                    let beforeUri = '';
                    try {
                        beforeUri = this.fileSnapshotService.createTempSnapshot(beforeContent, 'plan.md');
                    } catch (e) {
                        this.logger.error('[Plan Mode] Failed to create snapshot, skipping diff:', e instanceof Error ? e : undefined);
                        // Continue without diff
                        await fs.promises.writeFile(planPath, content, 'utf-8');
                        return `Plan updated successfully (diff unavailable)`;
                    }
                    
                    // STEP 2: Write new content
                    await fs.promises.writeFile(planPath, content, 'utf-8');
                    this.logger.info(`[Plan Mode] Plan updated successfully (${content.length} bytes)`);
                    
                    // STEP 3: Emit diff
                    try {
                        this.emitDiff({
                            toolCallId,
                            beforeUri,
                            afterUri: planPath,
                            title: 'plan.md (Before ↔ After)'
                        });
                    } catch (e) {
                        this.logger.error('[Plan Mode] Failed to emit diff:', e instanceof Error ? e : undefined);
                        // Continue - plan write succeeded
                    }
                    
                    return `Plan updated successfully! The plan has been saved to ${planPath}. When you switch back to work mode, this plan will be ready for implementation.`;
                } catch (error) {
                    this.logger.error(`[Plan Mode] Failed to update work plan:`, error instanceof Error ? error : undefined);
                    return `Error updating plan: ${error instanceof Error ? error.message : String(error)}`;
                }
            }
        });
    }
    
    /**
     * Tool 2: present_plan
     * Notifies the UI that the plan is ready for user review
     */
    private createPresentPlanTool(): any {
        return defineTool('present_plan', {
            description: 'Present the plan to the user for review and acceptance. Call this AFTER writing the plan with update_work_plan to notify the user that the plan is ready. The UI will show acceptance options.',
            parameters: {
                type: 'object',
                properties: {
                    summary: {
                        type: 'string',
                        description: 'A brief one-sentence summary of what the plan covers (optional)'
                    }
                }
            },
            handler: async ({ summary }: { summary?: string }) => {
                try {
                    this.logger.info(`[Plan Mode] Presenting plan to user: ${summary || 'No summary provided'}`);
                    
                    // Emit a message to notify the UI to show acceptance controls
                    this.onDidChangeStatus.fire({ 
                        status: 'plan_ready' as any,
                        summary: summary || null
                    });
                    
                    return `Plan presented to user. They can now review it and choose to accept, continue planning, or provide new instructions.`;
                } catch (error) {
                    this.logger.error(`[Plan Mode] Failed to present plan:`, error instanceof Error ? error : undefined);
                    return `Error presenting plan: ${error instanceof Error ? error.message : String(error)}`;
                }
            }
        });
    }
    
    /**
     * Tool 3: plan_bash_explore
     * Restricted bash tool - only allows read-only commands
     */
    private createRestrictedBashTool(): any {
        const allowedCommandPrefixes = [
            'git status', 'git log', 'git branch', 'git diff', 'git show',
            'ls', 'cat', 'head', 'tail', 'wc', 'find', 'grep', 'tree', 'pwd',
            'npm list', 'pip list', 'pip show', 'go list', 'go mod graph',
            'which', 'whereis', 'ps', 'env', 'echo', 'date', 'uname'
        ];
        
        const blockedCommandPrefixes = [
            'git commit', 'git push', 'git checkout', 'git merge', 'git rebase', 'git cherry-pick',
            'rm', 'mv', 'cp', 'touch', 'mkdir', 'rmdir',
            'npm install', 'npm uninstall', 'npm run', 'npm start', 'npm test',
            'pip install', 'pip uninstall',
            'go get', 'go install',
            'make', 'cmake', 'cargo build', 'dotnet build',
            'sudo', 'su', 'chmod', 'chown'
        ];
        
        return defineTool('plan_bash_explore', {
            description: 'Execute READ-ONLY bash commands to analyze the environment. Only whitelisted commands are allowed in plan mode.',
            parameters: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: 'The bash command to execute (read-only commands only)'
                    },
                    description: {
                        type: 'string',
                        description: 'Description of what the command does'
                    }
                },
                required: ['command', 'description']
            },
            handler: async (args: { command: string; description: string }) => {
                const command = args.command.trim();
                
                // Check if command starts with a blocked prefix
                for (const blocked of blockedCommandPrefixes) {
                    if (command.startsWith(blocked)) {
                        this.logger.warn(`[Plan Mode] Blocked bash command: ${command}`);
                        return {
                            textResultForLlm: `❌ Command blocked in plan mode: "${command}"\n\nThis command is not allowed because it could modify the system. Plan mode is read-only.\n\nAllowed commands: ${allowedCommandPrefixes.join(', ')}`,
                            resultType: 'denied'
                        };
                    }
                }
                
                // Check if command starts with an allowed prefix
                let isAllowed = false;
                for (const allowed of allowedCommandPrefixes) {
                    if (command.startsWith(allowed)) {
                        isAllowed = true;
                        break;
                    }
                }
                
                if (!isAllowed) {
                    this.logger.warn(`[Plan Mode] Unknown bash command (not in whitelist): ${command}`);
                    return {
                        textResultForLlm: `❌ Command not in whitelist: "${command}"\n\nIn plan mode, only read-only commands are allowed.\n\nAllowed commands: ${allowedCommandPrefixes.join(', ')}`,
                        resultType: 'denied'
                    };
                }
                
                // Command is allowed - execute it
                this.logger.info(`[Plan Mode] Executing allowed bash command: ${command}`);
                
                try {
                    const { exec } = require('child_process');
                    const { promisify } = require('util');
                    const execAsync = promisify(exec);
                    
                    const result = await execAsync(command, {
                        cwd: this.workingDirectory,
                        timeout: 30000, // 30 second timeout
                        maxBuffer: 1024 * 1024 // 1MB buffer
                    });
                    
                    const output = result.stdout + result.stderr;
                    this.logger.info(`[Plan Mode] Bash command completed (${output.length} bytes)`);
                    
                    return {
                        textResultForLlm: output || '(command completed with no output)',
                        resultType: 'success'
                    };
                } catch (error: any) {
                    this.logger.error(`[Plan Mode] Bash command failed:`, error);
                    return {
                        textResultForLlm: `Command failed: ${error.message}\n\nStderr: ${error.stderr || '(none)'}`,
                        resultType: 'failure',
                        error: error.message
                    };
                }
            }
        });
    }
    
    /**
     * Tool 4: create_plan_file
     * Only allows creating the session's plan.md file
     */
    private createRestrictedCreateTool(): any {
        return defineTool('create_plan_file', {
            description: 'Create the session plan.md file. ONLY the session plan.md file can be created in plan mode.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'The path to the file (must be the session plan.md file)'
                    },
                    file_text: {
                        type: 'string',
                        description: 'The content of the plan file'
                    }
                },
                required: ['path', 'file_text']
            },
            handler: async (args: { path: string; file_text?: string }) => {
                const requestedPath = path.resolve(args.path);
                
                // Calculate the session plan path
                const homeDir = require('os').homedir();
                const workSessionPath = path.join(homeDir, '.copilot', 'session-state', this.workSessionId);
                const sessionPlanPath = path.join(workSessionPath, 'plan.md');
                
                // Only allow creating the session's plan.md file
                if (requestedPath !== sessionPlanPath) {
                    this.logger.warn(`[Plan Mode] Blocked create attempt: ${requestedPath}`);
                    return {
                        textResultForLlm: `❌ File creation blocked in plan mode!\n\nYou can ONLY create the session plan file at:\n${sessionPlanPath}\n\nYou attempted to create:\n${requestedPath}\n\nInstead, use the 'update_work_plan' tool to create/update your plan.`,
                        resultType: 'denied'
                    };
                }
                
                // Check if file already exists
                if (fs.existsSync(sessionPlanPath)) {
                    this.logger.warn(`[Plan Mode] Plan file already exists: ${sessionPlanPath}`);
                    return {
                        textResultForLlm: `❌ File already exists: ${sessionPlanPath}\n\nUse 'update_work_plan' tool to update the plan instead.`,
                        resultType: 'denied'
                    };
                }
                
                // Create the plan file
                try {
                    // Ensure session directory exists
                    if (!fs.existsSync(workSessionPath)) {
                        fs.mkdirSync(workSessionPath, { recursive: true });
                        this.logger.info(`[Plan Mode] Created session directory: ${workSessionPath}`);
                    }
                    
                    const content = args.file_text || '';
                    fs.writeFileSync(sessionPlanPath, content, 'utf8');
                    this.logger.info(`[Plan Mode] Created plan file: ${sessionPlanPath}`);
                    
                    return {
                        textResultForLlm: `✅ Plan file created successfully at ${sessionPlanPath}`,
                        resultType: 'success'
                    };
                } catch (error) {
                    this.logger.error(`[Plan Mode] Failed to create plan file:`, error instanceof Error ? error : undefined);
                    return {
                        textResultForLlm: `❌ Error creating plan file: ${error instanceof Error ? error.message : String(error)}`,
                        resultType: 'failure',
                        error: error instanceof Error ? error.message : String(error)
                    };
                }
            }
        });
    }
    
    /**
     * Tool 5: edit_plan_file
     * Only allows editing the session's plan.md file
     */
    private createRestrictedEditTool(): any {
        return defineTool('edit_plan_file', {
            description: 'Edit the session plan.md file. ONLY the session plan.md file can be edited in plan mode.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'The path to the file (must be the session plan.md file)'
                    },
                    old_str: {
                        type: 'string',
                        description: 'The exact string to find and replace'
                    },
                    new_str: {
                        type: 'string',
                        description: 'The new string to replace with'
                    }
                },
                required: ['path', 'old_str', 'new_str']
            },
            handler: async (args: { path: string; old_str: string; new_str: string }) => {
                const requestedPath = path.resolve(args.path);
                
                // Calculate the session plan path
                const homeDir = require('os').homedir();
                const workSessionPath = path.join(homeDir, '.copilot', 'session-state', this.workSessionId);
                const sessionPlanPath = path.join(workSessionPath, 'plan.md');
                
                // Only allow editing the session's plan.md file
                if (requestedPath !== sessionPlanPath) {
                    this.logger.warn(`[Plan Mode] Blocked edit attempt: ${requestedPath}`);
                    return {
                        textResultForLlm: `❌ File editing blocked in plan mode!\n\nYou can ONLY edit the session plan file at:\n${sessionPlanPath}\n\nYou attempted to edit:\n${requestedPath}\n\nUse the 'update_work_plan' tool instead for better control.`,
                        resultType: 'denied'
                    };
                }
                
                // Check if file exists
                if (!fs.existsSync(sessionPlanPath)) {
                    this.logger.warn(`[Plan Mode] Plan file doesn't exist: ${sessionPlanPath}`);
                    return {
                        textResultForLlm: `❌ File doesn't exist: ${sessionPlanPath}\n\nUse 'update_work_plan' or 'create' tool to create the plan first.`,
                        resultType: 'denied'
                    };
                }
                
                // Perform the edit
                try {
                    const content = fs.readFileSync(sessionPlanPath, 'utf-8');
                    
                    // Check if old_str exists in the file
                    if (!content.includes(args.old_str)) {
                        this.logger.warn(`[Plan Mode] String not found in plan file`);
                        return {
                            textResultForLlm: `❌ String not found in plan file.\n\nSearching for:\n${args.old_str.substring(0, 100)}...\n\nConsider using 'update_work_plan' to rewrite the entire plan instead.`,
                            resultType: 'failure'
                        };
                    }
                    
                    // Replace the string
                    const newContent = content.replace(args.old_str, args.new_str);
                    fs.writeFileSync(sessionPlanPath, newContent, 'utf-8');
                    
                    this.logger.info(`[Plan Mode] Edited plan file: ${sessionPlanPath}`);
                    
                    return {
                        textResultForLlm: `✅ Plan file edited successfully at ${sessionPlanPath}`,
                        resultType: 'success'
                    };
                } catch (error) {
                    this.logger.error(`[Plan Mode] Failed to edit plan file:`, error instanceof Error ? error : undefined);
                    return {
                        textResultForLlm: `❌ Error editing plan file: ${error instanceof Error ? error.message : String(error)}`,
                        resultType: 'failure',
                        error: error instanceof Error ? error.message : String(error)
                    };
                }
            }
        });
    }
    
    /**
     * Tool 6: task_agent_type_explore
     * Only allows dispatching "explore" agents
     */
    private createRestrictedTaskTool(): any {
        return defineTool('task_agent_type_explore', {
            description: 'Dispatch a task to a specialized agent. In plan mode, only "explore" agent type is allowed for codebase exploration.',
            parameters: {
                type: 'object',
                properties: {
                    agent_type: {
                        type: 'string',
                        description: 'Type of agent to use (only "explore" allowed in plan mode)'
                    },
                    instruction: {
                        type: 'string',
                        description: 'The task instruction for the agent'
                    }
                },
                required: ['agent_type', 'instruction']
            },
            handler: async (args: { agent_type: string; instruction: string }) => {
                // Only allow explore agent in plan mode
                if (args.agent_type !== 'explore') {
                    this.logger.warn(`[Plan Mode] Blocked task with agent_type: ${args.agent_type}`);
                    return {
                        textResultForLlm: `❌ Agent type "${args.agent_type}" not allowed in plan mode!\n\nOnly "explore" agent is allowed for codebase exploration during planning.\n\nAllowed: task(agent_type="explore", instruction="...")`,
                        resultType: 'denied'
                    };
                }
                
                this.logger.info(`[Plan Mode] Allowing explore task: ${args.instruction.substring(0, 50)}...`);
                
                // The SDK will handle the actual task dispatch
                // We just validate and pass through
                return {
                    textResultForLlm: `✅ Explore task allowed. The SDK will dispatch this to an exploration agent.`,
                    resultType: 'success'
                };
            }
        });
    }
    
    /**
     * Get names of all available tools in plan mode
     * Includes custom tools (6) + whitelisted SDK tools (6)
     * @returns Array of 12 tool names available in plan mode
     */
    getAvailableToolNames(): string[] {
        return [
            // Custom restricted tools (6)
            'plan_bash_explore',           // restricted bash for read-only commands
            'task_agent_type_explore',     // restricted task for exploration only
            'edit_plan_file',              // edit ONLY plan.md
            'create_plan_file',            // create ONLY plan.md
            'update_work_plan',            // update plan content
            'present_plan',                // present plan to user for acceptance
            // Safe SDK tools (6)
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
    getSystemPrompt(workSessionId: string): string {
        const planPath = path.join(
            require('os').homedir(), 
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

**AVAILABLE TOOLS IN PLAN MODE (12 total):**

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
- \`report_intent\` - Report your current intent to the UI

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
    
    /**
     * Cleanup resources
     */
    dispose(): void {
        this.logger.debug(`[PlanModeToolsService] Disposed for session: ${this.workSessionId}`);
    }
}
