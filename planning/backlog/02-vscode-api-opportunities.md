# VSCode API Opportunities for 3.0

**Date:** 2026-02-12
**Current Engine:** `"vscode": "^1.108.1"`
**Target Engine:** `"vscode": "^1.109.0"` (for proposed API access)

---

## API Maturity Landscape

### Finalized (Stable) — Available Now

| API | Since | Relevance to Copilot CLI |
|-----|-------|--------------------------|
| Chat Participant API (`vscode.chat`) | mid-2024 | HIGH — could register as `@copilot-cli` |
| Language Model API (`vscode.lm`) | mid-2024 | MEDIUM — direct model access for auxiliary features |
| Language Model Tool API (`vscode.lm.tools`) | mid-2024 | MEDIUM — expose CLI capabilities as composable tools |
| Chat Provider API (`vscode.lm.registerLanguageModelChatProvider`) | v1.104 | LOW — only if wrapping CLI as a model provider |

### Proposed (Unstable) — Requires `enabledApiProposals`

| API | Proposal File | Relevance |
|-----|---------------|-----------|
| Chat Output Renderer | `chatOutputRenderer` | **HIGH** — custom rendering in chat bubbles |
| Chat Prompt Files | `chatPromptFiles` | MEDIUM — dynamic skills/agents |
| Chat Session Item Controller | `chatSessionsProvider` | **HIGH** — native session management UI |
| LM Configuration | `lmConfiguration` | LOW — only for model provider config |

---

## Recommendation 1: Register as Chat Participant (Finalized API)

**What:** Register `@copilot-cli` as a native chat participant in VS Code's built-in chat panel.

**Why:** This gives you native markdown rendering, follow-ups, feedback tracking, `disambiguation` auto-routing, and the streaming `ChatResponseStream` — which handles scroll management for free.

**How it works with your current architecture:**

```typescript
// package.json contribution
"chatParticipants": [{
    "id": "copilot-cli.chat",
    "name": "copilot-cli",
    "fullName": "Copilot CLI",
    "description": "Interactive Copilot CLI chat",
    "isSticky": true,
    "commands": [
        { "name": "plan", "description": "Enter plan mode" },
        { "name": "session", "description": "Manage sessions" }
    ]
}]

// Handler bridges to existing SDKSessionManager
const handler: vscode.ChatRequestHandler = async (request, context, stream, token) => {
    stream.progress('Sending to Copilot CLI...');

    // Bridge: send through your existing SDK session
    await sdkSessionManager.sendMessage(request.prompt);

    // Stream responses as they arrive from SDK
    for await (const chunk of sdkSessionManager.streamOutput()) {
        stream.markdown(chunk);
    }

    return { metadata: { sessionId: currentSessionId } };
};
```

**Trade-off:** This is a _parallel_ approach alongside the custom webview. You could offer both:
- Native chat panel (via Chat Participant) for quick interactions
- Custom sidebar view (via WebviewViewProvider) for the full-featured experience

**Stream methods available:**
- `stream.markdown(text)` — primary content
- `stream.progress(text)` — spinner with message
- `stream.button({command, title})` — inline clickable button
- `stream.reference(uri)` — file reference link
- `stream.filetree(nodes, baseUri)` — file tree widget

**Scrolling:** Completely handled by VS Code. No ResizeObserver needed. No manual scroll detection.

---

## Recommendation 2: Adopt Chat Output Renderer (Proposed API)

**What:** Register custom interactive widgets that render inside VS Code's chat response bubbles.

**Why:** This solves the hardest rendering problems in your custom webview — rich content like diffs, tool execution visualizations, and diagrams could render natively in the chat panel.

**Architecture pattern from the sample:**

1. **Tool produces data with custom MIME type:**
```typescript
const result = new vscode.LanguageModelToolResult([
    new vscode.LanguageModelTextPart(sourceCode)
]);
(result as ExtendedLanguageModelToolResult2).toolResultDetails2 = {
    mime: 'application/vnd.copilot-cli.tool-output',
    value: new TextEncoder().encode(JSON.stringify(toolState)),
};
```

2. **package.json maps MIME to renderer:**
```json
"chatOutputRenderers": [{
    "viewType": "copilot-cli.toolRenderer",
    "mimeTypes": ["application/vnd.copilot-cli.tool-output"]
}]
```

3. **Renderer creates a webview inside the chat bubble:**
```typescript
vscode.chat.registerChatOutputRenderer('copilot-cli.toolRenderer', {
    async renderChatOutput({ value }, chatOutputWebview, ctx, token) {
        const toolState = JSON.parse(new TextDecoder().decode(value));
        chatOutputWebview.webview.html = buildToolExecutionHtml(toolState);
    }
});
```

**What it CAN render:** Collapsible tool groups, diff buttons, progress indicators, interactive SVGs — all the things currently in your ToolExecution component.

**What it CANNOT do:** Control the outer chat scroll position. But that doesn't matter because VS Code's chat panel handles outer scrolling natively.

