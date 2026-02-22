#!/usr/bin/env node

/**
 * ACP Spike — Validate unknown ACP capabilities with live CLI
 *
 * IMPORTANT: ACP uses NDJSON framing (newline-delimited JSON), NOT LSP Content-Length headers.
 * Transport: stdio via --acp --stdio flags.
 *
 * Run all spikes:   node tests/harness/acp-spike.mjs
 * Run one spike:    node tests/harness/acp-spike.mjs --only cancel
 * Custom CLI:       node tests/harness/acp-spike.mjs --cli-path /usr/local/bin/copilot
 * Verbose:          node tests/harness/acp-spike.mjs --verbose
 *
 * Spike areas:
 *   model       — model selection in session/new
 *   events      — session/update event vocabulary
 *   cancel      — session/cancel mid-stream
 *   attachments — attachments in session/prompt
 *   tools       — custom tool registration
 *   mcp         — MCP server config format
 */

import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';

// ─── CLI Parsing ────────────────────────────────────────────────

function parseArgs(argv) {
    const args = argv.slice(2);
    const opts = {
        only: null,
        cliPath: null,
        verbose: args.includes('--verbose'),
    };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--only' && args[i + 1]) opts.only = args[++i];
        if (args[i] === '--cli-path' && args[i + 1]) opts.cliPath = args[++i];
    }
    return opts;
}

// ─── Logger ─────────────────────────────────────────────────────

function createLogger(verbose) {
    const start = Date.now();
    return {
        log(label, message) {
            const elapsed = Date.now() - start;
            console.log(`[${String(elapsed).padStart(6)}ms] ${label}: ${message}`);
        },
        verbose(label, message) {
            if (verbose) {
                const elapsed = Date.now() - start;
                console.log(`[${String(elapsed).padStart(6)}ms]   ${label}: ${message}`);
            }
        },
        error(label, message) {
            const elapsed = Date.now() - start;
            console.error(`[${String(elapsed).padStart(6)}ms] ERROR ${label}: ${message}`);
        },
        elapsed() { return Date.now() - start; },
    };
}

// ─── CLI Resolution ─────────────────────────────────────────────

function resolveCliPath(override) {
    if (override) return override;
    try {
        const cmd = process.platform === 'win32' ? 'where' : 'which';
        return execFileSync(cmd, ['copilot'], { encoding: 'utf-8', timeout: 5000 }).trim().split(/\r?\n/)[0];
    } catch {
        throw new Error('Copilot CLI not found on PATH. Use --cli-path to specify.');
    }
}

// ─── NDJSON over Stdio Transport ───────────────────────────────

/**
 * Create an NDJSON JSON-RPC connection over stdio to CLI --acp --stdio
 */
