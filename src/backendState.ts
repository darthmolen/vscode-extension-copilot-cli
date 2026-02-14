/**
 * Backend State Manager
 * 
 * Centralized state management for CLI session and UI synchronization.
 * Maintains in-memory state that persists across webview recreations.
 */

export interface Message {
    role: 'user' | 'assistant' | 'system';
    type: 'user' | 'assistant' | 'reasoning' | 'tool' | 'error';
    content: string;
    timestamp?: number;
    toolName?: string;
    status?: 'running' | 'success' | 'error';
}

export interface PlanModeStatus {
    enabled: boolean;
    planReady: boolean;
    planAccepted: boolean;
}

export class BackendState {
    private sessionId: string | null = null;
    private sessionActive: boolean = false;
    private messages: Message[] = [];
    private planModeStatus: PlanModeStatus | null = null;
    private workspacePath: string | null = null;
    private activeFilePath: string | null = null;
    private sessionStartTime: number | null = null;

    // Session management
    public setSessionId(id: string | null): void {
        this.sessionId = id;
    }

    public getSessionId(): string | null {
        return this.sessionId;
    }

    public setSessionActive(active: boolean): void {
        // Track start time when session first becomes active
        if (active && !this.sessionStartTime) {
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
        if (!this.sessionStartTime) {
            return 0;
        }
        return (Date.now() - this.sessionStartTime) / 1000;
    }

    // Message history management
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
        return this.messages.filter(m => m.type === 'tool').length;
    }

    // Plan mode management
    public setPlanModeStatus(status: PlanModeStatus | null): void {
        this.planModeStatus = status;
    }

    public getPlanModeStatus(): PlanModeStatus | null {
        return this.planModeStatus ? { ...this.planModeStatus } : null;
    }

    // Workspace management
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

    // Get full state for webview sync
    public getFullState(): {
        sessionId: string | null;
        sessionActive: boolean;
        messages: Message[];
        planModeStatus: PlanModeStatus | null;
        workspacePath: string | null;
        activeFilePath: string | null;
    } {
        return {
            sessionId: this.sessionId,
            sessionActive: this.sessionActive,
            messages: this.getMessages(),
            planModeStatus: this.getPlanModeStatus(),
            workspacePath: this.workspacePath,
            activeFilePath: this.activeFilePath
        };
    }

    // Reset all state (e.g., when starting new session)
    public reset(): void {
        this.sessionId = null;
        this.sessionActive = false;
        this.messages = [];
        this.planModeStatus = null;
        this.sessionStartTime = null;
        // Keep workspace/active file as they're environment-level state
    }

    // Clear only session-specific state (keep messages for history)
    public clearSession(): void {
        this.sessionId = null;
        this.sessionActive = false;
        this.planModeStatus = null;
    }
}

// Singleton instance
let backendStateInstance: BackendState | null = null;

export function getBackendState(): BackendState {
    if (!backendStateInstance) {
        backendStateInstance = new BackendState();
    }
    return backendStateInstance;
}

export function resetBackendState(): void {
    if (backendStateInstance) {
        backendStateInstance.reset();
    }
}
