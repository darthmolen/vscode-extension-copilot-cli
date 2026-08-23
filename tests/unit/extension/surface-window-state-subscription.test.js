/**
 * v3.13.0 Task 7 phase 2 — N surfaces over one window state.
 *
 * The plan's headline verification, driven from the suite rather than by eye:
 * one active-file change reaches both surfaces; each highlights *its own* session
 * in the shared list; disposing one leaves the other working; and a disposed
 * surface receives nothing further.
 *
 * `ChatWebviewSlot` is what makes this runnable — a fake slot is a webview, a
 * visibility event and a disposal event, so two surfaces can be stood up with no
 * extension host.
 */

const { describe, it, before, after, beforeEach } = require('mocha');
const { expect } = require('chai');
const path = require('path');
const { installVscodeMock } = require('../../helpers/with-vscode-mock');

const mock = installVscodeMock();
let WebviewChatSurface, ChatSessionHost, WorkspaceRuntimeState;

/** A fake slot: everything `attach()` touches, and a record of what was posted. */
function makeSlot() {
    const posted = [];
    let messageListener = () => {};
    const disposeListeners = [];
    const visibilityListeners = [];
    return {
        posted,
        fireDispose: () => disposeListeners.slice().forEach(l => l()),
        receive: (message) => messageListener(message),
        isVisible: true,
        closingEndsSurface: true,
        reveal() {},
        webview: {
            options: {},
            html: '',
            postMessage: (m) => { posted.push(m); return Promise.resolve(true); },
            asWebviewUri: (uri) => ({ toString: () => `vscode-webview://${uri.fsPath}` }),
            cspSource: 'vscode-webview:',
            onDidReceiveMessage: (listener) => { messageListener = listener; return { dispose() {} }; }
        },
        visibilityListenerCount: () => visibilityListeners.length,
        onDidChangeVisibility: (l) => {
            visibilityListeners.push(l);
            return { dispose: () => { const i = visibilityListeners.indexOf(l); if (i >= 0) { visibilityListeners.splice(i, 1); } } };
        },
        onDidDispose: (l) => {
            disposeListeners.push(l);
            return { dispose: () => { const i = disposeListeners.indexOf(l); if (i >= 0) { disposeListeners.splice(i, 1); } } };
        }
    };
}

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

