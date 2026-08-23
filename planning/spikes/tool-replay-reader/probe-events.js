/**
 * Spike — does an EXTENSION-created session log tool events the way the P2 reader assumes?
 *
 * The reviewer blocked P2 on this (§7.1): the plan's evidence came from a session
 * the Copilot CLI produced in a terminal, and extension-created sessions run our
 * plan-mode custom tools, which we register ourselves. If those land differently —
 * different field layout, no completes, ids at the top level — the reader is built
 * on the wrong shape.
 *
 * Usage: node probe-events.js <session-id> [...]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

function probe(sessionId) {
    const file = path.join(os.homedir(), '.copilot', 'session-state', sessionId, 'events.jsonl');
    if (!fs.existsSync(file)) { return console.log(`MISSING ${sessionId}`); }

    const starts = new Map(), completes = new Map();
    const startKeys = new Set(), completeKeys = new Set();
    let topLevelToolCallId = 0, customTools = new Map(), agentTagged = 0;

    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) { continue; }
        let e; try { e = JSON.parse(line); } catch { continue; }
        if (e.type === 'tool.execution_start') {
            Object.keys(e.data).forEach(k => startKeys.add(k));
            if (e.toolCallId !== undefined) { topLevelToolCallId++; }
            if (e.agentId) { agentTagged++; }
            starts.set(e.data.toolCallId, e.data.toolName);
            customTools.set(e.data.toolName, (customTools.get(e.data.toolName) || 0) + 1);
        } else if (e.type === 'tool.execution_complete') {
            Object.keys(e.data).forEach(k => completeKeys.add(k));
            completes.set(e.data.toolCallId, e.data.success);
        }
    }

    const matched = [...starts.keys()].filter(id => completes.has(id));
    const orphanStarts = [...starts.keys()].filter(id => !completes.has(id));
    const orphanCompletes = [...completes.keys()].filter(id => !starts.has(id));

    console.log(`\n=== ${sessionId} ===`);
    console.log(`starts=${starts.size} completes=${completes.size} joined=${matched.length}`);
    console.log(`orphan starts (replay as 'running')=${orphanStarts.length}  orphan completes=${orphanCompletes.length}`);
    console.log(`toolCallId at TOP level (not under data)=${topLevelToolCallId}`);
    console.log(`agentId-tagged starts=${agentTagged}`);
    console.log(`start data keys:    ${[...startKeys].sort().join(', ')}`);
    console.log(`complete data keys: ${[...completeKeys].sort().join(', ')}`);
    console.log(`success values: ${[...new Set(completes.values())].map(v => `${v} (${typeof v})`).join(', ')}`);
    console.log(`tools: ${[...customTools.entries()].map(([n, c]) => `${n}×${c}`).join(', ')}`);
}

process.argv.slice(2).forEach(probe);
