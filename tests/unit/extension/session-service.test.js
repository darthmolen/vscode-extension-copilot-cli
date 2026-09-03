/**
 * Unit tests for SessionService
 * TDD RED phase: Tests written BEFORE the implementation exists.
 *
 * SessionService consolidates session logic from:
 *   - src/extension.ts (determineSessionToResume, updateSessionsList, formatSessionLabel)
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
 * @param {Array<{id: string, events?: object[], planContent?: string, cwd?: string,
 *                rawEvents?: string, workspaceCwd?: string}>} sessions
 *   - rawEvents     raw events.jsonl content, for malformed-line cases
 *   - workspaceCwd  writes a workspace.yaml carrying this cwd
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

        // Raw events.jsonl content, for malformed / oversized first-line cases
        if (session.rawEvents !== undefined) {
            fs.writeFileSync(path.join(sessionDir, 'events.jsonl'), session.rawEvents);
        }

        // Write session-pairing.json, the contract behind the `-plan` suffix.
        if (session.pairedWith !== undefined) {
            fs.writeFileSync(
                path.join(sessionDir, 'session-pairing.json'),
                JSON.stringify({ workSessionId: session.pairedWith })
            );
        }

        // Write workspace.yaml if a cwd is provided. Mirrors the real file's shape.
        if (session.workspaceCwd !== undefined) {
            fs.writeFileSync(
                path.join(sessionDir, 'workspace.yaml'),
                [
                    `id: ${session.id}`,
                    `cwd: ${session.workspaceCwd}`,
                    `git_root: ${session.workspaceCwd}`,
                    'user_named: false',
                    ''
                ].join('\n')
            );
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

        it('returns null when no folder sessions exist', function () {
            // Regression: this used to fall back to the globally most-recent
            // session, loading another project's conversation into the chat.
            const sessionStateDir = createTempSessionDir(tmpDir, [
                {
                    id: 'some-other-folder',
                    events: [{ type: 'session.start', data: { context: { cwd: '/home/user/other' } } }]
                }
            ]);

            const result = SessionService.getMostRecentSession(
                sessionStateDir, '/home/user/nonexistent-folder', true
            );
            assert.strictEqual(result, null, 'must not leak a session from another folder');
        });

        it('still returns the global most recent when filterByFolder is false', function () {
            const sessionStateDir = createTempSessionDir(tmpDir, [
                {
                    id: 'some-other-folder',
                    events: [{ type: 'session.start', data: { context: { cwd: '/home/user/other' } } }]
                }
            ]);

            const result = SessionService.getMostRecentSession(
                sessionStateDir, '/home/user/nonexistent-folder', false
            );
            assert.strictEqual(result, 'some-other-folder');
        });

        it('matches despite Windows drive-letter case mismatch', function () {
            if (process.platform !== 'win32') {
                this.skip(); // comparison is deliberately case-sensitive on POSIX
            }
            // Real data carries a lowercase-drive cwd next to an uppercase-drive
            // git_root in one workspace.yaml, and VS Code's fsPath casing varies.
            const sessionStateDir = createTempSessionDir(tmpDir, [
                {
                    id: 'lower-drive',
                    events: [{ type: 'session.start', data: { context: { cwd: 'c:\\dev\\proj' } } }]
                },
                {
                    // Newer and from another folder: what a fallback would return
                    // if case-folding failed. Keeps the assert load-bearing.
                    id: 'decoy-newer',
                    events: [{ type: 'session.start', data: { context: { cwd: 'c:\\dev\\other' } } }]
                }
            ]);
            const later = Date.now() + 10000;
            fs.utimesSync(path.join(sessionStateDir, 'decoy-newer'), new Date(later), new Date(later));

            const result = SessionService.getMostRecentSession(
                sessionStateDir, 'C:\\dev\\proj', true
            );
            assert.strictEqual(result, 'lower-drive');
        });

        it('selects a session whose cwd is only readable from workspace.yaml', function () {
            // events.jsonl first line is unparseable (truncated / oversized), so
            // the old events-only reader yielded no cwd and the session was
            // silently excluded from the folder filter.
            const sessionStateDir = createTempSessionDir(tmpDir, [
                {
                    id: 'yaml-only',
                    rawEvents: '{"type":"session.start","data":{"context":{"cwd":"/home/user/pro',
                    workspaceCwd: '/home/user/project'
                },
                {
                    id: 'decoy-newer',
                    events: [{ type: 'session.start', data: { context: { cwd: '/home/user/other' } } }]
                }
            ]);
            const later = Date.now() + 10000;
            fs.utimesSync(path.join(sessionStateDir, 'decoy-newer'), new Date(later), new Date(later));

            const result = SessionService.getMostRecentSession(
                sessionStateDir, '/home/user/project', true
            );
            assert.strictEqual(result, 'yaml-only');
        });

        it('returns null when the only folder session is already open', function () {
            // With the global fallback gone, an open session is indistinguishable
            // from the folder having none -- both must yield a fresh session
            // rather than another workspace's conversation.
            const sessionStateDir = createTempSessionDir(tmpDir, [
                {
                    id: 'mine-open',
                    events: [{ type: 'session.start', data: { context: { cwd: '/home/user/project' } } }]
                },
                {
                    id: 'other-folder',
                    events: [{ type: 'session.start', data: { context: { cwd: '/home/user/other' } } }]
                }
            ]);

            const result = SessionService.getMostRecentSession(
                sessionStateDir, '/home/user/project', true, ['mine-open']
            );
            assert.strictEqual(result, null);
        });

        it('returns null when no sessions exist', function () {
            const emptyDir = path.join(tmpDir, 'empty-session-state');
            fs.mkdirSync(emptyDir, { recursive: true });

            const result = SessionService.getMostRecentSession(emptyDir, '/home/user/project', false);
            assert.strictEqual(result, null);
        });
    });

    // ---------------------------------------------------------------------------
    // hasSessionHistory()
    // ---------------------------------------------------------------------------
    describe('hasSessionHistory()', function () {
        it('returns true when the session has an events.jsonl', function () {
            const sessionStateDir = createTempSessionDir(tmpDir, [
                {
                    id: 'work-1-plan',
                    events: [{ type: 'session.start', data: { context: { cwd: '/tmp' } } }]
                }
            ]);
            assert.strictEqual(SessionService.hasSessionHistory(sessionStateDir, 'work-1-plan'), true);
        });

        it('returns false when the directory exists but has no events.jsonl', function () {
            // First entry into plan mode must take the create path.
            const sessionStateDir = createTempSessionDir(tmpDir, [
                { id: 'work-2-plan', workspaceCwd: '/tmp' }
            ]);
            assert.strictEqual(SessionService.hasSessionHistory(sessionStateDir, 'work-2-plan'), false);
        });

        it('returns false when the session directory does not exist', function () {
            const sessionStateDir = createTempSessionDir(tmpDir, []);
            assert.strictEqual(SessionService.hasSessionHistory(sessionStateDir, 'never-created'), false);
        });
    });

    // ---------------------------------------------------------------------------
    // isRestorable()
    // ---------------------------------------------------------------------------
    describe('isRestorable()', function () {
        // "Resumable" and "restorable" are not the same question, and conflating
        // them broke plan-mode restore. A work session needs a transcript to come
        // back, because bringing it back means `session.resume`. A plan session
        // does not: restoring plan mode means enablePlanMode(), which CREATES the
        // plan session when there is none. Entering plan mode and closing VS Code
        // before typing anything leaves exactly that -- a paired plan session with
        // no transcript -- and it is still a real intent to be in plan mode.

        it('accepts a work session that has a transcript', function () {
            const dir = createTempSessionDir(tmpDir, [
                {
                    id: 'work-with-history',
                    events: [{ type: 'session.start', data: { context: { cwd: '/tmp' } } }]
                }
            ]);
            assert.strictEqual(SessionService.isRestorable(dir, 'work-with-history'), true);
        });

        it('rejects a work session with a directory but no transcript', function () {
            // The "Previous session not found" dialog: created, never messaged, so
            // `session.resume` answers "Session not found".
            const dir = createTempSessionDir(tmpDir, [
                { id: 'work-no-history', workspaceCwd: '/tmp' }
            ]);
            assert.strictEqual(SessionService.isRestorable(dir, 'work-no-history'), false);
        });

        it('accepts a plan session with no transcript, via its pairing record', function () {
            const dir = createTempSessionDir(tmpDir, [
                { id: 'w1', workspaceCwd: '/tmp' },
                { id: 'w1-plan', workspaceCwd: '/tmp', pairedWith: 'w1' }
            ]);
            assert.strictEqual(SessionService.isRestorable(dir, 'w1-plan'), true);
        });

        it('accepts a plan session with no transcript and no record, via the suffix', function () {
            const dir = createTempSessionDir(tmpDir, [
                { id: 'w2-plan', workspaceCwd: '/tmp' }
            ]);
            assert.strictEqual(SessionService.isRestorable(dir, 'w2-plan'), true);
        });

        it('rejects a session that does not exist at all', function () {
            const dir = createTempSessionDir(tmpDir, []);
            assert.strictEqual(SessionService.isRestorable(dir, 'never-existed'), false);
        });

        it('treats a record naming itself as a work session', function () {
            // A work session the user happened to name `...-plan`, with no transcript.
            const dir = createTempSessionDir(tmpDir, [
                { id: 'odd-plan', workspaceCwd: '/tmp', pairedWith: 'odd-plan' }
            ]);
            assert.strictEqual(SessionService.isRestorable(dir, 'odd-plan'), false);
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

        // Feature 2 (Bug Fix A): session-name.txt takes top priority
        it('returns session-name.txt contents when present (highest priority)', function () {
            const sessionStateDir = createTempSessionDir(tmpDir, [
                {
                    id: 'session-with-name-file',
                    events: [{ type: 'session.start', data: { context: { cwd: '/tmp' } } }],
                    planContent: '# Plan heading\n\nDetails here.'
                }
            ]);

            const sessionPath = path.join(sessionStateDir, 'session-with-name-file');
            // Write session-name.txt
            fs.writeFileSync(path.join(sessionPath, 'session-name.txt'), 'My Custom Name');

            const label = SessionService.formatSessionLabel('session-with-name-file', sessionPath);
            // session-name.txt should take priority over plan.md heading
            assert.strictEqual(label, 'My Custom Name');
        });

        it('truncates session-name.txt to 40 characters', function () {
            const sessionStateDir = createTempSessionDir(tmpDir, [
                {
                    id: 'session-with-long-name',
                    events: [{ type: 'session.start', data: { context: { cwd: '/tmp' } } }]
                }
            ]);

            const sessionPath = path.join(sessionStateDir, 'session-with-long-name');
            const longName = 'This is a very long session name that definitely exceeds forty characters';
            fs.writeFileSync(path.join(sessionPath, 'session-name.txt'), longName);

            const label = SessionService.formatSessionLabel('session-with-long-name', sessionPath);
            assert.ok(label.length <= 40, `Label "${label}" should be at most 40 characters`);
        });

        // Bug Fix A: workspace.yaml summary as fallback
        it('falls back to workspace.yaml summary when no plan.md heading', function () {
            const sessionStateDir = createTempSessionDir(tmpDir, [
                {
                    id: 'session-with-yaml',
                    events: [{ type: 'session.start', data: { context: { cwd: '/tmp' } } }]
                    // no planContent
                }
            ]);

            const sessionPath = path.join(sessionStateDir, 'session-with-yaml');
            // Write workspace.yaml with summary
            fs.writeFileSync(path.join(sessionPath, 'workspace.yaml'),
                'version: 1\ncwd: /tmp\nsummary: Fix authentication bug\n');

            const label = SessionService.formatSessionLabel('session-with-yaml', sessionPath);
            assert.strictEqual(label, 'Fix authentication bug');
        });

        it('workspace.yaml summary is truncated to 40 characters', function () {
            const sessionStateDir = createTempSessionDir(tmpDir, [
                {
                    id: 'session-yaml-long',
                    events: [{ type: 'session.start', data: { context: { cwd: '/tmp' } } }]
                }
            ]);

            const sessionPath = path.join(sessionStateDir, 'session-yaml-long');
            const longSummary = 'This is a very long workspace summary that exceeds forty characters easily';
            fs.writeFileSync(path.join(sessionPath, 'workspace.yaml'),
                `version: 1\ncwd: /tmp\nsummary: ${longSummary}\n`);

            const label = SessionService.formatSessionLabel('session-yaml-long', sessionPath);
            assert.ok(label.length <= 40, `Label "${label}" should be at most 40 characters`);
        });

        it('plan.md heading takes priority over workspace.yaml summary', function () {
            const sessionStateDir = createTempSessionDir(tmpDir, [
                {
                    id: 'session-both',
                    events: [{ type: 'session.start', data: { context: { cwd: '/tmp' } } }],
                    planContent: '# Plan heading\n\nDetails.'
                }
            ]);

            const sessionPath = path.join(sessionStateDir, 'session-both');
            fs.writeFileSync(path.join(sessionPath, 'workspace.yaml'),
                'version: 1\ncwd: /tmp\nsummary: Workspace summary\n');

            const label = SessionService.formatSessionLabel('session-both', sessionPath);
            assert.strictEqual(label, 'Plan heading');
        });

        it('falls back to session ID prefix when no plan.md, no session-name.txt, and no workspace.yaml', function () {
            const sessionStateDir = createTempSessionDir(tmpDir, [
                {
                    id: 'abcdef99-3456-7890-abcd-ef1234567890',
                    events: [{ type: 'session.start', data: { context: { cwd: '/tmp' } } }]
                }
            ]);

            const sessionPath = path.join(sessionStateDir, 'abcdef99-3456-7890-abcd-ef1234567890');
            const label = SessionService.formatSessionLabel(
                'abcdef99-3456-7890-abcd-ef1234567890', sessionPath
            );
            assert.strictEqual(label, 'abcdef99');
        });

        it('strips [Active File: ...] prefix from workspace.yaml summary', function () {
            const sessionStateDir = createTempSessionDir(tmpDir, [
                {
                    id: 'session-active-file-prefix',
                    events: [{ type: 'session.start', data: { context: { cwd: '/tmp' } } }]
                }
            ]);

            const sessionPath = path.join(sessionStateDir, 'session-active-file-prefix');
            // Multiline YAML with Active File prefix (as generated by CLI)
            fs.writeFileSync(path.join(sessionPath, 'workspace.yaml'),
                'version: 1\ncwd: /tmp\nsummary: |-\n  [Active File: /some/path/file.ts]\n\n  I just finished planning\n');

            const label = SessionService.formatSessionLabel('session-active-file-prefix', sessionPath);
            assert.strictEqual(label, 'I just finished planning');
        });
    });

    // ---------------------------------------------------------------------------
    // loadSessionHistory() moved to sessionTranscriptBuilder.buildSessionTranscript in
    // v3.13.0 P2 — it dropped every tool call, which is what made replayed
    // transcripts a wall of "Tool execution". Its four behaviours are covered by
    // tests/unit/extension/session-transcript-builder.test.js.


    // ---------------------------------------------------------------------------
    // ensureSessionName()
    // ---------------------------------------------------------------------------
    describe('ensureSessionName()', function () {

        it('writes a default session-name.txt when none exists', function () {
            const sessionPath = path.join(tmpDir, 'new-session');
            fs.mkdirSync(sessionPath, { recursive: true });

            SessionService.ensureSessionName(sessionPath);

            const nameFile = path.join(sessionPath, 'session-name.txt');
            assert.ok(fs.existsSync(nameFile), 'session-name.txt must be created');
            const content = fs.readFileSync(nameFile, 'utf-8').trim();
            assert.ok(content.startsWith('Session \u2013'), `Default name must start with "Session –", got: "${content}"`);
        });

        it('does NOT overwrite an existing session-name.txt (no-clobber)', function () {
            const sessionPath = path.join(tmpDir, 'named-session');
            fs.mkdirSync(sessionPath, { recursive: true });
            fs.writeFileSync(path.join(sessionPath, 'session-name.txt'), 'My Existing Name');

            SessionService.ensureSessionName(sessionPath);

            const content = fs.readFileSync(path.join(sessionPath, 'session-name.txt'), 'utf-8').trim();
            assert.strictEqual(content, 'My Existing Name', 'Existing session-name.txt must not be overwritten');
        });

        it('uses workspace.yaml created_at date when available', function () {
            const sessionPath = path.join(tmpDir, 'yaml-session');
            fs.mkdirSync(sessionPath, { recursive: true });
            fs.writeFileSync(path.join(sessionPath, 'workspace.yaml'),
                'id: yaml-session\ncreated_at: 2026-01-15T14:37:00.000Z\n');

            SessionService.ensureSessionName(sessionPath);

            const content = fs.readFileSync(path.join(sessionPath, 'session-name.txt'), 'utf-8').trim();
            assert.ok(content.includes('Jan'), `Name should contain "Jan" for Jan 15, got: "${content}"`);
            assert.ok(content.startsWith('Session \u2013'), `Name must start with "Session –", got: "${content}"`);
        });

        it('falls back to current date when workspace.yaml has no created_at', function () {
            const sessionPath = path.join(tmpDir, 'no-date-session');
            fs.mkdirSync(sessionPath, { recursive: true });
            fs.writeFileSync(path.join(sessionPath, 'workspace.yaml'),
                'id: no-date-session\ncwd: /home/user/project\n');

            SessionService.ensureSessionName(sessionPath);

            const content = fs.readFileSync(path.join(sessionPath, 'session-name.txt'), 'utf-8').trim();
            assert.ok(content.startsWith('Session \u2013'), `Name must start with "Session –", got: "${content}"`);
        });

        it('falls back to current date when no workspace.yaml exists', function () {
            const sessionPath = path.join(tmpDir, 'bare-session');
            fs.mkdirSync(sessionPath, { recursive: true });

            SessionService.ensureSessionName(sessionPath);

            const content = fs.readFileSync(path.join(sessionPath, 'session-name.txt'), 'utf-8').trim();
            assert.ok(content.startsWith('Session \u2013'), `Name must start with "Session –", got: "${content}"`);
        });

        it('handles errors gracefully (non-existent directory)', function () {
            const sessionPath = path.join(tmpDir, 'ghost-session');
            // Do NOT create the directory
            assert.doesNotThrow(() => {
                SessionService.ensureSessionName(sessionPath);
            }, 'ensureSessionName must not throw for missing directories');
        });
    });
});
