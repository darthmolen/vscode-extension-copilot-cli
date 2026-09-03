// Type-only: erased at compile time. Everything this module needs from the
// host arrives through HostBridge, so it can run outside the extension host.
import type * as vscode from 'vscode';
// ESM package imported from a CJS file, so the type import needs an explicit
// resolution mode. Aliased because `CopilotClient` is already a module-level
// `let` holding the lazily-required constructor.
import type { CopilotClient as CopilotClientApi } from '@github/copilot-sdk' with { 'resolution-mode': 'import' };
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { Logger, LoggerLike } from './logger';
// Type-only for the contract; `NoopMessageEnhancer` is the one runtime import, and
// `hostBridge.ts` holds no implementation and reaches for no host. Nothing here
// resolves to `require('vscode')` — which is the point, and is asserted in
// tests/unit/extension/sdk-session-manager-host-decoupling.test.js.
import type { HostBridge, MessageEnhancerLike } from './extension/hostBridge';
import { NoopMessageEnhancer } from './extension/hostBridge';
import { SessionService } from './extension/services/SessionService';
import { resolveStartupPairing } from './extension/session/sessionPairing';
import { SignalEmitter } from './utilities/signalEmitter';
import * as os from 'os';
import { ModelCapabilitiesService } from './extension/services/modelCapabilitiesService';
import { PlanModeToolsService, PLAN_MODE_AVAILABLE_TOOLS } from './extension/services/planModeToolsService';
import { FileSnapshotService } from './extension/services/fileSnapshotService';
import { MCPConfigurationService } from './extension/services/mcpConfigurationService';
import { ManagedMCPRegistry } from './extension/services/managedMCPRegistry';
import { getImportedServers } from './extension/services/vscodeMcpImportService';
import { CustomAgentsService } from './extension/services/CustomAgentsService';
import { resolveSkillDirectories } from './extension/services/SkillDirectoriesService';
import { DisposableStore, MutableDisposable, toDisposable } from './utilities/disposable';
import { BufferedEmitter } from './utilities/bufferedEmitter';
import {
    classifySessionError,
    checkAuthEnvVars,
    ErrorType,
    attemptSessionResumeWithRetry,
    showSessionRecoveryDialog,
    withTimeout,
    ensureSessionAlive
} from './sessionErrorUtils';
import { extractPlanHeading, buildKickoffMessage } from './extension/utils/planModeUtils';
import { parseCliVersion } from './utilities/cliVersion';
import { buildCliSpawnCommand } from './utilities/cliSpawn';
import { CopilotClientProvider } from './extension/services/CopilotClientProvider';
import { findSystemNodeRuntime, ensureNodeExecPath } from './extension/services/cliBundleService';

// Re-export so existing callers (tests included) keep working.
export { parseCliVersion };

// Dynamic import for SDK (ESM module)
let CopilotClient: any;
let CopilotSession: any;
let defineTool: any;

/**
 * Default model used when the user has not explicitly configured one.
 * 'auto' lets Copilot's server-side router pick the best available model per turn.
 */
export const DEFAULT_MODEL = 'auto';

/**
 * Fallback model used when a configured model is unsupported or mistyped.
 * 'auto' is the safest fallback — server-side routing never fails on an
 * unsupported model or a reasoning-effort mismatch.
 */
export const FALLBACK_MODEL = 'auto';

/**
 * Preferred model order for fallback selection.
 * When the requested model is unavailable, we pick the first model from this
 * list that appears in the user's available models. 'auto' is first because it
 * is always available and never fails.
 */
export const MODEL_PREFERENCE_ORDER = [
    'auto',
    'claude-sonnet-5',
    'claude-sonnet-4.6',
    'gpt-5.4',
    'claude-haiku-4.5',
    'gpt-5-mini',
    'claude-opus-4.8',
];

/**
 * Per-tool-call intent, keyed by the id `tool.execution_start` will report.
 *
 * Replaces the `report_intent` tool, which CLI 1.0.80 does not have. Every entry
 * in `assistant.message.toolRequests` now carries `intentionSummary` — *"resolved
 * intention summary describing what this specific call does"* — so the label
 * belongs to a specific call rather than to whatever ran next.
 *
 * That was a real defect, not just a rename. One `lastMessageIntent` held the most
 * recent intent for the next tool to start, so a message requesting three tools
 * labelled the first and left the rest bare — and mismatches mislabelled silently.
 */
export function collectToolIntents(toolRequests: unknown): Map<string, string> {
    const intents = new Map<string, string>();
    if (!Array.isArray(toolRequests)) {
        return intents;
    }
    for (const request of toolRequests) {
        const toolCallId = request?.toolCallId;
        const summary = request?.intentionSummary;
        if (typeof toolCallId === 'string' && typeof summary === 'string' && summary.trim()) {
            intents.set(toolCallId, summary);
        }
    }
    return intents;
}

/**
 * Which model a session is actually on, given what the CLI reports.
 *
 * The CLI is the authority here, not `copilotCLI.model`. When the configured
 * model does not exist the fallback switches to `auto` and the CLI says so in
 * `session.start.selectedModel` — but nothing adopted it, so the dropdown kept
 * showing the dead model from the setting, and `supportsVision()` /
 * `getMaxImages()` asked the capabilities service about a model absent from the
 * catalogue.
 *
 * @returns the model to adopt, or `null` to keep what is already tracked
 */
export function resolveActiveModel(reported: unknown, tracked: string | null): string | null {
    if (typeof reported !== 'string' || !reported) {
        // No reported model — older CLIs, and events that simply do not carry one.
        // Keep what we have rather than blanking the display.
        return null;
    }
    return reported === tracked ? null : reported;
}

/**
 * Select the best fallback model from the user's available models.
 *
 * Strategy:
 * 1. Query available models via ModelCapabilitiesService
 * 2. Walk MODEL_PREFERENCE_ORDER; return first match not excluded
 * 3. If no preferred model matches, return first available
 * 4. If getAllModels() fails or returns empty, return FALLBACK_MODEL
 */
export async function selectFallbackModel(
    modelCapabilitiesService: ModelCapabilitiesService,
    excludeModels: Set<string>,
    logger?: LoggerLike
): Promise<string> {
    try {
        const availableModels = await modelCapabilitiesService.getAllModels();

        if (!availableModels || availableModels.length === 0) {
            logger?.warn('[Model Fallback] No models returned from getAllModels(), using hardcoded fallback');
            return FALLBACK_MODEL;
        }

        const availableIds = new Set(availableModels.map(m => m.id));
        logger?.info(`[Model Fallback] Available models: [${Array.from(availableIds).join(', ')}]`);

        // Remove all models that have already failed
        for (const excluded of excludeModels) {
            availableIds.delete(excluded);
        }

        if (availableIds.size === 0) {
            logger?.warn('[Model Fallback] No models available after excluding failed models');
            return FALLBACK_MODEL;
        }

        // Walk preference list, return first match
        for (const preferred of MODEL_PREFERENCE_ORDER) {
            if (availableIds.has(preferred)) {
                logger?.info(`[Model Fallback] Selected preferred model: ${preferred}`);
                return preferred;
            }
        }

        // No preferred model available — use first available (not excluded)
        const firstAvailable = availableModels.find(m => !excludeModels.has(m.id))?.id;
        if (firstAvailable) {
            logger?.info(`[Model Fallback] No preferred model available, using first available: ${firstAvailable}`);
            return firstAvailable;
        }

        return FALLBACK_MODEL;
    } catch (error) {
        logger?.error('[Model Fallback] getAllModels() failed, using hardcoded fallback',
            error instanceof Error ? error : undefined);
        return FALLBACK_MODEL;
    }
}

/**
 * Resolve the Copilot CLI binary path.
 * The CJS/esbuild compatibility issue (SDK issue #528) was fixed in SDK v0.2.0 via PR #546.
 * We still always provide an explicit cliPath to avoid any future regressions.
 *
 * Resolution order:
 * 1. User-configured path (if explicitly set to something other than the bare default)
 * 2. SDK-bundled platform-specific binary (@github/copilot-{os}-{arch})
 * 3. PATH lookup via `which`/`where`
 * 4. Throw with install instructions
 */
export function resolveCliPath(
    logger: { info: (msg: string) => void },
    configuredPath?: string,
    host?: HostBridge
): string {
    // 1. User-configured path takes priority (skip bare default — it needs PATH resolution)
    const configured = configuredPath !== undefined
        ? configuredPath
        : host?.getConfig<string>('cliPath');
    if (configured && configured !== 'copilot') {
        logger.info(`Using configured CLI path: ${configured}`);
        return configured;
    }

    // 2. SDK-bundled platform-specific binary (matches SDK's @github/copilot dependency)
    // The @github/copilot-{os}-{arch} package exports the native binary directly.
    // require.resolve() returns the binary path without loading it.
    // Only works when running from source (dev); installed VSIX has no node_modules.
    try {
        const platformPkg = `@github/copilot-${process.platform}-${process.arch}`;
        const binPath = require.resolve(platformPkg);
        if (fs.existsSync(binPath)) {
            logger.info(`Resolved CLI from SDK bundle: ${binPath} (${platformPkg})`);
            return binPath;
        }
    } catch {
        // Platform package not installed — fall through to PATH
    }

    // 3. Resolve 'copilot' from PATH (cross-platform fallback)
    try {
        const cmd = process.platform === 'win32' ? 'where' : 'which';
        const result = execFileSync(cmd, ['copilot'], { encoding: 'utf-8', timeout: 5000, windowsHide: true }).trim();
        if (result) {
            const resolved = result.split(/\r?\n/)[0];
            logger.info(`Resolved CLI from PATH: ${resolved}`);
            return resolved;
        }
    } catch {
        // Not on PATH
    }

    // 4. Fail with actionable message
    throw new Error(
        'Copilot CLI not found on PATH. Install it (see https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli) ' +
        'or set copilotCLI.cliPath in VS Code settings.'
    );
}

/**
 * The default permission decision: approve this call, and only this call.
 *
 * Seeded here rather than left undefined until `loadSDK()` fills it in, because
 * `client.ts` sets the wire flag `requestPermission: !!config.onPermissionRequest`.
 * A config built before the SDK finished loading would therefore tell the CLI that
 * nobody will answer, and every permission request would hang pending forever.
 * `loadSDK()` still swaps in the SDK's own `approveAll`, so we stay on their
 * implementation once it is available.
 */
let approveAll: any = () => ({ kind: 'approve-once' });

async function loadSDK() {
    if (!CopilotClient) {
        const sdk = await import('@github/copilot-sdk');
        CopilotClient = sdk.CopilotClient;
        CopilotSession = sdk.CopilotSession;
        defineTool = sdk.defineTool;
        approveAll = sdk.approveAll;
    }
}

export interface CLIConfig {
    allowAll?: boolean;
    yolo?: boolean;
    allowAllTools?: boolean;
    allowAllPaths?: boolean;
    allowAllUrls?: boolean;
    allowTools?: string[];
    denyTools?: string[];
    allowUrls?: string[];
    denyUrls?: string[];
    addDirs?: string[];
    agent?: string;
    model?: string;
    planModel?: string;
    noAskUser?: boolean;
    streaming?: boolean;
}

export interface ToolExecutionState {
    toolCallId: string;
    toolName: string;
    arguments?: unknown;
    status: 'pending' | 'running' | 'complete' | 'failed';
    startTime: number;
    endTime?: number;
    result?: string;
    error?: { message: string; code?: string };
    progress?: string;
    intent?: string;  // Intent from the message containing this tool call
    agentId?: string;          // Sub-agent instance id (envelope) when this tool runs inside a sub-agent
    parentToolCallId?: string; // Redundant fallback: the spawning task's toolCallId
}

export interface StatusData {
    status: 'thinking' | 'ready' | 'exited' | 'stopped' | 'aborted' | 'session_expired' |
            'plan_mode_enabled' | 'plan_mode_disabled' | 'plan_accepted' | 'plan_rejected' |
            'plan_ready' | 'reset_metrics' | 'session_resume_failed' | 'authentication_required' |
            'message_queued' | 'model_switched' | 'model_switch_failed' | 'session_renamed';
    turnId?: string;
    sessionId?: string;  // For session ready
    newSessionId?: string;  // For session_expired
    reason?: string;  // For session_resume_failed
    resetMetrics?: boolean;  // For reset_metrics
    postCompactionTokens?: number;  // For reset_metrics after compaction
    summary?: string | null;  // For plan_ready
    /**
     * The plan session's id. For `plan_mode_enabled`.
     *
     * Published because it is derived here as `${workSessionId}-plan` and a consumer
     * that needs it would otherwise have to re-derive it from the suffix — becoming a
     * second place that knows what `-plan` means. The cost of ever adopting the CLI's
     * native plan mode is however many places know that; this keeps the number at one.
     */
    planSessionId?: string;
    model?: string;  // For model_switched / model_switch_failed
    name?: string;  // For session_renamed
}

export interface FileChangeData {
    path: string;
    type: 'created' | 'modified' | 'deleted';
}

export interface DiffData {
    toolCallId: string;
    beforeUri: string;
    afterUri: string;
    title?: string;
}

export interface UsageData {
    remainingPercentage?: number;
    currentTokens?: number;
    tokenLimit?: number;
    messagesLength?: number;
}

export interface TaskCompleteData {
    summary?: string;
}

/**
 * One row of the CLI's todo table.
 *
 * Every field is optional because the SDK says so: "the SQL schema is best-effort and
 * the agent may not have populated every column." Anything reading this has to cope
 * with a row that is entirely blank.
 */
export interface TodoRow {
    id?: string;
    title?: string;
    description?: string;
    status?: string;
}

/** The agent's plan, as fetched after a `session.todos_changed` signal. */
export interface TodosData {
    todos: TodoRow[];
    /** `todoId` depends on `dependsOn`. Empty when the agent declared no ordering. */
    dependencies: Array<{ todoId: string; dependsOn: string }>;
}

export interface SubagentStartData {
    agentId: string;          // envelope agentId (== spawning task's toolCallId)
    agentName?: string;
    agentDisplayName?: string;
    agentDescription?: string;
}

export interface SubagentMessageData {
    agentId: string;
    content?: string;       // the sub-agent's comment / output text
    reasoningText?: string; // plaintext reasoning ("thinking"), when present
}

/** One or more MCP servers whose tool list or runtime status changed. */
export interface McpServersUpdateData {
    servers: Array<{
        name: string;
        status: string;
        tools: string[];
    }>;
}

