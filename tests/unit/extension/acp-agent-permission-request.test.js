/**
 * CopilotAcpAgent — `session/request_permission` end to end (IN-3 scope item 4).
 *
 * Everything before this proved the pieces against fakes. This runs the whole path
 * over a real ACP connection — `acp.client().connect(agent.register(acp.agent()))` —
 * with the client answering the request, so the double-nested reply shape
 * `{ outcome: { outcome, optionId } }` has to round-trip for real. That nesting is
 * exactly the kind of thing a hand-written fake agrees with by construction and the
 * wire does not.
 *
 * **The correction this file also guards.** The continuance doc and the ticket both
 * claimed `clientCapabilities` gates whether we may forward. It does not:
 * `ClientCapabilities` has no permission-shaped field, and on ACP's `Client`
 * interface `requestPermission` is one of only two NON-optional members. Forwarding
 * is therefore unconditional, and the last test here drives a permission with no
 * `initialize` at all to keep it that way.
 *
 * Method names come from `acp.methods`, never string literals — `request()` has an
 * escape-hatch overload that makes a typo'd string compile clean.
 */

import { describe, it } from 'mocha';
import { expect } from 'chai';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import * as acp from '@agentclientprotocol/sdk';

const require = createRequire(import.meta.url);
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const { CopilotAcpAgent } = require(join(REPO_ROOT, 'out', 'acp', 'CopilotAcpAgent.js'));
const { SdkSessionBackend } = require(join(REPO_ROOT, 'out', 'acp', 'SdkSessionBackend.js'));
const { PERMISSION_OPTION_IDS } = require(join(REPO_ROOT, 'out', 'acp', 'permissionMapper.js'));

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

const SHELL_REQUEST = {
    kind: 'shell',
    toolCallId: 'tc-42',
    fullCommandText: 'git push --force',
    intention: 'Publish the branch',
    commands: [{ identifier: 'git push', readOnly: false }],
    possiblePaths: [],
    possibleUrls: [],
    hasWriteFileRedirection: false,
    canOfferSessionApproval: true
};

/**
 * A manager stand-in, so the whole stack below the agent is the real thing: a real
 * `SdkSessionBackend` with the real mapper, driven by the real protocol.
 */
function makeManager(sessionId) {
    const noSub = { dispose() {} };
    return {
        permissionHandler: null,
        setPermissionHandler(h) { this.permissionHandler = h; },
        async start() {},
        getSessionId: () => sessionId,
        async sendMessage() {},
        onDidMessageDelta: () => noSub,
        onDidReceiveReasoningDelta: () => noSub,
        onDidStartTool: () => noSub,
        onDidUpdateTool: () => noSub,
        onDidCompleteTool: () => noSub,
        onDidStartSubagent: () => noSub,
        onDidSubagentMessage: () => noSub,
        onDidCompleteSubagent: () => noSub,
        getCurrentMode: () => 'work',
        async abortMessage() {},
        async enablePlanMode() {},
        async disablePlanMode() {}
    };
}

/**
 * @param answer  what the client replies, or `null` to leave the request unanswered
 */
function makeHarness({ answer, policy = {} } = {}) {
    const manager = makeManager('session-a');
    const seen = [];
    const agent = new CopilotAcpAgent({
        logger: silentLogger,
        startSession: async () => SdkSessionBackend.start(manager, silentLogger, policy)
    });

    const client = acp.client().onRequest(acp.methods.client.session.requestPermission, ({ params }) => {
        seen.push(params);
        return answer(params);
    });

    return { manager, seen, conn: client.connect(agent.register(acp.agent())) };
}

const newSession = conn => conn.agent.request(acp.methods.agent.session.new, { cwd: REPO_ROOT, mcpServers: [] });

const selects = optionId => () => ({ outcome: { outcome: 'selected', optionId } });

