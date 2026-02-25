#!/usr/bin/env node

/**
 * Model Switching Spike
 *
 * Questions to answer:
 * 1. Does resumeSession({ model }) actually change the model for a resumed session?
 * 2. Does session.rpc.model.switchTo() work? (SDK-native approach)
 * 3. Does switching models in Session A leak into Session B?
 * 4. Does session.rpc.model.getCurrent() return the correct model?
 *
 * Run: node planning/spikes/model-switching/spike-model-switch.mjs
 */

let CopilotClient, approveAll;

async function loadSDK() {
	const sdk = await import('@github/copilot-sdk');
	CopilotClient = sdk.CopilotClient;
	approveAll = sdk.approveAll;
}

const DEFAULT_MODEL = 'claude-sonnet-4.5';
const ALT_MODEL = 'claude-sonnet-4.6';

function log(msg) {
	console.log(`[${new Date().toISOString()}] ${msg}`);
}

function separator(title) {
	console.log(`\n${'='.repeat(60)}`);
	console.log(`  ${title}`);
	console.log(`${'='.repeat(60)}\n`);
}

/** Send a trivial prompt and return the model from assistant.usage */
async function getActualModel(session) {
	let usageModel = null;

	const handler = session.on((event) => {
		if (event.type === 'assistant.usage' && event.data.model) {
			usageModel = event.data.model;
		}
	});

	await session.sendAndWait({ prompt: 'Say "ok"' });

	// Unsubscribe
	if (typeof handler === 'function') handler();

	return usageModel;
}

/** Capture session.model_change events */
function watchModelChangeEvents(session, events) {
	session.on((event) => {
		if (event.type === 'session.model_change') {
			events.push(event.data);
			log(`  [EVENT] session.model_change: ${JSON.stringify(event.data)}`);
		}
	});
}

