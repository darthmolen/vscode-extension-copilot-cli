/**
 * AcceptanceControls Component
 * Manages acceptance input field and control buttons (accept/reject/swap)
 * 
 * Events:
 * - 'accept': Emitted when accept button clicked, passes input value
 * - 'reject': Emitted when reject button clicked, passes input value
 * - 'swap': Emitted when swap button clicked
 */

export class AcceptanceControls {
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
	 * Render the acceptance controls UI
	 */
	render() {
		this.container.innerHTML = `
			<div class="acceptance-controls hidden">
				<textarea 
					class="acceptance-input" 
					placeholder="Enter acceptance criteria..."
					rows="3"
				></textarea>
				<div class="acceptance-buttons">
					<button class="accept-btn">Accept</button>
					<button class="reject-btn">Reject</button>
					<button class="swap-btn" title="Swap original/modified">⇅ Swap</button>
				</div>
			</div>
		`;

		// Cache element references
		this.controlsEl = this.container.querySelector('.acceptance-controls');
		this.inputEl = this.container.querySelector('.acceptance-input');
		this.acceptBtn = this.container.querySelector('.accept-btn');
		this.rejectBtn = this.container.querySelector('.reject-btn');
		this.swapBtn = this.container.querySelector('.swap-btn');
	}

	/**
	 * Attach event listeners to buttons
	 */
	attachEventListeners() {
		this.acceptBtn.addEventListener('click', () => {
			this.emit('accept', this.getValue());
		});

		this.rejectBtn.addEventListener('click', () => {
			this.emit('reject', this.getValue());
		});

		this.swapBtn.addEventListener('click', () => {
			this.emit('swap');
		});
	}

	/**
	 * Show the acceptance controls
	 */
	show() {
		this.controlsEl.classList.remove('hidden');
	}

	/**
	 * Hide the acceptance controls
	 */
	hide() {
		this.controlsEl.classList.add('hidden');
	}

	/**
	 * Get current input value
	 * @returns {string}
	 */
	getValue() {
		return this.inputEl.value;
	}

	/**
	 * Set input value
	 * @param {string} value
	 */
	setValue(value) {
		this.inputEl.value = value;
	}

	/**
	 * Clear input value
	 */
	clear() {
		this.inputEl.value = '';
	}

	/**
	 * Focus the input field
	 */
	focus() {
		this.inputEl.focus();
	}

	/**
	 * Enable/disable all buttons
	 * @param {boolean} disabled
	 */
	setButtonsDisabled(disabled) {
		this.acceptBtn.disabled = disabled;
		this.rejectBtn.disabled = disabled;
		this.swapBtn.disabled = disabled;
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
