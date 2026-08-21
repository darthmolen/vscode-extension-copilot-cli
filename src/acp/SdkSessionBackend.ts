/**
 * Adapts one `SDKSessionManager` to the three-member slice {@link AcpSessionBackend}
 * that {@link CopilotAcpAgent} drives (IN-3).
 *
 * One manager per session, per spine S3: `setActiveSession()` disposes the previous
 * subscription, so a single manager can only emit for one session at a time.
 *
 * The manager is **injected, never constructed here**. That keeps this file free of
 * `vscode` and of the CLI, and it puts session construction where it belongs — the
 * agent process's composition root, which owns the shared `CopilotClientProvider`
 * and can therefore run N managers against one CLI process.
 */

import { LoggerLike } from '../logger';
import { AcpSessionBackend, AcpBackendEvent, AcpToolEvent } from './CopilotAcpAgent';
import type { SDKSessionManager } from '../sdkSessionManager';
import { ReplayTurn } from './sessionUpdateMapper';
import {
    AcpPermissionRequest,
    AcpPermissionOutcome,
    CopilotPermissionRequest,
    CopilotPermissionDecision,
    toAcpPermissionRequest,
    fromAcpOutcome
} from './permissionMapper';

/** Structural disposable, matching `BufferedEmitter`'s subscription handle. */
interface Disposable {
    dispose(): void;
}

/**
 * The slice of `SDKSessionManager` this adapter touches — declared rather than
 * imported so the manager's full surface (and its `vscode` types) stay out of here.
 */
export interface AcpManagerSlice {
    start(): Promise<void>;
    setPermissionHandler(handler: (request: any, invocation: any) => any): void;
    getSessionId(): string | null;
    sendMessage(message: string): Promise<void>;
    onDidMessageDelta(listener: (e: { messageId: string; deltaContent: string }) => void): Disposable;
    onDidReceiveReasoningDelta(listener: (e: { reasoningId: string; deltaContent: string }) => void): Disposable;
    onDidStartTool(listener: (e: AcpToolEvent) => void): Disposable;
    onDidUpdateTool(listener: (e: AcpToolEvent) => void): Disposable;
    onDidCompleteTool(listener: (e: AcpToolEvent) => void): Disposable;
    onDidStartSubagent(listener: (e: { agentId: string; agentName?: string; agentDisplayName?: string }) => void): Disposable;
    onDidSubagentMessage(listener: (e: { agentId: string; content?: string; reasoningText?: string }) => void): Disposable;
    onDidCompleteSubagent(listener: (e: { agentId: string; status: 'complete' | 'failed'; agentDisplayName?: string; error?: string }) => void): Disposable;
    onDidProduceDiff(listener: (e: {
        toolCallId: string; beforeUri: string; afterUri: string; title?: string;
    }) => void): Disposable;
    onDidUpdateTodos(listener: (e: {
        todos: Array<{ id?: string; title?: string; description?: string; status?: string }>;
        dependencies: Array<{ todoId: string; dependsOn: string }>;
    }) => void): Disposable;
    getCurrentMode(): 'work' | 'plan';
    abortMessage(): Promise<void>;
    stop(): Promise<void>;
    dispose(): void;
    enablePlanMode(): Promise<void>;
    disablePlanMode(): Promise<void>;
}

/**
 * Asks the host to decide, over ACP `session/request_permission`.
 *
 * Returns the whole response rather than the outcome because that is what the wire
 * carries — ACP nests it as `{ outcome: { outcome, optionId } }`, and unwrapping one
 * layer here would let a mistake in the other layer pass unnoticed.
 */
export type AcpPermissionRequester =
    (request: AcpPermissionRequest) => Promise<{ outcome?: AcpPermissionOutcome } | undefined>;

/**
 * Reads a session's stored conversation, oldest first.
 *
 * Injected so this file stays free of both the filesystem and the assumption that
 * sessions live under `~/.copilot`. The default is supplied by the composition root,
 * which is the layer that already knows where things are.
 */
