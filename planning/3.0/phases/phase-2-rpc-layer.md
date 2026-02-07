# Phase 2: Create Typed RPC Layer

## Status
⏸️ Not Started

## Goal
Establish type-safe messaging between extension and webview using a formal RPC layer

## Context
Currently, messages between the extension and webview use untyped `postMessage` calls with string-based command names. This is error-prone and lacks IDE support.

This phase creates a typed RPC layer with:
- Formal message contracts in shared types
- Type-safe client (webview) and router (extension)
- Full TypeScript autocomplete and type checking
- Runtime validation of messages

## Tasks

### Shared Type Definitions
- [ ] Create `src/shared/` directory
- [ ] Create `src/shared/messages.ts` - message type definitions
- [ ] Create `src/shared/models.ts` - domain models
- [ ] Create `src/shared/types.ts` - shared utility types
- [ ] Define all existing message types

### RPC Infrastructure
- [ ] Create `src/webview/app/rpc/` directory
- [ ] Create `src/extension/rpc/` directory
- [ ] Create `WebviewRpcClient.ts` - webview-side RPC client
- [ ] Create `ExtensionRpcRouter.ts` - extension-side RPC router

### Migration
- [ ] Migrate webview → extension messages to typed RPC
- [ ] Migrate extension → webview messages to typed RPC
- [ ] Update all message handlers to use typed contracts
- [ ] Remove old untyped message handling
- [ ] Test all message flows

### Optional Enhancements
- [ ] Add runtime validation with zod or io-ts
- [ ] Add message logging/debugging support
- [ ] Add request/response correlation for async operations

## Technical Details

### Current Message Types

**Webview → Extension**:
- `sendMessage` - Send user message to agent
- `abortMessage` - Abort current agent stream
- `ready` - Webview initialized
- `switchSession` - Change active session
- `newSession` - Create new session
- `viewPlan` - Open plan file in editor
- `viewDiff` - Show diff view
- `togglePlanMode` - Toggle plan mode on/off
- `acceptPlan` - User accepted plan
- `rejectPlan` - User rejected plan

**Extension → Webview**:
- `init` - Initialize webview with state
- `addMessage` - Add complete message to chat
- `streamChunk` - Stream partial message content
- `streamEnd` - Stream completed
- `clearMessages` - Clear all messages
- `setSessionActive` - Update active session
- `updateSessions` - Update session list
- `enablePlanMode` - Enable plan mode
- `disablePlanMode` - Disable plan mode
- `presentPlan` - Show plan for review
- `planAccepted` - Plan was accepted
- `planRejected` - Plan was rejected

### Message Type Structure

```typescript
// src/shared/messages.ts

// Base message types
export interface BaseMessage {
  type: string;
  timestamp?: number;
}

export interface WebviewMessage extends BaseMessage {
  type: WebviewMessageType;
}

export interface ExtensionMessage extends BaseMessage {
  type: ExtensionMessageType;
}

// Webview → Extension
export type WebviewMessageType =
  | 'sendMessage'
  | 'abortMessage'
  | 'ready'
  | 'switchSession'
  | 'newSession'
  | 'viewPlan'
  | 'viewDiff'
  | 'togglePlanMode'
  | 'acceptPlan'
  | 'rejectPlan';

// Specific message payloads
export interface SendMessagePayload {
  type: 'sendMessage';
  text: string;
}

export interface SwitchSessionPayload {
  type: 'switchSession';
  sessionId: string;
}

// Extension → Webview
export type ExtensionMessageType =
  | 'init'
  | 'addMessage'
  | 'streamChunk'
  | 'streamEnd'
  | 'clearMessages'
  | 'setSessionActive'
  | 'updateSessions'
  | 'enablePlanMode'
  | 'disablePlanMode'
  | 'presentPlan'
  | 'planAccepted'
  | 'planRejected';

// ... more specific payload types
```

### RPC Client (Webview)

```typescript
// src/webview/app/rpc/WebviewRpcClient.ts

export class WebviewRpcClient {
  private vscode: any;

  constructor() {
    this.vscode = acquireVsCodeApi();
  }

  // Type-safe send methods
  sendMessage(text: string): void {
    this.send({ type: 'sendMessage', text });
  }

  switchSession(sessionId: string): void {
    this.send({ type: 'switchSession', sessionId });
  }

  private send(message: WebviewMessage): void {
    this.vscode.postMessage(message);
  }

  // Type-safe receive handler
  onMessage(handler: (message: ExtensionMessage) => void): void {
    window.addEventListener('message', (event) => {
      handler(event.data);
    });
  }
}
```

### RPC Router (Extension)

```typescript
// src/extension/rpc/ExtensionRpcRouter.ts

export class ExtensionRpcRouter {
  private handlers = new Map<string, (payload: any) => void>();

  register<T extends WebviewMessage>(
    type: T['type'],
    handler: (payload: T) => void
  ): void {
    this.handlers.set(type, handler);
  }

  route(message: WebviewMessage): void {
    const handler = this.handlers.get(message.type);
    if (handler) {
      handler(message);
    } else {
      console.warn(`No handler for message type: ${message.type}`);
    }
  }

  // Type-safe send methods
  sendToWebview(webview: vscode.Webview, message: ExtensionMessage): void {
    webview.postMessage(message);
  }
}
```

## Non-Goals
- ❌ Do NOT add new features
- ❌ Do NOT change business logic
- ❌ Do NOT refactor services yet (that's Phase 3)
- ❌ Do NOT change UI components (that's Phase 4)

## Validation Checklist

### Type Safety
- [ ] All messages have TypeScript types
- [ ] No `any` types in message handling
- [ ] Full autocomplete in IDE for message types
- [ ] Compilation fails if message types are wrong

### Functionality
- [ ] All webview → extension messages work
- [ ] All extension → webview messages work
- [ ] Message payloads are correctly typed
- [ ] No runtime type errors

### Developer Experience
- [ ] Easy to add new message types
- [ ] Clear error messages for invalid messages
- [ ] Self-documenting message contracts
- [ ] Refactoring is safe (rename, etc.)

## Dependencies
- Requires Phase 1 (external HTML/JS files) to be complete

## Risks & Mitigations

**Risk**: Migration breaks existing message flows
**Mitigation**: Test each message type individually, keep old code until verified

**Risk**: Type definitions are too complex
**Mitigation**: Start simple, add complexity only when needed

**Risk**: Runtime validation adds overhead
**Mitigation**: Make validation optional, use only in development

## Notes
- This phase is pure infrastructure - no user-visible changes
- Focus on type safety and developer experience
- Don't over-engineer - simple is better
- Runtime validation is optional (nice-to-have)

## Success Criteria
✅ All messages have TypeScript type definitions
✅ Type-safe RPC client and router in place
✅ No `postMessage` calls with untyped data
✅ Full IDE support (autocomplete, type checking)
✅ All existing functionality works unchanged
✅ Easy to add new message types