export interface SubagentCompleteData {
    agentId: string;
    status: 'complete' | 'failed';
    agentName?: string;
    agentDisplayName?: string;
    model?: string;
    totalToolCalls?: number;
    totalTokens?: number;
    durationMs?: number;
    error?: string;
}

type SessionMode = 'work' | 'plan';

/** Display cap that `SessionService.formatSessionLabel` truncates every label to. */
const LABEL_MAX = 40;

/**
 * True when a JSON-RPC rejection means "this peer has no such method" — the
 * over-the-wire equivalent of the method simply being absent.
 */
function isMethodNotFound(error: unknown): boolean {
    const code = (error as { code?: unknown } | null)?.code;
    return code === -32601;
}

export class SDKSessionManager implements vscode.Disposable {
    private client: any | null = null;
    private session: any | null = null;
    private sessionId: string | null = null;
    
    // Disposables management
    private readonly _disposables = new DisposableStore();
    private readonly _sessionSub = this._reg(new MutableDisposable<vscode.Disposable>());
    
    // Granular event emitters (created once, survive session switches)
    private readonly _onDidReceiveOutput = this._reg(new BufferedEmitter<{ content: string; messageId: string }>());
    readonly onDidReceiveOutput = this._onDidReceiveOutput.event;

    private readonly _onDidMessageDelta = this._reg(new BufferedEmitter<{ messageId: string; deltaContent: string }>());
    readonly onDidMessageDelta = this._onDidMessageDelta.event;
    
    private readonly _onDidReceiveReasoning = this._reg(new BufferedEmitter<{ reasoningId: string; content: string }>());
    readonly onDidReceiveReasoning = this._onDidReceiveReasoning.event;

    private readonly _onDidReceiveReasoningDelta = this._reg(new BufferedEmitter<{ reasoningId: string; deltaContent: string }>());
    readonly onDidReceiveReasoningDelta = this._onDidReceiveReasoningDelta.event;
    
    private readonly _onDidReceiveError = this._reg(new BufferedEmitter<string>());
    readonly onDidReceiveError = this._onDidReceiveError.event;
    
    private readonly _onDidChangeStatus = this._reg(new BufferedEmitter<StatusData>());
    readonly onDidChangeStatus = this._onDidChangeStatus.event;
    
    private readonly _onDidStartTool = this._reg(new BufferedEmitter<ToolExecutionState>());
    readonly onDidStartTool = this._onDidStartTool.event;
    
    private readonly _onDidUpdateTool = this._reg(new BufferedEmitter<ToolExecutionState>());
    readonly onDidUpdateTool = this._onDidUpdateTool.event;
    
    private readonly _onDidCompleteTool = this._reg(new BufferedEmitter<ToolExecutionState>());
    readonly onDidCompleteTool = this._onDidCompleteTool.event;
    
    private readonly _onDidChangeFile = this._reg(new BufferedEmitter<FileChangeData>());
    readonly onDidChangeFile = this._onDidChangeFile.event;
    
    private readonly _onDidProduceDiff = this._reg(new BufferedEmitter<DiffData>());
    readonly onDidProduceDiff = this._onDidProduceDiff.event;
    
    private readonly _onDidUpdateUsage = this._reg(new BufferedEmitter<UsageData>());
    readonly onDidUpdateUsage = this._onDidUpdateUsage.event;

    private readonly _onDidTaskComplete = this._reg(new BufferedEmitter<TaskCompleteData>());
    readonly onDidTaskComplete = this._onDidTaskComplete.event;

    /**
     * The agent's todo list changed — its plan, in the CLI's vocabulary.
     *
     * Carries the fetched state rather than the bare signal the CLI sends, so every
     * consumer does not repeat the same RPC and get a different answer depending on
     * when it ran.
     */
    private readonly _onDidUpdateTodos = this._reg(new BufferedEmitter<TodosData>());
    readonly onDidUpdateTodos = this._onDidUpdateTodos.event;

    /**
     * The session is quiet — no turn running, **and no background agents or attached
     * shell commands in flight**. That last part is why this exists separately from
     * turn status: `assistant.turn_end` says the assistant stopped, not that the
     * session did.
     *
     * A `SignalEmitter`, not a `BufferedEmitter`, and that is load-bearing. Idle is a
     * transition: `ephemeral: true`, never written to the event log, fired at the end
     * of every turn. A consumer arms a countdown on it, so replaying buffered idles to
     * a late subscriber would wind down a session that is busy right now.
     *
     * Added for P3's orphaned-host wind-down (Lane B, cross-talk 03), which otherwise
     * settles for turn status and can therefore wind down while a sub-agent is still
     * running.
     */
    private readonly _onDidBecomeIdle = this._reg(new SignalEmitter<void>());
    readonly onDidBecomeIdle = this._onDidBecomeIdle.event;

    private readonly _onDidStartSubagent = this._reg(new BufferedEmitter<SubagentStartData>());
    readonly onDidStartSubagent = this._onDidStartSubagent.event;

    private readonly _onDidCompleteSubagent = this._reg(new BufferedEmitter<SubagentCompleteData>());
    readonly onDidCompleteSubagent = this._onDidCompleteSubagent.event;

    private readonly _onDidSubagentMessage = this._reg(new BufferedEmitter<SubagentMessageData>());
    readonly onDidSubagentMessage = this._onDidSubagentMessage.event;

    private readonly _onDidUpdateMcpServers = this._reg(new BufferedEmitter<McpServersUpdateData>());
    readonly onDidUpdateMcpServers = this._onDidUpdateMcpServers.event;
    
    private logger: LoggerLike;
    private workingDirectory: string;
    private resumeSession: boolean;
    private toolExecutions: Map<string, ToolExecutionState> = new Map();
    private sdkLoaded: boolean = false;
    /**
     * toolCallId -> what the CLI said that call is for, from `intentionSummary`.
     * Entries are removed as their tool starts; `setActiveSession` clears the rest,
     * so requests that never execute cannot accumulate across a session swap.
     */
    private toolIntents = new Map<string, string>();
    private _isInTurn: boolean = false;  // Track if AI is currently processing a turn
    
    // Plan mode: dual session support
    private currentMode: SessionMode = 'work';
    private workSession: any | null = null;
    private planSession: any | null = null;
    private workSessionId: string | null = null;
    private planModeSnapshot: string | null = null;
    
    // Services
    private modelCapabilitiesService: ModelCapabilitiesService;
    private currentModelId: string | null = null;

    /**
     * Who answers permission requests. Unset means "this manager does", via
     * `approveAll`. See {@link setPermissionHandler}.
     */
    private permissionHandler: ((request: any, invocation: any) => any) | undefined;
    private planModeToolsService: PlanModeToolsService | null = null;
    private _messageEnhancementService: MessageEnhancerLike | null = null;
    private fileSnapshotService: FileSnapshotService;
    private mcpConfigurationService: MCPConfigurationService;
    private managedMCPRegistry: ManagedMCPRegistry;
    private customAgentsService: CustomAgentsService;
    /** SDK session-level selected agent. null = auto-inference. Distinct from backendState.activeAgent (UI). */
    private _sessionAgent: string | null = null;

    private injectedCliPath: string | null = null;

    public getCliPathForTest(): string | null {
        return this.injectedCliPath;
    }

    private readonly host: HostBridge;

    /**
     * Owns building, starting, replacing and stopping the CopilotClient. Public
     * because it is a seam, not an internal: a caller running several managers
     * against one CLI process constructs the provider and injects it.
     */
    public readonly clientProvider: CopilotClientProvider;

    /** False when the provider was injected — a consumer must not stop what it shares. */
    private readonly ownsClientProvider: boolean;

    /**
     * @param hostBridge Required. The manager used to accept a `vscode.ExtensionContext`
     *   instead and build the VS Code bridge itself, which meant this module named the
     *   VS Code host in a static import — the one thing that would survive renaming the
     *   file it came from. Whoever constructs a manager knows which host it is for; the
     *   manager does not need to.
     */
    constructor(
        private readonly config: CLIConfig = {},
        resumeLastSession: boolean = true,
        specificSessionId?: string,
        cliPath?: string,
        hostBridge?: HostBridge,
        clientProvider?: CopilotClientProvider
    ) {
        this.injectedCliPath = cliPath ?? null;
        if (!hostBridge) {
            // Optional in the signature only so the failure is this sentence rather
            // than a TypeError from the first `this.host.` call, which lands far from
            // the cause. JavaScript callers get the same message TypeScript would.
            throw new Error('SDKSessionManager requires an injected HostBridge.');
        }
        this.host = hostBridge;
        this.logger = this.host.logger;
        // Services constructed below reach for the Logger singleton directly, so
        // point it at the host's logger to keep them working where there is no
        // output channel. Guarded because tests substitute the logger module.
        const loggerClass = Logger as Partial<typeof Logger>;
        if (typeof loggerClass.setInstance === 'function') {
            loggerClass.setInstance(this.logger);
        }
        this.workingDirectory = this.host.getWorkspaceFolder() || process.cwd();
        this.logger.info(`Working directory set to: ${this.workingDirectory}`);
        this.resumeSession = resumeLastSession;
        
        // Initialize services
        this.modelCapabilitiesService = new ModelCapabilitiesService();
        this.fileSnapshotService = new FileSnapshotService();
        this.mcpConfigurationService = new MCPConfigurationService(this.workingDirectory);
        this.managedMCPRegistry = new ManagedMCPRegistry();
        this.customAgentsService = new CustomAgentsService();

        // A provider handed in is shared — typically one CLI process behind several
        // managers — so this manager consumes it and must never stop it. Building
        // our own makes us the owner, which is the single-sidebar case.
        this.ownsClientProvider = !clientProvider;
        this.clientProvider = clientProvider ?? this.createOwnClientProvider();


        // If specific session ID provided, use it
        if (specificSessionId) {
            this.sessionId = specificSessionId;
            this.logger.info(`Using specific session: ${this.sessionId}`);
        }
        // Otherwise, if resuming, load the last session ID
        else if (this.resumeSession) {
            this.loadLastSessionId();
        }
    }
    
    /**
     * The provider used when nobody supplied one. Every dependency is resolved
     * lazily, per client creation, so a re-created client picks up the current
     * CLI path and yolo setting rather than whatever they were at construction.
     */
    private createOwnClientProvider(): CopilotClientProvider {
        return new CopilotClientProvider({
            logger: this.logger,
            workingDirectory: this.workingDirectory,
            resolveCliPath: () => this.injectedCliPath ?? resolveCliPath(this.logger, undefined, this.host),
            useYolo: () => {
                const yolo = this.host.getConfig<boolean>('yolo', false) ?? false;
                // An explicit allow/deny policy is finer-grained than --yolo, so
                // the policy wins and the flag is dropped.
                const hasToolPolicy =
                    (this.config.allowTools?.length ?? 0) > 0 || (this.config.denyTools?.length ?? 0) > 0;
                return yolo && !hasToolPolicy;
            },
            createClient: options => new CopilotClient(options)
            // No `onClientStarted`: `adoptClient` initialises capabilities. A hook here
            // as well would be a second writer for the same fact, and the two only
            // agreed while the same object happened to build the provider and own the
            // service.
        });
    }

    /**
     * The message enhancer reads editor state, so it is built on first use
     * rather than at construction — a manager that never enhances a prompt
     * (or runs in a host with no editor) never creates one.
     */
    private get messageEnhancementService(): MessageEnhancerLike {
        if (!this._messageEnhancementService) {
            this._messageEnhancementService = this.host.createMessageEnhancer?.() ?? new NoopMessageEnhancer();
        }
        return this._messageEnhancementService;
    }

    private _reg<T extends vscode.Disposable>(d: T): T {
        this._disposables.add(d);
        return d;
    }

    private loadLastSessionId(): void {
        try {
            const filterByFolder = this.host.getConfig<boolean>('filterSessionsByFolder', true) ?? true;
            const sessionStateDir = path.join(os.homedir(), '.copilot', 'session-state');
            const sessionId = SessionService.getMostRecentSession(sessionStateDir, this.workingDirectory, filterByFolder);
            
            if (sessionId) {
                this.sessionId = sessionId;
                this.logger.info(`Will resume session: ${this.sessionId} (folder filtering: ${filterByFolder})`);
            } else {
                this.logger.info('No previous sessions found, will start new session');
            }
        } catch (error) {
            this.logger.error('Failed to load last session ID', error instanceof Error ? error : undefined);
        }
    }

    /**
     * Attempt to resume a session with retry logic and user recovery dialog
     * 
     * Uses circuit breaker pattern with exponential backoff:
     * - Retries up to 3 times for retriable errors
     * - Shows user dialog if all retries fail
     * - Skips retries for session_expired and authentication errors
     * 
     * @param sessionId - The session ID to resume
     * @param resumeOptions - Options to pass to resumeSession()
     * @returns The resumed session, or a new session if recovery chose that path
     */
    private async attemptSessionResumeWithUserRecovery(
        sessionId: string,
        resumeOptions: any
    ): Promise<any> {
        // Inject SDK 0.1.26 required fields into resume options
        resumeOptions = {
            ...resumeOptions,
            onPermissionRequest: this.permissionHandler ?? approveAll,
            clientName: 'vscode-copilot-cli',
            streaming: this.config.streaming ?? true,
            skillDirectories: this.resolveSkillDirectories(),
        };
        // Wrap the SDK's resumeSession in a function
        const resumeFn = () => this.client.resumeSession(sessionId, resumeOptions);
        
        // Retry loop for user-driven recovery
        while (true) {
            try {
                // Attempt resume with retry logic
                return await attemptSessionResumeWithRetry(
                    sessionId,
                    resumeFn,
                    this.logger
                );
            } catch (error) {
                // All retries failed - classify error and show user dialog
                const errorType = classifySessionError(error as Error);
                
                this.logger.warn(`[Resume] All retries exhausted, showing user dialog (error type: ${errorType})`);
                
                const userChoice = await this.host.askSessionRecovery(
                    sessionId,
                    errorType,
                    3, // Max attempts reached
                    error as Error
                );
                
                if (userChoice === 'retry') {
                    this.logger.info('[Resume] User chose "Try Again", retrying...');
                    // If connection was lost, recreate client before the next retry cycle
                    if (errorType === 'connection_closed') {
                        await this.recreateClient();
                    }
                    continue; // Loop back to retry
                } else {
                    // User wants new session - throw to trigger creation
                    this.logger.info('[Resume] User chose "Start New Session"');
                    throw error;
                }
            }
        }
    }

