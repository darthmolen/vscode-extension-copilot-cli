#!/usr/bin/env node

/**
 * Spike 05: Re-run Spike-04 EXP1 under SDK 0.1.32
 *
 * Questions to answer (0.1.32 new APIs):
 * 1. Do subagent events still fire correctly?
 * 2. Does session.task_complete fire? (new in 0.1.32)
 * 3. Does subagent.deselected fire? (new in 0.1.32)
 * 4. Does rpc.agent.list() work? What does it return?
 * 5. Does rpc.agent.getCurrent() work before/during/after fleet?
 * 6. Any new event types not seen in 0.1.26?
 *
 * Run: node planning/spikes/fleet-command/spike-05-0132-recheck.mjs
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

/** Collect all events until session.idle (or timeout). Returns array of events. */
function collectUntilIdle(session, timeoutMs = 300_000) {
	return new Promise((resolve) => {
		const events = [];
		const start = Date.now();
		let settled = false;

		const cleanup = session.on((event) => {
			events.push({
				timestamp: new Date().toISOString(),
				elapsedMs: Date.now() - start,
				type: event.type,
				data: event.data,
			});
			if (event.type === 'session.idle' && !settled) {
				settled = true;
				cleanup();
				clearTimeout(timer);
				resolve(events);
			}
		});

		const timer = setTimeout(() => {
			if (!settled) {
				settled = true;
				cleanup();
				resolve(events);
			}
		}, timeoutMs);
	});
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
	//  EXPERIMENT 1 (0.1.32 re-run): fleet.start + new agent RPC
	// ============================================================
	separator('EXP1 (0.1.32): rpc.fleet.start + agent.list/getCurrent probes');

	const session = await client.createSession({
		onPermissionRequest: approveAll,
		clientName: 'spike-0132-recheck',
	});
	log(`Session created: ${session.sessionId}`);

	// --- Probe: rpc.agent.list() before fleet ---
	let agentListBefore;
	try {
		agentListBefore = await session.rpc.agent.list();
		log(`rpc.agent.list() BEFORE fleet: ${JSON.stringify(agentListBefore)}`);
		findings.push(`agent.list() before fleet: ${JSON.stringify(agentListBefore)}`);
	} catch (err) {
		log(`rpc.agent.list() threw: ${err.message}`);
		findings.push(`agent.list() THREW: ${err.message}`);
		agentListBefore = null;
	}

	// --- Probe: rpc.agent.getCurrent() before fleet ---
	let agentCurrentBefore;
	try {
		agentCurrentBefore = await session.rpc.agent.getCurrent();
		log(`rpc.agent.getCurrent() BEFORE fleet: ${JSON.stringify(agentCurrentBefore)}`);
		findings.push(`agent.getCurrent() before fleet: ${JSON.stringify(agentCurrentBefore)}`);
	} catch (err) {
		log(`rpc.agent.getCurrent() threw: ${err.message}`);
		findings.push(`agent.getCurrent() THREW: ${err.message}`);
		agentCurrentBefore = null;
	}

	// --- Start collecting events BEFORE calling fleet.start ---
	const collectPromise = collectUntilIdle(session, 300_000);

	// --- Fire fleet (fire-and-forget per spike-04 learnings) ---
	log('Calling rpc.fleet.start({ prompt }) — fire-and-forget...');
	const startTime = Date.now();
	let fleetStartResult;
	let fleetError;

	session.rpc.fleet
		.start({
			prompt:
				'For each of the following four source files, independently: (1) write a one-paragraph summary of its purpose, (2) list its top exported symbols. Files: src/extension.ts, src/sdkSessionManager.ts, src/chatViewProvider.ts, src/extension/rpc/ExtensionRpcRouter.ts',
		})
		.then((result) => {
			fleetStartResult = result;
			log(`rpc.fleet.start() resolved at +${Date.now() - startTime}ms: ${JSON.stringify(result)}`);
			findings.push(`fleet.start() returned after ${Date.now() - startTime}ms: ${JSON.stringify(result)}`);
		})
		.catch((err) => {
			fleetError = err;
			log(`rpc.fleet.start() threw: ${err.message}`);
			findings.push(`fleet.start() THREW: ${err.message}`);
		});

	log('Waiting for session.idle (up to 5 min)...');
	const events = await collectPromise;
	const elapsed = events.length > 0 ? events[events.length - 1].elapsedMs : 0;

	// --- Probe: rpc.agent.getCurrent() AFTER fleet ---
	let agentCurrentAfter;
	try {
		agentCurrentAfter = await session.rpc.agent.getCurrent();
		log(`rpc.agent.getCurrent() AFTER fleet: ${JSON.stringify(agentCurrentAfter)}`);
		findings.push(`agent.getCurrent() after fleet: ${JSON.stringify(agentCurrentAfter)}`);
	} catch (err) {
		log(`rpc.agent.getCurrent() threw: ${err.message}`);
		findings.push(`agent.getCurrent() after THREW: ${err.message}`);
		agentCurrentAfter = null;
	}

	// --- Summarize events ---
	const subagentEvents = events.filter((e) => e.type.startsWith('subagent.'));
	const taskCompleteEvents = events.filter((e) => e.type === 'session.task_complete');
	const eventTypes = [...new Set(events.map((e) => e.type))];
	// Look for any types not seen in 0.1.26 runs
	const known0126Types = new Set([
		'pending_messages.modified',
		'user.message',
		'assistant.turn_start',
		'session.usage_info',
		'assistant.usage',
		'assistant.message',
		'assistant.reasoning',
		'tool.execution_start',
		'tool.execution_complete',
		'tool.execution_partial_result',
		'assistant.turn_end',
		'session.idle',
		'subagent.started',
		'subagent.completed',
		'subagent.failed',
		'subagent.selected',
	]);
	const newEventTypes = eventTypes.filter((t) => !known0126Types.has(t));

	separator('RESULTS');
	log(`Total events: ${events.length}`);
	log(`Unique event types: ${eventTypes.join(', ')}`);
	log(`Subagent events: ${subagentEvents.length}`);
	log(`session.task_complete events: ${taskCompleteEvents.length}`);
	log(`NEW event types (not in 0.1.26): ${newEventTypes.length > 0 ? newEventTypes.join(', ') : 'none'}`);
	log(`Total elapsed: ${elapsed}ms`);

	separator('Subagent timeline');
	for (const e of subagentEvents) {
		log(`  +${e.elapsedMs}ms  ${e.type}  agent=${e.data?.agentName}  id=${e.data?.toolCallId}`);
	}

	if (taskCompleteEvents.length > 0) {
		separator('session.task_complete events');
		for (const e of taskCompleteEvents) {
			log(`  +${e.elapsedMs}ms  ${JSON.stringify(e.data)}`);
		}
	}

	if (newEventTypes.length > 0) {
		separator('New event types (detail)');
		for (const type of newEventTypes) {
			const examples = events.filter((e) => e.type === type).slice(0, 2);
			for (const ex of examples) {
				log(`  ${type}: ${JSON.stringify(ex.data)}`);
			}
		}
	}

	findings.push(`Total events: ${events.length}`);
	findings.push(`Unique event types: ${JSON.stringify(eventTypes)}`);
	findings.push(`Subagent events: ${subagentEvents.length}`);
	findings.push(`session.task_complete fires: ${taskCompleteEvents.length > 0}`);
	findings.push(`subagent.deselected fires: ${events.some((e) => e.type === 'subagent.deselected')}`);
	findings.push(`New event types vs 0.1.26: ${JSON.stringify(newEventTypes)}`);
	findings.push(`Total elapsed: ${elapsed}ms`);

	await session.destroy();

	// --- Write output ---
	const output = {
		sdkVersion: '0.1.32',
		runAt: new Date().toISOString(),
		findings,
		agentListBefore,
		agentCurrentBefore,
		agentCurrentAfter,
		fleetStartResult,
		fleetError: fleetError?.message,
		events,
		subagentEvents,
		taskCompleteEvents,
		newEventTypes,
	};

	const outPath = join(RESULTS_DIR, 'spike-05-0132-output.json');
	writeFileSync(outPath, JSON.stringify(output, null, 2));
	log(`\nResults written to ${outPath}`);

	separator('SUMMARY');
	for (const f of findings) {
		log(`  • ${f}`);
	}
}

main().catch(console.error);
