#!/usr/bin/env node

/**
 * Spike 02: Fleet Trigger Mechanism
 *
 * Questions to answer:
 * 1. Can /fleet be triggered via sendAndWait({ prompt: '/fleet ...' })?
 * 2. Is there a dedicated SDK RPC method for fleet (e.g., session.rpc.fleet.*)?
 * 3. Does /tasks have an SDK RPC equivalent?
 * 4. How does the SDK indicate fleet mode is active?
 * 5. Can we trigger fleet after plan acceptance programmatically?
 *
 * Run: node planning/spikes/fleet-command/spike-02-fleet-trigger.mjs
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

	const findings = [];

	const client = new CopilotClient({
		cwd: process.cwd(),
		autoStart: true,
		cliArgs: ['--no-auto-update'],
	});

	const session = await client.createSession({
		onPermissionRequest: approveAll,
		clientName: 'spike-fleet-trigger',
	});
	log(`Session created: ${session.sessionId}`);

	// ============================================================
	//  EXPERIMENT 1: Probe for fleet-related RPC methods
	// ============================================================
	separator('EXPERIMENT 1: Discover fleet RPC methods');

	// Check session.rpc for fleet-related namespaces
	log('Inspecting session.rpc for fleet/subagent/tasks methods...');

	try {
		const rpcKeys = Object.keys(session.rpc || {});
		log(`  session.rpc keys: ${JSON.stringify(rpcKeys)}`);
		findings.push(`EXP1: session.rpc keys: ${JSON.stringify(rpcKeys)}`);

		// Check for fleet namespace
		if (session.rpc.fleet) {
			const fleetKeys = Object.keys(session.rpc.fleet);
			log(`  session.rpc.fleet keys: ${JSON.stringify(fleetKeys)}`);
			findings.push(`EXP1: session.rpc.fleet keys: ${JSON.stringify(fleetKeys)}`);
		} else {
			log('  session.rpc.fleet: NOT FOUND');
			findings.push('EXP1: session.rpc.fleet: NOT FOUND');
		}

		// Check for tasks namespace
		if (session.rpc.tasks) {
			const tasksKeys = Object.keys(session.rpc.tasks);
			log(`  session.rpc.tasks keys: ${JSON.stringify(tasksKeys)}`);
			findings.push(`EXP1: session.rpc.tasks keys: ${JSON.stringify(tasksKeys)}`);
		} else {
			log('  session.rpc.tasks: NOT FOUND');
			findings.push('EXP1: session.rpc.tasks: NOT FOUND');
		}

		// Check for subagent namespace
		if (session.rpc.subagent) {
			const subagentKeys = Object.keys(session.rpc.subagent);
			log(`  session.rpc.subagent keys: ${JSON.stringify(subagentKeys)}`);
			findings.push(`EXP1: session.rpc.subagent keys: ${JSON.stringify(subagentKeys)}`);
		} else {
			log('  session.rpc.subagent: NOT FOUND');
			findings.push('EXP1: session.rpc.subagent: NOT FOUND');
		}

		// Check for agent namespace
		if (session.rpc.agent) {
			const agentKeys = Object.keys(session.rpc.agent);
			log(`  session.rpc.agent keys: ${JSON.stringify(agentKeys)}`);
			findings.push(`EXP1: session.rpc.agent keys: ${JSON.stringify(agentKeys)}`);
		} else {
			log('  session.rpc.agent: NOT FOUND');
			findings.push('EXP1: session.rpc.agent: NOT FOUND');
		}
	} catch (err) {
		log(`  RPC inspection failed: ${err.message}`);
		findings.push(`EXP1: RPC inspection FAILED: ${err.message}`);
	}

	// ============================================================
	//  EXPERIMENT 2: Deep-inspect session object for fleet methods
	// ============================================================
	separator('EXPERIMENT 2: Deep-inspect session for fleet/tasks methods');

	try {
		// Walk all properties of session looking for fleet/task/subagent related
		const sessionKeys = [];
		let obj = session;
		while (obj && obj !== Object.prototype) {
			sessionKeys.push(...Object.getOwnPropertyNames(obj));
			obj = Object.getPrototypeOf(obj);
		}
		const fleetRelated = [...new Set(sessionKeys)].filter(
			(k) => /fleet|task|subagent|agent|parallel/i.test(k)
		);
		log(`  Fleet-related session properties: ${JSON.stringify(fleetRelated)}`);
		findings.push(`EXP2: Fleet-related session properties: ${JSON.stringify(fleetRelated)}`);
	} catch (err) {
		log(`  Deep inspection failed: ${err.message}`);
		findings.push(`EXP2: Deep inspection FAILED: ${err.message}`);
	}

	// ============================================================
	//  EXPERIMENT 3: Trigger /fleet via sendAndWait
	// ============================================================
	separator('EXPERIMENT 3: Trigger /fleet via sendAndWait');

	const fleetEvents = [];
	session.on((event) => {
		if (
			event.type.startsWith('subagent.') ||
			event.type.startsWith('fleet.') ||
			event.type.startsWith('task.')
		) {
			fleetEvents.push({
				timestamp: new Date().toISOString(),
				type: event.type,
				data: event.data,
			});
			log(`  [FLEET EVENT] ${event.type}: ${JSON.stringify(event.data).substring(0, 300)}`);
		}
	});

	// Simple /fleet prompt — just two small independent tasks
	log('Sending: /fleet echo "a" > /tmp/spike-fleet-a.txt && echo "b" > /tmp/spike-fleet-b.txt');
	try {
		await session.sendAndWait({
			prompt: '/fleet Create two files: /tmp/spike-fleet-a.txt containing "a" and /tmp/spike-fleet-b.txt containing "b"',
		});
		log('  sendAndWait completed');
		findings.push('EXP3: /fleet via sendAndWait: SUCCESS');
	} catch (err) {
		log(`  sendAndWait failed: ${err.message}`);
		findings.push(`EXP3: /fleet via sendAndWait: FAILED: ${err.message}`);
	}

	log(`  Fleet-related events captured: ${fleetEvents.length}`);
	findings.push(`EXP3: Fleet-related events: ${JSON.stringify(fleetEvents.map((e) => e.type))}`);

	// ============================================================
	//  EXPERIMENT 4: Trigger /tasks via sendAndWait
	// ============================================================
	separator('EXPERIMENT 4: /tasks via sendAndWait');

	const tasksEvents = [];
	session.on((event) => {
		tasksEvents.push({
			timestamp: new Date().toISOString(),
			type: event.type,
			data: event.data,
		});
	});

	try {
		await session.sendAndWait({
			prompt: '/tasks',
		});
		log('  /tasks completed');
		findings.push('EXP4: /tasks via sendAndWait: SUCCESS');
	} catch (err) {
		log(`  /tasks failed: ${err.message}`);
		findings.push(`EXP4: /tasks via sendAndWait: FAILED: ${err.message}`);
	}

	// Look at what events /tasks produced
	const taskResponseEvents = tasksEvents.filter(
		(e) => e.type === 'assistant.text' || e.type.startsWith('task.')
	);
	if (taskResponseEvents.length > 0) {
		log(`  /tasks response events: ${taskResponseEvents.map((e) => e.type).join(', ')}`);
		for (const e of taskResponseEvents) {
			if (e.type === 'assistant.text') {
				log(`    text: ${JSON.stringify(e.data).substring(0, 300)}`);
			}
		}
	}
	findings.push(`EXP4: /tasks response event types: ${JSON.stringify([...new Set(taskResponseEvents.map((e) => e.type))])}`);

	// ============================================================
	//  EXPERIMENT 5: Plan mode + fleet combo
	// ============================================================
	separator('EXPERIMENT 5: Plan mode → fleet');

	// Enter plan mode, create a plan, then try to fleet-execute it
	log('Entering plan mode...');
	try {
		const modeResult = await session.rpc.mode.get();
		log(`  Current mode: ${JSON.stringify(modeResult)}`);

		// Try to switch to plan mode
		if (session.rpc.mode.set) {
			await session.rpc.mode.set({ mode: 'plan' });
			log('  Switched to plan mode via rpc.mode.set');
		} else {
			log('  rpc.mode.set not available, trying sendAndWait...');
			await session.sendAndWait({ prompt: '/plan' });
			log('  Sent /plan command');
		}

		// Create a simple plan
		await session.sendAndWait({
			prompt: 'Create a plan to make three text files in /tmp/spike-fleet-plan/ with different content each',
		});
		log('  Plan created');

		// Now try to fleet-execute the plan
		log('  Sending /fleet to execute the plan...');
		const planFleetEvents = [];
		session.on((event) => {
			if (event.type.startsWith('subagent.') || event.type.startsWith('fleet.')) {
				planFleetEvents.push({ type: event.type, data: event.data });
			}
		});

		await session.sendAndWait({
			prompt: '/fleet implement the plan',
		});
		log(`  Plan fleet execution completed. Subagent events: ${planFleetEvents.length}`);
		findings.push(`EXP5: Plan + fleet: ${planFleetEvents.length} subagent events`);
	} catch (err) {
		log(`  Plan + fleet failed: ${err.message}`);
		findings.push(`EXP5: Plan + fleet FAILED: ${err.message}`);
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
		spike: 'spike-02-fleet-trigger',
		sessionId: session.sessionId,
		findings,
		fleetEvents,
	};

	const outputPath = join(RESULTS_DIR, 'spike-02-output.json');
	writeFileSync(outputPath, JSON.stringify(output, null, 2));
	log(`Structured output written to: ${outputPath}`);

	// Cleanup
	await session.destroy();
	await client.stop();
	log('Spike 02 complete.');
}

main().catch((err) => {
	console.error('Spike failed:', err);
	process.exit(1);
});
