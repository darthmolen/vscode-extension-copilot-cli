/**
 * CopilotClientProvider — the client lifecycle, extracted (spine S4)
 *
 * `SDKSessionManager` built, started, stopped and recreated the CopilotClient
 * inline, with the create-and-start sequence duplicated between `start()` and
 * `recreateClient()`. That duplication is the whole reason `_lifecycleListenersAttached`
 * could desync: `recreateClient()` reset it, `stop()` did not.
 *
 * These tests drive the extraction. They inject `createClient`, so nothing here
 * touches the real SDK or spawns a CLI.
 */

const { describe, it, beforeEach } = require('mocha');
const { expect } = require('chai');
const path = require('path');

const { CopilotClientProvider } = require(
    path.join(__dirname, '../../..', 'out', 'extension', 'services', 'CopilotClientProvider.js')
);

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

/**
 * A stand-in for the SDK client. `cliProcess` and `connection` mimic the two
 * internals the lifecycle listeners reach for, so we can assert they were wired.
 */
function makeFakeClient(id, over = {}) {
    const listeners = { stderr: 0, exit: 0, close: 0 };
    return {
        id,
        started: 0,
        stopped: 0,
        listeners,
        async start() { this.started++; },
        async stop() { this.stopped++; },
        cliProcess: {
            stderr: { on: () => { listeners.stderr++; } },
            on: () => { listeners.exit++; }
        },
        connection: { onClose: () => { listeners.close++; } },
        ...over
    };
}

function makeProvider(over = {}) {
    const created = [];
    const deps = {
        logger: silentLogger,
        workingDirectory: '/tmp/workspace',
        resolveCliPath: () => '/tmp/cli/copilot',
        useYolo: () => false,
        createClient: options => {
            const client = makeFakeClient(created.length + 1);
            client.options = options;
            created.push(client);
            return client;
        },
        ...over
    };
    return { created, deps, provider: new CopilotClientProvider(deps) };
}

