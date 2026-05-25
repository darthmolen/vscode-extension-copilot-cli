const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { CliBundleService, isNpmAvailable, buildNpmInstallSpawn, findSystemNodeRuntime, pickCliPath, ensureNodeExecPath } = require('../../../out/extension/services/cliBundleService');

function makeFakeExt(extPath) {
    return {
        extensionPath: extPath,
        globalStorageUri: { fsPath: path.join(os.tmpdir(), 'gs-' + Date.now() + '-' + Math.random().toString(36).slice(2)) }
    };
}

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} };

// Default injected runtime for existing tests: system Node 24 present, so
// pickCliPath returns the index.js path (which test fixtures seed). Tests
// covering the native-binary fallback can override with their own runtime.
const FAKE_NODE_24_RUNTIME = { nodeExe: '/sys/node', nodeMajorVersion: 24, npmCliJs: null };
const fakeNode24Probe = () => FAKE_NODE_24_RUNTIME;

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
        fs.writeFileSync(path.join(tmp, 'node_modules/@github/copilot/index.js'), '');
    }
}

describe('buildNpmInstallSpawn (node + npm-cli.js strategy, no cmd.exe)', () => {
    const fakeRuntime = {
        nodeExe: 'C:\\Program Files\\nodejs\\node.exe',
        npmCliJs: 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js'
    };

    it('spawns node + npm-cli.js on Windows (bypasses cmd.exe entirely)', () => {
        const result = buildNpmInstallSpawn('C:\\dest', '@github/copilot@^1.0.36', 'win32', fakeRuntime);
        assert.strictEqual(result.command, fakeRuntime.nodeExe,
            'must spawn node.exe directly, not "npm" through cmd.exe');
        assert.strictEqual(result.args[0], fakeRuntime.npmCliJs,
            'first arg must be npm-cli.js — this is what npm.cmd does internally');
        assert.strictEqual(result.options.shell, false,
            'shell:false avoids cmd.exe entirely, which is what strips the ^ from semver ranges');
    });

    it('passes the install spec verbatim (no escaping — shell:false means no shell interpretation)', () => {
        const result = buildNpmInstallSpawn('C:\\dest', '@github/copilot@^1.0.36', 'win32', fakeRuntime);
        assert.ok(result.args.includes('@github/copilot@^1.0.36'),
            'spec must appear in args literally — no shell escaping needed');
        assert.ok(!result.args.includes('@github/copilot@^^1.0.36'),
            'must NOT double the ^ (3.8.5 attempt that failed — cmd.exe consumed both carets)');
    });

    it('spawns npm directly on POSIX (no shell, no cmd.exe, no caret issues there)', () => {
        const result = buildNpmInstallSpawn('/dest', '@github/copilot@^1.0.36', 'linux');
        assert.strictEqual(result.command, 'npm');
        assert.strictEqual(result.options.shell, false);
        assert.ok(result.args.includes('@github/copilot@^1.0.36'));
    });

    it('throws on Windows when no runtime is provided', () => {
        assert.throws(() => buildNpmInstallSpawn('C:\\dest', 'pkg@1.0.0', 'win32'),
            /runtime/i);
    });
});