export type HistoryReader = (sessionId: string) => Promise<ReplayTurn[]>;

/**
 * Reads a file's text, or `null` when it is not there.
 *
 * Injected for the same reason as {@link HistoryReader} — it keeps this file free of
 * the filesystem — but it is also the seam that makes "the snapshot is missing" and
 * "the file is missing" separately testable, and they mean opposite things.
 */
export type FileTextReader = (absolutePath: string) => string | null;

/** What to do when the host cannot be asked at all. */
export interface PermissionPolicy {
    /**
     * `deny` — the default, and the only safe one when a user might be watching.
     * `approve-once` — the unattended escape hatch, driven by the `yolo` setting.
     */
    fallback?: 'deny' | 'approve-once';
    /**
     * How long to wait for the host. A permission prompt waits on a human, so this is
     * generous; but it cannot be unbounded, because the SDK dispatches permissions
     * fire-and-forget and a request nobody answers leaves the tool call pending for
     * the life of the session.
     */
    timeoutMs?: number;
}

/** Ten minutes: long enough for someone to come back to their desk. */
const DEFAULT_PERMISSION_TIMEOUT_MS = 10 * 60_000;

/**
 * The permission state a backend needs before it exists.
 *
 * `setPermissionHandler` has to run before `manager.start()` — the handler is passed
 * in the session config — but the session id that every ACP request carries is only
 * known once `start()` has returned. So the handler closes over this instead of over
 * the backend, and the backend adopts it afterwards.
 */
interface PermissionState {
    sessionId: string;
    requester?: AcpPermissionRequester;
    policy: Required<PermissionPolicy>;
    seq: number;
}

/**
 * The modes this agent offers, in ACP's vocabulary.
 *
 * ACP models modes generically — ids are opaque strings — so we expose the
 * manager's two directly rather than inventing a mapping. `name` and `description`
 * are what a host puts in front of a user, so they are written for that reader
 * rather than echoing the internal identifier.
 */
export const ACP_SESSION_MODES = [
    {
        id: 'work',
        name: 'Work',
        description: 'Full tool access. The agent edits files, runs commands and commits.'
    },
    {
        id: 'plan',
        name: 'Plan',
        description: 'Research and planning only. Writes to plan.md; no edits, commits or installs.'
    }
] as const;

/**
 * Compile-time proof that the real `SDKSessionManager` still satisfies the slice
 * above.
 *
 * Without this, {@link AcpManagerSlice} is a description of a manager we *believe*
 * exists, and every test in this area runs against a hand-written fake that agrees
 * with the description by construction. Renaming `sendMessage`, or changing
 * `onDidMessageDelta`'s payload, would leave those tests green and break only at
 * runtime in the agent process.
 *
 * The import is type-only, so no `vscode` and no manager code is pulled in here.
 */
type AssertAssignable<T extends U, U> = T;
type _RealManagerFitsSlice = AssertAssignable<SDKSessionManager, AcpManagerSlice>;

export class SdkSessionBackend implements AcpSessionBackend {
    /**
     * Set by `cancel()`, cleared when a turn starts.
     *
     * A flag rather than a rejected promise because `sendMessage()` resolves when the
     * SDK goes idle, and aborting is precisely what makes it go idle — so a cancelled
     * turn resolves *successfully* and nothing about the call distinguishes it from
     * one that finished. Whether we were asked to stop is knowledge only this object
     * has.
     */
    private cancelledInFlight = false;

    private constructor(
        public readonly sessionId: string,
        private readonly manager: AcpManagerSlice,
        private readonly permissions: PermissionState,
        private readonly readHistory: HistoryReader,
        private readonly readFileText: FileTextReader,
        private readonly logger?: LoggerLike
    ) {}