    /**
     * Log the CLI version for diagnostics.
     * Logs both --no-auto-update and regular versions to get the actual binary versions.
     */
    private logCliVersion(cliPath: string): void {
        try {
            const { command, args: prefix } = buildCliSpawnCommand(cliPath);
            const output = execFileSync(command, [...prefix, '--version', '--no-auto-update'], { encoding: 'utf-8', timeout: 5000, windowsHide: true }).trim();
            const version = parseCliVersion(output);
            if (version) {
                this.logger.info(`CLI version with --no-auto-update: ${version}`);
            }
            const output2 = execFileSync(command, [...prefix, '--version'], { encoding: 'utf-8', timeout: 5000, windowsHide: true }).trim();
            const version2 = parseCliVersion(output2);
            if (version2) {
                this.logger.info(`CLI version without --no-auto-update: ${version2}`);
            }

        } catch (e: any) {
            this.logger.warn(`Could not determine CLI version: ${e.message}`);
        }
    }

    public async start(): Promise<void> {
        this.logger.info('Starting SDK Session Manager...');

        try {
            const cliPath = this.injectedCliPath ?? resolveCliPath(this.logger, undefined, this.host);
            if (this.injectedCliPath) {
                this.logger.info(`Using injected CLI path: ${cliPath}`);
            }

            // Override process.execPath BEFORE logCliVersion(): the version probe
            // spawns `process.execPath cliPath --version` for .js entrypoints, and
            // if we don't override first, that probe runs under Electron's Node
            // and could reproduce the very Windows argv bug this PR fixes.
            ensureNodeExecPath(findSystemNodeRuntime(), this.logger);

            this.logCliVersion(cliPath);

            // Load SDK dynamically
            if (!this.sdkLoaded) {
                await loadSDK();
                this.sdkLoaded = true;
            }
            // The provider builds, starts and wires diagnostics on the client.
            // Capabilities are initialised here rather than by the provider — see
            // `adoptClient`.
            await this.acquireClient();

            this.logger.info('CopilotClient created and started, initializing session...');

            // Create or resume session
            const mcpServers = this.getEnabledMCPServers();
            const hasMcpServers = Object.keys(mcpServers).length > 0;
            
            this.logger.info(`MCP Servers to configure: ${hasMcpServers ? JSON.stringify(Object.keys(mcpServers)) : 'none'}`);
            if (hasMcpServers) {
                this.logger.debug(`MCP Server details: ${JSON.stringify(mcpServers, null, 2)}`);
            }
            
            // Track whether we created a new session (vs resumed)
            let sessionWasCreatedNew = false;

            // Was the last active session the plan half of a conversation? Asked of
            // sessionPairing rather than matched here: that module is the one place
            // allowed to know what `-plan` means, and this was the reader that
            // learned the convention by copying it.
            const startupStateDir = path.join(os.homedir(), '.copilot', 'session-state');
            const startupPairing = this.sessionId
                ? resolveStartupPairing(startupStateDir, this.sessionId)
                : null;
            const restoringPlanMode = startupPairing?.role === 'plan';
            if (restoringPlanMode) {
                // Deliberately NOT resuming the work session first. It may never have
                // had a transcript — entering plan mode straight away leaves it
                // created but unresumable, and `session.resume` answers "Session not
                // found", which is the "Previous session not found" dialog. It is not
                // needed until plan mode is left, and `disablePlanMode` already mints
                // one at exactly that moment. enablePlanMode() below resumes the plan
                // session, conversation and tool restrictions intact
                // (planning/spikes/plan-session-reuse/).
                this.sessionId = startupPairing!.workId;
            }

            if (restoringPlanMode) {
                // No work session yet, by design. `this.session` stays null;
                // setupSessionEventHandlers() already no-ops on that, and
                // enablePlanMode() installs the plan session as the active one.
                this.logger.info(`[Startup] Restoring plan mode — deferring the work session (work: ${this.sessionId})`);
            } else if (this.sessionId) {
                this.logger.info(`Attempting to resume session: ${this.sessionId}`);
                try {
                    // Use retry logic with user recovery dialog
                    this.session = await this.attemptSessionResumeWithUserRecovery(
                        this.sessionId,
                        {
                            model: this.config.model || undefined,
                            tools: this.getCustomTools(),
                            hooks: this.getSessionHooks(),
                            ...(hasMcpServers ? { mcpServers } : {}),
                            customAgents: this.customAgentsService.toSDKAgents(),
                        }
                    );
                    this.logger.info('Successfully resumed session');
                } catch (error) {
                    // Session could not be resumed - classify the error
                    const errorType = classifySessionError(error as Error);
                    
                    // Handle authentication errors differently - fail fast, don't create new session
                    if (errorType === 'authentication') {
                        this.logger.error('Authentication failure - cannot resume or create session. User needs to run: gh auth login');
                        this._onDidChangeStatus.fire({ status: 'authentication_required' as any });
                        throw error; // Propagate auth errors - user must fix
                    }
                    
                    // For other errors, create new session
                    this.logger.warn(`Failed to resume session ${this.sessionId} (error type: ${errorType}), creating new session`);
                    this.sessionId = null;
                    sessionWasCreatedNew = true;
                    // Recreate client if connection was lost (prevents "Connection is closed" on createSession)
                    if (errorType === 'connection_closed') {
                        await this.recreateClient();
                    }
                    this.session = await this.createSessionWithModelFallback({
                        model: this.config.model || undefined,
                        tools: this.getCustomTools(),
                        hooks: this.getSessionHooks(),
                        ...(hasMcpServers ? { mcpServers } : {}),
                        customAgents: this.customAgentsService.toSDKAgents(),
                    });
                    this.sessionId = this.session.sessionId;

                    // Notify user with appropriate status
                    const status = errorType === 'session_expired' ? 'session_expired' : 'session_resume_failed';
                    this._onDidChangeStatus.fire({ 
                        status: status as any, 
                        newSessionId: this.sessionId || undefined,
                        reason: errorType as any
                    });
                }
            } else {
                this.logger.info('Creating new session');
                sessionWasCreatedNew = true;
                this.session = await this.createSessionWithModelFallback({
                    model: this.config.model || undefined,
                    tools: this.getCustomTools(),
                    hooks: this.getSessionHooks(),
                    ...(hasMcpServers ? { mcpServers } : {}),
                    customAgents: this.customAgentsService.toSDKAgents(),
                });
                this.sessionId = this.session.sessionId;
            }

            this.logger.info(`Session active: ${this.sessionId}`);

            if (!restoringPlanMode) {
                // Restore sticky agent if one was active before session (re)creation
                await this._restoreStickyAgentIfNeeded();

                // Ensure the dropdown always shows a readable name — never a raw UUID.
                SessionService.ensureSessionName(path.join(os.homedir(), '.copilot', 'session-state', this.sessionId!));
            }
            
            // Initialize work session tracking. Restoring plan mode leaves
            // `workSession` null on purpose — there is no work session yet, and
            // disablePlanMode() mints one at the moment it is needed.
            this.workSession = this.session;
            this.workSessionId = this.sessionId;
            this.currentMode = 'work';
            
            // Reset session-level metrics for new sessions
            if (sessionWasCreatedNew) {
                this.logger.info('[Metrics] Resetting session-level metrics for new session');
                this._onDidChangeStatus.fire({ status: 'reset_metrics', resetMetrics: true });
            }

            // Set up event listeners (also attaches CLI process lifecycle listeners)
            this.setActiveSession(this.session);

            // Fetch model capabilities for vision support
            await this.updateModelCapabilities();

            // Plan mode is restored BEFORE `ready`, not after. `ready` carries the
            // session id the surface then treats as current, and announcing the work
            // id first would publish a session that is not live and, when restoring,
            // does not yet exist.
            if (restoringPlanMode) {
                this.logger.info('[Startup] Restoring plan mode...');
                await this.enablePlanMode();
            }

            this._onDidChangeStatus.fire({ 
                status: 'ready', 
                sessionId: this.sessionId || undefined
            });


        } catch (error) {
            this.logger.error('Failed to start SDK session', error instanceof Error ? error : undefined);
            
            // Classify the error for better error handling
            if (error instanceof Error) {
                const errorType = classifySessionError(error);
                const envCheck = checkAuthEnvVars();
                
                // Log classification results
                this.logger.info(`[Auth Detection] Classified as ${errorType} error`);
                if (envCheck.hasEnvVar) {
                    this.logger.info(`[Auth Detection] Found ${envCheck.source} environment variable`);
                } else {
                    this.logger.info('[Auth Detection] No authentication environment variables found');
                }
                
                this.logger.error(`[Auth Detection] Error type: ${errorType}, Has env var: ${envCheck.hasEnvVar}${envCheck.source ? ` (${envCheck.source})` : ''}`);
                
                // Create enhanced error with classification info
                const enhancedError: any = error;
                enhancedError.errorType = errorType;
                enhancedError.hasEnvVar = envCheck.hasEnvVar;
                enhancedError.envVarSource = envCheck.source;
                
                throw enhancedError;
            }
            
            throw error;
        }
    }

    /**
     * Set the active session and wire up event handlers.
     * Consolidates session assignment + event wiring to prevent leaks.
     */
    private setActiveSession(session: any): void {
        // Intents name calls in the session being left; nothing here can consume them.
        this.toolIntents.clear();
        this.session = session;
        this.setupSessionEventHandlers();
        // The CLI process is guaranteed to be spawned by this point, so a client
        // created before it existed can now get its diagnostics wired.
        this.clientProvider.ensureListenersAttached();
    }

    private setupSessionEventHandlers(): void {
        if (!this.session) { return; }
        this._sessionSub.value = toDisposable(
            this.session.on((event: any) => this._handleSDKEvent(event))
        );
    }

