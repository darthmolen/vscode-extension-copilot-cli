import { escapeHtml } from '../../utils/webview-utils.js';
import { ToolExecution } from '../ToolExecution/ToolExecution.js';

/**
 * MessageDisplay Component (Parent)
 * 
 * Renders chat messages including user messages, assistant messages, and reasoning.
 * Handles markdown rendering for assistant messages and attachments display.
 * Self-rendering component - creates its own DOM structure
 * 
 * Children: ToolExecution (created internally)
 * 
 * Usage:
 *   const display = new MessageDisplay(container, eventBus);
 *   // ToolExecution is created automatically as child component
 */

export class MessageDisplay {
    constructor(container, eventBus) {
        this.container = container;
        this.eventBus = eventBus;
        this.messagesContainer = null;
        this.emptyState = null;
        this.thinking = null;
        this.showReasoning = false;
        
        this.render();
        
        // Create ToolExecution as child component - owns tool rendering
        this.toolExecution = new ToolExecution(this.messagesContainer, eventBus);
        
        this.attachListeners();
    }

    render() {
        this.container.innerHTML = `
            <div class="messages message-display" id="messages" role="log" aria-live="polite" aria-label="Chat messages">
                <div class="empty-state message-display__empty" id="emptyState">
                    <div class="empty-state-icon message-display__empty-icon" aria-hidden="true">💬</div>
                    <div class="empty-state-text message-display__empty-text">
                        Start a chat session to begin<br>
                        Use the command palette to start the CLI
                    </div>
                </div>
            </div>
            <div class="thinking message-display__thinking" id="thinking" role="status" aria-live="polite">Thinking...</div>
        `;

        // Get element references
        this.messagesContainer = this.container.querySelector('#messages');
        this.emptyState = this.container.querySelector('#emptyState');
        this.thinking = this.container.querySelector('#thinking');
    }

    attachListeners() {
        // Subscribe to message:add event from EventBus
        this.eventBus.on('message:add', (message) => {
            this.addMessage(message);
        });
        
        // Subscribe to reasoning:toggle event
        this.eventBus.on('reasoning:toggle', (enabled) => {
            this.showReasoning = enabled;
            this.updateReasoningVisibility();
        });
    }

    addMessage(message) {
        const { role, content, attachments, timestamp } = message;
        
        // Hide empty state after first message
        if (this.emptyState) {
            this.emptyState.style.display = 'none';
        }
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `message message-display__item message-display__item--${role}`;
        messageDiv.setAttribute('role', 'article');
        messageDiv.dataset.timestamp = timestamp || Date.now();
        
        // Handle different message types
        if (role === 'reasoning') {
            messageDiv.setAttribute('aria-label', 'Assistant reasoning');
            messageDiv.style.display = this.showReasoning ? 'block' : 'none';
            messageDiv.innerHTML = `
                <div class="message-header message-display__header" style="font-style: italic;">Assistant Reasoning</div>
                <div class="message-content message-display__content" style="font-style: italic;">${this.escapeHtml(content)}</div>
            `;
        } else {
            messageDiv.setAttribute('aria-label', `${role === 'user' ? 'Your' : 'Assistant'} message`);
            
            // Use marked for assistant messages, plain text for user
            const renderedContent = role === 'assistant' 
                ? (typeof marked !== 'undefined' ? marked.parse(content) : content)
                : this.escapeHtml(content);
            
            // Build attachments HTML if present
            let attachmentsHtml = '';
            if (attachments && attachments.length > 0) {
                attachmentsHtml = '<div class="message-attachments message-display__attachments">' + 
                    attachments.map(att => `
                        <div class="message-attachment message-display__attachment">
                            ${att.webviewUri ? `<img src="${att.webviewUri}" alt="${att.displayName}" class="message-attachment-image" />` : ''}
                            <div class="message-attachment-name">📎 ${att.displayName}</div>
                        </div>
                    `).join('') +
                    '</div>';
            }
            
            messageDiv.innerHTML = `
                <div class="message-header message-display__header">${role === 'user' ? 'You' : 'Assistant'}</div>
                <div class="message-content message-display__content">
                    ${renderedContent}
                    ${attachmentsHtml}
                </div>
            `;
        }
        
        this.messagesContainer.appendChild(messageDiv);
        this.scrollToBottom();
    }

    scrollToBottom() {
        console.log('[SCROLL DEBUG] scrollToBottom() called, scrollHeight:', this.messagesContainer.scrollHeight);
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    updateReasoningVisibility() {
        const reasoningMessages = this.messagesContainer.querySelectorAll('.message-display__item--reasoning');
        reasoningMessages.forEach(msg => {
            msg.style.display = this.showReasoning ? 'block' : 'none';
        });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    clear() {
        // Remove all messages except empty state
        const messages = this.messagesContainer.querySelectorAll('.message-display__item');
        messages.forEach(msg => msg.remove());
        
        // Show empty state
        if (this.emptyState) {
            this.emptyState.style.display = 'block';
        }
    }
}
