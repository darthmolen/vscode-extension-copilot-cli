/**
 * The plan update, from the CLI's todo table to ACP's `plan` (IN-3 §4c.5).
 *
 * `planUpdate` existed before this, with a green unit test and **no caller anywhere**
 * — so plan mode worked end to end while a host was never told the plan changed. That
 * is why this file tests both halves: the shape AND the wiring. A unit test on a pure
 * mapper proves the first and says nothing about the second.
 *
 * Two mismatches the mapper has to absorb:
 *
 *   ACP `PlanEntry` requires `priority`. The CLI's todo row has no such column, so
 *   one has to be chosen — and chosen visibly, rather than by a silent default that
 *   later reads as real data.
 *
 *   ACP `status` is a closed set (`pending` | `in_progress` | `completed`). The CLI's
 *   is a free-text SQL column the SDK itself calls best-effort, where every field is
 *   optional and a row may be entirely blank.
 */

import { describe, it } from 'mocha';
import { expect } from 'chai';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import * as acp from '@agentclientprotocol/sdk';

const require = createRequire(import.meta.url);
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const M = require(join(REPO_ROOT, 'out', 'acp', 'sessionUpdateMapper.js'));
const { CopilotAcpAgent } = require(join(REPO_ROOT, 'out', 'acp', 'CopilotAcpAgent.js'));

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };
const SID = 'sess-1';

const entriesFor = (todos, dependencies = []) =>
    M.planUpdate(SID, { todos, dependencies }).update.entries;

describe('planUpdate — a todo table becomes an ACP plan (IN-3 §4c.5)', () => {
    it('emits the plan variant, addressed to the session', () => {
        const n = M.planUpdate(SID, { todos: [{ id: 't1', title: 'one' }], dependencies: [] });

        expect(n.sessionId).to.equal(SID);
        expect(n.update.sessionUpdate).to.equal('plan');
    });

    it('uses the todo title as the entry a human reads', () => {
        expect(entriesFor([{ id: 't1', title: 'Write the parser' }])[0].content)
            .to.equal('Write the parser');
    });

    /** Every column is optional, so a title is not guaranteed. */
    it('falls back to the description when there is no title', () => {
        expect(entriesFor([{ id: 't1', description: 'the long form' }])[0].content)
            .to.equal('the long form');
    });

    /**
     * A blank row still has to render as something. Dropping it would silently
     * shorten the plan, which is worse than showing a placeholder.
     */
    it('renders an entirely blank row rather than dropping it', () => {
        const entries = entriesFor([{}]);
        expect(entries).to.have.lengthOf(1);
        expect(entries[0].content).to.be.a('string').with.length.greaterThan(0);
    });

    describe('status, from a free-text column to a closed set', () => {
        const statusOf = raw => entriesFor([{ id: 't', title: 'x', status: raw }])[0].status;

        it('maps the values the CLI actually writes', () => {
            expect(statusOf('completed')).to.equal('completed');
            expect(statusOf('pending')).to.equal('pending');
            expect(statusOf('in_progress')).to.equal('in_progress');
        });

        /** One table, many spellings; a SQL column has no schema to stop that. */
        it('tolerates spelling and casing it did not choose', () => {
            expect(statusOf('In Progress')).to.equal('in_progress');
            expect(statusOf('in-progress')).to.equal('in_progress');
            expect(statusOf('DONE')).to.equal('completed');
            expect(statusOf('complete')).to.equal('completed');
        });

        /**
         * `pending` is the safe unknown: it says "not finished", which is true of
         * anything we cannot classify. Guessing `completed` would tick a box nobody
         * ticked.
         */
        it('treats anything it cannot classify as not-yet-done', () => {
            expect(statusOf('banana')).to.equal('pending');
            expect(statusOf(undefined)).to.equal('pending');
            expect(statusOf('')).to.equal('pending');
        });

        it('only ever emits values ACP defines', () => {
            const legal = ['pending', 'in_progress', 'completed'];
            for (const raw of ['completed', 'done', 'in_progress', 'weird', undefined, '', 'PENDING']) {
                expect(legal, `status for ${JSON.stringify(raw)}`).to.include(statusOf(raw));
            }
        });
    });

    describe('priority, which ACP requires and the CLI does not supply', () => {
        it('gives every entry a priority ACP defines', () => {
            const entries = entriesFor([{ id: 't1', title: 'one' }, { id: 't2', title: 'two' }]);
            for (const e of entries) {
                expect(['high', 'medium', 'low']).to.include(e.priority);
            }
        });

        /**
         * The same for every entry, on purpose. Inventing a spread would make the
         * plan look ranked by something, and a reader would believe it.
         */
        it('does not invent a ranking the source never expressed', () => {
            const entries = entriesFor([
                { id: 't1', title: 'one' },
                { id: 't2', title: 'URGENT: two' },
                { id: 't3', title: 'three' }
            ]);
            expect(new Set(entries.map(e => e.priority)).size).to.equal(1);
        });
    });

    /**
     * ACP has no field for ordering between entries, and the fetch is literally
     * `readSqlTodosWithDependencies` — asking for edges and then discarding them
     * would throw away the only thing that says which step waits on which.
     */
    it('keeps the dependency edges in _meta, where ACP allows extras', () => {
        const entries = entriesFor(
            [{ id: 't1', title: 'one' }, { id: 't2', title: 'two' }],
            [{ todoId: 't2', dependsOn: 't1' }]
        );

        expect(entries[0]._meta).to.equal(undefined);
        expect(entries[1]._meta['copilotCliChat.dependsOn']).to.deep.equal(['t1']);
    });

    it('preserves the order the rows came in', () => {
        expect(entriesFor([
            { id: 'a', title: 'first' }, { id: 'b', title: 'second' }, { id: 'c', title: 'third' }
        ]).map(e => e.content)).to.deep.equal(['first', 'second', 'third']);
    });

    /** Clearing the plan is a state to render, not an absence to ignore. */
    it('maps an emptied plan to an empty entry list', () => {
        expect(entriesFor([])).to.deep.equal([]);
    });
});

