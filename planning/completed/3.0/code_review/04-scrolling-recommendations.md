# MessageDisplay Scrolling Recommendations

**Date:** 2026-02-12

---

## Current Implementation Analysis

**File:** `src/webview/app/components/MessageDisplay/MessageDisplay.js`

The current scrolling system is a three-part observer system:

1. **Manual scroll detection** (lines 76-92) — `scroll` event listener tracks `userHasScrolled` flag
2. **ResizeObserver** (lines 98-120) — watches `<main>` for content/layout changes, debounces 50ms
3. **Near-bottom detection** (lines 125-155) — 100px threshold, special-case for initial load

### Known Bugs

1. **The `isProgrammaticScroll` flag uses `setTimeout(fn, 0)` to reset** (line 182-185). This creates a race: if the scroll event fires in the same microtask as the programmatic scroll, the flag is still `true`. But if the browser batches events differently, the flag may already be `false` when the scroll event fires, incorrectly setting `userHasScrolled = true`.

2. **`scrollToBottom()` resets `userHasScrolled = false` inside `setTimeout(fn, 0)`** (line 184). This means for one event loop tick, `userHasScrolled` is stale. If `autoScroll()` runs during that tick (e.g., from a rapid ResizeObserver callback), it reads the wrong value.

3. **ResizeObserver watches `<main>` not `messagesContainer`** (line 100). This means ANY resize of the main element triggers scroll checks — including input area expansion, toolbar visibility changes, etc. Some of these are false positives that cause unnecessary scroll-to-bottom.

4. **12+ `console.log` statements in hot paths** — `isNearBottom()`, `autoScroll()`, and the scroll event handler all log on every invocation. The scroll handler fires many times per second during user scrolling.

5. **`clearMessages()` vs `clear()` inconsistency** — `clearMessages()` (line 203) uses `innerHTML = ''` which destroys everything including the empty state. `clear()` (line 282) properly removes only message items.

---

## Option A: Fix Current ResizeObserver Approach (Minimal Change)

If you want to keep the custom webview and fix the existing pattern:

### Fix 1: Use `requestAnimationFrame` instead of `setTimeout`

```javascript
scrollToBottom() {
    if (this.messagesContainer) {
        this.isProgrammaticScroll = true;
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;

        // Reset after the scroll event has been processed
        requestAnimationFrame(() => {
            this.isProgrammaticScroll = false;
            this.userHasScrolled = false;
        });
    }
}
```

`requestAnimationFrame` fires after layout and scroll events are processed, making the timing more reliable than `setTimeout(fn, 0)`.

### Fix 2: Observe `messagesContainer` not `<main>`

```javascript
setupAutoScroll() {
    if (!this.messagesContainer) return;

    this.resizeObserver = new ResizeObserver(() => {
        clearTimeout(this.scrollTimeout);
        this.scrollTimeout = setTimeout(() => this.autoScroll(), 50);
    });

    // Watch the actual messages container, not <main>
    this.resizeObserver.observe(this.messagesContainer);
}
```

This eliminates false positive resize events from the input area or toolbar.

### Fix 3: Use MutationObserver for content changes instead of ResizeObserver

ResizeObserver fires on size changes, which is indirect. What you actually want to know is "was a new message added?" — which is a DOM mutation:

```javascript
setupAutoScroll() {
    if (!this.messagesContainer) return;

    this.mutationObserver = new MutationObserver((mutations) => {
        // Only auto-scroll when children are added (new messages)
        const hasNewChildren = mutations.some(m => m.addedNodes.length > 0);
        if (hasNewChildren) {
            clearTimeout(this.scrollTimeout);
            this.scrollTimeout = setTimeout(() => this.autoScroll(), 50);
        }
    });

    this.mutationObserver.observe(this.messagesContainer, {
        childList: true,    // Watch for added/removed children
        subtree: false      // Don't watch deep changes (perf)
    });
}
```

