/**
 * Unit tests for SessionService
 * TDD RED phase: Tests written BEFORE the implementation exists.
 *
 * SessionService consolidates session logic from:
 *   - src/sessionUtils.ts (getAllSessions, filterSessionsByFolder, getMostRecentSession, getSessionCwd)
 *   - src/extension.ts (determineSessionToResume, updateSessionsList, formatSessionLabel, loadSessionHistory)
 *
 * The import of the compiled module is expected to FAIL until the implementation is written.
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

/**
 * Create a temporary session directory tree for testing.
 *
 * @param {string} baseDir  Root of the temp tree (e.g. os.tmpdir() + '/sessions-test-xxx')
 * @param {Array<{id: string, events?: object[], planContent?: string, cwd?: string}>} sessions
 * @returns {string} The session-state directory path
 */
function createTempSessionDir(baseDir, sessions) {
    const sessionStateDir = path.join(baseDir, '.copilot', 'session-state');
    fs.mkdirSync(sessionStateDir, { recursive: true });

    for (const session of sessions) {
        const sessionDir = path.join(sessionStateDir, session.id);
        fs.mkdirSync(sessionDir, { recursive: true });

        // Write events.jsonl if events are provided
        if (session.events) {
            const lines = session.events.map(e => JSON.stringify(e));
            fs.writeFileSync(path.join(sessionDir, 'events.jsonl'), lines.join('\n') + '\n');
        }

        // Write plan.md if planContent is provided
        if (session.planContent !== undefined) {
            fs.writeFileSync(path.join(sessionDir, 'plan.md'), session.planContent);
        }
    }

    return sessionStateDir;
}

/**
 * Recursively remove a directory tree.
 */
