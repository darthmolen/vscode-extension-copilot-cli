# Phase 3: Extract Backend Services

## Status
⏸️ Not Started

## Goal
Decompose monolithic `extension.ts` and `chatViewProvider.ts` into focused, testable services

## Context
Currently, business logic is spread across `extension.ts` and `chatViewProvider.ts` in an entangled way. This makes the code hard to test, understand, and modify.

This phase extracts distinct concerns into dedicated service classes:
- Session management
- Copilot SDK interaction
- CLI server management  
- Tool permissions
- Plan mode operations

## Tasks

### Service Infrastructure
- [ ] Create `src/extension/services/` directory
- [ ] Define service interfaces/contracts
- [ ] Set up dependency injection pattern

### Service Extraction
- [ ] Create `SessionService.ts`
- [ ] Create `CopilotService.ts`
- [ ] Create `CliServerService.ts`
- [ ] Create `ToolPermissionService.ts`
- [ ] Create `PlanModeService.ts`
- [ ] Create `McpService.ts` stub (for Phase 5)

### Refactoring
- [ ] Refactor `extension.ts` to use services
- [ ] Simplify `chatViewProvider.ts` to webview + RPC only
- [ ] Update RPC router to delegate to services
- [ ] Remove duplicate logic
- [ ] Update tests to use service layer

### Testing
- [ ] Add unit tests for each service
- [ ] Add integration tests for service interactions
- [ ] Verify all functionality still works

## Technical Details

### Service Responsibilities

#### SessionService
**Responsibility**: Session lifecycle management

**Interface**:
```typescript
export interface ISessionService {
  createSession(): Promise<Session>;
  deleteSession(sessionId: string): Promise<void>;
  getSession(sessionId: string): Session | undefined;
  getActiveSession(): Session | undefined;
  setActiveSession(sessionId: string): void;
  listSessions(): Session[];
  getSessionStateDir(sessionId: string): string;
}
```

**State**:
- Active session ID
- Session map
- Session state directory paths

**Dependencies**:
- File system access (VS Code workspace)
- Configuration service

---

#### CopilotService
**Responsibility**: Copilot SDK agent runtime interaction

**Interface**:
```typescript
export interface ICopilotService {
  initialize(): Promise<void>;
  sendPrompt(prompt: string, sessionId: string): Promise<void>;
  abortStream(): void;
  isStreaming(): boolean;
  onStreamChunk(handler: (chunk: string) => void): void;
  onStreamEnd(handler: () => void): void;
}
```

**State**:
- Agent instance
- Current stream controller
- Streaming status

**Dependencies**:
- Copilot SDK
- Session service (for session context)

---

#### CliServerService  
**Responsibility**: CLI server mode management

**Interface**:
```typescript
export interface ICliServerService {
  start(port?: number): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  getPort(): number | undefined;
  onOutput(handler: (output: string) => void): void;
}
```

**State**:
- CLI process handle
- Server port
- Running status

**Dependencies**:
- Child process management
- Configuration service

---

#### ToolPermissionService
**Responsibility**: Tool approval/denial workflow

**Interface**:
```typescript
export interface IToolPermissionService {
  requestPermission(tool: Tool): Promise<PermissionDecision>;
  savePermission(tool: Tool, decision: PermissionDecision): void;
  getPermission(tool: Tool): PermissionDecision | undefined;
  clearPermissions(): void;
}
```

**State**:
- Permission cache
- Pending permission requests

**Dependencies**:
- UI for permission dialogs
- Persistent storage

---

#### PlanModeService
**Responsibility**: Plan mode state and operations

**Interface**:
```typescript
export interface IPlanModeService {
  isEnabled(): boolean;
  enable(sessionId: string): void;
  disable(sessionId: string): void;
  getPlanPath(sessionId: string): string;
  loadPlan(sessionId: string): Promise<string>;
  savePlan(sessionId: string, content: string): Promise<void>;
  presentPlan(sessionId: string): Promise<void>;
  acceptPlan(sessionId: string): void;
  rejectPlan(sessionId: string): void;
}
```

**State**:
- Plan mode enabled per session
- Current plan content
- Plan file paths

**Dependencies**:
- Session service
- File system access

---

### Dependency Injection Pattern

