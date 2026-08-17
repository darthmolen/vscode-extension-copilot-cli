/**
 * HeadlessHostBridge — the HostBridge for a process with no editor (IN-3 / IN-8)
 *
 * `SDKSessionManager` requires a `HostBridge`. In the extension that is the VS Code
 * one; in the ACP agent process there is no window, no workspace API and no user to
 * prompt. This is that host.
 *
 * The interesting requirements are all about *absence*:
 *   - settings arrive as a snapshot at startup, because there is no configuration
 *     service to query;
 *   - `askSessionRecovery` must resolve rather than await a human, or a resume
 *     failure hangs the agent forever;
 *   - notifications have nowhere to go but the log.
 *
 * Loaded with `require('vscode')` THROWING, the same way the Phase 0 decoupling
 * test does it. A mock would pass even if the module had a hard dependency; only an
 * absent module proves there is none.
 */

const { describe, it } = require('mocha');
const { expect } = require('chai');
const path = require('path');
const os = require('os');
const { withoutVscode } = require('../../helpers/without-vscode');

const BRIDGE_PATH = path.join(__dirname, '../../..', 'out', 'acp', 'HeadlessHostBridge.js');

const load = () => withoutVscode(() => require(BRIDGE_PATH));

function makeBridge(over = {}) {
    const { createHeadlessHostBridge } = load();
    const logged = [];
    const bridge = createHeadlessHostBridge({
        workspaceFolder: '/tmp/agent-workspace',
        globalStorageDir: '/tmp/agent-storage',
        settings: { yolo: true, filterSessionsByFolder: false },
        logger: {
            debug: m => logged.push(['debug', m]),
            info: m => logged.push(['info', m]),
            warn: m => logged.push(['warn', m]),
            error: m => logged.push(['error', m])
        },
        ...over
    });
    return { bridge, logged };
}

describe('HeadlessHostBridge (IN-3 / IN-8)', () => {
    it('loads and constructs when the vscode module is absent', () => {
        const { bridge } = makeBridge();

        expect(bridge).to.be.an('object');
        expect(bridge.getWorkspaceFolder()).to.equal('/tmp/agent-workspace');
    });

    it('serves settings from the startup snapshot', () => {
        const { bridge } = makeBridge();

        expect(bridge.getConfig('yolo')).to.equal(true);
        expect(bridge.getConfig('filterSessionsByFolder')).to.equal(false);
    });

    it('falls back to the caller default for a setting not in the snapshot', () => {
        const { bridge } = makeBridge();

        expect(bridge.getConfig('somethingUnset', 'fallback')).to.equal('fallback');
    });

    /**
     * `false` and `0` are legitimate setting values. A `||` default would replace
     * them, silently turning an explicit opt-out back on.
     */
    it('does not let a falsy snapshot value be replaced by the default', () => {
        const { bridge } = makeBridge({ settings: { yolo: false } });

        expect(bridge.getConfig('yolo', true)).to.equal(false);
    });

    /**
     * The one that would hang the agent. `askSessionRecovery` exists so a UI can ask
     * a human; with no human it must answer on its own. 'new' rather than 'retry'
     * because retrying a resume that already failed its attempts is a loop.
     */
    it('answers session recovery without a user, choosing a new session', async () => {
        const { bridge } = makeBridge();

        const choice = await bridge.askSessionRecovery('sess-1', 'session_expired', 3, new Error('gone'));

        expect(choice).to.equal('new');
    });

    it('routes user-facing notifications to the log, since there is no UI', () => {
        const { bridge, logged } = makeBridge();

        bridge.showError('boom');
        bridge.showWarning('careful');

        expect(logged.some(([lvl, m]) => lvl === 'error' && /boom/.test(m))).to.equal(true);
        expect(logged.some(([lvl, m]) => lvl === 'warn' && /careful/.test(m))).to.equal(true);
    });

    /**
     * Both are optional on HostBridge and must be *absent*, not present-and-empty:
     * the manager checks `createMessageEnhancer?.()` and falls back to a no-op
     * enhancer. There is no editor here, so prompts go through unchanged.
     */
    it('omits the editor-dependent optional members entirely', () => {
        const { bridge } = makeBridge();

        expect(bridge.createMessageEnhancer, 'no editor exists to enhance from').to.equal(undefined);
    });

    it('reports the storage directory it was given', () => {
        const { bridge } = makeBridge();

        expect(bridge.getGlobalStorageDir()).to.equal('/tmp/agent-storage');
    });

    it('defaults the workspace folder to the process cwd when none is supplied', () => {
        const { createHeadlessHostBridge } = load();

        const bridge = createHeadlessHostBridge({
            globalStorageDir: path.join(os.tmpdir(), 'agent-storage'),
            logger: { debug() {}, info() {}, warn() {}, error() {} }
        });

        expect(bridge.getWorkspaceFolder()).to.equal(process.cwd());
    });
});
