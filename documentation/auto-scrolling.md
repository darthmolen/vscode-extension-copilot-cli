# Auto-Scrolling Implementation

## Overview

The MessageDisplay component implements intelligent auto-scrolling using the browser's `ResizeObserver` API to automatically scroll to the bottom when new content appears, while respecting the user's scroll position.

**Problem Solved:** Without auto-scroll, users must manually scroll to see new messages. With naive auto-scroll, users can't read conversation history without being forced back to the bottom.

**Solution:** Smart auto-scroll that:
- Automatically scrolls to bottom when content changes AND user is near bottom
- Respects user scroll position when they scroll up to read history
- Resumes auto-scroll when user scrolls back near bottom
- Debounces scroll events to prevent spam (90+ scroll calls → ~1-2 calls)
- Handles initial history load (scrolls to bottom on first render)

## Architecture

### Component: MessageDisplay

**File:** `src/webview/app/components/MessageDisplay/MessageDisplay.js`

**Key Properties:**
```javascript
this.resizeObserver = null;        // ResizeObserver instance
this.scrollTimeout = null;          // Debounce timer ID
this.userHasScrolled = false;       // Has user manually scrolled away?
this.isProgrammaticScroll = false;  // Flag to ignore our own scroll events
```

### Why ResizeObserver?

**Alternatives Considered:**
1. ❌ **Manual scrollToBottom() calls** - Scattered throughout code, easy to miss, causes spam
2. ❌ **MutationObserver** - Triggers on every DOM change, even non-visual ones
3. ❌ **EventBus messages** - Requires every component to emit events, tight coupling
4. ✅ **ResizeObserver** - Browser API that fires when element size changes

**Why ResizeObserver wins:**
- Observes parent `<main>` element for ANY size change
- Captures message content, input area expansion, thinking indicator, attachments
- Single observation point, no coupling between components
- Built-in browser optimization
- Fires only when visual layout actually changes

## Implementation

### Setup (Constructor)

```javascript
constructor(container, eventBus) {
    // ... other initialization
    
    this.resizeObserver = null;
    this.scrollTimeout = null;
    this.userHasScrolled = false;
    this.isProgrammaticScroll = false;
    
    this.render();
    this.attachListeners();
    this.setupAutoScroll();  // ← Setup observer
}
```

### 1. setupAutoScroll()

**Purpose:** Create and attach ResizeObserver to parent `<main>` element

```javascript
setupAutoScroll() {
    const mainElement = document.querySelector('main');
    if (!mainElement) {
        console.warn('[MessageDisplay] Could not find <main> element');
        return;
    }
    
    this.resizeObserver = new ResizeObserver(() => {
        // Debounce: wait 50ms after last resize before scrolling
        clearTimeout(this.scrollTimeout);
        this.scrollTimeout = setTimeout(() => {
            this.autoScroll();
        }, 50);
    });
    
    this.resizeObserver.observe(mainElement);
}
```

**Key Design Decision:** Observe `<main>` (parent) not `.messages` (child)
- Captures input area expansion (attachments, textarea resize)
- Captures message content changes
- Single observation point for entire UI

**Debouncing:** 50ms delay after last resize
- Prevents spam during rapid DOM updates (session switching, history load)
- Original problem: 90+ scroll calls on session switch
- After debouncing: 1-2 scroll calls per content change

### 2. isNearBottom() / isNearBottomRaw()

**Purpose:** Determine if user is near bottom (within 100px threshold)

```javascript
isNearBottomRaw() {
    if (!this.messagesContainer) return true;
    
    const threshold = 100;
    const { scrollTop, scrollHeight, clientHeight } = this.messagesContainer;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    
    return distanceFromBottom < threshold;
}

isNearBottom() {
    if (!this.messagesContainer) return true;
    
    // If user hasn't manually scrolled away, always auto-scroll (initial load)
    if (!this.userHasScrolled) {
        return true;
    }
    
    return this.isNearBottomRaw();
}
```

**Why two methods?**
- `isNearBottomRaw()` - Pure distance calculation, used by scroll event listener
- `isNearBottom()` - Includes initial load logic, used by autoScroll decision

**100px threshold:**
- Too small (e.g., 10px): User must be exactly at bottom, feels janky
- Too large (e.g., 500px): Auto-scrolls even when user is reading history
- 100px: Sweet spot for "near enough to bottom" UX

