/**
 * Work↔plan pairing (v3.13.0 P4)
 *
 * Half a conversation, listed as a whole one — 38% of this workspace's dropdown,
 * 22% of the whole store. Plan mode starts a second CLI session, and the only
 * thing connecting it to the conversation it belongs to is that its id ends in
 * `-plan`.
 *
 * **The convention had two readers, and how the second one happened is the whole
 * argument.** It was `sdkSessionManager.ts` alone until Lane A shipped
 * `session/list` over ACP and filtered plan halves with the same
 * `id.endsWith('-plan')` string match — *without knowing the convention existed*.
 * Their unit fixtures held no plan sessions, so the suite was green; a live run
 * listing 909 sessions is what showed it. That is the failure mode a convention
 * has and a contract does not: invisible until it bites, and the second reader
 * learns it by accident.
 *
 * So: one resolver, batch-only, `vscode`-free, with two named consumers — the
 * dropdown here and Lane A's ACP agent, which is a separate process with no
 * extension host.
 *
 * **Batch is the only entry point.** `session/list` walks 909 entries and would
 * call a per-id function for every one; a per-id API that is only ever called in a
 * loop is the shape that grows a cache later, and the cache is where the staleness
 * bugs live. The SDK made the same choice with `sessions.checkInUse`.
 */

const { describe, it, beforeEach, afterEach } = require('mocha');
const { expect } = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolvePairings } = require(
    path.join(__dirname, '../../..', 'out', 'extension', 'session', 'sessionPairing.js')
);

describe('resolvePairings', () => {
    let dir;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pairing-'));
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    function makeSession(id, pairing) {
        fs.mkdirSync(path.join(dir, id), { recursive: true });
        if (pairing) {
            fs.writeFileSync(path.join(dir, id, 'session-pairing.json'), JSON.stringify(pairing), 'utf-8');
        }
    }

    describe('the suffix fallback, which rides indefinitely', () => {
        it('calls a bare session work', () => {
            makeSession('abc');
            const index = resolvePairings(dir, ['abc']);
            expect(index.roleOf('abc')).to.equal('work');
        });

        it('calls an `<id>-plan` session plan', () => {
            makeSession('abc');
            makeSession('abc-plan');
            const index = resolvePairings(dir, ['abc', 'abc-plan']);
            expect(index.roleOf('abc-plan')).to.equal('plan');
        });

        it('groups a plan half under its work session', () => {
            makeSession('abc');
            makeSession('abc-plan');
            const index = resolvePairings(dir, ['abc', 'abc-plan']);
            expect(index.workIdFor('abc-plan')).to.equal('abc');
            expect(index.workIdFor('abc')).to.equal('abc');
        });

        it('covers the ~197 plan halves that already exist and can never be flagged', () => {
            // The CLI's `sessions.*` surface has no mutate path, so the historical
            // corpus cannot be given a record retroactively. The fallback is not a
            // stopgap — it is the only thing that will ever answer for these.
            makeSession('old-1');
            makeSession('old-1-plan');
            const index = resolvePairings(dir, ['old-1', 'old-1-plan']);
            expect(index.roleOf('old-1-plan')).to.equal('plan');
        });
    });

    describe('the record, when there is one', () => {
        it('wins over the suffix', () => {
            makeSession('parent');
            makeSession('child', { workSessionId: 'parent' });
            const index = resolvePairings(dir, ['parent', 'child']);
            expect(index.roleOf('child')).to.equal('plan');
            expect(index.workIdFor('child')).to.equal('parent');
        });

        it('lets a record correct a misleading suffix', () => {
            // A work session a user named `...-plan` is not a plan half. The record
            // is the contract; the suffix is a guess.
            makeSession('really-work-plan', { workSessionId: 'really-work-plan' });
            const index = resolvePairings(dir, ['really-work-plan']);
            expect(index.roleOf('really-work-plan')).to.equal('work');
        });

        it('ignores an unreadable record rather than throwing', () => {
            fs.mkdirSync(path.join(dir, 'abc-plan'), { recursive: true });
            fs.writeFileSync(path.join(dir, 'abc-plan', 'session-pairing.json'), '{ not json', 'utf-8');
            makeSession('abc');
            const index = resolvePairings(dir, ['abc', 'abc-plan']);
            expect(index.roleOf('abc-plan')).to.equal('plan', 'fell back to the suffix');
        });

        it('ignores a record with no workSessionId', () => {
            makeSession('abc');
            makeSession('abc-plan', { somethingElse: true });
            const index = resolvePairings(dir, ['abc', 'abc-plan']);
            expect(index.workIdFor('abc-plan')).to.equal('abc');
        });
    });

    describe('orphans stay reachable', () => {
        it('is its own group when its parent is not in the set', () => {
            // The parent was deleted, or filtered out by workspace. Bucketing under
            // an id nobody has makes the plan half unreachable in the dropdown.
            makeSession('gone-plan');
            const index = resolvePairings(dir, ['gone-plan']);
            expect(index.workIdFor('gone-plan')).to.equal('gone-plan');
        });

        it('is still honestly a plan half', () => {
            makeSession('gone-plan');
            const index = resolvePairings(dir, ['gone-plan']);
            expect(index.roleOf('gone-plan')).to.equal('plan',
                'an orphan is still half a conversation — Lane A filters on this');
        });
    });

    describe('the shape of the API', () => {
        it('exposes no per-id resolver beside the batch one', () => {
            // A per-id API that is only ever called in a loop is the shape that
            // grows a cache later, and the cache is where the staleness bugs live.
            const module = require(
                path.join(__dirname, '../../..', 'out', 'extension', 'session', 'sessionPairing.js')
            );
            expect(Object.keys(module).filter(k => typeof module[k] === 'function'))
                .to.deep.equal(['resolvePairings']);
        });

        it('does not offer planIdsFor — nothing needs parent→children', () => {
            const index = resolvePairings(dir, []);
            expect(index.planIdsFor, 'a full scan behind a plural name becomes a hot path by accident')
                .to.equal(undefined);
        });

        it('answers for an id it was never given, without throwing', () => {
            const index = resolvePairings(dir, ['abc']);
            expect(index.roleOf('never-heard-of-it')).to.equal('work');
            expect(index.workIdFor('never-heard-of-it')).to.equal('never-heard-of-it');
        });

        it('reads each session directory once', () => {
            makeSession('a'); makeSession('a-plan'); makeSession('b');
            const index = resolvePairings(dir, ['a', 'a-plan', 'b']);
            // Repeated questions are answered from memory, not from disk.
            fs.rmSync(dir, { recursive: true, force: true });
            expect(index.roleOf('a-plan')).to.equal('plan');
            expect(index.workIdFor('a-plan')).to.equal('a');
        });

        it('survives a session-state directory that does not exist', () => {
            const index = resolvePairings(path.join(dir, 'nope'), ['a', 'a-plan']);
            expect(index.roleOf('a-plan')).to.equal('plan');
        });
    });
});
