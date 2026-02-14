/**
 * Message Input Handlers
 * 
 * Handlers for the main message input area and send functionality.
 */

/**
 * Handles message input changes for auto-resize
 * 
 * @param {HTMLTextAreaElement} textarea - The textarea element
 */
export function handleInputChange(textarea) {
	textarea.style.height = 'auto';
	textarea.style.height = textarea.scrollHeight + 'px';
}

/**
 * Handles attach files button click
 * 
 * @param {Object} rpc - RPC client
 */
export function handleAttachFiles(rpc) {
	rpc.pickFiles();
}

/**
 * Handles send button click (send or abort)
 * 
 * @param {boolean} isThinking - Whether currently generating
 * @param {Object} rpc - RPC client
 * @param {Function} sendCallback - Function to call to send message
 */
export function handleSendButtonClick(isThinking, rpc, sendCallback) {
	if (isThinking) {
		// Abort current generation
		rpc.abortMessage();
	} else {
		// Send message
		sendCallback();
	}
}

/**
 * Handles keydown in message input
 * - Enter (no shift): Send message
 * - Arrow up/down: Navigate history
 * 
 * @param {KeyboardEvent} event - The keyboard event
 * @param {Function} sendCallback - Function to call to send message
 * @param {Function} navigateCallback - Function to call to navigate history (direction)
 */
export function handleMessageKeydown(event, sendCallback, navigateCallback) {
	if (event.key === 'Enter' && !event.shiftKey) {
		event.preventDefault();
		sendCallback();
	} else if (event.key === 'ArrowUp') {
		event.preventDefault();
		navigateCallback('up');
	} else if (event.key === 'ArrowDown') {
		event.preventDefault();
		navigateCallback('down');
	}
}
