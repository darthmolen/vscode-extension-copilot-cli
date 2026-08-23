/**
 * CopilotAcpAgent — client capabilities (IN-3, walking skeleton cycle 2)
 *
 * The invariant most likely to be "simplified" away later, and the one whose
 * failure is silent.
 *
 * `initialize` carries `clientCapabilities` and is where an agent learns what the
 * client can do — but it is NOT guaranteed to run: the ACP SDK's own
 * `buildSession(cwd).start()` issues `session/new` alone (proven in
 * planning/spikes/acp-agent/FINDINGS-acp-sdk.md). So handlers must work having
 * never been initialized.
 *
 * Why that matters beyond a crash: these capabilities gate whether we forward to
 * `session/request_permission` or fall back to the manager's hardcoded
 * `approveAll`. Branching on an unset capability does not usually throw — it
 * silently auto-approves, which is the same defect class as cli#1607.
 *
 * So: default to the ACP schema's own deny-everything baseline, and let
 * `initialize` UPGRADE it. Never require it.
 */

import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import * as acp from '@agentclientprotocol/sdk';

const require = createRequire(import.meta.url);
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const { CopilotAcpAgent } = require(join(REPO_ROOT, 'out', 'acp', 'CopilotAcpAgent.js'));

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function connect(agent) {
    return acp.client().connect(agent.register(acp.agent()));
}

const initialize = (conn, clientCapabilities) =>
    conn.agent.request('initialize', {
        protocolVersion: acp.PROTOCOL_VERSION,
        ...(clientCapabilities === undefined ? {} : { clientCapabilities })
    });

describe('CopilotAcpAgent — client capabilities (IN-3 cycle 2)', () => {
    let agent;

    beforeEach(() => {
        agent = new CopilotAcpAgent({ logger: silentLogger });
    });

    /** The whole point: a handler running before initialize must not see undefined. */
    it('assumes nothing before initialize has run', () => {
        expect(agent.clientCapabilities, 'must be usable before initialize').to.be.an('object');
        expect(agent.clientCapabilities.fs.readTextFile).to.equal(false);
        expect(agent.clientCapabilities.fs.writeTextFile).to.equal(false);
        expect(agent.clientCapabilities.terminal).to.equal(false);
    });

    it('upgrades to what the client advertises', async () => {
        const conn = connect(agent);

        await initialize(conn, { fs: { readTextFile: true, writeTextFile: false }, terminal: true });

        expect(agent.clientCapabilities.fs.readTextFile).to.equal(true);
        expect(agent.clientCapabilities.terminal).to.equal(true);
    });

    /**
     * PINS AN SDK GUARANTEE, NOT OUR CODE — and says so, because the distinction
     * cost a mutation test to discover.
     *
     * `clientCapabilities` is optional on InitializeRequest, so this looks like it
     * proves our handler defends itself. It does not: the ACP SDK parses params
     * against the generated schemas before a handler runs and fills every documented
     * default, so the field is never actually absent by the time we see it. Replacing
     * our merge with a bare assignment left this green.
     *
     * It is kept because we now DEPEND on that filling — `upgradeCapabilities` is a
     * plain assignment on the strength of it. If an SDK upgrade stops doing it, this
     * is what tells us before a permission check reads undefined.
     */
    it('SDK contract: capability defaults arrive filled when initialize omits them', async () => {
        const conn = connect(agent);

        await initialize(conn, undefined);

        expect(agent.clientCapabilities, 'default was clobbered by an absent field').to.be.an('object');
        expect(agent.clientCapabilities.fs.readTextFile).to.equal(false);
    });

    /** Same category as the test above: the SDK completes a partial advertisement. */
    it('SDK contract: a partial advertisement arrives completed, not sparse', async () => {
        const conn = connect(agent);

        // Says nothing about `terminal`; the SDK fills it from the schema default
        // before our handler sees it, which is why assignment is safe.
        await initialize(conn, { fs: { readTextFile: true, writeTextFile: false } });

        expect(agent.clientCapabilities.terminal, 'unmentioned capability went undefined').to.equal(false);
    });
});
