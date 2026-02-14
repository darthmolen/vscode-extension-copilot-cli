/**
 * Webview RPC Client
 * 
 * Provides type-safe message passing from webview to extension.
 * Handles registration of handlers for incoming extension messages.
 * 
 * This is JavaScript (not TypeScript) because it runs in the webview context.
 */

/**
 * Webview RPC Client
 * 
 * Manages type-safe bidirectional communication between webview and extension.
 */
class WebviewRpcClient {
	constructor() {
		// Acquire VS Code API
		// @ts-ignore - acquireVsCodeApi is provided by VS Code webview
		this.vscode = acquireVsCodeApi();
		
		// Handler registry
		this.handlers = new Map();
		
		// Message tracking for debugging
		this.incomingMessageCount = 0;
		this.outgoingMessageCount = 0;
		this.messageCountByType = new Map();
		this.lastReportedAt = 0;
		this.REPORT_INTERVAL = 100; // Log every 100 messages
		
		// Set up message listener
		window.addEventListener('message', (event) => {
			const message = event.data;
			this._handleMessage(message);
		});
	}
	
	// ========================================================================
	// Send Methods (Webview → Extension)
	// ========================================================================
	
	/**
	 * Send user message to agent
	 * @param {string} text - Message text
	 * @param {Array<{type: string, path: string, displayName?: string}>} [attachments] - File attachments
	 */
	sendMessage(text, attachments = []) {
		this._send({
			type: 'sendMessage',
			text,
			attachments
		});
	}
	
	/**
	 * Abort current agent stream
	 */
	abortMessage() {
		this._send({
			type: 'abortMessage'
		});
	}
	
	/**
	 * Notify extension that webview is ready
	 */
	ready() {
		this._send({
			type: 'ready'
		});
	}
	
	/**
	 * Switch to different session
	 * @param {string} sessionId - Session ID to switch to
	 */
	switchSession(sessionId) {
		this._send({
			type: 'switchSession',
			sessionId
		});
	}
	
	/**
	 * Create new session
	 */
	newSession() {
		this._send({
			type: 'newSession'
		});
	}
	
	/**
	 * Open plan file in editor
	 */
	viewPlan() {
		this._send({
			type: 'viewPlan'
		});
	}
	
	/**
	 * Show diff view
	 * @param {{originalPath: string, modifiedPath: string, title?: string}} data - Diff data
	 */
	viewDiff(data) {
		this._send({
			type: 'viewDiff',
			data
		});
	}
	
	/**
	 * Toggle plan mode on/off
	 * @param {boolean} enabled - Enable or disable plan mode
	 */
	togglePlanMode(enabled) {
		this._send({
			type: 'togglePlanMode',
			enabled
		});
	}
	
	/**
	 * User accepted plan
	 */
	acceptPlan() {
		this._send({
			type: 'acceptPlan'
		});
	}
	
	/**
	 * User rejected plan
	 */
	rejectPlan() {
		this._send({
			type: 'rejectPlan'
		});
	}
	
	/**
	 * Open file picker for attachments
	 */
	pickFiles() {
		this._send({
			type: 'pickFiles'
		});
	}
	
	/**
	 * Show plan content (/review command)
	 */
	showPlanContent() {
		this._send({
			type: 'showPlanContent'
		});
	}
	
	/**
	 * Open diff view (/diff command)
	 * @param {string} file1 - First file path
	 * @param {string} file2 - Second file path
	 */
	openDiffView(file1, file2) {
		this._send({
			type: 'openDiffView',
			file1,
			file2
		});
	}
	
	/**
	 * Show MCP configuration (/mcp command)
	 */
	showMcpConfig() {
		this._send({
			type: 'showMcpConfig'
		});
	}
	
	/**
	 * Show usage metrics (/usage command)
	 */
	showUsageMetrics() {
		this._send({
			type: 'showUsageMetrics'
		});
	}
	
	/**
	 * Show help documentation (/help command)
	 * @param {string} [command] - Optional specific command to get help for
	 */
	showHelp(command) {
		this._send({
			type: 'showHelp',
			command
		});
	}
	
	/**
	 * Show not supported message
	 * @param {string} command - Command name that's not supported
	 */
	showNotSupported(command) {
		this._send({
			type: 'showNotSupported',
			command
		});
	}
	
	/**
	 * Open command in CLI terminal (passthrough)
	 * @param {string} command - Full command to pass through
	 */
	openInCLI(command) {
		this._send({
			type: 'openInCLI',
			command
		});
	}
	
