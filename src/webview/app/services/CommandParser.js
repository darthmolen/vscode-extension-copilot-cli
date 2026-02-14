/**
 * CommandParser Service
 * 
 * Parses, validates, and executes slash commands
 * 
 * Responsibilities:
 * - Parse text input for slash commands
 * - Validate commands against current context (plan mode state)
 * - Execute commands by emitting appropriate events
 * 
 * Usage:
 *   const parser = new CommandParser();
 *   const cmd = parser.parse('/plan');
 *   if (cmd && parser.isValid(cmd, context)) {
 *     parser.execute(cmd, eventBus);
 *   }
 */
export class CommandParser {
	constructor() {
		// Command registry: command name -> { type, event, instruction, requiredContext, category, description }
		this.commands = new Map([
			// Extension commands (10)
			['plan', {
				type: 'extension',
				event: 'enterPlanMode',
				requiredContext: { planMode: false },
				category: 'plan',
				description: 'Enter plan mode'
			}],
			['exit', {
				type: 'extension',
				event: 'exitPlanMode',
				requiredContext: { planMode: true },
				category: 'plan',
				description: 'Exit plan mode'
			}],
			['accept', {
				type: 'extension',
				event: 'acceptPlan',
				requiredContext: { planMode: true, planReady: true },
				category: 'plan',
				description: 'Accept the plan'
			}],
			['reject', {
				type: 'extension',
				event: 'rejectPlan',
				requiredContext: { planMode: true, planReady: true },
				category: 'plan',
				description: 'Reject the plan'
			}],
			['review', {
				type: 'extension',
				event: 'showPlanContent',
				category: 'code',
				description: 'View plan content'
			}],
			['diff', {
				type: 'extension',
				event: 'openDiffView',
				category: 'code',
				description: 'Compare two files'
			}],
			['mcp', {
				type: 'extension',
				event: 'showMcpConfig',
				category: 'config',
				description: 'MCP server config'
			}],
			['usage', {
				type: 'extension',
				event: 'showUsageMetrics',
				category: 'config',
				description: 'Usage metrics'
			}],
			['help', {
				type: 'extension',
				event: 'showHelp',
				category: 'config',
				description: 'Command reference'
			}],
			['model', {
				type: 'extension',
				event: 'showModelSelector',
				category: 'config',
				description: 'Switch model'
			}],

			// CLI Passthrough commands (6)
			['delegate', {
				type: 'passthrough',
				instruction: 'The /delegate command opens GitHub Copilot coding agent in a new PR. Opening terminal...',
				category: 'cli',
				description: 'GitHub Copilot agent'
			}],
			['agent', {
				type: 'passthrough',
				instruction: 'The /agent command lets you select specialized agents (refactoring, code-review, etc.). Opening terminal...',
				category: 'cli',
				description: 'Specialized agents'
			}],
			['skills', {
				type: 'passthrough',
				instruction: 'The /skills command manages custom scripts and resources. Opening terminal...',
				category: 'cli',
				description: 'Custom scripts'
			}],
			['plugin', {
				type: 'passthrough',
				instruction: 'The /plugin command installs extensions from the marketplace. Opening terminal...',
				category: 'cli',
				description: 'Install plugins'
			}],
			['login', {
				type: 'passthrough',
				instruction: 'Opening terminal to authenticate with GitHub Copilot...',
				category: 'cli',
				description: 'Authenticate'
			}],
			['logout', {
				type: 'passthrough',
				instruction: 'Opening terminal to log out of GitHub Copilot...',
				category: 'cli',
				description: 'Log out'
			}],
			
			// Not supported commands (25)
			['clear', { type: 'not-supported' }],
			['new', { type: 'not-supported' }],
			['resume', { type: 'not-supported' }],
			['rename', { type: 'not-supported' }],
			['session', { type: 'not-supported' }],
			['add-dir', { type: 'not-supported' }],
			['list-dirs', { type: 'not-supported' }],
			['cwd', { type: 'not-supported' }],
			['cd', { type: 'not-supported' }],
			['context', { type: 'not-supported' }],
			['compact', { type: 'not-supported' }],
			['lsp', { type: 'not-supported' }],
			['theme', { type: 'not-supported' }],
			['terminal-setup', { type: 'not-supported' }],
			['init', { type: 'not-supported' }],
			['allow-all', { type: 'not-supported' }],
			['yolo', { type: 'not-supported' }],
			['reset-allowed-tools', { type: 'not-supported' }],
			['user', { type: 'not-supported' }],
			['feedback', { type: 'not-supported' }],
			['share', { type: 'not-supported' }],
			['experimental', { type: 'not-supported' }],
			['ide', { type: 'not-supported' }],
			['quit', { type: 'not-supported' }]
		]);
	}