describe('A surface subscribes to its window\'s state', () => {
    before(() => {
        mock.install();
        ({ WebviewChatSurface } = require(
            path.join(__dirname, '../../..', 'out', 'extension', 'webview', 'webviewChatSurface.js')
        ));
        ({ ChatSessionHost } = require(
            path.join(__dirname, '../../..', 'out', 'extension', 'session', 'ChatSessionHost.js')
        ));
        ({ WorkspaceRuntimeState } = require(
            path.join(__dirname, '../../..', 'out', 'backendState.js')
        ));
    });
    after(() => mock.restore());

    let workspace, sidebar, tab, sidebarSlot, tabSlot;

    function host(handle, sessionId) {
        return new ChatSessionHost({ handle, sessionId, workspace, logger: silentLogger });
    }

    /** Every active-file message a slot received, in order. */
    function activeFilesSeen(slot) {
        return slot.posted.filter(m => m.type === 'activeFileChanged').map(m => m.filePath);
    }

    function sessionUpdatesSeen(slot) {
        return slot.posted.filter(m => m.type === 'updateSessions');
    }

    beforeEach(() => {
        workspace = new WorkspaceRuntimeState();
        sidebarSlot = makeSlot();
        tabSlot = makeSlot();

        sidebar = new WebviewChatSurface({ fsPath: '/ext' }, { label: 'Sidebar' });
        tab = new WebviewChatSurface({ fsPath: '/ext' }, { label: 'Tab' });
        sidebar.setSessionHost(host('host#1', 'session-sidebar'));
        tab.setSessionHost(host('host#2', 'session-tab'));
        sidebar.attach(sidebarSlot);
        tab.attach(tabSlot);
        sidebarSlot.posted.length = 0;
        tabSlot.posted.length = 0;
    });

    it('sends one active-file change to every surface', () => {
        workspace.setActiveFilePath('src/extension.ts');

        expect(activeFilesSeen(sidebarSlot)).to.have.lengthOf(1);
        expect(activeFilesSeen(tabSlot)).to.have.lengthOf(1);
    });

    it('gives each surface the shared list but ITS OWN current session', () => {
        workspace.setSessions([
            { id: 'session-sidebar', label: 'the sidebar one' },
            { id: 'session-tab', label: 'the tab one' }
        ]);

        const [toSidebar] = sessionUpdatesSeen(sidebarSlot);
        const [toTab] = sessionUpdatesSeen(tabSlot);

        expect(toSidebar.sessions).to.have.lengthOf(2);
        expect(toTab.sessions).to.have.lengthOf(2);
        expect(toSidebar.currentSessionId).to.equal('session-sidebar');
        expect(toTab.currentSessionId).to.equal('session-tab',
            'a tab\'s dropdown must not highlight the sidebar\'s conversation');
    });

    it('keeps the other surface working when one is disposed', () => {
        sidebar.dispose();

        workspace.setActiveFilePath('src/extension.ts');

        expect(activeFilesSeen(sidebarSlot)).to.have.lengthOf(0);
        expect(activeFilesSeen(tabSlot)).to.have.lengthOf(1);
    });

    it('goes quiet when its slot is closed', () => {
        tabSlot.fireDispose();

        workspace.setActiveFilePath('src/extension.ts');

        expect(activeFilesSeen(tabSlot)).to.have.lengthOf(0,
            'a closed tab writing to a dead webview is the leak this subscription risks');
    });

    /**
     * v3.13.0 Task 8 — *New Tab* on a file means **this file, this tab**.
     *
     * CLAUDE.md's "intentional actions are treated intentionally", third clause:
     * an intent binds only the thing the gesture was about. Clicking *New Tab*
     * while looking at `foo.ts` says "ask about foo.ts here"; it does not say
     * "start including active files everywhere", and it is never a licence to
     * rewrite `copilotCLI.includeActiveFile`.
     *
     * The window's active file follows the editor. A pinned one does not, or the
     * seed evaporates the moment you click into another file to check something.
     */
    describe('a pinned active file', () => {
        it('shows the file the tab was opened on', () => {
            tab.pinActiveFile('src/foo.ts');

            expect(activeFilesSeen(tabSlot)).to.deep.equal(['src/foo.ts']);
        });

        it('stops following the window — that is what pinning means', () => {
            tab.pinActiveFile('src/foo.ts');
            tabSlot.posted.length = 0;

            workspace.setActiveFilePath('src/somewhere-else.ts');

            expect(activeFilesSeen(tabSlot)).to.have.lengthOf(0,
                'the seeded file vanished as soon as the user looked at another file');
        });

        it('leaves every other surface following the window', () => {
            tab.pinActiveFile('src/foo.ts');
            sidebarSlot.posted.length = 0;

            workspace.setActiveFilePath('src/somewhere-else.ts');

            expect(activeFilesSeen(sidebarSlot)).to.deep.equal(['src/somewhere-else.ts'],
                'one tab\'s gesture changed what the sidebar shows');
        });

        it('is what a cold render sends, not the window\'s file', () => {
            workspace.setActiveFilePath('src/somewhere-else.ts');
            tab.pinActiveFile('src/foo.ts');
            tabSlot.posted.length = 0;

            tab.sendInit();

            const init = tabSlot.posted.find(m => m.type === 'init');
            expect(init.activeFilePath).to.equal('src/foo.ts');
        });

        it('unpins back to following the window', () => {
            tab.pinActiveFile('src/foo.ts');
            tab.pinActiveFile(null);
            tabSlot.posted.length = 0;

            workspace.setActiveFilePath('src/somewhere-else.ts');

            expect(activeFilesSeen(tabSlot)).to.deep.equal(['src/somewhere-else.ts']);
        });
    });

    /**
     * PR #49 review — the sidebar is re-attached constantly, and re-attaching used to poison itself.
     *
     * VS Code disposes a sidebar *view* whenever its container is hidden and resolves a fresh one
     * when it comes back; one measured session did that **11 times**. Every `attach()` registered a
     * new visibility handler, a new dispose handler and a whole new `ExtensionRpcRouter` with ~34
     * handlers — all into the surface's *lifetime* store, which is only emptied when the surface
     * itself dies.
     *
     * The leak is the smaller half. The dispose callback nulls `this.slot` and `this.rpcRouter`
     * **unconditionally**, so a stale slot disposing at any later moment silently decapitates the
     * live one: the host goes on recording and routing, `addAssistantMessage` still runs and still
     * logs, and every `postMessage` lands on `undefined`.
     */
    describe('re-attaching a slot', () => {
        it('keeps working when the slot it replaced is disposed afterwards', () => {
            const replacement = makeSlot();
            tab.attach(replacement);
            replacement.posted.length = 0;

            tabSlot.fireDispose();          // the stale slot, disposing late

            workspace.setActiveFilePath('src/extension.ts');
            expect(activeFilesSeen(replacement), 'a stale slot killed the live one')
                .to.deep.equal(['src/extension.ts']);
        });

        it('still goes quiet when the CURRENT slot is disposed', () => {
            const replacement = makeSlot();
            tab.attach(replacement);
            replacement.posted.length = 0;

            replacement.fireDispose();

            workspace.setActiveFilePath('src/extension.ts');
            expect(activeFilesSeen(replacement)).to.have.lengthOf(0);
        });

        it('stops writing to the slot it replaced', () => {
            const replacement = makeSlot();
            tab.attach(replacement);
            tabSlot.posted.length = 0;

            workspace.setActiveFilePath('src/extension.ts');

            expect(activeFilesSeen(tabSlot), 'the old webview is dead; writing to it is a leak')
                .to.have.lengthOf(0);
        });

        it('unsubscribes from the slot it replaced, rather than merely not stacking', () => {
            // Each re-attach used to add another set that nothing released, so a surface
            // re-resolved 11 times held 11 visibility handlers, 11 routers and 11 handler sets.
            const replacement = makeSlot();
            tab.attach(replacement);
            expect(replacement.visibilityListenerCount()).to.equal(1);

            tab.attach(makeSlot());

            expect(replacement.visibilityListenerCount(), 'the replaced slot was left subscribed')
                .to.equal(0);
        });

        it('leaves the current slot subscribed', () => {
            const current = makeSlot();
            tab.attach(current);
            expect(current.visibilityListenerCount()).to.equal(1);
        });
    });

    it('re-points its subscription when the surface changes session', () => {
        // A surface can be aimed at another conversation. Subscribing again without
        // dropping the first would double every window update it renders.
        tab.setSessionHost(host('host#3', 'session-other'));

        workspace.setActiveFilePath('src/extension.ts');

        expect(activeFilesSeen(tabSlot)).to.have.lengthOf(1);
    });
});
