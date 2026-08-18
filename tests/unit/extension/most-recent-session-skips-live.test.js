/**
 * v3.13.0 Task 7 phase 4 — the ambient pick must not steal a session already open.
 *
 * The serializer makes an ordering hazard reachable for the first time. On window
 * reload VS Code restores chat tabs during activation, and the sidebar then asks
 * for "the most recent session" — which is, overwhelmingly likely, the session the
 * tab just restored, because it was the last one written to. Two hosts would claim
 * it, and the registry's collision warning would fire on an ordinary reload.
 *
 * A session already open in this window is not a candidate for "resume the last
 * one". It is already resumed.
 */

const { describe, it } = require('mocha');
const { expect } = require('chai');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { SessionService } = require(
    path.join(__dirname, '../../..', 'out', 'extension', 'services', 'SessionService.js')
);

/** A session-state directory with sessions of known mtime order. */
function makeSessionDir(sessions) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'session-state-'));
    let stamp = Date.now() - sessions.length * 1000;
    for (const { id, cwd } of sessions) {
        const dir = path.join(root, id);
        fs.mkdirSync(dir);
        // The cwd is read from the first `session.start` event, not from workspace.yaml.
        const start = cwd
            ? JSON.stringify({ type: 'session.start', data: { context: { cwd } } })
            : JSON.stringify({ type: 'session.start', data: {} });
        fs.writeFileSync(path.join(dir, 'events.jsonl'), start + '\n');
        stamp += 1000;
        fs.utimesSync(dir, new Date(stamp), new Date(stamp));
    }
    return root;
}

describe('getMostRecentSession() skips sessions already open', () => {
    it('picks the most recent when nothing is open', () => {
        const dir = makeSessionDir([{ id: 'older' }, { id: 'newest' }]);

        expect(SessionService.getMostRecentSession(dir, '/repo', false, [])).to.equal('newest');
    });

    it('falls through to the next one when the newest is already open in a tab', () => {
        const dir = makeSessionDir([{ id: 'older' }, { id: 'newest' }]);

        expect(SessionService.getMostRecentSession(dir, '/repo', false, ['newest'])).to.equal('older');
    });

    it('returns nothing when every session is already open', () => {
        const dir = makeSessionDir([{ id: 'older' }, { id: 'newest' }]);

        expect(SessionService.getMostRecentSession(dir, '/repo', false, ['older', 'newest'])).to.equal(null,
            'nothing left to resume is a fresh session, not a second host on an open one');
    });

    it('treats the exclusion list as optional, for the callers that have no registry', () => {
        const dir = makeSessionDir([{ id: 'only' }]);

        expect(SessionService.getMostRecentSession(dir, '/repo', false)).to.equal('only');
    });

    it('skips open sessions in the folder-filtered path too', () => {
        const dir = makeSessionDir([
            { id: 'older-here', cwd: '/repo' },
            { id: 'newest-here', cwd: '/repo' },
            { id: 'elsewhere', cwd: '/other' }
        ]);

        expect(SessionService.getMostRecentSession(dir, '/repo', true, ['newest-here'])).to.equal('older-here');
    });

    it('does not fall back to another folder\'s session just because this folder\'s is open', () => {
        const dir = makeSessionDir([
            { id: 'elsewhere', cwd: '/other' },
            { id: 'here', cwd: '/repo' }
        ]);

        expect(SessionService.getMostRecentSession(dir, '/repo', true, ['here'])).to.equal(null,
            'the global fallback exists for "this folder has none", not for "this folder\'s is open"');
    });
});