describe('ensureNodeExecPath (override Electron-Node with system Node 24+ — cross-platform)', () => {
    let origExecPath;
    let origPlatform;
    const noopLog = { info() {} };

    beforeEach(() => {
        origExecPath = process.execPath;
        origPlatform = process.platform;
    });

    afterEach(() => {
        Object.defineProperty(process, 'execPath', { value: origExecPath, configurable: true });
        Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    });

    it('overrides process.execPath on Windows when system Node 24+ is available', () => {
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        Object.defineProperty(process, 'execPath', { value: 'C:\\Program Files\\Code.exe', configurable: true });
        const runtime = { nodeExe: 'C:\\Program Files\\nodejs\\node.exe', nodeMajorVersion: 24, npmCliJs: '...' };

        ensureNodeExecPath(runtime, noopLog);

        assert.strictEqual(process.execPath, 'C:\\Program Files\\nodejs\\node.exe',
            'must override so the SDK spawns the CLI under system Node instead of Electron’s Node');
    });

    it('overrides process.execPath on POSIX too when Node 24+ is available (gate is version, not platform)', () => {
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
        Object.defineProperty(process, 'execPath', { value: '/snap/code/current/code', configurable: true });
        const runtime = { nodeExe: '/usr/bin/node', nodeMajorVersion: 24, npmCliJs: null };

        ensureNodeExecPath(runtime, noopLog);

        assert.strictEqual(process.execPath, '/usr/bin/node',
            'POSIX should also benefit from system Node 24 when present (forward-compat for when CLI requires Node-24-only features)');
    });

    it('is a no-op when nodeMajorVersion is below 24 (Electron’s v22 will be used as-is)', () => {
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        Object.defineProperty(process, 'execPath', { value: 'C:\\Program Files\\Code.exe', configurable: true });
        const runtime = { nodeExe: 'C:\\Program Files\\nodejs\\node.exe', nodeMajorVersion: 22, npmCliJs: '...' };

        ensureNodeExecPath(runtime, noopLog);

        assert.strictEqual(process.execPath, 'C:\\Program Files\\Code.exe',
            'with Node < 24, callers should use the native-binary cliPath instead of pure-Node index.js — no execPath override');
    });

    it('is a no-op when nodeMajorVersion is null (version probe failed)', () => {
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        Object.defineProperty(process, 'execPath', { value: 'C:\\Program Files\\Code.exe', configurable: true });
        const runtime = { nodeExe: 'C:\\node-corrupt\\node.exe', nodeMajorVersion: null, npmCliJs: '...' };

        ensureNodeExecPath(runtime, noopLog);

        assert.strictEqual(process.execPath, 'C:\\Program Files\\Code.exe');
    });

    it('is a no-op when runtime is null (system Node not discoverable)', () => {
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        const before = process.execPath;

        ensureNodeExecPath(null, noopLog);

        assert.strictEqual(process.execPath, before);
    });

    it('is a no-op when execPath already matches runtime.nodeExe (case-insensitive)', () => {
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        Object.defineProperty(process, 'execPath', { value: 'C:\\Program Files\\nodejs\\node.exe', configurable: true });
        const runtime = { nodeExe: 'c:\\program files\\nodejs\\node.exe', nodeMajorVersion: 24, npmCliJs: '...' };

        ensureNodeExecPath(runtime, noopLog);

        assert.strictEqual(process.execPath, 'C:\\Program Files\\nodejs\\node.exe',
            'case-insensitive match should skip the override');
    });

    it('logs the override (auditable trail of why process.execPath changed)', () => {
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        Object.defineProperty(process, 'execPath', { value: 'C:\\Program Files\\Code.exe', configurable: true });
        const runtime = { nodeExe: 'C:\\nodejs\\node.exe', nodeMajorVersion: 24, npmCliJs: '...' };
        const messages = [];
        const logger = { info: (m) => messages.push(m) };

        ensureNodeExecPath(runtime, logger);

        const logged = messages.join('\n');
        assert.ok(logged.includes('C:\\Program Files\\Code.exe'), `expected old path in log, got: ${logged}`);
        assert.ok(logged.includes('C:\\nodejs\\node.exe'), `expected new path in log, got: ${logged}`);
    });

    it('logs the install-Node-24 breadcrumb when gate fails so users understand why fallback was taken', () => {
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        const runtime = { nodeExe: 'C:\\nodejs\\node.exe', nodeMajorVersion: 22, npmCliJs: '...' };
        const messages = [];
        const logger = { info: (m) => messages.push(m) };

        ensureNodeExecPath(runtime, logger);

        const logged = messages.join('\n');
        assert.ok(/24\+|24/.test(logged), `expected log to mention Node 24 requirement, got: ${logged}`);
        assert.ok(logged.includes('v22'), `expected log to surface the detected version (v22.x), got: ${logged}`);
    });
});

