/**
 * Backend state, split by lifetime.
 *
 * This was one `BackendState` holding two different kinds of thing: state that
 * belongs to a *conversation* (id, messages, plan mode, model, agent) and state
 * that belongs to the *window* (workspace path, active file, MCP tools and
 * statuses). With a single chat surface the distinction never mattered.
 *
 * It matters now. v3.13.0 gives each chat surface its own session, so each needs
 * its own `SessionState` — but they share one workspace, and duplicating the
 * environment half would leave two surfaces disagreeing about which file is
 * active or which MCP servers are up.
 *
 * `BackendState` remains as a facade over both halves so the existing call sites
 * keep working unchanged; Task 4 re-points them at a `ChatSessionHost`.
 *
 * Three classes in one file, deliberately: they are a sealed set describing one
 * decomposition, and the facade only exists to delegate to the other two. Split
 * them apart and the reason for the boundary stops being visible at a glance.
 */

/**
 * One transcript entry. Re-exported from the wire contract on purpose.
 *
 * This file used to declare its own `Message`, and the two were not assignable in
 * either direction: this one required `type` and had `toolName`/`status`, the wire
 * one had neither and could not express a tool at all. That mismatch is what forced
 * `main.js` to smuggle `type` through `role` and drop the rest, which is what made
 * every replayed tool render as "Tool execution".
 */
export type { Message } from './shared/models';
import type { Message, ToolState } from './shared/models';

export interface PlanModeStatus {
    enabled: boolean;
    planReady: boolean;
    planAccepted: boolean;
}

/**
 * One conversation's state. One instance per `ChatSessionHost`.
 */
export class SessionState {
    private sessionId: string | null = null;
    private sessionActive: boolean = false;
    private messages: Message[] = [];
    private planModeStatus: PlanModeStatus | null = null;
    private sessionStartTime: number | null = null;
    private currentModel: string | null = null;
    private activeAgent: string | null = null;

    public setSessionId(id: string | null): void {
        this.sessionId = id;
    }

    public getSessionId(): string | null {
        return this.sessionId;
    }

    public setSessionActive(active: boolean): void {
        // Track start time when session first becomes active
        if (active && this.sessionStartTime === null) {
            this.sessionStartTime = Date.now();
        }
        this.sessionActive = active;
    }

    public isSessionActive(): boolean {
        return this.sessionActive;
    }

    public getSessionStartTime(): number | null {
        return this.sessionStartTime;
    }

    public getSessionDuration(): number {
        if (this.sessionStartTime === null) {
            return 0;
        }
        return (Date.now() - this.sessionStartTime) / 1000;
    }

    public addMessage(message: Message): void {
        // Add timestamp if not present
        if (!message.timestamp) {
            message.timestamp = Date.now();
        }
        this.messages.push(message);
    }

    public getMessages(): Message[] {
        return [...this.messages]; // Return copy to prevent external mutation
    }

    public clearMessages(): void {
        this.messages = [];
    }

    public setMessages(messages: Message[]): void {
        this.messages = [...messages];
    }

    /**
     * Record a tool call, replacing the earlier entry for the same call.
     *
     * Upsert rather than append, because a tool is one event in the conversation
     * that changes state three times — start, progress, complete. Appending would
     * put the same `bash` in the transcript three times, which is what the reader
     * would see on the next re-render.
     *
     * The shape deliberately matches what `sessionTranscriptBuilder` produces for
     * `tool.execution_start`, so a live transcript and one replayed from
     * `events.jsonl` are the same thing. They drifted once already: the old
     * `addToolExecution` stored `content: 'Tool execution'` and read `toolState.name`,
     * a field the live payload has never had — the grey bubble P2 set out to kill.
     * `role` is deliberately not set, matching the builder; the webview derives it.
     */
    public recordTool(tool: ToolState, agentId?: string): void {
        const existing = this.messages.find(
            message => message.kind === 'tool' && message.tool?.toolCallId === tool.toolCallId
        );
        // Copied, not aliased: the manager keeps its own mutable state for this
        // call, and a transcript that changes under the reader is not a transcript.
        const snapshot = { ...tool };
        if (existing) {
            existing.tool = snapshot;
            return;
        }
        const message: Message = {
            kind: 'tool',
            content: tool.toolName ?? 'tool',
            timestamp: tool.startTime ?? Date.now(),
            tool: snapshot
        };
        if (agentId) {
            message.agentId = agentId;
        }
        this.messages.push(message);
    }

    public getMessageCount(): number {
        return this.messages.length;
    }

    public getToolCallCount(): number {
        return this.messages.filter(m => m.kind === 'tool').length;
    }

    public setPlanModeStatus(status: PlanModeStatus | null): void {
        this.planModeStatus = status;
    }

    public getPlanModeStatus(): PlanModeStatus | null {
        return this.planModeStatus ? { ...this.planModeStatus } : null;
    }

    public setCurrentModel(model: string | null): void {
        this.currentModel = model;
    }

