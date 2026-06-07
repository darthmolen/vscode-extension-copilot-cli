import type { McpServerStatus, McpServerStatusValue, McpServerSource } from '../../shared/messages';

/**
 * Classify a server's source for the panel badge. Managed servers (reserved
 * `_copilotcli_*` keys) always win; otherwise use the caller-supplied source
 * map, defaulting unlisted keys to `user`.
 */
function classifySource(
    rawKey: string,
    isManaged: boolean,
    sources: Record<string, McpServerSource>
): McpServerSource {
    if (isManaged) {
        return 'managed';
    }
    return sources[rawKey] ?? 'user';
}

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
    capability: CapabilityFlags,
    sources: Record<string, McpServerSource> = {}
): McpServerStatus[] {
    return Object.entries(allServers).map(([rawKey, rawConfig]) => {
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
            type: classifySource(rawKey, isManaged, sources),
            status,
            toolCount: liveTools?.length ?? 0,
            tools: liveTools ?? [],
            config: (rawConfig ?? {}) as Record<string, any>,
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
    sdkList: SdkMcpListEntry[],
    sources: Record<string, McpServerSource> = {}
): McpServerStatus[] {
    const byName = new Map<string, SdkMcpListEntry>();
    for (const entry of sdkList) {
        byName.set(entry.name, entry);
    }

    return Object.entries(allServers).map(([rawKey, rawConfig]) => {
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
            type: classifySource(rawKey, isManaged, sources),
            status,
            toolCount: tools.length,
            tools,
            config: (rawConfig ?? {}) as Record<string, any>,
        };
        if (sdkEntry?.error) {
            result.error = sdkEntry.error;
        }
        return result;
    });
}

/**
 * Append read-only rows for servers configured in the Copilot CLI's own user
 * config (from `session.rpc.mcp.config.list()`). Servers already present in the
 * list (by name) are skipped so our own config keeps priority in the display.
 * These rows are display-only — the extension never writes to Copilot's config.
 */
export function mergeCopilotConfigList(
    statusList: McpServerStatus[],
    copilotServers: Record<string, unknown> | undefined
): McpServerStatus[] {
    if (!copilotServers || Object.keys(copilotServers).length === 0) {
        return statusList;
    }

    const existingNames = new Set(statusList.map(s => s.name));
    const extra: McpServerStatus[] = [];
    for (const name of Object.keys(copilotServers)) {
        if (existingNames.has(name)) {
            continue;
        }
        extra.push({
            name,
            rawKey: name,
            type: 'copilot',
            status: 'configured',
            toolCount: 0,
            tools: [],
            config: (copilotServers[name] ?? {}) as Record<string, any>,
        });
    }

    return [...statusList, ...extra];
}