    private _handleSDKEvent(event: any): void {
        try {
        this.logger.debug(`[SDK Event] ${event.type}: ${JSON.stringify(event.data)}`);

        switch (event.type) {
            case 'assistant.message':
                if (event.data.toolRequests && Array.isArray(event.data.toolRequests)) {
                    // The CLI names what each call is for. Held by toolCallId until
                    // that call starts, then consumed.
                    for (const [toolCallId, intent] of collectToolIntents(event.data.toolRequests)) {
                        this.toolIntents.set(toolCallId, intent);
                    }

                    // Pre-capture snapshots for edit/create tools BEFORE execution starts.
                    // assistant.message arrives before tool.execution_start, giving us a
                    // reliable window to read the original file content.
                    for (const toolReq of event.data.toolRequests) {
                        if ((toolReq.name === 'edit' || toolReq.name === 'create') && toolReq.arguments?.path) {
                            this.fileSnapshotService.captureByPath(toolReq.name, toolReq.arguments.path);
                        }
                    }
                }
                
                // Fire output message, conditioned on toolRequests presence.
                // When toolRequests are present, content is a mid-thought fragment — suppress it.
                // We still send an empty finalization signal so any streaming bubble gets finalized.
                // See ADR-006 Decision 3.
                const hasToolRequests = event.data.toolRequests && event.data.toolRequests.length > 0;
                const hasContent = event.data.content && event.data.content.trim().length > 0;
                if (event.agentId) {
                    // Sub-agent message: route to the dock, NEVER the main transcript.
                    // Only real comments (content without mid-thought tool fragments) carry through.
                    if ((hasContent && !hasToolRequests) || event.data.reasoningText) {
                        this._onDidSubagentMessage.fire({
                            agentId: event.agentId,
                            content: hasContent && !hasToolRequests ? event.data.content : undefined,
                            reasoningText: event.data.reasoningText,
                        });
                    }
                } else if (hasContent && !hasToolRequests) {
                    this._onDidReceiveOutput.fire({ content: event.data.content, messageId: event.data.messageId ?? '' });
                } else if (hasToolRequests && event.data.messageId) {
                    // Suppress content but send empty signal to finalize any in-progress streaming bubble
                    this._onDidReceiveOutput.fire({ content: '', messageId: event.data.messageId });
                }
                break;

            case 'assistant.reasoning':
                if (event.agentId) { break; } // sub-agent reasoning never enters the main transcript
                // Guard: some models (e.g. gpt via `auto`) emit reasoning with empty content
                // and only an opaque encrypted reasoningId — nothing to display. Forwarding it
                // renders a blank "Assistant Reasoning" box, so skip empty/whitespace content.
                if (!event.data.content || !event.data.content.trim()) { break; }
                this._onDidReceiveReasoning.fire({ reasoningId: event.data.reasoningId ?? '', content: event.data.content });
                break;

            case 'assistant.reasoning_delta':
                if (event.agentId) { break; } // sub-agent reasoning deltas suppressed from main
                // Symmetric with the assistant.reasoning guard: don't forward empty deltas
                // across the RPC boundary (the webview also defers bubble creation until the
                // first non-empty delta, so this is defense-in-depth, not the sole guard).
                if (!event.data.deltaContent) { break; }
                this._onDidReceiveReasoningDelta.fire({
                    reasoningId: event.data.reasoningId,
                    deltaContent: event.data.deltaContent,
                });
                break;

            case 'user.message':
                break;

            case 'assistant.message_delta':
                if (event.agentId) { break; } // sub-agent text streams via onDidSubagentMessage, not the main bubble
                this._onDidMessageDelta.fire({
                    messageId: event.data.messageId,
                    deltaContent: event.data.deltaContent,
                });
                break;

            case 'tool.execution_start':
                this.handleToolStart(event);
                break;

            case 'tool.execution_progress':
                this.handleToolProgress(event);
                break;

            case 'tool.execution_complete':
                this.handleToolComplete(event);
                break;

            case 'tool.execution_partial_result':
                // Incremental (cumulative) stdout/stderr from a running tool.
                // Stored for future "live output" feature — see planning/backlog/stream-tool-output-on-request.md
                this.logger.debug(`[Tool Output] ${event.data.toolCallId}: ${event.data.partialOutput?.length ?? 0} chars`);
                break;

            case 'session.error':
                this._onDidReceiveError.fire(event.data.message);
                break;

            case 'session.start':
            case 'session.resume': {
                this.logger.info(`Session ${event.type}: ${JSON.stringify(event.data)}`);
                // The CLI names the model it actually chose. Adopt it — a fallback
                // to `auto` happens below the extension, and without this the UI
                // goes on reporting the setting instead of the session.
                const adopted = resolveActiveModel(event.data?.selectedModel, this.currentModelId);
                if (adopted) {
                    this.logger.info(`[Model] CLI reports "${adopted}" (was "${this.currentModelId ?? 'unset'}")`);
                    this.currentModelId = adopted;
                    this._onDidChangeStatus.fire({ status: 'model_switched', model: adopted });
                }
                break;
            }

            case 'session.idle':
                this.logger.info(`Session ${event.type}: ${JSON.stringify(event.data)}`);
                // `session.idle` carries an optional `agentId`. A sub-agent going quiet
                // is not the session going quiet, and forwarding it would fire a
                // wind-down while the parent is still working — the precise failure the
                // consumer is moving off turn status to escape.
                if (!event.agentId) {
                    this._onDidBecomeIdle.fire();
                }
                break;
            
            case 'assistant.turn_start':
                this._isInTurn = true;
                this.logger.debug(`Assistant turn ${event.data.turnId} started`);
                this._onDidChangeStatus.fire({ status: 'thinking', turnId: event.data.turnId });
                break;

            case 'assistant.turn_end':
                this._isInTurn = false;
                this.logger.debug(`Assistant turn ${event.data.turnId} ended`);
                this._onDidChangeStatus.fire({ status: 'ready', turnId: event.data.turnId });
                break;
            
            case 'session.usage_info':
                this.logger.debug(`Token usage: ${event.data.currentTokens}/${event.data.tokenLimit}`);
                this._onDidUpdateUsage.fire({
                    currentTokens: event.data.currentTokens,
                    tokenLimit: event.data.tokenLimit,
                    messagesLength: event.data.messagesLength
                });
                break;
        
            case 'assistant.usage':
                // Request quota information
                if (event.data.quotaSnapshots) {
                    let quota = event.data.quotaSnapshots.premium_interactions;
                    let quotaType = 'premium_interactions';
                    
                    if (!quota) {
                        const quotaKeys = Object.keys(event.data.quotaSnapshots);
                        for (const key of quotaKeys) {
                            const q = event.data.quotaSnapshots[key];
                            if (!q.isUnlimitedEntitlement) {
                                quota = q;
                                quotaType = key;
                                break;
                            }
                        }
                    }
                    
                    if (quota && !quota.isUnlimitedEntitlement) {
                        this.logger.debug(`Quota (${quotaType}): ${quota.remainingPercentage}% remaining`);
                        this._onDidUpdateUsage.fire({ remainingPercentage: quota.remainingPercentage });
                    }
                }
                break;

            case 'session.compaction_start':
                this.logger.info('[Compaction] Compaction started');
                break;

            case 'session.compaction_complete': {
                const { success, postCompactionTokens, preCompactionTokens } = event.data;
                this.logger.info(`[Compaction] Complete: success=${success}, tokens ${preCompactionTokens} → ${postCompactionTokens}`);
                if (success) {
                    this._onDidChangeStatus.fire({
                        status: 'reset_metrics',
                        resetMetrics: true,
                        postCompactionTokens: postCompactionTokens ?? 0,
                    });
                }
                break;
            }

            case 'pending_messages.modified':
                if (this._isInTurn) {
                    this.logger.info('[Queue] Message queued while AI is processing');
                    this._onDidChangeStatus.fire({ status: 'message_queued' });
                }
                break;

            case 'session.model_change':
                this.logger.info(`[SDK Event] ${event.type}: ${JSON.stringify(event.data)}`);
                if (event.data.newModel) {
                    this.config.model = event.data.newModel;
                    this._onDidChangeStatus.fire({ status: 'model_switched', model: event.data.newModel });
                }
                break;

            case 'session.title_changed':
                this.logger.info(`[Rename] Session title changed: "${event.data.title}"`);
                if (event.data.title && this.sessionId) {
                    try {
                        // Strip [Active File: ...] prefix if present (added by messageEnhancementService)
                        let cleanTitle = event.data.title.replace(/^\[Active File:.*?\]\s*/s, '').trim();
                        
                        // If title is multiline, take only the first non-empty line
                        const lines = cleanTitle.split('\n').map((l: string) => l.trim()).filter((l: string) => l);
                        if (lines.length > 0) {
                            cleanTitle = lines[0];
                        }
                        
                        this.logger.debug(`[Rename] Clean title: "${cleanTitle}"`);

                        if (cleanTitle) {
                            const sessionNamePath = path.join(
                                os.homedir(), '.copilot', 'session-state',
                                this.sessionId, 'session-name.txt'
                            );
                            fs.writeFileSync(sessionNamePath, cleanTitle, 'utf-8');
                            this._onDidChangeStatus.fire({ status: 'session_renamed', name: cleanTitle });
                        } else {
                            this.logger.debug('[Rename] Skipping session-name.txt write: cleanTitle is empty');
                        }
                    } catch (writeErr) {
                        this.logger.error(`[Rename] Failed to write session-name.txt: ${writeErr}`);
                    }
                }
                break;

            case 'subagent.started': {
                const d = event.data ?? {};
                const agentId = event.agentId ?? d.toolCallId;
                this.logger.info(`[Subagent Start] ${d.agentDisplayName ?? d.agentName} (${agentId})`);
                if (agentId) {
                    this._onDidStartSubagent.fire({
                        agentId,
                        agentName: d.agentName,
                        agentDisplayName: d.agentDisplayName,
                        agentDescription: d.agentDescription,
                    });
                }
                break;
            }

            case 'subagent.completed':
            case 'subagent.failed': {
                const d = event.data ?? {};
                const agentId = event.agentId ?? d.toolCallId;
                const status = event.type === 'subagent.failed' ? 'failed' : 'complete';
                this.logger.info(`[Subagent Complete] ${d.agentDisplayName ?? d.agentName} (${agentId}) status=${status}`);
                if (agentId) {
                    this._onDidCompleteSubagent.fire({
                        agentId, status,
                        agentName: d.agentName,
                        agentDisplayName: d.agentDisplayName,
                        model: d.model,
                        totalToolCalls: d.totalToolCalls,
                        totalTokens: d.totalTokens,
                        durationMs: d.durationMs,
                        error: d.error,
                    });
                }
                break;
            }

            case 'subagent.selected':
            case 'hook.start':
            case 'hook.end':
            case 'skill.invoked':
                this.logger.info(`[SDK Event] ${event.type}: ${JSON.stringify(event.data)}`);
                break;

            case 'subagent.deselected':
                this.logger.info(`[SDK Event] subagent.deselected: ${JSON.stringify(event.data)}`);
                break;

            case 'session.background_tasks_changed':
                this.logger.info(`[SDK Event] session.background_tasks_changed: ${JSON.stringify(event.data)}`);
                break;

            case 'system.notification':
                this.logger.info(`[SDK Event] system.notification kind=${event.data?.kind?.description}: ${JSON.stringify(event.data)}`);
                break;

            case 'permission.requested':
            case 'permission.completed':
                this.logger.info(`[SDK Event] ${event.type}: ${JSON.stringify(event.data)}`);
                break;

            case 'session.todos_changed':
                // Signal-only by design: the SDK documents this event as carrying no
                // payload and tells clients to read the current state themselves.
                // Fire-and-forget so a SQL read never blocks the event pump that every
                // other emitter shares.
                void this.readTodos();
                break;

            case 'session.task_complete':
                this.logger.info(`[SDK Event] session.task_complete summary=${event.data?.summary}: ${JSON.stringify(event.data)}`);
                this._onDidTaskComplete.fire({ summary: event.data?.summary });
                break;

            case 'session.mcp_servers_loaded': {
                const servers = event.data?.servers ?? [];
                this.logger.info(`[MCP] mcp_servers_loaded: ${servers.map((s: any) => `${s.name}=${s.status}`).join(', ')}`);
                this._onDidUpdateMcpServers.fire({
                    servers: servers.map((s: any) => ({
                        name: s.name,
                        status: s.status,
                        tools: s.tools ?? []
                    }))
                });
                break;
            }

            case 'session.mcp_server_status_changed':
                this.logger.info(`[MCP] mcp_server_status_changed: ${event.data?.serverName}=${event.data?.status}`);
                if (event.data?.serverName) {
                    this._onDidUpdateMcpServers.fire({
                        servers: [{
                            name: event.data.serverName,
                            status: event.data.status,
                            tools: event.data.tools ?? []
                        }]
                    });
                }
                break;

            default:
                if (event.type && event.type.toLowerCase().includes('mcp')) {
                    this.logger.warn(`[MCP] Unhandled MCP event "${event.type}": ${JSON.stringify(event.data)}`);
                } else {
                    this.logger.debug(`Unhandled event type: ${event.type}`);
                }
        }
        } catch (error) {
            this.logger.error(`[SDK Event] Error handling event "${event?.type}": ${error instanceof Error ? error.message : error}`);
        }
    }

    private handleToolStart(event: any): void {
        try {
            const eventTime = event.timestamp ? new Date(event.timestamp).getTime() : Date.now();
            const data = event.data;

            this.logger.info(`[Tool Start] tool=${data.toolName} mode=${this.currentMode} session=${this.sessionId?.substring(0, 8)}`);

            const state: ToolExecutionState = {
                toolCallId: data.toolCallId,
                toolName: data.toolName,
                arguments: data.arguments,
                status: 'running',
                startTime: eventTime,
                intent: this.toolIntents.get(data.toolCallId),
                agentId: event.agentId,                  // envelope: set when this tool runs inside a sub-agent
                parentToolCallId: data.parentToolCallId, // redundant fallback
            };

            // Consumed: this label belonged to this call and no other.
            this.toolIntents.delete(data.toolCallId);

            this.toolExecutions.set(data.toolCallId, state);

            // Phase 2: correlate pre-hook snapshot (captured by path) to toolCallId
            if (data.toolName === 'edit' || data.toolName === 'create') {
                const filePath = data.arguments?.path;
                if (filePath) {
                    this.fileSnapshotService.correlateToToolCallId(filePath, data.toolCallId);

                    // Fallback: if onPreToolUse hook didn't fire (e.g. resumed session
                    // originally created without hooks), capture snapshot now.
                    // This has a race condition (file may already be modified), but it's
                    // better than no diff at all.
                    if (!this.fileSnapshotService.getSnapshot(data.toolCallId)) {
                        this.logger.warn(`[FileSnapshot] Hook did not fire for ${data.toolName} — using fallback capture (race possible)`);
                        this.fileSnapshotService.captureByPath(data.toolName, filePath);
                        this.fileSnapshotService.correlateToToolCallId(filePath, data.toolCallId);
                    }
                }
            }

            this._onDidStartTool.fire(state);
        } catch (error) {
            this.logger.error(`[SDK Event] Error in handleToolStart: ${error instanceof Error ? error.message : error}`);
        }
    }

    private handleToolProgress(event: any): void {
        try {
            const data = event.data;
            const state = this.toolExecutions.get(data.toolCallId);
            if (state) {
                state.progress = data.progressMessage;

                this._onDidUpdateTool.fire(state);
            }
        } catch (error) {
            this.logger.error(`[SDK Event] Error in handleToolProgress: ${error instanceof Error ? error.message : error}`);
        }
    }

    private handleToolComplete(event: any): void {
        try {
            const eventTime = event.timestamp ? new Date(event.timestamp).getTime() : Date.now();
            const data = event.data;
            const state = this.toolExecutions.get(data.toolCallId);
            if (state) {
                state.status = data.success ? 'complete' : 'failed';
                state.endTime = eventTime;
                state.result = data.result?.content;
                state.error = data.error ? { message: data.error.message, code: data.error.code } : undefined;

                this._onDidCompleteTool.fire(state);

                // Check if this was a file operation
                if (state.toolName === 'edit' || state.toolName === 'create') {
                    this._onDidChangeFile.fire({
                        path: (state.arguments as any)?.path || '',
                        type: state.toolName === 'create' ? 'created' : 'modified'
                    });

                    // If we have a snapshot and operation succeeded, fire diff_available
                    const snapshot = this.fileSnapshotService.getSnapshot(data.toolCallId);
                    if (snapshot && data.success) {
                        const fileName = path.basename(snapshot.originalPath);
                        this._onDidProduceDiff.fire({
                            toolCallId: data.toolCallId,
                            beforeUri: snapshot.tempFilePath,
                            afterUri: snapshot.originalPath,
                            title: `${fileName} (Before ↔ After)`
                        });
                    }
                }
            }
        } catch (error) {
            this.logger.error(`[SDK Event] Error in handleToolComplete: ${error instanceof Error ? error.message : error}`);
        }
    }
    
    
    public cleanupDiffSnapshot(toolCallId: string): void {
        this.fileSnapshotService.cleanupSnapshot(toolCallId);
    }

    /**
     * Provide a callback for custom tools to emit diff events.
     * Avoids circular dependencies by using a single-function interface.
     */
    public getDiffEmitCallback(): (diffData: DiffData) => void {
        return (diffData: DiffData) => {
            this.logger.info(`[Custom Tool Diff] ${diffData.title}`);
            this._onDidProduceDiff.fire(diffData);
        };
    }

    /**
     * Expose FileSnapshotService for extension handlers (e.g., temp cleanup).
     */
    public getFileSnapshotService(): FileSnapshotService {
        return this.fileSnapshotService;
    }

    /**
     * Build the SDK hooks config for session creation/resume.
     * Uses onPreToolUse to capture file snapshots BEFORE tool execution,
     * fixing the race condition where snapshots were captured too late.
     */
    private getSessionHooks(): { onPreToolUse: (input: any, invocation: any) => { permissionDecision?: string } } {
        return {
            onPreToolUse: (input: any, _invocation: any) => {
                this.logger.info(`[Hook] onPreToolUse fired: tool=${input.toolName}`);
                if (input.toolName === 'edit' || input.toolName === 'create') {
                    const filePath = (input.toolArgs as any)?.path;
                    if (filePath && !this.fileSnapshotService.getPendingByPath(filePath)) {
                        this.fileSnapshotService.captureByPath(input.toolName, filePath);
                    }
                }
                // The hook's reason for existing is the snapshot above, not the verdict
                // below. When somebody else is answering permissions, saying `allow`
                // here answers on their behalf: a spike against the real CLI
                // (planning/spikes/acp-agent/spike-permission-hook.mjs) showed it then
                // emits no permission.requested event at all, so the handler is never
                // called. Withholding the decision — rather than changing it to 'ask',
                // which downgrades the request to the payload-free `hook` variant —
                // leaves the native shell/write request intact for them to answer.
                return this.permissionHandler ? {} : { permissionDecision: 'allow' };
            }
        };
    }

