Complete Event Flow Stack - SDK through to Webview Chat UI
Here's the full architecture for adding a new event from SDK through to the webview:

1. SDK SESSION MANAGER - Event Subscription Pattern
File: /home/smolen/dev/vscode-copilot-cli-extension/src/sdkSessionManager.ts

Event subscription setup (line 670-675):

private setupSessionEventHandlers(): void {
    if (!this.session) { return; }
    this._sessionSub.value = toDisposable(
        this.session.on((event: any) => this._handleSDKEvent(event))
    );
}
Event handler switch statement (line 677-900): Shows examples of how SDK events are processed:

Line 753: case 'session.error': → fires _onDidReceiveError event
Line 757-761: case 'session.start'/'session.resume'/'session.idle' → logged only
Line 764-773: case 'assistant.turn_start'/'turn_end' → fires _onDidChangeStatus event
Line 775-789: case 'session.usage_info' → fires _onDidUpdateUsage event
Example: Model change event (line 833-840):

case 'session.model_change':
    this.logger.info(`[SDK Event] Model changed to ${event.data.newModel}`);
    this._onDidChangeStatus.fire({ 
        status: 'model_switched', 
        model: event.data.newModel 
    });
    break;
Pattern: SDK emits → handler extracts data → fires internal _onDid* event emitter

2. MESSAGE TYPE DEFINITIONS
File: /home/smolen/dev/vscode-copilot-cli-extension/src/shared/messages.ts

Extension → Webview Message Types (line 315-343):

export type ExtensionMessageType =
    | 'init'
    | 'userMessage'
    | 'assistantMessage'
    | 'reasoningMessage'
    | 'toolStart'
    | 'toolUpdate'
    | 'streamChunk'
    | 'streamEnd'
    | 'clearMessages'
    | 'sessionStatus'
    | 'updateSessions'
    | 'thinking'
    | 'resetPlanMode'
    | 'workspacePath'
    | 'activeFileChanged'
    | 'diffAvailable'
    | 'appendMessage'
    | 'attachmentValidation'
    | 'status'           // ← General status updates
    | 'usage_info'
    | 'modelSwitched'
    | 'currentModel'
    | 'availableModels'
    | 'taskComplete'
    | 'messageDelta'
    | 'reasoningDelta'
    | 'customAgentsChanged'
    | 'activeAgentChanged';
Sample message payload definitions:

Line 538-541 - Status (generic):
export interface StatusPayload extends BaseMessage {
    type: 'status';
    message: string;
}
Line 456-459 - Session Status:
export interface SessionStatusPayload extends BaseMessage {
    type: 'sessionStatus';
    active: boolean;
}
Line 473-476 - Thinking indicator:
export interface ThinkingPayload extends BaseMessage {
    type: 'thinking';
    isThinking: boolean;
}
Line 546-549 - Usage Info:
export interface UsageInfoPayload extends BaseMessage {
    type: 'usage_info';
    usage: UsageInfo;
}
Line 554-558 - Model Switched:
export interface ModelSwitchedPayload extends BaseMessage {
    type: 'modelSwitched';
    model: string;
    success: boolean;
}
3. EXTENSION RPC ROUTER - Send Methods
File: /home/smolen/dev/vscode-copilot-cli-extension/src/extension/rpc/ExtensionRpcRouter.ts

Send method pattern example (line 326-332):

/**
 * General status update
 */
setStatus(statusMessage: string): void {
    const message: StatusPayload = {
        type: 'status',
        message: statusMessage
    };
    this.send(message);
}
More send method examples:

Line 217-223 - Session Active:
setSessionActive(active: boolean): void {
    const message: SessionStatusPayload = {
        type: 'sessionStatus',
        active
    };
    this.send(message);
}
Line 240-246 - Thinking:
setThinking(isThinking: boolean): void {
    const message: ThinkingPayload = {
        type: 'thinking',
        isThinking
    };
    this.send(message);
}
Line 337-343 - Usage Info:
setUsageInfo(usage: UsageInfo): void {
    const message: UsageInfoPayload = {
        type: 'usage_info',
        usage
    };
    this.send(message);
}
Line 348-355 - Model Switched:
sendModelSwitched(model: string, success: boolean): void {
    const message: ModelSwitchedPayload = {
        type: 'modelSwitched',
        model,
        success
    };
    this.send(message);
}
Internal send method (line 685-696):

private send(message: ExtensionMessage): void {
    // Track outgoing messages
    this.outgoingMessageCount++;
    this.trackMessageType(`OUT:${message.type}`);
    
    // Report periodically
    if (this.outgoingMessageCount % this.REPORT_INTERVAL === 0) {
        this.reportMessageStats('OUTGOING');
    }
    
    this.webview.postMessage(message);
}
4. CHAT VIEW PROVIDER - Listening & Forwarding
File: /home/smolen/dev/vscode-copilot-cli-extension/src/chatViewProvider.ts

RPC Router setup (line 137-425): Creates router, registers handlers for webview→extension messages, and calls .listen() to start routing.

