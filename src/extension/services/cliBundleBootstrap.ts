import type { CliBundleService, ResolvedCli } from './cliBundleService';
import { CliCapabilityService } from './cliCapabilityService';

interface BootstrapLogger {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
    debug(msg: string): void;
}

interface WarningWindow {
    showWarningMessage(msg: string, ...items: string[]): Thenable<string | undefined>;
}

export interface BootstrapResult {
    resolved: ResolvedCli;
    capability: CliCapabilityService;
}

export async function bootstrapCliBundle(
    bundle: Pick<CliBundleService, 'ensureBundled'>,
    logger: BootstrapLogger,
    window: WarningWindow
): Promise<BootstrapResult> {
    const resolved = await bundle.ensureBundled();
    logger.info(
        `[CLI Bundle] source=${resolved.source} version=${resolved.cliVersion} ` +
        `satisfies=${resolved.satisfiesPeerDep} peerRange=${resolved.sdkPeerRange}`
    );

    if (!resolved.satisfiesPeerDep) {
        const msg =
            `Copilot CLI ${resolved.cliVersion} does not satisfy the SDK's required range ` +
            `${resolved.sdkPeerRange}. Some tools may fail. Update the CLI or set copilotCLI.cliPath.`;
        // Fire-and-forget — don't block activation on user dismissal.
        void window.showWarningMessage(msg);
    }

    return { resolved, capability: new CliCapabilityService(resolved) };
}
