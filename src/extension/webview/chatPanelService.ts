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

    private async openPanelFor(host: ChatSessionHost, title: string, replay?: string): Promise<void> {
        const panel = this.deps.createPanel(CHAT_PANEL_VIEW_TYPE, title, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: this.deps.resourceRoots()
        });

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
            this.deps.logger.info(`[ChatPanel] tab closed for ${host.sessionId ?? '(no session yet)'}`);
        });

        if (replay) {
            await this.deps.loadTranscript(replay, host);
        }
        await host.ensureStarted();
    }
}