	// ========================================================================
	// Receive Handlers (Extension → Webview)
	// ========================================================================
	
	/**
	 * Register handler for init message
	 * @param {Function} handler - Handler function
	 * @returns {{dispose: Function}} Disposable subscription
	 */
	onInit(handler) {
		return this._registerHandler('init', handler);
	}
	
	/**
	 * Register handler for userMessage
	 * @param {Function} handler - Handler function
	 * @returns {{dispose: Function}} Disposable subscription
	 */
	onUserMessage(handler) {
		return this._registerHandler('userMessage', handler);
	}
	
	/**
	 * Register handler for assistantMessage
	 * @param {Function} handler - Handler function
	 * @returns {{dispose: Function}} Disposable subscription
	 */
	onAssistantMessage(handler) {
		return this._registerHandler('assistantMessage', handler);
	}
	
	/**
	 * Register handler for reasoningMessage
	 * @param {Function} handler - Handler function
	 * @returns {{dispose: Function}} Disposable subscription
	 */
	onReasoningMessage(handler) {
		return this._registerHandler('reasoningMessage', handler);
	}
	
	/**
	 * Register handler for toolStart
	 * @param {Function} handler - Handler function
	 * @returns {{dispose: Function}} Disposable subscription
	 */
	onToolStart(handler) {
		return this._registerHandler('toolStart', handler);
	}
	
	/**
	 * Register handler for toolUpdate
	 * @param {Function} handler - Handler function
	 * @returns {{dispose: Function}} Disposable subscription
	 */
	onToolUpdate(handler) {
		return this._registerHandler('toolUpdate', handler);
	}
	
	/**
	 * Register handler for streamChunk
	 * @param {Function} handler - Handler function
	 * @returns {{dispose: Function}} Disposable subscription
	 */
	onStreamChunk(handler) {
		return this._registerHandler('streamChunk', handler);
	}
	
	/**
	 * Register handler for streamEnd
	 * @param {Function} handler - Handler function
	 * @returns {{dispose: Function}} Disposable subscription
	 */
	onStreamEnd(handler) {
		return this._registerHandler('streamEnd', handler);
	}
	
	/**
	 * Register handler for clearMessages
	 * @param {Function} handler - Handler function
	 * @returns {{dispose: Function}} Disposable subscription
	 */
	onClearMessages(handler) {
		return this._registerHandler('clearMessages', handler);
	}
	
	/**
	 * Register handler for sessionStatus
	 * @param {Function} handler - Handler function
	 * @returns {{dispose: Function}} Disposable subscription
	 */
	onSessionStatus(handler) {
		return this._registerHandler('sessionStatus', handler);
	}
	
	/**
	 * Register handler for updateSessions
	 * @param {Function} handler - Handler function
	 * @returns {{dispose: Function}} Disposable subscription
	 */
	onUpdateSessions(handler) {
		return this._registerHandler('updateSessions', handler);
	}
	
	/**
	 * Register handler for thinking
	 * @param {Function} handler - Handler function
	 * @returns {{dispose: Function}} Disposable subscription
	 */
	onThinking(handler) {
		return this._registerHandler('thinking', handler);
	}
	
	/**
	 * Register handler for resetPlanMode
	 * @param {Function} handler - Handler function
	 * @returns {{dispose: Function}} Disposable subscription
	 */
	onResetPlanMode(handler) {
		return this._registerHandler('resetPlanMode', handler);
	}
	
	/**
	 * Register handler for workspacePath
	 * @param {Function} handler - Handler function
	 * @returns {{dispose: Function}} Disposable subscription
	 */
	onWorkspacePath(handler) {
		return this._registerHandler('workspacePath', handler);
	}
	
	/**
	 * Register handler for activeFileChanged
	 * @param {Function} handler - Handler function
	 * @returns {{dispose: Function}} Disposable subscription
	 */
	onActiveFileChanged(handler) {
		return this._registerHandler('activeFileChanged', handler);
	}
	
	/**
	 * Register handler for diffAvailable
	 * @param {Function} handler - Handler function
	 * @returns {{dispose: Function}} Disposable subscription
	 */
	onDiffAvailable(handler) {
		return this._registerHandler('diffAvailable', handler);
	}
	
	/**
	 * Register handler for appendMessage
	 * @param {Function} handler - Handler function
	 * @returns {{dispose: Function}} Disposable subscription
	 */
	onAppendMessage(handler) {
		return this._registerHandler('appendMessage', handler);
	}
	
