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
import { AcpSessionBackend } from './CopilotAcpAgent';
import type { SDKSessionManager } from '../sdkSessionManager';

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
    getSessionId(): string | null;
    sendMessage(message: string): Promise<void>;
    onDidMessageDelta(listener: (e: { messageId: string; deltaContent: string }) => void): Disposable;
    getCurrentMode(): 'work' | 'plan';
    enablePlanMode(): Promise<void>;
    disablePlanMode(): Promise<void>;
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
    private constructor(
        public readonly sessionId: string,
        private readonly manager: AcpManagerSlice,
        private readonly logger?: LoggerLike
    ) {}

    /**
     * Start a manager and wrap it. Private constructor because a backend is only
     * valid once its session id exists, and that is not knowable synchronously.
     */
    public static async start(manager: AcpManagerSlice, logger?: LoggerLike): Promise<SdkSessionBackend> {
        await manager.start();

        const sessionId = manager.getSessionId();
        if (!sessionId) {
            // Returning an id-less backend would let `session/new` hand the client a
            // handle that no later request could resolve — a session that exists for
            // exactly one round trip and then cannot be addressed.
            throw new Error('Manager started without a session id; cannot serve an ACP session');
        }

        logger?.info(`[ACP] backend ready for session ${sessionId}`);
        return new SdkSessionBackend(sessionId, manager, logger);
    }

    /**
     * Assistant output as it streams.
     *
     * Deltas rather than completed messages: ACP's `agent_message_chunk` is a
     * streaming primitive, and forwarding whole messages would hold the entire
     * response back until the turn ended, which is exactly the latency the protocol
     * exists to avoid.
     */
    public onOutput(listener: (text: string) => void): () => void {
        const subscription = this.manager.onDidMessageDelta(({ deltaContent }) => {
            if (deltaContent) {
                listener(deltaContent);
            }
        });
        return () => subscription.dispose();
    }

    /**
     * Send a prompt and resolve when the turn ends.
     *
     * No separate turn-end signal is needed: `sendMessage()` awaits
     * `session.sendAndWait`, which blocks until `session.idle`.
     *
     * `stopReason` is unconditionally `end_turn` for now. `cancelled` arrives with
     * `session/cancel` and `max_tokens`/`refusal` need a signal the manager does not
     * yet surface — both are follow-on work, and claiming them here without the
     * evidence would be a lie the client acts on.
     */
    public async prompt(text: string): Promise<{ stopReason: string }> {
        await this.manager.sendMessage(text);
        return { stopReason: 'end_turn' };
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
