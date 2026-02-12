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
        
        // ResizeObserver for auto-scroll
        this.scrollTimeout = null;
        this.resizeObserver = null;
        this.userHasScrolled = false; // Track if user manually scrolled
        this.isProgrammaticScroll = false; // Flag to ignore our own scrolls
        
        this.render();
        
        // Create ToolExecution as child component - owns tool rendering
        this.toolExecution = new ToolExecution(this.messagesContainer, eventBus);
        
        this.attachListeners();
        this.setupAutoScroll();
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
        
        // Track user manual scrolling
        if (this.messagesContainer) {
            this.messagesContainer.addEventListener('scroll', () => {
                // Ignore scroll events we triggered programmatically
                if (this.isProgrammaticScroll) {
                    console.log('[Scroll] Ignoring programmatic scroll');
                    return;
                }
                
                // Only set userHasScrolled if they scroll away from bottom
                if (!this.isNearBottomRaw()) {
                    console.log('[Scroll] User manually scrolled away from bottom');
                    this.userHasScrolled = true;
                } else {
                    console.log('[Scroll] User scrolled to bottom, resuming auto-scroll');
                    this.userHasScrolled = false;
                }
            });
        }
    }
    
    /**
     * Setup ResizeObserver for auto-scroll on content/layout changes
     */
    setupAutoScroll() {
        // Observe parent <main> element for both message content and input area expansion
        const mainElement = document.querySelector('main');
        if (!mainElement) {
            console.warn('[MessageDisplay] Could not find <main> element for ResizeObserver');
            return;
        }
        
        console.log('[ResizeObserver] Setting up observer on <main> element');
        
        this.resizeObserver = new ResizeObserver(() => {
            console.log('[ResizeObserver] Resize detected, debouncing scroll...');
            // Debounce: wait 50ms after last resize before scrolling
            clearTimeout(this.scrollTimeout);
            this.scrollTimeout = setTimeout(() => {
                console.log('[ResizeObserver] Debounce complete, calling autoScroll()');
                this.autoScroll();
            }, 50);
        });
        
        this.resizeObserver.observe(mainElement);
        console.log('[ResizeObserver] Observer active');
    }
    
    /**
     * Raw check if near bottom (without initial load special case)
     */
    isNearBottomRaw() {
        if (!this.messagesContainer) return true;
        
        const threshold = 100;
        const { scrollTop, scrollHeight, clientHeight } = this.messagesContainer;
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
        
        return distanceFromBottom < threshold;
    }
    
    /**
     * Check if user is near the bottom of messages (within 100px threshold)
     * Special case: If user hasn't manually scrolled yet, always return true (initial load)
     */
    isNearBottom() {
        if (!this.messagesContainer) return true;
        
        // If user hasn't manually scrolled away, always auto-scroll (initial load behavior)
        if (!this.userHasScrolled) {
            console.log('[isNearBottom] User has not manually scrolled, auto-scrolling');
            return true;
        }
        
        const threshold = 100; // px from bottom
        const { scrollTop, scrollHeight, clientHeight } = this.messagesContainer;
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
        
        console.log('[isNearBottom] scrollTop:', scrollTop, 'scrollHeight:', scrollHeight, 'clientHeight:', clientHeight, 'distance:', distanceFromBottom, 'threshold:', threshold);
        
        return distanceFromBottom < threshold;
    }
    
    /**
     * Auto-scroll to bottom only if user is near bottom
     */
    autoScroll() {
        const nearBottom = this.isNearBottom();
        console.log('[ResizeObserver] autoScroll() called, nearBottom:', nearBottom);
        if (nearBottom) {
            this.scrollToBottom();
        } else {
            console.log('[ResizeObserver] User scrolled up, skipping auto-scroll');
        }
    }
    
    /**
     * Scroll messages to bottom
     */
    scrollToBottom() {
        if (this.messagesContainer) {
            console.log('[SCROLL] scrollToBottom() called, scrollHeight:', this.messagesContainer.scrollHeight);
            
            // Set flag to ignore the scroll event we're about to trigger
            this.isProgrammaticScroll = true;
            this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
            
            // Reset flag after scroll completes (next tick)
            setTimeout(() => {
                this.isProgrammaticScroll = false;
                this.userHasScrolled = false; // We're at bottom now
            }, 0);
        }
    }
    
    /**
     * Cleanup resources
     */
    dispose() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        if (this.scrollTimeout) {
            clearTimeout(this.scrollTimeout);
            this.scrollTimeout = null;
        }
    }

    clearMessages() {
        // Clear all messages and show empty state
        const messagesDiv = this.container.querySelector('#messages');
        if (messagesDiv) {
            messagesDiv.innerHTML = '';
        }
        if (this.emptyState) {
            this.emptyState.style.display = 'flex';
        }
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
        // ResizeObserver handles scrolling automatically
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
