/**
 * The composition root's history reader (IN-3 §4c.1).
 *
 * `SdkSessionBackend.history()` delegates to an injected reader, and the agent-level
 * replay tests drive it with a fake. That proves the wiring and nothing about whether
 * a real `events.jsonl` ever turns into turns — which is the half that decides
 * whether a user sees their transcript.
 *
 * This reads a real file off disk, in the real on-disk format, through the real
 * production reader.
 */

const { describe, it, before, after } = require('mocha');
const { expect } = require('chai');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { withoutVscode } = require('../../helpers/without-vscode');

const COMPOSITION_PATH = path.join(__dirname, '../../..', 'out', 'acp', 'createAcpAgent.js');

/** One line of `events.jsonl`, in the shape the CLI actually writes. */
const event = (type, data, timestamp = '2026-08-21T00:00:00.000Z') =>
    JSON.stringify({ type, data, timestamp, id: 'e1', parentId: null });

describe('createAcpAgent — reading a session transcript off disk (IN-3 §4c.1)', () => {
    let stateDir;
    const sessionId = 'session-under-test';

    before(() => {
        stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-history-'));
        fs.mkdirSync(path.join(stateDir, sessionId), { recursive: true });
        fs.writeFileSync(path.join(stateDir, sessionId, 'events.jsonl'), [
            event('session.start', { context: { cwd: '/w' } }),
            event('user.message', { content: 'what is 2+2?' }),
            event('assistant.message', { content: 'four' }),
            event('tool.execution_start', { toolName: 'bash' }),
            event('user.message', { content: 'thanks' })
        ].join('\n') + '\n');
    });

    after(() => fs.rmSync(stateDir, { recursive: true, force: true }));

    const read = () => {
        const { createHistoryReader } = withoutVscode(() => require(COMPOSITION_PATH));
        return createHistoryReader(stateDir)(sessionId);
    };

    it('turns the stored events into turns, oldest first', async () => {
        expect(await read()).to.deep.equal([
            { role: 'user', content: 'what is 2+2?' },
            { role: 'assistant', content: 'four' },
            { role: 'user', content: 'thanks' }
        ]);
    });

    /**
     * `events.jsonl` holds the whole event stream — tool calls, session metadata,
     * reasoning. Replaying all of it would produce a transcript nothing like the
     * conversation that happened.
     */
    it('keeps only what was said, not the whole event log', async () => {
        const turns = await read();
        expect(turns.map(t => t.content)).to.not.include('bash');
        expect(turns).to.have.lengthOf(3);
    });

    /** A session that has never been written to is normal, not an error. */
    it('reads an absent transcript as an empty one', async () => {
        const { createHistoryReader } = withoutVscode(() => require(COMPOSITION_PATH));
        expect(await createHistoryReader(stateDir)('no-such-session')).to.deep.equal([]);
    });

    /** It runs in the agent process, where `vscode` does not exist. */
    it('reads without the vscode module', () => {
        expect(() => withoutVscode(() => require(COMPOSITION_PATH))).to.not.throw();
    });
});

/**
 * The composition root's file reader (IN-3 §4c.4).
 *
 * The backend turns a snapshot pair into diff text through an injected reader, and
 * its own tests drive that with a fake. This is the production one, against real
 * files — including the two absences that mean opposite things.
 */
describe('createAcpAgent — reading the two sides of a diff (IN-3 §4c.4)', () => {
    let dir;
    const read = () => {
        const { readFileTextOrNull } = withoutVscode(() => require(COMPOSITION_PATH));
        return readFileTextOrNull;
    };

    before(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-diff-'));
        fs.writeFileSync(path.join(dir, 'a.ts'), 'const a = 1;\n');
    });

    after(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('reads a file that is there', () => {
        expect(read()(path.join(dir, 'a.ts'))).to.equal('const a = 1;\n');
    });

    /** Distinct from an empty file, which is a real state a diff has to render. */
    it('reads a file that is not there as null, not as empty', () => {
        expect(read()(path.join(dir, 'gone.ts'))).to.equal(null);
    });

    it('reads an empty file as empty rather than as absent', () => {
        fs.writeFileSync(path.join(dir, 'empty.ts'), '');
        expect(read()(path.join(dir, 'empty.ts'))).to.equal('');
    });

    /** A directory is not a file; reading one throws, and that is an absence too. */
    it('treats anything it cannot read as absent rather than throwing', () => {
        expect(() => read()(dir)).to.not.throw();
        expect(read()(dir)).to.equal(null);
    });
});

/**
 * The session store, for `session/list` and `session/delete` (IN-3 §4c.6).
 *
 * `session/delete` removes a directory tree the user cannot get back, and the only
 * thing standing between a session id and `rm -rf` is what this file asserts. The id
 * arrives over a wire from a host we do not control, so it is untrusted input.
 */
