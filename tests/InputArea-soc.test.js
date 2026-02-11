/**
 * InputArea Component - Separation of Concerns Tests
 * 
 * Phase 1: RED - These tests should FAIL
 * 
 * Tests verify InputArea follows proper component pattern:
 * - Emits events for user interactions
 * - Provides methods for updates
 * - Does NOT require main.js to query internals
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

describe('InputArea - Separation of Concerns', () => {
    let dom;
    let document;
    let window;
    let InputArea;
    let EventBus;

    beforeEach(async () => {
        dom = new JSDOM(`<!DOCTYPE html><html><body><div id="mount"></div></body></html>`);
        document = dom.window.document;
        window = dom.window;
        global.document = document;
        global.window = window;

        // Import components
        const inputModule = await import('../src/webview/app/components/InputArea/InputArea.js');
        InputArea = inputModule.InputArea;
        
        const busModule = await import('../src/webview/app/state/EventBus.js');
        EventBus = busModule.EventBus;
    });

    afterEach(() => {
        delete global.document;
        delete global.window;
        dom.window.close();
    });

    describe('Phase 1.1: Event Emitter - Plan Mode Buttons', () => {
        it('should emit "enterPlanMode" when Enter Plan button clicked', () => {
            const mount = document.getElementById('mount');
            const eventBus = new EventBus();
            const inputArea = new InputArea(mount, eventBus);

            let emitted = false;
            inputArea.on('enterPlanMode', () => {
                emitted = true;
            });

            // Find and click the enter plan mode button
            const btn = mount.querySelector('#enterPlanModeBtn');
            assert.ok(btn, 'Enter plan mode button should exist');
            btn.click();

            assert.ok(emitted, 'Should emit enterPlanMode event when button clicked');
        });

        it('should emit "acceptPlan" when Accept Plan button clicked', () => {
            const mount = document.getElementById('mount');
            const eventBus = new EventBus();
            const inputArea = new InputArea(mount, eventBus);

            let emitted = false;
            inputArea.on('acceptPlan', () => {
                emitted = true;
            });

            const btn = mount.querySelector('#acceptPlanBtn');
            assert.ok(btn, 'Accept plan button should exist');
            btn.click();

            assert.ok(emitted, 'Should emit acceptPlan event when button clicked');
        });

        it('should emit "rejectPlan" when Reject Plan button clicked', () => {
            const mount = document.getElementById('mount');
            const eventBus = new EventBus();
            const inputArea = new InputArea(mount, eventBus);

            let emitted = false;
            inputArea.on('rejectPlan', () => {
                emitted = true;
            });

            const btn = mount.querySelector('#rejectPlanBtn');
            assert.ok(btn, 'Reject plan button should exist');
            btn.click();

            assert.ok(emitted, 'Should emit rejectPlan event when button clicked');
        });
    });

    describe('Phase 1.2: Event Emitter - Reasoning Toggle', () => {
        it('should emit "reasoningToggle" when Show Reasoning checkbox changed', () => {
            const mount = document.getElementById('mount');
            const eventBus = new EventBus();
            const inputArea = new InputArea(mount, eventBus);

            let emittedValue = null;
            inputArea.on('reasoningToggle', (checked) => {
                emittedValue = checked;
            });

            const checkbox = mount.querySelector('#showReasoningCheckbox');
            assert.ok(checkbox, 'Show reasoning checkbox should exist');
            
            checkbox.checked = true;
            checkbox.dispatchEvent(new window.Event('change'));

            assert.strictEqual(emittedValue, true, 'Should emit true when checkbox checked');

            checkbox.checked = false;
            checkbox.dispatchEvent(new window.Event('change'));

            assert.strictEqual(emittedValue, false, 'Should emit false when checkbox unchecked');
        });
    });

    describe('Phase 1.3: Public Methods - Usage Stats', () => {
        it('should have updateUsageStats method', () => {
            const mount = document.getElementById('mount');
            const eventBus = new EventBus();
            const inputArea = new InputArea(mount, eventBus);

            assert.ok(typeof inputArea.updateUsageStats === 'function', 
                'InputArea should have updateUsageStats method');
        });

        it('should update usage window display when updateUsageStats called', () => {
            const mount = document.getElementById('mount');
            const eventBus = new EventBus();
            const inputArea = new InputArea(mount, eventBus);

            inputArea.updateUsageStats(5000, 10000, 85);

            const windowEl = mount.querySelector('#usageWindow');
            const usedEl = mount.querySelector('#usageUsed');
            const remainingEl = mount.querySelector('#usageRemaining');

            assert.ok(windowEl, 'Usage window element should exist');
            assert.ok(usedEl, 'Usage used element should exist');
            assert.ok(remainingEl, 'Usage remaining element should exist');

            assert.match(windowEl.textContent, /50%/, 'Should show 50% window usage');
            assert.match(usedEl.textContent, /5,000/, 'Should show 5,000 tokens used');
            assert.match(remainingEl.textContent, /85%/, 'Should show 85% remaining');
        });
    });

    describe('Phase 1.4: Public Methods - Focus File', () => {
        it('should have updateFocusFile method', () => {
            const mount = document.getElementById('mount');
            const eventBus = new EventBus();
            const inputArea = new InputArea(mount, eventBus);

            assert.ok(typeof inputArea.updateFocusFile === 'function',
                'InputArea should have updateFocusFile method');
        });

        it('should update focus file display when updateFocusFile called', () => {
            const mount = document.getElementById('mount');
            const eventBus = new EventBus();
            const inputArea = new InputArea(mount, eventBus);

            inputArea.updateFocusFile('/workspace/src/main.js');

            const focusFileEl = mount.querySelector('#focusFileInfo');
            assert.ok(focusFileEl, 'Focus file element should exist');
            assert.match(focusFileEl.textContent, /main\.js/, 'Should show file name');
        });
    });

    describe('Phase 1.5: Public Methods - Reasoning Indicator', () => {
        it('should have showReasoning method', () => {
            const mount = document.getElementById('mount');
            const eventBus = new EventBus();
            const inputArea = new InputArea(mount, eventBus);

            assert.ok(typeof inputArea.showReasoning === 'function',
                'InputArea should have showReasoning method');
        });

        it('should have hideReasoning method', () => {
            const mount = document.getElementById('mount');
            const eventBus = new EventBus();
            const inputArea = new InputArea(mount, eventBus);

            assert.ok(typeof inputArea.hideReasoning === 'function',
                'InputArea should have hideReasoning method');
        });

        it('should show reasoning indicator when showReasoning called', () => {
            const mount = document.getElementById('mount');
            const eventBus = new EventBus();
            const inputArea = new InputArea(mount, eventBus);

            const indicator = mount.querySelector('#reasoningIndicator');
            assert.ok(indicator, 'Reasoning indicator should exist');

            inputArea.showReasoning();
            
            // Should be visible (not display: none)
            assert.notEqual(indicator.style.display, 'none', 
                'Reasoning indicator should be visible');
        });

        it('should hide reasoning indicator when hideReasoning called', () => {
            const mount = document.getElementById('mount');
            const eventBus = new EventBus();
            const inputArea = new InputArea(mount, eventBus);

            const indicator = mount.querySelector('#reasoningIndicator');
            inputArea.showReasoning();
            inputArea.hideReasoning();

            assert.equal(indicator.style.display, 'none',
                'Reasoning indicator should be hidden');
        });
    });

    describe('Phase 1.6: Public Methods - Plan Mode UI', () => {
        it('should have setPlanMode method', () => {
            const mount = document.getElementById('mount');
            const eventBus = new EventBus();
            const inputArea = new InputArea(mount, eventBus);

            assert.ok(typeof inputArea.setPlanMode === 'function',
                'InputArea should have setPlanMode method');
        });

        it('should show plan buttons when setPlanMode(true) called', () => {
            const mount = document.getElementById('mount');
            const eventBus = new EventBus();
            const inputArea = new InputArea(mount, eventBus);

            inputArea.setPlanMode(true);

            const enterBtn = mount.querySelector('#enterPlanModeBtn');
            const acceptBtn = mount.querySelector('#acceptPlanBtn');
            const rejectBtn = mount.querySelector('#rejectPlanBtn');

            // Enter button should be hidden, accept/reject shown
            assert.equal(enterBtn.style.display, 'none', 'Enter button hidden in plan mode');
            assert.notEqual(acceptBtn.style.display, 'none', 'Accept button shown in plan mode');
            assert.notEqual(rejectBtn.style.display, 'none', 'Reject button shown in plan mode');
        });

        it('should show enter button when setPlanMode(false) called', () => {
            const mount = document.getElementById('mount');
            const eventBus = new EventBus();
            const inputArea = new InputArea(mount, eventBus);

            inputArea.setPlanMode(true);
            inputArea.setPlanMode(false);

            const enterBtn = mount.querySelector('#enterPlanModeBtn');
            const acceptBtn = mount.querySelector('#acceptPlanBtn');
            const rejectBtn = mount.querySelector('#rejectPlanBtn');

            // Enter button should be shown, accept/reject hidden
            assert.notEqual(enterBtn.style.display, 'none', 'Enter button shown when not in plan mode');
            assert.equal(acceptBtn.style.display, 'none', 'Accept button hidden when not in plan mode');
            assert.equal(rejectBtn.style.display, 'none', 'Reject button hidden when not in plan mode');
        });
    });
});
