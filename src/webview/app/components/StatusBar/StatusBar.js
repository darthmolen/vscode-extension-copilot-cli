/**
 * StatusBar Component
 * Manages reasoning indicator, reasoning toggle checkbox, and usage statistics
 * 
 * Events:
 * - 'reasoningToggle': Emitted when reasoning checkbox is toggled, passes boolean checked state
 */

export class StatusBar {
	/**
	 * @param {HTMLElement} container - Parent element to render into
	 */
	constructor(container) {
		this.container = container;
		this.eventHandlers = {};
		this.render();
		this.attachEventListeners();
	}

	/**
	 * Render the status bar UI
	 */
	render() {
		this.container.innerHTML = `
			<div class="status-bar">
				<span id="reasoningIndicator" class="reasoning-indicator" style="display: none;">
					🧠 <span id="reasoningText">Reasoning...</span>
				</span>
				<span id="reasoningSeparator" class="control-separator" style="display: none;">|</span>
				<div class="usage-group">
					<span class="usage-info">
						<span id="usageWindow" title="context window usage percentage">Window: 0%</span>
						<span> | </span>
						<span id="usageUsed" title="tokens used this session">Used: 0</span>
						<span> | </span>
						<span id="usageRemaining" title="remaining requests for account">Remaining: --</span>
					</span>
				</div>
			</div>
		`;

		// Cache element references
		this.statusBarEl = this.container.querySelector('.status-bar');
		this.reasoningIndicator = this.container.querySelector('.reasoning-indicator');
		this.reasoningSeparator = this.container.querySelector('#reasoningSeparator');
		this.reasoningText = this.container.querySelector('#reasoningText');
		this.usageWindow = this.container.querySelector('#usageWindow');
		this.usageUsed = this.container.querySelector('#usageUsed');
		this.usageRemaining = this.container.querySelector('#usageRemaining');
	}

	/**
	 * Attach event listeners
	 */
	attachEventListeners() {
		// No event listeners needed - reasoning checkbox moved to InputArea
	}

	/**
	 * Show reasoning indicator
	 */
	showReasoning() {
		this.reasoningIndicator.style.display = '';
		this.reasoningSeparator.style.display = '';
	}

	/**
	 * Hide reasoning indicator
	 */
	hideReasoning() {
		this.reasoningIndicator.style.display = 'none';
		this.reasoningSeparator.style.display = 'none';
	}

	/**
	 * Set reasoning indicator text
	 * @param {string} text
	 */
	setReasoningText(text) {
		this.reasoningText.textContent = text;
	}

	/**
	 * Check if reasoning is enabled
	 * @returns {boolean}
	 */
	isReasoningEnabled() {
		return this.reasoningCheckbox.checked;
	}

	/**
	 * Set reasoning checkbox state
	 * @param {boolean} enabled
	 */
	setReasoningEnabled(enabled) {
		this.reasoningCheckbox.checked = enabled;
	}

	/**
	 * Update usage window display
	 * @param {number} percentage - Window usage percentage
	 * @param {number} used - Tokens used
	 * @param {number} limit - Token limit
	 */
	updateUsageWindow(percentage, used, limit) {
		this.usageWindow.textContent = `Window: ${percentage}%`;
		this.usageWindow.title = `context window usage: ${used.toLocaleString()} / ${limit.toLocaleString()} tokens`;
	}

	/**
	 * Update usage used display
	 * @param {number} tokens - Number of tokens used
	 */
	updateUsageUsed(tokens) {
		const compact = this.formatCompact(tokens);
		this.usageUsed.textContent = `Used: ${compact}`;
	}

	/**
	 * Update usage remaining display
	 * @param {number|null} remaining - Remaining requests, or null for unknown
	 */
	updateUsageRemaining(remaining) {
		if (remaining === null || remaining === undefined) {
			this.usageRemaining.textContent = 'Remaining: --';
		} else {
			this.usageRemaining.textContent = `Remaining: ${remaining}`;
		}
	}

	/**
	 * Format large numbers in compact notation
	 * @param {number} num
	 * @returns {string}
	 */
	formatCompact(num) {
		if (num >= 1000000) {
			return (num / 1000000).toFixed(1) + 'M';
		} else if (num >= 1000) {
			return (num / 1000).toFixed(1) + 'K';
		}
		return num.toString();
	}

	/**
	 * Add event listener
	 * @param {string} event
	 * @param {Function} handler
	 */
	on(event, handler) {
		if (!this.eventHandlers[event]) {
			this.eventHandlers[event] = [];
		}
		this.eventHandlers[event].push(handler);
	}

	/**
	 * Remove event listener
	 * @param {string} event
	 * @param {Function} handler
	 */
	off(event, handler) {
		if (!this.eventHandlers[event]) return;
		this.eventHandlers[event] = this.eventHandlers[event].filter(h => h !== handler);
	}

	/**
	 * Emit event to all listeners
	 * @param {string} event
	 * @param {...any} args
	 */
	emit(event, ...args) {
		if (!this.eventHandlers[event]) return;
		this.eventHandlers[event].forEach(handler => handler(...args));
	}

	/**
	 * Clean up component
	 */
	destroy() {
		this.eventHandlers = {};
		this.container.innerHTML = '';
	}
}