Public methods that forward to RPC (examples):

Line 502-505 - Session Active:
public setSessionActive(active: boolean) {
    this.isSessionActive = active;
    this.rpcRouter?.setSessionActive(active);
}
Line 507-509 - Thinking:
public setThinking(isThinking: boolean) {
    this.rpcRouter?.setThinking(isThinking);
}
Line 446-460 - Assistant Message:
public addAssistantMessage(text: string, messageId?: string, storeInBackend: boolean = true) {
    if (storeInBackend) {
        const backendState = getBackendState();
        backendState.addMessage({
            role: 'assistant',
            type: 'assistant',
            content: text,
            timestamp: Date.now()
        });
    }

    // Resolve relative image paths in markdown to webview URIs
    const resolvedText = this._resolveAssistantImagePaths(text);
    this.rpcRouter?.addAssistantMessage(resolvedText, messageId);
}
How SDK events flow to RPC: File: /home/smolen/dev/vscode-copilot-cli-extension/src/extension.ts (line 528-606)

Subscription wire-up (line 546-606):

context.subscriptions.push(manager.onDidChangeStatus(safeHandler('onDidChangeStatus', (statusData) => {
    logger.info(`[CLI Status] ${JSON.stringify(statusData)}`);
    switch (statusData.status) {
        case 'thinking':
            chatProvider.setThinking(true);
            break;
        case 'ready':
            chatProvider.setThinking(false);
            break;
        case 'plan_mode_enabled':
        case 'plan_mode_disabled':
            chatProvider.postMessage({ type: 'status', data: statusData });
            updateSessionsList();
            break;
        case 'plan_accepted':
            chatProvider.postMessage({ type: 'status', data: statusData });
            chatProvider.setThinking(true);
            break;
        case 'plan_rejected':
            chatProvider.postMessage({ type: 'status', data: statusData });
            break;
        case 'plan_ready':
            chatProvider.postMessage({ type: 'status', data: statusData });
            viewPlanFile();
            break;
        case 'reset_metrics':
            chatProvider.postMessage({ type: 'status', data: statusData });
            break;
        case 'model_switched':
            backendState.setCurrentModel(statusData.model || null);
            chatProvider.sendModelSwitched(statusData.model || '', true);
            break;
        // ... more cases
    }
})));
5. WEBVIEW RPC CLIENT - Message Receiving
File: /home/smolen/dev/vscode-copilot-cli-extension/src/webview/app/rpc/WebviewRpcClient.js

Handler registration pattern (line 330-349):

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
More handler examples:

Line 412-414: onSessionStatus(handler)
Line 493-495: onStatus(handler) ← Generic status
Line 511-513: onUsageInfo(handler)
Line 520-522: onModelSwitched(handler)
Message receiving (line 642-667):

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
Handler registration (line 616-635):

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
6. WEBVIEW MAIN.JS - Handler Registration & EventBus Emission
File: /home/smolen/dev/vscode-copilot-cli-extension/src/webview/main.js

RPC client initialization (line 1-50):

// Initialize RPC client
const rpc = new WebviewRpcClient();

// Create EventBus for component communication
const eventBus = new EventBus();

// Initialize components
const messagesContainer = document.getElementById('messages-mount');
const messageDisplay = new MessageDisplay(messagesContainer, eventBus);
Status message handler (line 487-541):

export function handleStatusMessage(payload) {
    const status = payload.data.status;
    console.log('[STATUS EVENT] Received status:', status, 'Full data:', payload.data);
    
    // Handle metrics reset
    if (payload.data.resetMetrics) {
        const postTokens = payload.data.postCompactionTokens;
        if (postTokens !== undefined && postTokens > 0 && lastTokenLimit > 0) {
            // Compaction reset: show post-compaction values, not zero
            const windowPct = Math.round((postTokens / lastTokenLimit) * 100);
            console.log(`[METRICS] Compaction reset: ${postTokens} tokens, ${windowPct}% window`);
            inputArea.updateUsageWindow(windowPct, postTokens, lastTokenLimit);
            inputArea.updateUsageUsed(postTokens);
        } else {
            // New session reset: zero out
            console.log('[METRICS] Resetting session-level metrics');
            inputArea.updateUsageWindow(0, 0, 1);
            inputArea.updateUsageUsed(0);
        }
    }
    
    if (status === 'plan_mode_enabled') {
        console.log('[STATUS EVENT] Enabling plan mode UI');
        planMode = true;
        planReady = false;
        updatePlanModeUI();
        // Show acceptance controls when entering plan mode
        acceptanceControls.show();
    } else if (status === 'plan_mode_disabled' || status === 'plan_accepted' || status === 'plan_rejected') {
        console.log('[STATUS EVENT] Disabling plan mode UI, reason:', status);
        planMode = false;
        planReady = false;
        updatePlanModeUI();
        acceptanceControls.hide();
        acceptanceControls.clear();
        
        // Show notification
        if (status === 'plan_accepted') {
            console.log('✅ Plan accepted! Ready to implement.');
        } else if (status === 'plan_rejected') {
            console.log('❌ Plan rejected. Changes discarded.');
        }
    } else if (status === 'thinking') {
        isReasoning = true;
    } else if (status === 'ready') {
        isReasoning = false;
    } else if (status === 'plan_ready') {
        // Plan is ready for user review - show acceptance controls
        console.log('[Plan Ready] Showing acceptance controls');
        planReady = true;
        inputArea.setPlanMode(planMode, true);
        acceptanceControls.show();
        acceptanceControls.focus();
    }
}
Handler registrations (line 644-690):