async function createAcpConnection(cliPath, log, extraCliArgs = []) {
    const args = ['--acp', '--stdio', '--no-auto-update', ...extraCliArgs];

    log.verbose('spawn', `${cliPath} ${args.join(' ')}`);
    const proc = spawn(cliPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd(),
        env: { ...process.env },
    });

    const stderrLines = [];
    proc.stderr.on('data', (d) => {
        d.toString().split('\n').filter(l => l.trim()).forEach(l => {
            stderrLines.push(l);
            log.verbose('stderr', l);
        });
    });

    let exited = false;
    proc.on('exit', (code) => { exited = true; log.verbose('proc', `exited code=${code}`); });

    // Brief wait for process to start
    await new Promise(r => setTimeout(r, 500));
    if (exited) throw new Error('CLI exited immediately. stderr: ' + stderrLines.join('\n'));

    // NDJSON reader over stdout
    const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });
    const pendingRequests = new Map();
    const notificationHandlers = [];
    const requestHandlers = new Map(); // method -> handler
    let nextId = 1;

    rl.on('line', (line) => {
        if (!line.trim()) return;
        try {
            const msg = JSON.parse(line);
            log.verbose('recv', JSON.stringify(msg).slice(0, 300));

            if (msg.id !== undefined && msg.id !== null && pendingRequests.has(msg.id)) {
                // Response to our request
                const { resolve, reject } = pendingRequests.get(msg.id);
                pendingRequests.delete(msg.id);
                if (msg.error) reject(new Error(JSON.stringify(msg.error)));
                else resolve(msg.result);
            } else if (msg.method && msg.id !== undefined && msg.id !== null) {
                // Server request (e.g., session/request_permission, tools/call)
                const handler = requestHandlers.get(msg.method);
                if (handler) {
                    Promise.resolve(handler(msg.params, msg.id)).then(result => {
                        const response = JSON.stringify({ jsonrpc: '2.0', id: msg.id, result });
                        log.verbose('respond', response.slice(0, 300));
                        proc.stdin.write(response + '\n');
                    }).catch(err => {
                        proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -1, message: err.message } }) + '\n');
                    });
                } else {
                    log.verbose('unhandled-request', `${msg.method}: ${JSON.stringify(msg.params).slice(0, 200)}`);
                    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }) + '\n');
                }
            } else if (msg.method) {
                // Notification (no id)
                for (const handler of notificationHandlers) {
                    handler(msg);
                }
            }
        } catch (e) {
            log.error('parse', `Failed to parse: ${line.slice(0, 200)}`);
        }
    });

    function sendRequest(method, params, timeoutMs = 60000) {
        const id = nextId++;
        const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
        log.verbose('send', body.slice(0, 300));
        proc.stdin.write(body + '\n');
        return new Promise((resolve, reject) => {
            pendingRequests.set(id, { resolve, reject });
            setTimeout(() => {
                if (pendingRequests.has(id)) {
                    pendingRequests.delete(id);
                    reject(new Error(`${method} timed out after ${timeoutMs}ms`));
                }
            }, timeoutMs);
        });
    }

    function sendNotification(method, params) {
        const body = JSON.stringify({ jsonrpc: '2.0', method, params });
        log.verbose('notify', body.slice(0, 300));
        proc.stdin.write(body + '\n');
    }

    function onNotification(callback) {
        notificationHandlers.push(callback);
        return { dispose() { const i = notificationHandlers.indexOf(callback); if (i >= 0) notificationHandlers.splice(i, 1); } };
    }

    function onRequest(method, handler) {
        requestHandlers.set(method, handler);
        return { dispose() { requestHandlers.delete(method); } };
    }

    const cleanup = () => {
        try { rl.close(); } catch {}
        try { proc.kill('SIGTERM'); } catch {}
    };

    // Auto-approve permissions with correct ACP format: double-nested outcome
    onRequest('session/request_permission', (params) => {
        const title = params?.toolCall?.title || 'unknown';
        log.verbose('permission', `Auto-approving: ${title}`);
        const allowOption = params?.options?.find(o => o.kind === 'allow_once') || params?.options?.[0];
        return {
            outcome: {
                outcome: 'selected',
                optionId: allowOption?.optionId || 'allow_once',
            },
        };
    });

    // Initialize handshake
    const initResult = await sendRequest('initialize', {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: 'acp-spike', version: '1.0.0' },
    }, 15000);
    log.verbose('init', JSON.stringify(initResult).slice(0, 300));

    return { sendRequest, sendNotification, onNotification, onRequest, cleanup, initResult, proc };
}

/**
 * Create session helper
 */
async function createSession(conn, extraParams = {}, log) {
    const params = { cwd: process.cwd(), mcpServers: [], ...extraParams };
    log.verbose('session/new', `params: ${JSON.stringify(params).slice(0, 300)}`);
    return conn.sendRequest('session/new', params, 15000);
}

/**
 * Send prompt and collect all updates
 */
async function sendPromptAndCollect(conn, sessionId, promptText, log, timeoutMs = 90000) {
    const updates = [];
    const disp = conn.onNotification((msg) => {
        if (msg.method === 'session/update' && msg.params?.sessionId === sessionId) {
            updates.push(msg.params);
            log.verbose('update', JSON.stringify(msg.params).slice(0, 200));
        }
    });

    const result = await conn.sendRequest('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: promptText }],
    }, timeoutMs);

    disp.dispose();
    return { result, updates };
}

// ─── Spike Results ──────────────────────────────────────────────

const results = [];

function recordResult(name, status, details) {
    results.push({ name, status, details });
    const icon = status === 'PASS' ? '\x1b[32m PASS\x1b[0m'
        : status === 'FAIL' ? '\x1b[31m FAIL\x1b[0m'
        : '\x1b[33m SKIP\x1b[0m';
    console.log(`\n${icon} ${name}`);
    if (details) console.log(`       ${details}`);
}

