/**
 * Chat in an editor tab.
 *
 * Two ways in, and the difference between them is the point:
 *
 *  - `openNew()` — the *New Tab* gesture. A new conversation, never the window's
 *    last one. The host is built with `whenNoSession: 'new'` so neither
 *    `copilotCLI.resumeLastSession` nor the most-recent-by-mtime heuristic gets a
 *    vote, per CLAUDE.md's "intentional actions are treated intentionally".
 *  - `openSession(id)` — a restored tab, or a session picked by name.
 *
 * `openSession` carries the collision rule, which is a decision rather than a
 * discovery. The parent plan says **one session, one live surface, never
 * mirrored** — which is why `ChatSessionHost.attachSurface` replaces rather than
 * fans out. So the mechanism is `registry.get()` *before* creating anything: a
 * session that already has a surface gets that surface revealed. The registry's
 * "two hosts claim one session" warning sits behind this as a backstop, not as
 * the thing doing the work.
 *
 * Everything VS Code-shaped is injected, so the whole flow is drivable from plain
 * mocha. That is deliberate: the failure modes here — a second panel for a live
 * session, a surface that outlives its panel, a tab that cannot be reopened after
 * being closed — are all sequencing, and none of them are visible in a screenshot.
 */

import type * as vscode from 'vscode';
import { LoggerLike } from '../../logger';
import { ChatSessionHost, ChatSurface } from '../session/ChatSessionHost';
import { ChatSessionRegistry } from '../session/ChatSessionRegistry';
import type { ChatWebviewSlot } from './chatWebviewSlot';

/** The chat panel's view type. Also the serializer's key — they must match. */
export const CHAT_PANEL_VIEW_TYPE = 'copilotChatPanel';

/**
 * What a panel surface must be able to do.
 *
 * `ChatSurface` is what a *host* writes to; this is what the panel service needs
 * on top of it — attach a container, point at a session. Structurally satisfied by
 * `WebviewChatSurface`, which is never imported here: the type-only import is what
 * keeps this module free of `vscode` at runtime and therefore testable.
 */
export interface PanelChatSurface extends ChatSurface {
    attach(slot: ChatWebviewSlot): void;
    setSessionHost(host: ChatSessionHost): void;
}

export interface ChatPanelServiceDeps {
    logger: LoggerLike;
    registry: ChatSessionRegistry;
    createPanel(
        viewType: string,
        title: string,
        options: { enableScripts: boolean; retainContextWhenHidden: boolean; localResourceRoots: vscode.Uri[] }
    ): vscode.WebviewPanel;
    /** A fresh `WebviewChatSurface`, built by the composition root. */
    createSurface(): PanelChatSurface;
    /**
     * Wrap a panel as a slot. Injected because `PanelSlot` is a VS Code adapter and
     * this service deliberately is not — adapters know `vscode`, services do not.
     */
    makeSlot(panel: vscode.WebviewPanel): ChatWebviewSlot;
    resourceRoots(): vscode.Uri[];
    /** Wire the surface's events to its host. Disposed when the panel closes. */
    registerHandlers(surface: PanelChatSurface): { dispose(): void };
    /** Replay a session's history into the host that is going to show it. */
    loadTranscript(sessionId: string, host: ChatSessionHost): Promise<void>;
}

export class ChatPanelService {
    private readonly deps: ChatPanelServiceDeps;

    constructor(deps: ChatPanelServiceDeps) {
        this.deps = deps;
    }

    /** New Tab: a new conversation, in a new panel. */
    public async openNew(): Promise<void> {
        const host = this.deps.registry.create(null, undefined, { whenNoSession: 'new' });
        await this.openPanelFor(host, 'Copilot Chat');
    }

    /**
     * Show a particular session in a tab — or, if something is already showing it,
     * bring that to the front instead.
     */
    public async openSession(sessionId: string): Promise<void> {
        const existing = this.deps.registry.get(sessionId);
        const showingIt = existing?.getSurface();
        if (existing && showingIt) {
            // One session, one live surface. A second panel here would mean two
            // routers writing one conversation, and the host can only send to one.
            this.deps.logger.info(
                `[ChatPanel] session ${sessionId} already has a surface — revealing it`
            );
            showingIt.show();
            return;
        }

        const host = existing ?? await this.deps.registry.getOrCreate(sessionId);
        await this.openPanelFor(host, 'Copilot Chat', sessionId);
    }

