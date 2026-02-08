# Phase 4: Componentize Webview UI

## Status
⏸️ Not Started

## Goal
Break monolithic webview JavaScript into reusable, testable components

## Context
After Phase 1, the webview code is in separate files, but it's still one monolithic `main.js` file with all UI logic mixed together.

This phase decomposes the UI into focused components:
- Chat message display
- Input area
- Session selector
- Plan mode UI
- Diff viewer

## Tasks

### Component Architecture
- [ ] Create `src/webview/app/components/` directory
- [ ] Create `src/webview/app/state/` directory
- [ ] Choose component pattern (Web Components, vanilla modules, or functions)
- [ ] Design state management approach

### Component Extraction
- [ ] Extract `Chat/` component - message list and rendering
- [ ] Extract `InputArea/` component - message input and send
- [ ] Extract `Toolbar/` component - session selector and controls
- [ ] Extract `SessionSelector/` component - session dropdown
- [ ] Extract `PlanMode/` component - plan mode UI
- [ ] Extract `Diff/` component - inline diff display (if applicable)

### State Management
- [ ] Create centralized state manager
- [ ] Define state shape and updates
- [ ] Implement pub/sub or similar pattern
- [ ] Connect components to state

### Refactoring
- [ ] Refactor `main.js` to compose components
- [ ] Remove duplicate rendering logic
- [ ] Simplify event handlers
- [ ] Test each component in isolation

### Optional: TypeScript Migration
- [ ] Convert `main.js` → `main.ts`
- [ ] Add types to component props
- [ ] Set up TypeScript compilation for webview
- [ ] Configure source maps for debugging

## Technical Details

### Component Architecture

```
App (main.ts)
├── Toolbar
│   ├── SessionSelector
│   └── NewSessionButton
├── Chat
│   ├── MessageList
│   │   └── MessageItem
│   │       └── MarkdownRenderer
│   └── StreamingIndicator
├── PlanMode (conditional)
│   ├── PlanViewer
│   └── PlanActions (Accept/Reject)
└── InputArea
    ├── MessageInput (textarea)
    ├── SubmitButton
    └── AbortButton
```

### Component Pattern Options

#### Option A: Vanilla JS Functions (Simplest)
```javascript
// src/webview/app/components/Chat/Chat.js

export function createChat(container, state) {
  const chatDiv = document.createElement('div');
  chatDiv.className = 'chat-container';
  
  function render() {
    chatDiv.innerHTML = '';
    state.messages.forEach(msg => {
      chatDiv.appendChild(createMessageItem(msg));
    });
  }
  
  // Subscribe to state changes
  state.on('messages:update', render);
  
  render();
  container.appendChild(chatDiv);
  
  return {
    destroy() {
      state.off('messages:update', render);
    }
  };
}
```

#### Option B: Web Components (More Structured)
```javascript
// src/webview/app/components/Chat/Chat.js

class ChatComponent extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this.subscribeToState();
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>${chatStyles}</style>
      <div class="chat-container">
        ${this.messages.map(renderMessage).join('')}
      </div>
    `;
  }
}

customElements.define('chat-component', ChatComponent);
```

#### Option C: Lightweight Library (Zustand, Nanostores)
```javascript
// Using Zustand-like pattern
import { create } from './state/createStore';

const useStore = create((set) => ({
  messages: [],
  addMessage: (msg) => set((state) => ({ 
    messages: [...state.messages, msg] 
  })),
}));

export function Chat() {
  const messages = useStore((state) => state.messages);
  // ... render logic
}
```

**Recommendation**: Start with **Option A** (vanilla functions) - it's the simplest and requires no dependencies. Migrate to Option B or C only if complexity grows.

### State Management

```javascript
// src/webview/app/state/AppState.js

class AppState {
  constructor() {
    this.state = {
      messages: [],
      sessions: [],
      activeSessionId: null,
      planModeEnabled: false,
      planContent: null,
      isStreaming: false,
    };
    
    this.listeners = new Map();
  }

  get(key) {
    return this.state[key];
  }

  set(key, value) {
    this.state[key] = value;
    this.notify(key);
  }

  update(updates) {
    Object.assign(this.state, updates);
    Object.keys(updates).forEach(key => this.notify(key));
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  off(event, callback) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  notify(event) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(cb => cb(this.state[event]));
    }
  }
}

export const appState = new AppState();
```

### Component Example: Chat

```javascript
// src/webview/app/components/Chat/Chat.js

import { appState } from '../../state/AppState.js';
import { renderMarkdown } from '../Markdown/Markdown.js';

