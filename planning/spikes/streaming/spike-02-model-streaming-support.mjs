#!/usr/bin/env node

/**
 * Spike: Which models support streaming text (assistant.message_delta)?
 *
 * Cycles through every model returned by client.listModels() and sends
 * the same short prompt with streaming: true. Records whether each model
 * produced any assistant.message_delta events.
 *
 * Run:
 *   node planning/spikes/streaming/spike-02-model-streaming-support.mjs
 *
 * Save output:
 *   node planning/spikes/streaming/spike-02-model-streaming-support.mjs \
 *     2>&1 | tee planning/spikes/streaming/results/spike-02-output.txt
 */

const PROMPT = 'Reply with exactly 3 words: "streaming test ok"';
const TIMEOUT_MS = 30_000;

async function loadSDK() {
    const sdk = await import('@github/copilot-sdk');
    return { CopilotClient: sdk.CopilotClient, approveAll: sdk.approveAll };
}

async function testModel(modelId, { CopilotClient, approveAll }) {
    const client = new CopilotClient({
        cwd: process.cwd(),
        autoStart: true,
        cliArgs: ['--no-auto-update', '--yolo'],
    });

    const result = {
        model: modelId,
        deltaCount: 0,
        messageContent: null,
        error: null,
        durationMs: null,
        eventTypes: new Set(),
    };

    const start = Date.now();

    try {
        const session = await client.createSession({
            onPermissionRequest: approveAll,
            clientName: 'vscode-copilot-cli',
            model: modelId,
            streaming: true,
        });

        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Timeout')), TIMEOUT_MS);

            session.on((event) => {
                result.eventTypes.add(event.type);

                if (event.type === 'assistant.message_delta') {
                    result.deltaCount++;
                } else if (event.type === 'assistant.message') {
                    result.messageContent = event.data?.content ?? null;
                } else if (event.type === 'assistant.turn_end' || event.type === 'session.idle') {
                    clearTimeout(timer);
                    resolve();
                }
            });

            session.sendAndWait(PROMPT).catch(reject);
        });

        await session.destroy?.();
    } catch (err) {
        result.error = err.message;
    } finally {
        result.durationMs = Date.now() - start;
        await client.shutdown?.().catch(() => {});
    }

    return result;
}

async function main() {
    const sdk = await loadSDK();

    // Need an active session before listModels works
    const listClient = new sdk.CopilotClient({
        cwd: process.cwd(),
        autoStart: true,
        cliArgs: ['--no-auto-update', '--yolo'],
    });

    let models;
    try {
        // Create a throw-away session to connect the client
        const bootstrapSession = await listClient.createSession({
            onPermissionRequest: sdk.approveAll,
            clientName: 'vscode-copilot-cli',
        });
        models = await listClient.listModels();
        await bootstrapSession.destroy?.();
    } finally {
        await listClient.shutdown?.().catch(() => {});
    }

    console.log(`Found ${models.length} models:\n`);
    models.forEach(m => console.log(`  ${m.id}  (${m.vendor ?? '?'}  ${m.tier ?? '?'})`));
    console.log();

    const results = [];

    for (const model of models) {
        process.stdout.write(`Testing ${model.id.padEnd(40)} ... `);
        const result = await testModel(model.id, sdk);
        results.push(result);

        if (result.error) {
            console.log(`ERROR  (${result.error})`);
        } else {
            const streaming = result.deltaCount > 0;
            console.log(
                `${streaming ? '✅ STREAMING' : '⚠️  NO DELTAS'}` +
                `  deltas=${result.deltaCount}` +
                `  ${result.durationMs}ms` +
                (result.messageContent ? `  content="${result.messageContent.slice(0, 40)}"` : '')
            );
        }
    }

    // Summary table
    console.log('\n' + '='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));

    const streaming = results.filter(r => !r.error && r.deltaCount > 0);
    const noDeltas  = results.filter(r => !r.error && r.deltaCount === 0);
    const errors    = results.filter(r => r.error);

    console.log(`\n✅ Streaming (${streaming.length}):`);
    streaming.forEach(r => console.log(`   ${r.model}  (${r.deltaCount} deltas)`));

    console.log(`\n⚠️  No deltas / atomic (${noDeltas.length}):`);
    noDeltas.forEach(r => console.log(`   ${r.model}`));

    if (errors.length) {
        console.log(`\n❌ Errors (${errors.length}):`);
        errors.forEach(r => console.log(`   ${r.model}: ${r.error}`));
    }

    console.log('\nRaw results (JSON):');
    console.log(JSON.stringify(results.map(r => ({
        ...r,
        eventTypes: [...r.eventTypes],
    })), null, 2));
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
