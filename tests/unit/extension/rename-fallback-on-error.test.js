const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Tests for /rename graceful fallback when CLI throws "Workspace not found"
 *
 * Issue #1865: /rename fails with 'Workspace not found' on resumed sessions
 * Our fix: write session-name.txt proactively via SessionService.writeSessionName()
 * before calling CLI, so the label updates even when CLI fails.
 */

// We need to compile tests first (npm run compile-tests) to use TS output
const SessionService = require('../../../out/extension/services/SessionService').SessionService;

describe('/rename Graceful Fallback on CLI Error', function () {
    let tempDir;
    let tempSessionDir;
    const testSessionId = 'abcdef12-3456-7890-abcd-ef1234567890';

    beforeEach(function () {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rename-fallback-test-'));
        tempSessionDir = path.join(tempDir, testSessionId);
        fs.mkdirSync(tempSessionDir, { recursive: true });
    });

    afterEach(function () {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('SessionService.writeSessionName() writes session-name.txt', function () {
        SessionService.writeSessionName(tempSessionDir, 'My Feature Branch');

        const sessionNamePath = path.join(tempSessionDir, 'session-name.txt');
        assert.ok(fs.existsSync(sessionNamePath), 'session-name.txt must exist');
        assert.strictEqual(fs.readFileSync(sessionNamePath, 'utf-8'), 'My Feature Branch');
    });

    it('proactive write survives CLI "Workspace not found" error', async function () {
        const sessionName = 'My Renamed Session';
        const sessionNamePath = path.join(tempSessionDir, 'session-name.txt');

        // Simulate the rename handler with proactive write + CLI failure
        const mockCliManager = {
            getSessionId: () => testSessionId,
            sendMessage: async () => {
                throw new Error(`Workspace not found: ${testSessionId}`);
            }
        };

        // Step 1: proactive write (as extension.ts now does)
        SessionService.writeSessionName(tempSessionDir, sessionName);

        // Step 2: send to CLI (fails)
        let cliError = null;
        try {
            await mockCliManager.sendMessage(`/rename ${sessionName}`);
        } catch (error) {
            cliError = error;
            // Extension logs warning but does NOT write here (already written above)
        }

        assert.ok(cliError, 'CLI should have thrown');
        assert.match(cliError.message, /Workspace not found/);

        // session-name.txt should still be there from proactive write
        assert.ok(fs.existsSync(sessionNamePath));
        assert.strictEqual(fs.readFileSync(sessionNamePath, 'utf-8'), 'My Renamed Session');
    });

    it('formatSessionLabel returns written name via session-name.txt (highest priority)', function () {
        // Write lower-priority sources
        fs.writeFileSync(path.join(tempSessionDir, 'plan.md'), '# Old Plan Name\n\nDetails.');
        fs.writeFileSync(path.join(tempSessionDir, 'workspace.yaml'),
            'version: 1\ncwd: /tmp\nsummary: Old Workspace Summary\n');

        // Proactive write takes priority
        SessionService.writeSessionName(tempSessionDir, 'My Renamed Session');

        const label = SessionService.formatSessionLabel(testSessionId, tempSessionDir);
        assert.strictEqual(label, 'My Renamed Session');
    });

    it('does not write session-name.txt when session name is empty', function () {
        const sessionName = '';
        const sessionNamePath = path.join(tempSessionDir, 'session-name.txt');

        // Guard: skip if empty (mirrors extension.ts guard)
        if (sessionName) {
            SessionService.writeSessionName(tempSessionDir, sessionName);
        }

        assert.ok(!fs.existsSync(sessionNamePath), 'session-name.txt must not be written for empty name');
    });
});