**Key update (January 2026):** Renderers now receive `ChatOutputWebview` (not raw `Webview`), enabling disposal monitoring. This was a gap in the previous iteration.

---

## Recommendation 3: Adopt Chat Session Item Controller (Proposed API)

**What:** Integrate your session management with VS Code's native chat sessions view.

**Why:** Your SessionToolbar component (custom dropdown) could be replaced or complemented by native VS Code session management. Users get a unified place to browse, resume, and archive sessions.

**How it maps to your current architecture:**

```typescript
const controller = vscode.chat.createChatSessionItemController(
    'copilot-cli.sessions',
    async (token) => {
        // Pull from your existing BackendState / session utils
        const sessions = await getSessionsList();
        const items = sessions.map(s =>
            controller.createChatSessionItem(
                vscode.Uri.parse(`copilot-cli://session/${s.id}`),
                s.title
            )
        );
        controller.items.replace(items);
    }
);

// Push-based updates (matches your event architecture)
controller.onDidChangeChatSessionItemState(item => {
    if (item.archived) {
        // Handle session archival
    }
});
```

**Properties available per session:** label, description, badge, status (Failed/Completed/InProgress/NeedsInput), tooltip, archived, timing, changes, metadata.

---

## Recommendation 4: Register CLI Tools as Language Model Tools (Finalized API)

**What:** Expose Copilot CLI capabilities as composable tools that any chat participant can invoke.

**Why:** Makes your extension's capabilities discoverable and composable. When a user asks "@workspace" about something, VS Code could route to your tools automatically.

**Example tools to register:**

```json
"languageModelTools": [
    {
        "name": "copilot_cli_execute",
        "displayName": "Execute Copilot CLI Command",
        "modelDescription": "Execute a command through the Copilot CLI session",
        "canBeReferencedInPrompt": true,
        "inputSchema": {
            "type": "object",
            "properties": {
                "command": { "type": "string" }
            }
        }
    },
    {
        "name": "copilot_cli_plan",
        "displayName": "Create Implementation Plan",
        "modelDescription": "Create a plan using Copilot CLI's plan mode",
        "canBeReferencedInPrompt": true,
        "inputSchema": {
            "type": "object",
            "properties": {
                "description": { "type": "string" }
            }
        }
    }
]
```

---

## Recommendation 5: Chat Prompt Files for Dynamic Skills (Proposed API)

**What:** Dynamically contribute skills and instructions based on workspace context.

**Why:** Could auto-generate context-aware prompt resources encapsulating current CLI configuration.

```typescript
vscode.chat.registerSkillProvider({
    onDidChangeSkills: skillChangeEvent,
    provideSkills(context, token): ChatResource[] {
        return [
            { uri: vscode.Uri.parse('copilot-cli:/skills/workspace-context/SKILL.md') }
        ];
    }
});
```

**Priority:** Low for 3.0. This becomes more valuable after the core Chat Participant integration is stable.

---

## Adoption Strategy

### Phase A: Sidebar View (No API change needed)
Convert from `WebviewPanel` to `WebviewViewProvider`. Already planned in `sidebar-view-refactor.md`.

### Phase B: Chat Participant (Finalized API)
Register as `@copilot-cli` participant. Offer as parallel entry point alongside sidebar.
- Gives free scrolling management
- Gives native markdown rendering
- Gives follow-ups, feedback, disambiguation

### Phase C: Chat Output Renderer (Proposed API)
Register custom renderers for tool execution, diffs, plan mode visualizations.
- Requires engine bump to `^1.109.0`
- Requires `enabledApiProposals: ["chatOutputRenderer"]`
- Development builds only until API stabilizes

### Phase D: Session Controller (Proposed API)
Replace custom SessionToolbar with native session management.
- Complements Phase B
- Push-based model aligns with event architecture

---

## Samples Reference

| Sample | Location | Key Patterns |
|--------|----------|-------------|
| chat-tutorial | `research/vscode-extension-samples/chat-tutorial/` | Minimal participant, streaming loop |
| chat-sample | `research/vscode-extension-samples/chat-sample/` | Multi-approach, tool loop, prompt-tsx |
| chat-context-sample | `research/vscode-extension-samples/chat-context-sample/` | Custom context providers |
| chat-model-provider-sample | `research/vscode-extension-samples/chat-model-provider-sample/` | Custom model backend |
| chat-output-renderer-sample | `research/vscode-extension-samples/chat-output-renderer-sample/` | Webview rendering in chat bubbles |

The `chat-sample` demonstrates three tiers of complexity:
1. **Minimal** (~50 lines): Direct handler + `stream.markdown()`
2. **Simplified tools** (~10 lines): `@vscode/chat-extension-utils` abstracts everything
3. **Full control** (~130 lines + TSX): Manual tool loop with `@vscode/prompt-tsx`

For bridging to your existing SDK, Tier 3 gives the most control. Tier 2 would work if you refactor the SDK interaction to match the chat-extension-utils expectations.