	/**
	 * Parse text for slash command
	 * @param {string} text - User input text
	 * @returns {Object|null} { command: string, args: string[] } or null
	 */
	parse(text) {
		// Validate input
		if (!text || typeof text !== 'string') {
			return null;
		}

		// Must start with slash
		if (!text.startsWith('/')) {
			return null;
		}

		// Split into parts
		const parts = text.trim().split(/\s+/);
		const commandWithSlash = parts[0];

		// Extract command name (remove /)
		const command = commandWithSlash.substring(1).toLowerCase();
		const args = parts.slice(1);

		return { command, args };
	}

	/**
	 * Check if command is registered
	 * @param {string} commandName - Command name (without /)
	 * @returns {boolean}
	 */
	isRegistered(commandName) {
		return this.commands.has(commandName);
	}

	/**
	 * Validate command against current context
	 * @param {Object} cmd - Parsed command { command, args }
	 * @param {Object} context - Current state { planMode, planReady, ... }
	 * @returns {boolean}
	 */
	isValid(cmd, context = {}) {
		if (!cmd || !cmd.command) {
			return false;
		}

		const commandDef = this.commands.get(cmd.command);

		// Unknown commands are not valid
		if (!commandDef) {
			return false;
		}

		// If no context requirements, command is valid
		if (!commandDef.requiredContext) {
			return true;
		}

		// Check all required context conditions
		return Object.entries(commandDef.requiredContext).every(
			([key, expectedValue]) => context[key] === expectedValue
		);
	}

	/**
	 * Execute command by emitting event
	 * @param {Object} cmd - Parsed command { command, args }
	 * @param {EventBus} eventBus - Event bus to emit to
	 */
	execute(cmd, eventBus) {
		if (!cmd || !cmd.command) {
			return;
		}

		const commandDef = this.commands.get(cmd.command);

		if (!commandDef) {
			console.warn(`[CommandParser] Unknown command: ${cmd.command}`);
			return;
		}

		// Route by command type
		switch (commandDef.type) {
			case 'extension':
				eventBus.emit(commandDef.event, cmd.args);
				break;
			case 'passthrough':
				eventBus.emit('openInCLI', [cmd.command, ...cmd.args]);
				break;
			case 'not-supported':
				eventBus.emit('showNotSupported', [cmd.command]);
				break;
			default:
				console.warn(`[CommandParser] Unknown command type: ${commandDef.type}`);
				break;
		}
	}

	/**
	 * Get event name for a command
	 * @param {string} commandName - Command name (without /)
	 * @returns {string|null}
	 */
	getEvent(commandName) {
		const commandDef = this.commands.get(commandName);
		return commandDef ? commandDef.event : null;
	}

	/**
	 * Register a new command (for future extensibility)
	 * @param {string} commandName - Command name (without /)
	 * @param {string} eventName - Event to emit
	 * @param {Object} requiredContext - Context requirements
	 */
	register(commandName, eventName, requiredContext = null) {
		this.commands.set(commandName, {
			event: eventName,
			requiredContext
		});
	}

	/**
	 * Get all registered command names
	 * @returns {string[]}
	 */
	getCommandNames() {
		return Array.from(this.commands.keys());
	}

	/**
	 * Get command type
	 * @param {string} commandName - Command name (without /)
	 * @returns {'extension'|'passthrough'|'not-supported'|null}
	 */
	getCommandType(commandName) {
		if (!commandName) {
			return null;
		}
		
		const commandDef = this.commands.get(commandName);
		return commandDef ? commandDef.type : null;
	}

	/**
	 * Check if command is an extension command
	 * @param {string} commandName - Command name (without /)
	 * @returns {boolean}
	 */
	isExtensionCommand(commandName) {
		return this.getCommandType(commandName) === 'extension';
	}

	/**
	 * Check if command is a passthrough command
	 * @param {string} commandName - Command name (without /)
	 * @returns {boolean}
	 */
	isPassthroughCommand(commandName) {
		return this.getCommandType(commandName) === 'passthrough';
	}

	/**
	 * Check if command is not supported
	 * @param {string} commandName - Command name (without /)
	 * @returns {boolean}
	 */
	isNotSupportedCommand(commandName) {
		return this.getCommandType(commandName) === 'not-supported';
	}

	/**
	 * Get instruction text for passthrough commands
	 * @param {string} commandName - Command name (without /)
	 * @returns {string|null}
	 */
	getInstruction(commandName) {
		const commandDef = this.commands.get(commandName);
		return (commandDef && commandDef.instruction) ? commandDef.instruction : null;
	}

	/**
	 * Get visible commands for the slash command panel
	 * Returns extension and passthrough commands (excludes not-supported)
	 * @returns {Array<{name: string, description: string, category: string}>}
	 */
	getVisibleCommands() {
		const result = [];
		for (const [name, def] of this.commands) {
			if (def.type === 'extension' || def.type === 'passthrough') {
				result.push({
					name,
					description: def.description,
					category: def.category
				});
			}
		}
		return result;
	}
}
