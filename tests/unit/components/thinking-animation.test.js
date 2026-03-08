/**
 * Tests for the animated "Thinking..." prompt.
 * 
 * Verifies the HTML structure has brain icon spans and text span
 * needed for CSS animations to target.
 */

const { JSDOM } = require('jsdom');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function getMessageDisplayHTML() {
    const js = fs.readFileSync(
        path.join(__dirname, '../../../src/webview/app/components/MessageDisplay/MessageDisplay.js'),
        'utf-8'
    );
    // Extract the HTML template string
    const match = js.match(/this\.container\.innerHTML\s*=\s*`([\s\S]*?)`\s*;/);
    if (!match) throw new Error('Could not find innerHTML template in MessageDisplay.js');
    return match[1];
}

describe('Animated Thinking Prompt', function () {
    let dom, document;

    beforeEach(function () {
        const html = getMessageDisplayHTML();
        dom = new JSDOM(`<!DOCTYPE html><div id="root">${html}</div>`);
        document = dom.window.document;
    });

    it('thinking element has thinking-icon--a span with brain emoji', function () {
        const iconA = document.querySelector('.thinking-icon--a');
        assert.ok(iconA, '.thinking-icon--a must exist');
        assert.strictEqual(iconA.textContent.trim(), '🧠');
    });

    it('thinking element has thinking-icon--b span with brain emoji', function () {
        const iconB = document.querySelector('.thinking-icon--b');
        assert.ok(iconB, '.thinking-icon--b must exist');
        assert.strictEqual(iconB.textContent.trim(), '🧠');
    });

    it('thinking element has thinking-text span', function () {
        const text = document.querySelector('.thinking-text');
        assert.ok(text, '.thinking-text must exist');
        assert.strictEqual(text.textContent.trim(), 'Thinking...');
    });

    it('brain icons have aria-hidden to prevent screen reader duplication', function () {
        const iconA = document.querySelector('.thinking-icon--a');
        const iconB = document.querySelector('.thinking-icon--b');
        assert.strictEqual(iconA.getAttribute('aria-hidden'), 'true');
        assert.strictEqual(iconB.getAttribute('aria-hidden'), 'true');
    });

    it('thinking container keeps role=status and aria-live for accessibility', function () {
        const thinking = document.querySelector('#thinking');
        assert.ok(thinking, '#thinking must exist');
        assert.strictEqual(thinking.getAttribute('role'), 'status');
        assert.strictEqual(thinking.getAttribute('aria-live'), 'polite');
    });

    it('icons are inside the thinking container', function () {
        const thinking = document.querySelector('#thinking');
        const iconA = thinking.querySelector('.thinking-icon--a');
        const text = thinking.querySelector('.thinking-text');
        assert.ok(iconA, 'icon A must be inside #thinking');
        assert.ok(text, '.thinking-text must be inside #thinking');
    });
});
