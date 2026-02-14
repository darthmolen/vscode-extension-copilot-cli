/**
 * EventBus - Lightweight pub/sub for component communication
 * 
 * Simple event emitter pattern for coordinating state between components.
 * Components subscribe to events they care about and emit events when state changes.
 * 
 * Usage:
 *   const eventBus = new EventBus();
 *   eventBus.on('message:add', (message) => { ... });
 *   eventBus.emit('message:add', { role: 'user', content: 'Hello' });
 *   eventBus.off('message:add', handler);
 */

export class EventBus {
    constructor() {
        this.listeners = new Map();
    }

    /**
     * Subscribe to an event
     * @param {string} event - Event name (e.g. 'message:add', 'tool:start')
     * @param {Function} callback - Handler function to call when event emitted
     */
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
    }

    /**
     * Unsubscribe from an event
     * @param {string} event - Event name
     * @param {Function} callback - Handler function to remove
     */
    off(event, callback) {
        if (!this.listeners.has(event)) {
            return;
        }
        
        const callbacks = this.listeners.get(event);
        const index = callbacks.indexOf(callback);
        if (index > -1) {
            callbacks.splice(index, 1);
        }
    }

    /**
     * Emit an event to all subscribers
     * @param {string} event - Event name
     * @param {*} data - Data to pass to subscribers
     */
    emit(event, data) {
        if (!this.listeners.has(event)) {
            return;
        }
        
        const callbacks = this.listeners.get(event);
        for (const callback of callbacks) {
            try {
                callback(data);
            } catch (error) {
                // Log error but continue calling other listeners
                console.error(`EventBus: Error in listener for "${event}":`, error);
            }
        }
    }
}
