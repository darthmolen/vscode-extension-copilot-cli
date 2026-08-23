/**
 * A deliberate session choice is recorded (v3.13.0 Task 9)
 *
 * `determineSessionToResume` asked `SessionService.getMostRecentSession` — **mtime
 * only**. Switch to an older session, read it without sending anything, reload,
 * and you are back on the newer one, because your choice was never written down.
 *
 * CLAUDE.md's "intentional actions are treated intentionally", applied to session
 * selection: picking a session from the dropdown is a *gesture*; "the most recent
 * one" is a *heuristic*, and the heuristic was quietly winning.
 *
 * Tabs already have their answer — the panel serializer persists each panel's
 * session id. The sidebar had none, which is why this only shows up there.
 */

const { describe, it } = require('mocha');
const { expect } = require('chai');
const path = require('path');

const { chooseSessionToResume } = require(
    path.join(__dirname, '../../..', 'out', 'extension', 'session', 'sessionToResume.js')
);

describe('chooseSessionToResume', () => {
    it('prefers the session the user actually chose', () => {
        const chosen = chooseSessionToResume({
            recorded: 'the-one-i-picked',
            mostRecent: 'the-newest-one',
            isAvailable: () => true
        });
        expect(chosen).to.equal('the-one-i-picked');
    });

    it('falls back to the most recent when nothing was ever recorded', () => {
        const chosen = chooseSessionToResume({
            recorded: null,
            mostRecent: 'the-newest-one',
            isAvailable: () => true
        });
        expect(chosen).to.equal('the-newest-one');
    });

    it('falls back when the recorded session is gone from disk', () => {
        // Sessions are deleted, pruned and moved between machines. A recorded id
        // that no longer resolves must not leave the sidebar empty.
        const chosen = chooseSessionToResume({
            recorded: 'deleted-since',
            mostRecent: 'still-here',
            isAvailable: (id) => id !== 'deleted-since'
        });
        expect(chosen).to.equal('still-here');
    });

    it('falls back when the recorded session is already open somewhere else', () => {
        // A restored tab holds it. Two surfaces on one session is the invariant the
        // whole of v3.13.0 rests on, so the sidebar takes the next best answer.
        const chosen = chooseSessionToResume({
            recorded: 'open-in-a-tab',
            mostRecent: 'free-one',
            isAvailable: (id) => id !== 'open-in-a-tab'
        });
        expect(chosen).to.equal('free-one');
    });

    it('answers null when there is nothing to resume at all', () => {
        expect(chooseSessionToResume({ recorded: null, mostRecent: null, isAvailable: () => true }))
            .to.equal(null);
    });

    it('answers null rather than a recorded session that is unavailable and has no fallback', () => {
        expect(chooseSessionToResume({
            recorded: 'gone',
            mostRecent: null,
            isAvailable: () => false
        })).to.equal(null);
    });

    it('treats an empty recorded value as nothing recorded', () => {
        const chosen = chooseSessionToResume({
            recorded: '   ',
            mostRecent: 'the-newest-one',
            isAvailable: () => true
        });
        expect(chosen).to.equal('the-newest-one');
    });

    it('does not ask whether the fallback is available — the caller already filtered it', () => {
        // `getMostRecentSession` is given the live session ids and skips them, so
        // re-checking here would be a second copy of one rule.
        const asked = [];
        chooseSessionToResume({
            recorded: 'picked',
            mostRecent: 'newest',
            isAvailable: (id) => { asked.push(id); return true; }
        });
        expect(asked).to.deep.equal(['picked']);
    });
});
