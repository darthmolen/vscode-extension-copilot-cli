> **CLOSED 2026-08-22 — all four items shipped in v3.13.0.** Item 1: the `view/title` `+` is
> repurposed as *New Tab* rather than removed. Item 2: `refreshPanel` is palette-only — re-argued
> on "a debug affordance does not belong in a toolbar" rather than actioned on its stated reason,
> which P2 had already invalidated. Item 3: `editorFocus` gone. Item 4: `host.beginNewConversation()`
> on the new-session path, in P3 step 2 as predicted. Kept for the reasoning; do not action.

# Backlog: Chat Toolbar Cleanup + New Session Should Start Blank

Three small defects in the sidebar's chrome, found while planning the chat-in-a-tab work
(`planning/acp-ahp-chat-tabs-dual-stream-work-order.md`, Lane B). Grouped because they are all
`contributes.menus` / session-reset bleed, and all cheap.

**Explicitly not in scope here:** the tool-message replay corruption
(`chatViewProvider.ts:687-696` ↔ `main.js:605-614`). That one is a **v3.13.0 prerequisite** — it is
the same replay path `registerWebviewPanelSerializer` uses to restore a chat tab — and is tracked in
the Slice 3 plan. Do not fold it in here and defer it.

> **Rechecked 2026-08-21, after v3.13.0 Task 7.** Two of the four items have moved and one is worse
> than described. Corrections are inline below; the file names, line numbers and the `chatProvider`
> vocabulary predate the surface split and should be read as historical. The replay corruption
> named above **is fixed** — P2 (`56a7fe8`, `194afb5`) projects the event log, so a replayed tool
> renders as a real chip.

## Problem

**1. Two `+` buttons that do the same thing.** `contributes.menus.view/title` binds
`copilot-cli-extension.newSession` (`$(add)`) on `copilot-cli.chatView`, and the webview renders its
own `+` beside the session dropdown. Same action, two controls, inches apart.

**2. The refresh icon triggers the bug it papers over.** ~~`refreshPanel` calls `forceRecreate()`,
which replays `backendState` into a fresh webview — the exact path that renders every past tool call
as a blank "Tool execution" bubble.~~ **Stale: P2 fixed the replay.** `forceRecreate` resets the HTML,
the webview re-readies, and `sendInit()` sends the projected transcript with real tool chips. The
recommendation may still stand on "two controls for one idea" grounds, but the *reason given here is
no longer true* and the item should be re-argued rather than actioned as written.

**3. `when: editorFocus` hides the Open Chat icon when you need it.**
`contributes.menus.editor/title` gates `copilot-cli-extension.openChat` on `editorFocus`, so the
icon disappears whenever focus sits in the chat webview — which is most of the time you would reach
for it. It reads as the icon randomly not existing. Claude Code's equivalent is always present
because it does not gate on focus.

**4. A new session does not start from a blank transcript — and the cause is deeper than the
screen.** `handleNewSession` calls `surface.clearMessages()`, which clears the *webview DOM only*.
**Nothing ever clears the host's `SessionState`.** `SessionState.reset()` and `clearMessages()` exist
and have zero callers in `src/`; `adoptSessionId` deliberately keeps the transcript, and
`recordSessionStart` does not touch it.

So a new session's host still holds the previous conversation, and the next `sendInit()` renders it
back under the new session id. Before Task 7 that needed a webview reload to notice. Now `sendInit()`
fires on every attach — sidebar hide/show, tab restore, session switch — so the old transcript
reappears routinely. **This is a live defect, not cosmetic, and it is bigger than the "small" label
at the bottom of this file.**

## Proposed Solution

1. Drop `newSession` from `view/title`; keep the in-panel `+` as the single new-session control. If
   Lane B's *New Tab* action lands, it takes that toolbar slot — repurposing the duplicate rather
   than adding a third add-button.
2. Move `refreshPanel` to palette-only (remove the `view/title` entry). Once the replay round-trip is
   fixed, reconsider whether it should exist at all.
3. Replace `when: editorFocus` with `editorIsOpen`, or drop the `when` clause entirely.
4. Clear the **host's** transcript, not just the webview: `host.state.reset()` (or `clearMessages()`)
   on the new-session path, before the first render. Clearing the DOM alone is what made this look
   cosmetic. Belongs with P3 step 2, which rewrites `handleNewSession` to take a host anyway.

## Value

Removes two redundant controls, stops one of them from actively producing a broken-looking panel, and
makes a shipped affordance stop appearing to vanish at random. Items 1 and 3 also clear the ground
for v3.13.0's toolbar work, so doing them first avoids designing around known-bad chrome.

## Scope

Items 1–3 are small: `package.json` `contributes.menus` edits plus command-registration cleanup in
`extension.ts`. No webview directory is added, so `esbuild.js` needs no change.

**Item 4 is not small and should be split out.** It is a state-lifetime defect on the new-session
path, it is reachable on every attach since Task 7, and it lands naturally inside P3 step 2 rather
than beside three menu edits.

## Overlap with v3.13.0 (2026-08-21)

- **Item 1** — the `view/title` `+` fires `newSession`, a window-scoped command with no surface.
  P3 §4.2 puts every signal on the surface that sent it. A sidebar title-bar button is unambiguous
  (it *is* the sidebar's), so it should bind to the sidebar host explicitly rather than inherit a
  default. Do this **with** P3, not before.
- **Item 3** — `editor/title` `openChat` gated on `editorFocus`. Confirmed still present and still
  wrong. This is **Task 8**, which repurposes that slot to *New Tab seeded with the active file* and
  drops the `when`. Do not fix it twice.
- **Item 4** — see above; belongs to P3 step 2.
- **Item 2** — freestanding, and needs re-arguing on its merits now its stated cause is gone.
