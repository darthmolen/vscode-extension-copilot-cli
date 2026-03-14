# Phase 6b — Streaming Rendering

## Problem Statement

The extension renders assistant messages atomically: full `assistant.message` → `marked.parse()` → DOM insert. Users see nothing until the response is complete.

SDK 0.1.32 with `streaming: true` produces `assistant.message_delta` events. Different models behave differently:
- **GPT models**: Many small word/token-level deltas → genuine streaming
- **Claude**: 1 delta = full response (52ms before `assistant.message`) → no meaningful progression
- **Tool-call turns**: No deltas at all → unchanged

## Approach: Hybrid Renderer

**GPT path (deltaCount ≥ 2)**: Progressive paragraph-complete rendering. A streaming state machine flushes safe markdown units as they complete (paragraphs, headings, code fences, images, tables, mermaid).

**Claude path (deltaCount = 1)**: Bubble starts hidden (`opacity: 0`). On `assistant.message`: full `marked.parse()` → CSS fade-in. Claude users see zero flash, identical feel to today but with a smooth appearance.

**Tool-call / no-delta path**: Normal atomic render, unchanged.

**Key UX rule**: The streaming bubble is invisible (`opacity: 0`) until `deltaCount >= 2`. This means Claude users never see the bubble at all — the crossfade is just a fade-in on the final render.

### messageId Matching ✅ RESOLVED (from spike-01-output.txt)

`assistant.message` includes `data.messageId` exactly matching the delta `messageId` for both GPT and Claude. Tool-call messages use a different `messageId` from the subsequent text message — clean ID-based separation requires no heuristics.

### Progressive Rendering State Machine

| Construct | Buffer until | Render as |
|-----------|-------------|-----------|
| Prose paragraph | `\n\n` | `marked.parse(para)` |
| Heading `# ` | `\n` | `marked.parse(line)` |
| Code block ` ``` ` | closing ` ``` ` | `<pre><code>` via `marked.parse()` |
| Image `![` | closing `)` | `<img>` via `marked.parse()` |
| Table `\|` | blank line after last `\|` | `<table>` via `marked.parse()` |
| Mermaid block | closing ` ``` ` | `_renderMermaidBlocks()` |
| SVG block | closing ` ``` ` | `_renderSvgBlocks()` |

On final `assistant.message`: flush remaining buffer + run `_renderSvgBlocks()` + `_renderMermaidBlocks()` over entire bubble.

---

## Execution Order (TDD — Tests Always First)

### Step 1 — Write failing backend tests (RED)

**File**: `tests/unit/extension/streaming-backend.test.js`  
Pattern: source-code scan (like `sdk-upgrade-0132.test.js`). CJS `require`, reads source file as string.

Tests must FAIL before any code is written:

- `streaming: true` present in `createSessionWithModelFallback` config
- `_onDidMessageDelta` BufferedEmitter declared in `SDKSessionManager`
- `onDidMessageDelta` public event exposed
- `case 'assistant.message_delta':` fires `_onDidMessageDelta` with `messageId` + `deltaContent`
- `_onDidReceiveOutput` fires `{ content, messageId }` (not bare string)
- `AssistantMessagePayload` has `messageId` field in `shared/messages.ts`
- `sendMessageDelta(messageId, deltaContent)` method exists in `ExtensionRpcRouter.ts`
- `chatViewProvider.ts` has `public sendMessageDelta(messageId, deltaContent)` proxy

**Verify each test FAILS with "AssertionError: Expected X to be present".**

---

### Step 2 — Write failing webview component tests (RED)

**File**: `tests/unit/components/message-display-streaming.test.js`  
Pattern: JSDOM + `createComponentDOM()` + import actual `MessageDisplay.js` (like `message-display-task-complete.test.js`). CJS `require`.

**Group A — Regression (must PASS immediately, before any implementation)**
```javascript
it('addMessage() with no streaming bubble still renders as today', () => {
    // emit message:add with role:'assistant', no prior message:delta
    // verify .message-display__item--assistant exists with rendered content
});
it('tool-call message (empty content) renders without error', () => {
    eventBus.emit('message:add', { role: 'assistant', content: '', messageId: 'abc' });
    // no crash
});
```

