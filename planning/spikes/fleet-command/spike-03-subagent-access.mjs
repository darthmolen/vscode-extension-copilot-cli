#!/usr/bin/env node

/**
 * Spike 03: Subagent Access & Lifecycle
 *
 * Questions to answer:
 * 1. Can we query individual subagent status during execution?
 * 2. Can we read subagent output separately from the main stream?
 * 3. What happens when we abort while subagents are running?
 * 4. Can we kill individual subagents?
 * 5. Do subagent tool events carry a subagent identifier?
 *
 * Run: node planning/spikes/fleet-command/spike-03-subagent-access.mjs
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

/** Delay helper */
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
	await loadSDK();

	mkdirSync(RESULTS_DIR, { recursive: true });

	const findings = [];

	const client = new CopilotClient({
		cwd: process.cwd(),
		autoStart: true,
		cliArgs: ['--no-auto-update'],
	});

	// ============================================================
	//  EXPERIMENT 1: Track subagent tool events with identifiers
	// ============================================================
	separator('EXPERIMENT 1: Subagent tool event identifiers');

	const session = await client.createSession({
		onPermissionRequest: approveAll,
		clientName: 'spike-fleet-subagent-access',
	});
	log(`Session created: ${session.sessionId}`);

	// Track ALL events, looking for subagent identifiers in tool events
	const allEvents = [];
	const toolEventsWithSubagent = [];
	const subagentTimeline = new Map(); // toolCallId → timeline of events

	session.on((event) => {
		const entry = {
			timestamp: new Date().toISOString(),
			type: event.type,
			data: event.data,
		};
		allEvents.push(entry);

		// Check if tool events carry a subagent identifier
		if (event.type.startsWith('tool.')) {
			const data = event.data || {};
			// Look for any field that could identify which subagent this tool belongs to
			const subagentId = data.subagentId || data.agentId || data.parentToolCallId || data.agentNode;
			if (subagentId) {
				toolEventsWithSubagent.push(entry);
				log(`  [TOOL+SUBAGENT] ${event.type} subagentId=${subagentId}: ${JSON.stringify(data).substring(0, 200)}`);
			}
		}

		// Build subagent timeline
		if (event.type.startsWith('subagent.')) {
			const id = event.data?.toolCallId || 'unknown';
			if (!subagentTimeline.has(id)) {
				subagentTimeline.set(id, []);
			}
			subagentTimeline.get(id).push(entry);
			log(`  [SUBAGENT] ${event.type} [${id}]: ${JSON.stringify(event.data).substring(0, 200)}`);
		}
	});

	// Use a prompt that creates enough work for multiple subagents
	log('Sending /fleet with multi-file task...');
	try {
		await session.sendAndWait({
			prompt: '/fleet Create four files in /tmp/spike-fleet-03/: file1.txt with content "alpha", file2.txt with "beta", file3.txt with "gamma", file4.txt with "delta". Each file is completely independent.',
		});
		log('Fleet execution completed.');
	} catch (err) {
		log(`Fleet execution failed: ${err.message}`);
		findings.push(`EXP1: Fleet execution FAILED: ${err.message}`);
	}

	// Analyze: do tool events carry subagent identifiers?
	log(`\nTool events with subagent identifier: ${toolEventsWithSubagent.length}`);
	findings.push(`EXP1: Tool events with subagent ID: ${toolEventsWithSubagent.length}`);

	// Analyze subagent timelines
	log(`\nSubagent timelines:`);
	for (const [id, events] of subagentTimeline) {
		const types = events.map((e) => e.type);
		log(`  ${id}: ${types.join(' → ')}`);
		findings.push(`EXP1: Subagent ${id} lifecycle: ${types.join(' → ')}`);
	}

	// Check what fields are available on subagent events
	if (subagentTimeline.size > 0) {
		const firstSubagent = [...subagentTimeline.values()][0][0];
		log(`\nSubagent event data fields: ${Object.keys(firstSubagent.data || {}).join(', ')}`);
		findings.push(`EXP1: Subagent data fields: ${JSON.stringify(Object.keys(firstSubagent.data || {}))}`);
	}

	// ============================================================
	//  EXPERIMENT 2: Inspect tool events for subagent correlation
	// ============================================================
	separator('EXPERIMENT 2: Tool event → subagent correlation');

	// Look at all tool.start events and check every field
	const toolStartEvents = allEvents.filter((e) => e.type === 'tool.start');
	if (toolStartEvents.length > 0) {
		log(`Tool start events: ${toolStartEvents.length}`);
		// Print all fields of the first few
		for (let i = 0; i < Math.min(3, toolStartEvents.length); i++) {
			log(`  Tool ${i}: ${JSON.stringify(toolStartEvents[i].data, null, 2)}`);
		}
		// Check all unique fields across all tool events
		const allFields = new Set();
		for (const e of toolStartEvents) {
			for (const key of Object.keys(e.data || {})) {
				allFields.add(key);
			}
		}
		log(`  All fields in tool.start events: ${[...allFields].join(', ')}`);
		findings.push(`EXP2: tool.start fields: ${JSON.stringify([...allFields])}`);
	} else {
		log('No tool.start events captured');
		findings.push('EXP2: No tool.start events');
	}

	// ============================================================
	//  EXPERIMENT 3: Abort during fleet execution
	// ============================================================
	separator('EXPERIMENT 3: Abort during fleet execution');

	const session2 = await client.createSession({
		onPermissionRequest: approveAll,
		clientName: 'spike-fleet-abort',
	});
	log(`Session 2 created: ${session2.sessionId}`);

	const abortEvents = [];
	session2.on((event) => {
		if (
			event.type.startsWith('subagent.') ||
			event.type.startsWith('fleet.') ||
			event.type === 'session.aborted' ||
			event.type === 'session.error'
		) {
			abortEvents.push({
				timestamp: new Date().toISOString(),
				type: event.type,
				data: event.data,
			});
			log(`  [ABORT-WATCH] ${event.type}: ${JSON.stringify(event.data).substring(0, 200)}`);
		}
	});

	// Start a fleet task that will take some time, then abort
	log('Starting fleet task (will abort after 5s)...');

	let fleetPromise;
	try {
		// Use a larger task so we have time to abort
		fleetPromise = session2.sendAndWait({
			prompt: '/fleet Create 8 files in /tmp/spike-fleet-abort/: f1.txt through f8.txt, each with 50 lines of Lorem ipsum text. Each file is independent.',
		});

		// Wait a bit for subagents to start, then abort
		await sleep(5000);

		log('  Aborting session...');
		if (typeof session2.abort === 'function') {
			session2.abort();
			log('  session.abort() called');
			findings.push('EXP3: session.abort() available: YES');
		} else if (typeof session2.cancel === 'function') {
			session2.cancel();
			log('  session.cancel() called');
			findings.push('EXP3: session.cancel() available: YES');
		} else if (session2.rpc && session2.rpc.session && session2.rpc.session.abort) {
			await session2.rpc.session.abort();
			log('  rpc.session.abort() called');
			findings.push('EXP3: rpc.session.abort() available: YES');
		} else {
			log('  No abort method found on session!');
			findings.push('EXP3: No abort method found');
		}

		// Wait for the fleet promise to resolve/reject
		try {
			await Promise.race([fleetPromise, sleep(10000)]);
		} catch (abortErr) {
			log(`  Fleet promise rejected after abort: ${abortErr.message}`);
		}
	} catch (err) {
		log(`  Fleet/abort error: ${err.message}`);
		findings.push(`EXP3: Fleet/abort error: ${err.message}`);
	}

	// What events did we get after aborting?
	log(`\nEvents after abort: ${abortEvents.length}`);
	for (const e of abortEvents) {
		log(`  ${e.type}: ${JSON.stringify(e.data).substring(0, 200)}`);
	}
	findings.push(`EXP3: Events after abort: ${JSON.stringify(abortEvents.map((e) => e.type))}`);

	// Did subagents get failed events?
	const failedAfterAbort = abortEvents.filter((e) => e.type === 'subagent.failed');
	log(`  subagent.failed events after abort: ${failedAfterAbort.length}`);
	findings.push(`EXP3: subagent.failed after abort: ${failedAfterAbort.length}`);

	// ============================================================
	//  EXPERIMENT 4: Check for subagent kill/stop methods
	// ============================================================
	separator('EXPERIMENT 4: Subagent kill/stop methods');

	// Check if there's an RPC method to kill individual subagents
	try {
		if (session.rpc) {
			// Look for anything subagent/task related
			const rpcStr = JSON.stringify(Object.keys(session.rpc));
			log(`  session.rpc namespace keys: ${rpcStr}`);

			// Try common patterns
			const methods = ['killTask', 'stopTask', 'cancelTask', 'killSubagent', 'stopSubagent'];
			for (const method of methods) {
				if (typeof session.rpc[method] === 'function') {
					log(`  Found: session.rpc.${method}()`);
					findings.push(`EXP4: session.rpc.${method} available: YES`);
				}
			}

			// Also check nested namespaces
			for (const ns of Object.keys(session.rpc)) {
				if (typeof session.rpc[ns] === 'object' && session.rpc[ns] !== null) {
					const nsKeys = Object.keys(session.rpc[ns]);
					const killMethods = nsKeys.filter((k) => /kill|stop|cancel|abort/i.test(k));
					if (killMethods.length > 0) {
						log(`  session.rpc.${ns} has: ${killMethods.join(', ')}`);
						findings.push(`EXP4: session.rpc.${ns} kill methods: ${JSON.stringify(killMethods)}`);
					}
				}
			}
		}
	} catch (err) {
		log(`  Kill method inspection failed: ${err.message}`);
		findings.push(`EXP4: Inspection FAILED: ${err.message}`);
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
		spike: 'spike-03-subagent-access',
		findings,
		subagentTimeline: Object.fromEntries(
			[...subagentTimeline].map(([k, v]) => [k, v])
		),
		abortEvents,
		toolEventsWithSubagent,
	};

	const outputPath = join(RESULTS_DIR, 'spike-03-output.json');
	writeFileSync(outputPath, JSON.stringify(output, null, 2));
	log(`Structured output written to: ${outputPath}`);

	// Cleanup
	try {
		await session.destroy();
		await session2.destroy();
	} catch (_) {
		// sessions may already be destroyed
	}
	await client.stop();
	log('Spike 03 complete.');
}

main().catch((err) => {
	console.error('Spike failed:', err);
	process.exit(1);
});