    public getCurrentModel(): string | null {
        return this.currentModel;
    }

    public setActiveAgent(agent: string | null): void {
        this.activeAgent = agent;
    }

    public getActiveAgent(): string | null {
        return this.activeAgent;
    }

    /** Everything about this conversation, back to empty. */
    public reset(): void {
        this.sessionId = null;
        this.sessionActive = false;
        this.messages = [];
        this.planModeStatus = null;
        this.sessionStartTime = null;
        this.currentModel = null;
        this.activeAgent = null;
    }

    /** Drop session identity but keep the transcript. */
    public clearSession(): void {
        this.sessionId = null;
        this.sessionActive = false;
        this.planModeStatus = null;
    }
}

/** One row of the session dropdown. */
export interface SessionListEntry {
    id: string;
    label: string;
}

/** What moved. Surfaces re-render only the part that did. */
export type WorkspaceStateChange = 'activeFile' | 'sessions' | 'workspacePath';

/**
 * Window-scoped state, shared by every chat surface.
 *
 * Injected into each `ChatSessionHost` rather than reached for as a global, so
 * the sharing is explicit at the composition root and hosts stay testable.
 */
export class WorkspaceRuntimeState {
    private workspacePath: string | null = null;
    private activeFilePath: string | null = null;
    private sessions: SessionListEntry[] = [];
    private mcpServerTools: Record<string, string[]> = {};
    private mcpServerStatuses: Record<string, string> = {};
    private readonly listeners: Array<(change: WorkspaceStateChange) => void> = [];

    /**
     * Watch this window's state.
     *
     * Plain callbacks rather than `vscode.EventEmitter` so this module stays free
     * of `vscode` and requirable from plain mocha — the same constraint
     * `ChatSessionHost.onAdoptSessionId` is built to.
     *
     * The subscriber owns the returned handle. A surface that fails to dispose it
     * keeps writing to a webview that no longer exists.
     */
    public onDidChange(listener: (change: WorkspaceStateChange) => void): { dispose(): void } {
        this.listeners.push(listener);
        return {
            dispose: () => {
                const index = this.listeners.indexOf(listener);
                if (index > -1) {
                    this.listeners.splice(index, 1);
                }
            }
        };
    }

    /**
     * Tell every surface. One broken subscriber must not silence the others —
     * with N surfaces, a throw from a half-disposed tab would otherwise stop the
     * rest of the window updating.
     */
    private announce(change: WorkspaceStateChange): void {
        for (const listener of this.listeners.slice()) {
            try {
                listener(change);
            } catch {
                // Deliberately swallowed: this object has no logger, and losing one
                // surface's update is better than losing all of them.
            }
        }
    }

    public setWorkspacePath(path: string | null): void {
        if (this.workspacePath === path) {
            return;
        }
        this.workspacePath = path;
        this.announce('workspacePath');
    }

    public getWorkspacePath(): string | null {
        return this.workspacePath;
    }

    /**
     * Silent when nothing moved. Editor focus churn re-reports the same file
     * constantly, and with N surfaces every repeat would be N re-renders.
     */
    public setActiveFilePath(path: string | null): void {
        if (this.activeFilePath === path) {
            return;
        }
        this.activeFilePath = path;
        this.announce('activeFile');
    }

    public getActiveFilePath(): string | null {
        return this.activeFilePath;
    }

    /**
     * The session dropdown's contents — window-scoped, unlike *which* of them is
     * current. Each surface pairs this list with its own host's session id at
     * render time, which is what stops a tab's dropdown highlighting the
     * sidebar's conversation.
     */
    public setSessions(sessions: SessionListEntry[]): void {
        this.sessions = sessions;
        this.announce('sessions');
    }

    public getSessions(): SessionListEntry[] {
        return this.sessions;
    }

    public setMcpServerTools(serverKey: string, tools: string[]): void {
        this.mcpServerTools[serverKey] = tools;
    }

    public getMcpServerTools(): Record<string, string[]> {
        return { ...this.mcpServerTools };
    }

    public setMcpServerStatus(serverKey: string, status: string): void {
        this.mcpServerStatuses[serverKey] = status;
    }

    public getMcpServerStatuses(): Record<string, string> {
        return { ...this.mcpServerStatuses };
    }

    public clearMcpState(): void {
        this.mcpServerTools = {};
        this.mcpServerStatuses = {};
    }
}

/** Everything a surface needs to render itself from cold. */
export interface FullState {
    sessionId: string | null;
    sessionActive: boolean;
    messages: Message[];
    planModeStatus: PlanModeStatus | null;
    workspacePath: string | null;
    activeFilePath: string | null;
    currentModel: string | null;
    activeAgent: string | null;
}

/**
 * The one place a surface's init payload is assembled.
 *
 * A free function rather than a method because there are two owners of the two
 * halves and neither should learn the other's shape: a `ChatSessionHost` holds one
 * conversation's `SessionState` and shares the window's `WorkspaceRuntimeState`,
 * while `BackendState` holds one of each. Both need the same payload.
 *
 * Kept singular deliberately. Three hand-built init payloads shipped in this
 * codebase before one of them was found by noticing a missing log line; a second
 * builder here is the same defect waiting for a second surface.
 */
