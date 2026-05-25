import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as semver from 'semver';
import { parseCliVersion } from '../../utilities/cliVersion';

export interface ResolvedCli {
    cliPath: string;
    cliVersion: string;
    sdkPeerRange: string;
    source: 'local' | 'managed' | 'system';
    satisfiesPeerDep: boolean;
}

interface ExtensionLike {
    extensionPath: string;
    globalStorageUri: { fsPath: string };
}

interface LoggerLike {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
    debug(msg: string): void;
}

export type RunNpmInstall = (prefix: string, spec: string) => Promise<void>;

export interface CliBundleServiceOptions {
    /**
     * If provided, used instead of reading
     * `<extensionPath>/node_modules/@github/copilot-sdk/package.json`. This is
     * essential for the VSIX install path because `.vscodeignore` strips
     * `node_modules`. Inject via esbuild `define` at build time.
     */
    sdkPeerRange?: string;
    probeSystemCli?: () => { path: string; version: string } | null;
    skipManagedInstall?: boolean;
    runNpmInstall?: RunNpmInstall;
    /**
     * Override for system-Node discovery. Production code uses
     * `findSystemNodeRuntime()` (probes PATH); tests inject a fixed runtime
     * to make the cliPath choice deterministic.
     */
    findSystemNodeRuntime?: () => SystemNodeRuntime | null;
}

export class CliBundleService {
    private opts: CliBundleServiceOptions;
    private installInFlight: Promise<void> | null = null;

    constructor(private ext: ExtensionLike, private logger: LoggerLike, opts: CliBundleServiceOptions = {}) {
        this.opts = opts;
    }

    async ensureBundled(): Promise<ResolvedCli> {
        const sdkPeerRange = this.readSdkPeerRange();

        const local = this.checkLocalNodeModules(sdkPeerRange);
        if (local) {
            return local;
        }

        const managed = this.checkManaged(sdkPeerRange);
        if (managed) {
            return managed;
        }

        const system = this.checkSystem(sdkPeerRange);
        if (system && system.satisfiesPeerDep) {
            return system;
        }

        if (!this.opts.skipManagedInstall) {
            await this.installManaged(sdkPeerRange);
            const installed = this.checkManaged(sdkPeerRange);
            if (installed) {
                return installed;
            }
        }

        if (system) {
            return system;
        }

        throw new Error(
            `Cannot resolve a Copilot CLI satisfying ${sdkPeerRange}. ` +
            `Install one or set copilotCLI.cliPath in VS Code settings.`
        );
    }

    private managedDir(sdkPeerRange: string): string {
        const sanitized = stripPrereleaseTag(sdkPeerRange).replace(/[^a-zA-Z0-9._-]/g, '_');
        return path.join(this.ext.globalStorageUri.fsPath, 'cli', sanitized);
    }

    private getSystemNodeRuntime(): SystemNodeRuntime | null {
        return (this.opts.findSystemNodeRuntime ?? findSystemNodeRuntime)();
    }

    private checkManaged(sdkPeerRange: string): ResolvedCli | null {
        const dest = this.managedDir(sdkPeerRange);
        const cliPkgDir = path.join(dest, 'node_modules', '@github', 'copilot');
        const pkgJsonPath = path.join(cliPkgDir, 'package.json');
        if (!fs.existsSync(pkgJsonPath)) {
            return null;
        }
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
        const version: string = pkg.version;
        const cliPath = pickCliPath(cliPkgDir, this.getSystemNodeRuntime());
        if (!fs.existsSync(cliPath)) {
            return null;
        }
        return {
            cliPath,
            cliVersion: version,
            sdkPeerRange,
            source: 'managed',
            satisfiesPeerDep: semver.satisfies(version, sdkPeerRange, { includePrerelease: true })
        };
    }