```typescript
// src/extension/services/ServiceContainer.ts

export class ServiceContainer {
  private sessionService: ISessionService;
  private copilotService: ICopilotService;
  private cliServerService: ICliServerService;
  private toolPermissionService: IToolPermissionService;
  private planModeService: IPlanModeService;

  constructor(context: vscode.ExtensionContext) {
    // Initialize services with dependencies
    this.sessionService = new SessionService(context);
    this.copilotService = new CopilotService(this.sessionService);
    this.cliServerService = new CliServerService();
    this.toolPermissionService = new ToolPermissionService(context);
    this.planModeService = new PlanModeService(this.sessionService);
  }

  getSessionService(): ISessionService {
    return this.sessionService;
  }

  getCopilotService(): ICopilotService {
    return this.copilotService;
  }

  // ... other getters
}
```

### Extension.ts Refactoring

**Before**:
```typescript
export async function activate(context: vscode.ExtensionContext) {
  // Hundreds of lines of mixed concerns
  const sessions = new Map();
  let activeSession = null;
  // ... lots of logic
}
```

**After**:
```typescript
export async function activate(context: vscode.ExtensionContext) {
  const services = new ServiceContainer(context);
  
  const chatViewProvider = new ChatViewProvider(
    context.extensionUri,
    services
  );

  // Register commands with service delegation
  context.subscriptions.push(
    vscode.commands.registerCommand('copilot-cli.newChat', () => {
      services.getSessionService().createSession();
    })
  );
}
```

### ChatViewProvider Refactoring

**Before**:
```typescript
class ChatViewProvider {
  // Mixed webview management + business logic
  private sessions = new Map();
  private copilotAgent = ...;
  // ... 500+ lines
}
```

**After**:
```typescript
class ChatViewProvider {
  // Pure webview + RPC routing
  constructor(
    private extensionUri: vscode.Uri,
    private services: ServiceContainer
  ) {}

  private setupMessageHandlers() {
    this.rpcRouter.register('sendMessage', (payload) => {
      this.services.getCopilotService().sendPrompt(payload.text);
    });
    
    this.rpcRouter.register('switchSession', (payload) => {
      this.services.getSessionService().setActiveSession(payload.sessionId);
    });
  }
}
```

## Non-Goals
- ❌ Do NOT add new features
- ❌ Do NOT change message contracts (already done in Phase 2)
- ❌ Do NOT refactor webview UI (that's Phase 4)
- ❌ Do NOT implement MCP yet (that's Phase 5)

## Validation Checklist

### Service Quality
- [ ] Each service has single, clear responsibility
- [ ] Services are independently testable
- [ ] No circular dependencies between services
- [ ] Services use dependency injection
- [ ] Service interfaces are well-defined

### Functionality
- [ ] All existing features work unchanged
- [ ] Session management works
- [ ] Copilot SDK interaction works
- [ ] CLI server mode works (if applicable)
- [ ] Plan mode works
- [ ] Tool permissions work

### Code Quality
- [ ] No duplicate logic across services
- [ ] Clear separation of concerns
- [ ] Easy to mock services for testing
- [ ] Extension.ts is under 200 lines
- [ ] ChatViewProvider.ts is under 300 lines

### Testing
- [ ] Unit tests for each service
- [ ] Integration tests for service interactions
- [ ] All existing tests still pass
- [ ] Can mock services in tests

## Dependencies
- Requires Phase 2 (RPC layer) to be complete

## Risks & Mitigations

**Risk**: Circular dependencies between services
**Mitigation**: Design service boundaries carefully, use events for decoupling

**Risk**: Over-abstraction makes code harder to follow
**Mitigation**: Keep services concrete, avoid deep inheritance

**Risk**: Service initialization order matters
**Mitigation**: Use dependency injection container, explicit initialization

**Risk**: Breaking existing functionality during refactor
**Mitigation**: Extract one service at a time, test thoroughly

## Notes
- This is the "big cleanup" phase
- Focus on single responsibility principle
- Services should be boring and predictable
- Don't over-engineer - simple classes are fine
- Goal is testability and clarity

## Success Criteria
✅ Clear service-based architecture
✅ Each service has single responsibility  
✅ Services are independently testable
✅ No circular dependencies
✅ Extension.ts is clean and minimal
✅ ChatViewProvider.ts is webview-only
✅ All functionality works unchanged
✅ Comprehensive service tests