export function composeFullState(session: SessionState, workspace: WorkspaceRuntimeState): FullState {
    return {
        sessionId: session.getSessionId(),
        sessionActive: session.isSessionActive(),
        messages: session.getMessages(),
        planModeStatus: session.getPlanModeStatus(),
        workspacePath: workspace.getWorkspacePath(),
        activeFilePath: workspace.getActiveFilePath(),
        currentModel: session.getCurrentModel(),
        activeAgent: session.getActiveAgent()
    };
}

/**
 * The pre-split interface, preserved.
 *
 * Every existing caller still sees one object with one set of methods. Task 4
 * re-points them at a host; until then this keeps the extraction behaviour-neutral.
 */
export class BackendState {
    public readonly session: SessionState;
    public readonly workspace: WorkspaceRuntimeState;

    constructor(session?: SessionState, workspace?: WorkspaceRuntimeState) {
        this.session = session ?? new SessionState();
        this.workspace = workspace ?? new WorkspaceRuntimeState();
    }

    // ── Session ──────────────────────────────────────────────────────────────
    public setSessionId(id: string | null): void { this.session.setSessionId(id); }
    public getSessionId(): string | null { return this.session.getSessionId(); }
    public setSessionActive(active: boolean): void { this.session.setSessionActive(active); }
    public isSessionActive(): boolean { return this.session.isSessionActive(); }
    public getSessionStartTime(): number | null { return this.session.getSessionStartTime(); }
    public getSessionDuration(): number { return this.session.getSessionDuration(); }
    public addMessage(message: Message): void { this.session.addMessage(message); }
    public getMessages(): Message[] { return this.session.getMessages(); }
    public clearMessages(): void { this.session.clearMessages(); }
    public setMessages(messages: Message[]): void { this.session.setMessages(messages); }
    public getMessageCount(): number { return this.session.getMessageCount(); }
    public getToolCallCount(): number { return this.session.getToolCallCount(); }
    public setPlanModeStatus(status: PlanModeStatus | null): void { this.session.setPlanModeStatus(status); }
    public getPlanModeStatus(): PlanModeStatus | null { return this.session.getPlanModeStatus(); }
    public setCurrentModel(model: string | null): void { this.session.setCurrentModel(model); }
    public getCurrentModel(): string | null { return this.session.getCurrentModel(); }
    public setActiveAgent(agent: string | null): void { this.session.setActiveAgent(agent); }
    public getActiveAgent(): string | null { return this.session.getActiveAgent(); }

    // ── Workspace ────────────────────────────────────────────────────────────
    public setWorkspacePath(path: string | null): void { this.workspace.setWorkspacePath(path); }
    public getWorkspacePath(): string | null { return this.workspace.getWorkspacePath(); }
    public setActiveFilePath(path: string | null): void { this.workspace.setActiveFilePath(path); }
    public getActiveFilePath(): string | null { return this.workspace.getActiveFilePath(); }
    public setMcpServerTools(serverKey: string, tools: string[]): void { this.workspace.setMcpServerTools(serverKey, tools); }
    public getMcpServerTools(): Record<string, string[]> { return this.workspace.getMcpServerTools(); }
    public setMcpServerStatus(serverKey: string, status: string): void { this.workspace.setMcpServerStatus(serverKey, status); }
    public getMcpServerStatuses(): Record<string, string> { return this.workspace.getMcpServerStatuses(); }

    // Get full state for webview sync
    public getFullState(): FullState {
        return composeFullState(this.session, this.workspace);
    }

    /** Reset the conversation. Workspace and active file survive — they are environment. */
    public reset(): void {
        this.session.reset();
    }

    /** Clear session identity and MCP state, keeping the transcript. */
    public clearSession(): void {
        this.session.clearSession();
        this.workspace.clearMcpState();
    }
}

// ── Singletons ───────────────────────────────────────────────────────────────
// One window-scoped instance, and one facade over it. They must be the same
// `WorkspaceRuntimeState`: a host writing through the facade has to be visible
// to one holding the shared object directly.

let workspaceRuntimeInstance: WorkspaceRuntimeState | null = null;
let backendStateInstance: BackendState | null = null;

export function getWorkspaceRuntimeState(): WorkspaceRuntimeState {
    if (!workspaceRuntimeInstance) {
        workspaceRuntimeInstance = new WorkspaceRuntimeState();
    }
    return workspaceRuntimeInstance;
}

export function getBackendState(): BackendState {
    if (!backendStateInstance) {
        backendStateInstance = new BackendState(new SessionState(), getWorkspaceRuntimeState());
    }
    return backendStateInstance;
}

export function resetBackendState(): void {
    if (backendStateInstance) {
        backendStateInstance.reset();
    }
}
