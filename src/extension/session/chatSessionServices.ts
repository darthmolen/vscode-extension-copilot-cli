/**
 * Builds one session's slash-command services.
 *
 * This construction used to happen inside `registerChatHandlers`, which built the
 * services *while registering handlers* and assigned them back onto the handler
 * context. With a single chat surface that is merely odd; with two, the second
 * registration rebuilds and overwrites the first surface's services.
 *
 * Splitting them by lifetime is the point, and `InfoSlashHandlers` is the proof
 * that it matters: it reads `getSessionStartTime`, `getMessageCount` and
 * `getToolCallCount`, all of which belong to one conversation. Handed a shared
 * state it would report one session's usage under another's name. It therefore
 * gets the owning host's `SessionState`, while genuinely window-scoped
 * collaborators (the MCP config service, the CLI passthrough) are built once at
 * the composition root and passed through.
 *
 * Free of `vscode` imports: everything host-shaped arrives as a callback, so the
 * factory is exercisable from the unit suite.
 */

import { CodeReviewSlashHandlers } from '../services/slashCommands/CodeReviewSlashHandlers';
import { InfoSlashHandlers } from '../services/slashCommands/InfoSlashHandlers';
import { NotSupportedSlashHandlers } from '../services/slashCommands/NotSupportedSlashHandlers';
import type { MCPConfigurationService } from '../services/mcpConfigurationService';
import type { CLIPassthroughService } from '../services/CLIPassthroughService';
import { ChatSessionServices, ChatSessionServicesFactory } from './ChatSessionHost';

export interface ChatSessionServicesDeps {
    /** User config merged with managed servers. Window-scoped. */
    getMergedMcpServers: () => Record<string, any>;
    /** Window-scoped — one workspace, one config service. */
    mcpConfigService: MCPConfigurationService;
    /** Window-scoped and stateless. */
    cliPassthroughService: CLIPassthroughService;
    /** Read per call: the resolved CLI can change under us. */
    getCliCapability: () => any;
    versionInfo: { extensionVersion: string; sdkVersion: string };
    /** Where a session's `plan.md` lives. */
    getPlanPath: (sessionId: string) => string;
}

export function createChatSessionServices(deps: ChatSessionServicesDeps): ChatSessionServicesFactory {
    return (host): ChatSessionServices => ({
        // Resolved per call rather than captured, so a host that adopts its id
        // after a failed first start still reaches the right session.
        codeReviewHandlers: new CodeReviewSlashHandlers({
            getCurrentSession: () => (host.sessionId ? { id: host.sessionId } : null),
            getPlanPath: deps.getPlanPath
        }),
        infoHandlers: new InfoSlashHandlers(
            deps.getMergedMcpServers,
            host.state,
            deps.getCliCapability,
            deps.versionInfo
        ),
        notSupportedHandlers: new NotSupportedSlashHandlers(),
        mcpConfigService: deps.mcpConfigService,
        cliPassthroughService: deps.cliPassthroughService
    });
}
