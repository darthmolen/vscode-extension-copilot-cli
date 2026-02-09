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
