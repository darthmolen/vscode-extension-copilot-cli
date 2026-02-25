#!/usr/bin/env node

/**
 * Queued Messages Spike
 *
 * Questions to answer:
 * 1. When does pending_messages.modified fire?
 * 2. What happens when we send a second message while first is processing?
 * 3. Does the CLI send back any "queued" indicator text?
 * 4. Does assistant.turn_start fire for the queued message automatically?
 *
 * Run: node planning/spikes/queued-messages/spike-queued.mjs
 * (Requires Node 22.5+ for node:sqlite)
 */

let CopilotClient, approveAll;

async function loadSDK() {
	const sdk = await import('@github/copilot-sdk');
	CopilotClient = sdk.CopilotClient;
	approveAll = sdk.approveAll;
}

async function main() {
	await loadSDK();

	const client = new CopilotClient({
		cwd: process.cwd(),
		autoStart: true,
		cliArgs: ['--no-auto-update'],
	});

	const session = await client.createSession({
		model: 'gpt-5',
		streaming: true,
		onPermissionRequest: approveAll,
		clientName: 'vscode-copilot-cli',
	});

	console.log(`Session created: ${session.sessionId}`);

	// Log ALL events with timestamps
	const events = [];
	const startTime = Date.now();
	session.on((event) => {
		const elapsed = Date.now() - startTime;
		const entry = {
			elapsed,
			type: event.type,
			ephemeral: event.ephemeral || false,
			data: JSON.stringify(event.data).substring(0, 200),
		};
		events.push(entry);
		console.log(`[${elapsed}ms] ${event.type} (ephemeral=${entry.ephemeral}) ${entry.data.substring(0, 100)}`);
	});

	// Scenario 1: Send a slow prompt
	console.log('\n--- SENDING FIRST PROMPT (slow: count to 10) ---');
	const firstPromise = session.sendAndWait({
		prompt: 'Count from 1 to 10, one number per line. Take your time.'
	});

	// Wait 500ms then send second prompt while first is processing
	await new Promise(r => setTimeout(r, 500));
	console.log('\n--- SENDING SECOND PROMPT (while first is processing) ---');
	const secondPromise = session.sendAndWait({
		prompt: 'What is 2 + 2? Just output the number.',
		mode: 'enqueue'  // default behavior
	});

	try {
		const [first, second] = await Promise.all([
			Promise.race([firstPromise, new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout 60s')), 60000))]),
			Promise.race([secondPromise, new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout 60s')), 60000))]),
		]);
		console.log('\n--- RESULTS ---');
		console.log(`First result: ${first?.text?.substring(0, 200) || '(no text)'}`);
		console.log(`Second result: ${second?.text?.substring(0, 200) || '(no text)'}`);
	} catch (err) {
		console.error(`Error: ${err.message}`);
	}

	// Summary
	console.log('\n--- EVENT TIMELINE ---');
	for (const e of events) {
		console.log(`  [${e.elapsed}ms] ${e.type} ${e.ephemeral ? '(EPHEMERAL)' : ''}`);
	}

	console.log('\n--- PENDING_MESSAGES.MODIFIED EVENTS ---');
	const pendingEvents = events.filter(e => e.type === 'pending_messages.modified');
	if (pendingEvents.length === 0) {
		console.log('  None found!');
	} else {
		for (const e of pendingEvents) {
			console.log(`  [${e.elapsed}ms] ${e.data}`);
		}
	}

	console.log('\n--- TURN EVENTS ---');
	const turnEvents = events.filter(e => e.type.includes('turn'));
	for (const e of turnEvents) {
		console.log(`  [${e.elapsed}ms] ${e.type} ${e.data}`);
	}

	await session.destroy();
	await client.stop();
}

main().catch(console.error);
