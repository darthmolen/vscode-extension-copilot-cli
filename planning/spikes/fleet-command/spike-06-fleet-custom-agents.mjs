#!/usr/bin/env node

/**
 * Spike 06: Fleet with Custom Agents
 *
 * Questions to answer:
 * 1. Does rpc.fleet.start() dispatch custom agents defined in customAgents session config?
 *    (Do subagent.started events show our custom agent names rather than built-ins?)
 * 2. Does session.task_complete fire when fleet completes with customAgents?
 * 3. Does ResumeSessionConfig accept customAgents at runtime (not just in types)?
 * 4. Does session.background_tasks_changed fire at fleet completion? What is its payload?
 *
 * Note: Q5 (no per-subagent kill API) already confirmed in phase-0. Skipped.
 *       Q4 from plan (rpc.agent.select mid-fleet) is deferred — hard to test reliably.
 *
 * Run: node planning/spikes/fleet-command/spike-06-fleet-custom-agents.mjs
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

			// Log interesting events immediately
			if (
				event.type.startsWith('subagent.') ||
				event.type === 'session.task_complete' ||
				event.type === 'session.background_tasks_changed' ||
				event.type === 'session.idle'
			) {
				log(`EVENT: ${event.type} — ${JSON.stringify(event.data)}`);
			}

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

	const allFindings = {};

	// ============================================================
	//  EXP1: Fleet with custom agents — do our agents get dispatched?
	// ============================================================
	separator('EXP1: fleet.start() with customAgents — do custom agents get dispatched?');

	const customAgents = [
		{
			name: 'spike06-researcher',
			displayName: 'Spike06 Researcher',
			description: 'Read-only exploration agent for spike testing',
			tools: ['read_file', 'list_directory', 'search_files', 'grep_search'],
			prompt: 'You are a researcher. Only read files and report findings. Never write or edit files.',
		},
		{
			name: 'spike06-summarizer',
			displayName: 'Spike06 Summarizer',
			description: 'Summarization agent for spike testing',
			tools: ['read_file'],
			prompt: 'You are a summarizer. Read files and write concise summaries. Never edit files.',
		},
	];

	const exp1Findings = {
		customAgentNamesInSubagentStarted: [],
		taskCompleteEvents: [],
		backgroundTasksChangedEvents: [],
		allSubagentEvents: [],
		fleetStartResult: null,
		fleetStartError: null,
		sessionIdle: false,
	};

	let session1;
	try {
		const client1 = new CopilotClient({
			cwd: process.cwd(),
			autoStart: true,
			cliArgs: ['--no-auto-update'],
		});

		session1 = await client1.createSession({
			onPermissionRequest: approveAll,
			clientName: 'spike-06-exp1',
			customAgents,
		});
		log(`Session created: ${session1.sessionId}`);

		// Log agents available
		try {
			const agentList = await session1.rpc.agent.list();
			log(`rpc.agent.list() result: ${JSON.stringify(agentList)}`);
			exp1Findings.agentListResult = agentList;
		} catch (err) {
			log(`rpc.agent.list() threw: ${err.message}`);
			exp1Findings.agentListError = err.message;
		}

		// Start collecting BEFORE fleet.start (fire-and-forget)
		const collectPromise = collectUntilIdle(session1, 300_000);
		const startTime = Date.now();

		session1.rpc.fleet
			.start({
				prompt:
					'Summarize the purpose of these two files independently in parallel: (1) src/extension.ts — what commands does it register? (2) src/sdkSessionManager.ts — what events does it emit?',
			})
			.then((result) => {
				exp1Findings.fleetStartResult = result;
				exp1Findings.fleetStartElapsedMs = Date.now() - startTime;
				log(`rpc.fleet.start() resolved at +${Date.now() - startTime}ms: ${JSON.stringify(result)}`);
			})
			.catch((err) => {
				exp1Findings.fleetStartError = err.message;
				log(`rpc.fleet.start() rejected: ${err.message}`);
			});

		const events = await collectPromise;

		// Extract key findings
		for (const e of events) {
			if (e.type === 'subagent.started') {
				exp1Findings.allSubagentEvents.push({ type: e.type, data: e.data, elapsedMs: e.elapsedMs });
				const agentName = e.data?.agentName ?? e.data?.agentDisplayName ?? '(unknown)';
				exp1Findings.customAgentNamesInSubagentStarted.push(agentName);
				log(`subagent.started agentName="${agentName}" agentDisplayName="${e.data?.agentDisplayName}"`);
			}
			if (e.type === 'subagent.completed' || e.type === 'subagent.failed') {
				exp1Findings.allSubagentEvents.push({ type: e.type, data: e.data, elapsedMs: e.elapsedMs });
			}
			if (e.type === 'session.task_complete') {
				exp1Findings.taskCompleteEvents.push({ data: e.data, elapsedMs: e.elapsedMs });
			}
			if (e.type === 'session.background_tasks_changed') {
				exp1Findings.backgroundTasksChangedEvents.push({ data: e.data, elapsedMs: e.elapsedMs });
			}
			if (e.type === 'session.idle') {
				exp1Findings.sessionIdle = true;
			}
		}

		exp1Findings.totalEvents = events.length;
		exp1Findings.eventTypeSummary = Object.entries(
			events.reduce((acc, e) => {
				acc[e.type] = (acc[e.type] ?? 0) + 1;
				return acc;
			}, {})
		).sort(([, a], [, b]) => b - a);

		await session1.destroy();
	} catch (err) {
		exp1Findings.fatalError = err.message;
		log(`EXP1 fatal error: ${err.message}`);
	}

	allFindings.exp1 = exp1Findings;

	// ============================================================
	//  EXP2: resumeSession with customAgents at runtime
	//  (types confirm it, but does it actually work?)
	// ============================================================
	separator('EXP2: resumeSession with customAgents — runtime verification');

	const exp2Findings = {
		sessionCreated: false,
		resumeSucceeded: false,
		resumeError: null,
		agentListAfterResume: null,
	};

	let session2Id;
	try {
		const client2 = new CopilotClient({
			cwd: process.cwd(),
			autoStart: true,
			cliArgs: ['--no-auto-update'],
		});

		const originalSession = await client2.createSession({
			onPermissionRequest: approveAll,
			clientName: 'spike-06-exp2-original',
		});
		session2Id = originalSession.sessionId;
		exp2Findings.sessionCreated = true;
		log(`Original session created: ${session2Id}`);

		// Collect one event to confirm session is live
		await originalSession.sendAndWait('Hello', { timeout: 30_000 });
		await originalSession.destroy();
		log(`Original session destroyed, attempting resume with customAgents...`);

		// Now resume with customAgents
		const resumedSession = await client2.resumeSession(session2Id, {
			onPermissionRequest: approveAll,
			clientName: 'spike-06-exp2-resumed',
			customAgents,
		});
		exp2Findings.resumeSucceeded = true;
		log(`Resume succeeded: ${resumedSession.sessionId}`);

		try {
			const agentList = await resumedSession.rpc.agent.list();
			exp2Findings.agentListAfterResume = agentList;
			log(`Agents after resume: ${JSON.stringify(agentList)}`);
		} catch (err) {
			exp2Findings.agentListError = err.message;
			log(`agent.list() after resume threw: ${err.message}`);
		}

		await resumedSession.destroy();
	} catch (err) {
		exp2Findings.resumeError = err.message;
		log(`EXP2 error: ${err.message}`);
	}

	allFindings.exp2 = exp2Findings;

	// ============================================================
	//  Summary of findings
	// ============================================================
	separator('FINDINGS SUMMARY');

	const summary = {
		q1_fleetDispatchesCustomAgents: {
			question: 'Does rpc.fleet.start() dispatch custom agents defined in customAgents?',
			agentNamesObserved: exp1Findings.customAgentNamesInSubagentStarted,
			subagentCount: exp1Findings.allSubagentEvents.filter((e) => e.type === 'subagent.started').length,
			answer:
				exp1Findings.customAgentNamesInSubagentStarted.length > 0
					? exp1Findings.customAgentNamesInSubagentStarted.some(
							(n) => n.includes('spike06') || n.includes('Spike06')
						)
						? 'YES — custom agent names seen in subagent.started events'
						: 'PARTIAL — subagents dispatched but with built-in names, not custom names'
					: 'NO SUBAGENTS DISPATCHED — fleet may have run inline',
		},
		q2_taskCompleteWithCustomAgents: {
			question: 'Does session.task_complete fire when fleet completes with customAgents?',
			taskCompleteCount: exp1Findings.taskCompleteEvents.length,
			taskCompleteData: exp1Findings.taskCompleteEvents,
			answer:
				exp1Findings.taskCompleteEvents.length > 0
					? 'YES — task_complete fired'
					: 'NO — task_complete did not fire',
		},
		q3_resumeSessionAcceptsCustomAgents: {
			question: 'Does ResumeSessionConfig accept customAgents at runtime?',
			resumeSucceeded: exp2Findings.resumeSucceeded,
			resumeError: exp2Findings.resumeError,
			agentsAfterResume: exp2Findings.agentListAfterResume,
			answer: exp2Findings.resumeSucceeded
				? 'YES — resumeSession accepted customAgents without error'
				: `NO/ERROR — ${exp2Findings.resumeError}`,
		},
		q4_backgroundTasksChangedPayload: {
			question: 'Does session.background_tasks_changed fire at fleet completion? Payload?',
			count: exp1Findings.backgroundTasksChangedEvents.length,
			events: exp1Findings.backgroundTasksChangedEvents,
			answer:
				exp1Findings.backgroundTasksChangedEvents.length > 0
					? `FIRED ${exp1Findings.backgroundTasksChangedEvents.length}x — see events for payload`
					: 'DID NOT FIRE during this fleet run',
		},
	};

	for (const [key, finding] of Object.entries(summary)) {
		log(`\n${key}: ${finding.answer}`);
	}

	// Write results
	const output = {
		timestamp: new Date().toISOString(),
		summary,
		experiments: {
			exp1: allFindings.exp1,
			exp2: allFindings.exp2,
		},
	};

	const outPath = join(RESULTS_DIR, 'spike-06-output.json');
	writeFileSync(outPath, JSON.stringify(output, null, 2));
	log(`\nResults saved to: ${outPath}`);

	// Print answer table
	console.log('\n' + '='.repeat(60));
	console.log('  ANSWER TABLE');
	console.log('='.repeat(60));
	for (const [key, finding] of Object.entries(summary)) {
		console.log(`\n${key}:`);
		console.log(`  Q: ${finding.question}`);
		console.log(`  A: ${finding.answer}`);
	}
}

main().catch((err) => {
	console.error('Spike failed:', err);
	process.exit(1);
});
