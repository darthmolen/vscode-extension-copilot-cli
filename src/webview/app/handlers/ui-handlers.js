/**
 * UI Event Handlers
 * 
 * Extracted event handler functions that can be tested in isolation.
 * These functions were previously inline arrow functions in main.js.
 */

/**
 * Toggles visibility of reasoning messages
 * 
 * @param {boolean} checked - Whether to show reasoning messages
 * @param {HTMLElement} container - Container element with reasoning messages
 * @returns {boolean} - The new state (same as input)
 */
export function handleReasoningToggle(checked, container) {
	container.querySelectorAll('.message.reasoning').forEach(msg => {
		msg.style.display = checked ? 'block' : 'none';
	});
	return checked;
}

/**
 * Handles session selector change
 * Only switches if the selected ID is different from current
 * 
 * @param {string} selectedId - The selected session ID
 * @param {string} currentId - The current session ID
 * @param {Object} rpc - RPC client to call switchSession on
 * @returns {string} - The new session ID (or current if no change)
 */
export function handleSessionChange(selectedId, currentId, rpc) {
	if (selectedId && selectedId !== currentId) {
		rpc.switchSession(selectedId);
		return selectedId;
	}
	return currentId;
}

/**
 * Handles new session button click
 * 
 * @param {Object} rpc - RPC client
 */
export function handleNewSession(rpc) {
	rpc.newSession();
}

/**
 * Handles view plan button click
 * 
 * @param {Object} rpc - RPC client
 */
export function handleViewPlan(rpc) {
	rpc.viewPlan();
}

/**
 * Handles accept plan button click
 * 
 * @param {Object} rpc - RPC client
 */
export function handleAcceptPlan(rpc) {
	console.log('[Plan Mode] Accepting plan');
	rpc.acceptPlan();
}

/**
 * Handles reject plan button click
 * 
 * @param {Object} rpc - RPC client
 */
export function handleRejectPlan(rpc) {
	console.log('[Plan Mode] Rejecting plan');
	rpc.rejectPlan();
}

/**
 * Handles enter plan mode button click
 * 
 * @param {Object} rpc - RPC client
 * @param {Function} updateUICallback - Function to call to update plan mode UI
 * @returns {boolean} - The new plan mode state (true)
 */
export function handleEnterPlanMode(rpc, updateUICallback) {
	console.log('[Plan Mode] Entering plan mode');
	rpc.togglePlanMode(true);
	updateUICallback();
	return true;
}