async function main() {
	await loadSDK();
	const findings = [];

	const client = new CopilotClient({
		cwd: process.cwd(),
		autoStart: true,
		cliArgs: ['--no-auto-update'],
	});

	// ============================================================
	//  EXPERIMENT 1: Does session.rpc.model.getCurrent() work?
	// ============================================================
	separator('EXPERIMENT 1: session.rpc.model.getCurrent()');

	const session1 = await client.createSession({
		model: DEFAULT_MODEL,
		onPermissionRequest: approveAll,
		clientName: 'spike-model-switch',
	});
	log(`Session 1 created: ${session1.sessionId}`);

	try {
		const current = await session1.rpc.model.getCurrent();
		log(`  rpc.model.getCurrent() = ${JSON.stringify(current)}`);
		findings.push(`EXP1: getCurrent() returned: ${JSON.stringify(current)}`);
	} catch (err) {
		log(`  rpc.model.getCurrent() FAILED: ${err.message}`);
		findings.push(`EXP1: getCurrent() FAILED: ${err.message}`);
	}

	// Verify with actual usage
	const exp1ActualModel = await getActualModel(session1);
	log(`  Actual model from usage: ${exp1ActualModel}`);
	findings.push(`EXP1: Actual model from usage: ${exp1ActualModel}`);

	// ============================================================
	//  EXPERIMENT 2: Does session.rpc.model.switchTo() work?
	// ============================================================
	separator('EXPERIMENT 2: session.rpc.model.switchTo()');

	const modelChangeEvents2 = [];
	watchModelChangeEvents(session1, modelChangeEvents2);

	log(`  Switching from ${DEFAULT_MODEL} to ${ALT_MODEL} via rpc.model.switchTo()...`);
	try {
		const switchResult = await session1.rpc.model.switchTo({ modelId: ALT_MODEL });
		log(`  switchTo() result: ${JSON.stringify(switchResult)}`);
		findings.push(`EXP2: switchTo() returned: ${JSON.stringify(switchResult)}`);
	} catch (err) {
		log(`  switchTo() FAILED: ${err.message}`);
		findings.push(`EXP2: switchTo() FAILED: ${err.message}`);
	}

	// Check getCurrent after switch
	try {
		const afterSwitch = await session1.rpc.model.getCurrent();
		log(`  getCurrent() after switch: ${JSON.stringify(afterSwitch)}`);
		findings.push(`EXP2: getCurrent() after switch: ${JSON.stringify(afterSwitch)}`);
	} catch (err) {
		log(`  getCurrent() after switch FAILED: ${err.message}`);
	}

	// Verify with actual usage
	const exp2ActualModel = await getActualModel(session1);
	log(`  Actual model from usage after switchTo: ${exp2ActualModel}`);
	findings.push(`EXP2: Actual model from usage after switchTo: ${exp2ActualModel}`);

	log(`  model_change events: ${JSON.stringify(modelChangeEvents2)}`);
	findings.push(`EXP2: model_change events: ${JSON.stringify(modelChangeEvents2)}`);

	// ============================================================
	//  EXPERIMENT 3: Does resumeSession({ model }) reset model?
	// ============================================================
	separator('EXPERIMENT 3: resumeSession({ model }) override');

	// Session1 is now on ALT_MODEL. Destroy and resume with DEFAULT_MODEL.
	const session1Id = session1.sessionId;
	log(`  Session1 is on ${ALT_MODEL}. Destroying and resuming with model=${DEFAULT_MODEL}...`);

	await session1.destroy();

	const session1Resumed = await client.resumeSession(session1Id, {
		model: DEFAULT_MODEL,
		onPermissionRequest: approveAll,
		clientName: 'spike-model-switch',
	});
	log(`  Session 1 resumed (requested model: ${DEFAULT_MODEL})`);

	// Check what model we actually got
	try {
		const resumedCurrent = await session1Resumed.rpc.model.getCurrent();
		log(`  getCurrent() after resume: ${JSON.stringify(resumedCurrent)}`);
		findings.push(`EXP3: getCurrent() after resume with ${DEFAULT_MODEL}: ${JSON.stringify(resumedCurrent)}`);
	} catch (err) {
		log(`  getCurrent() after resume FAILED: ${err.message}`);
		findings.push(`EXP3: getCurrent() after resume FAILED: ${err.message}`);
	}

	const exp3ActualModel = await getActualModel(session1Resumed);
	log(`  Actual model from usage after resume: ${exp3ActualModel}`);
	findings.push(`EXP3: Actual model from usage after resume: ${exp3ActualModel}`);

	const exp3Match = exp3ActualModel === DEFAULT_MODEL;
	log(`  Model matches requested? ${exp3Match ? 'YES' : 'NO (BUG?)'}`);
	findings.push(`EXP3: resumeSession model param respected? ${exp3Match ? 'YES' : 'NO'}`);

	// ============================================================
	//  EXPERIMENT 4: Cross-session model leak
	// ============================================================
	separator('EXPERIMENT 4: Cross-session model leak');

	// Create Session 2 with DEFAULT_MODEL
	const session2 = await client.createSession({
		model: DEFAULT_MODEL,
		onPermissionRequest: approveAll,
		clientName: 'spike-model-switch',
	});
	log(`Session 2 created: ${session2.sessionId} (requested: ${DEFAULT_MODEL})`);

	// Verify session 2 initial model
	const exp4InitialModel = await getActualModel(session2);
	log(`  Session 2 initial actual model: ${exp4InitialModel}`);
	findings.push(`EXP4: Session 2 initial model: ${exp4InitialModel}`);

	// Switch session 1 to ALT_MODEL via rpc
	log(`  Switching Session 1 to ${ALT_MODEL}...`);
	try {
		await session1Resumed.rpc.model.switchTo({ modelId: ALT_MODEL });
		log(`  Session 1 switched to ${ALT_MODEL}`);
	} catch (err) {
		log(`  Session 1 switchTo FAILED: ${err.message}`);
	}

	// Check if session 2 was affected
	const exp4Session2After = await getActualModel(session2);
	log(`  Session 2 model after Session 1 switch: ${exp4Session2After}`);
	findings.push(`EXP4: Session 2 model after Session 1 switch: ${exp4Session2After}`);

	const leakDetected = exp4Session2After !== DEFAULT_MODEL;
	log(`  Cross-session leak? ${leakDetected ? 'YES (BUG!)' : 'NO'}`);
	findings.push(`EXP4: Cross-session model leak? ${leakDetected ? 'YES' : 'NO'}`);

	// Now destroy Session 2 and resume it — does it pick up Session 1's model?
	const session2Id = session2.sessionId;
	await session2.destroy();
	const session2Resumed = await client.resumeSession(session2Id, {
		model: DEFAULT_MODEL,
		onPermissionRequest: approveAll,
		clientName: 'spike-model-switch',
	});
	log(`  Session 2 resumed (requested: ${DEFAULT_MODEL})`);

	const exp4ResumedModel = await getActualModel(session2Resumed);
	log(`  Session 2 resumed actual model: ${exp4ResumedModel}`);
	findings.push(`EXP4: Session 2 resumed model: ${exp4ResumedModel}`);

	const resumeLeakDetected = exp4ResumedModel !== DEFAULT_MODEL;
	log(`  Resume leak? ${resumeLeakDetected ? 'YES (BUG!)' : 'NO'}`);
	findings.push(`EXP4: Resume leak? ${resumeLeakDetected ? 'YES' : 'NO'}`);

	// ============================================================
	//  SUMMARY
	// ============================================================
	separator('FINDINGS SUMMARY');
	for (const f of findings) {
		console.log(`  ${f}`);
	}

	// Cleanup
	await session1Resumed.destroy();
	await session2Resumed.destroy();
	await client.stop();

	log('Spike complete.');
}

main().catch((err) => {
	console.error('Spike failed:', err);
	process.exit(1);
});
