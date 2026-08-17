/**
 * createChatSessionServices — the slash-command services, built per session (v3.13.0 Task 4)
 *
 * These moved out of `registerChatHandlers`, which constructed them *during*
 * registration and assigned them onto the handler context. The tests that matter
 * here are the ones that would have caught the second-surface bug: a service that
 * reads session state must read the state of the session that owns it.
 *
 * The factory takes its window-scoped collaborators injected, so nothing here
 * imports `vscode`.
 */

const { describe, it } = require('mocha');
const { expect } = require('chai');
const path = require('path');

const { createChatSessionServices } = require(
    path.join(__dirname, '../../..', 'out', 'extension', 'session', 'chatSessionServices.js')
);
const { ChatSessionRegistry } = require(
    path.join(__dirname, '../../..', 'out', 'extension', 'session', 'ChatSessionRegistry.js')
);
const { WorkspaceRuntimeState } = require(
    path.join(__dirname, '../../..', 'out', 'backendState.js')
);

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function makeRegistry(over = {}) {
    const planPathCalls = [];
    const sharedMcpConfigService = { name: 'shared-mcp-config' };
    const sharedCliPassthroughService = { name: 'shared-cli-passthrough' };

    const registry = new ChatSessionRegistry({
        workspace: new WorkspaceRuntimeState(),
        logger: silentLogger,
        createServices: createChatSessionServices({
            getMergedMcpServers: () => ({}),
            mcpConfigService: sharedMcpConfigService,
            cliPassthroughService: sharedCliPassthroughService,
            getCliCapability: () => null,
            versionInfo: { extensionVersion: '3.13.0', sdkVersion: '0.3.0' },
            getPlanPath: (sessionId) => {
                planPathCalls.push(sessionId);
                return `/sessions/${sessionId}/plan.md`;
            },
            ...over
        })
    });

    return { registry, planPathCalls, sharedMcpConfigService, sharedCliPassthroughService };
}

describe('createChatSessionServices', () => {
    it('reports usage for the session that owns the handler, not another one', async () => {
        const { registry } = makeRegistry();
        const busy = registry.create('session-busy');
        const idle = registry.create('session-idle');

        busy.state.setSessionActive(true);
        idle.state.setSessionActive(true);
        busy.state.addMessage({ role: 'user', type: 'user', content: 'one' });
        busy.state.addMessage({ role: 'user', type: 'user', content: 'two' });
        busy.state.addMessage({ role: 'assistant', type: 'tool', content: 'bash' });

        const busyUsage = await busy.services.infoHandlers.handleUsage();
        const idleUsage = await idle.services.infoHandlers.handleUsage();

        expect(busyUsage.content).to.contain('**Messages sent**: 3');
        expect(busyUsage.content).to.contain('**Tool calls**: 1');
        expect(idleUsage.content).to.contain('**Messages sent**: 0');
        expect(idleUsage.content).to.contain('**Tool calls**: 0');
    });

    it('resolves the plan of the session that owns the handler', async () => {
        const { registry, planPathCalls } = makeRegistry();
        const host = registry.create('session-xyz');

        await host.services.codeReviewHandlers.handleReview();

        expect(planPathCalls).to.deep.equal(['session-xyz']);
    });

    it('reports no session for a host whose CLI never started', async () => {
        const { registry, planPathCalls } = makeRegistry();
        const pending = registry.create();

        const result = await pending.services.codeReviewHandlers.handleReview();

        expect(result.success).to.equal(false);
        expect(planPathCalls).to.deep.equal([]);
    });

    it('follows the host when it adopts a session id later', async () => {
        const { registry, planPathCalls } = makeRegistry();
        const host = registry.create();

        host.adoptSessionId('session-after-retry');
        await host.services.codeReviewHandlers.handleReview();

        expect(planPathCalls).to.deep.equal(['session-after-retry']);
    });

    it('shares the window-scoped collaborators rather than rebuilding them', () => {
        const { registry, sharedMcpConfigService, sharedCliPassthroughService } = makeRegistry();
        const a = registry.create('session-a');
        const b = registry.create('session-b');

        expect(a.services.mcpConfigService).to.equal(sharedMcpConfigService);
        expect(b.services.mcpConfigService).to.equal(sharedMcpConfigService);
        expect(a.services.cliPassthroughService).to.equal(sharedCliPassthroughService);
        expect(a.services.infoHandlers).to.not.equal(b.services.infoHandlers);
    });
});