describe('findSystemNodeRuntime', () => {
    let tmp;
    let origPlatform;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'node-runtime-'));
        origPlatform = process.platform;
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
        Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    });

    function seedWindowsNodeInstall(dir) {
        fs.writeFileSync(path.join(dir, 'npm.cmd'), '');
        fs.writeFileSync(path.join(dir, 'node.exe'), '');
        fs.mkdirSync(path.join(dir, 'node_modules', 'npm', 'bin'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'), '');
    }

    function seedPosixNodeInstall(dir) {
        fs.writeFileSync(path.join(dir, 'node'), '');
    }

    // Probe factory: dispatches based on whether cmd is a discovery command
    // ('where'/'which') or a version probe (anything else — typically the node binary path).
    function makeProbe({ discovery, version }) {
        return (cmd /* , args */) => {
            if (cmd === 'where' || cmd === 'which') {
                if (discovery instanceof Error) throw discovery;
                return discovery;
            }
            // Version probe: cmd is the resolved nodeExe path
            if (version instanceof Error) throw version;
            return version;
        };
    }

    describe('Windows discovery', () => {
        beforeEach(() => {
            Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        });

        it('returns nodeExe + npmCliJs + nodeMajorVersion derived from npm.cmd location', () => {
            seedWindowsNodeInstall(tmp);
            const probe = makeProbe({
                discovery: path.join(tmp, 'npm.cmd'),
                version: 'v24.0.0\n'
            });
            const result = findSystemNodeRuntime(probe);
            assert.strictEqual(result.nodeExe, path.join(tmp, 'node.exe'));
            assert.strictEqual(result.npmCliJs, path.join(tmp, 'node_modules', 'npm', 'bin', 'npm-cli.js'));
            assert.strictEqual(result.nodeMajorVersion, 24,
                'major version should be parsed from "v24.0.0" output');
        });

        it('uses the first line when `where` returns multiple paths', () => {
            seedWindowsNodeInstall(tmp);
            const multiline = `${path.join(tmp, 'npm.cmd')}\r\nC:\\some\\other\\path\\npm.cmd`;
            const probe = makeProbe({ discovery: multiline, version: 'v24.0.0' });
            const result = findSystemNodeRuntime(probe);
            assert.strictEqual(result.nodeExe, path.join(tmp, 'node.exe'));
        });

        it('returns null when discovery probe throws (npm not on PATH)', () => {
            const probe = makeProbe({ discovery: new Error('not found'), version: '' });
            const result = findSystemNodeRuntime(probe);
            assert.strictEqual(result, null);
        });

        it('returns null when node.exe is missing next to npm.cmd', () => {
            fs.writeFileSync(path.join(tmp, 'npm.cmd'), '');
            const probe = makeProbe({ discovery: path.join(tmp, 'npm.cmd'), version: 'v24.0.0' });
            const result = findSystemNodeRuntime(probe);
            assert.strictEqual(result, null);
        });

        it('returns null when npm-cli.js is missing', () => {
            fs.writeFileSync(path.join(tmp, 'npm.cmd'), '');
            fs.writeFileSync(path.join(tmp, 'node.exe'), '');
            const probe = makeProbe({ discovery: path.join(tmp, 'npm.cmd'), version: 'v24.0.0' });
            const result = findSystemNodeRuntime(probe);
            assert.strictEqual(result, null);
        });
    });

    describe('POSIX discovery', () => {
        beforeEach(() => {
            Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
        });

        it('returns nodeExe + nodeMajorVersion from `which node`, npmCliJs is null', () => {
            seedPosixNodeInstall(tmp);
            const probe = makeProbe({
                discovery: path.join(tmp, 'node'),
                version: 'v24.0.0\n'
            });
            const result = findSystemNodeRuntime(probe);
            assert.strictEqual(result.nodeExe, path.join(tmp, 'node'));
            assert.strictEqual(result.npmCliJs, null,
                'POSIX never needed npmCliJs — buildNpmInstallSpawn only uses it on Windows');
            assert.strictEqual(result.nodeMajorVersion, 24);
        });

        it('returns null when `which node` throws', () => {
            const probe = makeProbe({ discovery: new Error('no node'), version: '' });
            const result = findSystemNodeRuntime(probe);
            assert.strictEqual(result, null);
        });

        it('returns null when the discovered node binary does not exist', () => {
            // discovery returns a path that was never created on disk
            const probe = makeProbe({ discovery: path.join(tmp, 'nonexistent-node'), version: 'v24.0.0' });
            const result = findSystemNodeRuntime(probe);
            assert.strictEqual(result, null);
        });
    });

    describe('version probe', () => {
        beforeEach(() => {
            Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
            seedPosixNodeInstall(tmp);
        });

        it('parses major version from "v22.22.1" (Electron-style)', () => {
            const probe = makeProbe({ discovery: path.join(tmp, 'node'), version: 'v22.22.1\n' });
            const result = findSystemNodeRuntime(probe);
            assert.strictEqual(result.nodeMajorVersion, 22);
        });

        it('parses major version from "20.10.0" (no leading v)', () => {
            const probe = makeProbe({ discovery: path.join(tmp, 'node'), version: '20.10.0' });
            const result = findSystemNodeRuntime(probe);
            assert.strictEqual(result.nodeMajorVersion, 20);
        });

        it('returns nodeMajorVersion=null when version probe throws (treated identically to "too old")', () => {
            const probe = makeProbe({ discovery: path.join(tmp, 'node'), version: new Error('exec fail') });
            const result = findSystemNodeRuntime(probe);
            assert.strictEqual(result.nodeExe, path.join(tmp, 'node'), 'still returns the runtime — just without a version');
            assert.strictEqual(result.nodeMajorVersion, null);
        });

        it('returns nodeMajorVersion=null when version output is unparseable', () => {
            const probe = makeProbe({ discovery: path.join(tmp, 'node'), version: 'garbage output\nno semver here' });
            const result = findSystemNodeRuntime(probe);
            assert.strictEqual(result.nodeMajorVersion, null);
        });
    });
});

