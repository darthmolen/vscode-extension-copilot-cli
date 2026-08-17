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
import type { Message } from './shared/models';

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

/**
 * Window-scoped state, shared by every chat surface.
 *
 * Injected into each `ChatSessionHost` rather than reached for as a global, so
 * the sharing is explicit at the composition root and hosts stay testable.
 */
export class WorkspaceRuntimeState {
    private workspacePath: string | null = null;
    private activeFilePath: string | null = null;
    private mcpServerTools: Record<string, string[]> = {};
    private mcpServerStatuses: Record<string, string> = {};

    public setWorkspacePath(path: string | null): void {
        this.workspacePath = path;
    }

    public getWorkspacePath(): string | null {
        return this.workspacePath;
    }

    public setActiveFilePath(path: string | null): void {
        this.activeFilePath = path;
    }

    public getActiveFilePath(): string | null {
        return this.activeFilePath;
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
    public getFullState(): {
        sessionId: string | null;
        sessionActive: boolean;
        messages: Message[];
        planModeStatus: PlanModeStatus | null;
        workspacePath: string | null;
        activeFilePath: string | null;
        currentModel: string | null;
        activeAgent: string | null;
    } {
        return {
            sessionId: this.session.getSessionId(),
            sessionActive: this.session.isSessionActive(),
            messages: this.session.getMessages(),
            planModeStatus: this.session.getPlanModeStatus(),
            workspacePath: this.workspace.getWorkspacePath(),
            activeFilePath: this.workspace.getActiveFilePath(),
            currentModel: this.session.getCurrentModel(),
            activeAgent: this.session.getActiveAgent()
        };
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
