#!/usr/bin/env node

/**
 * Auto-Model Spike
 *
 * De-risks the "auto model" feature before implementing (CLAUDE.md SDK-First rule).
 *
 * Questions to answer:
 * 1. Does client.listModels() return an entry with id === 'auto'?
 *    If so, what is its name / billing (multiplier?) / capabilities shape?
 * 2. Does client.createSession({ model: 'auto' }) succeed? (auto valid at creation)
 * 3. Does session.rpc.model.switchTo({ modelId: 'auto' }) succeed mid-session?
 * 4. What does rpc.model.getCurrent() report while on auto, and what model does a
 *    real turn actually resolve to (assistant.usage.model)?
 *
 * Run: node planning/spikes/auto-model/spike.mjs
 */

let CopilotClient, approveAll;

async function loadSDK() {
	const sdk = await import('@github/copilot-sdk');
	CopilotClient = sdk.CopilotClient;
	approveAll = sdk.approveAll;
}

const AUTO = 'auto';
const CONCRETE_MODEL = 'claude-sonnet-4.6'; // for the switch-away-then-back test

function log(msg) {
	console.log(`[${new Date().toISOString()}] ${msg}`);
}

function separator(title) {
	console.log(`\n${'='.repeat(60)}`);
	console.log(`  ${title}`);
	console.log(`${'='.repeat(60)}\n`);
}

/** Send a trivial prompt and return the resolved model from assistant.usage */
async function getActualModel(session) {
	let usageModel = null;
	const handler = session.on((event) => {
		if (event.type === 'assistant.usage' && event.data.model) {
			usageModel = event.data.model;
		}
	});
	await session.sendAndWait({ prompt: 'Say "ok"' });
	if (typeof handler === 'function') handler();
	return usageModel;
}

async function main() {
	await loadSDK();
	const findings = [];

	const client = new CopilotClient({
		cwd: process.cwd(),
		autoStart: true,
	});

	// listModels() requires an established connection; ensure the client is started.
	if (typeof client.start === 'function') {
		try {
			await client.start();
			log('client.start() complete');
		} catch (err) {
			log(`client.start() note: ${err.message}`);
		}
	}

	// ============================================================
	//  Q1: Does listModels() return an 'auto' entry?
	// ============================================================
	separator("Q1: client.listModels() includes 'auto'?");

	const models = await client.listModels();
	log(`listModels() returned ${models.length} models`);
	const ids = models.map((m) => m.id);
	log(`  ids: ${JSON.stringify(ids)}`);
	findings.push(`Q1: ${models.length} models. ids=${JSON.stringify(ids)}`);

	const autoEntry = models.find((m) => m.id === AUTO);
	if (autoEntry) {
		log(`  FOUND auto entry: ${JSON.stringify(autoEntry, null, 2)}`);
		findings.push(`Q1: auto PRESENT. name=${autoEntry.name} billing=${JSON.stringify(autoEntry.billing)}`);
		findings.push(`Q1: auto.capabilities=${JSON.stringify(autoEntry.capabilities)}`);
	} else {
		log(`  auto NOT in listModels() -> will need synthetic injection in getAvailableModels()`);
		findings.push(`Q1: auto ABSENT from listModels() -> synthetic injection required`);
	}

	// Log the shape of a normal entry for multiplier comparison
	const sample = models[0];
	findings.push(`Q1: sample entry shape: id=${sample?.id} billing=${JSON.stringify(sample?.billing)}`);

	// ============================================================
	//  Q2: createSession({ model: 'auto' }) succeeds?
	// ============================================================
	separator("Q2: createSession({ model: 'auto' })");

	let session;
	try {
		session = await client.createSession({
			model: AUTO,
			onPermissionRequest: approveAll,
			clientName: 'spike-auto-model',
		});
		log(`  createSession({model:'auto'}) OK -> ${session.sessionId}`);
		findings.push(`Q2: createSession({model:'auto'}) SUCCEEDED`);
	} catch (err) {
		log(`  createSession({model:'auto'}) FAILED: ${err.message}`);
		findings.push(`Q2: createSession({model:'auto'}) FAILED: ${err.message}`);
		// Fall back to a concrete model so the rest of the spike can run
		session = await client.createSession({
			model: CONCRETE_MODEL,
			onPermissionRequest: approveAll,
			clientName: 'spike-auto-model',
		});
	}

	try {
		const current = await session.rpc.model.getCurrent();
		log(`  getCurrent() on auto session: ${JSON.stringify(current)}`);
		findings.push(`Q2: getCurrent() = ${JSON.stringify(current)}`);
	} catch (err) {
		findings.push(`Q2: getCurrent() FAILED: ${err.message}`);
	}

	const autoActual = await getActualModel(session);
	log(`  Actual model a real turn resolved to under auto: ${autoActual}`);
	findings.push(`Q2: auto turn resolved to concrete model: ${autoActual}`);

	// ============================================================
	//  Q3: switchTo concrete then back to 'auto' mid-session
	// ============================================================
	separator("Q3: switchTo concrete -> switchTo('auto')");

	try {
		await session.rpc.model.switchTo({ modelId: CONCRETE_MODEL });
		log(`  switched to ${CONCRETE_MODEL}`);
		const back = await session.rpc.model.switchTo({ modelId: AUTO });
		log(`  switchTo('auto') result: ${JSON.stringify(back)}`);
		findings.push(`Q3: switchTo('auto') SUCCEEDED: ${JSON.stringify(back)}`);
	} catch (err) {
		log(`  switchTo('auto') FAILED: ${err.message}`);
		findings.push(`Q3: switchTo('auto') FAILED: ${err.message}`);
	}

	// ============================================================
	//  SUMMARY
	// ============================================================
	separator('FINDINGS SUMMARY');
	for (const f of findings) console.log(`  ${f}`);

	await session.disconnect();
	await client.stop();
	log('Spike complete.');
}

main().catch((err) => {
	console.error('Spike failed:', err);
	process.exit(1);
});