    private async installManaged(sdkPeerRange: string): Promise<void> {
        if (this.installInFlight) {
            this.logger.info(`[CLI Bundle] Install already in flight; awaiting existing promise`);
            return this.installInFlight;
        }
        const dest = this.managedDir(sdkPeerRange);
        const spec = `@github/copilot@${stripPrereleaseTag(sdkPeerRange)}`;
        const runner = this.opts.runNpmInstall ?? defaultRunNpmInstall;
        this.installInFlight = (async () => {
            try {
                fs.mkdirSync(dest, { recursive: true });
                this.logger.info(`[CLI Bundle] Installing ${spec} into ${dest}`);
                await runner(dest, spec);
            } finally {
                this.installInFlight = null;
            }
        })();
        return this.installInFlight;
    }

    private checkSystem(sdkPeerRange: string): ResolvedCli | null {
        const probe = this.opts.probeSystemCli ?? defaultProbeSystemCli;
        const probed = probe();
        if (!probed) {
            return null;
        }
        return {
            cliPath: probed.path,
            cliVersion: probed.version,
            sdkPeerRange,
            source: 'system',
            satisfiesPeerDep: semver.satisfies(probed.version, sdkPeerRange, { includePrerelease: true })
        };
    }

    private readSdkPeerRange(): string {
        if (this.opts.sdkPeerRange) {
            return this.opts.sdkPeerRange;
        }
        const sdkPkgPath = path.join(this.ext.extensionPath, 'node_modules', '@github', 'copilot-sdk', 'package.json');
        if (!fs.existsSync(sdkPkgPath)) {
            throw new Error(
                `Cannot determine SDK peer-dep range: no inlined sdkPeerRange option and ` +
                `${sdkPkgPath} does not exist (VSIX install excludes node_modules). ` +
                `The build must inject sdkPeerRange via esbuild define.`
            );
        }
        const raw = fs.readFileSync(sdkPkgPath, 'utf-8');
        const pkg = JSON.parse(raw);
        const range = pkg.peerDependencies?.['@github/copilot'] ?? pkg.dependencies?.['@github/copilot'];
        if (!range) {
            throw new Error(`@github/copilot-sdk has no @github/copilot range in dependencies or peerDependencies (${sdkPkgPath})`);
        }
        return range;
    }

    private checkLocalNodeModules(sdkPeerRange: string): ResolvedCli | null {
        const cliPkgDir = path.join(this.ext.extensionPath, 'node_modules', '@github', 'copilot');
        const pkgJsonPath = path.join(cliPkgDir, 'package.json');
        if (!fs.existsSync(pkgJsonPath)) {
            return null;
        }
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
        const version: string = pkg.version;
        const cliPath = pickCliPath(cliPkgDir, this.getSystemNodeRuntime());
        if (!fs.existsSync(cliPath)) {
            return null;
        }
        return {
            cliPath,
            cliVersion: version,
            sdkPeerRange,
            source: 'local',
            satisfiesPeerDep: semver.satisfies(version, sdkPeerRange, { includePrerelease: true })
        };
    }
}

/**
 * Strip prerelease tags from version numbers in a semver range.
 *
 * The SDK declares its peer-dep with a prerelease floor (`^1.0.36-0`) so that
 * any 1.0.36 prerelease counts as satisfying it. But passing that range to
 * `npm install` lets npm pick the prerelease itself when stable versions also
 * match — and some npm versions (or registry states) have done exactly that,
 * pinning users to `1.0.36-0` instead of latest stable.
 *
 * Stripping `-N` from the install spec forces npm to pick a stable. We keep
 * the unstripped range for `semver.satisfies()` checks so the SDK's own
 * declared contract is honored.
 */
function stripPrereleaseTag(range: string): string {
    return range.replace(/(\d+\.\d+\.\d+)-[0-9A-Za-z][0-9A-Za-z.-]*/g, '$1');
}

type NpmProbeFn = (cmd: string, args: string[], opts: { encoding: 'utf-8'; timeout: number; windowsHide: boolean; stdio: 'pipe'; shell?: boolean }) => string;