// ─── Spike: Model Selection ─────────────────────────────────────

async function spikeModelSelection(cliPath, log) {
    console.log('\n══════════════════════════════════════════════════');
    console.log('  SPIKE: Model Selection in session/new');
    console.log('══════════════════════════════════════════════════');

    const conn = await createAcpConnection(cliPath, log);

    try {
        // Test 1: Default model
        log.log('test', 'session/new without model param...');
        const s1 = await createSession(conn, {}, log);
        const models = s1.models;
        recordResult('model:default', 'PASS',
            `currentModelId: ${models?.currentModelId}, ${models?.availableModels?.length} models available`);
        log.log('ref', `Models: ${JSON.stringify(models?.availableModels?.map(m => m.modelId))}`);

        // Test 2: With explicit model
        log.log('test', 'session/new with model: gpt-4.1...');
        const s2 = await createSession(conn, { model: 'gpt-4.1' }, log);
        recordResult('model:explicit', 'PASS',
            `Requested gpt-4.1, currentModelId: ${s2.models?.currentModelId}`);

        // Test 3: Invalid model
        log.log('test', 'session/new with invalid model...');
        try {
            const s3 = await createSession(conn, { model: 'nonexistent-xyz' }, log);
            recordResult('model:invalid', 'PASS',
                `Accepted invalid model (fallback). currentModelId: ${s3.models?.currentModelId}`);
        } catch (err) {
            recordResult('model:invalid', 'PASS', `Rejected: ${err.message.slice(0, 100)}`);
        }

    } finally {
        conn.cleanup();
    }
}

// ─── Spike: Event Vocabulary ────────────────────────────────────

async function spikeEventVocabulary(cliPath, log) {
    console.log('\n══════════════════════════════════════════════════');
    console.log('  SPIKE: session/update Event Vocabulary');
    console.log('══════════════════════════════════════════════════');

    const conn = await createAcpConnection(cliPath, log);

    try {
        const session = await createSession(conn, {}, log);
        const sessionId = session.sessionId;

        // Prompt that triggers tool use (ls or file listing)
        log.log('test', 'Sending prompt to trigger tool events...');
        const { result, updates } = await sendPromptAndCollect(
            conn, sessionId,
            'List the files in the current directory using ls. Show me the output.',
            log, 90000,
        );

        // Catalog update types
        const updateTypes = {};
        for (const u of updates) {
            const type = u.update?.sessionUpdate || 'unknown';
            if (!updateTypes[type]) updateTypes[type] = [];
            updateTypes[type].push(u);
        }

        log.log('result', `Total updates: ${updates.length}`);
        log.log('result', `Unique types: ${Object.keys(updateTypes).join(', ')}`);
        log.log('result', `stopReason: ${result?.stopReason}`);

        for (const [type, events] of Object.entries(updateTypes)) {
            log.log(`type:${type}`, `count=${events.length}`);
            // Show first and last sample of each type
            log.log(`  sample`, JSON.stringify(events[0]).slice(0, 400));
            if (events.length > 1) {
                log.log(`  last`, JSON.stringify(events[events.length - 1]).slice(0, 400));
            }
        }

        recordResult('events:vocabulary', 'PASS',
            `Types: [${Object.keys(updateTypes).join(', ')}] from ${updates.length} updates`);

        // Log full result
        log.log('ref', `Final result: ${JSON.stringify(result).slice(0, 500)}`);

    } finally {
        conn.cleanup();
    }
}

// ─── Spike: Cancel ──────────────────────────────────────────────

