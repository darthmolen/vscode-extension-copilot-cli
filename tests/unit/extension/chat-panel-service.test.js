/**
 * v3.13.0 Task 7 phase 3 — chat in an editor tab.
 *
 * The collision rule is the load-bearing part, and it is a *decision*, not a
 * discovery. The parent plan says one session, one live surface, never mirrored,
 * and `attachSurface` replaces for that reason. So the mechanism is
 * `registry.get()` before creating: if a session already has a live surface,
 * reveal that one. The registry's two-hosts-claim-one-session warning is the
 * backstop behind it, not the mechanism.
 *
 * `SubagentPanelService` is the cautionary tale for the other half: it passes
 * `{ enableScripts, retainContextWhenHidden }` and nothing else, which is exactly
 * why it cannot load `dist/webview` assets. A chat panel must get the same
 * resource roots as the sidebar or it renders nothing.
 */

const { describe, it, beforeEach } = require('mocha');
const { expect } = require('chai');
const path = require('path');

const { ChatPanelService } = require(
    path.join(__dirname, '../../..', 'out', 'extension', 'webview', 'chatPanelService.js')
);

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function makePanel() {
    const panel = {
        revealed: [],
        disposed: false,
        title: '',
        webview: { options: {}, html: '' },
        reveal(column, preserveFocus) { this.revealed.push({ column, preserveFocus }); },
        dispose() { this.disposed = true; panel._disposeListeners.forEach(l => l()); },
        onDidDispose(l) { panel._disposeListeners.push(l); return { dispose() {} }; },
        onDidChangeViewState() { return { dispose() {} }; },
        _disposeListeners: []
    };
    return panel;
}

/** A surface stand-in: records what it was pointed at and whether it was shown. */
function makeSurface() {
    return {
        attached: null,
        host: null,
        shown: 0,
        disposed: false,
        attach(slot) { this.attached = slot; },
        setSessionHost(host) { this.host = host; },
        show() { this.shown++; },
        dispose() { this.disposed = true; }
    };
}

function makeHost(sessionId, over = {}) {
    return {
        sessionId,
        handle: 'host#x',
        started: 0,
        surface: undefined,
        attachSurface(surface) { this.surface = surface; },
        getSurface() { return this.surface; },
        detachSurface(surface) { if (!surface || this.surface === surface) { this.surface = undefined; } },
        ensureStarted() { this.started++; return Promise.resolve(); },
        ...over
    };
}

