#!/usr/bin/env node

/**
 * Spike 04: session.rpc.fleet.start() direct API
 *
 * Questions to answer:
 * 1. What does rpc.fleet.start() return exactly? Does { started: false } ever occur?
 * 2. What events fire after calling rpc.fleet.start()? Full event sequence?
 * 3. Does rpc.fleet.start() fire subagent events correctly (vs sendAndWait('/fleet'))?
 * 4. How long until session.idle? What is the realistic fleet completion timeline?
 * 5. Does rpc.fleet.start({ prompt }) vs rpc.fleet.start() (no prompt) differ?
 * 6. What happens calling rpc.fleet.start() twice (re-entrant)?
 * 7. Accept+Fleet dual-session: destroy plan session → rpc.fleet.start() on work session.
 * 8. Does rpc.fleet.start() work from a resumed session?
 *
 * Run: node planning/spikes/fleet-command/spike-04-rpc-fleet.mjs
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

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for session.idle with a generous timeout.
 * Returns the elapsed time in ms, or null if timed out.
 */
function waitForIdle(session, timeoutMs = 300_000) {
	return new Promise((resolve) => {
		const start = Date.now();
		let settled = false;

		const cleanup = session.on((event) => {
			if (event.type === 'session.idle' && !settled) {
				settled = true;
				cleanup();
				clearTimeout(timer);
				resolve({ timedOut: false, elapsedMs: Date.now() - start });
			}
		});

		const timer = setTimeout(() => {
			if (!settled) {
				settled = true;
				cleanup();
				resolve({ timedOut: true, elapsedMs: Date.now() - start });
			}
		}, timeoutMs);
	});
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
	const allExperimentData = {};

	const client = new CopilotClient({
		cwd: process.cwd(),
		autoStart: true,
		cliArgs: ['--no-auto-update'],
	});

	// ============================================================
	//  EXPERIMENT 1: rpc.fleet.start() return value + basic event flow
	// ============================================================
	separator('EXPERIMENT 1: rpc.fleet.start() — return value + event flow');

	const session1 = await client.createSession({
		onPermissionRequest: approveAll,
		clientName: 'spike-rpc-fleet-01',
	});
	log(`Session created: ${session1.sessionId}`);

	// Start collecting events BEFORE calling fleet.start
	const collectPromise1 = collectUntilIdle(session1, 300_000);

	log('Calling session.rpc.fleet.start({ prompt }) ...');
	const startTime1 = Date.now();
	let fleetStartResult;
	try {
		fleetStartResult = await session1.rpc.fleet.start({
			prompt: 'For each of the following four source files, independently: (1) write a one-paragraph summary of its purpose, (2) list its top exported symbols. Files: src/extension.ts, src/sdkSessionManager.ts, src/chatViewProvider.ts, src/extension/rpc/ExtensionRpcRouter.ts',
		});
		log(`rpc.fleet.start() returned after ${Date.now() - startTime1}ms: ${JSON.stringify(fleetStartResult)}`);
		findings.push(`EXP1: rpc.fleet.start() return: ${JSON.stringify(fleetStartResult)}`);
		findings.push(`EXP1: rpc.fleet.start() returned in ${Date.now() - startTime1}ms`);
	} catch (err) {
		log(`rpc.fleet.start() threw: ${err.message}`);
		findings.push(`EXP1: rpc.fleet.start() THREW: ${err.message}`);
	}

	log('Waiting for session.idle (up to 5 min)...');
	const events1 = await collectPromise1;
	const elapsed1 = events1.length > 0 ? events1[events1.length - 1].elapsedMs : 0;

	const subagentEvents1 = events1.filter((e) => e.type.startsWith('subagent.'));
	const eventTypes1 = [...new Set(events1.map((e) => e.type))];

	log(`Total events: ${events1.length}`);
	log(`Unique event types: ${eventTypes1.join(', ')}`);
	log(`Subagent events: ${subagentEvents1.length}`);
	log(`Total elapsed: ${elapsed1}ms`);

	// Print subagent timeline
	separator('Subagent timeline (EXP1)');
	for (const e of subagentEvents1) {
		log(`  +${e.elapsedMs}ms  ${e.type}  [${e.data?.toolCallId}]  agent=${e.data?.agentName}`);
	}

	// Print assistant messages
	const assistantMsgs1 = events1.filter((e) => e.type === 'assistant.message');
	log(`\nAssistant messages: ${assistantMsgs1.length}`);
	for (const m of assistantMsgs1) {
		log(`  content length: ${(m.data?.content || '').length} chars`);
	}

	findings.push(`EXP1: Total events: ${events1.length}`);
	findings.push(`EXP1: Unique event types: ${JSON.stringify(eventTypes1)}`);
	findings.push(`EXP1: Subagent events: ${subagentEvents1.length}`);
	findings.push(`EXP1: Subagent event types: ${JSON.stringify(subagentEvents1.map((e) => e.type))}`);
	findings.push(`EXP1: Total time to idle: ${elapsed1}ms`);

	allExperimentData.exp1 = {
		fleetStartResult,
		events: events1,
		subagentEvents: subagentEvents1,
		eventTypes: eventTypes1,
		elapsedMs: elapsed1,
	};

	await session1.destroy();

	// ============================================================
	//  EXPERIMENT 2: rpc.fleet.start() WITHOUT a prompt
	// ============================================================
	separator('EXPERIMENT 2: rpc.fleet.start() — no prompt');

	const session2 = await client.createSession({
		onPermissionRequest: approveAll,
		clientName: 'spike-rpc-fleet-02',
	});
	log(`Session 2 created: ${session2.sessionId}`);

	// First, give the session some context via a normal message so fleet has something to act on
	log('Priming session with context message...');
	try {
		await session2.sendAndWait({
			prompt: 'Read the file src/extension.ts and tell me what it exports.',
			timeout: 120_000,
		});
		log('Context message completed.');
	} catch (err) {
		log(`Context message failed: ${err.message}`);
	}

	const collectPromise2 = collectUntilIdle(session2, 300_000);

	log('Calling session.rpc.fleet.start() with NO prompt...');
	const startTime2 = Date.now();
	let fleetStartResult2;
	try {
		fleetStartResult2 = await session2.rpc.fleet.start({});
		log(`rpc.fleet.start({}) returned after ${Date.now() - startTime2}ms: ${JSON.stringify(fleetStartResult2)}`);
		findings.push(`EXP2: rpc.fleet.start({}) (no prompt) return: ${JSON.stringify(fleetStartResult2)}`);
	} catch (err) {
		log(`rpc.fleet.start({}) threw: ${err.message}`);
		findings.push(`EXP2: rpc.fleet.start({}) THREW: ${err.message}`);
	}

	log('Waiting for session.idle...');
	const events2 = await collectPromise2;
	const elapsed2 = events2.length > 0 ? events2[events2.length - 1].elapsedMs : 0;

	const subagentEvents2 = events2.filter((e) => e.type.startsWith('subagent.'));
	findings.push(`EXP2: Subagent events (no prompt): ${subagentEvents2.length}`);
	findings.push(`EXP2: Total time to idle: ${elapsed2}ms`);
	log(`Subagent events (no prompt): ${subagentEvents2.length}, elapsed: ${elapsed2}ms`);

	allExperimentData.exp2 = {
		fleetStartResult: fleetStartResult2,
		subagentEvents: subagentEvents2,
		elapsedMs: elapsed2,
	};

	await session2.destroy();

	// ============================================================
	//  EXPERIMENT 3: Accept + Fleet — dual-session with rpc.fleet.start()
	//  This is the exact flow our extension will use:
	//    1. workSession exists (persistent)
	//    2. planSession produces plan.md
	//    3. User clicks "Accept + Fleet"
	//    4. planSession.destroy()
	//    5. workSession.rpc.fleet.start({ prompt: 'implement the plan' })
	// ============================================================
	separator('EXPERIMENT 3: Accept+Fleet dual-session via rpc.fleet.start()');

	const workSession = await client.createSession({
		onPermissionRequest: approveAll,
		clientName: 'spike-rpc-fleet-work',
	});
	log(`Work session: ${workSession.sessionId}`);

	// Plan session produces a small plan
	const planSession = await client.createSession({
		onPermissionRequest: approveAll,
		clientName: 'spike-rpc-fleet-plan',
	});
	log(`Plan session: ${planSession.sessionId}`);

	let planText = '';
	try {
		const planParts = [];
		planSession.on((e) => {
			if (e.type === 'assistant.text' || e.type === 'assistant.message') {
				planParts.push(e.data?.text || e.data?.content || '');
			}
		});
		await planSession.sendAndWait({
			prompt: 'Create a brief implementation plan (3 independent tasks) for adding a /fleet slash command to a VS Code extension. Each task should be completely independent so they can be parallelized. Keep it concise — one sentence per task.',
			timeout: 120_000,
		});
		planText = planParts.join('').trim();
		log(`Plan text (${planText.length} chars): ${planText.substring(0, 200)}...`);
		findings.push(`EXP3: Plan session produced plan: ${planText.length} chars`);
	} catch (err) {
		log(`Plan session error: ${err.message}`);
		findings.push(`EXP3: Plan session FAILED: ${err.message}`);
		planText = 'Implement 3 independent tasks: (1) add fleet event listeners, (2) add fleet UI component, (3) add fleet RPC handler';
	}

	// Destroy plan session (simulate disablePlanMode)
	log('Destroying plan session...');
	await planSession.destroy();
	log('Plan session destroyed ✓');
	findings.push('EXP3: Plan session destroy: SUCCESS');

	// Collect events on work session
	const collectPromise3 = collectUntilIdle(workSession, 300_000);

	// "Accept + Fleet": call rpc.fleet.start() with the plan as prompt
	log('Calling workSession.rpc.fleet.start({ prompt: plan })...');
	const startTime3 = Date.now();
	let fleetStartResult3;
	try {
		fleetStartResult3 = await workSession.rpc.fleet.start({
			prompt: planText.length > 50
				? `Implement this plan in parallel: ${planText.substring(0, 800)}`
				: 'For each of the following three files independently, write a 2-sentence description of its purpose: src/extension.ts, src/sdkSessionManager.ts, src/chatViewProvider.ts',
		});
		log(`rpc.fleet.start() returned after ${Date.now() - startTime3}ms: ${JSON.stringify(fleetStartResult3)}`);
		findings.push(`EXP3: rpc.fleet.start() return: ${JSON.stringify(fleetStartResult3)}`);
	} catch (err) {
		log(`rpc.fleet.start() threw: ${err.message}`);
		findings.push(`EXP3: rpc.fleet.start() THREW: ${err.message}`);
	}

	log('Waiting for work session idle (up to 5 min)...');
	const events3 = await collectPromise3;
	const elapsed3 = events3.length > 0 ? events3[events3.length - 1].elapsedMs : 0;

	const subagentEvents3 = events3.filter((e) => e.type.startsWith('subagent.'));
	const subagentStarted3 = subagentEvents3.filter((e) => e.type === 'subagent.started');
	const subagentCompleted3 = subagentEvents3.filter((e) => e.type === 'subagent.completed');
	const subagentFailed3 = subagentEvents3.filter((e) => e.type === 'subagent.failed');

	separator('Subagent timeline (EXP3 — accept+fleet)');
	for (const e of subagentEvents3) {
		log(`  +${e.elapsedMs}ms  ${e.type}  [${e.data?.toolCallId?.substring(0, 20)}]  agent=${e.data?.agentName}`);
	}

	log(`\nWork session summary:`);
	log(`  Total events: ${events3.length}`);
	log(`  Subagents started: ${subagentStarted3.length}`);
	log(`  Subagents completed: ${subagentCompleted3.length}`);
	log(`  Subagents failed: ${subagentFailed3.length}`);
	log(`  Total elapsed: ${elapsed3}ms`);

	findings.push(`EXP3: Subagents started: ${subagentStarted3.length}`);
	findings.push(`EXP3: Subagents completed: ${subagentCompleted3.length}`);
	findings.push(`EXP3: Subagents failed: ${subagentFailed3.length}`);
	findings.push(`EXP3: Total time to idle: ${elapsed3}ms`);
	findings.push(`EXP3: Unique event types: ${JSON.stringify([...new Set(events3.map((e) => e.type))])}`);

	allExperimentData.exp3 = {
		fleetStartResult: fleetStartResult3,
		subagentStarted: subagentStarted3,
		subagentCompleted: subagentCompleted3,
		subagentFailed: subagentFailed3,
		elapsedMs: elapsed3,
		eventTypes: [...new Set(events3.map((e) => e.type))],
	};

	await workSession.destroy();

	// ============================================================
	//  EXPERIMENT 4: What does rpc.fleet.start() return when called
	//  on a fresh session with NO prior context and NO prompt?
	// ============================================================
	separator('EXPERIMENT 4: rpc.fleet.start() — fresh session, no context, no prompt');

	const session4 = await client.createSession({
		onPermissionRequest: approveAll,
		clientName: 'spike-rpc-fleet-04',
	});
	log(`Session 4 created: ${session4.sessionId}`);

	const collectPromise4 = collectUntilIdle(session4, 60_000); // short timeout — expect fast response

	log('Calling rpc.fleet.start() with no context and no prompt...');
	let fleetStartResult4;
	try {
		fleetStartResult4 = await session4.rpc.fleet.start({});
		log(`Return value: ${JSON.stringify(fleetStartResult4)}`);
		findings.push(`EXP4: No-context no-prompt return: ${JSON.stringify(fleetStartResult4)}`);
	} catch (err) {
		log(`Threw: ${err.message}`);
		findings.push(`EXP4: THREW: ${err.message}`);
	}

	const events4 = await collectPromise4;
	const subagentEvents4 = events4.filter((e) => e.type.startsWith('subagent.'));
	log(`Events: ${events4.length}, subagent events: ${subagentEvents4.length}`);
	findings.push(`EXP4: Events: ${events4.length}, subagent events: ${subagentEvents4.length}`);
	findings.push(`EXP4: Event types: ${JSON.stringify([...new Set(events4.map((e) => e.type))])}`);

	allExperimentData.exp4 = {
		fleetStartResult: fleetStartResult4,
		eventTypes: [...new Set(events4.map((e) => e.type))],
		subagentEventCount: subagentEvents4.length,
	};

	await session4.destroy();

	// ============================================================
	//  EXPERIMENT 5: rpc.fleet.start() return timing
	//  Does it return BEFORE or AFTER subagent events start firing?
	// ============================================================
	separator('EXPERIMENT 5: rpc.fleet.start() timing — before or after subagent events?');

	const session5 = await client.createSession({
		onPermissionRequest: approveAll,
		clientName: 'spike-rpc-fleet-05',
	});
	log(`Session 5 created: ${session5.sessionId}`);

	const timingEvents = [];
	let fleetReturnTime5 = null;
	const firstSubagentTime = { value: null };

	session5.on((event) => {
		const now = Date.now();
		timingEvents.push({ type: event.type, time: now });
		if (event.type === 'subagent.started' && firstSubagentTime.value === null) {
			firstSubagentTime.value = now;
		}
	});

	const collectPromise5 = collectUntilIdle(session5, 300_000);

	const callStart5 = Date.now();
	try {
		await session5.rpc.fleet.start({
			prompt: 'For each of these 3 files independently, write one sentence about what it does: src/extension.ts, src/sdkSessionManager.ts, src/chatViewProvider.ts',
		});
		fleetReturnTime5 = Date.now();
		log(`rpc.fleet.start() returned at +${fleetReturnTime5 - callStart5}ms`);
		if (firstSubagentTime.value !== null) {
			log(`First subagent.started at +${firstSubagentTime.value - callStart5}ms`);
			log(`fleet.start() returned ${fleetReturnTime5 > firstSubagentTime.value ? 'AFTER' : 'BEFORE'} first subagent event`);
			findings.push(`EXP5: rpc.fleet.start() returned ${fleetReturnTime5 > firstSubagentTime.value ? 'AFTER' : 'BEFORE'} first subagent.started`);
			findings.push(`EXP5: fleet.start() return offset: +${fleetReturnTime5 - callStart5}ms, first subagent: +${firstSubagentTime.value - callStart5}ms`);
		} else {
			log('No subagent events had fired when fleet.start() returned');
			findings.push('EXP5: No subagent events had fired when fleet.start() returned');
		}
	} catch (err) {
		log(`Threw: ${err.message}`);
		findings.push(`EXP5: THREW: ${err.message}`);
	}

	await collectPromise5;

	if (firstSubagentTime.value !== null && fleetReturnTime5 !== null) {
		log(`Timing summary: fleet.start() returned at +${fleetReturnTime5 - callStart5}ms, first subagent at +${firstSubagentTime.value - callStart5}ms`);
	}

	allExperimentData.exp5 = {
		fleetReturnMs: fleetReturnTime5 ? fleetReturnTime5 - callStart5 : null,
		firstSubagentMs: firstSubagentTime.value ? firstSubagentTime.value - callStart5 : null,
		timingEvents: timingEvents.map((e) => ({ type: e.type, offsetMs: e.time - callStart5 })).slice(0, 30),
	};

	await session5.destroy();

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
		spike: 'spike-04-rpc-fleet',
		findings,
		experiments: allExperimentData,
	};

	const outputPath = join(RESULTS_DIR, 'spike-04-output.json');
	writeFileSync(outputPath, JSON.stringify(output, null, 2));
	log(`Structured output written to: ${outputPath}`);

	await client.stop();
	log('Spike 04 complete.');
}

main().catch((err) => {
	console.error('Spike failed:', err);
	process.exit(1);
});
