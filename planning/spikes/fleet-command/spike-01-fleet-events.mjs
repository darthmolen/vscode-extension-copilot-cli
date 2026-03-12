#!/usr/bin/env node

/**
 * Spike 01: Fleet Event Discovery
 *
 * Questions to answer:
 * 1. What events does the SDK emit when /fleet is used?
 * 2. What are the exact payloads for subagent.started/completed/failed/selected?
 * 3. How do subagent events interleave with tool events (assistant.text, tool.start, etc.)?
 * 4. Is there a fleet-level wrapper event (fleet.started, fleet.completed)?
 *
 * Run: node planning/spikes/fleet-command/spike-01-fleet-events.mjs
 */

import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, 'results');

let CopilotClient, approveAll;

async function loadSDK() {
	const sdk = await import('@github/copilot-sdk');
	CopilotClient = sdk.CopilotClient;
	approveAll = sdk.approveAll;
}

function log(msg) {
	console.log(`[${new Date().toISOString()}] ${msg}`);
}

function separator(title) {
	console.log(`\n${'='.repeat(60)}`);
	console.log(`  ${title}`);
	console.log(`${'='.repeat(60)}\n`);
}

async function main() {
	await loadSDK();

	mkdirSync(RESULTS_DIR, { recursive: true });

	const allEvents = [];
	const subagentEvents = [];
	const findings = [];

	const client = new CopilotClient({
		cwd: process.cwd(),
		autoStart: true,
		cliArgs: ['--no-auto-update'],
	});

	// ============================================================
	//  EXPERIMENT 1: Capture ALL events during /fleet execution
	// ============================================================
	separator('EXPERIMENT 1: Fleet event capture (all events)');

	const session = await client.createSession({
		onPermissionRequest: approveAll,
		clientName: 'spike-fleet-events',
	});
	log(`Session created: ${session.sessionId}`);

	// Capture every single event
	session.on((event) => {
		const entry = {
			timestamp: new Date().toISOString(),
			type: event.type,
			data: event.data,
		};
		allEvents.push(entry);

		// Highlight subagent events
		if (event.type.startsWith('subagent.')) {
			subagentEvents.push(entry);
			log(`  [SUBAGENT] ${event.type}: ${JSON.stringify(event.data, null, 2)}`);
		} else {
			log(`  [EVENT] ${event.type}: ${JSON.stringify(event.data).substring(0, 200)}`);
		}
	});

	// Send a /fleet command that should create a few small parallel tasks
	// Using a simple, safe prompt that produces multiple independent subtasks
	log('Sending /fleet command...');
	try {
		await session.sendAndWait({
			prompt: '/fleet Create three files in /tmp/spike-fleet-test/: hello.txt with "hello", world.txt with "world", and test.txt with "test". Each file is independent.',
		});
		log('Fleet command completed.');
		findings.push('EXP1: /fleet via sendAndWait completed successfully');
	} catch (err) {
		log(`Fleet command failed: ${err.message}`);
		findings.push(`EXP1: /fleet via sendAndWait FAILED: ${err.message}`);
	}

	// ============================================================
	//  EXPERIMENT 2: Analyze event ordering
	// ============================================================
	separator('EXPERIMENT 2: Event ordering analysis');

	const eventTypes = allEvents.map((e) => e.type);
	const uniqueEventTypes = [...new Set(eventTypes)];
	log(`Total events captured: ${allEvents.length}`);
	log(`Unique event types: ${uniqueEventTypes.join(', ')}`);
	log(`Subagent events: ${subagentEvents.length}`);

	findings.push(`EXP2: Total events: ${allEvents.length}`);
	findings.push(`EXP2: Unique event types: ${JSON.stringify(uniqueEventTypes)}`);
	findings.push(`EXP2: Subagent event count: ${subagentEvents.length}`);

	// Check if there's a fleet-level wrapper event
	const fleetEvents = allEvents.filter((e) => e.type.startsWith('fleet.'));
	if (fleetEvents.length > 0) {
		log(`Fleet-level events found: ${fleetEvents.map((e) => e.type).join(', ')}`);
		findings.push(`EXP2: Fleet-level events: ${JSON.stringify(fleetEvents.map((e) => e.type))}`);
	} else {
		log('No fleet-level wrapper events (fleet.*) detected');
		findings.push('EXP2: No fleet-level wrapper events found');
	}

	// Show interleaving pattern
	separator('Event sequence (subagent + tool events only)');
	const interestingEvents = allEvents.filter(
		(e) =>
			e.type.startsWith('subagent.') ||
			e.type.startsWith('tool.') ||
			e.type === 'assistant.text' ||
			e.type === 'assistant.thinking' ||
			e.type === 'assistant.usage'
	);
	for (const event of interestingEvents) {
		log(`  ${event.type} ${event.type.startsWith('subagent.') ? '<<<' : ''}`);
	}

	// ============================================================
	//  SUMMARY
	// ============================================================
	separator('FINDINGS SUMMARY');
	for (const f of findings) {
		console.log(`  ${f}`);
	}

	// Write structured output
	const output = {
		timestamp: new Date().toISOString(),
		spike: 'spike-01-fleet-events',
		sessionId: session.sessionId,
		findings,
		allEvents,
		subagentEvents,
		eventTypesSeen: uniqueEventTypes,
		eventSequence: interestingEvents.map((e) => ({
			type: e.type,
			timestamp: e.timestamp,
		})),
	};

	const outputPath = join(RESULTS_DIR, 'spike-01-output.json');
	writeFileSync(outputPath, JSON.stringify(output, null, 2));
	log(`Structured output written to: ${outputPath}`);

	// Cleanup
	await session.destroy();
	await client.stop();
	log('Spike 01 complete.');
}

main().catch((err) => {
	console.error('Spike failed:', err);
	process.exit(1);
});