async function spikeCancel(cliPath, log) {
    console.log('\n══════════════════════════════════════════════════');
    console.log('  SPIKE: session/cancel');
    console.log('══════════════════════════════════════════════════');

    const conn = await createAcpConnection(cliPath, log);

    try {
        const session = await createSession(conn, {}, log);
        const sessionId = session.sessionId;

        // Test 1: Cancel mid-stream
        log.log('test', 'Cancel mid-stream...');
        const updates = [];
        const disp = conn.onNotification((msg) => {
            if (msg.method === 'session/update' && msg.params?.sessionId === sessionId) {
                updates.push(msg.params);
            }
        });

        // Send long prompt
        const promptPromise = conn.sendRequest('session/prompt', {
            sessionId,
            prompt: [{ type: 'text', text: 'Write a very long essay about the history of computing from the 1940s to today. Include detailed information about each decade, major breakthroughs, key figures, and technological milestones. Make it at least 30 paragraphs.' }],
        }, 120000);

        // Wait for some streaming
        await new Promise((resolve) => {
            const check = setInterval(() => {
                if (updates.length >= 3) { clearInterval(check); resolve(); }
            }, 50);
            setTimeout(() => { clearInterval(check); resolve(); }, 15000);
        });

        log.log('test', `Got ${updates.length} updates before cancel`);

        // Send cancel as NOTIFICATION per ACP spec (no id, no response expected)
        log.log('test', 'Sending session/cancel notification...');
        conn.sendNotification('session/cancel', { sessionId });
        log.log('test', 'Cancel notification sent');

        // Wait for prompt to resolve (should stop early)
        try {
            const promptResult = await Promise.race([
                promptPromise,
                new Promise((_, rej) => setTimeout(() => rej(new Error('post-cancel timeout')), 15000)),
            ]);
            log.log('test', `Prompt result after cancel: ${JSON.stringify(promptResult).slice(0, 200)}`);
            recordResult('cancel:mid-stream', 'PASS',
                `Cancelled after ${updates.length} chunks. stopReason: ${promptResult?.stopReason}`);
        } catch (promptErr) {
            recordResult('cancel:mid-stream', 'PASS',
                `Prompt ended after cancel (${promptErr.message.slice(0, 100)}). ${updates.length} chunks received`);
        }

        disp.dispose();

        // Test 2: Cancel with no active prompt (send as notification)
        log.log('test', 'Cancel with no active prompt...');
        conn.sendNotification('session/cancel', { sessionId });
        // Wait briefly to see if anything happens
        await new Promise(r => setTimeout(r, 1000));
        recordResult('cancel:idle', 'PASS', 'Notification sent with no active prompt (no crash)');

        // Test 3: Can we send another prompt after cancel?
        log.log('test', 'Prompt after cancel...');
        try {
            const { result: postResult } = await sendPromptAndCollect(
                conn, sessionId,
                'Say exactly: still alive',
                log, 30000,
            );
            recordResult('cancel:post-prompt', 'PASS', `stopReason: ${postResult?.stopReason}`);
        } catch (err) {
            recordResult('cancel:post-prompt', 'FAIL', err.message);
        }

    } finally {
        conn.cleanup();
    }
}

// ─── Spike: Attachments ─────────────────────────────────────────

async function spikeAttachments(cliPath, log) {
    console.log('\n══════════════════════════════════════════════════');
    console.log('  SPIKE: Attachments in session/prompt');
    console.log('══════════════════════════════════════════════════');

    const conn = await createAcpConnection(cliPath, log);

    try {
        const session = await createSession(conn, {}, log);
        const sessionId = session.sessionId;

        // Test 1: Basic text prompt (baseline)
        log.log('test', 'Basic text prompt...');
        try {
            const { result } = await sendPromptAndCollect(conn, sessionId, 'What is 2+2?', log, 30000);
            recordResult('attach:basic-text', 'PASS', `stopReason: ${result?.stopReason}`);
        } catch (err) {
            recordResult('attach:basic-text', 'FAIL', err.message);
        }

        // Test 2: Resource link in prompt array (per ACP spec: resource_link content type)
        log.log('test', 'Prompt with resource_link...');
        try {
            const updates = [];
            const disp = conn.onNotification((msg) => {
                if (msg.method === 'session/update') updates.push(msg.params);
            });
            const result = await conn.sendRequest('session/prompt', {
                sessionId,
                prompt: [
                    { type: 'text', text: 'Summarize this file in one sentence.' },
                    { type: 'resource_link', uri: `file://${process.cwd()}/package.json`, name: 'package.json' },
                ],
            }, 30000);
            disp.dispose();
            recordResult('attach:resource-link', 'PASS',
                `Accepted. stopReason: ${result?.stopReason}, updates: ${updates.length}`);
        } catch (err) {
            recordResult('attach:resource-link', 'FAIL', err.message);
        }

        // Test 3: Resource content type (embedded resource)
        log.log('test', 'Prompt with resource (embedded content)...');
        try {
            const result = await conn.sendRequest('session/prompt', {
                sessionId,
                prompt: [
                    { type: 'text', text: 'What does this file contain?' },
                    { type: 'resource', resource: { uri: `file://${process.cwd()}/package.json`, text: '{"name":"test"}', mimeType: 'application/json' } },
                ],
            }, 30000);
            recordResult('attach:resource-embedded', 'PASS', `stopReason: ${result?.stopReason}`);
        } catch (err) {
            recordResult('attach:resource-embedded', 'FAIL', err.message);
        }

        // Test 4: Inline image (tiny 1x1 red PNG)
        log.log('test', 'Prompt with inline base64 image...');
        try {
            const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
            const result = await conn.sendRequest('session/prompt', {
                sessionId,
                prompt: [
                    { type: 'text', text: 'What do you see in this image?' },
                    { type: 'image', data: tinyPng, mimeType: 'image/png' },
                ],
            }, 30000);
            recordResult('attach:inline-image', 'PASS', `stopReason: ${result?.stopReason}`);
        } catch (err) {
            recordResult('attach:inline-image', 'FAIL', err.message);
        }

    } finally {
        conn.cleanup();
    }
}