    /**
     * Adopt a panel VS Code restored on window reload.
     *
     * **The tab always survives; only the session binding is conditional.** VS Code
     * restored this tab because the *user* had it open, so closing it is a surprise
     * they did not ask for — emptying it is not. An unusable state, or a session
     * something else is already showing, therefore degrades to a fresh conversation
     * in the same tab rather than to no tab.
     *
     * Serialized state carries the session id and nothing else. The transcript is
     * rebuilt from the event log by the same projection every other path uses;
     * persisting one here would reintroduce the second, lossy copy P2 deleted.
     *
     * **No freshness gate, deliberately.** Claude Code's serializer persists a
     * `sessionUpdatedAt` beside the id and rebinds only within ten minutes, so a tab
     * left open for a week returns empty. We do the opposite: a tab pinned to a
     * session is a standing instruction, and age is not a reason to ignore it. The
     * alternative is recorded rather than merely unimplemented.
     */
    public async restore(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
        const sessionId = readRestoredSessionId(state);
        if (!sessionId) {
            this.deps.logger.warn('[ChatPanel] restored a tab with no session id — opening it fresh');
            await this.openFreshIn(panel);
            return;
        }

        if (this.deps.registry.get(sessionId)?.getSurface()) {
            // One session, one live surface. Revealing the incumbent instead would
            // steal focus during activation, which is not the user asking for it.
            this.deps.logger.info(
                `[ChatPanel] session ${sessionId} is already on screen — opening this tab fresh`
            );
            await this.openFreshIn(panel);
            return;
        }

        const host = await this.deps.registry.getOrCreate(sessionId);
        this.deps.logger.info(`[ChatPanel] restoring tab for ${sessionId}`);
        await this.adopt(panel, host, sessionId);
    }

    /** Give a panel we could not bind a new conversation instead of closing it. */
    private async openFreshIn(panel: vscode.WebviewPanel): Promise<void> {
        const host = this.deps.registry.create(null, undefined, { whenNoSession: 'new' });
        await this.adopt(panel, host);
    }

    private async openPanelFor(host: ChatSessionHost, title: string, replay?: string): Promise<void> {
        const panel = this.deps.createPanel(CHAT_PANEL_VIEW_TYPE, title, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: this.deps.resourceRoots()
        });
        await this.adopt(panel, host, replay);
    }

    /** Bind a panel — freshly created or restored by VS Code — to a host. */
    private async adopt(panel: vscode.WebviewPanel, host: ChatSessionHost, replay?: string): Promise<void> {
        const surface = this.deps.createSurface();
        surface.setSessionHost(host);
        host.attachSurface(surface);
        surface.attach(this.deps.makeSlot(panel));

        const handlers = this.deps.registerHandlers(surface);
        panel.onDidDispose(() => {
            // The surface dies with its panel. Leaving it attached would keep the
            // host writing into a webview that no longer exists, and would keep the
            // session unreachable — `registry.get()` would still report a live
            // surface, so reopening the tab would silently reveal nothing.
            handlers.dispose();
            surface.dispose();
            host.detachSurface(surface);
            // Explicit, rather than implied by `detachSurface`. Detaching is also
            // what the *sidebar* does whenever VS Code hides its container and
            // means to re-resolve it; only a closed tab is gone for good, which is
            // what `closingEndsSurface` records. Left out, every tab opened over a
            // day is a live CLI session with no UI (§4.4).
            host.releaseWhenIdle();
            this.deps.logger.info(`[ChatPanel] tab closed for ${host.sessionId ?? '(no session yet)'}`);
        });

        if (replay) {
            await this.deps.loadTranscript(replay, host);
        }
        await host.ensureStarted();
        // Nothing records the session id here. `ensureStarted` is what assigns one,
        // and the surface's own `sendInit` — which runs after it — carries the id to
        // the webview, which is the only side that can write the state channel VS
        // Code reads back. See `surfaceSessionState.js`.
    }
}

/**
 * The session id out of whatever VS Code handed back.
 *
 * Serialized state is JSON written by a possibly older version of this extension,
 * so it is untrusted input rather than a type we own.
 */
function readRestoredSessionId(state: unknown): string | null {
    if (!state || typeof state !== 'object') {
        return null;
    }
    const sessionId = (state as { sessionId?: unknown }).sessionId;
    return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null;
}