/**
 * Check whether `npm` is callable on POSIX systems via a `--version` probe.
 *
 * Note: this is only used as a pre-flight on POSIX. On Windows we use
 * `findWindowsNpmRuntime()` instead because the spawn strategy there is
 * different (we invoke node + npm-cli.js directly, bypassing cmd.exe).
 */
export function isNpmAvailable(probe?: NpmProbeFn): boolean {
    const exec: NpmProbeFn = probe ?? ((cmd, args, opts) =>
        require('child_process').execFileSync(cmd, args, opts).toString());
    try {
        exec('npm', ['--version'], {
            encoding: 'utf-8',
            timeout: 5000,
            windowsHide: true,
            stdio: 'pipe'
        });
        return true;
    } catch {
        return false;
    }
}

export interface SystemNodeRuntime {
    nodeExe: string;
    /** Major version (24, 22, etc.). `null` if the version probe failed or output couldn't be parsed. Treated identically to "too old" by callers. */
    nodeMajorVersion: number | null;
    /** Path to npm-cli.js when discoverable next to npm.cmd on Windows. Always `null` on POSIX (not needed there — buildNpmInstallSpawn only uses this on Windows to bypass cmd.exe). */
    npmCliJs: string | null;
}

/** Backwards-compat alias for the old name. Same fields plus the two new ones; existing call sites get the more useful shape. */
export type NpmRuntimePaths = SystemNodeRuntime;

const NODE_VERSION_TIMEOUT_MS = 5000;

/**
 * Locate the user's system Node binary and probe its version, cross-platform.
 *
 * Drives two decisions downstream:
 *   1. `pickCliPath` — use the pure-Node `index.js` entrypoint if Node 24+ is
 *      present; otherwise fall back to the native binary.
 *   2. `ensureNodeExecPath` — override `process.execPath` to the system Node
 *      so the SDK's `spawn(process.execPath, ...)` doesn't run under VS Code's
 *      Electron-bundled Node (which has a Windows argv mismatch).
 *
 * Discovery branches per platform:
 *   - Windows: `where npm.cmd` → `node.exe` + `npm-cli.js` derived from its dir
 *     (Node installer's standard layout). `npmCliJs` is needed by
 *     `buildNpmInstallSpawn` to bypass cmd.exe.
 *   - POSIX:   `which node` → `nodeExe` direct. `npmCliJs` is left null;
 *     `buildNpmInstallSpawn` spawns `npm` directly on POSIX (no cmd.exe).
 *
 * Returns `null` if the binary can't be located OR if the discovered path
 * doesn't exist on disk. Returns the runtime with `nodeMajorVersion: null` if
 * the binary is found but its `--version` probe fails — callers treat that
 * identically to "missing" for the gating decision, but the path is still
 * available if anyone needs it.
 */
export function findSystemNodeRuntime(probe?: (cmd: string, args: string[]) => string): SystemNodeRuntime | null {
    const exec = probe ?? ((cmd: string, args: string[]) =>
        require('child_process').execFileSync(cmd, args, {
            encoding: 'utf-8', timeout: NODE_VERSION_TIMEOUT_MS, windowsHide: true
        }).toString());

    const isWin = process.platform === 'win32';
    const discoveryCmd = isWin ? 'where' : 'which';
    const discoveryTarget = isWin ? 'npm.cmd' : 'node';

    let discoveryOutput: string;
    try {
        discoveryOutput = exec(discoveryCmd, [discoveryTarget]);
    } catch {
        return null;
    }
    const firstLine = (discoveryOutput ?? '').trim().split(/\r?\n/)[0];
    if (!firstLine) {
        return null;
    }

    let nodeExe: string;
    let npmCliJs: string | null;
    if (isWin) {
        const dir = path.dirname(firstLine);
        nodeExe = path.join(dir, 'node.exe');
        npmCliJs = path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
        if (!fs.existsSync(nodeExe) || !fs.existsSync(npmCliJs)) {
            return null;
        }
    } else {
        nodeExe = firstLine;
        npmCliJs = null;
        if (!fs.existsSync(nodeExe)) {
            return null;
        }
    }

    // Version probe — best-effort. If it fails we still return the runtime so
    // the caller can decide; nodeMajorVersion: null gates the same as "too old".
    let nodeMajorVersion: number | null = null;
    try {
        const versionOutput = exec(nodeExe, ['--version']);
        const parsed = parseCliVersion(versionOutput);
        if (parsed) {
            const major = parseInt(parsed.split('.')[0], 10);
            if (Number.isFinite(major)) {
                nodeMajorVersion = major;
            }
        }
    } catch {
        // probe failed; nodeMajorVersion stays null
    }

    return { nodeExe, npmCliJs, nodeMajorVersion };
}