describe('pickCliPath (Node-24-availability decision, cross-platform)', () => {
    const pkgDir = path.join('/fake', 'node_modules', '@github', 'copilot');
    let origPlatform;
    let origArch;

    beforeEach(() => {
        origPlatform = process.platform;
        origArch = process.arch;
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
        Object.defineProperty(process, 'arch', { value: origArch, configurable: true });
    });

    it('returns the index.js path when runtime has nodeMajorVersion >= 24', () => {
        const runtime = { nodeExe: '/n', nodeMajorVersion: 24, npmCliJs: null };
        const result = pickCliPath(pkgDir, runtime);
        assert.strictEqual(result, path.join(pkgDir, 'index.js'),
            'with system Node 24+, use the pure-Node entrypoint so the SDK spawns under it');
    });

    it('falls back to the native binary (Windows) when nodeMajorVersion < 24', () => {
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
        const runtime = { nodeExe: '/n', nodeMajorVersion: 22, npmCliJs: null };
        const result = pickCliPath(pkgDir, runtime);
        const expected = path.join(path.dirname(pkgDir), 'copilot-win32-x64', 'copilot.exe');
        assert.strictEqual(result, expected,
            'Windows fallback must point at copilot.exe in the platform-specific sibling package');
    });

    it('falls back to the native binary (Linux) when nodeMajorVersion < 24', () => {
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
        Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
        const runtime = { nodeExe: '/n', nodeMajorVersion: 22, npmCliJs: null };
        const result = pickCliPath(pkgDir, runtime);
        const expected = path.join(path.dirname(pkgDir), 'copilot-linux-x64', 'copilot');
        assert.strictEqual(result, expected,
            'POSIX fallback must point at the bare-name binary (no .exe) in copilot-${platform}-${arch}');
    });

    it('falls back to the native binary when runtime is null (no Node found)', () => {
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
        const result = pickCliPath(pkgDir, null);
        const expected = path.join(path.dirname(pkgDir), 'copilot-win32-x64', 'copilot.exe');
        assert.strictEqual(result, expected);
    });

    it('falls back to the native binary when nodeMajorVersion is null (probe failed)', () => {
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
        Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });
        const runtime = { nodeExe: '/n', nodeMajorVersion: null, npmCliJs: null };
        const result = pickCliPath(pkgDir, runtime);
        const expected = path.join(path.dirname(pkgDir), 'copilot-linux-arm64', 'copilot');
        assert.strictEqual(result, expected);
    });

    it('uses process.arch in the sibling package name (covers x64 / arm64 / etc.)', () => {
        Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
        Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });
        const result = pickCliPath(pkgDir, null);
        assert.ok(result.includes('copilot-darwin-arm64'),
            `expected sibling dir to include darwin-arm64, got: ${result}`);
    });
});

