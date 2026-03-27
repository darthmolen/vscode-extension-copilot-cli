/**
 * Spike: Node.js equivalent of spike_intersection_theory.py
 *
 * Tests whether customAgents[n].tools enforces per-agent tool restriction,
 * or whether only availableTools provides hard enforcement.
 *
 * Mirror of the Python spike in spike_intersection_theory.py, written for
 * the Node.js SDK used by this extension.
 *
 * Run with: node --experimental-vm-modules spike_node_intersection.mjs
 * Requires: @github/copilot-sdk installed, copilot CLI on PATH
 *
 * Expected results based on Python SDK empirical findings:
 *   Test 1 (availableTools=[grep,web_fetch], agent.tools=null):
 *     → agent sees grep + web_fetch  (availableTools enforced)
 *   Test 2 (availableTools=[grep,web_fetch], agent.tools=["grep"]):
 *     → if intersection:  agent sees grep only
 *     → if advisory only: agent sees grep + web_fetch  ← Python spike result
 *   Test 3 (availableTools=null, agent.tools=["grep","view"]):
 *     → if agent.tools enforces: agent sees grep + view only
 *     → if advisory only:        agent sees ALL tools   ← Python spike result
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT = 'List ALL tools you have access to. Be exhaustive — name every single tool.';

let CopilotClient, approveAll;
async function loadSDK() {
    const sdk = await import('@github/copilot-sdk');
    CopilotClient = sdk.CopilotClient;
    approveAll = sdk.approveAll;
}

function collectUntilIdle(session, timeoutMs = 120_000) {
    return new Promise((resolve) => {
        const events = [];
        const messages = [];
        let settled = false;

        const cleanup = session.on((event) => {
            const type = typeof event.type === 'string' ? event.type : (event.type?.value ?? String(event.type));
            events.push({ type, data: event.data });

            if (type === 'assistant.message' && event.data?.content) {
                messages.push(event.data.content);
            }
            if (type === 'session.idle' && !settled) {
                settled = true;
                cleanup();
                clearTimeout(timer);
                resolve({ events, messages });
            }
        });

        const timer = setTimeout(() => {
            if (!settled) { settled = true; cleanup(); resolve({ events, messages }); }
        }, timeoutMs);
    });
}

async function runTest(label, { availableTools, agentTools }) {
    console.log('\n' + '='.repeat(60));
    console.log(`TEST: ${label}`);
    console.log(`  session availableTools = ${JSON.stringify(availableTools)}`);
    console.log(`  agent.tools            = ${JSON.stringify(agentTools)}`);
    console.log('='.repeat(60));

    const client = new CopilotClient({
        cwd: process.cwd(),
        autoStart: true,
        cliArgs: ['--no-auto-update'],
    });

    const sessionConfig = {
        onPermissionRequest: approveAll,
        clientName: 'spike-intersection',
        customAgents: [{
            name: 'tester',
            displayName: 'Tool Tester',
            description: 'Lists available tools',
            prompt: 'You are a tool testing agent. When asked, list ALL tools available to you.',
            tools: agentTools,
            infer: false,
        }],
    };

    if (availableTools !== null) {
        sessionConfig.availableTools = availableTools;
    }

    const session = await client.createSession(sessionConfig);
    console.log(`  Session created: ${session.sessionId}`);

    // List agents to confirm registration
    try {
        const agentList = await session.rpc.agent.list();
        console.log(`  rpc.agent.list(): ${JSON.stringify(agentList)}`);
    } catch (e) {
        console.log(`  rpc.agent.list() error: ${e.message}`);
    }

    // Select the agent
    try {
        await session.rpc.agent.select({ name: 'tester' });
        console.log(`  agent selected: tester`);
    } catch (e) {
        console.log(`  [warn] agent.select failed: ${e.message}`);
    }

    const collectPromise = collectUntilIdle(session);
    await session.sendAndWait({ prompt: PROMPT }, 90_000);
    const { events, messages } = await collectPromise;

    const toolEvents = events.filter(e => e.type.includes('tool'));
    console.log(`\n  Tool-related events: ${toolEvents.map(e => e.type).join(', ') || '(none)'}`);
    if (messages.length) {
        console.log(`  Agent response (first 800 chars):\n${messages[messages.length - 1].slice(0, 800)}`);
    } else {
        console.log(`  Agent response: (none — check events)`);
        console.log(`  All event types: ${[...new Set(events.map(e => e.type))].join(', ')}`);
    }

    await session.destroy();
    return { events, messages };
}

async function main() {
    await loadSDK();
    const results = {};

    // Test 1: availableTools restricts session; agent has tools=null (inherit session)
    // Expected: agent sees grep + web_fetch only
    const t1 = await runTest('T1: availableTools=[grep,web_fetch], agent.tools=null', {
        availableTools: ['grep', 'web_fetch'],
        agentTools: null,
    });
    results.test1 = { label: 'availableTools=[grep,web_fetch], agent.tools=null', messages: t1.messages };

    // Test 2: INTERSECTION TEST
    // Does agent.tools=["grep"] further restrict beyond availableTools=[grep,web_fetch]?
    // If intersection: agent sees grep only
    // If advisory:     agent sees grep + web_fetch  ← Python spike result
    const t2 = await runTest('T2: availableTools=[grep,web_fetch], agent.tools=["grep"]', {
        availableTools: ['grep', 'web_fetch'],
        agentTools: ['grep'],
    });
    results.test2 = { label: 'availableTools=[grep,web_fetch], agent.tools=["grep"]', messages: t2.messages };

    // Test 3: No session restriction; agent declares tools=["grep","view"]
    // If agent.tools enforces: agent sees grep + view only
    // If advisory:             agent sees ALL tools  ← Python spike result
    const t3 = await runTest('T3: availableTools=null, agent.tools=["grep","view"]', {
        availableTools: null,
        agentTools: ['grep', 'view'],
    });
    results.test3 = { label: 'availableTools=null, agent.tools=["grep","view"]', messages: t3.messages };

    // Save raw results
    const outPath = join(__dirname, 'spike_node_results.json');
    writeFileSync(outPath, JSON.stringify(results, null, 2));
    console.log(`\nResults saved to: ${outPath}`);

    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log('Python SDK findings:');
    console.log('  T2 — agent.tools=["grep"] did NOT restrict; agent saw grep + web_fetch');
    console.log('  T3 — agent.tools=["grep","view"] did NOT restrict; agent saw ALL tools');
    console.log('\nNode.js results:');
    for (const [k, v] of Object.entries(results)) {
        const resp = v.messages[v.messages.length - 1] ?? '(no response)';
        console.log(`  ${k} [${v.label}]:\n    ${resp.slice(0, 300).replace(/\n/g, '\n    ')}`);
    }
}

main().catch(console.error);
