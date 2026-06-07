/**
 * Import MCP servers from VS Code's native configuration (`.vscode/mcp.json`
 * and the user-profile `mcp.json`) and translate them into the Copilot SDK's
 * MCPServerConfig shape.
 *
 * This file is split into:
 *  - Pure functions (translate / merge / path resolution) — fully unit-tested.
 *  - A thin I/O adapter (`getImportedServers`) that reads files and delegates
 *    to the pure functions — an outside-reaching boundary, not unit-tested.
 */

import * as path from 'path';
import * as fs from 'fs';
import { parse as parseJsonc } from 'jsonc-parser';
import { Logger } from '../../logger';

/** Fields we copy straight through from a VS Code entry to the SDK config. */
const PASSTHROUGH_FIELDS = ['command', 'args', 'env', 'url', 'headers', 'timeout', 'type'] as const;

/** Recursively test whether any string value uses an unresolvable ${input:...} var. */
function usesInputVariable(value: unknown): boolean {
    if (typeof value === 'string') {
        return value.includes('${input:');
    }
    if (Array.isArray(value)) {
        return value.some(usesInputVariable);
    }
    if (value && typeof value === 'object') {
        return Object.values(value).some(usesInputVariable);
    }
    return false;
}

/** Recursively expand ${workspaceFolder} in all string values. */
function expandWorkspaceFolder<T>(value: T, workspaceFolder: string): T {
    if (typeof value === 'string') {
        return value.replace(/\$\{workspaceFolder\}/g, workspaceFolder) as unknown as T;
    }
    if (Array.isArray(value)) {
        return value.map((v) => expandWorkspaceFolder(v, workspaceFolder)) as unknown as T;
    }
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = expandWorkspaceFolder(v, workspaceFolder);
        }
        return out as unknown as T;
    }
    return value;
}

/**
 * Translate a single VS Code `mcp.json` server entry into an SDK MCPServerConfig.
 *
 * Returns `null` when the entry can't be used as-is (currently: it references a
 * `${input:...}` variable that would require interactive prompting).
 */
export function translateVSCodeMcpServer(
    entry: Record<string, any>,
    workspaceFolder: string
): Record<string, any> | null {
    if (usesInputVariable(entry)) {
        return null;
    }

    const expanded = expandWorkspaceFolder(entry, workspaceFolder);

    const out: Record<string, any> = {};
    for (const field of PASSTHROUGH_FIELDS) {
        if (expanded[field] !== undefined) {
            out[field] = expanded[field];
        }
    }

    // VS Code uses `cwd`; the SDK stdio config uses `workingDirectory`.
    if (expanded.cwd !== undefined) {
        out.workingDirectory = expanded.cwd;
    }

    // Infer the type when not explicitly set: command → stdio, url → http.
    if (out.type === undefined) {
        out.type = expanded.url !== undefined ? 'http' : 'stdio';
    }

    // The SDK only surfaces tools when `tools` is set; default to all.
    out.tools = expanded.tools !== undefined ? expanded.tools : ['*'];

    return out;
}

/**
 * Merge translated servers from the two VS Code config files. Workspace entries
 * win over user-profile entries on a name collision (the workspace is the more
 * specific scope).
 */
export function mergeImportedSources(
    userServers: Record<string, any>,
    workspaceServers: Record<string, any>
): Record<string, any> {
    return { ...userServers, ...workspaceServers };
}

/**
 * Resolve the user-profile `mcp.json` path from the extension's globalStorage
 * path. globalStorage lives at `.../User/[profiles/<id>/]globalStorage/<ext-id>`,
 * so the sibling `mcp.json` is two levels up. This is robust across the default
 * profile, named profiles, Insiders, and remote/WSL — unlike hardcoding a path.
 */
export function resolveUserMcpJsonPath(globalStorageFsPath: string): string {
    return path.join(globalStorageFsPath, '..', '..', 'mcp.json');
}

// ---------------------------------------------------------------------------
// I/O boundary (not unit-tested): read the files, parse JSONC, translate, merge.
// All real logic lives in the pure functions above; this layer stays thin.
// ---------------------------------------------------------------------------

/** Read + parse a single VS Code `mcp.json`, returning its translated servers. */
function readAndTranslate(filePath: string, workspaceFolder: string, logger: Logger): Record<string, any> {
    let text: string;
    try {
        text = fs.readFileSync(filePath, 'utf8');
    } catch {
        return {}; // missing file is the normal case
    }

    let parsed: any;
    try {
        parsed = parseJsonc(text);
    } catch (e: any) {
        logger.warn(`[MCP] Could not parse ${filePath}: ${e?.message ?? e}`);
        return {};
    }

    const servers = parsed?.servers;
    if (!servers || typeof servers !== 'object') {
        return {};
    }

    const out: Record<string, any> = {};
    for (const [name, entry] of Object.entries(servers)) {
        const translated = translateVSCodeMcpServer(entry as Record<string, any>, workspaceFolder);
        if (translated === null) {
            logger.warn(`[MCP] Skipping imported server "${name}" — uses an unresolvable \${input:...} variable`);
            continue;
        }
        out[name] = translated;
    }
    return out;
}

/**
 * Read VS Code's native MCP servers from the user-profile `mcp.json` and the
 * workspace `.vscode/mcp.json`, translated into SDK config shape. Workspace
 * entries win on name collision. Returns `{}` when nothing is configured.
 */
export function getImportedServers(
    workspaceFolder: string,
    globalStorageFsPath: string
): Record<string, any> {
    const logger = Logger.getInstance();

    const userServers = readAndTranslate(
        resolveUserMcpJsonPath(globalStorageFsPath), workspaceFolder, logger
    );
    const workspaceServers = readAndTranslate(
        path.join(workspaceFolder, '.vscode', 'mcp.json'), workspaceFolder, logger
    );

    const merged = mergeImportedSources(userServers, workspaceServers);
    if (Object.keys(merged).length > 0) {
        logger.info(`[MCP] Imported ${Object.keys(merged).length} VS Code server(s): ${Object.keys(merged).join(', ')}`);
    }
    return merged;
}
