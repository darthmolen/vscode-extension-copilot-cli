/**
 * Acceptance Control Handlers
 * 
 * Handlers for the acceptance control surface that appears when AI presents a plan.
 * Users can: accept and work, keep planning, or provide alternative instructions.
 */

/**
 * Handles "Accept and Work" button click
 * Accepts the plan and swaps back to regular controls
 * 
 * @param {Object} rpc - RPC client
 * @param {Function} swapControlsCallback - Function to swap back to regular controls
 */
export function handleAcceptAndWork(rpc, swapControlsCallback) {
	console.log('[Acceptance] Accept and work');
	rpc.acceptPlan();
	swapControlsCallback();
}

/**
 * Handles "Keep Planning" button click
 * Dismisses acceptance controls without accepting the plan
 * 
 * @param {Function} swapControlsCallback - Function to swap back to regular controls
 */
export function handleKeepPlanning(swapControlsCallback) {
	console.log('[Acceptance] Keep planning');
	swapControlsCallback();
}

/**
 * Handles keydown events in the acceptance input
 * - Enter (no shift): Send alternative instructions
 * - Escape: Dismiss acceptance controls
 * 
 * @param {KeyboardEvent} event - The keyboard event
 * @param {string} inputValue - Current value of the input
 * @param {Object} rpc - RPC client
 * @param {Object} callbacks - Object with clearInput and swapControls functions
 */
export function handleAcceptanceKeydown(event, inputValue, rpc, callbacks) {
	if (event.key === 'Enter' && !event.shiftKey) {
		event.preventDefault();
		const instructions = inputValue.trim();
		if (instructions) {
			console.log('[Acceptance] Sending alternative instructions:', instructions);
			rpc.sendMessage(instructions);
			callbacks.clearInput();
			callbacks.swapControls();
		}
	} else if (event.key === 'Escape') {
		callbacks.swapControls();
	}
}
