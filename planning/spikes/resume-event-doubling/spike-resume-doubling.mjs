#!/usr/bin/env node

/**
 * Resume Event Doubling Spike
 *
 * Reproduces: calling resumeSession() on an already-active session causes
 * every subsequent event to fire TWICE via session.event notifications.
 *
 * Hypothesis: session.resume re-registers server-side event subscriptions
 * without deduplicating, so the server sends each event notification twice.
 *
 * Protocol:
 *   1. createSession → send a message → count events (expect SINGLE)
 *   2. resumeSession on the SAME session (still active) → send a message → count events
 *   3. If doubled: every event type fires 2x after resume
 *
 * Run: node planning/spikes/resume-event-doubling/spike-resume-doubling.mjs
 */

let CopilotClient, approveAll;

async function loadSDK() {
	const sdk = await import('@github/copilot-sdk');
	CopilotClient = sdk.CopilotClient;
	approveAll = sdk.approveAll;
}

function countEvents(session, label) {
	const counts = {};
	const unsub = session.on((event) => {
		counts[event.type] = (counts[event.type] || 0) + 1;
	});
	return {
		counts,
		stop() {
			unsub();
			console.log(`\n--- ${label} EVENT COUNTS ---`);
			for (const [type, count] of Object.entries(counts).sort()) {
				const status = count > 1 ? `DOUBLED (${count}x)` : 'single';
				console.log(`  ${type}: ${count}  [${status}]`);
			}
			return counts;
		}
	};
}

async function main() {
	await loadSDK();

	const client = new CopilotClient({
		cwd: process.cwd(),
		autoStart: true,
		cliArgs: ['--no-auto-update'],
	});

	// --- Phase 1: Create session, send message, count events ---
	console.log('=== PHASE 1: createSession + sendAndWait ===');
	const session = await client.createSession({
		model: 'claude-sonnet-4-5',
		onPermissionRequest: approveAll,
		clientName: 'spike-resume-doubling',
	});
	console.log(`Session created: ${session.sessionId}`);

	const counter1 = countEvents(session, 'PHASE 1 (after createSession)');
	await session.sendAndWait({ prompt: 'Say exactly: "hello phase 1"' });
	const phase1Counts = counter1.stop();

	// --- Phase 2: resumeSession on the SAME active session ---
	console.log('\n=== PHASE 2: resumeSession (same session, still active) + sendAndWait ===');
	const resumed = await client.resumeSession(session.sessionId, {
		onPermissionRequest: approveAll,
		clientName: 'spike-resume-doubling',
	});
	console.log(`Resumed session: ${resumed.sessionId} (same ID: ${resumed.sessionId === session.sessionId})`);

	const counter2 = countEvents(resumed, 'PHASE 2 (after resumeSession)');
	await resumed.sendAndWait({ prompt: 'Say exactly: "hello phase 2"' });
	const phase2Counts = counter2.stop();

	// --- Analysis ---
	console.log('\n=== ANALYSIS ===');
	const phase1Total = Object.values(phase1Counts).reduce((a, b) => a + b, 0);
	const phase2Total = Object.values(phase2Counts).reduce((a, b) => a + b, 0);

	// Check for specific doubled events
	const doubledTypes = Object.entries(phase2Counts)
		.filter(([type, count]) => {
			const p1 = phase1Counts[type] || 0;
			return count > p1 && count >= 2;
		})
		.map(([type]) => type);

	if (doubledTypes.length > 0) {
		console.log(`BUG CONFIRMED: ${doubledTypes.length} event types are doubled after resumeSession()`);
		console.log(`  Doubled types: ${doubledTypes.join(', ')}`);
		console.log(`  Phase 1 total events: ${phase1Total}`);
		console.log(`  Phase 2 total events: ${phase2Total}`);
		console.log(`  Ratio: ${(phase2Total / phase1Total).toFixed(1)}x`);
	} else {
		console.log('No doubling detected. Hypothesis not confirmed.');
		console.log(`  Phase 1 total: ${phase1Total}, Phase 2 total: ${phase2Total}`);
	}

	// Cleanup
	await session.destroy().catch(() => {});
	await resumed.destroy().catch(() => {});
	await client.stop();
}

main().catch(console.error);
