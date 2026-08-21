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