rpc.onThinking(handleThinkingMessage);
rpc.onSessionStatus(handleSessionStatusMessage);
rpc.onAppendMessage(handleAppendMessageMessage);
rpc.onUserMessage(handleUserMessageMessage);
rpc.onAssistantMessage(handleAssistantMessageMessage);
rpc.onReasoningMessage(handleReasoningMessageMessage);
rpc.onWorkspacePath(handleWorkspacePathMessage);
rpc.onActiveFileChanged(handleActiveFileChangedMessage);
rpc.onClearMessages(handleClearMessagesMessage);
rpc.onUpdateSessions(handleUpdateSessionsMessage);
rpc.onToolStart(handleToolStartMessage);
rpc.onToolUpdate(handleToolUpdateMessage);
rpc.onDiffAvailable(handleDiffAvailableMessage);
rpc.onUsageInfo(handleUsageInfoMessage);
rpc.onResetPlanMode(handleResetPlanModeMessage);
rpc.onStatus(handleStatusMessage);  // ← Generic status handler
rpc.onFilesSelected(handleFilesSelectedMessage);
rpc.onModelSwitched(handleModelSwitchedMessage);
rpc.onCurrentModel(handleCurrentModelMessage);
rpc.onAvailableModels(handleAvailableModelsMessage);
rpc.onInit(handleInitMessage);
7. STATUS DISPLAY COMPONENT
File: /home/smolen/dev/vscode-copilot-cli-extension/src/webview/app/components/StatusBar/StatusBar.js

StatusBar component (line 1-191): Handles reasoning indicator, reasoning toggle, and usage statistics display.

Key methods:

Line 68-71: showReasoning() - Display reasoning indicator
Line 76-79: hideReasoning() - Hide reasoning indicator
Line 111-114: updateUsageWindow(percentage, used, limit) - Update context window usage
Line 120-123: updateUsageUsed(tokens) - Update tokens used display
Line 129-135: updateUsageRemaining(remaining) - Update remaining requests
Render HTML (line 24-41):

render() {
    this.container.innerHTML = `
        <div class="status-bar">
            <span id="reasoningIndicator" class="reasoning-indicator" style="display: none;">
                🧠 <span id="reasoningText">Reasoning...</span>
            </span>
            <span id="reasoningSeparator" class="control-separator" style="display: none;">|</span>
            <button class="help-icon" title="Slash commands (/help)">?</button>
            <div class="usage-group">
                <span class="usage-info">
                    <span id="usageWindow" title="context window usage percentage">Window: 0%</span>
                    <span> | </span>
                    <span id="usageUsed" title="tokens used this session">Used: 0</span>
                    <span> | </span>
                    <span id="usageRemaining" title="remaining requests for account">Remaining: --</span>
                </span>
            </div>
        </div>
    `;
    // ...
}
Where StatusBar is used: Found in InputArea component (displays above input field) - shows system-level info and status.

Summary Table
Component	File	Key Pattern
SDK Event Subscribe	sdkSessionManager.ts:670-675	session.on(event => _handleSDKEvent)
Message Types	messages.ts:315-343	ExtensionMessageType union + payload interfaces
Send to Webview	ExtensionRpcRouter.ts:326-332	Create payload + this.send(message)
Forward Events	extension.ts:546-606	Subscribe to manager → call chatProvider.method()
Receive Messages	WebviewRpcClient.js:642-667	_handleMessage() → call registered handlers
Register Handlers	main.js:644-690	rpc.onMessageType(handler)
Display Status	StatusBar.js:24-41	Update DOM via updateUsage*() methods
To Add a New Event - Follow This Path:
SDK emits event → sdkSessionManager captures via session.on() (line 673)
Extract & fire internal event → this._onDidChangeStatus.fire({status: 'new_status', ...}) (line 766-772)
Add message type → messages.ts - Add to ExtensionMessageType union and create payload interface
Add send method → ExtensionRpcRouter.ts - Create sendNewEvent() method (pattern: line 326-332)
Wire subscription → extension.ts:546-606 - Add case in onDidChangeStatus switch to call chatProvider.sendNewEvent()
Add RPC handler → WebviewRpcClient.js:331-585 - Create onNewEvent(handler) method
Register handler → main.js:644-690 - Call rpc.onNewEvent(handleNewEventMessage)
Update UI → main.js - Implement handleNewEventMessage() to update components or emit to EventBus