    /**
     * Answer permission requests with `handler` instead of approving them here.
     *
     * Exists for the ACP agent, which forwards them to its host over
     * `session/request_permission`. Left unset — the VS Code extension's path — the
     * manager keeps approving, because the extension has already gated the session
     * behind its own settings and would otherwise start prompting users who have
     * never been prompted.
     *
     * Must be called BEFORE `start()`: the handler is passed in the session config,
     * so a handler installed afterwards would apply to the next session and not this
     * one.
     */
    public setPermissionHandler(handler: (request: any, invocation: any) => any): void {
        this.permissionHandler = handler;
        this.logger.info('[Permissions] request handler installed; deferring decisions to it');
    }

    /**
     * Fetch the todo table and publish it.
     *
     * The read is best-effort in the SDK's own words — every column on a row is
     * optional, and the table may not exist at all — so a failure is logged and
     * dropped rather than propagated. Losing one plan update is a cosmetic problem;
     * an unhandled rejection out of the event pump is not.
     *
     * An empty list still fires: the agent clearing its plan is a real state a host
     * needs to render, and silence would leave the last plan on screen forever.
     */
    private async readTodos(): Promise<void> {
        const plan = this.session?.rpc?.plan;
        if (!plan?.readSqlTodosWithDependencies) {
            return;
        }
        try {
            const result = await plan.readSqlTodosWithDependencies();
            this._onDidUpdateTodos.fire({
                todos: result?.rows ?? [],
                dependencies: result?.dependencies ?? []
            });
        } catch (error) {
            this.logger.warn(`[Todos] could not read the todo table: ${(error as Error).message}`);
        }
    }

    /**
     * Announce that plan mode is on, naming the session that now holds it.
     *
     * A method rather than an inline `fire` so the payload is testable without a live
     * CLI — `enablePlanMode` creates a real SDK session, and the only part a consumer
     * depends on is this shape.
     *
     * The id matters more than it looks. P4 writes a pairing record **into the plan
     * session's directory**, so a consumer without this value would have to rebuild the
     * id from the `-plan` suffix, becoming a second place that knows the convention —
     * inside the change whose purpose is to reduce that count to one.
     */
    private announcePlanModeEnabled(planSessionId: string | undefined): void {
        this._onDidChangeStatus.fire({
            status: 'plan_mode_enabled',
            // Falling back to the derivation keeps the event well-formed if a future
            // caller loses the id, rather than publishing an announcement a consumer
            // cannot act on. It is the one place the suffix may still be spelled.
            planSessionId: planSessionId ?? `${this.workSessionId}-plan`
        });
    }

    private getCustomTools(): any[] {
        // Plan mode: return tools from PlanModeToolsService
        if (this.currentMode === 'plan') {
            if (!this.planModeToolsService) {
                this.logger.error('[Plan Mode] PlanModeToolsService not initialized!');
                return [];
            }
            return this.planModeToolsService.getTools();
        }
        
        // Work mode: no custom tools (for now)
        return [];
    }

    // Cache the skill directory scan — resolveSkillDirectories() walks
    // ~/.claude/plugins/cache synchronously and gets called on every
    // createSession/resumeSession. The set of installed skill directories
    // doesn't change during a session, so memoize per SDKSessionManager.
    private skillDirectoriesCache: string[] | null = null;

    private resolveSkillDirectories(): string[] {
        if (this.skillDirectoriesCache !== null) {
            return this.skillDirectoriesCache;
        }
        const additionalDirs = this.host.getConfig<string[]>('additionalSkillDirectories', []) ?? [];
        this.skillDirectoriesCache = resolveSkillDirectories(additionalDirs);

        // Skill resolution used to be entirely silent, which is why a wrong
        // directory list went unnoticed. Memoized, so this logs once per session.
        this.logger.info(`[Skills] Resolved ${this.skillDirectoriesCache.length} skill director${this.skillDirectoriesCache.length === 1 ? 'y' : 'ies'}`);
        for (const dir of this.skillDirectoriesCache) {
            this.logger.debug(`[Skills]   ${dir}`);
        }

        return this.skillDirectoriesCache;
    }
    
    private getEnabledMCPServers(): Record<string, any> {
        const userConfig = this.host.getConfig<Record<string, any>>('mcpServers', {}) ?? {};
        const managed = this.managedMCPRegistry.getManagedServers();
        const imported = (this.host.getConfig<boolean>('importVSCodeMcpServers', true) ?? true)
            ? getImportedServers(this.workingDirectory, this.host.getGlobalStorageDir())
            : {};
        return this.mcpConfigurationService.getMergedMCPServers(userConfig, managed, imported);
    }

