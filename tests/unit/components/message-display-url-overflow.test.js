/**
 * Message Content URL Overflow Fix Tests
 *
 * Validates that .message-content and .message-display__content CSS rules
 * include overflow-wrap and word-break properties to prevent long unbroken
 * strings (e.g. URLs) from overflowing their containers.
 */

import { expect } from 'chai';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Message Content URL Overflow Fix', () => {
    let cssContent;

    before(() => {
        const cssPath = join(__dirname, '../../../src/webview/styles.css');
        cssContent = readFileSync(cssPath, 'utf-8');
    });

    it('should have overflow-wrap: break-word on message-content', () => {
        // Find the .message-content rule block
        const messageContentMatch = cssContent.match(/\.message-content[\s\S]*?\{([^}]+)\}/);
        expect(messageContentMatch, '.message-content rule not found in styles.css').to.not.be.null;

        const ruleBody = messageContentMatch[1];
        expect(ruleBody).to.include('overflow-wrap: break-word');
    });

    it('should have word-break: break-word as fallback', () => {
        const messageContentMatch = cssContent.match(/\.message-content[\s\S]*?\{([^}]+)\}/);
        expect(messageContentMatch).to.not.be.null;

        const ruleBody = messageContentMatch[1];
        expect(ruleBody).to.include('word-break: break-word');
    });
});
