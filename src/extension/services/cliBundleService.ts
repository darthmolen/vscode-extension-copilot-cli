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
        const sanitized = sdkPeerRange.replace(/[^a-zA-Z0-9._-]/g, '_');
        return path.join(this.ext.globalStorageUri.fsPath, 'cli', sanitized);
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
        return {
            cliPath: path.join(cliPkgDir, 'npm-loader.js'),
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
        const spec = `@github/copilot@${sdkPeerRange}`;
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
        const cliPath = path.join(cliPkgDir, 'npm-loader.js');
        return {
            cliPath,
            cliVersion: version,
            sdkPeerRange,
            source: 'local',
            satisfiesPeerDep: semver.satisfies(version, sdkPeerRange, { includePrerelease: true })
        };
    }
}

const defaultRunNpmInstall: RunNpmInstall = async (prefix, spec) => {
    const { spawn } = await import('child_process');
    await new Promise<void>((resolve, reject) => {
        const child = spawn('npm', ['install', '--prefix', prefix, '--no-save', '--no-package-lock', spec], {
            stdio: 'pipe',
            shell: process.platform === 'win32'
        });
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
        const out = execFileSync(which, ['copilot'], { encoding: 'utf-8', timeout: 5000 }).trim();
        const cliPath = out.split(/\r?\n/)[0];
        if (!cliPath) {
            return null;
        }
        const versionOut = execFileSync(cliPath, ['--version', '--no-auto-update'], { encoding: 'utf-8', timeout: 5000 }).trim();
        const version = parseCliVersion(versionOut);
        if (!version) {
            return null;
        }
        return { path: cliPath, version };
    } catch {
        return null;
    }
}