describe('ChatPanelService', () => {
    let created, panels, registry, surfaces, hostsById, service, revealedExisting;

    beforeEach(() => {
        created = [];
        panels = [];
        surfaces = [];
        hostsById = new Map();
        revealedExisting = [];

        registry = {
            get: (id) => hostsById.get(id),
            created: [],
            create(sessionId, state, options) {
                const host = makeHost(sessionId, {});
                registry.created.push({ sessionId, options });
                if (sessionId) { hostsById.set(sessionId, host); }
                return host;
            },
            async getOrCreate(sessionId) {
                return hostsById.get(sessionId) ?? registry.create(sessionId);
            }
        };

        service = new ChatPanelService({
            logger: silentLogger,
            registry,
            createPanel: (viewType, title, options) => {
                const panel = makePanel();
                panel.title = title;
                created.push({ viewType, title, options });
                panels.push(panel);
                return panel;
            },
            createSurface: () => {
                const surface = makeSurface();
                surfaces.push(surface);
                return surface;
            },
            resourceRoots: () => [{ fsPath: '/ext' }, { fsPath: '/tmp' }],
            makeSlot: (panel) => ({ webview: panel.webview, onDidDispose: panel.onDidDispose }),
            registerHandlers: () => ({ dispose() {} }),
            loadTranscript: async (sessionId, host) => { revealedExisting.push(['load', sessionId, host]); }
        });
    });

    describe('opening a new tab', () => {
        it('builds a host that means *new session*, not the window default', async () => {
            await service.openNew();

            expect(registry.created).to.have.lengthOf(1);
            expect(registry.created[0].sessionId).to.equal(null);
            expect(registry.created[0].options.whenNoSession).to.equal('new');
        });

        it('gives the panel the same resource roots as the sidebar', async () => {
            await service.openNew();

            expect(created[0].options.localResourceRoots).to.have.lengthOf(2);
            expect(created[0].options.enableScripts).to.equal(true);
        });

        it('points the host and the surface at each other', async () => {
            await service.openNew();

            const [surface] = surfaces;
            expect(surface.host).to.not.equal(null);
            expect(surface.host.getSurface()).to.equal(surface);
            expect(surface.attached.webview).to.equal(panels[0].webview);
        });

        it('starts the session the surface is going to show', async () => {
            await service.openNew();

            expect(surfaces[0].host.started).to.equal(1);
        });

        it('opens a second tab rather than reusing the first — each is a new session', async () => {
            await service.openNew();
            await service.openNew();

            expect(panels).to.have.lengthOf(2);
        });
    });

    describe('opening a tab for a session that already exists', () => {
        it('reveals the surface already showing it instead of making a second', async () => {
            const existing = makeHost('live-one');
            const alreadyShowing = makeSurface();
            existing.attachSurface(alreadyShowing);
            hostsById.set('live-one', existing);

            await service.openSession('live-one');

            expect(panels).to.have.lengthOf(0, 'one session, one live surface — never mirrored');
            expect(alreadyShowing.shown).to.equal(1);
        });

        it('opens a tab when the session has a host but nothing rendering it', async () => {
            hostsById.set('cold-one', makeHost('cold-one'));

            await service.openSession('cold-one');

            expect(panels).to.have.lengthOf(1);
            expect(surfaces[0].host.sessionId).to.equal('cold-one');
        });

        it('replays the session\'s transcript into that session\'s host', async () => {
            hostsById.set('cold-one', makeHost('cold-one'));

            await service.openSession('cold-one');

            expect(revealedExisting[0][0]).to.equal('load');
            expect(revealedExisting[0][1]).to.equal('cold-one');
            expect(revealedExisting[0][2]).to.equal(surfaces[0].host);
        });

        it('starts a session nobody has opened in this window yet', async () => {
            await service.openSession('never-seen');

            expect(panels).to.have.lengthOf(1);
            expect(surfaces[0].host.started).to.equal(1);
        });
    });

    describe('restoring a tab after a window reload', () => {
        /** A panel VS Code hands back, not one we created. */
        function restoredPanel() {
            const panel = makePanel();
            panels.push(panel);
            return panel;
        }

        it('reopens the session the tab was showing', async () => {
            const panel = restoredPanel();

            await service.restore(panel, { sessionId: 'was-showing-this' });

            expect(panel.disposed).to.equal(false);
            expect(surfaces[0].host.sessionId).to.equal('was-showing-this');
            expect(surfaces[0].attached.webview).to.equal(panel.webview);
        });

        it('replays that session\'s transcript, rather than a persisted copy', async () => {
            await service.restore(restoredPanel(), { sessionId: 'was-showing-this' });

            expect(revealedExisting[0].slice(0, 2)).to.deep.equal(['load', 'was-showing-this']);
        });

        it('starts the session it restored', async () => {
            await service.restore(restoredPanel(), { sessionId: 'was-showing-this' });

            expect(surfaces[0].host.started).to.equal(1);
        });

        it('keeps the tab and starts a fresh conversation when the session is already on screen', async () => {
            // Reachable for the first time by the serializer: a window can restore a
            // tab for a session the sidebar has meanwhile resumed. A host writes to
            // one surface, so binding a second would render nothing — but the tab
            // itself is there because the *user* had it open. Empty it, don't kill it.
            const existing = makeHost('double-booked');
            const alreadyShowing = makeSurface();
            existing.attachSurface(alreadyShowing);
            hostsById.set('double-booked', existing);
            const panel = restoredPanel();

            await service.restore(panel, { sessionId: 'double-booked' });

            expect(panel.disposed).to.equal(false, 'VS Code restored this tab because the user had it open');
            expect(surfaces).to.have.lengthOf(1);
            expect(surfaces[0].host).to.not.equal(existing, 'one session, one live surface');
            expect(registry.created[0].options.whenNoSession).to.equal('new');
        });

        it('does not yank focus to the surface already showing that session', async () => {
            const existing = makeHost('double-booked');
            const alreadyShowing = makeSurface();
            existing.attachSurface(alreadyShowing);
            hostsById.set('double-booked', existing);

            await service.restore(restoredPanel(), { sessionId: 'double-booked' });

            expect(alreadyShowing.shown).to.equal(0,
                'restore runs during activation — stealing focus there is not the user asking');
        });

        it('keeps a tab whose serialized state has no session id', async () => {
            const panel = restoredPanel();

            await service.restore(panel, {});

            expect(panel.disposed).to.equal(false);
            expect(surfaces).to.have.lengthOf(1);
            expect(surfaces[0].host.sessionId).to.equal(null);
        });

        it('replays nothing into a tab it could not bind', async () => {
            await service.restore(restoredPanel(), {});

            expect(revealedExisting).to.have.lengthOf(0);
        });

        it('survives serialized state from another version entirely', async () => {
            // The state is JSON written by a possibly older build — untrusted input.
            for (const state of [undefined, null, 'a string', 42, { sessionId: 42 }, { sessionId: '' }]) {
                const panel = restoredPanel();
                await service.restore(panel, state);
                expect(panel.disposed).to.equal(false, `state ${JSON.stringify(state)} should keep the tab`);
            }
            expect(surfaces).to.have.lengthOf(6, 'each restored tab gets its own fresh conversation');
        });

        it('restores with no freshness gate — an old tab still gets its session back', async () => {
            // Decided, not omitted. Claude Code's serializer persists `sessionUpdatedAt`
            // and rebinds only within ten minutes, so a tab left open for a week comes
            // back empty. We do the opposite: a tab pinned to a session is a standing
            // instruction, and age is not a reason to ignore it.
            await service.restore(restoredPanel(), { sessionId: 'untouched-for-a-month' });

            expect(surfaces[0].host.sessionId).to.equal('untouched-for-a-month');
        });
    });

    describe('closing a tab', () => {
        it('disposes the surface with the panel', async () => {
            await service.openNew();

            panels[0].dispose();

            expect(surfaces[0].disposed).to.equal(true);
        });

        it('lets a session be reopened after its tab is closed', async () => {
            await service.openSession('reopen-me');
            panels[0].dispose();

            await service.openSession('reopen-me');

            expect(panels).to.have.lengthOf(2, 'a closed tab must not leave the session unreachable');
        });
    });
});
