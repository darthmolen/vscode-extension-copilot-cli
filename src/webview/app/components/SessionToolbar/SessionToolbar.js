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
			<div class="session-toolbar">
				<select id="sessionDropdown" class="session-dropdown" aria-label="Select session">
					<!-- Sessions populated dynamically -->
				</select>
				
				<button id="newSessionBtn" class="new-session-btn session-toolbar__btn session-toolbar__btn--new" 
						title="New Session" aria-label="Create new session">+</button>
				
				<button id="viewPlanBtn" class="plan-btn session-toolbar__btn--view-plan" 
						title="View Plan" aria-label="View plan.md file" style="display: none;">📋</button>
				
				<button id="enterPlanModeBtn" class="plan-mode-btn session-toolbar__btn--plan" 
						title="Enter Plan Mode" aria-label="Enter plan mode" style="display: inline-block;">📝 Plan</button>
				
				<button id="acceptPlanBtn" class="plan-mode-btn session-toolbar__btn--accept" 
						title="Accept Plan" aria-label="Accept plan and resume work" style="display: none;">✅ Accept</button>
				
				<button id="rejectPlanBtn" class="plan-mode-btn session-toolbar__btn--reject" 
						title="Reject Plan" aria-label="Reject plan and keep planning" style="display: none;">❌ Reject</button>
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
		viewPlanBtn.addEventListener('click', () => {
			this.emit('viewPlan');
		});
		
		// Enter plan mode button
		const enterBtn = this.container.querySelector('#enterPlanModeBtn');
		enterBtn.addEventListener('click', () => {
			this.emit('togglePlanMode', true);
		});
		
		// Accept plan button
		const acceptBtn = this.container.querySelector('#acceptPlanBtn');
		acceptBtn.addEventListener('click', () => {
			this.emit('acceptPlan');
		});
		
		// Reject plan button
		const rejectBtn = this.container.querySelector('#rejectPlanBtn');
		rejectBtn.addEventListener('click', () => {
			this.emit('rejectPlan');
		});
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
	
	setWorkspacePath(path) {
		this.workspacePath = path;
		const viewPlanBtn = this.container.querySelector('#viewPlanBtn');
		viewPlanBtn.style.display = path ? 'inline-block' : 'none';
	}
	
	setPlanMode(enabled) {
		this.planMode = enabled;
		
		const enterBtn = this.container.querySelector('#enterPlanModeBtn');
		const acceptBtn = this.container.querySelector('#acceptPlanBtn');
		const rejectBtn = this.container.querySelector('#rejectPlanBtn');
		
		if (enabled) {
			// Plan mode: hide enter, show accept/reject
			enterBtn.style.display = 'none';
			acceptBtn.style.display = 'inline-block';
			rejectBtn.style.display = 'inline-block';
		} else {
			// Work mode: show enter, hide accept/reject
			enterBtn.style.display = 'inline-block';
			acceptBtn.style.display = 'none';
			rejectBtn.style.display = 'none';
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
