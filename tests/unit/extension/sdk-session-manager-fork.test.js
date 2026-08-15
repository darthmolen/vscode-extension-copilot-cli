/**
 * SDKSessionManager.forkSession — SDK-native fork with a filesystem fallback
 *
 * S1. Fork was a hand-rolled `fs.cpSync` of `~/.copilot/session-state/<id>/`
 * plus a patch of line 0 of `events.jsonl` — a reimplementation of a first-party
 * RPC the SDK has had all along.
 *
 * Two things are load-bearing here and each has its own tests:
 *
 * 1. **The naming contract.** The fork must get a distinct label. The spike
 *    proved passing `name` to the RPC is necessary but NOT sufficient: the CLI
 *    persists it to workspace.yaml as `name:`, but `formatSessionLabel` reads
 *    `session-name.txt` first and workspace.yaml's `summary` (not `name`) third,
 *    so a purely-RPC fork still renders as its id prefix. Both paths therefore
 *    write `session-name.txt` with the same computed string.
 *
 * 2. **The failure policy.** `sessions.fork` is @experimental. Falling back on
 *    *any* error would run a cpSync after a legitimate failure, producing a
 *    WRONG RESULT instead of an error. So: fall back only on method-not-found
 *    (-32601), propagate everything else.
 */

const { describe, it, beforeEach, afterEach } = require('mocha');
const { expect } = require('chai');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { withoutVscode } = require('../../helpers/without-vscode');
const { createFakeHost } = require('../../helpers/fake-host');

const MANAGER_PATH = path.join(__dirname, '../../..', 'out', 'sdkSessionManager.js');

/** A JSON-RPC "method not found" rejection, as an older CLI would send. */
function methodNotFound() {
    const err = new Error('Method not found: sessions.fork');
    err.code = -32601;
    return err;
}

/**
 * Builds a manager with a fake client, runs `fn(manager)`, returns its result.
 * `forkImpl` undefined means the CLI does not expose `sessions.fork` at all.
 */
function withManager(forkImpl, fn) {
    return withoutVscode(async () => {
        const { SDKSessionManager } = require(MANAGER_PATH);
        const manager = new SDKSessionManager(undefined, {}, false, undefined, undefined, createFakeHost());
        manager.client = forkImpl === undefined
            ? { rpc: { sessions: {} } }
            : { rpc: { sessions: { fork: forkImpl } } };
        return fn(manager);
    });
}

describe('SDKSessionManager.forkSession — native RPC path', () => {
    let stateDir;

    beforeEach(() => {
        stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fork-native-'));
    });

    afterEach(() => {
        fs.rmSync(stateDir, { recursive: true, force: true });
    });

    it('calls sessions.fork with the source session id', async () => {
        const calls = [];
        const newId = await withManager(
            async params => { calls.push(params); return { sessionId: 'forked-1' }; },
            m => m.forkSession('parent-1', { sessionStateDir: stateDir })
        );

        expect(newId).to.equal('forked-1');
        expect(calls).to.have.lengthOf(1);
        expect(calls[0].sessionId).to.equal('parent-1');
    });

    it('passes a name derived from the parent label, suffixed "(fork)"', async () => {
        // Parent has an explicit label; formatSessionLabel reads it first.
        const parentDir = path.join(stateDir, 'parent-1');
        fs.mkdirSync(parentDir, { recursive: true });
        fs.writeFileSync(path.join(parentDir, 'session-name.txt'), 'Refactor the router', 'utf-8');

        const calls = [];
        await withManager(
            async params => { calls.push(params); return { sessionId: 'forked-1' }; },
            m => m.forkSession('parent-1', { sessionStateDir: stateDir })
        );

        expect(calls[0].name).to.equal('Refactor the router (fork)');
    });

    it('writes session-name.txt for the fork, because the CLI does not', async () => {
        // The spike proved the CLI persists `name` to workspace.yaml only, and
        // formatSessionLabel never reads that field — so without this write the
        // fork renders as its id prefix.
        const parentDir = path.join(stateDir, 'parent-1');
        fs.mkdirSync(parentDir, { recursive: true });
        fs.writeFileSync(path.join(parentDir, 'session-name.txt'), 'Refactor the router', 'utf-8');

        await withManager(
            async () => ({ sessionId: 'forked-1' }),
            m => m.forkSession('parent-1', { sessionStateDir: stateDir })
        );

        const forkNamePath = path.join(stateDir, 'forked-1', 'session-name.txt');
        expect(fs.existsSync(forkNamePath), 'fork has no session-name.txt').to.equal(true);
        expect(fs.readFileSync(forkNamePath, 'utf-8')).to.equal('Refactor the router (fork)');
    });

    it('gives the fork a label distinct from its parent', async () => {
        const parentDir = path.join(stateDir, 'parent-1');
        fs.mkdirSync(parentDir, { recursive: true });
        fs.writeFileSync(path.join(parentDir, 'session-name.txt'), 'Refactor the router', 'utf-8');

        await withManager(
            async () => ({ sessionId: 'forked-1' }),
            m => m.forkSession('parent-1', { sessionStateDir: stateDir })
        );

        const { SessionService } = require(path.join(__dirname, '../../..', 'out', 'extension', 'services', 'SessionService.js'));
        const parentLabel = SessionService.formatSessionLabel('parent-1', path.join(stateDir, 'parent-1'));
        const forkLabel = SessionService.formatSessionLabel('forked-1', path.join(stateDir, 'forked-1'));

        expect(forkLabel).to.not.equal(parentLabel);
        expect(forkLabel).to.equal('Refactor the router (fork)');
    });
});

