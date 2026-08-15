/**
 * SDKSessionManager host decoupling
 *
 * Phase 0.1 acceptance criterion: the session manager must be loadable and
 * constructible in a process where the `vscode` module does not exist at all,
 * so it can run inside a separate agent process.
 *
 * These tests deliberately make `require('vscode')` THROW rather than return a
 * mock. A mock would still pass if the module had a hard runtime dependency;
 * only an absent module proves the dependency is gone.
 */

const { describe, it, before, after } = require('mocha');
const { expect } = require('chai');
const path = require('path');
const os = require('os');
const { withoutVscode } = require('../../helpers/without-vscode');

const MANAGER_PATH = path.join(__dirname, '../../..', 'out', 'sdkSessionManager.js');


/** Minimal HostBridge implementation — no vscode anywhere. */
function createFakeHost(overrides = {}) {
    return {
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        getConfig(key, defaultValue) {
            return Object.prototype.hasOwnProperty.call(overrides.config || {}, key)
                ? overrides.config[key]
                : defaultValue;
        },
        getWorkspaceFolder() {
            return overrides.workspaceFolder ?? os.tmpdir();
        },
        getGlobalStorageDir() {
            return overrides.globalStorageDir ?? path.join(os.tmpdir(), 'fake-global-storage');
        },
        showError() {},
        showWarning() {},
        async askSessionRecovery() {
            return 'new';
        },
        ...(overrides.extra || {})
    };
}

describe('SDKSessionManager — host decoupling (Phase 0.1)', () => {
    it('loads as a module when the vscode module is absent', () => {
        const mod = withoutVscode(() => require(MANAGER_PATH));

        expect(mod).to.have.property('SDKSessionManager');
        expect(mod.SDKSessionManager).to.be.a('function');
    });

    it('constructs with an injected host bridge when the vscode module is absent', () => {
        const manager = withoutVscode(() => {
            const { SDKSessionManager } = require(MANAGER_PATH);
            return new SDKSessionManager(undefined, {}, false, undefined, undefined, createFakeHost());
        });

        expect(manager).to.be.an('object');
        expect(manager.isRunning()).to.equal(false);
    });

    it('sources its working directory from the host bridge, not from vscode', () => {
        const workspaceFolder = path.join(os.tmpdir(), 'injected-workspace');
        let asked = 0;

        withoutVscode(() => {
            const { SDKSessionManager } = require(MANAGER_PATH);
            const host = createFakeHost({ workspaceFolder });
            return new SDKSessionManager(undefined, {}, false, undefined, undefined, {
                ...host,
                getWorkspaceFolder() {
                    asked++;
                    return workspaceFolder;
                }
            });
        });

        expect(asked).to.be.greaterThan(0);
    });

    it('reads copilotCLI settings through the injected host bridge', () => {
        const seen = [];

        withoutVscode(() => {
            const { SDKSessionManager } = require(MANAGER_PATH);
            const host = createFakeHost();
            const wrapped = {
                ...host,
                getConfig(key, defaultValue) {
                    seen.push(key);
                    return host.getConfig(key, defaultValue);
                }
            };
            // resumeLastSession=true forces the filterSessionsByFolder read.
            return new SDKSessionManager(undefined, {}, true, undefined, undefined, wrapped);
        });

        expect(seen).to.include('filterSessionsByFolder');
    });
});

describe('SDKSessionManager — construction requires a host', () => {
    it('throws a clear error when given neither a VS Code context nor a HostBridge', () => {
        const { SDKSessionManager } = require(MANAGER_PATH);

        expect(() => new SDKSessionManager(undefined, {}, false))
            .to.throw(/HostBridge|ExtensionContext/i);
    });
});
