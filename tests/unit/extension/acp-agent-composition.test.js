/**
 * createAcpAgent — the composition root (IN-3)
 *
 * Everything before this was a piece; this is what assembles them. It is the only
 * place that knows a session means "a new SDKSessionManager, started against the
 * shared CopilotClientProvider, wrapped in an SdkSessionBackend".
 *
 * Two things it must get right, both structural rather than behavioural:
 *   - **one provider, N managers** — that is the entire reason S4 extracted the
 *     client lifecycle, and the reason a manager must be *given* a provider rather
 *     than building its own (an owner would stop the shared CLI on close);
 *   - **no `vscode`** — asserted by loading with `require('vscode')` throwing.
 *
 * The manager factory is injected so this spawns no CLI. The real entry point
 * supplies the one that constructs `SDKSessionManager`.
 */

const { describe, it } = require('mocha');
const { expect } = require('chai');
const path = require('path');
const { withoutVscode } = require('../../helpers/without-vscode');

const COMPOSITION_PATH = path.join(__dirname, '../../..', 'out', 'acp', 'createAcpAgent.js');

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

/** A manager stand-in that records which provider it was handed. */
function makeManagerFactory(record) {
    let n = 0;
    return ({ clientProvider, workspaceFolder }) => {
        n += 1;
        const id = `session-${n}`;
        record.push({ clientProvider, workspaceFolder, sessionId: id });
        return {
            async start() {},
            getSessionId: () => id,
            async sendMessage() {},
            onDidMessageDelta: () => ({ dispose() {} })
        };
    };
}

function build(over = {}) {
    const { createSessionStarter } = withoutVscode(() => require(COMPOSITION_PATH));
    const built = [];
    const clientProvider = { id: 'the-one-provider' };
    const startSession = createSessionStarter({
        logger: silentLogger,
        globalStorageDir: '/tmp/agent-storage',
        workspaceFolder: '/tmp/agent-workspace',
        clientProvider,
        createManager: makeManagerFactory(built),
        ...over
    });
    return { startSession, built, clientProvider };
}

describe('createAcpAgent — composition root (IN-3)', () => {
    it('builds a session starter with the vscode module absent', () => {
        const { startSession } = build();

        expect(startSession).to.be.a('function');
    });

    it('exposes createAcpAgent, which registers on an acp AgentApp', () => {
        const { createAcpAgent } = withoutVscode(() => require(COMPOSITION_PATH));

        const agent = createAcpAgent({
            logger: silentLogger,
            globalStorageDir: '/tmp/agent-storage',
            clientProvider: {},
            createManager: makeManagerFactory([])
        });

        expect(agent.register, 'must be registerable on an acp AgentApp').to.be.a('function');
    });

    it('creates one manager per session', async () => {
        const { startSession, built } = build();

        await startSession({ cwd: '/tmp/w' });
        await startSession({ cwd: '/tmp/w' });

        expect(built).to.have.lengthOf(2);
        expect(built[1].sessionId).to.not.equal(built[0].sessionId);
    });

    /**
     * The S4 payoff, and the reason this is worth a test rather than a comment:
     * every manager must receive the SAME provider instance. If each built its own,
     * N sessions would spawn N CLI processes, and the first session to close would
     * stop a client the others were still using.
     */
    it('gives every manager the same client provider', async () => {
        const { startSession, built, clientProvider } = build();

        await startSession({ cwd: '/tmp/w' });
        await startSession({ cwd: '/tmp/w' });

        expect(built.map(b => b.clientProvider)).to.deep.equal([clientProvider, clientProvider]);
    });

    it("uses the session's cwd as the manager's workspace", async () => {
        const { startSession, built } = build();

        await startSession({ cwd: '/tmp/a-specific-repo' });

        expect(built[0].workspaceFolder).to.equal('/tmp/a-specific-repo');
    });

    it('returns a backend carrying the manager session id', async () => {
        const { startSession } = build();

        const backend = await startSession({ cwd: '/tmp/w' });

        expect(backend.sessionId).to.equal('session-1');
        expect(backend.prompt, 'must satisfy AcpSessionBackend').to.be.a('function');
        expect(backend.onOutput).to.be.a('function');
    });
});