**Why this is better:** MutationObserver fires on structural changes (message added), not on any resize. No false positives from input expansion.

### Fix 4: Remove console.log statements

Replace all 12+ `console.log` calls with a gated debug utility:

```javascript
const DEBUG_SCROLL = false; // Set true for development

function scrollLog(...args) {
    if (DEBUG_SCROLL) console.log('[Scroll]', ...args);
}
```

### Fix 5: Consolidate `clear()` and `clearMessages()`

Remove `clearMessages()`, keep `clear()`:

```javascript
clear() {
    const messages = this.messagesContainer.querySelectorAll('.message-display__item');
    messages.forEach(msg => msg.remove());
    // Also clear tool executions
    this.toolExecution?.clear();
    // Show empty state
    if (this.emptyState) this.emptyState.style.display = 'flex';
    // Reset scroll state
    this.userHasScrolled = false;
}
```

---

## Option B: Use CSS `scroll-snap` (Modern Browser Approach)

Instead of manual JavaScript scroll management, use CSS scroll snapping:

```css
.messages.message-display {
    overflow-y: auto;
    overscroll-behavior-y: contain;

    /* Snap to bottom when near bottom */
    scroll-snap-type: y proximity;
}

.message-display__item:last-child {
    scroll-snap-align: end;
}
```

**How `proximity` works:** The browser only snaps to the last element if the user is "close enough" to it. If they've scrolled up significantly, it doesn't snap. This gives you the "auto-scroll when near bottom, don't when scrolled up" behavior for free — no JavaScript needed.

**Trade-off:** Less control over the exact threshold. Browser decides what "close enough" means. But it eliminates all the JavaScript scroll tracking code.

**Combine with:** Keep MutationObserver for the "scroll to bottom on new message when already at bottom" behavior, but remove the scroll event listener and the `userHasScrolled`/`isProgrammaticScroll` flags entirely.

---

## Option C: Adopt Chat Participant API (Eliminates the Problem)

**The real recommendation.** If you register as a Chat Participant (see `02-vscode-api-opportunities.md`), VS Code's built-in chat panel handles all scrolling:

- `stream.markdown(fragment)` progressive updates auto-scroll
- VS Code handles "user scrolled up" detection natively
- No ResizeObserver, no MutationObserver, no flags, no thresholds
- Works correctly across all platforms and VS Code versions

**This doesn't mean abandoning the custom webview.** You could:
1. Use Chat Participant for the primary quick-chat experience (free scrolling)
2. Keep the custom WebviewViewProvider sidebar for the full-featured experience (apply Fix Option A)

The Chat Participant path eliminates the hardest rendering problem you have.

---

## Option D: Hybrid — Chat Output Renderer for Rich Content

If you go the Chat Participant route, use Chat Output Renderers for your ToolExecution and diff visualizations:

```
[Chat Participant handles scrolling]
    ↓
[stream.markdown() for text responses]    → VS Code renders + scrolls
[tool output with custom MIME type]       → Your renderer creates webview
    ↓
[Webview inside chat bubble]              → Your custom UI, VS Code scrolls outer container
```

The outer scrolling is handled by VS Code. Your webview inside the bubble only needs to manage its own internal layout (e.g., collapsible tool groups). No scroll-to-bottom logic needed.

---

## Recommendation Summary

| Approach | Effort | Scroll Quality | Eliminates JS scroll code? |
|----------|--------|---------------|---------------------------|
| Fix current (Option A) | Low | Good (fixes bugs) | No |
| CSS scroll-snap (Option B) | Low | Good | Mostly |
| Chat Participant (Option C) | Medium | Perfect (native) | Yes |
| Hybrid Participant + Renderer (Option D) | High | Perfect (native) | Yes |

**My recommendation:** Start with **Option A** (immediate bug fixes), then move toward **Option C** (Chat Participant) as the long-term architecture. Option C solves the scrolling problem by not having it.
