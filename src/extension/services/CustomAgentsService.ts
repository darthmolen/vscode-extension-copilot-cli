import * as vscode from 'vscode';
import { CustomAgentDefinition } from '../../shared/models';
import { AgentFileService } from './AgentFileService';

/**
 * SDK-compatible agent config (no builtIn / scope flags)
 */
export interface CustomAgentConfig {
name: string;
displayName?: string;
description?: string;
prompt: string;
tools?: string[] | null;
model?: string;
infer?: boolean;
}

export const BUILT_IN_AGENTS: CustomAgentDefinition[] = [
{
name: 'planner',
displayName: 'Planner',
description: 'Read-only exploration; writes plan.md',
prompt: 'You are a planning agent. Explore the codebase to understand it deeply, then write a comprehensive implementation plan to plan.md. Do not edit source files.',
tools: ['view', 'grep', 'glob', 'plan_bash_explore', 'update_work_plan', 'present_plan', 'create_plan_file', 'edit_plan_file', 'task_agent_type_explore'],
builtIn: true,
},
{
name: 'implementer',
displayName: 'Implementer',
description: 'Executes plan; edits source files',
prompt: 'You are an implementation agent. Read plan.md and implement it faithfully. Follow TDD: write tests first, then implementation.',
tools: null,
builtIn: true,
},
{
name: 'reviewer',
displayName: 'Reviewer',
description: 'Reads and runs tests; posts summary',
prompt: 'You are a code review agent. Run the test suite, read changed files, and produce a concise review summary. Do not modify source files.',
tools: ['view', 'grep', 'glob', 'bash'],
builtIn: true,
},
];

export class CustomAgentsService {
private readonly agentFileService: AgentFileService;

constructor(agentFileService?: AgentFileService) {
this.agentFileService = agentFileService ?? new AgentFileService();
}

private get workspaceRoot(): string | undefined {
return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * Returns all agents: built-ins merged with file-based user agents.
 * If a user agent has the same name as a built-in, the user version wins (but retains builtIn: true).
 */
getAll(): CustomAgentDefinition[] {
const fileAgents = this.agentFileService.getAll(this.workspaceRoot);

const result: CustomAgentDefinition[] = [...BUILT_IN_AGENTS];

for (const fileAgent of fileAgents) {
const idx = result.findIndex(a => a.name === fileAgent.name);
if (idx >= 0) {
// Override built-in — retain builtIn flag
result[idx] = { ...fileAgent, builtIn: result[idx].builtIn };
} else {
result.push(fileAgent);
}
}

return result;
}

/**
 * Saves (upserts) an agent to the global agents directory.
 * Validates name/prompt. Never persists builtIn or scope flags to disk.
 */
async save(agent: CustomAgentDefinition): Promise<void> {
if (!agent.name || !agent.name.trim()) {
throw new Error('Agent name is required');
}
if (!/^[a-z0-9_-]+$/.test(agent.name)) {
throw new Error('Agent name must be lowercase alphanumeric with hyphens or underscores (e.g. my-agent)');
}
if (!agent.prompt || !agent.prompt.trim()) {
throw new Error('Agent prompt is required');
}

// Strip runtime-only flags before writing to disk
const { builtIn: _b, scope: _s, ...agentToSave } = agent;
this.agentFileService.save(agentToSave as CustomAgentDefinition, 'global');
}

/**
 * Deletes a user-defined agent.
 * Throws if the name belongs to a built-in agent.
 */
async delete(name: string): Promise<void> {
if (BUILT_IN_AGENTS.find(a => a.name === name)) {
throw new Error(`Cannot delete built-in agent: ${name}`);
}
this.agentFileService.delete(name, this.workspaceRoot);
}

/**
 * Returns all agents in SDK-compatible format (no builtIn / scope flags).
 */
toSDKAgents(): CustomAgentConfig[] {
return this.getAll().map(agent => {
const { builtIn: _b, scope: _s, ...sdkAgent } = agent;
return sdkAgent as CustomAgentConfig;
});
}
}