describe('CopilotClientProvider', () => {
    let ctx;

    beforeEach(() => {
        ctx = makeProvider();
    });

    it('creates and starts a client on first get()', async () => {
        const client = await ctx.provider.get();

        expect(ctx.created).to.have.lengthOf(1);
        expect(client.started, 'client was never started').to.equal(1);
    });

    it('reuses the same client on subsequent get() calls', async () => {
        const first = await ctx.provider.get();
        const second = await ctx.provider.get();

        expect(second).to.equal(first);
        expect(ctx.created, 'created a second client unnecessarily').to.have.lengthOf(1);
    });

    it('builds the client with the resolved CLI path and working directory', async () => {
        const client = await ctx.provider.get();

        expect(client.options.connection.path).to.equal('/tmp/cli/copilot');
        expect(client.options.workingDirectory).to.equal('/tmp/workspace');
    });

    it('passes --yolo only when yolo is enabled', async () => {
        const plain = await ctx.provider.get();
        expect(plain.options.connection.args).to.deep.equal([]);

        const yolo = makeProvider({ useYolo: () => true });
        const client = await yolo.provider.get();
        expect(client.options.connection.args).to.deep.equal(['--yolo']);
    });

    it('recreate() stops the old client and starts a fresh one', async () => {
        const first = await ctx.provider.get();
        const second = await ctx.provider.recreate();

        expect(first.stopped, 'old client was not stopped').to.equal(1);
        expect(second).to.not.equal(first);
        expect(second.started).to.equal(1);
    });

    it('recreate() survives a dead client whose stop() throws', async () => {
        const dead = makeProvider({
            createClient: () => {
                const c = makeFakeClient('dead');
                c.stop = async () => { throw new Error('Connection is closed'); };
                return c;
            }
        });
        await dead.provider.get();

        // The whole point of recreate() is recovering from a dead connection,
        // so a throwing stop() must not prevent the replacement.
        const fresh = await dead.provider.recreate();

        expect(fresh.started).to.equal(1);
    });

    it('stop() stops the client and clears it', async () => {
        const client = await ctx.provider.get();

        await ctx.provider.stop();

        expect(client.stopped).to.equal(1);
        expect(ctx.provider.current, 'client reference survived stop()').to.equal(null);
    });

    it('stop() is safe when no client was ever created', async () => {
        await ctx.provider.stop();

        expect(ctx.provider.current).to.equal(null);
    });

    it('attaches lifecycle listeners to the client it creates', async () => {
        const client = await ctx.provider.get();

        expect(client.listeners.stderr, 'stderr not wired').to.equal(1);
        expect(client.listeners.exit, 'exit not wired').to.equal(1);
        expect(client.listeners.close, 'connection close not wired').to.equal(1);
    });

    it('does not re-attach listeners to a client it already wired', async () => {
        const client = await ctx.provider.get();
        await ctx.provider.get();

        expect(client.listeners.stderr, 'duplicate stderr listener').to.equal(1);
    });

    it('attaches listeners to the replacement client after recreate()', async () => {
        await ctx.provider.get();
        const second = await ctx.provider.recreate();

        expect(second.listeners.stderr).to.equal(1);
        expect(second.listeners.exit).to.equal(1);
    });

    /**
     * The bug this extraction fixes. `SDKSessionManager.stop()` nulled the client
     * but left `_lifecycleListenersAttached` true, so the next start() got a client
     * with no stderr/exit/connection visibility — exactly the diagnostics we added
     * these listeners to get. `restart()` hit this every time.
     */
    it('attaches listeners to the new client after stop() then get()', async () => {
        await ctx.provider.get();
        await ctx.provider.stop();

        const fresh = await ctx.provider.get();

        expect(fresh.listeners.stderr, 'listeners never re-attached after stop()').to.equal(1);
        expect(fresh.listeners.exit).to.equal(1);
        expect(fresh.listeners.close).to.equal(1);
    });

    /**
     * PR #42 review. `create()` assigns `this.client` before awaiting `start()`,
     * so a second caller arriving in that window took the `if (this.client)`
     * fast-path and got a client whose connection was not open yet. Sharing one
     * provider across N managers makes concurrent first-calls the normal case,
     * not an edge case — which is the whole point of the extraction.
     */
    describe('concurrent callers', () => {
        /** A provider whose client cannot finish starting until the gate opens. */
        function gatedProvider() {
            let open;
            const gate = new Promise(resolve => { open = resolve; });
            const created = [];
            const provider = new CopilotClientProvider({
                logger: silentLogger,
                workingDirectory: '/tmp/workspace',
                resolveCliPath: () => '/tmp/cli/copilot',
                useYolo: () => false,
                createClient: () => {
                    const client = makeFakeClient(created.length + 1);
                    const start = client.start.bind(client);
                    client.start = async () => { await gate; await start(); };
                    created.push(client);
                    return client;
                }
            });
            return { provider, created, open: () => open() };
        }

        it('never hands out a client that has not finished starting', async () => {
            const { provider, open } = gatedProvider();

            const first = provider.get();
            // Captured at the moment the second call resolves, not afterwards —
            // otherwise the shared object would have started by assertion time.
            const second = provider.get().then(c => c.started);

            open();
            const [, startedWhenReturned] = await Promise.all([first, second]);

            expect(startedWhenReturned, 'returned a client that was still starting').to.equal(1);
        });

        it('gives concurrent callers the same client', async () => {
            const { provider, created, open } = gatedProvider();

            const both = Promise.all([provider.get(), provider.get()]);
            open();
            const [a, b] = await both;

            expect(a).to.equal(b);
            expect(created, 'spawned more than one client').to.have.lengthOf(1);
        });

        it('recovers after a failed start rather than wedging every later call', async () => {
            let attempt = 0;
            const ctx = makeProvider({
                createClient: () => {
                    const client = makeFakeClient(++attempt);
                    if (attempt === 1) {
                        client.start = async () => { throw new Error('CLI failed to spawn'); };
                    }
                    return client;
                }
            });

            let failed;
            try {
                await ctx.provider.get();
            } catch (error) {
                failed = error;
            }
            expect(failed, 'the first get() should surface the start failure').to.be.an('error');

            // If the in-flight promise were not cleared on failure, this would
            // re-throw the first error forever instead of retrying.
            const client = await ctx.provider.get();
            expect(client.started).to.equal(1);
        });

        it('collapses concurrent recreate() calls into one replacement', async () => {
            const { provider, created, open } = gatedProvider();
            open(); // let the initial client start
            await provider.get();

            const [a, b] = await Promise.all([provider.recreate(), provider.recreate()]);

            expect(a).to.equal(b);
            expect(created, 'two recreates spawned two CLI processes').to.have.lengthOf(2);
        });
    });

    it('runs the onClientStarted hook after the client starts, before returning', async () => {
        const seen = [];
        const hooked = makeProvider({
            onClientStarted: async client => { seen.push(client.started); }
        });

        await hooked.provider.get();

        expect(seen, 'hook did not run').to.have.lengthOf(1);
        expect(seen[0], 'hook ran before start()').to.equal(1);
    });

    it('runs the onClientStarted hook again for a recreated client', async () => {
        let runs = 0;
        const hooked = makeProvider({ onClientStarted: async () => { runs++; } });

        await hooked.provider.get();
        await hooked.provider.recreate();

        expect(runs).to.equal(2);
    });
});