### 3. autoScroll()

**Purpose:** Decide whether to scroll, based on user position

```javascript
autoScroll() {
    const nearBottom = this.isNearBottom();
    if (nearBottom) {
        this.scrollToBottom();
    }
}
```

**Simple logic:**
- If near bottom → scroll to stay at bottom
- If scrolled up → respect user position, don't scroll

### 4. scrollToBottom()

**Purpose:** Perform the actual scroll, with race condition protection

```javascript
scrollToBottom() {
    if (this.messagesContainer) {
        // Set flag BEFORE scrolling to ignore our own scroll event
        this.isProgrammaticScroll = true;
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
        
        // Reset flag after scroll event fires (next tick)
        setTimeout(() => {
            this.isProgrammaticScroll = false;
            this.userHasScrolled = false;  // We're at bottom now
        }, 0);
    }
}
```

**Race Condition Fix:**
1. Set `scrollTop` triggers browser 'scroll' event (asynchronous)
2. Our scroll event listener would think user scrolled
3. Would set `userHasScrolled = true` incorrectly
4. Next resize: "user scrolled away" → no auto-scroll (BUG!)

**Solution:**
- Set `isProgrammaticScroll = true` BEFORE scrolling
- Scroll event handler checks flag and ignores our scroll
- Reset flag with `setTimeout(0)` (next event loop tick)

### 5. Scroll Event Listener

**Purpose:** Track when user ACTUALLY scrolls (not our programmatic scrolls)

```javascript
attachListeners() {
    // ... other listeners
    
    if (this.messagesContainer) {
        this.messagesContainer.addEventListener('scroll', () => {
            // Ignore scroll events we triggered programmatically
            if (this.isProgrammaticScroll) {
                return;
            }
            
            // Only set userHasScrolled if they scroll away from bottom
            if (!this.isNearBottomRaw()) {
                this.userHasScrolled = true;
            } else {
                // User scrolled back to bottom, resume auto-scroll
                this.userHasScrolled = false;
            }
        });
    }
}
```

**Key Insight:** User intent matters
- User at bottom → keep them at bottom (auto-scroll)
- User scrolls up → they want to read history (no auto-scroll)
- User scrolls back down → resume auto-scroll

## Flow Diagrams

### Initial Load Flow

```
1. MessageDisplay constructor
   ↓
2. setupAutoScroll() - create ResizeObserver on <main>
   ↓
3. History loads → DOM content added → <main> resizes
   ↓
4. ResizeObserver callback fires
   ↓
5. Debounce timer set (50ms)
   ↓
6. Timer expires → autoScroll() called
   ↓
7. isNearBottom() checks userHasScrolled
   ↓ (false - user hasn't scrolled yet)
8. Returns true → scrollToBottom()
   ↓
9. Set isProgrammaticScroll = true
   ↓
10. Set scrollTop = scrollHeight (triggers 'scroll' event)
   ↓
11. Scroll event fires → checks isProgrammaticScroll → ignores
   ↓
12. setTimeout(0) resets isProgrammaticScroll and userHasScrolled
   ↓
13. User sees bottom of conversation ✅
```

### User Scrolls Up Flow

```
1. User scrolls up (wheel, drag scrollbar, arrow keys)
   ↓
2. 'scroll' event fires
   ↓
3. isProgrammaticScroll? No (we didn't trigger this)
   ↓
4. isNearBottomRaw()? No (scrolled away from bottom)
   ↓
5. Set userHasScrolled = true
   ↓
6. New message arrives → <main> resizes → ResizeObserver fires
   ↓
7. Debounce → autoScroll()
   ↓
8. isNearBottom() checks userHasScrolled
   ↓ (true - user scrolled away)
9. isNearBottomRaw() returns false (still scrolled up)
   ↓
10. autoScroll() does NOT call scrollToBottom()
   ↓
11. User stays at their scroll position ✅
```

### User Scrolls Back to Bottom Flow

```
1. User scrolls down near bottom
   ↓
2. 'scroll' event fires
   ↓
3. isProgrammaticScroll? No
   ↓
4. isNearBottomRaw()? Yes (within 100px of bottom)
   ↓
5. Set userHasScrolled = false (resume auto-scroll)
   ↓
6. New message arrives → ResizeObserver fires
   ↓
7. autoScroll() → isNearBottom() returns true
   ↓
8. scrollToBottom() executes
   ↓
9. User stays at bottom ✅
```

