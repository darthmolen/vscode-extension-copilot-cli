/**
 * The order and the labels the session dropdown shows.
 *
 * Sorted by mtime alone, a plan session and the conversation it belongs to land
 * wherever their timestamps put them — often adjacent, often not, and never
 * labelled. Measured, that is 38% of this workspace's rows: half a conversation
 * presented as a whole one.
 *
 * Grouping is done by bucketing on `PairingIndex.workIdFor` in one pass, which is
 * why the index needs no parent→children direction (see `sessionPairing.ts`).
 *
 * Free of `vscode`, like the rest of `session/`.
 */

import type { PairingIndex } from './sessionPairing';

export interface SessionRow {
    id: string;
    /** The label `SessionService.formatSessionLabel` produced for this session. */
    label: string;
    mtime: number;
}

export interface DropdownRow {
    id: string;
    label: string;
}

/** How a plan half announces itself. */
const PLAN_PREFIX = '↳ Plan: ';

export function orderSessionsByPairing(rows: SessionRow[], pairing: PairingIndex): DropdownRow[] {
    const groups = new Map<string, SessionRow[]>();
    for (const row of rows) {
        const groupId = pairing.workIdFor(row.id);
        const group = groups.get(groupId);
        if (group) {
            group.push(row);
        } else {
            groups.set(groupId, [row]);
        }
    }

    // A group is ordered by its newest member, not by its work session. The work
    // session of an active conversation is often the *older* of the two rows —
    // plan mode writes to the plan half — so ranking by the parent alone buries a
    // pair the user was working in a minute ago.
    const ordered = [...groups.entries()].sort(
        (a, b) => newestMtime(b[1]) - newestMtime(a[1])
    );

    const result: DropdownRow[] = [];
    for (const [groupId, members] of ordered) {
        // `roleOf`, not identity with the group id. An orphaned plan half *is* its
        // own group — `workIdFor` returns it to keep it reachable — so matching on
        // the id alone would silently promote it to a work session and drop its
        // mark, which is the exact misrepresentation P4 exists to remove.
        const work = members.find(
            member => member.id === groupId && pairing.roleOf(member.id) === 'work'
        );
        // The child's label must name its *parent*. A native `<select>` shows only
        // the selected option when collapsed, so `↳ Plan` alone reads as nothing
        // once you have picked it. An orphan has no parent label to borrow and
        // falls back to its own, which is still better than an unmarked row.
        const parentLabel = work?.label;

        const plans = members
            .filter(member => member !== work)
            .sort((a, b) => b.mtime - a.mtime);

        for (const member of work ? [work, ...plans] : plans) {
            result.push({
                id: member.id,
                label: member === work
                    ? member.label
                    : `${PLAN_PREFIX}${parentLabel ?? member.label}`
            });
        }
    }
    return result;
}

function newestMtime(members: SessionRow[]): number {
    return members.reduce((newest, member) => Math.max(newest, member.mtime), -Infinity);
}