    /**
     * Start a manager and wrap it. Private constructor because a backend is only
     * valid once its session id exists, and that is not knowable synchronously.
     */
    public static async start(
        manager: AcpManagerSlice,
        logger?: LoggerLike,
        policy: PermissionPolicy = {},
        readHistory: HistoryReader = async () => [],
        readFileText: FileTextReader = () => null
    ): Promise<SdkSessionBackend> {
        const permissions: PermissionState = {
            sessionId: '',
            policy: {
                fallback: policy.fallback ?? 'deny',
                timeoutMs: policy.timeoutMs ?? DEFAULT_PERMISSION_TIMEOUT_MS
            },
            seq: 0
        };

        // Before start(), and unconditionally. The handler is passed in the session
        // config, so one installed later would apply to the NEXT session; and the SDK
        // derives the wire flag `requestPermission` from whether a handler was given
        // at all, so installing it only once a requester appears would leave sessions
        // that told the CLI nobody will answer — where requests hang forever.
        manager.setPermissionHandler(request => decidePermission(permissions, request, logger));

        await manager.start();

        const sessionId = manager.getSessionId();
        if (!sessionId) {
            // Returning an id-less backend would let `session/new` hand the client a
            // handle that no later request could resolve — a session that exists for
            // exactly one round trip and then cannot be addressed.
            throw new Error('Manager started without a session id; cannot serve an ACP session');
        }

        permissions.sessionId = sessionId;
        logger?.info(`[ACP] backend ready for session ${sessionId}`);
        return new SdkSessionBackend(sessionId, manager, permissions, readHistory, readFileText, logger);
    }

    /**
     * Read both sides of a diff, or decide there is nothing worth sending.
     *
     * Read synchronously, inside the emitter callback, so a diff cannot overtake the
     * tool update it belongs to. These are files the CLI wrote moments ago, so the
     * cost is a warm-cache read; buying strict ordering with that is the better trade.
     *
     * The two missing-file cases mean opposite things and are handled as such. No
     * snapshot means the file did not exist before — a create — which ACP spells
     * `oldText: null`. No *current* file means we have nothing truthful to show, so
     * nothing is sent: staying quiet costs a host a diff, and guessing costs it the
     * truth about what is on disk.
     */
    private readDiff(e: { toolCallId: string; beforeUri: string; afterUri: string }): AcpBackendEvent | undefined {
        const newText = this.readFileText(e.afterUri);
        if (newText === null) {
            this.logger?.warn(`[ACP] diff for ${e.toolCallId}: cannot read ${e.afterUri}; not forwarding`);
            return undefined;
        }
        return {
            kind: 'diff',
            toolCallId: e.toolCallId,
            path: e.afterUri,
            oldText: this.readFileText(e.beforeUri),
            newText
        };
    }

    /**
     * The conversation so far, for `session/load` to replay.
     *
     * Read on demand rather than cached at start: a backend can outlive several loads,
     * and a snapshot taken once would go stale the moment a turn was taken.
     */
    public history(): Promise<ReplayTurn[]> {
        return this.readHistory(this.sessionId);
    }

    /**
     * Forward permission requests to `requester` instead of falling back.
     *
     * Settable after `start()` — and separately from it — because the thing that can
     * answer is the client CONNECTION, whose lifetime is neither the backend's nor a
     * turn's. A backend loaded by `session/load` gets one just as a new one does.
     */
    public setPermissionRequester(requester: AcpPermissionRequester): void {
        this.permissions.requester = requester;
        this.logger?.info(`[ACP] session ${this.sessionId} will forward permission requests to the client`);
    }

