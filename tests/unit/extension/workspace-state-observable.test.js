/**
 * v3.13.0 Task 7 phase 2 — window state is observed, not pushed.
 *
 * `updateActiveFile` and `updateSessionsList` pushed straight at the sidebar. With
 * N surfaces that becomes a loop at every call site, which is the shape that
 * produced three hand-built init payloads and two argument formatters in this
 * codebase already: each new value repeats the loop until one call site quietly
 * doesn't.
 *
 * So the state announces itself and surfaces subscribe. `WorkspaceRuntimeState` is
 * where it belongs — Task 3 built it as "state per window, shared by every
 * surface", and `activeFilePath` already lived there. Only the notification was
 * missing.
 */

const { describe, it } = require('mocha');
const { expect } = require('chai');
const path = require('path');

const { WorkspaceRuntimeState } = require(
    path.join(__dirname, '../../..', 'out', 'backendState.js')
);

describe('WorkspaceRuntimeState.onDidChange', () => {
    it('announces an active-file change', () => {
        const state = new WorkspaceRuntimeState();
        const seen = [];
        state.onDidChange(change => seen.push(change));

        state.setActiveFilePath('src/extension.ts');

        expect(seen).to.deep.equal(['activeFile']);
    });

    it('announces a sessions-list change', () => {
        const state = new WorkspaceRuntimeState();
        const seen = [];
        state.onDidChange(change => seen.push(change));

        state.setSessions([{ id: 'a', label: 'A' }]);

        expect(seen).to.deep.equal(['sessions']);
        expect(state.getSessions()).to.deep.equal([{ id: 'a', label: 'A' }]);
    });

    it('reaches every subscriber — this is the broadcast the sidebar push could not do', () => {
        const state = new WorkspaceRuntimeState();
        const sidebar = [];
        const tabOne = [];
        const tabTwo = [];
        state.onDidChange(c => sidebar.push(c));
        state.onDidChange(c => tabOne.push(c));
        state.onDidChange(c => tabTwo.push(c));

        state.setActiveFilePath('a.ts');

        expect([sidebar, tabOne, tabTwo]).to.deep.equal([['activeFile'], ['activeFile'], ['activeFile']]);
    });

    it('stops delivering once a subscriber unsubscribes', () => {
        const state = new WorkspaceRuntimeState();
        const closed = [];
        const staying = [];
        const subscription = state.onDidChange(c => closed.push(c));
        state.onDidChange(c => staying.push(c));

        subscription.dispose();
        state.setActiveFilePath('a.ts');

        expect(closed).to.have.lengthOf(0, 'a closed tab must not keep writing to a dead webview');
        expect(staying).to.have.lengthOf(1);
    });

    it('says nothing when the active file has not actually changed', () => {
        // Editor focus churn re-reports the same file constantly. With N surfaces
        // every repeat would be N re-renders.
        const state = new WorkspaceRuntimeState();
        state.setActiveFilePath('a.ts');
        const seen = [];
        state.onDidChange(c => seen.push(c));

        state.setActiveFilePath('a.ts');

        expect(seen).to.have.lengthOf(0);
    });

    it('announces a workspace-path change', () => {
        const state = new WorkspaceRuntimeState();
        const seen = [];
        state.onDidChange(c => seen.push(c));

        state.setWorkspacePath('/repo');
        state.setWorkspacePath('/repo');

        expect(seen).to.deep.equal(['workspacePath']);
    });

    it('keeps one subscriber\'s failure from silencing the rest', () => {
        const state = new WorkspaceRuntimeState();
        const survivor = [];
        state.onDidChange(() => { throw new Error('this surface is broken'); });
        state.onDidChange(c => survivor.push(c));

        state.setActiveFilePath('a.ts');

        expect(survivor).to.deep.equal(['activeFile']);
    });
});