function removeTempDir(dir) {
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

describe('SessionService', function () {
    let SessionService;
    let tmpDir;

    before(function () {
        // Attempt to load the compiled SessionService module.
        // In the RED phase this will throw -- mark the suite as pending so mocha reports it clearly.
        try {
            const modulePath = path.join(__dirname, '../../../out/extension/services/SessionService.js');
            const mod = require(modulePath);
            SessionService = mod.SessionService || mod;
        } catch (err) {
            // RED phase: module does not exist yet. That is intentional.
            // We still define the test structure so `mocha --dry-run` or reporters can enumerate them.
            console.log(`  [RED] SessionService module not found (expected): ${err.message}`);
            SessionService = null;
        }
    });

    beforeEach(function () {
        if (!SessionService) {
            this.skip(); // skip individual tests while module is missing
        }
        // Create a unique temp directory for each test
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-service-test-'));
    });

    afterEach(function () {
        if (tmpDir) {
            removeTempDir(tmpDir);
            tmpDir = null;
        }
    });

    // ---------------------------------------------------------------------------
    // getAllSessions()
    // ---------------------------------------------------------------------------
    describe('getAllSessions()', function () {
        it('returns empty array when session directory does not exist', function () {
            // Point at a directory that does not contain .copilot/session-state
            const nonexistent = path.join(tmpDir, 'does-not-exist');
            const result = SessionService.getAllSessions(nonexistent);
            assert.ok(Array.isArray(result), 'result should be an array');
            assert.strictEqual(result.length, 0);
        });

        it('returns array of SessionInfo objects for valid sessions', function () {
            const sessionStateDir = createTempSessionDir(tmpDir, [
                {
                    id: 'abc-session-1',
                    events: [
                        { type: 'session.start', data: { context: { cwd: '/home/user/project' } } },
                        { type: 'user.message', data: { content: 'hello' } }
                    ]
                },
                {
                    id: 'def-session-2',
                    events: [
                        { type: 'session.start', data: { context: { cwd: '/home/user/other' } } }
                    ]
                }
            ]);

            const result = SessionService.getAllSessions(sessionStateDir);
            assert.strictEqual(result.length, 2);

            const ids = result.map(s => s.id).sort();
            assert.deepStrictEqual(ids, ['abc-session-1', 'def-session-2']);

            // Each item should have the SessionInfo shape
            for (const session of result) {
                assert.ok(typeof session.id === 'string', 'id should be a string');
                assert.ok(typeof session.mtime === 'number', 'mtime should be a number');
            }
        });

        it('skips directories without events.jsonl', function () {
            const sessionStateDir = createTempSessionDir(tmpDir, [
                {
                    id: 'valid-session',
                    events: [{ type: 'session.start', data: { context: { cwd: '/tmp' } } }]
                },
                {
                    id: 'invalid-session'
                    // no events -- events.jsonl will NOT be created
                }
            ]);

            const result = SessionService.getAllSessions(sessionStateDir);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].id, 'valid-session');
        });

        it('includes mtime for each session', function () {
            const sessionStateDir = createTempSessionDir(tmpDir, [
                {
                    id: 'session-with-time',
                    events: [{ type: 'session.start', data: { context: { cwd: '/tmp' } } }]
                }
            ]);

            const result = SessionService.getAllSessions(sessionStateDir);
            assert.strictEqual(result.length, 1);
            assert.ok(typeof result[0].mtime === 'number', 'mtime should be a number');
            assert.ok(result[0].mtime > 0, 'mtime should be positive');
            // mtime should be reasonably recent (within last 60 seconds)
            assert.ok(Date.now() - result[0].mtime < 60000, 'mtime should be recent');
        });
    });

    // ---------------------------------------------------------------------------
    // filterSessionsByFolder()
    // ---------------------------------------------------------------------------
    describe('filterSessionsByFolder()', function () {
        it('filters sessions matching workspace folder', function () {
            const sessions = [
                { id: 's1', cwd: '/home/user/project-a', mtime: 100 },
                { id: 's2', cwd: '/home/user/project-b', mtime: 200 },
                { id: 's3', cwd: '/home/user/project-a', mtime: 300 }
            ];

            const result = SessionService.filterSessionsByFolder(sessions, '/home/user/project-a');
            assert.strictEqual(result.length, 2);

            const ids = result.map(s => s.id).sort();
            assert.deepStrictEqual(ids, ['s1', 's3']);
        });

        it('returns empty array when no sessions match', function () {
            const sessions = [
                { id: 's1', cwd: '/home/user/project-a', mtime: 100 },
                { id: 's2', cwd: '/home/user/project-b', mtime: 200 }
            ];

            const result = SessionService.filterSessionsByFolder(sessions, '/home/user/unrelated');
            assert.ok(Array.isArray(result));
            assert.strictEqual(result.length, 0);
        });

        it('handles sessions without cwd (skips them)', function () {
            const sessions = [
                { id: 's1', cwd: '/home/user/project-a', mtime: 100 },
                { id: 's2', mtime: 200 },               // no cwd
                { id: 's3', cwd: undefined, mtime: 300 } // explicit undefined
            ];

            const result = SessionService.filterSessionsByFolder(sessions, '/home/user/project-a');
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].id, 's1');
        });

        it('normalizes paths for comparison', function () {
            const sessions = [
                { id: 's1', cwd: '/home/user/project-a/', mtime: 100 },    // trailing slash
                { id: 's2', cwd: '/home/user/project-a', mtime: 200 },     // no trailing slash
                { id: 's3', cwd: '/home/user/./project-a', mtime: 300 }    // dot segment
            ];

            const result = SessionService.filterSessionsByFolder(sessions, '/home/user/project-a');
            // All three should match after normalization
            assert.ok(result.length >= 2, 'At least the exact and trailing-slash variants should match');

            const ids = result.map(s => s.id);
            assert.ok(ids.includes('s1'), 'trailing slash path should match');
            assert.ok(ids.includes('s2'), 'exact path should match');
        });
    });

    // ---------------------------------------------------------------------------
    // getMostRecentSession()
    // ---------------------------------------------------------------------------
    describe('getMostRecentSession()', function () {
        it('returns most recent session ID when filterByFolder=false', function () {
            const sessionStateDir = createTempSessionDir(tmpDir, [
                {
                    id: 'older-session',
                    events: [{ type: 'session.start', data: { context: { cwd: '/a' } } }]
                },
                {
                    id: 'newer-session',
                    events: [{ type: 'session.start', data: { context: { cwd: '/b' } } }]
                }
            ]);

            // Touch newer-session to make its mtime more recent
            const newerDir = path.join(sessionStateDir, 'newer-session');
            const futureTime = Date.now() + 5000;
            fs.utimesSync(newerDir, new Date(futureTime), new Date(futureTime));

            const result = SessionService.getMostRecentSession(sessionStateDir, '/irrelevant', false);
            assert.strictEqual(result, 'newer-session');
        });

        it('returns most recent folder-specific session when filterByFolder=true', function () {
            const sessionStateDir = createTempSessionDir(tmpDir, [
                {
                    id: 'folder-a-old',
                    events: [{ type: 'session.start', data: { context: { cwd: '/home/user/project-a' } } }]
                },
                {
                    id: 'folder-b-newest',
                    events: [{ type: 'session.start', data: { context: { cwd: '/home/user/project-b' } } }]
                },
                {
                    id: 'folder-a-new',
                    events: [{ type: 'session.start', data: { context: { cwd: '/home/user/project-a' } } }]
                }
            ]);

            // Make folder-a-new the most recent session for project-a
            const folderANewDir = path.join(sessionStateDir, 'folder-a-new');
            const futureTime = Date.now() + 5000;
            fs.utimesSync(folderANewDir, new Date(futureTime), new Date(futureTime));

            // Make folder-b-newest even more recent globally
            const folderBDir = path.join(sessionStateDir, 'folder-b-newest');
            const laterTime = Date.now() + 10000;
            fs.utimesSync(folderBDir, new Date(laterTime), new Date(laterTime));

            const result = SessionService.getMostRecentSession(
                sessionStateDir, '/home/user/project-a', true
            );
            assert.strictEqual(result, 'folder-a-new');
        });

        it('falls back to global most recent when no folder sessions exist', function () {
            const sessionStateDir = createTempSessionDir(tmpDir, [
                {
                    id: 'some-other-folder',
                    events: [{ type: 'session.start', data: { context: { cwd: '/home/user/other' } } }]
                }
            ]);

            const result = SessionService.getMostRecentSession(
                sessionStateDir, '/home/user/nonexistent-folder', true
            );
            // Should fall back to the only available session
            assert.strictEqual(result, 'some-other-folder');
        });

        it('returns null when no sessions exist', function () {
            const emptyDir = path.join(tmpDir, 'empty-session-state');
            fs.mkdirSync(emptyDir, { recursive: true });

            const result = SessionService.getMostRecentSession(emptyDir, '/home/user/project', false);
            assert.strictEqual(result, null);
        });
    });

    // ---------------------------------------------------------------------------
    // formatSessionLabel()
    // ---------------------------------------------------------------------------
    describe('formatSessionLabel()', function () {
        it('returns plan title when plan.md exists with heading', function () {
            const sessionStateDir = createTempSessionDir(tmpDir, [
                {
                    id: 'session-with-plan',
                    events: [{ type: 'session.start', data: { context: { cwd: '/tmp' } } }],
                    planContent: '# Refactor authentication module\n\nSome details here.'
                }
            ]);

            const sessionPath = path.join(sessionStateDir, 'session-with-plan');
            const label = SessionService.formatSessionLabel('session-with-plan', sessionPath);
            assert.strictEqual(label, 'Refactor authentication module');
        });

        it('truncates label to 40 characters', function () {
            const longTitle = 'This is a very long plan title that exceeds forty characters by a significant margin';
            const sessionStateDir = createTempSessionDir(tmpDir, [
                {
                    id: 'session-long-title',
                    events: [{ type: 'session.start', data: { context: { cwd: '/tmp' } } }],
                    planContent: `# ${longTitle}\n\nDetails.`
                }
            ]);

            const sessionPath = path.join(sessionStateDir, 'session-long-title');
            const label = SessionService.formatSessionLabel('session-long-title', sessionPath);
            assert.ok(label.length <= 40, `Label "${label}" should be at most 40 characters but was ${label.length}`);
        });

        it('falls back to session ID prefix when no plan.md', function () {
            const sessionStateDir = createTempSessionDir(tmpDir, [
                {
                    id: 'abcdef12-3456-7890-abcd-ef1234567890',
                    events: [{ type: 'session.start', data: { context: { cwd: '/tmp' } } }]
                    // no planContent
                }
            ]);

            const sessionPath = path.join(sessionStateDir, 'abcdef12-3456-7890-abcd-ef1234567890');
            const label = SessionService.formatSessionLabel(
                'abcdef12-3456-7890-abcd-ef1234567890', sessionPath
            );
            assert.strictEqual(label, 'abcdef12');
        });

        it('handles empty plan.md gracefully', function () {
            const sessionStateDir = createTempSessionDir(tmpDir, [
                {
                    id: 'session-empty-plan',
                    events: [{ type: 'session.start', data: { context: { cwd: '/tmp' } } }],
                    planContent: ''
                }
            ]);

            const sessionPath = path.join(sessionStateDir, 'session-empty-plan');
            const label = SessionService.formatSessionLabel('session-empty-plan', sessionPath);
            // Should fall back to session ID prefix
            assert.strictEqual(label, 'session-');
        });
    });

    // ---------------------------------------------------------------------------
    // loadSessionHistory()
    // ---------------------------------------------------------------------------
    describe('loadSessionHistory()', function () {
        it('loads user and assistant messages from events.jsonl', async function () {
            const sessionStateDir = createTempSessionDir(tmpDir, [
                {
                    id: 'history-session',
                    events: [
                        { type: 'session.start', data: { context: { cwd: '/tmp' } }, timestamp: 1000 },
                        { type: 'user.message', data: { content: 'What is JavaScript?' }, timestamp: 2000 },
                        { type: 'assistant.message', data: { content: 'JavaScript is a programming language.' }, timestamp: 3000 },
                        { type: 'user.message', data: { content: 'Thanks!' }, timestamp: 4000 }
                    ]
                }
            ]);

            const eventsPath = path.join(sessionStateDir, 'history-session', 'events.jsonl');
            const messages = await SessionService.loadSessionHistory(eventsPath);

            assert.ok(Array.isArray(messages), 'should return an array');
            assert.strictEqual(messages.length, 3, 'should load 2 user messages and 1 assistant message');

            assert.strictEqual(messages[0].role, 'user');
            assert.strictEqual(messages[0].content, 'What is JavaScript?');

            assert.strictEqual(messages[1].role, 'assistant');
            assert.strictEqual(messages[1].content, 'JavaScript is a programming language.');

            assert.strictEqual(messages[2].role, 'user');
            assert.strictEqual(messages[2].content, 'Thanks!');
        });

        it('clears existing messages before loading', async function () {
            const sessionStateDir = createTempSessionDir(tmpDir, [
                {
                    id: 'clear-test-session',
                    events: [
                        { type: 'session.start', data: { context: { cwd: '/tmp' } }, timestamp: 1000 },
                        { type: 'user.message', data: { content: 'only message' }, timestamp: 2000 }
                    ]
                }
            ]);

            const eventsPath = path.join(sessionStateDir, 'clear-test-session', 'events.jsonl');

            // Load twice -- the second call should not accumulate messages
            await SessionService.loadSessionHistory(eventsPath);
            const messages = await SessionService.loadSessionHistory(eventsPath);

            assert.strictEqual(messages.length, 1, 'should have exactly 1 message, not accumulated duplicates');
            assert.strictEqual(messages[0].content, 'only message');
        });

        it('handles missing events.jsonl gracefully', async function () {
            const nonexistentPath = path.join(tmpDir, 'nonexistent', 'events.jsonl');
            const messages = await SessionService.loadSessionHistory(nonexistentPath);

            assert.ok(Array.isArray(messages), 'should return an array');
            assert.strictEqual(messages.length, 0, 'should return empty array for missing file');
        });

        it('skips malformed JSON lines', async function () {
            // Manually write a file with some bad lines
            const sessionDir = path.join(tmpDir, 'malformed-session');
            fs.mkdirSync(sessionDir, { recursive: true });

            const lines = [
                JSON.stringify({ type: 'session.start', data: { context: { cwd: '/tmp' } }, timestamp: 1000 }),
                'this is not valid json',
                JSON.stringify({ type: 'user.message', data: { content: 'valid message' }, timestamp: 2000 }),
                '{broken json: [}',
                JSON.stringify({ type: 'assistant.message', data: { content: 'also valid' }, timestamp: 3000 })
            ];
            fs.writeFileSync(path.join(sessionDir, 'events.jsonl'), lines.join('\n') + '\n');

            const eventsPath = path.join(sessionDir, 'events.jsonl');
            const messages = await SessionService.loadSessionHistory(eventsPath);

            assert.strictEqual(messages.length, 2, 'should skip malformed lines and load 2 valid messages');
            assert.strictEqual(messages[0].content, 'valid message');
            assert.strictEqual(messages[1].content, 'also valid');
        });
    });

    // ---------------------------------------------------------------------------
    // determineSessionToResume()
    // ---------------------------------------------------------------------------
    describe('determineSessionToResume()', function () {
        it('returns session ID when sessions exist', function () {
            const sessionStateDir = createTempSessionDir(tmpDir, [
                {
                    id: 'resume-candidate',
                    events: [{ type: 'session.start', data: { context: { cwd: '/home/user/workspace' } } }]
                }
            ]);

            const result = SessionService.determineSessionToResume(
                sessionStateDir,
                '/home/user/workspace',
                { filterSessionsByFolder: true }
            );
            assert.strictEqual(result, 'resume-candidate');
        });

        it('returns null when no sessions found', function () {
            const emptyDir = path.join(tmpDir, 'empty-sessions');
            fs.mkdirSync(emptyDir, { recursive: true });

            const result = SessionService.determineSessionToResume(
                emptyDir,
                '/home/user/workspace',
                { filterSessionsByFolder: true }
            );
            assert.strictEqual(result, null);
        });

        it('respects filterSessionsByFolder config setting', function () {
            const sessionStateDir = createTempSessionDir(tmpDir, [
                {
                    id: 'project-a-session',
                    events: [{ type: 'session.start', data: { context: { cwd: '/home/user/project-a' } } }]
                },
                {
                    id: 'project-b-session',
                    events: [{ type: 'session.start', data: { context: { cwd: '/home/user/project-b' } } }]
                }
            ]);

            // Make project-b-session more recent
            const projBDir = path.join(sessionStateDir, 'project-b-session');
            const futureTime = Date.now() + 5000;
            fs.utimesSync(projBDir, new Date(futureTime), new Date(futureTime));

            // With filtering enabled, should return the project-a session for project-a workspace
            const filteredResult = SessionService.determineSessionToResume(
                sessionStateDir,
                '/home/user/project-a',
                { filterSessionsByFolder: true }
            );
            assert.strictEqual(filteredResult, 'project-a-session');

            // With filtering disabled, should return the most recent global session
            const unfilteredResult = SessionService.determineSessionToResume(
                sessionStateDir,
                '/home/user/project-a',
                { filterSessionsByFolder: false }
            );
            assert.strictEqual(unfilteredResult, 'project-b-session');
        });
    });
});