// ─── Spike: Custom Tools ────────────────────────────────────────

async function spikeCustomTools(cliPath, log) {
    console.log('\n══════════════════════════════════════════════════');
    console.log('  SPIKE: Custom Tool Registration');
    console.log('══════════════════════════════════════════════════');

    const conn = await createAcpConnection(cliPath, log);

    try {
        // Test 1: Pass tools in session/new
        log.log('test', 'session/new with custom tools...');
        try {
            const toolDef = {
                name: 'get_weather',
                description: 'Get current weather for a city',
                inputSchema: {
                    type: 'object',
                    properties: {
                        city: { type: 'string', description: 'City name' },
                    },
                    required: ['city'],
                },
            };

            const session = await createSession(conn, { tools: [toolDef] }, log);
            recordResult('tools:registration-tools', 'PASS',
                `tools param accepted. Session: ${session.sessionId}`);

            // Register handler for tool calls from server
            const toolCalls = [];
            conn.onRequest('tools/call', (params) => {
                log.log('tool-call', `Received: ${JSON.stringify(params).slice(0, 300)}`);
                toolCalls.push(params);
                return {
                    content: [{ type: 'text', text: JSON.stringify({ temperature: 72, conditions: 'sunny' }) }],
                };
            });

            // Send prompt that should trigger tool
            log.log('test', 'Triggering custom tool...');
            const { result, updates } = await sendPromptAndCollect(
                conn, session.sessionId,
                'What is the weather in San Francisco? You must use the get_weather tool.',
                log, 60000,
            );
            recordResult('tools:invocation', toolCalls.length > 0 ? 'PASS' : 'FAIL',
                `Tool calls: ${toolCalls.length}, stopReason: ${result?.stopReason}, updates: ${updates.length}`);

            // Log tool-related update types
            const toolUpdates = updates.filter(u =>
                u.update?.sessionUpdate?.includes('tool') ||
                u.update?.sessionUpdate === 'agent_tool_use' ||
                u.update?.sessionUpdate === 'tool_start' ||
                u.update?.sessionUpdate === 'tool_result'
            );
            log.log('ref', `Tool-related updates: ${toolUpdates.length}`);
            for (const tu of toolUpdates) {
                log.log('tool-update', JSON.stringify(tu).slice(0, 400));
            }

        } catch (err) {
            recordResult('tools:registration-tools', 'FAIL', err.message);

            // Try alternative format
            log.log('test', 'Trying availableTools format...');
            try {
                const session2 = await createSession(conn, {
                    availableTools: [{
                        name: 'get_weather',
                        description: 'Get weather',
                        parameters: { type: 'object', properties: { city: { type: 'string' } } },
                    }],
                }, log);
                recordResult('tools:registration-availableTools', 'PASS', `Session: ${session2.sessionId}`);
            } catch (err2) {
                recordResult('tools:registration-availableTools', 'FAIL', err2.message);
            }
        }

    } finally {
        conn.cleanup();
    }
}

// ─── Spike: MCP Server Config ───────────────────────────────────

