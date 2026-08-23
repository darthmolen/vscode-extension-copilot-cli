/**
 * SdkSessionBackend — forwarding permission requests to the host (IN-3 scope item 4).
 *
 * The mapper proves the shapes; this proves the traffic. A Copilot request reaches
 * the requester as ACP, the host's answer comes back as a Copilot decision, and —
 * the part that matters most — every way of NOT getting an answer denies.
 *
 * "Deny" is `{ kind: 'user-not-available' }`, the SDK's own first-class kind for it,
 * rather than a plain reject: it says *why* there was no approval, which is what a
 * model needs to decide whether to try something else or stop.
 *
 * Ordering fact this depends on: `setPermissionHandler` has to run BEFORE
 * `manager.start()`, because the handler is passed in the session config. A handler
 * installed afterwards would apply to the next session, not this one.
 */

const { describe, it, beforeEach } = require('mocha');
const { expect } = require('chai');
const path = require('path');

const { SdkSessionBackend } = require(path.join(__dirname, '../../..', 'out', 'acp', 'SdkSessionBackend.js'));
const MAPPER = require(path.join(__dirname, '../../..', 'out', 'acp', 'permissionMapper.js'));

const SHELL_REQUEST = {
    kind: 'shell',
    toolCallId: 'tc-9',
    fullCommandText: 'git push --force',
    intention: 'Publish the branch',
    commands: [{ identifier: 'git push', readOnly: false }],
    possiblePaths: [],
    possibleUrls: [],
    hasWriteFileRedirection: false,
    canOfferSessionApproval: true
};

/** A manager stand-in that records when the permission handler was installed. */
function makeManager(over = {}) {
    const noSub = { dispose() {} };
    return {
        order: [],
        permissionHandler: null,
        setPermissionHandler(h) { this.permissionHandler = h; this.order.push('setPermissionHandler'); },
        async start() { this.order.push('start'); },
        getSessionId() { return 'copilot-session-1'; },
        async sendMessage() {},
        onDidMessageDelta() { return noSub; },
        onDidReceiveReasoningDelta() { return noSub; },
        onDidStartTool() { return noSub; },
        onDidUpdateTool() { return noSub; },
        onDidCompleteTool() { return noSub; },
        onDidStartSubagent() { return noSub; },
        onDidSubagentMessage() { return noSub; },
        onDidCompleteSubagent() { return noSub; },
        onDidUpdateTodos() { return noSub; },
        onDidProduceDiff() { return noSub; },
        onDidUpdateUsage() { return noSub; },
        onDidReceiveError() { return noSub; },
        getCurrentMode() { return 'work'; },
        async abortMessage() {},
        async enablePlanMode() {},
        async disablePlanMode() {},
        ...over
    };
}

/** Answer as a host would: the full double-nested `{ outcome: { outcome, optionId } }`. */
const answers = optionId => async () => ({ outcome: { outcome: 'selected', optionId } });