**Group B — Bubble lifecycle (must FAIL before implementation)**
```javascript
it('first delta creates streaming bubble in DOM immediately', () => {
    eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: 'Hello' });
    const bubble = messageDisplay.messagesContainer.querySelector('.message-display__item--assistant');
    assert.ok(bubble, 'streaming bubble must exist in DOM after first delta');
});
it('streaming bubble starts with opacity 0 (hidden until deltaCount >= 2)', () => {
    eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: 'Hello' });
    const bubble = messageDisplay.messagesContainer.querySelector('.message-display__item--assistant');
    assert.strictEqual(bubble.style.opacity, '0');
});
it('bubble becomes visible after second delta', () => {
    eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: 'Hello' });
    eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: ' world' });
    const bubble = messageDisplay.messagesContainer.querySelector('.message-display__item--assistant');
    assert.notStrictEqual(bubble.style.opacity, '0');
});
```

**Group C — GPT progressive rendering (must FAIL)**
```javascript
it('completed paragraph is rendered as HTML before response ends', () => {
    eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: 'First paragraph' });
    eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: '\n\nSecond' });
    const bubble = messageDisplay.streamingBubbles.get('msg-1');
    // first paragraph should be in renderedContent, not just raw buffer
    assert.ok(bubble.contentEl.innerHTML.includes('<p>'), 'paragraph must be rendered as HTML');
});
it('code fence buffers until closing ``` before rendering', () => {
    const deltas = ['```js\n', 'const x = 1;\n', '```\n'];
    deltas.forEach((d, i) =>
        eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: d })
    );
    const bubble = messageDisplay.streamingBubbles.get('msg-1');
    // raw ``` should not appear in innerHTML; rendered <pre> should exist after last delta
    assert.ok(bubble.contentEl.innerHTML.includes('<pre>'), 'code fence must render as <pre>');
});
it('image syntax buffers until ) then renders as <img>', () => {
    eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: '![alt' });
    eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: '](https://example.com/img.png)' });
    const bubble = messageDisplay.streamingBubbles.get('msg-1');
    assert.ok(bubble.contentEl.innerHTML.includes('<img'), '<img> must exist after image syntax completes');
});
```

**Group D — Finalization (must FAIL)**
```javascript
it('GPT: final message:add flushes remaining buffer and runs post-processing', () => {
    eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: 'Hello ' });
    eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: 'world' });
    eventBus.emit('message:add', { role: 'assistant', content: 'Hello world', messageId: 'msg-1' });
    const bubble = messageDisplay.messagesContainer.querySelector('.message-display__item--assistant');
    assert.ok(bubble, 'finalized bubble must exist');
    assert.ok(!messageDisplay.streamingBubbles.has('msg-1'), 'bubble must be removed from map after finalize');
});
it('Claude: single delta + message:add does CSS fade-in (no flash)', () => {
    // delta count = 1, bubble was opacity:0 → finalize should fade in
    eventBus.emit('message:delta', { messageId: 'msg-claude', deltaContent: 'Hello streaming world.' });
    eventBus.emit('message:add', { role: 'assistant', content: 'Hello streaming world.', messageId: 'msg-claude' });
    const bubble = messageDisplay.messagesContainer.querySelector('.message-display__item--assistant');
    // bubble should exist and NOT have opacity:0 (fade-in completed or in progress)
    assert.ok(bubble);
    assert.notStrictEqual(bubble.style.opacity, '0');
});
it('tool-call: message:add with no prior delta renders normally as today', () => {
    eventBus.emit('message:add', { role: 'assistant', content: '**bold**', messageId: 'msg-tool' });
    const bubble = messageDisplay.messagesContainer.querySelector('.message-display__item--assistant');
    assert.ok(bubble);
    assert.ok(!messageDisplay.streamingBubbles.has('msg-tool'), 'no streaming state for non-streamed message');
});
```

**Group E — Auto-scroll (must FAIL)**
```javascript
it('autoScroll() is called after each delta flush', () => {
    let scrollCalls = 0;
    messageDisplay.autoScroll = () => { scrollCalls++; };
    eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: 'Hello' });
    eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: ' world\n\n' }); // paragraph complete
    assert.ok(scrollCalls >= 1, 'autoScroll must be called at least once during streaming');
});
```

**Verify every Group B/C/D/E test FAILS before moving to implementation.**

---

### Step 3 — Write failing integration test (RED)

**File**: `tests/integration/webview/streaming-rpc-flow.test.js`  
Pattern: ESM + `createComponentDOM()` + import actual `main.js` (like `main-full-integration.test.js`). Tests full pipeline: RPC message → EventBus → MessageDisplay DOM.

```javascript
it('messageDelta RPC → EventBus → DOM bubble created', async () => {
    // Simulate the extension sending messageDelta via RPC
    window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'messageDelta', messageId: 'msg-1', deltaContent: 'Hello' }
    }));
    const bubble = document.querySelector('.message-display__item--assistant');
    assert.ok(bubble, 'streaming bubble must appear in DOM');
});
it('full GPT stream: multiple deltas + assistantMessage → final rendered markdown', async () => {
    ['**Hello** ', 'world\n\n', 'More text'].forEach(chunk => {
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'messageDelta', messageId: 'msg-2', deltaContent: chunk }
        }));
    });
    window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'assistantMessage', text: '**Hello** world\n\nMore text', messageId: 'msg-2' }
    }));
    const bubble = document.querySelector('.message-display__item--assistant');
    assert.ok(bubble.innerHTML.includes('<strong>'), 'final render must have marked HTML');
});
```

**Verify FAILS before implementation.**

---

### Step 4 — Backend implementation (GREEN these tests)

- [ ] **`sdkSessionManager.ts`** — Add `streaming: true` to the central config spread inside `createSessionWithModelFallback()` (alongside `onPermissionRequest`, `clientName`, `onEvent`):
  ```typescript
  config = {
      ...config,
      onPermissionRequest: approveAll,
      clientName: 'vscode-copilot-cli',
      onEvent: (event: any) => this._handleSDKEvent(event),
      streaming: true,
  };
  ```
  **Do NOT** add it at each of the 7 call sites — the central location guarantees it is never missed.
- [ ] **`sdkSessionManager.ts`** — Add `_onDidMessageDelta` BufferedEmitter + event:
  ```typescript
  private readonly _onDidMessageDelta = this._reg(new BufferedEmitter<{ messageId: string; deltaContent: string }>());
  readonly onDidMessageDelta = this._onDidMessageDelta.event;
  ```
- [ ] **`sdkSessionManager.ts`** — Wire `assistant.message_delta`:
  ```typescript
  case 'assistant.message_delta':
      this._onDidMessageDelta.fire({
          messageId: event.data.messageId,
          deltaContent: event.data.deltaContent
      });
      break;
  ```
- [ ] **`sdkSessionManager.ts`** — Change `_onDidReceiveOutput` type from `string` to `{ content: string; messageId: string }` and update fire call:
  ```typescript
  this._onDidReceiveOutput.fire({ content: event.data.content, messageId: event.data.messageId });
  ```

Run `tests/unit/extension/streaming-backend.test.js` — verify backend tests go GREEN.

---

### Step 5 — Types + RPC layer (GREEN backend tests, start plumbing)

- [ ] **`shared/messages.ts`** — Add `'messageDelta'` to `ExtensionMessageType` union
- [ ] **`shared/messages.ts`** — Add `MessageDeltaPayload`:
  ```typescript
  export interface MessageDeltaPayload extends BaseMessage {
      type: 'messageDelta';
      messageId: string;
      deltaContent: string;
  }
  ```
- [ ] **`shared/messages.ts`** — Add `MessageDeltaPayload` to `ExtensionMessage` union
- [ ] **`shared/messages.ts`** — Add `messageId?: string` to `AssistantMessagePayload`
- [ ] **`ExtensionRpcRouter.ts`** — Add `sendMessageDelta(messageId, deltaContent)`:
  ```typescript
  sendMessageDelta(messageId: string, deltaContent: string): void {
      this.send({ type: 'messageDelta', messageId, deltaContent } as MessageDeltaPayload);
  }
  ```
- [ ] **`ExtensionRpcRouter.ts`** — Update `addAssistantMessage(text, messageId?)` + payload field

---

### Step 6 — Extension host wiring

- [ ] **`chatViewProvider.ts`** — Add public proxy (NO backend state storage — deltas are ephemeral):
  ```typescript
  public sendMessageDelta(messageId: string, deltaContent: string): void {
      this.rpcRouter?.sendMessageDelta(messageId, deltaContent);
  }
  ```
- [ ] **`chatViewProvider.ts`** — Update `addAssistantMessage(text, messageId?)` to forward `messageId` to `rpcRouter.addAssistantMessage(resolvedText, messageId)`
- [ ] **`extension.ts`** — Update `onDidReceiveOutput` handler:
  ```typescript
  manager.onDidReceiveOutput(safeHandler('onDidReceiveOutput', (data) => {
      chatProvider.addAssistantMessage(data.content, data.messageId);
      chatProvider.setThinking(false);
  }))
  ```
- [ ] **`extension.ts`** — Add `onDidMessageDelta` wiring in `wireManagerEvents()` — **before** `onDidReceiveOutput`:
  ```typescript
  manager.onDidMessageDelta(safeHandler('onDidMessageDelta', (data) => {
      chatProvider.sendMessageDelta(data.messageId, data.deltaContent);
  }))
  ```

---

### Step 7 — Webview RPC

- [ ] **`WebviewRpcClient.js`** — Add `onMessageDelta(handler)`:
  ```javascript
  onMessageDelta(handler) {
      return this._registerHandler('messageDelta', handler);
  }
  ```
- [ ] **`WebviewRpcClient.js`** — Update `onAssistantMessage` to forward `messageId` in payload

---

### Step 8 — main.js wiring

- [ ] **`main.js`** — Register `rpc.onMessageDelta` → EventBus:
  ```javascript
  rpc.onMessageDelta((data) => {
      eventBus.emit('message:delta', { messageId: data.messageId, deltaContent: data.deltaContent });
  });
  ```
- [ ] **`main.js`** — Ensure `messageId` flows through `message:add` emit for assistant messages

---

### Step 9 — MessageDisplay.js (core — makes all webview tests GREEN)

- [ ] **Add `streamingBubbles` map**:
  ```javascript
  this.streamingBubbles = new Map(); // messageId → { el, contentEl, deltaCount, buffer, renderedUpTo }
  ```

- [ ] **Add `message:delta` listener** in `attachListeners()`:
  - Look up or create bubble by `messageId` via `_getOrCreateStreamingBubble(messageId)`
  - Increment `deltaCount`, append `deltaContent` to `buffer`
  - Call `_renderDeltaProgress(bubble)` then `autoScroll()`

- [ ] **`_getOrCreateStreamingBubble(messageId)`**:
  - If not in map: call `_createStreamingBubble(messageId)`, add to map, return
  - If in map: return existing

- [ ] **`_createStreamingBubble(messageId)`**:
  - Create `.message-display__item--assistant` div with same structure as `addMessage()`
  - Add class `streaming-hidden` — hidden until `deltaCount >= 2` (CSS handles opacity + pointer-events)
  - Set `el.dataset.messageId = messageId`
  - Append to `messagesContainer`
  - Return `{ el, contentEl, deltaCount: 0, buffer: '', renderedUpTo: 0 }`

- [ ] **`_renderDeltaProgress(state)`**:
  - If `state.deltaCount < 2`: update buffer only, return — bubble is hidden, no DOM work needed
  - If `state.deltaCount === 2`: remove `streaming-hidden` class (make bubble visible)
  - Call `_flushSafeMarkdown(state)`, then `autoScroll()`

- [ ] **`_flushSafeMarkdown(state)`** — streaming state machine:
  - Scan `state.buffer` from `state.renderedUpTo`
  - Track `openConstruct`: `'none' | 'codeFence' | 'image' | 'table'`
  - Detect construct boundaries:
    - ` ``` ` opens/closes code fence (includes mermaid/svg)
    - `![` opens image, `)` closes image (when not inside code fence)
    - `\|` at line start opens table, blank line closes table
    - `\n\n` completes a paragraph (when `openConstruct === 'none'`)
    - `\n` completes a heading (when line starts with `#`)
  - For each completed safe unit: `contentEl.insertAdjacentHTML('beforeend', marked.parse(unit))`, advance `renderedUpTo`
  - Leave partial/open constructs in buffer tail
  - **Note**: Use `insertAdjacentHTML` not `innerHTML +=` — the latter is O(n²) because it re-serializes and re-parses the whole DOM on every chunk.

