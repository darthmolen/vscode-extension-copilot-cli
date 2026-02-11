/**
 * SessionToolbar Component
 * 
 * Manages the session toolbar with:
 * - Session dropdown selector
 * - New session button
 * - View plan button
 * - Plan mode buttons (enter/accept/reject)
 * 
 * Events emitted:
 * - 'switchSession': (sessionId) => void
 * - 'newSession': () => void
 * - 'viewPlan': () => void
 * - 'togglePlanMode': (enabled: boolean) => void
 * - 'acceptPlan': () => void
 * - 'rejectPlan': () => void
 */

class SessionToolbar {
	constructor(container) {
		this.container = container;
		this.listeners = new Map();
		this.planMode = false;
		this.workspacePath = null;
		
		this.render();
		this.attachEventListeners();
	}
	
	render() {
		this.container.innerHTML = `
			<div class="header session-toolbar" role="banner">
				<div class="status-indicator session-toolbar__status" id="statusIndicator" role="status" aria-live="polite" aria-label="Connection status"></div>
				<h2 class="session-toolbar__title">Copilot CLI</h2>
				<div class="session-selector session-toolbar__selector-group">
					<label for="sessionDropdown" class="session-toolbar__label">Session:</label>
					<select id="sessionDropdown" class="session-toolbar__select" aria-label="Select session">
						<option value="">No session</option>
					</select>
					<button id="newSessionBtn" class="new-session-btn session-toolbar__btn session-toolbar__btn--new" title="New Session" aria-label="Create new session">+</button>
				</div>
				<button id="viewPlanBtn" class="plan-btn session-toolbar__btn--view-plan disabled" title="View Plan" aria-label="View plan.md file" disabled>📋</button>
			</div>
		`;
	}
	
	attachEventListeners() {
		// Session dropdown change
		const dropdown = this.container.querySelector('#sessionDropdown');
		dropdown.addEventListener('change', (e) => {
			this.emit('switchSession', e.target.value);
		});
		
		// New session button
		const newSessionBtn = this.container.querySelector('#newSessionBtn');
		newSessionBtn.addEventListener('click', () => {
			this.emit('newSession');
		});
		
		// View plan button
		const viewPlanBtn = this.container.querySelector('#viewPlanBtn');
		if (viewPlanBtn) {
			viewPlanBtn.addEventListener('click', () => {
				this.emit('viewPlan');
			});
		}
	}
	
	updateSessions(sessions, currentSessionId) {
		const dropdown = this.container.querySelector('#sessionDropdown');
		dropdown.innerHTML = '';
		
		sessions.forEach(session => {
			const option = document.createElement('option');
			option.value = session.id;
			option.textContent = session.label;
			option.selected = session.id === currentSessionId;
			dropdown.appendChild(option);
		});
	}
	
	setPlanFileExists(exists) {
		const viewPlanBtn = this.container.querySelector('#viewPlanBtn');
		if (exists) {
			viewPlanBtn.disabled = false;
			viewPlanBtn.classList.remove('disabled');
		} else {
			viewPlanBtn.disabled = true;
			viewPlanBtn.classList.add('disabled');
		}
	}
	
	// Event emitter interface
	on(eventName, handler) {
		if (!this.listeners.has(eventName)) {
			this.listeners.set(eventName, []);
		}
		this.listeners.get(eventName).push(handler);
	}
	
	off(eventName, handler) {
		if (!this.listeners.has(eventName)) return;
		
		const handlers = this.listeners.get(eventName);
		const index = handlers.indexOf(handler);
		if (index > -1) {
			handlers.splice(index, 1);
		}
	}
	
	emit(eventName, ...args) {
		if (!this.listeners.has(eventName)) return;
		
		const handlers = this.listeners.get(eventName);
		handlers.forEach(handler => handler(...args));
	}
	
	destroy() {
		this.listeners.clear();
		this.container.innerHTML = '';
	}
}

export { SessionToolbar };
