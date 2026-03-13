#!/usr/bin/env node

/**
 * Streaming Spike — SDK 0.1.32
 *
 * Questions to answer:
 * 1. Does `streaming: true` in SessionConfig produce `assistant.message_delta` events?
 * 2. Are deltas fired for normal (non-tool) responses?
 * 3. Are deltas fired during/after tool calls?
 * 4. What does an `assistant.message_delta` event look like? (shape, fields)
 * 5. Is there a final `assistant.message` event as well, or only deltas?
 * 6. Does `streaming: false` (default) suppress all deltas?
 *
 * Run: node planning/spikes/streaming/spike-01-streaming.mjs
 * Output: logs to stdout; save to planning/spikes/streaming/results/spike-01-output.txt
 */

async function loadSDK() {
	const sdk = await import('@github/copilot-sdk');
	return { CopilotClient: sdk.CopilotClient, approveAll: sdk.approveAll };
}

async function runScenario(name, sessionOpts, prompt, { CopilotClient, approveAll }) {
	console.log(`\n${'='.repeat(60)}`);
	console.log(`SCENARIO: ${name}`);
	console.log('='.repeat(60));
	console.log('Session opts:', JSON.stringify({
		...sessionOpts,
		onPermissionRequest: sessionOpts.onPermissionRequest ? '[function]' : undefined,
	}, null, 2));

	const client = new CopilotClient({
		cwd: process.cwd(),
		autoStart: true,
		cliArgs: ['--no-auto-update', '--yolo'],
	});

	const allEvents = [];
	const deltaEvents = [];
	const messageEvents = [];

	try {
		const session = await client.createSession({
			onPermissionRequest: approveAll,
			...sessionOpts,
		});
		console.log(`Session created: ${session.sessionId}`);

		session.on((event) => {
			allEvents.push(event.type);

			if (event.type === 'assistant.message_delta') {
				deltaEvents.push(event);
				// Log first delta + every 5th to avoid flooding
				if (deltaEvents.length === 1 || deltaEvents.length % 5 === 0) {
					const text = event.data?.delta ?? event.data?.text ?? JSON.stringify(event.data).substring(0, 80);
					console.log(`  [DELTA #${deltaEvents.length}] ${JSON.stringify(text).substring(0, 60)}`);
				}
			} else if (event.type === 'assistant.message') {
				messageEvents.push(event);
				const text = event.data?.message?.content ?? event.data?.text ?? '(no text field)';
				console.log(`  [MESSAGE] ${String(text).substring(0, 120)}`);
			} else if (event.type === 'tool.execution_start') {
				console.log(`  [TOOL START] ${event.data?.toolName}`);
			} else if (event.type === 'assistant.turn_end') {
				console.log(`  [TURN END]`);
			} else if (event.type === 'session.error') {
				console.log(`  [ERROR] ${event.data?.message}`);
			}
		});

		console.log(`\nPrompt: "${prompt}"`);
		const result = await Promise.race([
			session.sendAndWait({ prompt }),
			new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout 60s')), 60000)),
		]);

		console.log(`\nResult text (first 200 chars): ${result.text?.substring(0, 200) ?? '(none)'}`);
		console.log(`Total events: ${allEvents.length}`);
		console.log(`Delta events: ${deltaEvents.length}`);
		console.log(`Message events: ${messageEvents.length}`);

		if (deltaEvents.length > 0) {
			console.log('\nFirst delta shape:', JSON.stringify(deltaEvents[0], null, 2));
			console.log('Last delta shape:', JSON.stringify(deltaEvents[deltaEvents.length - 1], null, 2));
		}
		if (messageEvents.length > 0) {
			console.log('\nFirst message shape:', JSON.stringify(messageEvents[0], null, 2));
		}

		const uniqueEventTypes = [...new Set(allEvents)];
		console.log('\nAll unique event types seen:', uniqueEventTypes.join(', '));

		await session.destroy();
		await client.stop();

		return { deltaEvents, messageEvents, allEvents, uniqueEventTypes };
	} catch (err) {
		console.error(`ERROR: ${err.message}`);
		try { await client.stop(); } catch (_) {}
		return { deltaEvents, messageEvents, allEvents: [], uniqueEventTypes: [], error: err.message };
	}
}

async function main() {
	const sdk = await loadSDK();
	console.log('SDK loaded.');

	// Simple prompt — no tool use, just text response
	const simplePrompt = 'Say exactly: "Hello streaming world." Nothing else.';

	// Tool-using prompt — triggers at least one tool call
	const toolPrompt = 'What is the version in package.json? Use a tool to read it, then output only the version string.';

	// Scenario 1: streaming: true, simple response
	const s1 = await runScenario(
		'1: streaming:true — simple text response',
		{ model: 'gpt-4.1', streaming: true },
		simplePrompt,
		sdk
	);

	// Scenario 2: streaming: false (default), simple response
	const s2 = await runScenario(
		'2: streaming:false (default) — simple text response',
		{ model: 'gpt-4.1', streaming: false },
		simplePrompt,
		sdk
	);

	// Scenario 3: streaming: true, tool-using response
	const s3 = await runScenario(
		'3: streaming:true — tool-using response',
		{ model: 'gpt-4.1', streaming: true },
		toolPrompt,
		sdk
	);

	// Scenario 4: streaming: true, reasoning model (if available)
	const s4 = await runScenario(
		'4: streaming:true — claude-sonnet-4.5 (reasoning model)',
		{ model: 'claude-sonnet-4.5', streaming: true },
		simplePrompt,
		sdk
	);

	// ── Summary ──────────────────────────────────────────────────────────
	console.log('\n' + '='.repeat(60));
	console.log('SUMMARY');
	console.log('='.repeat(60));
	console.log(`S1 (streaming:true,  simple):  ${s1.deltaEvents.length} deltas, ${s1.messageEvents.length} messages`);
	console.log(`S2 (streaming:false, simple):  ${s2.deltaEvents.length} deltas, ${s2.messageEvents.length} messages`);
	console.log(`S3 (streaming:true,  tools):   ${s3.deltaEvents.length} deltas, ${s3.messageEvents.length} messages`);
	console.log(`S4 (streaming:true,  claude):  ${s4.deltaEvents.length} deltas, ${s4.messageEvents.length} messages`);

	console.log('\nFINDINGS:');
	if (s1.deltaEvents.length > 0) {
		console.log('✅ streaming:true DOES produce assistant.message_delta events');
	} else {
		console.log('❌ streaming:true did NOT produce assistant.message_delta events');
	}
	if (s2.deltaEvents.length === 0) {
		console.log('✅ streaming:false suppresses assistant.message_delta events');
	} else {
		console.log('⚠️  streaming:false still produced delta events (unexpected)');
	}
	if (s1.messageEvents.length > 0 && s1.deltaEvents.length > 0) {
		console.log('✅ Both message and delta events fire together (can reconstruct full text)');
	} else if (s1.deltaEvents.length > 0 && s1.messageEvents.length === 0) {
		console.log('⚠️  Only deltas, no full message event — must accumulate deltas manually');
	}

	console.log('\nRecord these findings in FINDINGS.md before implementing Phase 6b.');
}

main().catch(console.error);
