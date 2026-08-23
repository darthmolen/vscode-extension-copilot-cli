/**
 * SDKSessionManager — MCP server state travels by event
 *
 * Phase 0.1: the manager wrote MCP tool/status maps straight into the
 * `backendState` singleton, which is a hole in the event contract and would
 * become a cross-process reach once the manager runs in its own process.
 * MCP state must be emitted like every other piece of session state.
 */

const { describe, it, beforeEach } = require('mocha');
const { expect } = require('chai');
const path = require('path');
const os = require('os');
const { withoutVscode } = require('../../helpers/without-vscode');
const { createFakeHost } = require('../../helpers/fake-host');

const MANAGER_PATH = path.join(__dirname, '../../..', 'out', 'sdkSessionManager.js');


/** Builds a manager and drives one raw SDK event through its handler. */
function emitSdkEvent(event) {
    return withoutVscode(() => {
        const { SDKSessionManager } = require(MANAGER_PATH);
        const manager = new SDKSessionManager({}, false, undefined, undefined, createFakeHost());

        const seen = [];
        manager.onDidUpdateMcpServers(payload => seen.push(payload));

        // _handleSDKEvent is the single subscription point for SDK traffic.
        manager._handleSDKEvent(event);
        return seen;
    });
}

describe('SDKSessionManager — MCP state is emitted, not written to global state', () => {
    let seen;

    beforeEach(() => {
        seen = null;
    });

    it('emits every server when the session reports mcp_servers_loaded', () => {
        seen = emitSdkEvent({
            type: 'session.mcp_servers_loaded',
            data: {
                servers: [
                    { name: 'github', status: 'running', tools: ['create_issue', 'list_prs'] },
                    { name: 'fs', status: 'stopped', tools: [] }
                ]
            }
        });

        expect(seen).to.have.lengthOf(1);
        expect(seen[0].servers).to.deep.equal([
            { name: 'github', status: 'running', tools: ['create_issue', 'list_prs'] },
            { name: 'fs', status: 'stopped', tools: [] }
        ]);
    });

    it('emits the changed server when mcp_server_status_changed fires', () => {
        seen = emitSdkEvent({
            type: 'session.mcp_server_status_changed',
            data: { serverName: 'github', status: 'failed', tools: ['create_issue'] }
        });

        expect(seen).to.have.lengthOf(1);
        expect(seen[0].servers).to.deep.equal([
            { name: 'github', status: 'failed', tools: ['create_issue'] }
        ]);
    });

    it('defaults a missing tools list to empty rather than undefined', () => {
        seen = emitSdkEvent({
            type: 'session.mcp_server_status_changed',
            data: { serverName: 'github', status: 'starting' }
        });

        expect(seen[0].servers[0].tools).to.deep.equal([]);
    });

    it('ignores a status change with no server name', () => {
        seen = emitSdkEvent({
            type: 'session.mcp_server_status_changed',
            data: { status: 'running' }
        });

        expect(seen).to.have.lengthOf(0);
    });
});

describe('SDKSessionManager — sticky agent comes from the host, not global state', () => {
    it('consults the host bridge for the active agent when restoring after session recreation', async () => {
        let asked = 0;

        await withoutVscode(async () => {
            const { SDKSessionManager } = require(MANAGER_PATH);
            const manager = new SDKSessionManager({}, false, undefined, undefined, {
                ...createFakeHost(),
                getActiveAgent() {
                    asked++;
                    return null; // nothing to restore; we only assert the source
                }
            });

            await manager._restoreStickyAgentIfNeeded();
        });

        expect(asked).to.equal(1);
    });
});
