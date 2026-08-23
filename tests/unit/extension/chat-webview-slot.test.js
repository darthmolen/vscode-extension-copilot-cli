/**
 * v3.13.0 Task 7 phase 1 — the slot seam.
 *
 * A sidebar view and an editor panel differ in four members, not in kind:
 * `ChatViewProvider` touches its VS Code object for `postMessage`,
 * `asWebviewUri`, setting `.html` and an existence check, and every one of those
 * is on `.webview` — the *identical* type on `WebviewView` and `WebviewPanel`.
 * `ChatWebviewSlot` names the four that do differ so one surface class can sit
 * over either.
 *
 * The asymmetry worth encoding is lifetime. The sidebar carried the comment
 * "Don't dispose _view — VS Code owns the sidebar view lifecycle"; a panel is the
 * opposite, the user closes it and it is gone. `closingEndsSurface` says which,
 * so no call site has to remember.
 */

const { describe, it, before, after } = require('mocha');
const { expect } = require('chai');
const path = require('path');
const { installVscodeMock } = require('../../helpers/with-vscode-mock');

/** A vscode stub that records the commands the code under test runs. */
function makeVscodeStub() {
    const executed = [];
    return {
        executed,
        commands: {
            executeCommand: (...args) => { executed.push(args); return Promise.resolve(); },
            registerCommand: () => ({ dispose() {} })
        },
        Uri: { file: (p) => ({ fsPath: p, scheme: 'file' }) },
        workspace: { workspaceFolders: undefined },
        window: {},
        EventEmitter: class {
            constructor() { this.listeners = []; this.event = this.event.bind(this); }
            fire(v) { this.listeners.slice().forEach(l => l(v)); }
            event(listener) {
                this.listeners.push(listener);
                return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
            }
            dispose() { this.listeners = []; }
        }
    };
}

/** Minimal fake events with the `vscode.Event` shape. */
function makeEvent() {
    const listeners = [];
    const event = (listener) => {
        listeners.push(listener);
        return { dispose: () => { const i = listeners.indexOf(listener); if (i > -1) { listeners.splice(i, 1); } } };
    };
    event.fire = () => listeners.slice().forEach(l => l());
    event.listenerCount = () => listeners.length;
    return event;
}

describe('ChatWebviewSlot adapters', () => {
    const stub = makeVscodeStub();
    const mock = installVscodeMock(stub);
    let SidebarSlot, PanelSlot, chatWebviewResourceRoots;

    before(() => {
        mock.install();
        ({ SidebarSlot, PanelSlot, chatWebviewResourceRoots } = require(
            path.join(__dirname, '../../..', 'out', 'extension', 'webview', 'chatWebviewSlot.js')
        ));
    });
    after(() => mock.restore());

    describe('SidebarSlot', () => {
        function makeView() {
            return {
                webview: { id: 'sidebar-webview' },
                visible: true,
                onDidChangeVisibility: makeEvent(),
                onDidDispose: makeEvent()
            };
        }

        it('hands through the view\'s webview, the object every shared call site uses', () => {
            const view = makeView();
            expect(new SidebarSlot(view, 'copilot-cli.chatView').webview).to.equal(view.webview);
        });

        it('reveals by focusing the view, since a sidebar has no reveal()', () => {
            stub.executed.length = 0;
            new SidebarSlot(makeView(), 'copilot-cli.chatView').reveal();

            expect(stub.executed[0][0]).to.equal('copilot-cli.chatView.focus');
        });

        it('reports that closing it does NOT end the surface', () => {
            // VS Code tears the sidebar view down when its container is hidden and
            // re-resolves it later — into the same surface, same session.
            expect(new SidebarSlot(makeView(), 'copilot-cli.chatView').closingEndsSurface).to.equal(false);
        });

        it('forwards visibility changes', () => {
            const view = makeView();
            const slot = new SidebarSlot(view, 'copilot-cli.chatView');
            let seen = 0;
            slot.onDidChangeVisibility(() => { seen++; });

            view.onDidChangeVisibility.fire();

            expect(seen).to.equal(1);
        });

        it('reports the view\'s visibility', () => {
            const view = makeView();
            view.visible = false;
            expect(new SidebarSlot(view, 'copilot-cli.chatView').isVisible).to.equal(false);
        });
    });

    describe('PanelSlot', () => {
        function makePanel() {
            const revealed = [];
            return {
                revealed,
                webview: { id: 'panel-webview' },
                visible: true,
                reveal: (column, preserveFocus) => revealed.push({ column, preserveFocus }),
                onDidChangeViewState: makeEvent(),
                onDidDispose: makeEvent()
            };
        }

        it('hands through the panel\'s webview', () => {
            const panel = makePanel();
            expect(new PanelSlot(panel).webview).to.equal(panel.webview);
        });

        it('reveals the panel itself, preserving focus when asked', () => {
            const panel = makePanel();
            new PanelSlot(panel).reveal(true);

            expect(panel.revealed).to.have.lengthOf(1);
            expect(panel.revealed[0].preserveFocus).to.equal(true);
        });

        it('reports that closing it DOES end the surface', () => {
            expect(new PanelSlot(makePanel()).closingEndsSurface).to.equal(true);
        });

        it('maps the panel\'s view-state event onto visibility', () => {
            // A panel has no onDidChangeVisibility; it has onDidChangeViewState,
            // which also fires for column moves. Surfaces only care about visibility.
            const panel = makePanel();
            const slot = new PanelSlot(panel);
            let seen = 0;
            slot.onDidChangeVisibility(() => { seen++; });

            panel.onDidChangeViewState.fire();

            expect(seen).to.equal(1);
        });

        it('forwards disposal', () => {
            const panel = makePanel();
            const slot = new PanelSlot(panel);
            let closed = 0;
            slot.onDidDispose(() => { closed++; });

            panel.onDidDispose.fire();

            expect(closed).to.equal(1);
        });
    });

    describe('chatWebviewResourceRoots()', () => {
        it('includes the extension, ~/.copilot and the whole tmpdir', () => {
            const roots = chatWebviewResourceRoots({ fsPath: '/ext' }, stub).map(u => u.fsPath);

            expect(roots).to.include('/ext');
            expect(roots.some(p => p.endsWith('.copilot'))).to.equal(true,
                'session-state images live under ~/.copilot');
            expect(roots.some(p => p.includes('tmp'))).to.equal(true,
                'pasted images land in random copilot-paste-<uuid> dirs under tmpdir');
        });

        it('includes every workspace folder', () => {
            const withFolders = {
                ...stub,
                workspace: { workspaceFolders: [{ uri: { fsPath: '/repo-a' } }, { uri: { fsPath: '/repo-b' } }] }
            };
            const roots = chatWebviewResourceRoots({ fsPath: '/ext' }, withFolders).map(u => u.fsPath);

            expect(roots).to.include('/repo-a');
            expect(roots).to.include('/repo-b');
        });
    });
});
