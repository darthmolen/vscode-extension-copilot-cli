/**
 * TDD tests for Fork Session Button in InputArea
 *
 * RED phase: Tests FAIL until fork button is added to InputArea.js
 *
 * Iron Law: Tests must fail before implementation exists.
 * Failure expected: "cannot find #forkSessionBtn"
 */

import { describe, it, before, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { InputArea } from '../../../src/webview/app/components/InputArea/InputArea.js';
import { EventBus } from '../../../src/webview/app/state/EventBus.js';

describe('Fork Session Button (InputArea)', () => {
    let dom, document, container, eventBus, mountPoint;

    before(() => {
        dom = new JSDOM(`
            <!DOCTYPE html>
            <html>
                <body>
                    <div id="container">
                        <div id="input-mount"></div>
                    </div>
                </body>
            </html>
        `);
        document = dom.window.document;
        global.document = document;
        global.window = dom.window;
    });

    beforeEach(() => {
        container = document.getElementById('container');
        container.innerHTML = '<div id="input-mount"></div>';
        mountPoint = container.querySelector('#input-mount');
        eventBus = new EventBus();
        new InputArea(mountPoint, eventBus);
    });

    afterEach(() => {
        if (container) {
            container.innerHTML = '';
        }
    });

    it('renders a fork session button in the InputArea', () => {
        const btn = mountPoint.querySelector('#forkSessionBtn');
        expect(btn, 'Fork button #forkSessionBtn must exist in InputArea DOM').to.exist;
    });

    it('fork button has the correct title attribute', () => {
        const btn = mountPoint.querySelector('#forkSessionBtn');
        expect(btn).to.exist;
        expect(btn.title).to.equal('Fork session');
    });

    it('emits forkSession on EventBus when fork button is clicked', () => {
        let emitted = false;
        eventBus.on('forkSession', () => { emitted = true; });
        const btn = mountPoint.querySelector('#forkSessionBtn');
        expect(btn, 'Fork button must exist before clicking').to.exist;
        btn.click();
        expect(emitted, 'EventBus must emit forkSession when button is clicked').to.be.true;
    });

    it('does not emit forkSession before button is clicked', () => {
        let emitted = false;
        eventBus.on('forkSession', () => { emitted = true; });
        expect(emitted).to.be.false;
    });
});
