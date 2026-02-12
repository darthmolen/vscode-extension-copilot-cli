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
		// Command registry: command name -> { event, requiredContext }
		this.commands = new Map([
			['plan', {
				event: 'enterPlanMode',
				requiredContext: { planMode: false }
			}],
			['exit', {
				event: 'exitPlanMode',
				requiredContext: { planMode: true }
			}],
			['accept', {
				event: 'acceptPlan',
				requiredContext: { planMode: true, planReady: true }
			}],
			['reject', {
				event: 'rejectPlan',
				requiredContext: { planMode: true, planReady: true }
			}]
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

		// Emit event with args
		eventBus.emit(commandDef.event, cmd.args);
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
}