describe('createAcpAgent — the session store (IN-3 §4c.6)', () => {
    let stateDir;

    const event = (type, data, timestamp = '2026-08-21T00:00:00.000Z') =>
        JSON.stringify({ type, data, timestamp, id: 'e1', parentId: null });

    const makeSession = (id, cwd) => {
        fs.mkdirSync(path.join(stateDir, id), { recursive: true });
        fs.writeFileSync(path.join(stateDir, id, 'events.jsonl'),
            event('session.start', { context: { cwd } }) + '\n' +
            event('user.message', { content: 'hello' }) + '\n');
    };

    const store = () => withoutVscode(() => require(COMPOSITION_PATH));

    beforeEach(() => {
        stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-store-'));
        makeSession('alpha', '/w/one');
        makeSession('beta', '/w/two');
    });

    afterEach(() => fs.rmSync(stateDir, { recursive: true, force: true }));

    describe('listing', () => {
        it('reports every stored session with its directory', async () => {
            const sessions = await store().createSessionLister(stateDir)({});

            expect(sessions.map(s => s.sessionId).sort()).to.deep.equal(['alpha', 'beta']);
            expect(sessions.find(s => s.sessionId === 'alpha').cwd).to.equal('/w/one');
        });

        /**
         * A host renders this as a picker, and the session someone wants is almost
         * always the one they were last in. The ordering was documented in a comment
         * and asserted nowhere until a mutation reversed it and nothing went red.
         */
        it('reports newest first', async () => {
            const older = path.join(stateDir, 'alpha');
            const newer = path.join(stateDir, 'beta');
            fs.utimesSync(older, new Date('2026-01-01'), new Date('2026-01-01'));
            fs.utimesSync(newer, new Date('2026-08-01'), new Date('2026-08-01'));

            const sessions = await store().createSessionLister(stateDir)({});

            expect(sessions.map(s => s.sessionId)).to.deep.equal(['beta', 'alpha']);
        });

        it('narrows to one directory when asked', async () => {
            const sessions = await store().createSessionLister(stateDir)({ cwd: '/w/two' });

            expect(sessions.map(s => s.sessionId)).to.deep.equal(['beta']);
        });

        /**
         * Plan mode is a TWO-session design: entering it creates a second SDK session
         * at `<id>-plan`, which `sdkSessionManager.ts` itself identifies by that
         * suffix. It is an internal half, not a conversation anyone started — listing
         * it invites a user to open something that only makes sense attached to its
         * work session.
         *
         * Found on a live run, not here: the fixtures had no plan sessions, while the
         * real store was 197 of them in 909.
         */
        it('hides the plan half of a dual-session conversation', async () => {
            makeSession('alpha-plan', '/w/one');

            const sessions = await store().createSessionLister(stateDir)({});

            expect(sessions.map(s => s.sessionId).sort()).to.deep.equal(['alpha', 'beta']);
        });

        /** A session legitimately named ...-plan-something is not a plan half. */
        it('only hides the suffix, not any session mentioning plan', async () => {
            makeSession('alpha-plan-b', '/w/one');

            const sessions = await store().createSessionLister(stateDir)({});

            expect(sessions.map(s => s.sessionId)).to.include('alpha-plan-b');
        });

        it('reports an empty store rather than failing', async () => {
            const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-empty-'));
            expect(await store().createSessionLister(empty)({})).to.deep.equal([]);
            fs.rmSync(empty, { recursive: true, force: true });
        });
    });

    describe('deleting', () => {
        it('removes the session directory', async () => {
            await store().createSessionDeleter(stateDir)('alpha');

            expect(fs.existsSync(path.join(stateDir, 'alpha'))).to.equal(false);
            expect(fs.existsSync(path.join(stateDir, 'beta')), 'took the wrong one too').to.equal(true);
        });

        /**
         * The guard that matters. A session id is untrusted input arriving over a wire,
         * and `path.join(stateDir, '../../..')` resolves outside the store. Without
         * this, one malformed or malicious id deletes something that was never ours.
         */
        it('refuses an id that escapes the session store', async () => {
            const del = store().createSessionDeleter(stateDir);
            const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-bystander-'));
            fs.writeFileSync(path.join(outside, 'precious.txt'), 'do not delete me');

            for (const id of ['../..', `../${path.basename(outside)}`, '/etc', 'alpha/../../..']) {
                let refused = false;
                try { await del(id); } catch { refused = true; }
                expect(refused, `accepted an escaping id: ${id}`).to.equal(true);
            }

            expect(fs.existsSync(path.join(outside, 'precious.txt')), 'deleted outside the store')
                .to.equal(true);
            expect(fs.existsSync(path.join(stateDir, 'alpha')), 'deleted a real session by accident')
                .to.equal(true);
            fs.rmSync(outside, { recursive: true, force: true });
        });

        it('refuses an empty id rather than treating it as the store itself', async () => {
            let refused = false;
            try { await store().createSessionDeleter(stateDir)(''); } catch { refused = true; }

            expect(refused).to.equal(true);
            expect(fs.existsSync(stateDir), 'deleted the whole store').to.equal(true);
        });

        /** Deleting one that is already gone is the state the caller wanted. */
        it('accepts deleting a session that is not there', async () => {
            await store().createSessionDeleter(stateDir)('never-existed');
        });
    });
});
