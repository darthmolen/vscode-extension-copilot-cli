# Chat Auto-Scrolling

## The Problem

A chat interface must handle two conflicting behaviors:

1. **Follow new messages.** When the user is at the bottom of the conversation and a new message arrives, the view should scroll down automatically so the latest content stays visible.

2. **Respect scroll position.** When the user has scrolled up to read earlier messages, new arrivals must not yank the viewport back to the bottom.

Getting this wrong in either direction is immediately noticeable. If auto-scroll is too aggressive, users cannot read history. If it is absent, users must manually scroll after every response.

## The Solution

The MessageDisplay component (`src/webview/app/components/MessageDisplay/MessageDisplay.js`) uses a **MutationObserver** attached to the messages container to detect when new messages are added to the DOM. When a mutation adds child nodes, a debounced callback decides whether to scroll based on the user's current position.

```javascript
this.mutationObserver = new MutationObserver((mutations) => {
    const hasNewChildren = mutations.some(m => m.addedNodes.length > 0);
    if (hasNewChildren) {
        clearTimeout(this.scrollTimeout);
        this.scrollTimeout = setTimeout(() => {
            this.autoScroll();
        }, 50);
    }
});
this.mutationObserver.observe(this.messagesContainer, {
    childList: true,
    subtree: false
});
```

The observer watches `messagesContainer` -- the `<div>` that holds all chat message elements. The configuration `childList: true, subtree: false` means it fires only when direct children are added or removed, not when nested content within existing messages changes. This targets exactly what matters: new messages appearing in the conversation.

### Why MutationObserver

- It watches the precise event that should trigger scrolling: a new message element being appended to the container.
- `childList: true, subtree: false` ignores irrelevant nested DOM changes (text edits inside an existing message, style changes, attribute mutations).
- It is a native browser API with built-in optimization. There is no polling.
- MessageDisplay does not need to coordinate with other components. Any code that appends a child to `messagesContainer` will trigger the observer automatically.

## The Flags

Three boolean properties on the MessageDisplay instance control scroll behavior:

| Property | Default | Purpose |
|---|---|---|
| `userHasScrolled` | `false` | Tracks whether the user has manually scrolled away from the bottom. When `false`, the component assumes the user wants to follow the conversation (initial load behavior). |
| `isProgrammaticScroll` | `false` | Set to `true` immediately before the component performs a scroll, then reset in `requestAnimationFrame`. Prevents the scroll event listener from misinterpreting a programmatic scroll as a user action. |
| `scrollTimeout` | `null` | Holds the debounce timer ID. Not a boolean, but it gates whether a pending scroll decision exists. Cleared and reset on each qualifying mutation. |

These three values form a minimal state machine. `userHasScrolled` is the primary decision variable. `isProgrammaticScroll` exists solely to protect `userHasScrolled` from being corrupted by the component's own scroll operations.

## The Flow

A new message arrives and is appended to `messagesContainer`. Here is what happens:

```
1. DOM mutation: new child added to messagesContainer
   |
2. MutationObserver callback fires
   |
3. Check: does any mutation contain addedNodes?
   |-- No  --> ignore (attribute change, removal, etc.)
   |-- Yes --> continue
   |
4. Clear any existing debounce timer
   |
5. Set new debounce timer (50ms)
   |
6. Timer expires --> autoScroll()
   |
7. autoScroll() calls isNearBottom()
   |
8. isNearBottom() decision:
   |-- userHasScrolled is false?  --> return true (initial load path)
   |-- Otherwise, compute distance:
   |     distanceFromBottom = scrollHeight - scrollTop - clientHeight
   |     return distanceFromBottom < 100
   |
9. If isNearBottom() returned true --> scrollToBottom()
   If false --> do nothing (user is reading history)
   |
10. scrollToBottom():
    a. Set isProgrammaticScroll = true
    b. Set scrollTop = scrollHeight
    c. In requestAnimationFrame:
       - Reset isProgrammaticScroll = false
       - Reset userHasScrolled = false
```

The scroll event listener in `attachListeners()` runs on every scroll of `messagesContainer`. It checks `isProgrammaticScroll` first -- if the component caused the scroll, the event is ignored entirely. Otherwise it evaluates `isNearBottomRaw()` (a pure distance check with no initial-load override) to determine user intent:

- User scrolled away from bottom (distance >= 100px): set `userHasScrolled = true`.
- User scrolled back to bottom (distance < 100px): set `userHasScrolled = false`.

### The Two isNearBottom Methods

