const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { CliBundleService } = require('../../../out/extension/services/cliBundleService');

function makeFakeExt(extPath) {
    return {
        extensionPath: extPath,
        globalStorageUri: { fsPath: path.join(os.tmpdir(), 'gs-' + Date.now() + '-' + Math.random().toString(36).slice(2)) }
    };
}

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} };

function setupFakeNodeModules(tmp, copilotVersion = '1.0.44', peerRange = '^1.0.36-0') {
    fs.mkdirSync(path.join(tmp, 'node_modules/@github/copilot-sdk'), { recursive: true });
    fs.writeFileSync(
        path.join(tmp, 'node_modules/@github/copilot-sdk/package.json'),
        JSON.stringify({ peerDependencies: { '@github/copilot': peerRange } })
    );
    if (copilotVersion) {
        fs.mkdirSync(path.join(tmp, 'node_modules/@github/copilot'), { recursive: true });
        fs.writeFileSync(
            path.join(tmp, 'node_modules/@github/copilot/package.json'),
            JSON.stringify({ version: copilotVersion, bin: { copilot: 'npm-loader.js' } })
        );
        fs.writeFileSync(path.join(tmp, 'node_modules/@github/copilot/npm-loader.js'), '');
    }
}

describe('CliBundleService.ensureBundled — inlined peer range (VSIX path)', () => {
    let tmp;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cbs-vsix-'));
        // VSIX is shipped WITHOUT node_modules — there is NO @github/copilot-sdk/package.json on disk.
        // We do not call setupFakeNodeModules() here.
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('uses an injected peerRange when SDK package.json is missing (VSIX install path)', async () => {
        const svc = new CliBundleService(makeFakeExt(tmp), noopLogger, {
            sdkPeerRange: '^1.0.36-0',
            probeSystemCli: () => ({ path: '/usr/local/bin/copilot', version: '1.0.44' }),
            skipManagedInstall: true
        });
        const result = await svc.ensureBundled();
        assert.strictEqual(result.source, 'system');
        assert.strictEqual(result.satisfiesPeerDep, true);
        assert.strictEqual(result.sdkPeerRange, '^1.0.36-0');
    });

    it('throws actionable error when no peerRange is injected AND no node_modules exists', async () => {
        const svc = new CliBundleService(makeFakeExt(tmp), noopLogger, {
            probeSystemCli: () => null,
            skipManagedInstall: true
        });
        let err = null;
        try {
            await svc.ensureBundled();
        } catch (e) {
            err = e;
        }
        assert.ok(err, 'should throw');
        assert.match(err.message, /peer/i, `error should mention peer-dep/range, got: ${err.message}`);
    });
});

describe('CliBundleService.ensureBundled — local node_modules path', () => {
    let tmp;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cbs-'));
        setupFakeNodeModules(tmp);
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('returns source=local with satisfiesPeerDep=true when node_modules has matching version', async () => {
        const svc = new CliBundleService(makeFakeExt(tmp), noopLogger);
        const result = await svc.ensureBundled();

        assert.strictEqual(result.source, 'local');
        assert.strictEqual(result.cliVersion, '1.0.44');
        assert.strictEqual(result.satisfiesPeerDep, true);
        assert.ok(result.cliPath.endsWith('npm-loader.js'),
            `cliPath should end with npm-loader.js, got: ${result.cliPath}`);
        assert.strictEqual(result.sdkPeerRange, '^1.0.36-0');
    });
});

describe('CliBundleService.ensureBundled — system PATH fallback', () => {
    let tmp;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cbs-'));
        // SDK peer-dep present, but no @github/copilot in node_modules
        setupFakeNodeModules(tmp, /* copilotVersion */ null);
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('returns source=system when no node_modules but PATH copilot satisfies', async () => {
        const svc = new CliBundleService(makeFakeExt(tmp), noopLogger, {
            probeSystemCli: () => ({ path: '/usr/local/bin/copilot', version: '1.0.44' }),
            skipManagedInstall: true
        });
        const result = await svc.ensureBundled();

        assert.strictEqual(result.source, 'system');
        assert.strictEqual(result.cliVersion, '1.0.44');
        assert.strictEqual(result.cliPath, '/usr/local/bin/copilot');
        assert.strictEqual(result.satisfiesPeerDep, true);
    });

    it('returns satisfiesPeerDep=false when system CLI is too old (1.0.5 vs ^1.0.36-0)', async () => {
        const svc = new CliBundleService(makeFakeExt(tmp), noopLogger, {
            probeSystemCli: () => ({ path: '/old/copilot', version: '1.0.5' }),
            skipManagedInstall: true
        });
        const result = await svc.ensureBundled();

        assert.strictEqual(result.source, 'system');
        assert.strictEqual(result.cliVersion, '1.0.5');
        assert.strictEqual(result.satisfiesPeerDep, false);
    });
});

