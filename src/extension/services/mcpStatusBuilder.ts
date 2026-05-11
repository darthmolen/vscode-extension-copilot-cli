import type { McpServerStatus, McpServerStatusValue } from '../../shared/messages';

export interface SdkMcpListEntry {
    name: string;
    status?: string;
    tools?: Array<string | { name: string }>;
    error?: string;
}

/**
 * Maps SDK status strings (from `session.mcp_servers_loaded` events) to
 * the panel's status enum. `not_configured` means the SDK has no entry
 * for this server yet — surface as 'unknown' rather than misleadingly green/yellow.
 */
const SDK_STATUS_MAP: Record<string, McpServerStatusValue> = {
    connected: 'connected',
    failed: 'failed',
    'needs-auth': 'failed',
    pending: 'connecting',
    disabled: 'configured',
    not_configured: 'unknown',
};

interface CapabilityFlags {
    supportsMcpStatusEvents(): boolean;
}

export function buildMcpServerStatusList(
    allServers: Record<string, unknown>,
    knownTools: Record<string, string[]>,
    knownStatuses: Record<string, string>,
    capability: CapabilityFlags
): McpServerStatus[] {
    return Object.entries(allServers).map(([rawKey]) => {
        const isManaged = rawKey.startsWith('_copilotcli_');
        const displayName = isManaged ? rawKey.replace('_copilotcli_', '') : rawKey;
        const sdkStatus = knownStatuses[rawKey] ?? knownStatuses[displayName];
        const liveTools = knownTools[rawKey];

        let status: McpServerStatusValue;
        if (sdkStatus) {
            status = SDK_STATUS_MAP[sdkStatus] ?? 'configured';
        } else if (liveTools && liveTools.length > 0) {
            status = 'connected';
        } else if (capability.supportsMcpStatusEvents()) {
            // CLI is new enough to fire status events; the absence of one means
            // the server is configured but hasn't connected yet.
            status = 'configured';
        } else {
            // CLI is too old to report MCP status; we genuinely don't know.
            status = 'unknown';
        }

        return {
            name: displayName,
            rawKey,
            type: (isManaged ? 'managed' : 'user') as 'managed' | 'user',
            status,
            toolCount: liveTools?.length ?? 0,
            tools: liveTools ?? [],
        };
    });
}

/**
 * Merge config-known servers with live SDK data from session.rpc.mcp.list().
 * Live data is authoritative when present; servers absent from the SDK list
 * fall back to 'configured'.
 */
export function mergeMcpListWithConfig(
    allServers: Record<string, unknown>,
    sdkList: SdkMcpListEntry[]
): McpServerStatus[] {
    const byName = new Map<string, SdkMcpListEntry>();
    for (const entry of sdkList) {
        byName.set(entry.name, entry);
    }

    return Object.entries(allServers).map(([rawKey]) => {
        const isManaged = rawKey.startsWith('_copilotcli_');
        const displayName = isManaged ? rawKey.replace('_copilotcli_', '') : rawKey;
        const sdkEntry = byName.get(rawKey) ?? byName.get(displayName);

        let status: McpServerStatusValue = 'configured';
        let tools: string[] = [];

        if (sdkEntry) {
            tools = (sdkEntry.tools ?? []).map(t => typeof t === 'string' ? t : t.name);
            const mappedStatus = SDK_STATUS_MAP[sdkEntry.status ?? ''] ?? 'configured';
            // Managed servers are always configured by us; don't show 'unknown' when the CLI
            // reports 'not_configured' (server may still be starting up or connecting).
            status = (isManaged && mappedStatus === 'unknown') ? 'configured' : mappedStatus;
        }

        const result: McpServerStatus = {
            name: displayName,
            rawKey,
            type: isManaged ? 'managed' : 'user',
            status,
            toolCount: tools.length,
            tools,
        };
        if (sdkEntry?.error) {
            result.error = sdkEntry.error;
        }
        return result;
    });
}