    /**
     * Assistant output as it streams.
     *
     * Deltas rather than completed messages: ACP's `agent_message_chunk` is a
     * streaming primitive, and forwarding whole messages would hold the entire
     * response back until the turn ended, which is exactly the latency the protocol
     * exists to avoid.
     */
    public onEvent(listener: (event: AcpBackendEvent) => void): () => void {
        const subscriptions: Disposable[] = [
            this.manager.onDidMessageDelta(e => {
                // Empty deltas are keepalive noise; forwarding them would emit empty
                // chunks a host has to render as nothing.
                if (e.deltaContent) {
                    listener({ kind: 'message', ...e });
                }
            }),
            this.manager.onDidReceiveReasoningDelta(e => {
                if (e.deltaContent) {
                    listener({ kind: 'reasoning', ...e });
                }
            }),
            this.manager.onDidStartTool(tool => listener({ kind: 'toolStart', tool })),
            // Both update and complete are later states of the SAME call, which is
            // exactly what ACP's tool_call_update expresses — so both map to it
            // rather than complete inventing a third variant.
            this.manager.onDidUpdateTool(tool => listener({ kind: 'toolUpdate', tool })),
            this.manager.onDidCompleteTool(tool => listener({ kind: 'toolUpdate', tool })),
            this.manager.onDidStartSubagent(e => listener({ kind: 'subagentStart', ...e })),
            this.manager.onDidSubagentMessage(e => listener({ kind: 'subagentMessage', ...e })),
            this.manager.onDidCompleteSubagent(e => listener({ kind: 'subagentComplete', ...e })),
            // The agent's plan. The manager has already turned the CLI's bare
            // `todos_changed` signal into fetched state, so there is nothing to read
            // here — only to forward.
            this.manager.onDidUpdateTodos(e => listener({ kind: 'plan', ...e })),
            // Our diff event carries a pair of PATHS, because VS Code's diff editor
            // takes URIs. A host at the far end of a pipe has no access to our
            // filesystem, so the text has to travel instead of a reference to it.
            this.manager.onDidProduceDiff(e => {
                const diff = this.readDiff(e);
                if (diff) {
                    listener(diff);
                }
            })
        ];

        // One returned unsubscribe for all of them: the caller subscribes per turn
        // and releases in a `finally`, and a partial release is a leak that only
        // shows up as duplicated chunks several turns later.
        return () => {
            for (const s of subscriptions) {
                s.dispose();
            }
        };
    }

    /**
     * Send a prompt and resolve when the turn ends.
     *
     * No separate turn-end signal is needed: `sendMessage()` awaits
     * `session.sendAndWait`, which blocks until `session.idle`.
     *
     * `stopReason` is `cancelled` when `session/cancel` reached us during the turn,
     * `end_turn` otherwise. `max_tokens`, `max_turn_requests` and `refusal` are real
     * ACP stop reasons the manager surfaces no signal for, so they are not claimed —
     * returning one we cannot detect would be a lie the client acts on.
     */
    public async prompt(text: string): Promise<{ stopReason: string }> {
        // Cleared per turn, not per session: a cancel belongs to the turn that was
        // running, and a later prompt is a new intention entitled to its own outcome.
        // This also absorbs a cancel that arrived with nothing in flight, which is a
        // normal race rather than a fault.
        this.cancelledInFlight = false;

        await this.manager.sendMessage(text);

        return { stopReason: this.cancelledInFlight ? 'cancelled' : 'end_turn' };
    }

    /**
     * Stop the turn in flight.
     *
     * ACP delivers cancel as a **notification**, so there is no reply and nothing to
     * await on the client's side — and verified against the SDK, a cancel does NOT
     * abort the prompt handler's `signal` on its own. Acting on it here is the only
     * thing that makes cancel real.
     *
     * Cancelling when nothing is running is normal, not an error: the client cannot
     * know the turn already ended, so a race is the expected case rather than a
     * fault.
     */
    public async cancel(): Promise<void> {
        this.logger?.info(`[ACP] cancel requested for session ${this.sessionId}`);
        this.cancelledInFlight = true;
        await this.manager.abortMessage();
    }

    /**
     * End the session and release what it holds.
     *
     * `stop()` closes the SDK session (and, in plan mode, both of them); `dispose()`
     * releases the manager's own services and subscriptions. Both are needed: stopping
     * without disposing leaves the services alive, and an agent process serving many
     * sessions accumulates them for its whole life.
     *
     * Cancellation is the agent's job, not this one's — `session/close` cancels first
     * so that ordering is visible where the protocol requires it.
     */
    public async close(): Promise<void> {
        this.logger?.info(`[ACP] releasing session ${this.sessionId}`);
        await this.manager.stop();
        this.manager.dispose();
    }