export function createChat(container) {
  const chatDiv = document.createElement('div');
  chatDiv.className = 'chat-container';
  chatDiv.id = 'messages';

  function renderMessages() {
    const messages = appState.get('messages');
    chatDiv.innerHTML = messages.map(msg => `
      <div class="message ${msg.role}">
        <div class="message-role">${msg.role}</div>
        <div class="message-content">
          ${renderMarkdown(msg.content)}
        </div>
      </div>
    `).join('');
    
    // Scroll to bottom
    chatDiv.scrollTop = chatDiv.scrollHeight;
  }

  // Subscribe to state changes
  appState.on('messages', renderMessages);

  // Initial render
  renderMessages();

  container.appendChild(chatDiv);

  return {
    destroy() {
      appState.off('messages', renderMessages);
      container.removeChild(chatDiv);
    }
  };
}
```

### Component Example: InputArea

```javascript
// src/webview/app/components/InputArea/InputArea.js

import { appState } from '../../state/AppState.js';
import { rpcClient } from '../../rpc/WebviewRpcClient.js';

export function createInputArea(container) {
  const inputArea = document.createElement('div');
  inputArea.className = 'input-area';
  
  inputArea.innerHTML = `
    <textarea id="message-input" placeholder="Type your message..."></textarea>
    <button id="send-button">Send</button>
    <button id="abort-button" style="display: none;">Abort</button>
  `;

  const textarea = inputArea.querySelector('#message-input');
  const sendButton = inputArea.querySelector('#send-button');
  const abortButton = inputArea.querySelector('#abort-button');

  sendButton.addEventListener('click', () => {
    const text = textarea.value.trim();
    if (text) {
      rpcClient.sendMessage(text);
      textarea.value = '';
    }
  });

  abortButton.addEventListener('click', () => {
    rpcClient.abortMessage();
  });

  // Update UI based on streaming state
  appState.on('isStreaming', (isStreaming) => {
    sendButton.style.display = isStreaming ? 'none' : 'inline-block';
    abortButton.style.display = isStreaming ? 'inline-block' : 'none';
    textarea.disabled = isStreaming;
  });

  container.appendChild(inputArea);

  return {
    destroy() {
      container.removeChild(inputArea);
    }
  };
}
```

### Main App Composition

```javascript
// src/webview/main.js (after refactoring)

import { appState } from './app/state/AppState.js';
import { rpcClient } from './app/rpc/WebviewRpcClient.js';
import { createToolbar } from './app/components/Toolbar/Toolbar.js';
import { createChat } from './app/components/Chat/Chat.js';
import { createInputArea } from './app/components/InputArea/InputArea.js';
import { createPlanMode } from './app/components/PlanMode/PlanMode.js';

// Initialize RPC client
rpcClient.init();

// Handle incoming messages from extension
rpcClient.onMessage((message) => {
  switch (message.type) {
    case 'init':
      appState.update({
        messages: message.messages,
        sessions: message.sessions,
        activeSessionId: message.activeSessionId,
      });
      break;
    case 'addMessage':
      const messages = appState.get('messages');
      appState.set('messages', [...messages, message.message]);
      break;
    case 'streamChunk':
      // Handle streaming...
      break;
    // ... other cases
  }
});

// Mount components
const appContainer = document.getElementById('app');

createToolbar(appContainer);
createChat(appContainer);
createInputArea(appContainer);

// Conditionally mount plan mode
appState.on('planModeEnabled', (enabled) => {
  if (enabled) {
    createPlanMode(appContainer);
  } else {
    // Remove plan mode component
  }
});

