/**
 * Pure transforms + validation for the extension's own `copilotCLI.mcpServers`
 * setting. These are the only MCP servers the extension ever writes. Every
 * function is data-in → data-out (no `vscode`, no I/O) so the save/remove/toggle
 * handlers stay thin around them.
 */

const MANAGED_KEY_PREFIX = '_copilotcli_';

export interface McpServerInput {
    name: string;
    type?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
    tools?: string[];
}

export interface ValidationResult {
    valid: boolean;
    errors: string[];
}

/**
 * Validate a proposed MCP server. `existingNames` must exclude the server being
 * edited so renaming-in-place is allowed.
 */
export function validateMcpServerInput(input: McpServerInput, existingNames: string[]): ValidationResult {
    const errors: string[] = [];
    const name = (input.name ?? '').trim();

    if (!name) {
        errors.push('Server name is required.');
    } else if (name.startsWith(MANAGED_KEY_PREFIX)) {
        errors.push(`Server name cannot start with the reserved prefix "${MANAGED_KEY_PREFIX}".`);
    } else if (existingNames.includes(name)) {
        errors.push(`A server named "${name}" already exists.`);
    }

    const type = input.type ?? 'stdio';
    if (type === 'http' || type === 'sse') {
        if (!input.url || !input.url.trim()) {
            errors.push('A URL is required for http/sse servers.');
        }
    } else {
        // stdio / local
        if (!input.command || !input.command.trim()) {
            errors.push('A command is required for local (stdio) servers.');
        }
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Return a new config with `name` → `serverConfig` added. Throws if the name
 * already exists (callers validate first).
 */
export function addMcpServerToConfig(
    currentConfig: Record<string, any>,
    name: string,
    serverConfig: Record<string, any>
): Record<string, any> {
    if (name in currentConfig) {
        throw new Error(`A server named "${name}" already exists.`);
    }
    return { ...currentConfig, [name]: serverConfig };
}

/** Return a new config with `name` removed. No-op if absent. */
export function removeMcpServerFromConfig(
    currentConfig: Record<string, any>,
    name: string
): Record<string, any> {
    if (!(name in currentConfig)) {
        return { ...currentConfig };
    }
    const next = { ...currentConfig };
    delete next[name];
    return next;
}

/** Return a new config with the `enabled` flag set on `name`. No-op if absent. */
export function setMcpServerEnabled(
    currentConfig: Record<string, any>,
    name: string,
    enabled: boolean
): Record<string, any> {
    if (!(name in currentConfig)) {
        return { ...currentConfig };
    }
    return { ...currentConfig, [name]: { ...currentConfig[name], enabled } };
}

/**
 * Carry the `enabled` flag from a previous entry onto a replacement config when
 * the replacement doesn't set it. The edit form has no enabled field, so editing
 * (or renaming) a disabled server must not silently re-enable it.
 */
export function preserveEnabledFlag(
    prevConfig: Record<string, any> | undefined,
    newConfig: Record<string, any>
): Record<string, any> {
    if (prevConfig && prevConfig.enabled !== undefined && newConfig.enabled === undefined) {
        return { ...newConfig, enabled: prevConfig.enabled };
    }
    return newConfig;
}

/** Return a new config with the entry at `name` replaced by `serverConfig`. */
export function editMcpServerInConfig(
    currentConfig: Record<string, any>,
    name: string,
    serverConfig: Record<string, any>
): Record<string, any> {
    return { ...currentConfig, [name]: serverConfig };
}