describe('isNpmAvailable (npm pre-flight)', () => {
    let origPlatform;

    beforeEach(() => {
        origPlatform = process.platform;
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    });

    it('does not require shell on non-Windows platforms', () => {
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
        let capturedOpts;
        const result = isNpmAvailable((cmd, args, opts) => {
            capturedOpts = opts;
            return '11.3.0';
        });
        assert.strictEqual(result, true);
        assert.notStrictEqual(capturedOpts.shell, true,
            'non-Windows should not need shell:true (avoid shell-injection surface)');
    });

    it('returns false when the executor throws (npm genuinely missing)', () => {
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        const result = isNpmAvailable(() => { throw new Error('not found'); });
        assert.strictEqual(result, false);
    });
});

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
            findSystemNodeRuntime: fakeNode24Probe,
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
            findSystemNodeRuntime: fakeNode24Probe,
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
        const svc = new CliBundleService(makeFakeExt(tmp), noopLogger, { findSystemNodeRuntime: fakeNode24Probe });
        const result = await svc.ensureBundled();

        assert.strictEqual(result.source, 'local');
        assert.strictEqual(result.cliVersion, '1.0.44');
        assert.strictEqual(result.satisfiesPeerDep, true);
        assert.ok(result.cliPath.endsWith('index.js'),
            `with Node 24+ injected, cliPath should be index.js (pure-Node entrypoint), got: ${result.cliPath}`);
        assert.strictEqual(result.sdkPeerRange, '^1.0.36-0');
    });

    it('returns cliPath ending with index.js on Windows (local)', async () => {
        const origPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        try {
            const svc = new CliBundleService(makeFakeExt(tmp), noopLogger, { findSystemNodeRuntime: fakeNode24Probe });
            const result = await svc.ensureBundled();
            assert.strictEqual(result.source, 'local');
            assert.ok(result.cliPath.endsWith('index.js'),
                `cliPath should end with index.js on Windows, got: ${result.cliPath}`);
        } finally {
            Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
        }
    });

    it('falls back to native binary (copilot.exe) on Windows when system Node 24 is absent', async () => {
        const origPlatform = process.platform;
        const origArch = process.arch;
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
        try {
            // Seed the platform-specific sibling package with copilot.exe
            const siblingDir = path.join(tmp, 'node_modules', '@github', 'copilot-win32-x64');
            fs.mkdirSync(siblingDir, { recursive: true });
            fs.writeFileSync(path.join(siblingDir, 'copilot.exe'), '');

            const svc = new CliBundleService(makeFakeExt(tmp), noopLogger, {
                findSystemNodeRuntime: () => null  // no system Node → fallback to native binary
            });
            const result = await svc.ensureBundled();
            assert.strictEqual(result.source, 'local');
            assert.ok(result.cliPath.endsWith('copilot.exe'),
                `Windows fallback should point at copilot.exe, got: ${result.cliPath}`);
            assert.ok(result.cliPath.includes('copilot-win32-x64'),
                `cliPath should be inside the platform-specific sibling package, got: ${result.cliPath}`);
        } finally {
            Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
            Object.defineProperty(process, 'arch', { value: origArch, configurable: true });
        }
    });

    it('falls back to native binary (copilot) on POSIX when system Node 24 is absent', async () => {
        const origArch = process.arch;
        Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
        try {
            const siblingDir = path.join(tmp, 'node_modules', '@github', `copilot-${process.platform}-x64`);
            fs.mkdirSync(siblingDir, { recursive: true });
            fs.writeFileSync(path.join(siblingDir, 'copilot'), '');

            const svc = new CliBundleService(makeFakeExt(tmp), noopLogger, {
                findSystemNodeRuntime: () => ({ nodeExe: '/usr/bin/node', nodeMajorVersion: 20, npmCliJs: null })
            });
            const result = await svc.ensureBundled();
            assert.strictEqual(result.source, 'local');
            assert.ok(result.cliPath.endsWith(path.join('copilot')),
                `POSIX fallback should point at the bare 'copilot' binary, got: ${result.cliPath}`);
            assert.ok(!result.cliPath.endsWith('.exe'),
                `POSIX fallback must NOT use the .exe extension, got: ${result.cliPath}`);
        } finally {
            Object.defineProperty(process, 'arch', { value: origArch, configurable: true });
        }
    });

    it('returns null (source not local) when cliPath does not exist on disk (defensive check)', async () => {
        // Fixture has index.js but inject runtime with Node 22, forcing fallback
        // to a native binary that we deliberately do NOT seed. The check should
        // fail this source and the service should fall through.
        const svc = new CliBundleService(makeFakeExt(tmp), noopLogger, {
            findSystemNodeRuntime: () => ({ nodeExe: '/n', nodeMajorVersion: 22, npmCliJs: null }),
            probeSystemCli: () => ({ path: '/usr/local/bin/copilot', version: '1.0.44' }),
            skipManagedInstall: true
        });
        const result = await svc.ensureBundled();
        assert.notStrictEqual(result.source, 'local',
            'local source should be rejected when the chosen cliPath file does not exist');
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
            findSystemNodeRuntime: fakeNode24Probe,
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
            findSystemNodeRuntime: fakeNode24Probe,
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
            findSystemNodeRuntime: fakeNode24Probe,
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
                fs.writeFileSync(path.join(prefix, 'node_modules/@github/copilot/index.js'), '');
            }
        });

        const result = await svc.ensureBundled();

        assert.strictEqual(installed, true);
        assert.strictEqual(receivedSpec, '@github/copilot@^1.0.36',
            'install spec must strip the -N prerelease tag so npm picks latest stable');
        assert.ok(receivedPrefix.startsWith(ext.globalStorageUri.fsPath),
            `prefix ${receivedPrefix} should be under globalStorage ${ext.globalStorageUri.fsPath}`);
        assert.strictEqual(result.source, 'managed');
        assert.strictEqual(result.cliVersion, '1.0.44');
        assert.strictEqual(result.satisfiesPeerDep, true);
        assert.ok(result.cliPath.endsWith('index.js'),
            'with Node 24+ injected, pickCliPath returns the index.js entrypoint');
    });

    it('skips system probe when system has no copilot AND installs', async () => {
        let installed = false;
        const svc = new CliBundleService(ext, noopLogger, {
            findSystemNodeRuntime: fakeNode24Probe,
probeSystemCli: () => null,
            runNpmInstall: async (prefix) => {
                installed = true;
                fs.mkdirSync(path.join(prefix, 'node_modules/@github/copilot'), { recursive: true });
                fs.writeFileSync(
                    path.join(prefix, 'node_modules/@github/copilot/package.json'),
                    JSON.stringify({ version: '1.0.44' })
                );
                fs.writeFileSync(path.join(prefix, 'node_modules/@github/copilot/npm-loader.js'), '');
                fs.writeFileSync(path.join(prefix, 'node_modules/@github/copilot/index.js'), '');
            }
        });
        await svc.ensureBundled();
        assert.strictEqual(installed, true);
    });

    it('does not run npm install twice when called concurrently', async () => {
        let installCount = 0;
        const svc = new CliBundleService(ext, noopLogger, {
            findSystemNodeRuntime: fakeNode24Probe,
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
                fs.writeFileSync(path.join(prefix, 'node_modules/@github/copilot/index.js'), '');
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
            findSystemNodeRuntime: fakeNode24Probe,
probeSystemCli: () => null,
            runNpmInstall: async (prefix) => {
                installCount++;
                fs.mkdirSync(path.join(prefix, 'node_modules/@github/copilot'), { recursive: true });
                fs.writeFileSync(
                    path.join(prefix, 'node_modules/@github/copilot/package.json'),
                    JSON.stringify({ version: '1.0.44' })
                );
                fs.writeFileSync(path.join(prefix, 'node_modules/@github/copilot/npm-loader.js'), '');
                fs.writeFileSync(path.join(prefix, 'node_modules/@github/copilot/index.js'), '');
            }
        });

        await svc.ensureBundled();
        const second = await svc.ensureBundled();

        assert.strictEqual(installCount, 1, 'should only install once across multiple calls');
        assert.strictEqual(second.source, 'managed');
    });

    it('uses prerelease-stripped range as managed cache directory key', async () => {
        let receivedPrefix;
        const svc = new CliBundleService(ext, noopLogger, {
            findSystemNodeRuntime: fakeNode24Probe,
probeSystemCli: () => null,
            runNpmInstall: async (prefix) => {
                receivedPrefix = prefix;
                fs.mkdirSync(path.join(prefix, 'node_modules/@github/copilot'), { recursive: true });
                fs.writeFileSync(
                    path.join(prefix, 'node_modules/@github/copilot/package.json'),
                    JSON.stringify({ version: '1.0.52' })
                );
                fs.writeFileSync(path.join(prefix, 'node_modules/@github/copilot/npm-loader.js'), '');
                fs.writeFileSync(path.join(prefix, 'node_modules/@github/copilot/index.js'), '');
            }
        });
        await svc.ensureBundled();
        assert.ok(receivedPrefix.endsWith(path.join('cli', '_1.0.36')),
            `prefix should end with cli/_1.0.36 (stripped), got: ${receivedPrefix}`);
        assert.ok(!receivedPrefix.includes('_1.0.36-0'),
            `prefix should not include the -0 prerelease suffix, got: ${receivedPrefix}`);
    });

    it('preserves original (unstripped) peer range in ResolvedCli.sdkPeerRange', async () => {
        const svc = new CliBundleService(ext, noopLogger, {
            findSystemNodeRuntime: fakeNode24Probe,
probeSystemCli: () => null,
            runNpmInstall: async (prefix) => {
                fs.mkdirSync(path.join(prefix, 'node_modules/@github/copilot'), { recursive: true });
                fs.writeFileSync(
                    path.join(prefix, 'node_modules/@github/copilot/package.json'),
                    JSON.stringify({ version: '1.0.52' })
                );
                fs.writeFileSync(path.join(prefix, 'node_modules/@github/copilot/npm-loader.js'), '');
                fs.writeFileSync(path.join(prefix, 'node_modules/@github/copilot/index.js'), '');
            }
        });
        const result = await svc.ensureBundled();
        assert.strictEqual(result.sdkPeerRange, '^1.0.36-0',
            'ResolvedCli.sdkPeerRange must keep the original peer-dep range for honest satisfies() checks');
    });

    it('does not reuse a stale install sitting in the old (unstripped) directory key', async () => {
        // Pre-populate the OLD directory key (mimics a user upgrading from a broken install).
        const oldDir = path.join(ext.globalStorageUri.fsPath, 'cli', '_1.0.36-0', 'node_modules/@github/copilot');
        fs.mkdirSync(oldDir, { recursive: true });
        fs.writeFileSync(path.join(oldDir, 'package.json'), JSON.stringify({ version: '1.0.36-0' }));
        fs.writeFileSync(path.join(oldDir, 'index.js'), '');
        fs.writeFileSync(path.join(oldDir, 'npm-loader.js'), '');

        let installed = false;
        const svc = new CliBundleService(ext, noopLogger, {
            findSystemNodeRuntime: fakeNode24Probe,
probeSystemCli: () => null,
            runNpmInstall: async (prefix) => {
                installed = true;
                fs.mkdirSync(path.join(prefix, 'node_modules/@github/copilot'), { recursive: true });
                fs.writeFileSync(
                    path.join(prefix, 'node_modules/@github/copilot/package.json'),
                    JSON.stringify({ version: '1.0.52' })
                );
                fs.writeFileSync(path.join(prefix, 'node_modules/@github/copilot/npm-loader.js'), '');
                fs.writeFileSync(path.join(prefix, 'node_modules/@github/copilot/index.js'), '');
            }
        });
        const result = await svc.ensureBundled();
        assert.strictEqual(installed, true, 'broken legacy _1.0.36-0 install must not be reused');
        assert.strictEqual(result.cliVersion, '1.0.52',
            'fresh install should land on latest stable, not the legacy 1.0.36-0');
    });

    it('returns cliPath ending with index.js on Windows (managed)', async () => {
        const origPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        try {
            const svc = new CliBundleService(ext, noopLogger, {
            findSystemNodeRuntime: fakeNode24Probe,
    probeSystemCli: () => null,
                runNpmInstall: async (prefix) => {
                    fs.mkdirSync(path.join(prefix, 'node_modules/@github/copilot'), { recursive: true });
                    fs.writeFileSync(
                        path.join(prefix, 'node_modules/@github/copilot/package.json'),
                        JSON.stringify({ version: '1.0.44' })
                    );
                    fs.writeFileSync(path.join(prefix, 'node_modules/@github/copilot/npm-loader.js'), '');
                    fs.writeFileSync(path.join(prefix, 'node_modules/@github/copilot/index.js'), '');
                }
            });
            const result = await svc.ensureBundled();
            assert.strictEqual(result.source, 'managed');
            assert.ok(result.cliPath.endsWith('index.js'),
                `cliPath should end with index.js on Windows, got: ${result.cliPath}`);
        } finally {
            Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
        }
    });
});