describe('SDKSessionManager.forkSession — failure policy', () => {
    let stateDir;

    beforeEach(() => {
        stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fork-policy-'));
        // A minimal source session the cpSync fallback can copy.
        const parentDir = path.join(stateDir, 'parent-1');
        fs.mkdirSync(parentDir, { recursive: true });
        fs.writeFileSync(
            path.join(parentDir, 'events.jsonl'),
            JSON.stringify({ type: 'session.start', data: { sessionId: 'parent-1' } }) + '\n',
            'utf-8'
        );
        fs.writeFileSync(path.join(parentDir, 'session-name.txt'), 'Refactor the router', 'utf-8');
    });

    afterEach(() => {
        fs.rmSync(stateDir, { recursive: true, force: true });
    });

    it('falls back to the filesystem copy when the CLI does not expose fork', async () => {
        const newId = await withManager(
            undefined, // no fork method at all
            m => m.forkSession('parent-1', { sessionStateDir: stateDir })
        );

        expect(newId).to.be.a('string').and.not.equal('parent-1');
        expect(fs.existsSync(path.join(stateDir, newId, 'events.jsonl'))).to.equal(true);
    });

    it('falls back when fork exists but rejects with method-not-found (-32601)', async () => {
        const newId = await withManager(
            async () => { throw methodNotFound(); },
            m => m.forkSession('parent-1', { sessionStateDir: stateDir })
        );

        expect(newId).to.be.a('string').and.not.equal('parent-1');
        expect(fs.existsSync(path.join(stateDir, newId, 'events.jsonl'))).to.equal(true);
    });

    it('names the fork distinctly on the fallback path too', async () => {
        const newId = await withManager(
            undefined,
            m => m.forkSession('parent-1', { sessionStateDir: stateDir })
        );

        const namePath = path.join(stateDir, newId, 'session-name.txt');
        expect(fs.readFileSync(namePath, 'utf-8')).to.equal('Refactor the router (fork)');
    });

    it('propagates a genuine fork failure instead of silently copying', async () => {
        // Falling back here would produce a WRONG RESULT rather than an error.
        let caught = null;
        try {
            await withManager(
                async () => { const e = new Error('Unknown event id'); e.code = -32602; throw e; },
                m => m.forkSession('parent-1', { sessionStateDir: stateDir })
            );
        } catch (e) {
            caught = e;
        }

        expect(caught, 'expected the error to propagate').to.be.an('error');
        expect(caught.message).to.match(/Unknown event id/);
    });
});