// Signal ready
rpcClient.ready();
```

## Non-Goals
- ❌ Do NOT add new features
- ❌ Do NOT change backend services (already done in Phase 3)
- ❌ Do NOT add MCP UI yet (that's Phase 5)
- ❌ Do NOT add fancy UI frameworks (React, Vue, etc.)
- ❌ Do NOT do sidebar refactor before componentization (see section 4.5 below)

---

## 4.5: WebviewPanel → WebviewViewProvider Migration

**Goal**: Enable sidebar and secondary sidebar support

**Why During This Phase**: Component-based UI makes responsive sidebar layout significantly easier to implement. Doing the sidebar refactor before componentization would mean rewriting the UI twice.

### Integration With Componentization

The sidebar migration should happen **AFTER** the component extraction above is complete, because:

1. **Responsive CSS is cleaner** with component-based structure
2. **State management** already handles view lifecycle properly (hide/show)
3. **RPC layer** provides clean separation (backend doesn't care about view type)
4. **Component testing** ensures everything works before changing view type
5. **Avoids double refactoring** (panel UI → component UI → sidebar UI)

### Tasks

- [ ] **Review specifications**: Read `../backlog/sidebar-view-refactor.md` for complete details
- [ ] **Update package.json**: Add viewsContainers and views contributions
  ```json
  "viewsContainers": {
    "activitybar": [{
      "id": "copilot-cli-sidebar",
      "title": "Copilot CLI",
      "icon": "images/sidebar-icon.svg"
    }]
  },
  "views": {
    "copilot-cli-sidebar": [{
      "type": "webview",
      "id": "copilot-cli.chatView",
      "name": "Chat"
    }]
  }
  ```
- [ ] **Refactor ChatViewProvider**: Implement `WebviewViewProvider` interface
  - Change from `createWebviewPanel()` to `registerWebviewViewProvider()`
  - Update lifecycle from `createOrShow()` to `resolveWebviewView()`
  - Change property from `panel` to `view`
- [ ] **Responsive CSS**: Adjust component styles for sidebar widths (200px - 400px)
  - Chat component adapts to narrow width
  - Input area stacks properly
  - Toolbar fits in sidebar
  - Test at multiple widths
- [ ] **Update commands**: Change `openChat` to reveal sidebar view instead of creating panel
- [ ] **Test view lifecycle**: Ensure state persists across view hide/show
- [ ] **Critical test**: **Verify drag to secondary sidebar works!** ✨

### CSS Considerations

With component-based CSS, sidebar width adaptation becomes easier:

```css
/* Chat.css - Example responsive adjustments */
.chat-container {
  /* Already works, but might need tweaks for narrow widths */
  min-width: 200px; /* Sidebar minimum */
  max-width: 100%; /* Fills sidebar width */
}

/* InputArea.css - Stack buttons on narrow widths */
@media (max-width: 300px) {
  .input-area {
    flex-direction: column;
  }
}

/* Toolbar.css - Responsive session selector */
.session-selector {
  width: 100%; /* Fill available width */
  max-width: 350px; /* Cap for wide sidebars */
}
```

### Success Criteria

- [ ] Extension appears in activity bar with custom icon
- [ ] Chat view opens in primary sidebar by default
- [ ] **Users can drag chat view to secondary sidebar** 🎉
- [ ] Responsive CSS works smoothly at all sidebar widths (200px - 400px)
- [ ] All existing features work identically in sidebar view
- [ ] State persists when sidebar is hidden/shown
- [ ] No visual regressions compared to panel view

### References

- **Detailed specifications**: `../backlog/sidebar-view-refactor.md`
- **VS Code API**: [WebviewViewProvider](https://code.visualstudio.com/api/references/vscode-api#WebviewViewProvider)
- **UX Guidelines**: [Sidebars](https://code.visualstudio.com/api/ux-guidelines/sidebars)
- **Example**: [webview-view-sample](https://github.com/microsoft/vscode-extension-samples/tree/main/webview-view-sample)

---

## Validation Checklist

### Component Quality
- [ ] Each component has single responsibility
- [ ] Components are independently testable
- [ ] Components are reusable
- [ ] No duplicate rendering logic
- [ ] Clear component interfaces

### Functionality
- [ ] All UI features work unchanged
- [ ] Messages render correctly
- [ ] Input area works
- [ ] Session selector works
- [ ] Plan mode UI works
- [ ] No visual regressions

### Code Quality
- [ ] Main.js is under 200 lines (just composition)
- [ ] Each component is under 150 lines
- [ ] Clear state management
- [ ] No tight coupling between components
- [ ] Easy to add new components

### Performance
- [ ] Rendering is as fast or faster than before
- [ ] No unnecessary re-renders
- [ ] Large message lists perform well
- [ ] No memory leaks

## Dependencies
- Requires Phase 3 (services) to be complete
- Requires Phase 2 (RPC layer) for typed communication

## Risks & Mitigations

**Risk**: Component pattern is too complex
**Mitigation**: Start with simplest approach (vanilla functions), iterate

**Risk**: State management becomes messy
**Mitigation**: Use simple pub/sub pattern, avoid over-engineering

**Risk**: Visual regressions during refactor
**Mitigation**: Take screenshots before/after, test in multiple themes

**Risk**: Performance degradation
**Mitigation**: Profile before/after, optimize bottlenecks

## Notes
- This phase is mostly about code organization
- Keep it simple - vanilla JS is fine
- TypeScript migration is optional (nice-to-have)
- Focus on maintainability over cleverness

## Success Criteria
✅ Component-based architecture in place
✅ Each component is focused and testable
✅ Clean state management
✅ Main.js is just component composition
✅ No visual or functional regressions
✅ Better developer experience for UI changes
✅ Easy to add new UI components
✅ **Sidebar view migration complete** (extension in activity bar, draggable to secondary sidebar)