/**
 * The half that was missing. Everything above passed before this work too — against
 * a function nothing called.
 */
describe('CopilotAcpAgent — the plan reaches the client (IN-3 §4c.5)', function () {
    this.timeout(10000);

    function harness() {
        const updates = [];
        let emit;
        const backend = {
            sessionId: 'session-a',
            currentModeId: 'work',
            onEvent(listener) { emit = listener; return () => {}; },
            async prompt() {
                emit({ kind: 'plan', todos: [{ id: 't1', title: 'Write the parser', status: 'in_progress' }], dependencies: [] });
                return { stopReason: 'end_turn' };
            },
            setMode: async () => {},
            cancel: async () => {},
            close: async () => {},
            history: async () => [],
            setPermissionRequester() {}
        };
        const agent = new CopilotAcpAgent({ logger: silentLogger, startSession: async () => backend });
        const client = acp.client().onNotification(acp.methods.client.session.update,
            ({ params }) => updates.push(params));
        return { updates, conn: client.connect(agent.register(acp.agent())) };
    }

    it('forwards a plan change as a session/update', async () => {
        const h = harness();
        const { sessionId } = await h.conn.agent.request(acp.methods.agent.session.new,
            { cwd: REPO_ROOT, mcpServers: [] });

        await h.conn.agent.request(acp.methods.agent.session.prompt, {
            sessionId, prompt: [{ type: 'text', text: 'go' }]
        });

        const plans = h.updates.filter(u => u.update.sessionUpdate === 'plan');
        expect(plans, 'no plan update reached the client').to.have.lengthOf(1);
        expect(plans[0].update.entries[0].content).to.equal('Write the parser');
        expect(plans[0].update.entries[0].status).to.equal('in_progress');
    });
});