- [ ] **Update `message:add` handler** — when `assistant.message` arrives:
  - Check `streamingBubbles.has(message.messageId)`
  - **If YES (streaming response)**:
    - Flush remaining buffer: `contentEl.insertAdjacentHTML('beforeend', marked.parse(remainingBuffer))`
    - Run `_renderSvgBlocks(bubble.el)` + `_renderMermaidBlocks(bubble.el)` on whole bubble
    - Remove `streaming-hidden` class (in case Claude path — 1 delta, bubble was never made visible)
    - Add `streaming-fade-in` class (CSS animation fades from 0 → 1)
    - `streamingBubbles.delete(message.messageId)`
    - Return early — do NOT run `addMessage()` logic
  - **If NO (tool-call turn, or `streaming:false` fallback)**: render normally as today
  - **Important**: Do NOT set `el.style.opacity = '1'` inline — inline styles override CSS animations, so the fade-in would never run. Use classes only.

- [ ] **Auto-scroll**: call `autoScroll()` directly in `_renderDeltaProgress()` after each flush (do NOT rely on MutationObserver for in-place innerHTML updates)

---

### Step 10 — CSS

- [ ] **Add streaming styles** to webview CSS in `chatViewProvider.ts`:
  ```css
  .streaming-hidden {
      opacity: 0;
      pointer-events: none;
  }
  .streaming-fade-in {
      animation: fadeIn 150ms ease forwards;
  }
  @keyframes fadeIn {
      from { opacity: 0; }
      to   { opacity: 1; }
  }
  ```

  **Note**: Use a `.streaming-hidden` class instead of an inline `style.opacity` — inline styles have higher specificity than CSS animations, so setting `el.style.opacity = '1'` before adding `.streaming-fade-in` would prevent the animation from running. The animation also starts from `opacity: 0` (not `0.3`) to avoid a visible pop on start.