## Edge Cases Handled

### 1. Initial Load at scrollTop = 0

**Problem:** When history loads, scrollTop is 0 (top of page), not bottom
- `isNearBottomRaw()` would return false (distance = scrollHeight - clientHeight)
- No auto-scroll → user sees top of conversation

**Solution:** `userHasScrolled` flag
- Starts as `false` (user hasn't scrolled yet)
- `isNearBottom()` returns true if `userHasScrolled === false`
- First resize → auto-scroll to bottom
- Flag reset to false after programmatic scroll

### 2. Programmatic Scroll Race Condition

**Problem:** Setting `scrollTop` triggers browser 'scroll' event
- Our scroll listener thinks user scrolled
- Sets `userHasScrolled = true` incorrectly
- Next resize: no auto-scroll (thinks user scrolled away)

**Solution:** `isProgrammaticScroll` flag
- Set to true BEFORE scrolling
- Scroll listener checks flag and ignores our scrolls
- Reset with `setTimeout(0)` (after scroll event fires)

### 3. Session Switching Spam

**Problem:** Switching sessions loads large history, causing:
- 90+ DOM mutations as each message renders
- ResizeObserver fires 90+ times
- 90+ scroll calls (visible in logs)
- UI feels janky

**Solution:** Debouncing (50ms)
- Clear previous timer on each resize
- Only scroll 50ms after LAST resize
- Result: 1-2 scroll calls per session switch

### 4. Input Area Expansion

**Problem:** Attachments, textarea auto-resize changes input area height
- Messages scroll up to make room
- User appears to scroll away from bottom
- No auto-scroll for new messages

**Solution:** Observe parent `<main>` element
- Captures both message area AND input area changes
- Input expands → ResizeObserver fires → auto-scroll
- User stays at bottom

### 5. User at Bottom, New Message Arrives

**Problem:** User is at bottom, new message appears
- Content grows, user is now "scrolled up" (distance from bottom increased)
- Without auto-scroll, user must manually scroll

**Solution:** Threshold + userHasScrolled tracking
- User at bottom (distance < 100px) → `userHasScrolled = false`
- New message → ResizeObserver → autoScroll()
- `isNearBottom()` returns true → scroll to new bottom
- User stays with conversation

## Testing

### Unit Tests

**File:** `tests/resizeobserver-autoscroll.test.js` (13 tests)

**Coverage:**
- ResizeObserver initialization
- `isNearBottom()` logic with various scroll positions
- `autoScroll()` decision logic
- Cleanup (dispose method)

**Mocking:** JSDOM doesn't include ResizeObserver
```javascript
global.ResizeObserver = class ResizeObserver {
    constructor(callback) {
        this.callback = callback;
        this.observations = [];
    }
    observe(element) {
        this.observations.push(element);
    }
    disconnect() {
        this.observations = [];
    }
};
```

### Manual Testing Checklist

**Initial Load:**
- [ ] Switch to session with history → scrolls to bottom immediately
- [ ] No scroll spam in console (< 5 scroll calls)

**Auto-Scroll When Following:**
- [ ] Stay at bottom, send message → stays at bottom
- [ ] Attachment expansion → stays at bottom
- [ ] Thinking indicator appears → stays at bottom

**Respect User Position:**
- [ ] Scroll up, send message → stays scrolled up
- [ ] Scroll up, thinking appears → stays scrolled up
- [ ] Console shows: "User manually scrolled away from bottom"

**Resume Auto-Scroll:**
- [ ] Scroll up, then scroll back to bottom → resumes auto-scroll
- [ ] Console shows: "User scrolled to bottom, resuming auto-scroll"
- [ ] Next message → stays at bottom

**Debouncing:**
- [ ] Session switch → 1-2 scroll calls (not 90+)
- [ ] Console shows: "Resize detected, debouncing scroll..."
- [ ] Then: "Debounce complete, calling autoScroll()"

## Debugging

### Console Logs

**Setup:**
```
[ResizeObserver] Setting up observer on <main> element
[ResizeObserver] Observer active
```

**Resize Detection:**
```
[ResizeObserver] Resize detected, debouncing scroll...
[ResizeObserver] Debounce complete, calling autoScroll()
```

**Decision Logic:**
```
[isNearBottom] User has not manually scrolled, auto-scrolling
[ResizeObserver] autoScroll() called, nearBottom: true
[SCROLL] scrollToBottom() called, scrollHeight: 107362
```

**User Scroll Tracking:**
```
[Scroll] User manually scrolled away from bottom
[Scroll] User scrolled to bottom, resuming auto-scroll
[Scroll] Ignoring programmatic scroll
```

**Detailed Position:**
```
[isNearBottom] scrollTop: 0 scrollHeight: 105969 clientHeight: 666 distance: 105303 threshold: 100
```

### Common Issues

**Symptom:** "User manually scrolled away" after initial load
- **Cause:** Programmatic scroll triggering scroll event listener
- **Check:** Should see "[Scroll] Ignoring programmatic scroll"
- **Fix:** Ensure `isProgrammaticScroll` flag is set before `scrollTop = scrollHeight`

**Symptom:** No auto-scroll on initial load
- **Cause:** `userHasScrolled` not reset properly
- **Check:** Should see "[isNearBottom] User has not manually scrolled"
- **Fix:** Ensure `userHasScrolled = false` in `scrollToBottom()` setTimeout

**Symptom:** Scroll spam (90+ calls)
- **Cause:** Debouncing not working
- **Check:** Should see "debouncing scroll..." then 50ms delay
- **Fix:** Verify `clearTimeout()` is called on each resize

**Symptom:** Auto-scroll when user scrolled up
- **Cause:** Scroll listener not detecting user scroll
- **Check:** Should see "[Scroll] User manually scrolled away"
- **Fix:** Verify scroll listener attached to `this.messagesContainer`

## Performance

**ResizeObserver overhead:**
- Native browser API, highly optimized
- Only fires when layout actually changes
- No polling or manual checking required

**Debouncing benefit:**
- **Before:** 90+ scroll calls on session switch
- **After:** 1-2 scroll calls (98% reduction)
- Prevents layout thrashing, smoother UI

**Memory:**
- Single ResizeObserver instance (minimal overhead)
- Cleaned up in `dispose()` method
- No memory leaks

## Future Improvements

### 1. Smooth Scrolling

**Current:** Instant jump to bottom
**Potential:** `scrollIntoView({ behavior: 'smooth' })`
**Tradeoff:** Smooth scrolling delays user seeing new content

### 2. Configurable Threshold

**Current:** Hardcoded 100px
**Potential:** User setting for threshold distance
**Use Case:** Large monitors might want larger threshold

### 3. Scroll Position Persistence

**Current:** Always scroll to bottom on load
**Potential:** Remember scroll position per session
**Use Case:** Switch sessions, return, and resume where you left off

### 4. Smart Initial Scroll

**Current:** Always scroll to bottom
**Potential:** Detect unread messages, scroll to first unread
**Use Case:** Long sessions with unread content

### 5. Remove Debug Logging

**Current:** Verbose console logs for debugging
**TODO:** Remove or gate behind debug flag before production
**Why:** Performance and log cleanliness

## Related Files

**Implementation:**
- `src/webview/app/components/MessageDisplay/MessageDisplay.js` (lines 27-180)

**Tests:**
- `tests/resizeobserver-autoscroll.test.js` (13 tests, all passing)

**Documentation:**
- `documentation/auto-scrolling.md` (this file)
- `.github/copilot-instructions.md` (lines 305-340 - ResizeObserver section)

**Related Components:**
- `InputArea` - Expansion triggers ResizeObserver
- `ToolExecution` - Tool rendering triggers ResizeObserver
- `main.js` - Thinking indicator triggers ResizeObserver

## References

**Browser APIs:**
- [ResizeObserver - MDN](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver)
- [Element.scrollTop - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollTop)

**Design Pattern:**
- Observer pattern for DOM size changes
- Debouncing for performance optimization
- State machine for user intent tracking (userHasScrolled flag)

## Version History

**v3.0.0 (2026-02-11)** - Initial implementation
- ResizeObserver setup on `<main>` element
- Debouncing (50ms)
- User scroll tracking with `userHasScrolled` flag
- Programmatic scroll race condition fix with `isProgrammaticScroll` flag
- 13 unit tests (all passing)
- Fixed initial load, session switching spam, user scroll respect

---

**Last Updated:** 2026-02-11 22:38 UTC  
**Author:** Development team (with AI assistance)  
**Status:** ✅ Implemented, tested, ready for production review