    public async sendMessage(message: string, attachments?: Array<{type: 'file'; path: string; displayName?: string}>, isRetry: boolean = false, skipEnhancement: boolean = false, agentName?: string): Promise<void> {
        if (!this.session) {
            throw new Error('Session not initialized. Call start() first.');
        }

        this.logger.info(`[sendMessage] mode=${this.currentMode} sessionId=${this.sessionId?.substring(0, 8)} isRetry=${isRetry}`);
        this.logger.info(`Sending message: ${message.substring(0, 100)}...`);
        if (attachments && attachments.length > 0) {
            this.logger.info(`[Attachments] Sending ${attachments.length} attachment(s):`);
            attachments.forEach((att, idx) => {
                this.logger.info(`[Attachments]   ${idx + 1}. ${att.displayName || path.basename(att.path)} (${att.path})`);
            });
            
            // Validate attachments before sending
            const validation = await this.validateAttachments(attachments.map(a => a.path));
            if (!validation.valid) {
                const errorMsg = validation.error || 'Attachment validation failed';
                this.logger.error(`[Attachments] Validation failed: ${errorMsg}`);
                
                // Fire error event to UI
                this._onDidReceiveError.fire(errorMsg);
                
                throw new Error(errorMsg);
            }
        }
        
        // Enhance message with active file context and process @file references
        const enhancedMessage = skipEnhancement ? message : await this.messageEnhancementService.enhanceMessageWithContext(message);
        
        this.logger.info(`[SDK Call] About to call session.sendAndWait with prompt (first 200 chars): ${enhancedMessage.substring(0, 200)}`);
        
        try {
            // Send message with or without attachments
            const sendOptions: any = { prompt: enhancedMessage };
            if (attachments && attachments.length > 0) {
                sendOptions.attachments = attachments;
            }

            // Select agent for this message if specified (per-message override).
            // One-shot @mention: only select/deselect when the mention differs from the sticky session agent.
            // Sticky agent (set via /agent) is already selected at the SDK level; don't re-select or deselect it per-message.
            const isOneShot = !!agentName && agentName !== this._sessionAgent;
            if (isOneShot) {
                try {
                    await this.session.rpc.agent.select({ name: agentName });
                    this.logger.info(`[Agent] One-shot agent selected: ${agentName}`);
                } catch (e) {
                    this.logger.debug(`[Agent] Failed to select one-shot agent "${agentName}": ${e instanceof Error ? e.message : String(e)}`);
                }
            }

            try {
                await this.session.sendAndWait(sendOptions);
                this.logger.info('Message sent and completed successfully');
            } finally {
                // Restore previous state after one-shot: re-select sticky if one was active, otherwise deselect
                if (isOneShot) {
                    try {
                        if (this._sessionAgent) {
                            await this.session.rpc.agent.select({ name: this._sessionAgent });
                        } else {
                            await this.session.rpc.agent.deselect();
                        }
                    } catch { /* ignore restore errors */ }
                }
            }

            // Clean up temp files (pasted images) after SDK has consumed them
            if (attachments && attachments.length > 0) {
                for (const att of attachments) {
                    if (path.basename(path.dirname(att.path)).startsWith('copilot-paste-')) {
                        try {
                            fs.unlinkSync(att.path);
                            fs.rmdirSync(path.dirname(att.path));
                            this.logger.debug(`[Attachments] Cleaned up temp file: ${att.path}`);
                        } catch { /* ignore cleanup errors */ }
                    }
                }
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            // Check if this is a session.idle timeout error
            if (errorMessage.includes('Timeout') && errorMessage.includes('session.idle')) {
                // This is expected for long-running commands - just log it
                this.logger.info(`Session idle timeout (command likely completed): ${errorMessage}`);
                return; // Don't throw or emit error
            }
            
            // Check for session not found / expired / connection dead errors
            if (errorMessage.includes('does not exist') ||
                errorMessage.includes('Session not found') ||
                errorMessage.includes('session has been deleted') ||
                errorMessage.includes('session is invalid') ||
                errorMessage.toLowerCase().includes('connection is closed') ||
                errorMessage.toLowerCase().includes('connection is disposed')) {
                
                this.logger.warn('Session appears to have timed out or expired during message sending');
                
                // Get the session ID that failed
                const failedSessionId = this.sessionId;
                
                if (!failedSessionId) {
                    this.logger.error('No session ID available to resume');
                    throw error;
                }
                
                // Preserve current mode before attempting recovery
                const wasPlanMode = this.currentMode === 'plan';
                
                // Destroy the stale session object
                if (this.session) {
                    try {
                        await this.session.disconnect();
                    } catch (e) {
                        // Ignore errors destroying expired session
                        this.logger.debug('Error destroying expired session (expected)');
                    }
                    this.session = null;
                }
                
                // Attempt to resume with retry logic and user recovery dialog
                try {
                    const mcpServers = this.getEnabledMCPServers();
                    const hasMcpServers = Object.keys(mcpServers).length > 0;
                    
                    const resumeOptions = {
                        tools: this.getCustomTools(),
                        hooks: this.getSessionHooks(),
                        ...(wasPlanMode ? {
                            availableTools: [...PLAN_MODE_AVAILABLE_TOOLS]
                        } : {}),
                        ...(hasMcpServers ? { mcpServers } : {}),
                        customAgents: this.customAgentsService.toSDKAgents(),
                    };
                    
                    // If connection was lost, recreate client before attempting resume
                    const sendErrorType = classifySessionError(error instanceof Error ? error : new Error(errorMessage));
                    if (sendErrorType === 'connection_closed') {
                        this.logger.info('[Timeout Recovery] Connection closed — recreating client before resume...');
                        await this.recreateClient();
                    }

                    this.logger.info(`[Timeout Recovery] Attempting to resume timed-out session ${failedSessionId.substring(0, 8)}...`);
                    this.session = await this.attemptSessionResumeWithUserRecovery(
                        failedSessionId,
                        resumeOptions
                    );
                    
                    // Successfully resumed!
                    this.logger.info(`[Timeout Recovery] ✅ Session resumed successfully`);
                    
                    // Restore session tracking
                    if (wasPlanMode) {
                        this.planSession = this.session;
                        this.sessionId = failedSessionId;
                        this.currentMode = 'plan';
                    } else {
                        this.workSession = this.session;
                        this.sessionId = this.session.sessionId;
                        this.workSessionId = this.sessionId;
                        this.currentMode = 'work';
                    }
                    
                    // Re-setup event handlers for resumed session
                    this.setupSessionEventHandlers();
                    
                    // Retry the original message send
                    this.logger.info('[Timeout Recovery] Retrying original message send...');
                    await this.sendMessage(message, attachments, true); // isRetry=true to avoid infinite loop
                    this.logger.info('[Timeout Recovery] Message sent successfully after resume');
                    return; // Success!
                    
                } catch (resumeError) {
                    // Resume failed (even after retries and user dialog)
                    // Fall through to create new session below
                    const resumeErrorMsg = resumeError instanceof Error ? resumeError.message : String(resumeError);
                    this.logger.warn('[Timeout Recovery] Resume failed, creating new session: ' + resumeErrorMsg);
                }
                
                // If we get here, resume failed - recreate client and create new session
                await this.recreateClient();
                const mcpServers = this.getEnabledMCPServers();
                const hasMcpServers = Object.keys(mcpServers).length > 0;
                
                if (wasPlanMode) {
                    // Recreate plan session with restricted tools
                    this.logger.info('Recreating plan mode session...');
                    const planSessionId = `${this.workSessionId}-plan`;
                    
                    this.session = await this.createSessionWithModelFallback({
                        sessionId: planSessionId,
                        model: this.config.planModel || this.config.model || undefined,
                        tools: this.getCustomTools(),
                        hooks: this.getSessionHooks(),
                        availableTools: [...PLAN_MODE_AVAILABLE_TOOLS],
                        ...(hasMcpServers ? { mcpServers } : {}),
                        customAgents: this.customAgentsService.toSDKAgents(),
                    });
                    this.planSession = this.session;
                    this.sessionId = planSessionId;
                    // currentMode stays 'plan'
                } else {
                    // Recreate work session with full tools
                    this.logger.info('Recreating work mode session...');
                    
                    this.session = await this.createSessionWithModelFallback({
                        model: this.config.model || undefined,
                        tools: this.getCustomTools(),
                        hooks: this.getSessionHooks(),
                        ...(hasMcpServers ? { mcpServers } : {}),
                        customAgents: this.customAgentsService.toSDKAgents(),
                    });
                    this.sessionId = this.session.sessionId;

                    // Update work session tracking
                    this.workSession = this.session;
                    this.workSessionId = this.sessionId;
                    this.currentMode = 'work';
                }
                
                // Re-setup event handlers for new session
                this.setActiveSession(this.session);
                
                // Fetch model capabilities for new session
                await this.updateModelCapabilities();
                
                this.logger.info(`Session recreated: ${this.sessionId}`);
                
                // Notify UI about new session
                this._onDidChangeStatus.fire({ status: 'session_expired', newSessionId: this.sessionId || undefined });
                
                // Retry the message once (use flag to prevent infinite loop)
                if (!isRetry) {
                    return this.sendMessage(message, attachments, true);
                } else {
                    throw new Error('Session recreation failed on retry');
                }
            }
            
            // For other errors, log and emit
            this.logger.error('Failed to send message', error instanceof Error ? error : undefined);
            
            // Fire error event to UI
            this._onDidReceiveError.fire(errorMessage);
            
            throw error;
        }
    }

    /**
     * Enhances the user message with active file context and processes @file references
     */

/**
     * Persistently select a named agent for this session (sticky).
     * All subsequent messages will use this agent until deselectAgent() is called.
     * If no session is active yet, the agent will be applied when the session starts (via stop/start or resume).
     */
    public async selectAgent(name: string): Promise<void> {
        this._sessionAgent = name;
        if (!this.session) { return; }
        try {
            await this.session.rpc.agent.select({ name });
            this.logger.info(`[Agent] Session agent selected: ${name} sessionId=${this.sessionId?.substring(0, 8)}`);
        } catch (e) {
            this.logger.debug(`[Agent] Failed to select session agent "${name}": ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    /**
     * True when a session is created and the SDK RPC channel is ready.
     */
    public hasActiveSession(): boolean {
        return !!this.session;
    }

    /**
     * Live MCP server list from the SDK (CLI ≥ 1.0.36).
     * Throws if session is not active or if the CLI doesn't implement the RPC.
     */
    public async listMcpServers(): Promise<any[]> {
        if (!this.session) {
            throw new Error('No active session');
        }
        const result = await this.session.rpc.mcp.list();
        return result?.servers ?? result ?? [];
    }

    /**
     * Fork a session, preferring the SDK's `sessions.fork` RPC over the
     * filesystem copy in `SessionService`.
     *
     * Naming: the fork must get a label distinct from its parent — that is the
     * user-visible point. The spike proved passing `name` to the RPC is
     * necessary but NOT sufficient: the CLI persists it to the fork's
     * workspace.yaml as `name:`, but `formatSessionLabel` reads
     * `session-name.txt` first and workspace.yaml's `summary` (not `name`)
     * third, so a purely-RPC fork still renders as its id prefix. Both paths
     * therefore write `session-name.txt` with the same computed string.
     *
     * Failure policy: `sessions.fork` is `@experimental`. Fall back only when
     * the method is genuinely unavailable — absent, or rejected with JSON-RPC
     * method-not-found. Any other failure propagates, because running a
     * filesystem copy after a legitimate error would produce a WRONG RESULT
     * rather than an error.
     */
    public async forkSession(
        sourceSessionId: string,
        opts?: { sessionStateDir?: string }
    ): Promise<string> {
        const sessionStateDir = opts?.sessionStateDir
            ?? path.join(os.homedir(), '.copilot', 'session-state');
        const parentLabel = SessionService.formatSessionLabel(
            sourceSessionId,
            path.join(sessionStateDir, sourceSessionId)
        );
        // formatSessionLabel truncates every branch to LABEL_MAX. Appending the
        // suffix to an already-maxed label would push it back over the cap and
        // the suffix would be truncated away — leaving the fork rendering
        // identically to its parent, which is the bug this is meant to fix.
        const suffix = ' (fork)';
        const name = parentLabel.slice(0, LABEL_MAX - suffix.length).trimEnd() + suffix;

        // The SDK type declares `fork` unconditionally, but the running CLI may
        // predate it. Partial<> models exactly that gap while keeping full
        // parameter and return typing — no cast, no `any`.
        const sessionsRpc: Partial<CopilotClientApi['rpc']['sessions']> | undefined =
            this.client?.rpc?.sessions;

        if (typeof sessionsRpc?.fork === 'function') {
            try {
                const result = await sessionsRpc.fork({ sessionId: sourceSessionId, name });
                this.logger.info(`[Fork] sessions.fork -> ${result.sessionId} ("${name}")`);
                // Don't depend on the CLI having created the directory first: a lost
                // write here silently reinstates the inherited-name bug.
                const forkDir = path.join(sessionStateDir, result.sessionId);
                fs.mkdirSync(forkDir, { recursive: true });
                SessionService.writeSessionName(forkDir, name);
                return result.sessionId;
            } catch (error) {
                if (!isMethodNotFound(error)) {
                    throw error;
                }
                this.logger.warn('[Fork] CLI does not implement sessions.fork; using filesystem copy');
            }
        }

        const newId = SessionService.forkSession(sourceSessionId, sessionStateDir);
        SessionService.writeSessionName(path.join(sessionStateDir, newId), name);
        this.logger.info(`[Fork] filesystem copy -> ${newId} ("${name}")`);
        return newId;
    }

    /**
     * List MCP servers from the Copilot CLI's own user configuration via the
     * `mcp.config.list` RPC. Read-only — the extension never writes to Copilot's
     * config. Returns a record keyed by server name.
     */
    public async listConfiguredMcpServers(): Promise<Record<string, any>> {
        // `mcp.config.*` lives on the client (server) RPC, not the session RPC.
        const configRpc = (this.client as any)?.rpc?.mcp?.config;
        if (typeof configRpc?.list !== 'function') {
            return {}; // SDK/CLI doesn't expose mcp.config — skip the Copilot section.
        }
        const result = await configRpc.list();
        return result?.servers ?? {};
    }

    /**
     * Clear the sticky session agent, returning to auto-inference.
     */
    public async deselectAgent(): Promise<void> {
        this._sessionAgent = null;
        if (!this.session) { return; }
        try {
            await this.session.rpc.agent.deselect();
            this.logger.info(`[Agent] Session agent cleared sessionId=${this.sessionId?.substring(0, 8)}`);
        } catch (e) {
            this.logger.debug(`[Agent] Failed to deselect session agent: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    /**
     * After session (re)creation, restore the sticky agent the host reports, if any.
     * This ensures agent selection survives session reconnects.
     */
    private async _restoreStickyAgentIfNeeded(): Promise<void> {
        const activeAgent = this.host.getActiveAgent?.() ?? null;
        if (activeAgent && activeAgent !== this._sessionAgent) {
            this.logger.info(`[Agent] Restoring sticky agent "${activeAgent}" after session (re)creation`);
            await this.selectAgent(activeAgent);
        }
    }

    /**
     * Abort the current session and resume it with a fresh customAgents snapshot.
     * Used when the CustomAgentsPanel closes after a mutation so changes take effect
     * without requiring a full window reload.
     *
     * No-op when: no active session, or currently in plan mode.
     */
    public async reloadAgents(): Promise<void> {
        if (!this.session || !this.sessionId) {
            this.logger.info('[Agent Reload] No active session, skipping reload');
            return;
        }
        if (this.currentMode === 'plan') {
            this.logger.warn('[Agent Reload] In plan mode — skipping. Changes take effect when plan mode exits.');
            return;
        }
        const sessionId = this.sessionId;
        this.logger.info('[Agent Reload] Reloading agents: destroy + resume');
        this._onDidChangeStatus.fire({ status: 'thinking' } as any);
        try {
            await this.session.disconnect();
            this.session = null;
            this._sessionAgent = null;
            const mcpServers = this.getEnabledMCPServers();
            const hasMcpServers = Object.keys(mcpServers).length > 0;
            this.session = await this.attemptSessionResumeWithUserRecovery(sessionId, {
                model: this.config.model || undefined,
                tools: this.getCustomTools(),
                hooks: this.getSessionHooks(),
                ...(hasMcpServers ? { mcpServers } : {}),
                customAgents: this.customAgentsService.toSDKAgents(),
            });
            this.sessionId = this.session.sessionId;
            this.workSession = this.session;
            this.workSessionId = this.sessionId;
            await this._restoreStickyAgentIfNeeded();
            this.setupSessionEventHandlers();
            this.logger.info('[Agent Reload] ✅ Session resumed with updated agents');
            this._onDidChangeStatus.fire({ status: 'ready' } as any);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.error('[Agent Reload] Failed: ' + msg);
            this._onDidChangeStatus.fire({ status: 'error' } as any);
        }
    }

    public async abortMessage(): Promise<void> {
        if (!this.session) {
            throw new Error('Session not initialized. Call start() first.');
        }

        this.logger.info('Aborting current message...');
        
        try {
            await this.session.abort();
            this.logger.info('Message aborted successfully');
            
            // Fire status event to UI
            this._onDidChangeStatus.fire({ status: 'aborted' });
        } catch (error) {
            this.logger.error('Failed to abort message', error instanceof Error ? error : undefined);
            throw error;
        }
    }

    public isRunning(): boolean {
        return this.session !== null;
    }

    /**
     * Stop the dead client and create a fresh one with current config.
     * Called before any createSession/resumeSession after a connection loss.
     */
    private async recreateClient(): Promise<void> {
        // Clear BEFORE adopting, not after: initialising against the outgoing client
        // and then swapping would leave the service describing a client nobody uses.
        this.modelCapabilitiesService.clearCache();
        await this.adoptClient(await this.clientProvider.recreate());
    }

    /** Take the provider's current client. */
    private async acquireClient(): Promise<void> {
        await this.adoptClient(await this.clientProvider.get());
    }

    /**
     * Adopt `client` and initialise everything that is scoped to it.
     *
     * The capabilities service is initialised HERE, by the manager that owns it,
     * rather than by the provider's `onClientStarted` hook. Two reasons, and the
     * second is why the hook is gone rather than merely duplicated:
     *
     * 1. **A provider can be shared.** Spine S4 runs N managers against one provider
     *    so N sessions share one CLI process. `onClientStarted` fires once per client;
     *    each manager has its own capabilities service. One callback cannot initialise
     *    all of them.
     * 2. **A provider can be injected by someone who never wired the hook.** That was
     *    not hypothetical: the ACP agent injected a provider without it, and the
     *    service went uninitialised in the whole agent process — degrading model
     *    fallback, vision support and attachment validation, silently, until a live
     *    run in Zed logged it.
     *
     * Owning it here means it cannot be forgotten by a caller who does not know it
     * needs doing.
     */
    private async adoptClient(client: any): Promise<void> {
        this.client = client;
        await this.modelCapabilitiesService.initialize(client);
    }

    /**
     * Switch the model mid-session. Destroys current session and resumes
     * with the new model, preserving conversation context.
     */
    public async switchModel(newModel: string): Promise<void> {
        if (newModel === this.config.model) {
            return; // No-op if same model
        }

        const previousModel = this.config.model;
        this.logger.info(`[Model Switch] Switching from "${previousModel}" to "${newModel}"`);

        try {
            const result = await this.session.rpc.model.switchTo({ modelId: newModel });
            this.config.model = newModel;
            this.logger.info(`[Model Switch] Successfully switched to "${result.modelId}"`);
            // Note: model_switched status is fired by the session.model_change event handler
        } catch (error) {
            this.logger.error(`[Model Switch] Failed to switch to "${newModel}": ${error instanceof Error ? error.message : error}`);
            this._onDidChangeStatus.fire({ status: 'model_switch_failed', model: previousModel });
        }
    }

    /**
     * Get the current model ID.
     */
    public getCurrentModel(): string | undefined {
        return this.config.model;
    }

    /**
     * Manually trigger context compaction via rpc.compaction.compact().
     * Returns token/message counts freed, or null if no session is active.
     */
    public async compactSession(): Promise<{ tokensRemoved?: number; messagesRemoved?: number } | null> {
        if (!this.session) {
            this.logger.warn('[Compact] No active session');
            return null;
        }
        try {
            this.logger.info('[Compact] Requesting context compaction...');
            const result = await this.session.rpc.compaction.compact();
            this.logger.info(`[Compact] Compaction complete: ${JSON.stringify(result)}`);
            return result ?? null;
        } catch (error) {
            this.logger.error(`[Compact] Compaction failed: ${error instanceof Error ? error.message : error}`);
            throw error;
        }
    }

    public async stop(): Promise<void> {
        this.logger.info('Stopping SDK session manager...');
        
        // MutableDisposable will handle cleanup automatically
        this._sessionSub.value = undefined;
        
        // Plan mode is a TWO-session design: `this.session` is the plan session
        // while in plan mode (enablePlanMode ends with setActiveSession(planSession)),
        // and the work session is parked on `this.workSession`. Disconnecting only
        // `this.session` therefore stranded the work session — it was assigned in six
        // places and released in none. Every teardown path reaches here
        // (handleSwitchSession, handleNewSession, handleStopChat, deactivate), so the
        // leak was one plan-mode session switch away at all times.
        //
        // Deduplicated by identity because in work mode these references are the same
        // object, and disconnecting twice makes the SDK throw on the second call.
        const live = [this.session, this.workSession, this.planSession]
            .filter((s): s is NonNullable<typeof s> => !!s);
        const seen = new Set<unknown>();
        for (const session of live) {
            if (seen.has(session)) {
                continue;
            }
            seen.add(session);
            try {
                await session.disconnect();
            } catch (error) {
                // Keep going: one bad connection must not strand the others.
                this.logger.error('Error destroying session', error instanceof Error ? error : undefined);
            }
        }
        this.session = null;
        this.workSession = null;
        this.planSession = null;
        this._sessionAgent = null;

        // Only tear down a client we own. A shared provider outlives any one
        // manager — stopping it here would kill every other session's CLI.
        this.client = null;
        if (this.ownsClientProvider) {
            await this.clientProvider.stop();
        }

        this.sessionId = null;
        this.toolExecutions.clear();
        
        // Cleanup all file snapshots via service
        this.fileSnapshotService.cleanupAllSnapshots();

        this._onDidChangeStatus.fire({ status: 'stopped' });
    }

    public async restart(): Promise<void> {
        await this.stop();
        await this.start();
    }

    public getSessionId(): string | null {
        return this.sessionId;
    }

    public getCurrentMode(): SessionMode {
        return this.currentMode;
    }
    
    /**
     * Enable plan mode: Create a plan session that can only update the work plan
     * The plan session has ONE tool: update_work_plan
     * All other tools are disabled (read-only mode)
     */
    public async enablePlanMode(): Promise<void> {
        this.logger.info('═══════════════════════════════════════════════════════════');
        this.logger.info('🎯 PLAN MODE SETUP - START');
        this.logger.info('═══════════════════════════════════════════════════════════');
        
        if (this.currentMode === 'plan') {
            this.logger.warn('[Plan Mode] Already in plan mode - aborting');
            return;
        }
        
        if (!this.client) {
            this.logger.error('[Plan Mode] Client not initialized');
            throw new Error('Client not initialized. Call start() first.');
        }
        
        this.logger.info(`[Plan Mode] Step 1/7: Validate preconditions`);
        this.logger.info(`[Plan Mode]   Current mode: ${this.currentMode}`);
        this.logger.info(`[Plan Mode]   Work session ID: ${this.sessionId}`);
        this.logger.info(`[Plan Mode]   Client initialized: ${!!this.client}`);
        
        // Snapshot current plan.md before entering plan mode
        this.logger.info(`[Plan Mode] Step 2/7: Snapshot existing plan.md`);
        try {
            const homeDir = require('os').homedir();
            const workSessionPath = path.join(homeDir, '.copilot', 'session-state', this.sessionId!);
            const planPath = path.join(workSessionPath, 'plan.md');
            
            this.logger.info(`[Plan Mode]   Work session path: ${workSessionPath}`);
            this.logger.info(`[Plan Mode]   Plan path: ${planPath}`);
            this.logger.info(`[Plan Mode]   Session directory exists: ${fs.existsSync(workSessionPath)}`);
            this.logger.info(`[Plan Mode]   Plan.md exists: ${fs.existsSync(planPath)}`);
            
            if (fs.existsSync(planPath)) {
                this.planModeSnapshot = await fs.promises.readFile(planPath, 'utf-8');
                this.logger.info(`[Plan Mode]   ✅ Snapshotted plan.md (${this.planModeSnapshot.length} bytes)`);
            } else {
                this.planModeSnapshot = null;
                this.logger.info(`[Plan Mode]   ℹ️  No existing plan.md to snapshot`);
            }
        } catch (error) {
            this.logger.error('[Plan Mode]   ❌ Failed to snapshot plan.md', error instanceof Error ? error : undefined);
            this.planModeSnapshot = null;
        }
        
        // Store reference to work session
        this.logger.info(`[Plan Mode] Step 3/7: Store work session reference`);
        this.workSession = this.session;
        this.workSessionId = this.sessionId;
        this.logger.info(`[Plan Mode]   Work session stored: ${this.workSessionId}`);
        this.logger.info(`[Plan Mode]   Work session object: ${!!this.workSession}`);
        
        // Create plan session with predictable name
        const planSessionId = `${this.workSessionId}-plan`;
        this.logger.info(`[Plan Mode] Step 4/7: Prepare plan session`);
        this.logger.info(`[Plan Mode]   Plan session ID: ${planSessionId}`);
        
        // Switch to plan mode before getting tools (so getCustomTools returns plan tools)
        this.logger.info(`[Plan Mode] Step 5/7: Initialize PlanModeToolsService and switch mode`);
        const previousMode = this.currentMode;
        
        // Create plan mode tools service
        this.planModeToolsService = new PlanModeToolsService(
            this.workSessionId!,
            this.workingDirectory,
            this._onDidChangeStatus,
            this.fileSnapshotService,
            this.getDiffEmitCallback(),
            this.logger
        );
        await this.planModeToolsService.initialize();
        this.logger.info(`[Plan Mode]   ✅ PlanModeToolsService initialized`);
        
        this.currentMode = 'plan';
        this.logger.info(`[Plan Mode]   Mode changed: ${previousMode} → ${this.currentMode}`);
        
        try {
            this.logger.info(`[Plan Mode] Step 6/7: Configure tools and session`);
            
            const mcpServers = this.getEnabledMCPServers();
            const hasMcpServers = Object.keys(mcpServers).length > 0;
            this.logger.info(`[Plan Mode]   MCP servers: ${hasMcpServers ? Object.keys(mcpServers).join(', ') : 'none'}`);
            
            const customTools = this.getCustomTools();
            
            this.logger.info(`[Plan Mode]   ─────────────────────────────────────────────`);
            this.logger.info(`[Plan Mode]   CUSTOM TOOLS (${customTools.length}) - with unique names:`);
            customTools.forEach(tool => {
                this.logger.info(`[Plan Mode]     ✓ ${tool.name} (restricted)`);
            });
            this.logger.info(`[Plan Mode]   ─────────────────────────────────────────────`);
            this.logger.info(`[Plan Mode]   SDK TOOLS: view, grep, glob, web_fetch`);
            this.logger.info(`[Plan Mode]   Note: Only whitelisted tools are available via availableTools`);
            this.logger.info(`[Plan Mode]   ─────────────────────────────────────────────`);
            this.logger.info(`[Plan Mode]   Model: ${this.config.model || 'default'}`);
            this.logger.info(`[Plan Mode]   MCP Servers: ${hasMcpServers ? Object.keys(mcpServers).join(', ') : 'none'}`);
            
            this.logger.info(`[Plan Mode]   ─────────────────────────────────────────────`);
            this.logger.info(`[Plan Mode]   Creating session with configuration:`);
            this.logger.info(`[Plan Mode]     sessionId: ${planSessionId}`);
            this.logger.info(`[Plan Mode]     model: ${this.config.model || 'default'}`);
            this.logger.info(`[Plan Mode]     tools: [${customTools.map(t => t.name).join(', ')}] (custom)`);
            this.logger.info(`[Plan Mode]     availableTools: [${this.planModeToolsService.getAvailableToolNames().join(', ')}]`);
            this.logger.info(`[Plan Mode]     mcpServers: ${hasMcpServers ? 'enabled' : 'disabled'}`);
            this.logger.info(`[Plan Mode]     systemMessage: mode=append (plan mode instructions)`);
            this.logger.info(`[Plan Mode]   ─────────────────────────────────────────────`);
            
            const planSessionConfig = {
                model: this.config.planModel || this.config.model || undefined,
                tools: customTools,
                hooks: this.getSessionHooks(),
                availableTools: this.planModeToolsService.getAvailableToolNames(),
                systemMessage: {
                    mode: 'append' as const,
                    content: this.planModeToolsService.getSystemPrompt(this.workSessionId!)
                },
                ...(hasMcpServers ? { mcpServers } : {}),
                customAgents: this.customAgentsService.toSDKAgents(),
            };

            // Resume when this plan session already has a conversation. Passing an
            // existing id to createSession does NOT continue it — the runtime
            // appends a second session.start and the model comes back with no
            // memory of the planning discussion. resumeSession restores it, and
            // still enforces availableTools, so the plan-mode tool restriction
            // holds either way. Both verified: planning/spikes/plan-session-reuse/.
            const planStateDir = path.join(os.homedir(), '.copilot', 'session-state');
            if (SessionService.hasSessionHistory(planStateDir, planSessionId)) {
                this.logger.info(`[Plan Mode]   Existing plan session found — resuming to keep its history`);
                this.planSession = await this.attemptSessionResumeWithUserRecovery(
                    planSessionId,
                    planSessionConfig
                );
                this.logger.info(`[Plan Mode]   ✅ Plan session resumed successfully`);
            } else {
                this.logger.info(`[Plan Mode]   No existing plan session — creating a new one`);
                this.planSession = await this.createSessionWithModelFallback({
                    sessionId: planSessionId,
                    ...planSessionConfig,
                });
                this.logger.info(`[Plan Mode]   ✅ Plan session created successfully`);
            }

            // Mirror the work session's readable name to the plan session so the dropdown
            // never shows a raw GUID when switching into plan mode.
            try {
                const homeDir = os.homedir();
                const workNamePath = path.join(homeDir, '.copilot', 'session-state', this.workSessionId!, 'session-name.txt');
                const planSessionPath = path.join(homeDir, '.copilot', 'session-state', planSessionId);
                const planNamePath = path.join(planSessionPath, 'session-name.txt');
                if (fs.existsSync(workNamePath) && !fs.existsSync(planNamePath)) {
                    const workName = fs.readFileSync(workNamePath, 'utf-8').trim();
                    if (workName) {
                        fs.writeFileSync(planNamePath, `Plan: ${workName}`, 'utf-8');
                        this.logger.info(`[Plan Mode]   Wrote plan session name: "Plan: ${workName}"`);
                    }
                }
            } catch (nameErr) {
                if (nameErr instanceof Error) {
                    this.logger.warn('[Plan Mode]   Could not mirror session name', nameErr);
                } else {
                    this.logger.warn(`[Plan Mode]   Could not mirror session name: ${String(nameErr)}`);
                }
            }

            this.logger.info(`[Plan Mode] Step 7/7: Activate plan session`);
            this.sessionId = planSessionId;
            this.currentMode = 'plan';
            this.logger.info(`[Plan Mode]   Active session changed to: ${this.sessionId}`);
            
            // Setup event listeners for plan session
            this.logger.info(`[Plan Mode]   Setting up event handlers for plan session`);
            this.setActiveSession(this.planSession);
            this.logger.info(`[Plan Mode]   ✅ Event handlers configured`);
            
            // Notify UI
            this.logger.info(`[Plan Mode]   Emitting plan_mode_enabled status event`);
            this.announcePlanModeEnabled(planSessionId);
            this.logger.info(`[Plan Mode]   ✅ Status event emitted`);
            
            // Send visual message to chat
            this.logger.info(`[Plan Mode]   Sending visual message to chat`);
            this._onDidReceiveOutput.fire({ content:
                `🎯 **Entered Plan Mode**\n\n` +
                `You can now analyze the codebase and design solutions without modifying files.\n\n` +
                `**To create/update your plan:**\n` +
                `- Ask me to research and create a plan\n` +
                `- I'll use \`update_work_plan\` to save it to your session workspace\n` +
                `- The plan will be available when you return to work mode\n\n` +
                `**Available tools:**\n` +
                `- \`update_work_plan\` - Save/update your implementation plan (recommended)\n` +
                `- \`edit\` (restricted) - Edit plan.md only\n` +
                `- \`create\` (restricted) - Create plan.md only\n` +
                `- \`view\`, \`grep\`, \`glob\` - Read and search files\n` +
                `- \`bash\` (read-only) - Run safe commands like \`ls\`, \`pwd\`, \`git status\`\n` +
                `- \`task(agent_type="explore")\` - Dispatch exploration tasks\n` +
                `- \`web_fetch\` - Fetch documentation\n\n` +
                `Use **Accept** when ready to implement, or **Reject** to discard changes.`,
                messageId: '' });
            
            this.logger.info('═══════════════════════════════════════════════════════════');
            this.logger.info('✅ PLAN MODE SETUP - COMPLETE');
            this.logger.info(`   Work session: ${this.workSessionId}`);
            this.logger.info(`   Plan session: ${planSessionId}`);
            this.logger.info(`   Active mode: ${this.currentMode}`);
            this.logger.info('═══════════════════════════════════════════════════════════');
            
        } catch (error) {
            // If creation failed, revert to work mode
            this.logger.error('═══════════════════════════════════════════════════════════');
            this.logger.error('❌ PLAN MODE SETUP - FAILED');
            this.logger.error('═══════════════════════════════════════════════════════════');
            this.logger.error('[Plan Mode] Error during setup:', error instanceof Error ? error : undefined);
            this.logger.error('[Plan Mode] Reverting to work mode...');
            
            this.currentMode = 'work';
            this.session = this.workSession;
            this.sessionId = this.workSessionId;
            
            this.logger.error(`[Plan Mode] Reverted to work mode (session: ${this.workSessionId})`);
            this.logger.error('═══════════════════════════════════════════════════════════');
            throw error;
        }
    }
    
    /**
     * Disable plan mode: Resume the work session
     * The plan session is destroyed (or kept for reference)
     */
    public async disablePlanMode(): Promise<void> {
        if (this.currentMode !== 'plan') {
            this.logger.warn('Not in plan mode');
            return;
        }
        
        this.logger.info('Disabling plan mode...');
        
        // Cleanup plan mode tools service
        if (this.planModeToolsService) {
            this.planModeToolsService.dispose();
            this.planModeToolsService = null;
            this.logger.info('PlanModeToolsService disposed');
        }
        
        // Destroy plan session (could keep it for reference if desired)
        if (this.planSession) {
            try {
                await this.planSession.disconnect();
                this.logger.info('Plan session destroyed');
            } catch (error) {
                this.logger.error('Error destroying plan session', error instanceof Error ? error : undefined);
            }
            this.planSession = null;
        }
        
        // Resume work session
        this.sessionId = this.workSessionId;
        this.currentMode = 'work';

        this.logger.info(`✅ Plan mode disabled! Resumed work session: ${this.sessionId}`);

        // Verify work session is still alive (CLI server may have GC'd it during planning)
        // Uses abort() as lightweight check — NOT resumeSession() which causes
        // server-side event doubling on already-active sessions
        let verifiedSession = this.workSession;
        try {
            const mcpServers = this.getEnabledMCPServers();
            const hasMcpServers = Object.keys(mcpServers).length > 0;

            if (!this.workSession) {
                // Started cold straight into plan mode, so no work session was ever
                // resumed — startup deferred it here on purpose. This is the moment
                // it is actually needed.
                //
                // Created under the derived id rather than a fresh UUID: that keeps
                // the `<work>-plan` pairing, so the next entry into plan mode finds
                // this same plan session instead of orphaning it, and it keeps
                // plan.md — which already lives in that directory — attached to its
                // session. Safe because the id has no transcript to overwrite, which
                // is the whole reason there was nothing to resume.
                this.logger.info(`[Plan Mode] No work session in memory — creating one as ${this.workSessionId}`);
                verifiedSession = await this.createSessionWithModelFallback({
                    sessionId: this.workSessionId ?? undefined,
                    model: this.config.model || undefined,
                    tools: this.getCustomTools(),
                    hooks: this.getSessionHooks(),
                    ...(hasMcpServers ? { mcpServers } : {}),
                    customAgents: this.customAgentsService.toSDKAgents(),
                });
                this.sessionId = verifiedSession.sessionId;
                this.workSessionId = verifiedSession.sessionId;
                this.workSession = verifiedSession;
                this.logger.info(`[Plan Mode] Work session created: ${this.sessionId}`);
            } else {
            const result = await ensureSessionAlive(
                this.workSession,
                () => this.createSessionWithModelFallback({
                    model: this.config.model || undefined,
                    tools: this.getCustomTools(),
                    hooks: this.getSessionHooks(),
                    ...(hasMcpServers ? { mcpServers } : {}),
                    customAgents: this.customAgentsService.toSDKAgents(),
                }),
                this.logger
            );

            verifiedSession = result.session;
            if (result.wasRecreated) {
                this.sessionId = result.sessionId;
                this.workSessionId = result.sessionId;
                this.logger.info(`[Plan Mode] Work session recreated: ${this.sessionId}`);
            }
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            if (msg.toLowerCase().includes('connection') || msg.toLowerCase().includes('disposed')) {
                this.logger.error('[Plan Mode] Connection dead during health check, recreating session', error instanceof Error ? error : undefined);
                try {
                    const mcpServers = this.getEnabledMCPServers();
                    const hasMcpServers = Object.keys(mcpServers).length > 0;
                    const newSession = await this.createSessionWithModelFallback({
                        model: this.config.model || undefined,
                        tools: this.getCustomTools(),
                        hooks: this.getSessionHooks(),
                        ...(hasMcpServers ? { mcpServers } : {}),
                        customAgents: this.customAgentsService.toSDKAgents(),
                    });
                    verifiedSession = newSession;
                    this.sessionId = newSession.sessionId;
                    this.workSessionId = newSession.sessionId;
                    this.logger.info(`[Plan Mode] Work session recreated after connection failure: ${this.sessionId}`);
                } catch (recreateError) {
                    this.logger.error('[Plan Mode] Failed to recreate session', recreateError instanceof Error ? recreateError : undefined);
                }
            } else {
                this.logger.error('[Plan Mode] Failed to verify work session health', error instanceof Error ? error : undefined);
            }
        }

        // Update session state and subscribe to events — exactly once
        this.session = verifiedSession;
        this.workSession = verifiedSession;
        this.setActiveSession(verifiedSession);
        
        // Notify UI
        this.logger.info('[Plan Mode] Emitting plan_mode_disabled status event');
        this._onDidChangeStatus.fire({ status: 'plan_mode_disabled' });
        this.logger.info('[Plan Mode] plan_mode_disabled event emitted');
        
        // Send visual message to chat
        this._onDidReceiveOutput.fire({ content: '✅ **Exited Plan Mode**\n\nBack to work mode - ready to implement!', messageId: '' });
    }
    
    /**
     * Accept the plan: Keep plan.md changes and exit plan mode
     */
    public async acceptPlan(): Promise<void> {
        if (this.currentMode !== 'plan') {
            this.logger.warn('Not in plan mode - cannot accept plan');
            return;
        }
        
        this.logger.info('[Plan Mode] Accepting plan...');
        
        // Clear snapshot (we're keeping the changes)
        this.planModeSnapshot = null;
        
        // Calculate plan path before exiting plan mode
        const homeDir = require('os').homedir();
        const workSessionPath = path.join(homeDir, '.copilot', 'session-state', this.workSessionId!);
        const planPath = path.join(workSessionPath, 'plan.md');
        
        // Send visual message to chat BEFORE exiting plan mode
        this._onDidReceiveOutput.fire({ content: '✅ **Plan Accepted**\n\nPlan changes kept. Exiting plan mode...', messageId: '' });
        
        // Exit plan mode
        await this.disablePlanMode();
        
        // Notify UI with accept status
        this.logger.info('[Plan Mode] Emitting plan_accepted status event');
        this._onDidChangeStatus.fire({ status: 'plan_accepted' });
        this.logger.info('[Plan Mode] plan_accepted event emitted');
        
        // Extract plan heading for meaningful session label + kickoff message
        let planHeading: string | null = null;
        try {
            if (fs.existsSync(planPath)) {
                const planContent = fs.readFileSync(planPath, 'utf-8');
                planHeading = extractPlanHeading(planContent);
            }
        } catch {
            this.logger.warn('[Plan Mode] Could not read plan.md for heading extraction');
        }

        // Write heading as session name so dropdown shows intent, not garbled text
        if (planHeading) {
            try {
                const sessionPath = path.join(homeDir, '.copilot', 'session-state', this.sessionId!);
                SessionService.writeSessionName(sessionPath, planHeading);
                this.logger.info(`[Plan Mode] Wrote session name: ${planHeading}`);
            } catch {
                this.logger.warn('[Plan Mode] Could not write session-name.txt');
            }
        }

        // Auto-inject kickoff message — line 1 is the plan heading (becomes session label)
        const kickoffMessage = buildKickoffMessage(planHeading, planPath);
        this.logger.info('[Plan Mode] ✅ Plan accepted! Injecting implementation context...');
        // Fire-and-forget: message delivery is immediate via RPC. sendAndWait() only
        // blocks waiting for session.idle, which we don't need for a kickoff.
        this.sendMessage(kickoffMessage, undefined, false, true).catch(err => {
            this.logger.warn('[Plan Mode] Kickoff message error (non-fatal)',
                err instanceof Error ? err : undefined);
        });
    }
    
    /**
     * Reject the plan: Restore plan.md from snapshot and exit plan mode
     */
    public async rejectPlan(): Promise<void> {
        if (this.currentMode !== 'plan') {
            this.logger.warn('Not in plan mode - cannot reject plan');
            return;
        }
        
        this.logger.info('[Plan Mode] Rejecting plan...');
        
        // Restore plan.md from snapshot if it exists
        if (this.planModeSnapshot !== null) {
            try {
                const homeDir = require('os').homedir();
                const workSessionPath = path.join(homeDir, '.copilot', 'session-state', this.workSessionId!);
                const planPath = path.join(workSessionPath, 'plan.md');
                
                await fs.promises.writeFile(planPath, this.planModeSnapshot, 'utf-8');
                this.logger.info('[Plan Mode] Restored plan.md from snapshot');
            } catch (error) {
                this.logger.error('[Plan Mode] Failed to restore plan.md', error instanceof Error ? error : undefined);
            }
        }
        
        // Clear snapshot
        this.planModeSnapshot = null;
        
        // Send visual message to chat BEFORE exiting plan mode
        this._onDidReceiveOutput.fire({ content: '❌ **Plan Rejected**\n\nChanges discarded. Exiting plan mode...', messageId: '' });
        
        // Exit plan mode
        await this.disablePlanMode();
        
        // Notify UI with reject status
        this.logger.info('[Plan Mode] Emitting plan_rejected status event');
        this._onDidChangeStatus.fire({ status: 'plan_rejected' });
        this.logger.info('[Plan Mode] plan_rejected event emitted');
        
        this.logger.info('[Plan Mode] ❌ Plan rejected - changes discarded');
    }

    public getWorkspacePath(): string | undefined {
        return this.session?.workspacePath;
    }
    
    /**
     * Get the work session's workspace path
     * Always returns the work session path, even when in plan mode
     */
    public getWorkSessionWorkspacePath(): string | undefined {
        if (this.currentMode === 'work') {
            return this.session?.workspacePath;
        } else {
            // In plan mode, return work session's workspace
            return this.workSession?.workspacePath;
        }
    }
    
    /**
     * Get the path to plan.md file in the work session's state directory
     * Returns the full file path to plan.md, or undefined if no work session
     */
    public getPlanFilePath(): string | undefined {
        if (!this.workSessionId) {
            return undefined;
        }
        const homeDir = require('os').homedir();
        const workSessionPath = path.join(homeDir, '.copilot', 'session-state', this.workSessionId);
        return path.join(workSessionPath, 'plan.md');
    }
    
    /**
     * Get the list of available tools for the current plan session
     * Used by tests to verify plan mode restrictions
     * @returns Array of tool names that are whitelisted in plan mode, or undefined if not in plan mode
     */
    public getPlanModeAvailableTools(): string[] | undefined {
        if (this.currentMode !== 'plan') {
            return undefined;
        }
        return this.planModeToolsService?.getAvailableToolNames() ?? [...PLAN_MODE_AVAILABLE_TOOLS];
    }

    public getToolExecutions(): ToolExecutionState[] {
        return Array.from(this.toolExecutions.values());
    }
    
    /**
     * Determine whether an error indicates the requested model is unavailable
     * (not supported by the enterprise or an unrecognised model identifier).
     */
    private isModelUnsupportedError(error: unknown): boolean {
        if (!(error instanceof Error)) { return false; }
        const msg = error.message.toLowerCase();
        return msg.includes('model') && (
            msg.includes('not found') ||
            msg.includes('not supported') ||
            msg.includes('unsupported') ||
            msg.includes('invalid') ||
            msg.includes('not available') ||
            msg.includes('does not exist') ||
            msg.includes('unknown')
        );
    }

    /**
     * Create a session, with smart model fallback when the requested model
     * is unsupported by the user's account.
     *
     * Queries available models via ModelCapabilitiesService and picks the
     * best alternative. Notifies the user via both chat and OS-level toast.
     */
    private async createSessionWithModelFallback(config: Record<string, unknown>): Promise<any> {
        // Inject required fields into every session config.
        // NOTE: onEvent is intentionally NOT set here. Event subscriptions are
        // managed exclusively via session.on() in setupSessionEventHandlers()
        // (wrapped in MutableDisposable for proper cleanup). Adding onEvent here
        // caused every SDK event to fire _handleSDKEvent twice — once via onEvent
        // and once via session.on() — producing duplicate streaming content.
        config = {
            ...config,
            onPermissionRequest: this.permissionHandler ?? approveAll,
            clientName: 'vscode-copilot-cli',
            streaming: this.config.streaming ?? true,
            skillDirectories: this.resolveSkillDirectories(),
        };

        const MAX_FALLBACK_ATTEMPTS = 3;
        const requestedModel = config.model as string | undefined;
        const triedModels = new Set<string>();

        if (requestedModel) {
            triedModels.add(requestedModel);
        }

        const SDK_TIMEOUT_MS = 30_000;

        // First attempt: try the requested model
        try {
            return await withTimeout(this.client.createSession(config), SDK_TIMEOUT_MS, 'createSession');
        } catch (error) {
            if (!this.isModelUnsupportedError(error) || !requestedModel) {
                throw error;
            }

            this.logger.warn(`[Model Fallback] Model "${requestedModel}" is not supported, selecting fallback...`);

            // Fallback loop: try available models
            for (let attempt = 1; attempt <= MAX_FALLBACK_ATTEMPTS; attempt++) {
                const fallbackModel = await selectFallbackModel(
                    this.modelCapabilitiesService, triedModels, this.logger
                );

                // Avoid retrying a model we already tried
                if (triedModels.has(fallbackModel)) {
                    this.logger.warn(`[Model Fallback] Model "${fallbackModel}" already tried, stopping`);
                    break;
                }
                triedModels.add(fallbackModel);

                this.logger.info(`[Model Fallback] Attempt ${attempt}/${MAX_FALLBACK_ATTEMPTS}: trying "${fallbackModel}"`);

                try {
                    const session = await withTimeout(this.client.createSession({ ...config, model: fallbackModel }), SDK_TIMEOUT_MS, 'createSession');

                    // Success — notify user
                    this.notifyModelFallback(requestedModel, fallbackModel);
                    return session;
                } catch (retryError) {
                    if (this.isModelUnsupportedError(retryError)) {
                        this.logger.warn(`[Model Fallback] Fallback model "${fallbackModel}" also unsupported`);
                        continue;
                    }
                    throw retryError;
                }
            }

            // All fallback attempts failed
            this.logger.error(`[Model Fallback] All fallback attempts exhausted. Tried: [${Array.from(triedModels).join(', ')}]`);
            this.host.showError(
                `Model "${requestedModel}" is not supported by your account and no supported fallback model could be selected.`
            );
            this._onDidReceiveOutput.fire({ content:
                `**Model Unavailable**\n\n` +
                `Model \`${requestedModel}\` is not supported by your account, ` +
                `and no supported fallback model could be selected.\n\n` +
                `**Models tried:** ${Array.from(triedModels).map(m => `\`${m}\``).join(', ')}\n\n` +
                `Please update your model in **Settings > Copilot CLI > Model**.`,
                messageId: '' });
            throw error;
        }
    }

    /**
     * Notify the user about a model fallback via both chat and OS-level toast.
     */
    private notifyModelFallback(requestedModel: string, actualModel: string): void {
        this.host.showWarning(
            `Model "${requestedModel}" is not available. Using "${actualModel}" instead.`
        );
        this._onDidReceiveOutput.fire({ content:
            `**Model Fallback**\n\n` +
            `Model \`${requestedModel}\` is not available for your account. ` +
            `Using \`${actualModel}\` instead.\n\n` +
            `To change your default model, go to **Settings > Copilot CLI > Model**.`,
            messageId: '' });
        this.logger.info(`[Model Fallback] Successfully fell back from "${requestedModel}" to "${actualModel}"`);
    }

    /**
     * Update model capabilities by logging them for current model
     * Called on session start and model changes
     */
    private async updateModelCapabilities(): Promise<void> {
        try {
            // The configured model is only a *request*. Once the CLI has told us
            // what it actually selected (see `session.start` above), that wins —
            // otherwise this would overwrite a fallback with the dead model that
            // caused it.
            this.currentModelId = this.currentModelId || this.config.model || DEFAULT_MODEL;
            
            // Log capabilities using the service
            await this.modelCapabilitiesService.logCapabilities(this.currentModelId);
            
        } catch (error) {
            this.logger.error('[Model Capabilities] Failed to fetch model capabilities', error instanceof Error ? error : undefined);
        }
    }
    
    /**
     * Check if current model supports vision/image attachments
     */
    public async supportsVision(): Promise<boolean> {
        if (!this.currentModelId) {
            return false;
        }
        return this.modelCapabilitiesService.supportsVision(this.currentModelId);
    }
    
    /**
     * Get maximum number of images allowed per message for current model
     */
    public async getMaxImages(): Promise<number> {
        if (!this.currentModelId) {
            return 0;
        }
        return this.modelCapabilitiesService.getMaxImages(this.currentModelId);
    }
    
    /**
     * Get maximum image file size in bytes for current model
     */
    public async getMaxImageSize(): Promise<number> {
        if (!this.currentModelId) {
            return 0;
        }
        return this.modelCapabilitiesService.getMaxImageSize(this.currentModelId);
    }
    
    /**
     * Get supported media types for images
     */
    public async getSupportedMediaTypes(): Promise<string[]> {
        if (!this.currentModelId) {
            return [];
        }
        return this.modelCapabilitiesService.getSupportedMediaTypes(this.currentModelId);
    }
    
    /**
     * Get the model capabilities service (for direct access if needed)
     */
    public getModelCapabilitiesService(): ModelCapabilitiesService {
        return this.modelCapabilitiesService;
    }

    /**
     * Get available models from the SDK for populating UI dropdowns
     */
    public async getAvailableModels(): Promise<Array<{ id: string; name: string; multiplier?: number; outputPrice?: number }>> {
        try {
            const models = await this.modelCapabilitiesService.getAllModels();
            return models.map(m => ({
                id: m.id,
                name: m.name,
                multiplier: m.billing?.multiplier,
                outputPrice: m.billing?.tokenPrices?.outputPrice,
            }));
        } catch {
            return [];
        }
    }

    /**
     * Validate all attachments (delegates to ModelCapabilitiesService)
     * Returns first validation error encountered
     */
    public async validateAttachments(filePaths: string[]): Promise<{ valid: boolean; error?: string }> {
        if (!this.currentModelId) {
            return { valid: false, error: 'No model selected' };
        }
        return this.modelCapabilitiesService.validateAttachments(this.currentModelId, filePaths);
    }

    public dispose(): void {
        this.stop();
        
        // Dispose all services
        this._messageEnhancementService?.dispose();
        this.fileSnapshotService.dispose();
        if (this.planModeToolsService) {
            this.planModeToolsService.dispose();
        }
        
        // Dispose all event emitters and subscriptions
        this._disposables.dispose();
    }
}