describe('CopilotAcpAgent — session/request_permission (IN-3)', function () {
    this.timeout(10000);

    it('puts the request to the client with the options we built', async () => {
        const h = makeHarness({ answer: selects(PERMISSION_OPTION_IDS.allowOnce) });
        await newSession(h.conn);

        await h.manager.permissionHandler(SHELL_REQUEST, {});

        expect(h.seen).to.have.lengthOf(1);
        expect(h.seen[0].sessionId).to.equal('session-a');
        expect(h.seen[0].toolCall.toolCallId).to.equal('tc-42');
        expect(h.seen[0].toolCall.kind).to.equal('execute');
        expect(h.seen[0].toolCall.title).to.include('git push --force');
        expect(h.seen[0].options.map(o => o.kind))
            .to.deep.equal(['allow_once', 'allow_always', 'reject_once']);
    });

    /**
     * The reply is nested twice — a `RequestPermissionResponse` whose `outcome` is a
     * `RequestPermissionOutcome` that itself has an `outcome` discriminator. Reading
     * one layer too few or too many is silent, and lands as an unrecognised option,
     * which rejects. So a passing rejection test would prove nothing here; only a
     * correct approval does.
     */
    it('reads the client\'s choice back through the real double-nested reply', async () => {
        const h = makeHarness({ answer: selects(PERMISSION_OPTION_IDS.allowOnce) });
        await newSession(h.conn);

        expect(await h.manager.permissionHandler(SHELL_REQUEST, {}))
            .to.deep.equal({ kind: 'approve-once' });
    });

    it('carries a session-scoped grant back with its variant payload', async () => {
        const h = makeHarness({ answer: selects(PERMISSION_OPTION_IDS.allowAlways) });
        await newSession(h.conn);

        expect(await h.manager.permissionHandler(SHELL_REQUEST, {})).to.deep.equal({
            kind: 'approve-for-session',
            approval: { kind: 'commands', commandIdentifiers: ['git push'] }
        });
    });

    it('carries a refusal back as a refusal', async () => {
        const h = makeHarness({ answer: selects(PERMISSION_OPTION_IDS.rejectOnce) });
        await newSession(h.conn);

        expect(await h.manager.permissionHandler(SHELL_REQUEST, {})).to.deep.equal({ kind: 'reject' });
    });

    it('carries a dismissed prompt back as cancelled, not as a refusal', async () => {
        const h = makeHarness({ answer: () => ({ outcome: { outcome: 'cancelled' } }) });
        await newSession(h.conn);

        expect(await h.manager.permissionHandler(SHELL_REQUEST, {})).to.deep.equal({ kind: 'cancelled' });
    });

    /** A client that fails the request has not granted anything. */
    it('denies when the client answers with an error', async () => {
        const h = makeHarness({ answer: () => { throw new Error('client refused to handle it'); } });
        await newSession(h.conn);

        expect(await h.manager.permissionHandler(SHELL_REQUEST, {}))
            .to.deep.equal({ kind: 'user-not-available' });
    });

    /**
     * A session outlives the connection that created it, and the client that can
     * answer for it is whichever one is attached NOW. Left pointing at the closed
     * connection, every permission after a reconnect would fail to send and fall
     * back — the session would look alive and silently stop asking.
     */
    it('re-points a live session at the client that reconnects', async () => {
        const manager = makeManager('session-a');
        const agent = new CopilotAcpAgent({
            logger: silentLogger,
            startSession: async () => SdkSessionBackend.start(manager, silentLogger)
        });

        const first = [];
        const firstClient = acp.client().onRequest(acp.methods.client.session.requestPermission, ({ params }) => {
            first.push(params);
            return selects(PERMISSION_OPTION_IDS.rejectOnce)();
        });
        const connA = firstClient.connect(agent.register(acp.agent()));
        await connA.agent.request(acp.methods.agent.session.new, { cwd: REPO_ROOT, mcpServers: [] });

        const second = [];
        const secondClient = acp.client().onRequest(acp.methods.client.session.requestPermission, ({ params }) => {
            second.push(params);
            return selects(PERMISSION_OPTION_IDS.allowOnce)();
        });
        secondClient.connect(agent.register(acp.agent()));

        const decision = await manager.permissionHandler(SHELL_REQUEST, {});

        expect(second, 'the reconnected client was never asked').to.have.lengthOf(1);
        expect(first, 'the stale connection was asked instead').to.have.lengthOf(0);
        expect(decision).to.deep.equal({ kind: 'approve-once' });
    });

    /**
     * The regression guard for the capability correction. `session/new` alone is a
     * legal opening — the SDK's own `buildSession().start()` issues exactly that — so
     * a handler can run before any capability has been advertised. Forwarding must
     * not depend on an `initialize` that may never come.
     */
    it('forwards without an initialize ever happening', async () => {
        const h = makeHarness({ answer: selects(PERMISSION_OPTION_IDS.allowOnce) });

        await newSession(h.conn);
        const decision = await h.manager.permissionHandler(SHELL_REQUEST, {});

        expect(h.seen, 'the request never reached the client').to.have.lengthOf(1);
        expect(decision).to.deep.equal({ kind: 'approve-once' });
    });

    /**
     * A client that advertises nothing is the deny-all default, and that default is
     * about `fs` and `terminal`. It says nothing about permissions, so it must not
     * quietly turn them off.
     */
    it('forwards after an initialize that advertises no capabilities at all', async () => {
        const h = makeHarness({ answer: selects(PERMISSION_OPTION_IDS.allowOnce) });

        await h.conn.agent.request(acp.methods.agent.initialize, {
            protocolVersion: acp.PROTOCOL_VERSION,
            clientCapabilities: {}
        });
        await newSession(h.conn);

        expect(await h.manager.permissionHandler(SHELL_REQUEST, {}))
            .to.deep.equal({ kind: 'approve-once' });
    });
});
