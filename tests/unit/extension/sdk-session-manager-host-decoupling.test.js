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
const { createFakeHost } = require('../../helpers/fake-host');

const MANAGER_PATH = path.join(__dirname, '../../..', 'out', 'sdkSessionManager.js');


describe('SDKSessionManager — host decoupling (Phase 0.1)', () => {
    it('loads as a module when the vscode module is absent', () => {
        const mod = withoutVscode(() => require(MANAGER_PATH));

        expect(mod).to.have.property('SDKSessionManager');
        expect(mod.SDKSessionManager).to.be.a('function');
    });

    it('constructs with an injected host bridge when the vscode module is absent', () => {
        const manager = withoutVscode(() => {
            const { SDKSessionManager } = require(MANAGER_PATH);
            return new SDKSessionManager({}, false, undefined, undefined, createFakeHost());
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
            return new SDKSessionManager({}, false, undefined, undefined, {
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
            return new SDKSessionManager({}, true, undefined, undefined, wrapped);
        });

        expect(seen).to.include('filterSessionsByFolder');
    });
});

describe('SDKSessionManager — construction requires a host', () => {
    /**
     * The guard used to accept EITHER a `vscode.ExtensionContext` or a bridge, and
     * built the VS Code bridge itself when given only the former. Now there is one
     * way in. The assertion survives the change because what it is really about has
     * not changed: a manager cannot be built hostless.
     */
    it('throws a clear error when given no HostBridge', () => {
        const { SDKSessionManager } = require(MANAGER_PATH);

        // Matched on the sentence, not on the word `HostBridge` alone: while the
        // fallback existed this threw "Cannot find module 'vscode' … hostBridge.js",
        // and a looser pattern passed on that — reporting success for the failure the
        // change is meant to eliminate.
        expect(() => new SDKSessionManager({}, false))
            .to.throw(/requires an injected HostBridge/i);
    });

    /**
     * The structural claim the whole split exists for: no import path leads from
     * `sdkSessionManager.ts` to `require('vscode')`.
     *
     * Asserted against the module graph rather than the source text, because the
     * hazard being guarded is exactly a *static import that survives a rename* —
     * `sdkSessionManager` importing `createVSCodeHostBridge` from a differently-named
     * file, with the dependency arrow pointing precisely where it did before. A
     * source-string check would pass the moment the identifier moved; loading the
     * module and looking at what came with it would not.
     */
    it('does not pull the VS Code bridge in behind it', () => {
        for (const key of Object.keys(require.cache)) {
            if (key.includes('sdkSessionManager.js') || key.includes('HostBridge.js')) {
                delete require.cache[key];
            }
        }

        // Named explicitly, so this cannot pass by the file simply not existing —
        // which is how it read before the split, proving nothing.
        const vscodeBridge = path.join(__dirname, '../../..', 'out', 'extension', 'vscodeHostBridge.js');
        expect(require('fs').existsSync(vscodeBridge), 'the VS Code bridge should live in its own file')
            .to.equal(true);

        withoutVscode(() => require(MANAGER_PATH));

        expect(Object.keys(require.cache), 'the manager loaded the VS Code bridge')
            .to.not.include(vscodeBridge);
    });
});
