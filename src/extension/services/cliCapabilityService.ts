import * as semver from 'semver';
import type { ResolvedCli } from './cliBundleService';

const MCP_LIST_MIN = '1.0.36';
const MCP_STATUS_EVENTS_MIN = '1.0.36';
// `mcp.config.*` RPCs (list/add/...) — we only use `mcp.config.list` (read-only).
// Min version confirmed by spike; the call is also try/catch-guarded at the call site.
const MCP_CONFIG_RPC_MIN = '1.0.36';

export class CliCapabilityService {
    constructor(private resolved: ResolvedCli) {}

    get cliVersion(): string {
        return this.resolved.cliVersion;
    }

    get satisfiesSdkPeerDep(): boolean {
        return this.resolved.satisfiesPeerDep;
    }

    get sdkPeerRange(): string {
        return this.resolved.sdkPeerRange;
    }

    get sourceLabel(): string {
        return this.resolved.source;
    }

    supportsMcpListRpc(): boolean {
        return semver.gte(this.resolved.cliVersion, MCP_LIST_MIN);
    }

    supportsMcpStatusEvents(): boolean {
        return semver.gte(this.resolved.cliVersion, MCP_STATUS_EVENTS_MIN);
    }

    supportsMcpConfigRpc(): boolean {
        return semver.gte(this.resolved.cliVersion, MCP_CONFIG_RPC_MIN);
    }
}
