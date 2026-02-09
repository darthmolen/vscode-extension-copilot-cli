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

