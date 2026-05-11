import { Logger } from '../../logger';

const MANAGED_KEY_PREFIX = '_copilotcli_';

/**
 * Registry of MCP servers managed by the extension itself.
 *
 * Keys use the reserved `_copilotcli_` prefix so user-defined entries in
 * `copilotCLI.mcpServers` cannot collide with or override managed servers.
 *
 * Currently empty — the plumbing is in place for future managed servers,
 * but Playwright MCP requires Chrome (sudo install) and is better left as
 * a user-configured server in copilotCLI.mcpServers.
 *
 * ─── LESSONS LEARNED (Playwright MCP, 2026-05-10) ───────────────────────────
 *
 * When we re-add a managed server, remember:
 *
 * 1. `tools: ['*']` is REQUIRED — it is a required field on MCPServerConfigBase.
 *    Without it the SDK exposes zero tools from the server, even if the server
 *    starts and connects successfully. Silent failure, no error in logs.
 *
 * 2. Use a pinned semver version, never `@latest`. Example:
 *    args: ['-y', '@playwright/mcp@0.0.74']
 *
 * 3. Managed servers must "just work" with zero user setup. If a server needs
 *    an OS-level dependency (e.g. Chrome via `npx playwright install chrome`,
 *    which requires sudo), it belongs in user config — not here.
 *
 * Example entry (Playwright MCP) for when the above constraint is resolved:
 *
 *   const PLAYWRIGHT_MCP_VERSION = '0.0.74';
 *
 *   servers[`${MANAGED_KEY_PREFIX}playwright`] = {
 *       command: 'npx',
 *       args: ['-y', `@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}`],
 *       tools: ['*'],   // ← REQUIRED — omitting silently exposes no tools
 *   };
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */
export class ManagedMCPRegistry {
    private logger: Logger;

    constructor() {
        this.logger = Logger.getInstance();
    }

    public getManagedServers(): Record<string, unknown> {
        return {};
    }
}
