#!/usr/bin/env node

/**
 * Permission Interaction Spike
 *
 * Questions to answer:
 * 1. Does --yolo suppress onPermissionRequest calls?
 * 2. Does the CLI send permission.request for tools restricted by availableTools?
 * 3. What does PermissionRequest look like in practice? (kind values, shapes)
 * 4. Does approveAll work as expected?
 *
 * Run: node planning/spikes/permission-interaction/spike-permission.mjs
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

let CopilotClient, approveAll;

async function loadSDK() {
	const sdk = await import('@github/copilot-sdk');
	CopilotClient = sdk.CopilotClient;
	approveAll = sdk.approveAll;
	console.log('SDK loaded. approveAll:', typeof approveAll);
	console.log('approveAll value:', approveAll?.toString());
}

async function runScenario(name, clientOpts, sessionOpts, prompt) {
	console.log(`\n${'='.repeat(60)}`);
	console.log(`SCENARIO: ${name}`);
	console.log('='.repeat(60));
	console.log('Client opts:', JSON.stringify(clientOpts, null, 2));
	console.log('Session opts:', JSON.stringify({
		...sessionOpts,
		onPermissionRequest: sessionOpts.onPermissionRequest ? '[function]' : undefined,
	}, null, 2));

	const extraCliArgs = clientOpts.cliArgs || [];
	delete clientOpts.cliArgs;
	const client = new CopilotClient({
		cwd: process.cwd(),
		autoStart: true,
		cliArgs: ['--no-auto-update', ...extraCliArgs],
		...clientOpts,
	});

	const permissionLog = [];

	// Wrap onPermissionRequest to log
	const originalHandler = sessionOpts.onPermissionRequest;
	const wrappedOpts = {
		...sessionOpts,
		onPermissionRequest: originalHandler ? (request, invocation) => {
			console.log(`  [PERMISSION REQUEST] kind=${request.kind} toolCallId=${request.toolCallId || 'none'}`);
			console.log(`  Full request:`, JSON.stringify(request));
			console.log(`  Invocation:`, JSON.stringify(invocation));
			permissionLog.push({ ...request, timestamp: Date.now() });
			const result = originalHandler(request, invocation);
			console.log(`  Handler result:`, JSON.stringify(result));
			return result;
		} : undefined,
	};

	try {
		const session = await client.createSession(wrappedOpts);
		console.log(`Session created: ${session.sessionId}`);

		// Listen for ALL events
		const events = [];
		session.on((event) => {
			events.push(event.type);
			if (event.type === 'tool.execution_start') {
				console.log(`  [EVENT] ${event.type}: tool=${event.data.toolName}`);
			} else if (event.type === 'session.error') {
				console.log(`  [EVENT] ${event.type}: ${event.data.message}`);
			} else if (event.type === 'assistant.turn_end') {
				console.log(`  [EVENT] ${event.type}`);
			}
		});

		console.log(`\nSending prompt: "${prompt}"`);
		const result = await Promise.race([
			session.sendAndWait({ prompt }),
			new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout 60s')), 60000)),
		]);

		console.log(`\nResult: ${result.text?.substring(0, 200) || '(no text)'}`);
		console.log(`Events seen: ${events.length}`);
		console.log(`Permission requests: ${permissionLog.length}`);
		for (const p of permissionLog) {
			console.log(`  - kind=${p.kind}, toolCallId=${p.toolCallId || 'none'}, keys=${Object.keys(p).join(',')}`);
		}

		await session.destroy();
		await client.stop();

		return { permissionLog, events };
	} catch (err) {
		console.error(`ERROR: ${err.message}`);
		try { await client.stop(); } catch (_) {}
		return { permissionLog, events: [], error: err.message };
	}
}

async function main() {
	await loadSDK();

	// Prompt that triggers tool use (read a file)
	const readPrompt = 'Read the file package.json and tell me the version number. Only output the version.';

	// Scenario 1: --yolo WITH onPermissionRequest (approveAll)
	// Question: Does --yolo suppress permission requests?
	const s1 = await runScenario(
		'1: --yolo + approveAll handler',
		{ cliArgs: ['--yolo'] },
		{ model: 'gpt-5', streaming: true, onPermissionRequest: approveAll },
		readPrompt
	);

	// Scenario 2: NO --yolo, WITH onPermissionRequest (approveAll)
	// Question: Does the handler fire without --yolo?
	const s2 = await runScenario(
		'2: no --yolo + approveAll handler',
		{},
		{ model: 'gpt-5', streaming: true, onPermissionRequest: approveAll },
		readPrompt
	);

	// Scenario 3: NO --yolo, custom handler that denies shell
	// Question: What happens when we deny a specific kind?
	const denyShell = (request) => {
		if (request.kind === 'shell') {
			return { kind: 'denied', reason: 'Shell denied by policy' };
		}
		return { kind: 'approved' };
	};
	const s3 = await runScenario(
		'3: no --yolo + custom handler (deny shell, approve rest)',
		{},
		{ model: 'gpt-5', streaming: true, onPermissionRequest: denyShell },
		readPrompt
	);

	// Scenario 4: availableTools whitelist + onPermissionRequest
	// Question: Does the CLI ask permission for whitelisted tools?
	const s4 = await runScenario(
		'4: availableTools=[view,glob,grep] + approveAll',
		{},
		{
			model: 'gpt-5',
			streaming: true,
			onPermissionRequest: approveAll,
			availableTools: ['view', 'glob', 'grep'],
		},
		readPrompt
	);

	// Summary
	console.log('\n' + '='.repeat(60));
	console.log('SUMMARY');
	console.log('='.repeat(60));
	console.log(`S1 (--yolo + approveAll): ${s1.permissionLog.length} permission requests`);
	console.log(`S2 (no --yolo + approveAll): ${s2.permissionLog.length} permission requests`);
	console.log(`S3 (deny shell): ${s3.permissionLog.length} permission requests`);
	console.log(`S4 (availableTools + approveAll): ${s4.permissionLog.length} permission requests`);

	if (s1.permissionLog.length === 0 && s2.permissionLog.length > 0) {
		console.log('\nFINDING: --yolo DOES suppress onPermissionRequest calls');
	} else if (s1.permissionLog.length > 0 && s2.permissionLog.length > 0) {
		console.log('\nFINDING: --yolo does NOT suppress onPermissionRequest — handler fires regardless');
	}
}

main().catch(console.error);
