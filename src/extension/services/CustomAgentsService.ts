import * as vscode from 'vscode';
import { CustomAgentDefinition } from '../../shared/models';

/**
 * SDK-compatible agent config (no builtIn flag)
 */
export interface CustomAgentConfig {
	name: string;
	displayName?: string;
	description?: string;
	prompt: string;
	tools?: string[] | null;
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
	/**
	 * Returns all agents: built-ins merged with user-defined workspace config agents.
	 * If a user agent has the same name as a built-in, the user version wins (but retains builtIn: true).
	 */
	getAll(): CustomAgentDefinition[] {
		const userAgents: CustomAgentDefinition[] = vscode.workspace
			.getConfiguration('copilotCLI')
			.get<CustomAgentDefinition[]>('customAgents', []);

		const result: CustomAgentDefinition[] = [...BUILT_IN_AGENTS];

		for (const userAgent of userAgents) {
			const idx = result.findIndex(a => a.name === userAgent.name);
			if (idx >= 0) {
				// Override built-in — retain builtIn flag
				result[idx] = { ...userAgent, builtIn: result[idx].builtIn };
			} else {
				result.push(userAgent);
			}
		}

		return result;
	}

	/**
	 * Saves (upserts) an agent to workspace configuration.
	 * Throws if the name is empty/whitespace, not slug-format, or prompt is empty.
	 * The builtIn flag is never persisted to config.
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

		const config = vscode.workspace.getConfiguration('copilotCLI');
		const current: CustomAgentDefinition[] = config.get<CustomAgentDefinition[]>('customAgents', []);

		// Strip builtIn from what we persist
		const { builtIn: _, ...agentToSave } = agent;

		const idx = current.findIndex(a => a.name === agent.name);
		let updated: CustomAgentDefinition[];
		if (idx >= 0) {
			updated = [...current];
			updated[idx] = agentToSave as CustomAgentDefinition;
		} else {
			updated = [...current, agentToSave as CustomAgentDefinition];
		}

		// ConfigurationTarget.Global (true) is intentional: copilotCLI.customAgents is
		// window-scoped in package.json, making agents available across all workspaces.
		await config.update('customAgents', updated, true);
	}

	/**
	 * Deletes a user-defined agent from workspace configuration.
	 * Throws if the name belongs to a built-in agent.
	 */
	async delete(name: string): Promise<void> {
		if (BUILT_IN_AGENTS.find(a => a.name === name)) {
			throw new Error(`Cannot delete built-in agent: ${name}`);
		}

		const config = vscode.workspace.getConfiguration('copilotCLI');
		const current: CustomAgentDefinition[] = config.get<CustomAgentDefinition[]>('customAgents', []);
		const updated = current.filter(a => a.name !== name);
		// ConfigurationTarget.Global (true) is intentional — see save() comment.
		await config.update('customAgents', updated, true);
	}

	/**
	 * Returns all agents in SDK-compatible format (no builtIn flag).
	 */
	toSDKAgents(): CustomAgentConfig[] {
		return this.getAll().map(agent => {
			const { builtIn: _, ...sdkAgent } = agent;
			return sdkAgent as CustomAgentConfig;
		});
	}
}