    /**
     * Read through to the manager rather than caching. The manager changes mode on
     * its own in at least one place — accepting a plan drops back to work — so a
     * cached copy here would drift and report a mode the session is not in.
     */
    public get currentModeId(): string {
        return this.manager.getCurrentMode();
    }

    /**
     * Enter `modeId`.
     *
     * Idempotent by necessity, not tidiness: `enablePlanMode()` creates a second SDK
     * session, so re-entering a mode already active would strand one.
     */
    public async setMode(modeId: string): Promise<void> {
        if (!ACP_SESSION_MODES.some(m => m.id === modeId)) {
            throw new Error(
                `unknown mode: ${modeId} (available: ${ACP_SESSION_MODES.map(m => m.id).join(', ')})`
            );
        }
        if (this.manager.getCurrentMode() === modeId) {
            return;
        }

        this.logger?.info(`[ACP] session ${this.sessionId} → mode ${modeId}`);
        if (modeId === 'plan') {
            await this.manager.enablePlanMode();
        } else {
            await this.manager.disablePlanMode();
        }
    }
}


/**
 * One Copilot permission request, answered by the host — or, if it cannot be, by the
 * fallback.
 *
 * Free function rather than a method because it is installed on the manager before
 * the backend exists (see {@link PermissionState}).
 *
 * The distinction that runs through it: **failing to ASK is not the same as being
 * given an answer we cannot use.** A throw, a timeout or a missing requester means we
 * never reached the user, and that takes the fallback — `user-not-available`, which
 * tells the model *why* there was no approval rather than implying someone said no.
 * An answer we cannot interpret is still an answer, and rejects. Neither path
 * approves by accident.
 */
async function decidePermission(
    state: PermissionState,
    request: CopilotPermissionRequest,
    logger?: LoggerLike
): Promise<CopilotPermissionDecision> {
    const fallback = (): CopilotPermissionDecision =>
        state.policy.fallback === 'approve-once'
            ? { kind: 'approve-once' }
            : { kind: 'user-not-available' };

    if (!state.requester) {
        logger?.warn(`[ACP] permission (${request.kind}) with no client to ask → ${state.policy.fallback}`);
        return fallback();
    }
    if (!state.sessionId) {
        // Only reachable if the CLI raised a permission before start() returned, which
        // would mean a tool ran before the session existed. Sending an ACP request with
        // an empty session id would be malformed, so fall back rather than emit it.
        logger?.warn(`[ACP] permission (${request.kind}) before the session id was known → ${state.policy.fallback}`);
        return fallback();
    }

    // `toolCallId` is optional on every Copilot variant and required by ACP. The
    // substitute has to be unique per request, not a constant: a host keying its open
    // prompts by tool call id would otherwise fold two questions into one.
    const acpRequest = toAcpPermissionRequest(state.sessionId, request, `permission-${++state.seq}`);

    let response: { outcome?: AcpPermissionOutcome } | undefined;
    try {
        response = await withPermissionTimeout(state.requester(acpRequest), state.policy.timeoutMs);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        logger?.warn(`[ACP] permission (${request.kind}) could not be put to the client (${reason}) → ${state.policy.fallback}`);
        return fallback();
    }

    const decision = fromAcpOutcome(request, response?.outcome);
    logger?.info(`[ACP] permission (${request.kind}) answered: ${decision.kind}`);
    return decision;
}

/**
 * Reject once `timeoutMs` has passed.
 *
 * The timer is cleared on settle so a resolved request does not hold the process
 * alive for the rest of the window — an agent that has finished its work but will not
 * exit for ten minutes reads as a hang.
 */
function withPermissionTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout;
    const expiry = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer within ${timeoutMs}ms`)), timeoutMs);
        timer.unref?.();
    });
    return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}
