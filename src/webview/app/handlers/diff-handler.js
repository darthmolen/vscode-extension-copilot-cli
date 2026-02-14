/**
 * Diff Button Handler
 * 
 * CRITICAL: This is where the Phase 0.2 bug lived.
 * 
 * Phase 0.2 Bug History:
 * - Bug: Only sent { available: true } instead of full diff data
 * - Click handler used payload.data instead of defensive 'data' variable
 * - Result: "Cannot read properties of undefined (reading '0')" on click
 * 
 * These tests ensure we NEVER repeat that bug.
 */

/**
 * Handles diff button click
 * Sends full diff data to extension to open the diff view
 * 
 * @param {Object} diffData - The diff data object
 * @param {string} diffData.beforeUri - URI of the before file
 * @param {string} diffData.afterUri - URI of the after file
 * @param {string} diffData.toolCallId - ID of the tool call (optional)
 * @param {string} diffData.title - Title for the diff view (optional)
 * @param {Object} rpc - RPC client
 */
export function handleDiffButtonClick(diffData, rpc) {
	// CRITICAL: Send FULL diff data, not just a boolean
	// Phase 0.2 bug was sending only { available: diffData.available }
	rpc.viewDiff({
		beforeUri: diffData.beforeUri,
		afterUri: diffData.afterUri,
		toolCallId: diffData.toolCallId,
		title: diffData.title
	});
}
