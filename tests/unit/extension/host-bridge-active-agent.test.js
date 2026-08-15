/**
 * HostBridge — the active agent arrives by injection, not by global reach
 *
 * S3a. `createVSCodeHostBridge().getActiveAgent()` reached into the
 * `backendState` singleton, which is the one host coupling left in the file
 * whose entire purpose is to have none. It is also the only reason Lane B
 * (chat-in-a-tab) would need to touch a Lane A file, once `BackendState`
 * becomes per-session.
 *
 * Whoever constructs the bridge already holds the state — so they supply the
 * accessor instead.
 */

const { describe, it } = require('mocha');
const { expect } = require('chai');
const path = require('path');
const Module = require('module');

const BRIDGE_PATH = path.join(__dirname, '../../..', 'out', 'extension', 'hostBridge.js');

/** Minimal ExtensionContext stand-in — the bridge only reads globalStorageUri. */
const fakeContext = { globalStorageUri: { fsPath: '/tmp/fake-global-storage' } };

/**
 * Runs `fn(bridgeModule)` with `vscode` stubbed for the whole duration — the
 * factory requires it lazily, so the stub must outlive module load. Records
 * every module id required along the way so a test can assert what the bridge
 * does NOT reach for.
 */
function withBridge(fn) {
    const originalRequire = Module.prototype.require;
    const required = [];
    for (const key of Object.keys(require.cache)) {
        if (key.includes(`${path.sep}out${path.sep}`)) {
            delete require.cache[key];
        }
    }
    Module.prototype.require = function (id) {
        required.push(id);
        if (id === 'vscode') {
            return {
                workspace: {
                    getConfiguration: () => ({ get: (_k, d) => d }),
                    workspaceFolders: undefined
                },
                window: {
                    showErrorMessage() {},
                    showWarningMessage() {},
                    createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
                    activeTextEditor: undefined,
                    onDidChangeActiveTextEditor: () => ({ dispose() {} })
                }
            };
        }
        return originalRequire.apply(this, arguments);
    };
    try {
        return fn(require(BRIDGE_PATH), required);
    } finally {
        Module.prototype.require = originalRequire;
    }
}

describe('HostBridge — active agent injection (S3a)', () => {
    it('returns the agent supplied by the host', () => {
        const agent = withBridge(mod => {
            const bridge = mod.createVSCodeHostBridge(fakeContext, {
                getActiveAgent: () => 'planner'
            });
            return bridge.getActiveAgent();
        });

        expect(agent).to.equal('planner');
    });

    it('reflects a later change in the host without rebuilding the bridge', () => {
        const seen = withBridge(mod => {
            let current = 'planner';
            const bridge = mod.createVSCodeHostBridge(fakeContext, {
                getActiveAgent: () => current
            });
            const first = bridge.getActiveAgent();
            current = 'reviewer';
            return [first, bridge.getActiveAgent()];
        });

        expect(seen).to.deep.equal(['planner', 'reviewer']);
    });

    it('reports no active agent when the host supplies no accessor', () => {
        const result = withBridge(mod => {
            const bridge = mod.createVSCodeHostBridge(fakeContext);
            // Optional member: absent, or present and returning null. Either is fine;
            // what must not happen is reaching into global state for an answer.
            return bridge.getActiveAgent ? bridge.getActiveAgent() : null;
        });

        expect(result).to.equal(null);
    });

    it('never requires the backendState module', () => {
        const reachedForState = withBridge((mod, required) => {
            const bridge = mod.createVSCodeHostBridge(fakeContext, { getActiveAgent: () => 'planner' });
            bridge.getActiveAgent();
            return required.filter(id => id.includes('backendState'));
        });

        expect(reachedForState, `bridge required: ${reachedForState.join(', ')}`).to.have.lengthOf(0);
    });
});