describe('SdkSessionBackend — permission forwarding (IN-3)', () => {
    let manager;
    beforeEach(() => { manager = makeManager(); });

    describe('the handler is installed in time', () => {
        it('sets the permission handler before starting the manager', async () => {
            await SdkSessionBackend.start(manager);
            expect(manager.order).to.deep.equal(['setPermissionHandler', 'start']);
        });

        /**
         * `client.ts` derives the wire flag `requestPermission` from whether a handler
         * was supplied. Installing one conditionally — only once a requester appears —
         * would leave sessions that told the CLI nobody would answer, and every request
         * on them hangs pending forever.
         */
        it('installs it unconditionally, before any requester exists', async () => {
            await SdkSessionBackend.start(manager);
            expect(manager.permissionHandler).to.be.a('function');
        });
    });

    describe('a request reaches the host and its answer comes back', () => {
        it('arrives at the requester as an ACP request for this session', async () => {
            const backend = await SdkSessionBackend.start(manager);
            let seen = null;
            backend.setPermissionRequester(async req => { seen = req; return { outcome: { outcome: 'cancelled' } }; });

            await manager.permissionHandler(SHELL_REQUEST, { sessionId: 'copilot-session-1' });

            expect(seen.sessionId).to.equal('copilot-session-1');
            expect(seen.toolCall.kind).to.equal('execute');
            expect(seen.toolCall.title).to.include('git push --force');
            expect(seen.options.map(o => o.kind)).to.deep.equal(['allow_once', 'allow_always', 'reject_once']);
        });

        it('turns an allow-once selection into a Copilot approval', async () => {
            const backend = await SdkSessionBackend.start(manager);
            backend.setPermissionRequester(answers(MAPPER.PERMISSION_OPTION_IDS.allowOnce));

            expect(await manager.permissionHandler(SHELL_REQUEST, {}))
                .to.deep.equal({ kind: 'approve-once' });
        });

        it('turns an allow-always selection into a session-scoped approval', async () => {
            const backend = await SdkSessionBackend.start(manager);
            backend.setPermissionRequester(answers(MAPPER.PERMISSION_OPTION_IDS.allowAlways));

            expect(await manager.permissionHandler(SHELL_REQUEST, {})).to.deep.equal({
                kind: 'approve-for-session',
                approval: { kind: 'commands', commandIdentifiers: ['git push'] }
            });
        });

        it('turns a rejection into a rejection', async () => {
            const backend = await SdkSessionBackend.start(manager);
            backend.setPermissionRequester(answers(MAPPER.PERMISSION_OPTION_IDS.rejectOnce));

            expect(await manager.permissionHandler(SHELL_REQUEST, {})).to.deep.equal({ kind: 'reject' });
        });

        /**
         * Copilot leaves `toolCallId` optional on every variant; ACP requires it. The
         * substitute must also be distinct per request, or a host that keys its open
         * prompts by tool call id would collapse two questions into one.
         */
        it('substitutes a distinct id when the CLI omitted toolCallId', async () => {
            const backend = await SdkSessionBackend.start(manager);
            const ids = [];
            backend.setPermissionRequester(async req => {
                ids.push(req.toolCall.toolCallId);
                return { outcome: { outcome: 'cancelled' } };
            });

            const anonymous = { ...SHELL_REQUEST };
            delete anonymous.toolCallId;
            await manager.permissionHandler(anonymous, {});
            await manager.permissionHandler(anonymous, {});

            expect(ids[0]).to.be.a('string').with.length.greaterThan(0);
            expect(ids[1]).to.not.equal(ids[0]);
        });
    });

    /**
     * The cycle that matters. Each of these is a way the host fails to answer, and
     * each must deny — never approve. The failure mode being guarded against is
     * "we could not ask, so we went ahead".
     */
    describe('when the host cannot be asked, it denies', () => {
        const DENIED = { kind: 'user-not-available' };

        it('denies when no requester has been installed', async () => {
            await SdkSessionBackend.start(manager);
            expect(await manager.permissionHandler(SHELL_REQUEST, {})).to.deep.equal(DENIED);
        });

        it('denies when the requester throws', async () => {
            const backend = await SdkSessionBackend.start(manager);
            backend.setPermissionRequester(async () => { throw new Error('connection closed'); });
            expect(await manager.permissionHandler(SHELL_REQUEST, {})).to.deep.equal(DENIED);
        });

        it('denies when the requester never settles', async () => {
            const backend = await SdkSessionBackend.start(manager, undefined, { timeoutMs: 20 });
            backend.setPermissionRequester(() => new Promise(() => {}));
            expect(await manager.permissionHandler(SHELL_REQUEST, {})).to.deep.equal(DENIED);
        });

        /** A request that has been answered has not failed, however unusable the answer. */
        it('does not treat an uninterpretable answer as a failure to ask', async () => {
            const backend = await SdkSessionBackend.start(manager);
            backend.setPermissionRequester(async () => ({ outcome: { outcome: 'selected', optionId: 'invented' } }));
            expect(await manager.permissionHandler(SHELL_REQUEST, {})).to.deep.equal({ kind: 'reject' });
        });
    });

    /**
     * The unattended escape hatch. An agent driven by a script has no user to ask,
     * and denying every request would make it useless — so `yolo` flips the fallback,
     * and ONLY the fallback. A host that is reachable is still asked, and its answer
     * still stands.
     */
    describe('yolo flips the fallback from deny to approve', () => {
        const yolo = () => SdkSessionBackend.start(manager, undefined, { fallback: 'approve-once', timeoutMs: 20 });

        it('approves when no requester has been installed', async () => {
            await yolo();
            expect(await manager.permissionHandler(SHELL_REQUEST, {})).to.deep.equal({ kind: 'approve-once' });
        });

        it('approves when the requester throws', async () => {
            const backend = await yolo();
            backend.setPermissionRequester(async () => { throw new Error('connection closed'); });
            expect(await manager.permissionHandler(SHELL_REQUEST, {})).to.deep.equal({ kind: 'approve-once' });
        });

        it('approves when the requester never settles', async () => {
            const backend = await yolo();
            backend.setPermissionRequester(() => new Promise(() => {}));
            expect(await manager.permissionHandler(SHELL_REQUEST, {})).to.deep.equal({ kind: 'approve-once' });
        });

        it('still defers to a host that does answer', async () => {
            const backend = await yolo();
            backend.setPermissionRequester(answers(MAPPER.PERMISSION_OPTION_IDS.rejectOnce));
            expect(await manager.permissionHandler(SHELL_REQUEST, {})).to.deep.equal({ kind: 'reject' });
        });

        it('is off unless asked for', async () => {
            await SdkSessionBackend.start(manager);
            expect(await manager.permissionHandler(SHELL_REQUEST, {})).to.deep.equal({ kind: 'user-not-available' });
        });
    });
});
