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
        onDidChangeVisibility: (l) => { visibilityListeners.push(l); return { dispose() {} }; },
        onDidDispose: (l) => { disposeListeners.push(l); return { dispose() {} }; }
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

    it('re-points its subscription when the surface changes session', () => {
        // A surface can be aimed at another conversation. Subscribing again without
        // dropping the first would double every window update it renders.
        tab.setSessionHost(host('host#3', 'session-other'));

        workspace.setActiveFilePath('src/extension.ts');

        expect(activeFilesSeen(tabSlot)).to.have.lengthOf(1);
    });
});
