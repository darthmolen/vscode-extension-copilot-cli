/**
 * JSDOM Component Test Setup
 *
 * Standardized test environment for webview component testing.
 * Provides full page structure, browser API polyfills, and cleanup.
 *
 * Usage:
 *   import { createComponentDOM, cleanupComponentDOM } from '../helpers/jsdom-component-setup.js';
 *
 *   let dom;
 *   before(() => { dom = createComponentDOM(); });
 *   after(() => { cleanupComponentDOM(dom); });
 */

import { JSDOM } from 'jsdom';

/**
 * Full page HTML matching the webview structure.
 * Includes <main>, mount points, and component containers.
 */
const PAGE_HTML = `
<!DOCTYPE html>
<html>
<body>
    <main role="main">
        <div id="session-toolbar-mount"></div>
        <div id="messages-mount"></div>
        <div id="acceptance-mount"></div>
        <div id="input-mount"></div>
    </main>
</body>
</html>
`;

/**
 * Mock ResizeObserver with manual trigger support.
 *
 * Usage in tests:
 *   const observer = messageDisplay.resizeObserver;
 *   observer.callback([{ contentRect: {} }]); // manually trigger
 */
class MockResizeObserver {
    constructor(callback) {
        this.callback = callback;
        this.observations = [];
    }
    observe(element) {
        this.observations.push(element);
    }
    unobserve(element) {
        this.observations = this.observations.filter(el => el !== element);
    }
    disconnect() {
        this.observations = [];
    }
}

/**
 * Creates a full component test DOM environment.
 * Sets globals: window, document, ResizeObserver, requestAnimationFrame, marked
 *
 * @returns {JSDOM} The JSDOM instance (pass to cleanupComponentDOM)
 */
export function createComponentDOM() {
    const dom = new JSDOM(PAGE_HTML, {
        url: 'http://localhost',
        runScripts: 'outside-only'
    });

    // Set global browser environment
    global.window = dom.window;
    global.document = dom.window.document;

    // Polyfill ResizeObserver
    global.ResizeObserver = MockResizeObserver;

    // Polyfill MutationObserver (available on JSDOM window but not global)
    global.MutationObserver = dom.window.MutationObserver;

    // Polyfill requestAnimationFrame / cancelAnimationFrame
    if (!global.requestAnimationFrame) {
        global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    }
    if (!global.cancelAnimationFrame) {
        global.cancelAnimationFrame = (id) => clearTimeout(id);
    }

    // Mock marked.js (markdown parser used by MessageDisplay)
    global.marked = {
        parse: (text) => `<p>${text}</p>`
    };

    return dom;
}

/**
 * Cleans up the component test DOM environment.
 * Removes all globals set by createComponentDOM.
 *
 * @param {JSDOM} dom - The JSDOM instance to close
 */
export function cleanupComponentDOM(dom) {
    delete global.ResizeObserver;
    delete global.MutationObserver;
    // Replace with no-ops instead of deleting to prevent crashes from pending callbacks
    // (e.g., MessageDisplay.scrollToBottom schedules via requestAnimationFrame -> setTimeout)
    global.requestAnimationFrame = () => {};
    global.cancelAnimationFrame = () => {};
    delete global.marked;
    delete global.window;
    delete global.document;
    if (dom && dom.window) {
        dom.window.close();
    }
}

/**
 * Helper to simulate scroll properties on a DOM element.
 * JSDOM doesn't compute layout, so we must set these manually.
 *
 * @param {Element} element - DOM element to configure
 * @param {Object} props - { scrollTop, scrollHeight, clientHeight }
 */
export function setScrollProperties(element, { scrollTop = 0, scrollHeight = 0, clientHeight = 0 }) {
    Object.defineProperty(element, 'scrollTop', { value: scrollTop, writable: true, configurable: true });
    Object.defineProperty(element, 'scrollHeight', { value: scrollHeight, writable: true, configurable: true });
    Object.defineProperty(element, 'clientHeight', { value: clientHeight, writable: true, configurable: true });
}
