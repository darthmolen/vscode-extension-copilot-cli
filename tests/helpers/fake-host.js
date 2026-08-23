/**
 * A HostBridge with no VS Code behind it.
 *
 * Every suite that constructs an SDKSessionManager outside the extension host
 * needs one of these. Three copies had already appeared; this is the shared one.
 *
 * It will matter more shortly: the plan to drop the manager's
 * `createVSCodeHostBridge` fallback makes the bridge a required constructor
 * argument, at which point ~13 further construction sites need a host. Having
 * one helper to point them at is the difference between a mechanical edit and a
 * fourteenth inline stub. See planning/backlog/hostbridge-split-and-fallback-seam.md.
 */

const path = require('path');
const os = require('os');

/**
 * @param {object} [over] Fields to override — `config` supplies canned settings,
 *   anything else replaces the corresponding bridge member outright.
 */
function createFakeHost(over = {}) {
    const { config = {}, ...members } = over;
    return {
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        getConfig(key, defaultValue) {
            return Object.prototype.hasOwnProperty.call(config, key) ? config[key] : defaultValue;
        },
        getWorkspaceFolder() { return os.tmpdir(); },
        getGlobalStorageDir() { return path.join(os.tmpdir(), 'fake-global-storage'); },
        showError() {},
        showWarning() {},
        async askSessionRecovery() { return 'new'; },
        ...members
    };
}

/**
 * The bridge the manager used to build for itself.
 *
 * Until the `createVSCodeHostBridge` fallback was removed, a suite that passed a
 * mock `ExtensionContext` and no bridge got a real VS Code bridge reading the
 * `vscode` mock. The suites that did this are the e2e set, and their behaviour
 * depends on those exact values — the workspace folder the mock advertises and the
 * `copilotCLI` settings it answers with.
 *
 * Built FROM the mock rather than restating its values, so the two cannot drift
 * apart: change `vscode-mock.js` and this follows.
 *
 * @param {object} [opts]
 * @param {string} [opts.globalStorageDir] What the mock context's
 *   `globalStorageUri.fsPath` used to supply.
 */
function createVSCodeMockHost({ globalStorageDir } = {}) {
    const { createVSCodeMock } = require('./vscode-mock');
    const vscodeApi = createVSCodeMock();

    return createFakeHost({
        getConfig(key, defaultValue) {
            return vscodeApi.workspace.getConfiguration('copilotCLI').get(key, defaultValue);
        },
        getWorkspaceFolder() {
            return vscodeApi.workspace.workspaceFolders?.[0]?.uri.fsPath;
        },
        getGlobalStorageDir() {
            return globalStorageDir ?? path.join(os.tmpdir(), 'fake-global-storage');
        }
    });
}

module.exports = { createFakeHost, createVSCodeMockHost };
