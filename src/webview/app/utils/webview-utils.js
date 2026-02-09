/**
 * Utility Functions for Webview
 * 
 * Shared utility functions used across the webview.
 */

/**
 * Escape HTML to prevent XSS
 * @param {string} unsafe - Unsafe HTML string
 * @returns {string} Escaped HTML string
 */
export function escapeHtml(unsafe) {
	return unsafe
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}
