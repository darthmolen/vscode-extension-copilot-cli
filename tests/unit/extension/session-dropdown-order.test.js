/**
 * The dropdown puts a plan half next to the conversation it belongs to (P4)
 *
 * Sorted by mtime alone, a plan session and its work session land wherever their
 * timestamps put them — often adjacent, often not, and never labelled. So 38% of
 * the rows in this workspace's dropdown are half a conversation presented as a
 * whole one.
 *
 * The child's label must **name its parent**. A native `<select>` shows only the
 * selected option when collapsed, so `↳ Plan` on its own reads as nothing once you
 * have picked it.
 */

const { describe, it } = require('mocha');
const { expect } = require('chai');
const path = require('path');

const { orderSessionsByPairing } = require(
    path.join(__dirname, '../../..', 'out', 'extension', 'session', 'sessionDropdown.js')
);

/**
 * A stand-in index: whatever the caller declares, without touching disk.
 *
 * `known` is the set of ids in the *list being ordered*, which is what the real
 * `resolvePairings` is given — that is what makes an orphan an orphan.
 */
function indexOf(parents, rows = []) {
    const known = new Set(rows.map(r => r.id));
    return {
        roleOf: (id) => parents[id] ? 'plan' : 'work',
        workIdFor: (id) => {
            const parent = parents[id];
            return parent && known.has(parent) ? parent : id;
        }
    };
}

describe('orderSessionsByPairing', () => {
    it('puts a plan half directly after its work session', () => {
        const rows = [
            { id: 'other', label: 'Something else', mtime: 300 },
            { id: 'work', label: 'Rewrite the parser', mtime: 100 },
            { id: 'work-plan', label: 'Rewrite the parser', mtime: 200 }
        ];

        const ordered = orderSessionsByPairing(rows, indexOf({ 'work-plan': 'work' }, rows));

        expect(ordered.map(r => r.id)).to.deep.equal(['other', 'work', 'work-plan']);
    });

    it('orders groups by the newest member, not by the work session alone', () => {
        // The work session is old; its plan half was written a moment ago. The pair
        // belongs at the top — the conversation is what is recent, not the row.
        const rows = [
            { id: 'recent', label: 'Recent', mtime: 500 },
            { id: 'work', label: 'Old work', mtime: 100 },
            { id: 'work-plan', label: 'Old work', mtime: 900 }
        ];

        const ordered = orderSessionsByPairing(rows, indexOf({ 'work-plan': 'work' }, rows));

        expect(ordered.map(r => r.id)).to.deep.equal(['work', 'work-plan', 'recent']);
    });

    it('labels the child with its parent\'s name, not its own', () => {
        const rows = [
            { id: 'work', label: 'Rewrite the parser', mtime: 100 },
            { id: 'work-plan', label: 'Untitled', mtime: 200 }
        ];

        const ordered = orderSessionsByPairing(rows, indexOf({ 'work-plan': 'work' }, rows));

        expect(ordered[1].label).to.equal('↳ Plan: Rewrite the parser');
    });

    it('leaves a work session\'s own label alone', () => {
        const rows = [{ id: 'work', label: 'Rewrite the parser', mtime: 100 }];
        const ordered = orderSessionsByPairing(rows, indexOf({}, rows));
        expect(ordered[0].label).to.equal('Rewrite the parser');
    });

    it('keeps an orphan reachable, as its own group, still marked as a plan half', () => {
        // Its parent was deleted or filtered out by workspace. Hiding it, or
        // bucketing it under an id nobody has, makes it unreachable.
        const rows = [
            { id: 'alive', label: 'Alive', mtime: 100 },
            { id: 'gone-plan', label: 'An orphaned plan', mtime: 200 }
        ];

        const ordered = orderSessionsByPairing(rows, indexOf({ 'gone-plan': 'gone' }, rows));

        expect(ordered.map(r => r.id)).to.include('gone-plan');
        expect(ordered.find(r => r.id === 'gone-plan').label).to.equal('↳ Plan: An orphaned plan');
    });

    it('handles two plan halves under one work session', () => {
        // A second plan pass is a new child record, never an edit to the parent.
        const rows = [
            { id: 'work', label: 'Work', mtime: 100 },
            { id: 'work-plan', label: 'Work', mtime: 200 },
            { id: 'work-plan-2', label: 'Work', mtime: 300 }
        ];

        const ordered = orderSessionsByPairing(
            rows, indexOf({ 'work-plan': 'work', 'work-plan-2': 'work' }, rows)
        );

        expect(ordered.map(r => r.id)).to.deep.equal(['work', 'work-plan-2', 'work-plan']);
    });

    it('loses no rows and invents none', () => {
        const rows = [
            { id: 'a', label: 'A', mtime: 1 },
            { id: 'a-plan', label: 'A', mtime: 2 },
            { id: 'b', label: 'B', mtime: 3 },
            { id: 'orphan-plan', label: 'O', mtime: 4 }
        ];

        const ordered = orderSessionsByPairing(rows, indexOf({ 'a-plan': 'a', 'orphan-plan': 'nope' }, rows));

        expect(ordered).to.have.lengthOf(4);
        expect(ordered.map(r => r.id).sort()).to.deep.equal(['a', 'a-plan', 'b', 'orphan-plan']);
    });

    it('is stable for an empty list', () => {
        expect(orderSessionsByPairing([], indexOf({}))).to.deep.equal([]);
    });

    it('emits only what the dropdown renders — id and label', () => {
        const ordered = orderSessionsByPairing([{ id: 'a', label: 'A', mtime: 1 }], indexOf({}));
        expect(Object.keys(ordered[0]).sort()).to.deep.equal(['id', 'label']);
    });
});