- **`isNearBottomRaw()`** -- Pure geometry. Computes `scrollHeight - scrollTop - clientHeight` and returns `true` if the result is less than 100 pixels. Used by the scroll event listener to classify user scroll actions.
- **`isNearBottom()`** -- Wraps `isNearBottomRaw()` with the initial-load shortcut. If `userHasScrolled` is `false`, it returns `true` unconditionally. This ensures auto-scrolling works during the first render when `scrollTop` is 0 and the distance calculation would otherwise return `false`.

## Edge Cases

### 1. Initial load (scrollTop is 0)

When a session's history loads, messages are appended rapidly. At this point `scrollTop` is 0 and the viewport is at the top of a growing container, so `isNearBottomRaw()` would return `false`. But `userHasScrolled` starts as `false`, and `isNearBottom()` short-circuits to `true` whenever `userHasScrolled` is `false`. The component auto-scrolls to the bottom as messages load, which is the correct behavior -- the user has not expressed any intent to stay at the top.

### 2. Programmatic scroll race condition

Setting `scrollTop` on an element fires the browser's `scroll` event asynchronously. Without protection, the scroll event listener would see this as a user scroll, set `userHasScrolled = true`, and break auto-scrolling for subsequent messages. The `isProgrammaticScroll` flag prevents this. It is set to `true` before the assignment, and the scroll listener returns immediately when it sees the flag. The flag is reset in `requestAnimationFrame`, which runs after the scroll event has been processed.

### 3. Session switching (rapid DOM changes)

Switching between chat sessions can cause dozens of messages to be appended in quick succession. Each append triggers a MutationObserver callback. The 50ms debounce collapses all of these into one or two `autoScroll()` calls by clearing and resetting the timer on each mutation. Without debouncing, the component would issue many redundant scroll operations.

### 4. User reading history

When the user scrolls up to read earlier messages, the scroll event listener detects that `isNearBottomRaw()` returns `false` and sets `userHasScrolled = true`. From that point, `isNearBottom()` defers to `isNearBottomRaw()`, which continues returning `false` as long as the user remains scrolled up. New messages are appended to the DOM but the viewport stays where the user put it.

### 5. User returns to bottom

When the user scrolls back down within 100 pixels of the bottom, the scroll event listener sees `isNearBottomRaw()` return `true` and resets `userHasScrolled` to `false`. The next mutation-triggered `autoScroll()` call will proceed to `scrollToBottom()`, and the component resumes following new messages.

## Testing

Tests live in `tests/integration/webview/resizeobserver-autoscroll.test.js`. The file name references the original ResizeObserver design and has been retained for historical continuity. The tests themselves exercise the MutationObserver-based implementation.

### Test environment

The test setup creates a JSDOM environment with the necessary polyfills:

- **MutationObserver**: Available on the JSDOM `window` object but must be assigned to the `global` scope.
- **requestAnimationFrame**: Polyfilled as `setTimeout(cb, 0)`.
- **marked.js**: Mocked to wrap text in `<p>` tags, since MessageDisplay uses it for assistant message rendering.
- **ResizeObserver**: A mock is still provided in the shared helper (`tests/helpers/jsdom-component-setup.js`) for compatibility, though the implementation no longer uses it.

### Simulating scroll geometry

JSDOM does not compute layout. Properties like `scrollTop`, `scrollHeight`, and `clientHeight` are all 0 by default. Tests use `Object.defineProperty` (or the `setScrollProperties()` helper from `tests/helpers/jsdom-component-setup.js`) to set these values before asserting scroll behavior:

```javascript
setScrollProperties(element, {
    scrollTop: 0,
    scrollHeight: 1000,
    clientHeight: 500
});
```

### What the tests cover

- MutationObserver is created and attached during initialization.
- `isNearBottom()` returns `true` when at the bottom or within the 100px threshold.
- `isNearBottom()` returns `false` when scrolled up (with `userHasScrolled = true`).
- `autoScroll()` calls `scrollToBottom()` when near bottom, skips it when scrolled up.
- `scrollToBottom()` sets `scrollTop` to `scrollHeight`.
- `dispose()` disconnects the MutationObserver.

### Cleanup

The `dispose()` method disconnects the MutationObserver and clears the debounce timer. Tests call `dispose()` in `afterEach` to prevent observers from leaking between test cases.

## Related Files

- **Implementation**: `src/webview/app/components/MessageDisplay/MessageDisplay.js`
- **Tests**: `tests/integration/webview/resizeobserver-autoscroll.test.js`
- **Test helpers**: `tests/helpers/jsdom-component-setup.js` (provides `setScrollProperties()` and shared DOM setup)
