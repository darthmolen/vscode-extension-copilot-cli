/**
 * Sub-agent colors — the single source of truth for the extension host.
 *
 * `extension.ts` assigns one per `agentId` in first-seen order and rides the
 * chosen color on the event payload, so the sidebar dock, its detail pane, and
 * the pop-out editor tab all agree.
 *
 * The webview keeps its own copy of this array because esbuild COPIES webview
 * files rather than bundling them, so `src/webview/**` cannot import from
 * `src/`. `tests/unit/components/subagent-palette-drift.test.js` compares the
 * two and fails if they diverge.
 */
export const SUBAGENT_PALETTE: readonly string[] = [
    '#4FC1FF', '#C586C0', '#9CDCFE', '#CE9178', '#6A9955',
    '#DCDCAA', '#569CD6', '#D7BA7D', '#F48771', '#B5CEA8',
];
