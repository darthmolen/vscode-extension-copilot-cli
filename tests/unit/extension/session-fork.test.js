/**
 * TDD tests for SessionService.forkSession() — filesystem copy logic
 *
 * RED phase: Tests FAIL until forkSession() is added to SessionService.ts
 *
 * Pattern: session-service.test.js (uses createTempSessionDir helper)
 * Failure expected: "SessionService.forkSession is not a function"
 *
 * This tests the pure filesystem logic only — no SDK, no vscode dependency.
 */

const Module = require('module');
const originalRequire = Module.prototype.require;

// Mock vscode module BEFORE anything else loads
Module.prototype.require = function (id) {
    if (id === 'vscode') {
        return require('../../helpers/vscode-mock');
    }
    return originalRequire.apply(this, arguments);
};

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

function createTempSessionDir(baseDir, sessions) {
    const sessionStateDir = path.join(baseDir, '.copilot', 'session-state');
    fs.mkdirSync(sessionStateDir, { recursive: true });

    for (const session of sessions) {
        const sessionDir = path.join(sessionStateDir, session.id);
        fs.mkdirSync(sessionDir, { recursive: true });

        if (session.events) {
            const lines = session.events.map(e => JSON.stringify(e));
            fs.writeFileSync(path.join(sessionDir, 'events.jsonl'), lines.join('\n') + '\n');
        }

        if (session.planContent !== undefined) {
            fs.writeFileSync(path.join(sessionDir, 'plan.md'), session.planContent);
        }

        if (session.hasCheckpoints) {
            fs.mkdirSync(path.join(sessionDir, 'checkpoints'), { recursive: true });
            fs.writeFileSync(path.join(sessionDir, 'checkpoints', 'checkpoint-1.jsonl'), '{}');
        }
    }

    return sessionStateDir;
}