---

### Step 11 — Full GREEN + regression check

- [ ] Run `tests/unit/extension/streaming-backend.test.js` — all pass
- [ ] Run `tests/unit/components/message-display-streaming.test.js` — all pass
- [ ] Run `tests/integration/webview/streaming-rpc-flow.test.js` — all pass
- [ ] Run `npm test` — no new failures (baseline: 1225 passing, 3 pre-existing failures)

---

### Step 12 — Manual verification

- [ ] `./test-extension.sh`
- [ ] **GPT**: send a long message with a code block → observe word-by-word streaming, code block appears whole when fence closes
- [ ] **Claude**: send a message → no visible flash, smooth appearance, final markdown rendered correctly
- [ ] **Mermaid**: ask for a mermaid diagram → diagram appears when the ` ``` ` block closes
- [ ] **Tool calls**: tool response still renders atomically, no regression
- [ ] **Auto-scroll**: long response auto-scrolls as lines stream in
- [ ] **Session resume**: existing messages load correctly from `init` payload

---

## Technical Considerations

### `streaming: true` affects ALL sessions

Work, plan, and model-switch sessions all get deltas. The `message:add` no-streaming-bubble path ensures tool-call turns and any non-delta responses are unaffected.

### `result.text` is `null` with `streaming: true`

Confirmed in spike. Already a non-issue — we process via events.

### Auto-scroll during streaming

`MutationObserver` watches `childList` changes only. In-place `innerHTML` updates don't trigger it. `autoScroll()` must be called directly in `_renderDeltaProgress()` after each flush. This is simpler and more controlled than changing `MutationObserver` options.

### Only one in-flight response at a time

SDK enforces this. `streamingBubbles` will never have more than one active entry. The Map is used for clarity and forwards-compatibility.

### Claude "flash" is zero

Bubble is `opacity: 0` until `deltaCount >= 2`. Claude sends 1 delta at 52ms before `assistant.message`. The bubble is created (hidden), then finalized with a fade-in. Users see only the fade-in — identical to a smooth appearance from nothing. No regression from today's behavior.

### `_flushSafeMarkdown` edge cases

- Response ends mid-word in a paragraph: the `message:add` finalization flushes the tail, so nothing is lost
- Nested backticks (inline code inside code fence): the state machine tracks only top-level ` ``` ` fences; inline `` ` `` is ignored when inside a fence
- Image URLs with parentheses: buffer until the first `)` after `(` — valid markdown images don't have unescaped `)` in URLs