describe('CliBundleService.ensureBundled — managed install', () => {
    let tmp;
    let ext;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cbs-'));
        setupFakeNodeModules(tmp, /* copilotVersion */ null);
        ext = makeFakeExt(tmp);
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
        fs.rmSync(ext.globalStorageUri.fsPath, { recursive: true, force: true });
    });

    it('runs npm install into globalStorage when no source satisfies peer-dep', async () => {
        let installed = false;
        let receivedSpec;
        let receivedPrefix;
        const svc = new CliBundleService(ext, noopLogger, {
            probeSystemCli: () => null,
            runNpmInstall: async (prefix, spec) => {
                installed = true;
                receivedSpec = spec;
                receivedPrefix = prefix;
                fs.mkdirSync(path.join(prefix, 'node_modules/@github/copilot'), { recursive: true });
                fs.writeFileSync(
                    path.join(prefix, 'node_modules/@github/copilot/package.json'),
                    JSON.stringify({ version: '1.0.44' })
                );
                fs.writeFileSync(path.join(prefix, 'node_modules/@github/copilot/npm-loader.js'), '');
            }
        });

        const result = await svc.ensureBundled();

        assert.strictEqual(installed, true);
        assert.strictEqual(receivedSpec, '@github/copilot@^1.0.36-0');
        assert.ok(receivedPrefix.startsWith(ext.globalStorageUri.fsPath),
            `prefix ${receivedPrefix} should be under globalStorage ${ext.globalStorageUri.fsPath}`);
        assert.strictEqual(result.source, 'managed');
        assert.strictEqual(result.cliVersion, '1.0.44');
        assert.strictEqual(result.satisfiesPeerDep, true);
        assert.ok(result.cliPath.endsWith('npm-loader.js'));
    });

    it('skips system probe when system has no copilot AND installs', async () => {
        let installed = false;
        const svc = new CliBundleService(ext, noopLogger, {
            probeSystemCli: () => null,
            runNpmInstall: async (prefix) => {
                installed = true;
                fs.mkdirSync(path.join(prefix, 'node_modules/@github/copilot'), { recursive: true });
                fs.writeFileSync(
                    path.join(prefix, 'node_modules/@github/copilot/package.json'),
                    JSON.stringify({ version: '1.0.44' })
                );
                fs.writeFileSync(path.join(prefix, 'node_modules/@github/copilot/npm-loader.js'), '');
            }
        });
        await svc.ensureBundled();
        assert.strictEqual(installed, true);
    });

    it('does not run npm install twice when called concurrently', async () => {
        let installCount = 0;
        const svc = new CliBundleService(ext, noopLogger, {
            probeSystemCli: () => null,
            runNpmInstall: async (prefix) => {
                installCount++;
                await new Promise(r => setTimeout(r, 30));
                fs.mkdirSync(path.join(prefix, 'node_modules/@github/copilot'), { recursive: true });
                fs.writeFileSync(
                    path.join(prefix, 'node_modules/@github/copilot/package.json'),
                    JSON.stringify({ version: '1.0.44' })
                );
                fs.writeFileSync(path.join(prefix, 'node_modules/@github/copilot/npm-loader.js'), '');
            }
        });

        const [a, b] = await Promise.all([svc.ensureBundled(), svc.ensureBundled()]);

        assert.strictEqual(installCount, 1, 'concurrent calls should share a single install');
        assert.strictEqual(a.source, 'managed');
        assert.strictEqual(b.source, 'managed');
    });

    it('reuses existing managed install on subsequent calls', async () => {
        let installCount = 0;
        const svc = new CliBundleService(ext, noopLogger, {
            probeSystemCli: () => null,
            runNpmInstall: async (prefix) => {
                installCount++;
                fs.mkdirSync(path.join(prefix, 'node_modules/@github/copilot'), { recursive: true });
                fs.writeFileSync(
                    path.join(prefix, 'node_modules/@github/copilot/package.json'),
                    JSON.stringify({ version: '1.0.44' })
                );
                fs.writeFileSync(path.join(prefix, 'node_modules/@github/copilot/npm-loader.js'), '');
            }
        });

        await svc.ensureBundled();
        const second = await svc.ensureBundled();

        assert.strictEqual(installCount, 1, 'should only install once across multiple calls');
        assert.strictEqual(second.source, 'managed');
    });
});