function removeTempDir(dir) {
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

describe('SessionService.forkSession()', function () {
    let SessionService;
    let tmpDir;
    const SOURCE_ID = 'aaaaaaaa-1111-2222-3333-444444444444';

    before(function () {
        try {
            const modulePath = path.join(__dirname, '../../../out/extension/services/SessionService.js');
            const mod = require(modulePath);
            SessionService = mod.SessionService || mod;
        } catch (err) {
            console.log('[TDD RED] SessionService not yet compiled:', err.message);
            this.skip();
        }

        if (typeof SessionService?.forkSession !== 'function') {
            console.log('[TDD RED] SessionService.forkSession does not exist yet');
            this.skip();
        }
    });

    beforeEach(function () {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fork-session-test-'));
    });

    afterEach(function () {
        removeTempDir(tmpDir);
    });

    it('copies session directory to a new UUID', function () {
        const sessionStateDir = createTempSessionDir(tmpDir, [
            {
                id: SOURCE_ID,
                events: [
                    { type: 'session.start', id: 'e1', data: { sessionId: SOURCE_ID, context: { cwd: '/workspace' } } },
                    { type: 'user.message', id: 'e2', data: { content: 'hello' } }
                ],
                planContent: '# Plan\n\nMy plan content'
            }
        ]);

        const newId = SessionService.forkSession(SOURCE_ID, sessionStateDir);

        assert.ok(newId, 'forkSession must return a new session ID');
        assert.notStrictEqual(newId, SOURCE_ID, 'New ID must differ from source ID');

        const newDir = path.join(sessionStateDir, newId);
        assert.ok(fs.existsSync(newDir), `Forked session directory must exist at ${newDir}`);

        const newEventsPath = path.join(newDir, 'events.jsonl');
        assert.ok(fs.existsSync(newEventsPath), 'Forked session must have events.jsonl');
    });

    it('copies plan.md to the forked session', function () {
        const sessionStateDir = createTempSessionDir(tmpDir, [
            {
                id: SOURCE_ID,
                events: [
                    { type: 'session.start', id: 'e1', data: { sessionId: SOURCE_ID, context: { cwd: '/workspace' } } }
                ],
                planContent: '# My Plan\n\nImportant plan content'
            }
        ]);

        const newId = SessionService.forkSession(SOURCE_ID, sessionStateDir);
        const newPlanPath = path.join(sessionStateDir, newId, 'plan.md');
        assert.ok(fs.existsSync(newPlanPath), 'plan.md must be copied to forked session');

        const planContent = fs.readFileSync(newPlanPath, 'utf8');
        assert.strictEqual(planContent, '# My Plan\n\nImportant plan content',
            'plan.md content must be identical to source');
    });

    it('does not destroy or modify the source session', function () {
        const sessionStateDir = createTempSessionDir(tmpDir, [
            {
                id: SOURCE_ID,
                events: [
                    { type: 'session.start', id: 'e1', data: { sessionId: SOURCE_ID, context: { cwd: '/workspace' } } }
                ]
            }
        ]);

        const sourceEventsPath = path.join(sessionStateDir, SOURCE_ID, 'events.jsonl');
        const originalContent = fs.readFileSync(sourceEventsPath, 'utf8');

        SessionService.forkSession(SOURCE_ID, sessionStateDir);

        assert.ok(fs.existsSync(path.join(sessionStateDir, SOURCE_ID)),
            'Source session directory must still exist after fork');
        assert.strictEqual(fs.readFileSync(sourceEventsPath, 'utf8'), originalContent,
            'Source events.jsonl must be unmodified after fork');
    });

    it('patches the sessionId in the session.start event of the forked events.jsonl', function () {
        const sessionStateDir = createTempSessionDir(tmpDir, [
            {
                id: SOURCE_ID,
                events: [
                    { type: 'session.start', id: 'e1', data: { sessionId: SOURCE_ID, context: { cwd: '/workspace' } } },
                    { type: 'user.message', id: 'e2', data: { content: 'hello' } }
                ]
            }
        ]);

        const newId = SessionService.forkSession(SOURCE_ID, sessionStateDir);
        const newEventsPath = path.join(sessionStateDir, newId, 'events.jsonl');
        const lines = fs.readFileSync(newEventsPath, 'utf8').trim().split('\n');

        const firstEvent = JSON.parse(lines[0]);
        assert.strictEqual(firstEvent.data.sessionId, newId,
            'session.start event in forked session must have the new sessionId');

        // CWD must be preserved
        assert.strictEqual(firstEvent.data.context.cwd, '/workspace',
            'cwd must be preserved in the forked session.start event');

        // Other events must be unchanged
        const secondEvent = JSON.parse(lines[1]);
        assert.strictEqual(secondEvent.type, 'user.message',
            'Non-start events must be copied unchanged');
    });

    it('returns the new session ID as a non-empty string', function () {
        const sessionStateDir = createTempSessionDir(tmpDir, [
            {
                id: SOURCE_ID,
                events: [
                    { type: 'session.start', id: 'e1', data: { sessionId: SOURCE_ID, context: { cwd: '/workspace' } } }
                ]
            }
        ]);

        const newId = SessionService.forkSession(SOURCE_ID, sessionStateDir);
        assert.strictEqual(typeof newId, 'string', 'Return value must be a string');
        assert.ok(newId.length > 0, 'Return value must not be empty');
    });

    it('works when session has a checkpoints directory', function () {
        const sessionStateDir = createTempSessionDir(tmpDir, [
            {
                id: SOURCE_ID,
                events: [
                    { type: 'session.start', id: 'e1', data: { sessionId: SOURCE_ID, context: { cwd: '/workspace' } } }
                ],
                hasCheckpoints: true
            }
        ]);

        let threw = false;
        try {
            SessionService.forkSession(SOURCE_ID, sessionStateDir);
        } catch (e) {
            threw = true;
        }
        assert.strictEqual(threw, false, 'forkSession must not throw when session has checkpoints/');
    });

    it('does not crash when events.jsonl first line is not session.start', function () {
        const sessionStateDir = createTempSessionDir(tmpDir, []);
        const sessionDir = path.join(sessionStateDir, SOURCE_ID);
        fs.mkdirSync(sessionDir, { recursive: true });
        // First line is NOT a session.start event
        const lines = [
            JSON.stringify({ type: 'user.message', id: 'e1', data: { content: 'hi' } }),
            JSON.stringify({ type: 'assistant.message', id: 'e2', data: { content: 'hello' } })
        ];
        fs.writeFileSync(path.join(sessionDir, 'events.jsonl'), lines.join('\n') + '\n');

        let threw = false;
        try {
            SessionService.forkSession(SOURCE_ID, sessionStateDir);
        } catch (e) {
            threw = true;
        }
        assert.strictEqual(threw, false, 'forkSession must not crash if first event is not session.start');
    });

    it('does not crash when events.jsonl is empty', function () {
        const sessionStateDir = createTempSessionDir(tmpDir, []);
        const sessionDir = path.join(sessionStateDir, SOURCE_ID);
        fs.mkdirSync(sessionDir, { recursive: true });
        fs.writeFileSync(path.join(sessionDir, 'events.jsonl'), '');

        let threw = false;
        try {
            SessionService.forkSession(SOURCE_ID, sessionStateDir);
        } catch (e) {
            threw = true;
        }
        assert.strictEqual(threw, false, 'forkSession must not crash on empty events.jsonl');
    });
});