async function spikeMcpConfig(cliPath, log) {
    console.log('\n══════════════════════════════════════════════════');
    console.log('  SPIKE: MCP Server Configuration');
    console.log('══════════════════════════════════════════════════');

    const conn = await createAcpConnection(cliPath, log);

    try {
        // Test 1: Empty mcpServers (baseline)
        log.log('test', 'session/new with empty mcpServers[]...');
        const s1 = await createSession(conn, { mcpServers: [] }, log);
        recordResult('mcp:empty-array', 'PASS', `Session: ${s1.sessionId}`);

        // Test 2: Array of server objects
        log.log('test', 'session/new with MCP server array...');
        try {
            const s2 = await createSession(conn, {
                mcpServers: [{
                    name: 'test-server',
                    command: 'echo',
                    args: ['hello'],
                    type: 'stdio',
                }],
            }, log);
            recordResult('mcp:array-format', 'PASS', `Session: ${s2.sessionId}`);
        } catch (err) {
            recordResult('mcp:array-format', 'FAIL', err.message);
        }

        // Test 3: Map format (like Claude's mcp-config.json)
        log.log('test', 'session/new with MCP server map...');
        try {
            const s3 = await createSession(conn, {
                mcpServers: {
                    'test-server': {
                        command: 'echo',
                        args: ['hello'],
                    },
                },
            }, log);
            recordResult('mcp:map-format', 'PASS', `Session: ${s3.sessionId}`);
        } catch (err) {
            recordResult('mcp:map-format', 'FAIL', err.message);
        }

        // Test 4: Array with tools field
        log.log('test', 'session/new with MCP server + tools...');
        try {
            const s4 = await createSession(conn, {
                mcpServers: [{
                    name: 'test-mcp',
                    command: 'echo',
                    args: [],
                    tools: ['*'],
                }],
            }, log);
            recordResult('mcp:with-tools', 'PASS', `Session: ${s4.sessionId}`);
        } catch (err) {
            recordResult('mcp:with-tools', 'FAIL', err.message);
        }

    } finally {
        conn.cleanup();
    }
}

// ─── Main Runner ────────────────────────────────────────────────

const SPIKES = {
    model: spikeModelSelection,
    events: spikeEventVocabulary,
    cancel: spikeCancel,
    attachments: spikeAttachments,
    tools: spikeCustomTools,
    mcp: spikeMcpConfig,
};

async function main() {
    const opts = parseArgs(process.argv);
    const log = createLogger(opts.verbose);
    const cliPath = resolveCliPath(opts.cliPath);

    console.log('ACP Spike Harness (NDJSON over stdio)');
    console.log(`CLI: ${cliPath}`);
    console.log(`Verbose: ${opts.verbose}`);
    console.log(`Only: ${opts.only || 'all'}\n`);

    const spikesToRun = opts.only
        ? { [opts.only]: SPIKES[opts.only] }
        : SPIKES;

    if (opts.only && !SPIKES[opts.only]) {
        console.error(`Unknown spike: ${opts.only}. Available: ${Object.keys(SPIKES).join(', ')}`);
        process.exit(1);
    }

    for (const [name, fn] of Object.entries(spikesToRun)) {
        try {
            await fn(cliPath, log);
        } catch (err) {
            recordResult(`${name}:CRASH`, 'FAIL', `Spike crashed: ${err.message}`);
            log.error(name, err.stack);
        }
    }

    // ─── Summary ────────────────────────────────────────────────
    console.log('\n\n══════════════════════════════════════════════════');
    console.log('  SPIKE RESULTS SUMMARY');
    console.log('══════════════════════════════════════════════════');

    const pass = results.filter(r => r.status === 'PASS');
    const fail = results.filter(r => r.status === 'FAIL');

    for (const r of results) {
        const icon = r.status === 'PASS' ? '\x1b[32m✓\x1b[0m'
            : r.status === 'FAIL' ? '\x1b[31m✗\x1b[0m'
            : '\x1b[33m-\x1b[0m';
        console.log(`  ${icon} ${r.name}: ${r.details || ''}`);
    }

    console.log(`\n  Total: ${results.length} | Pass: ${pass.length} | Fail: ${fail.length}`);
    console.log(`  Elapsed: ${log.elapsed()}ms`);

    process.exit(fail.length > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error(`\nFatal: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
});
