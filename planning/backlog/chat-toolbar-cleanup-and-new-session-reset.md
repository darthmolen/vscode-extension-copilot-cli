# Backlog: Chat Toolbar Cleanup + New Session Should Start Blank

Three small defects in the sidebar's chrome, found while planning the chat-in-a-tab work
(`planning/acp-ahp-chat-tabs-dual-stream-work-order.md`, Lane B). Grouped because they are all
`contributes.menus` / session-reset bleed, and all cheap.

**Explicitly not in scope here:** the tool-message replay corruption
(`chatViewProvider.ts:687-696` ↔ `main.js:605-614`). That one is a **v3.13.0 prerequisite** — it is
the same replay path `registerWebviewPanelSerializer` uses to restore a chat tab — and is tracked in
the Slice 3 plan. Do not fold it in here and defer it.

## Problem

**1. Two `+` buttons that do the same thing.** `contributes.menus.view/title` binds
`copilot-cli-extension.newSession` (`$(add)`) on `copilot-cli.chatView`, and the webview renders its
own `+` beside the session dropdown. Same action, two controls, inches apart.

**2. The refresh icon triggers the bug it papers over.**
`copilot-cli-extension.refreshPanel` (`$(refresh)`, also in `view/title`) calls
`chatProvider.forceRecreate()`, which replays `backendState` into a fresh webview — the exact path
that renders every past tool call as a blank "Tool execution" bubble. Users reach for it when the
panel looks wrong and it makes the panel look worse.

**3. `when: editorFocus` hides the Open Chat icon when you need it.**
`contributes.menus.editor/title` gates `copilot-cli-extension.openChat` on `editorFocus`, so the
icon disappears whenever focus sits in the chat webview — which is most of the time you would reach
for it. It reads as the icon randomly not existing. Claude Code's equivalent is always present
because it does not gate on focus.

**4. A new session does not start from a blank transcript.** Creating a new session leaves prior
content on screen instead of resetting to an empty state.

## Proposed Solution

1. Drop `newSession` from `view/title`; keep the in-panel `+` as the single new-session control. If
   Lane B's *New Tab* action lands, it takes that toolbar slot — repurposing the duplicate rather
   than adding a third add-button.
2. Move `refreshPanel` to palette-only (remove the `view/title` entry). Once the replay round-trip is
   fixed, reconsider whether it should exist at all.
3. Replace `when: editorFocus` with `editorIsOpen`, or drop the `when` clause entirely.
4. Ensure the new-session path clears the transcript before the first render.

## Value

Removes two redundant controls, stops one of them from actively producing a broken-looking panel, and
makes a shipped affordance stop appearing to vanish at random. Items 1 and 3 also clear the ground
for v3.13.0's toolbar work, so doing them first avoids designing around known-bad chrome.

## Scope

Small. Items 1–3 are `package.json` `contributes.menus` edits plus command-registration cleanup in
`extension.ts`. Item 4 touches the new-session path in `extension.ts` / `chatViewProvider.ts`. No
webview directory is added, so `esbuild.js` needs no change.
