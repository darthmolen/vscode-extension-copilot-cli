/**
 * CopilotAcpAgent — `initialize` (IN-3, walking skeleton cycle 1)
 *
 * Driven through the ACP SDK's own client, connected in-process. No transport,
 * no subprocess, no CLI: `clientApp.connect(agentApp)` exists for exactly this.
 * That matters beyond speed — a hand-rolled harness would only confirm our own
 * reading of the spec back to us, whereas ClientApp is the protocol authors'
 * reading.
 *
 * ESM because the ACP SDK is ESM-only; our production code is CJS and reached
 * through createRequire. Same shape as subagent-palette-drift.test.js.
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

/** An agent wired to an in-process client; returns the client's view. */
function connect(agent) {
    const app = agent.register(acp.agent());
    return acp.client().connect(app);
}

describe('CopilotAcpAgent — initialize (IN-3 cycle 1)', () => {
    let agent;

    beforeEach(() => {
        agent = new CopilotAcpAgent({ logger: silentLogger });
    });

    it('answers initialize with the protocol version the SDK speaks', async () => {
        const conn = connect(agent);

        const res = await conn.agent.request('initialize', {
            protocolVersion: acp.PROTOCOL_VERSION,
            clientCapabilities: {}
        });

        expect(res.protocolVersion).to.equal(acp.PROTOCOL_VERSION);
    });

    /**
     * Advertising a capability we have not built is a lie the client acts on: it
     * surfaces as a confusing failure rather than a clean refusal.
     *
     * The specific expectations move as things get built — `loadSession` was false
     * until `session/load` landed — but the rule does not. Anything still `false`
     * here is false because the code behind it does not exist yet.
     */
    it('advertises only capabilities it actually implements', async () => {
        const conn = connect(agent);

        const res = await conn.agent.request('initialize', {
            protocolVersion: acp.PROTOCOL_VERSION,
            clientCapabilities: {}
        });

        expect(res.agentCapabilities, 'must advertise capabilities explicitly').to.be.an('object');
        expect(res.agentCapabilities.loadSession, 'session/load IS implemented').to.equal(true);

        // Not built: prompts are flattened to text (see textOf), so claiming any of
        // these would invite content we would silently drop.
        const p = res.agentCapabilities.promptCapabilities;
        expect(p.image, 'image prompts are not handled').to.equal(false);
        expect(p.audio, 'audio prompts are not handled').to.equal(false);
        expect(p.embeddedContext, 'embedded context is not handled').to.equal(false);
    });

    it('identifies itself so a host can tell whose agent this is', async () => {
        const conn = connect(agent);

        const res = await conn.agent.request('initialize', {
            protocolVersion: acp.PROTOCOL_VERSION,
            clientCapabilities: {}
        });

        expect(res.agentInfo?.name, 'agentInfo.name identifies us in a host UI').to.be.a('string').and.not.empty;
    });
});