/** Backwards-compat alias preserving the old name. New code should use `findSystemNodeRuntime`. */
export const findWindowsNpmRuntime = findSystemNodeRuntime;

/**
 * Choose between the pure-Node `index.js` entrypoint (requires system Node 24+)
 * and the native binary in the sibling `@github/copilot-${platform}-${arch}`
 * package. Same decision rule on all platforms; the platform only affects the
 * native binary's filename.
 *
 * When Node 24+ is unavailable, we point cliPath directly at the native binary
 * rather than `npm-loader.js`. Both ultimately invoke the same Go binary, but
 * the SDK's `spawn(cliPath, ...)` already passes `windowsHide: true` — so
 * spawning the binary directly avoids the persistent console window that
 * `npm-loader.js`'s internal `spawnSync` (without windowsHide) would surface
 * on Windows.
 */
export function pickCliPath(cliPkgDir: string, runtime: SystemNodeRuntime | null): string {
    if (runtime && runtime.nodeMajorVersion !== null && runtime.nodeMajorVersion >= 24) {
        return path.join(cliPkgDir, 'index.js');
    }
    const sibling = `copilot-${process.platform}-${process.arch}`;
    const binaryName = process.platform === 'win32' ? 'copilot.exe' : 'copilot';
    return path.join(path.dirname(cliPkgDir), sibling, binaryName);
}

const MIN_SYSTEM_NODE_MAJOR = 24;

/**
 * Override `process.execPath` to the user's system Node binary when it's
 * Node 24+. Gates ONLY on the discovered Node version, not on platform —
 * POSIX override is harmless (typically `process.execPath` already equals
 * system `node`; if they differ the override is still functional).
 *
 * Why this exists: the Copilot SDK spawns the CLI via
 * `spawn(process.execPath, [cliPath, ...args])`. In a VS Code extension host,
 * `process.execPath` is `Code.exe` (Electron's bundled Node v22.22.1) — not
 * system Node. On Windows, that Electron Node's argv serialization through
 * `CreateProcess` differs from system Node v24 just enough that the CLI's
 * commander parser sees a phantom positional argument and throws
 * "Expected 0 arguments but got 1". Overriding to system Node 24+ avoids it.
 *
 * No-op when runtime is null, version probe failed, or version is < 24. In
 * those cases callers should be using the native-binary cliPath (see
 * `pickCliPath`) which doesn't involve Node at all and sidesteps the issue.
 */
export function ensureNodeExecPath(runtime: SystemNodeRuntime | null, logger: { info(msg: string): void }): void {
    if (!runtime) {
        logger.info(`[CLI Bundle] System Node not detected; will use bundled native CLI binary (no execPath override needed).`);
        return;
    }
    if (runtime.nodeMajorVersion === null || runtime.nodeMajorVersion < MIN_SYSTEM_NODE_MAJOR) {
        const detected = runtime.nodeMajorVersion === null ? 'unknown' : `v${runtime.nodeMajorVersion}.x`;
        logger.info(`[CLI Bundle] System Node ${MIN_SYSTEM_NODE_MAJOR}+ not detected (got ${detected}); will use bundled native CLI binary. Install Node ${MIN_SYSTEM_NODE_MAJOR}+ from https://nodejs.org to use the system-Node spawn path.`);
        return;
    }
    if (runtime.nodeExe.toLowerCase() === process.execPath.toLowerCase()) {
        return;
    }
    logger.info(`[CLI Bundle] Overriding process.execPath: ${process.execPath} -> ${runtime.nodeExe} (system Node v${runtime.nodeMajorVersion}; avoids Electron-Node argv mismatch when SDK spawns CLI)`);
    Object.defineProperty(process, 'execPath', { value: runtime.nodeExe, configurable: true });
}