	/**
	 * Register handler for attachmentValidation
	 * @param {Function} handler - Handler function
	 * @returns {{dispose: Function}} Disposable subscription
	 */
	onAttachmentValidation(handler) {
		return this._registerHandler('attachmentValidation', handler);
	}
	
	/**
	 * Register handler for status
	 * @param {Function} handler - Handler function
	 * @returns {{dispose: Function}} Disposable subscription
	 */
	onStatus(handler) {
		return this._registerHandler('status', handler);
	}
	
	/**
	 * Register handler for filesSelected
	 * @param {Function} handler - Handler function
	 * @returns {{dispose: Function}} Disposable subscription
	 */
	onFilesSelected(handler) {
		return this._registerHandler('filesSelected', handler);
	}
	
	/**
	 * Register handler for usage_info
	 * @param {Function} handler - Handler function
	 * @returns {{dispose: Function}} Disposable subscription
	 */
	onUsageInfo(handler) {
		return this._registerHandler('usage_info', handler);
	}
	
	// ========================================================================
	// Private Methods
	// ========================================================================
	
	/**
	 * Send message to extension
	 * @private
	 * @param {Object} message - Message to send
	 */
	_send(message) {
		// Track outgoing messages
		this.outgoingMessageCount++;
		this._trackMessageType(`OUT:${message.type}`);
		
		// Report periodically
		if (this.outgoingMessageCount % this.REPORT_INTERVAL === 0) {
			this._reportMessageStats('OUTGOING');
		}
		
		this.vscode.postMessage(message);
	}
	
	/**
	 * Register a message handler
	 * @private
	 * @param {string} type - Message type
	 * @param {Function} handler - Handler function
	 * @returns {{dispose: Function}} Disposable subscription
	 */
	_registerHandler(type, handler) {
		// Allow multiple handlers per type (all will be called)
		if (!this.handlers.has(type)) {
			this.handlers.set(type, []);
		}
		
		this.handlers.get(type).push(handler);
		
		return {
			dispose: () => {
				const handlers = this.handlers.get(type);
				if (handlers) {
					const index = handlers.indexOf(handler);
					if (index > -1) {
						handlers.splice(index, 1);
					}
				}
			}
		};
	}
	
	/**
	 * Handle incoming message from extension
	 * @private
	 * @param {Object} message - Message from extension
	 */
	_handleMessage(message) {
		if (!message || !message.type) {
			console.warn('Received invalid message:', message);
			return;
		}
		
		// Track incoming messages
		this.incomingMessageCount++;
		this._trackMessageType(`IN:${message.type}`);
		
		// Report periodically
		if (this.incomingMessageCount % this.REPORT_INTERVAL === 0) {
			this._reportMessageStats('INCOMING');
		}
		
		const handlers = this.handlers.get(message.type);
		if (handlers && handlers.length > 0) {
			for (const handler of handlers) {
				try {
					handler(message);
				} catch (error) {
					console.error(`Error in handler for ${message.type}:`, error);
				}
			}
		}
	}
	
	/**
	 * Track message type count
	 * @private
	 * @param {string} type - Message type
	 */
	_trackMessageType(type) {
		const count = this.messageCountByType.get(type) || 0;
		this.messageCountByType.set(type, count + 1);
	}
	
	/**
	 * Report message statistics
	 * @private
	 * @param {'INCOMING' | 'OUTGOING'} direction - Direction of messages
	 */
	_reportMessageStats(direction) {
		const now = Date.now();
		const timeSinceLastReport = now - this.lastReportedAt;
		
		console.log('='.repeat(80));
		console.log(`[MESSAGE DEBUG - WEBVIEW] ${direction} Message Stats`);
		console.log(`Total incoming: ${this.incomingMessageCount}`);
		console.log(`Total outgoing: ${this.outgoingMessageCount}`);
		console.log(`Time since last report: ${timeSinceLastReport}ms`);
		console.log('Breakdown by type:');
		
		// Sort by count descending
		const sortedTypes = Array.from(this.messageCountByType.entries())
			.sort((a, b) => b[1] - a[1]);
		
		for (const [type, count] of sortedTypes) {
			console.log(`  ${type}: ${count}`);
		}
		
		console.log('='.repeat(80));
		this.lastReportedAt = now;
	}
	
	/**
	 * Get current message statistics (useful for manual inspection)
	 * @returns {{incoming: number, outgoing: number, byType: Map<string, number>}}
	 */
	getMessageStats() {
		return {
			incoming: this.incomingMessageCount,
			outgoing: this.outgoingMessageCount,
			byType: new Map(this.messageCountByType)
		};
	}
}

// ES6 export for use in webview modules
export { WebviewRpcClient };
