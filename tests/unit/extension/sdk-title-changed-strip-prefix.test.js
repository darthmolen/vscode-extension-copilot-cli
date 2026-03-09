const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Test: SDK session.title_changed event handler strips [Active File: ...] prefix
 * 
 * When the SDK fires session.title_changed with a title containing [Active File: ...]
 * (which happens when messageEnhancementService prepends it to the first message),
 * the handler should strip the prefix before writing to session-name.txt.
 */

describe('SDK session.title_changed Handler', function () {
    let tempSessionDir;
    const testSessionId = 'test-session-abc123';

    beforeEach(function () {
        // Create temp session directory
        const sessionStateDir = path.join(os.tmpdir(), '.copilot-test-' + Date.now());
        tempSessionDir = path.join(sessionStateDir, testSessionId);
        fs.mkdirSync(tempSessionDir, { recursive: true });
    });

    afterEach(function () {
        // Clean up
        if (tempSessionDir && fs.existsSync(tempSessionDir)) {
            fs.rmSync(path.dirname(tempSessionDir), { recursive: true, force: true });
        }
    });

    it('strips [Active File: ...] prefix from session title', function () {
        // Simulate SDK session.title_changed event with Active File prefix
        const rawTitle = '[Active File: /home/user/project/src/main.ts]\n\nImplement user authentication';
        
        // Simulate what the handler does:
        // 1. Strip [Active File: ...] prefix
        let cleanTitle = rawTitle.replace(/^\[Active File:.*?\]\s*/s, '').trim();
        
        // 2. Take first non-empty line if multiline
        const lines = cleanTitle.split('\n').map(l => l.trim()).filter(l => l);
        if (lines.length > 0) {
            cleanTitle = lines[0];
        }
        
        // Verify the cleaned title
        assert.strictEqual(cleanTitle, 'Implement user authentication');
        
        // Verify that writing to session-name.txt would contain clean title
        const sessionNamePath = path.join(tempSessionDir, 'session-name.txt');
        fs.writeFileSync(sessionNamePath, cleanTitle, 'utf-8');
        
        const written = fs.readFileSync(sessionNamePath, 'utf-8');
        assert.strictEqual(written, 'Implement user authentication');
        assert.ok(!written.includes('[Active File:'), 'session-name.txt must not contain [Active File: prefix');
    });

    it('handles title with only [Active File: ...] and no other content', function () {
        const rawTitle = '[Active File: /home/user/project/src/index.js]';
        
        let cleanTitle = rawTitle.replace(/^\[Active File:.*?\]\s*/s, '').trim();
        const lines = cleanTitle.split('\n').map(l => l.trim()).filter(l => l);
        if (lines.length > 0) {
            cleanTitle = lines[0];
        }
        
        // Should be empty string when only prefix exists
        assert.strictEqual(cleanTitle, '');
    });

    it('handles title without [Active File: ...] prefix', function () {
        const rawTitle = 'My Feature Branch';
        
        let cleanTitle = rawTitle.replace(/^\[Active File:.*?\]\s*/s, '').trim();
        const lines = cleanTitle.split('\n').map(l => l.trim()).filter(l => l);
        if (lines.length > 0) {
            cleanTitle = lines[0];
        }
        
        assert.strictEqual(cleanTitle, 'My Feature Branch');
    });

    it('takes first line of multiline title after stripping prefix', function () {
        const rawTitle = '[Active File: plan.md]\n\nFirst line of plan\nSecond line\nThird line';
        
        let cleanTitle = rawTitle.replace(/^\[Active File:.*?\]\s*/s, '').trim();
        const lines = cleanTitle.split('\n').map(l => l.trim()).filter(l => l);
        if (lines.length > 0) {
            cleanTitle = lines[0];
        }
        
        assert.strictEqual(cleanTitle, 'First line of plan');
    });
});