export interface NpmInstallSpawn {
    command: string;
    args: string[];
    options: { stdio: 'pipe'; shell: boolean; windowsHide: boolean };
}

/**
 * Build the spawn invocation for `npm install <spec>`.
 *
 * On Windows: spawns `node.exe` directly with `npm-cli.js` as the first arg
 * (bypassing cmd.exe and its caret-stripping). Requires the caller to supply
 * `runtime` paths (use `findWindowsNpmRuntime()` to discover them).
 *
 * On POSIX: spawns `npm` directly without a shell (no cmd.exe involved, no
 * caret issues, npm is a real executable on PATH).
 *
 * Either way: `shell: false`, so the spec is passed as a true argv element
 * and reaches npm verbatim — no escaping needed for `^` or any other char.
 */
export function buildNpmInstallSpawn(prefix: string, spec: string, platform: NodeJS.Platform = process.platform, runtime?: NpmRuntimePaths): NpmInstallSpawn {
    const installArgs = ['install', '--prefix', prefix, '--no-save', '--no-package-lock', spec];
    if (platform === 'win32') {
        if (!runtime || !runtime.npmCliJs) {
            throw new Error('buildNpmInstallSpawn on Windows requires NpmRuntimePaths with npmCliJs (node.exe + npm-cli.js)');
        }
        return {
            command: runtime.nodeExe,
            args: [runtime.npmCliJs, ...installArgs],
            options: { stdio: 'pipe', shell: false, windowsHide: true }
        };
    }
    return {
        command: 'npm',
        args: installArgs,
        options: { stdio: 'pipe', shell: false, windowsHide: true }
    };
}

const defaultRunNpmInstall: RunNpmInstall = async (prefix, spec) => {
    const { spawn } = await import('child_process');

    let runtime: NpmRuntimePaths | undefined;
    if (process.platform === 'win32') {
        const found = findWindowsNpmRuntime();
        if (!found) {
            throw new Error(
                'Could not locate node.exe and npm-cli.js next to npm.cmd. ' +
                'Install Node.js 24 or later from https://nodejs.org, then restart VS Code.'
            );
        }
        runtime = found;
    } else if (!isNpmAvailable()) {
        throw new Error(
            'npm is required to install the Copilot CLI but was not found on PATH. ' +
            'Install Node.js 24 or later (which includes npm) from https://nodejs.org, ' +
            'then restart VS Code.'
        );
    }

    const { command, args, options } = buildNpmInstallSpawn(prefix, spec, process.platform, runtime);
    await new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, options);
        let stderr = '';
        child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('error', (err) => reject(new Error(`npm install failed to spawn: ${err.message}`)));
        child.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`npm install exited with code ${code}: ${stderr}`));
            }
        });
    });
};

function defaultProbeSystemCli(): { path: string; version: string } | null {
    try {
        const which = process.platform === 'win32' ? 'where' : 'which';
        const out = execFileSync(which, ['copilot'], { encoding: 'utf-8', timeout: 5000, windowsHide: true }).trim();
        const cliPath = out.split(/\r?\n/)[0];
        if (!cliPath) {
            return null;
        }
        const versionOut = execFileSync(cliPath, ['--version', '--no-auto-update'], { encoding: 'utf-8', timeout: 5000, windowsHide: true }).trim();
        const version = parseCliVersion(versionOut);
        if (!version) {
            return null;
        }
        return { path: cliPath, version };
    } catch {
        return null;
    }
}
