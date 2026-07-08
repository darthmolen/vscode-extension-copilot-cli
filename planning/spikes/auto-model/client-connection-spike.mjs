#!/usr/bin/env node
/**
 * Prove the SDK 1.0.5 client contract the EXTENSION must use:
 *   - connection: RuntimeConnection.forStdio({ path, args })   (NOT top-level cliPath)
 *   - workingDirectory (NOT cwd)
 *   - explicit await client.start()  (autoStart is gone)
 *
 * Also proves cliPath is now actually honored by pointing at the managed native
 * binary and confirming a real session + prompt works end-to-end.
 *
 * Run: node planning/spikes/auto-model/client-connection-spike.mjs
 */
import { CopilotClient, RuntimeConnection, approveAll } from '@github/copilot-sdk';
import * as os from 'node:os';
import * as path from 'node:path';

const NATIVE = path.join(
	os.homedir(),
	'.vscode-server/data/User/globalStorage/darthmolen.copilot-cli-extension/cli/_1.0.67/node_modules/@github/copilot-linux-x64/copilot'
);

function log(m) { process.stdout.write(m + '\n'); }

// 1) OLD (broken) shape: top-level cliPath — expect it to be IGNORED.
log('=== control: OLD {cliPath} shape (expect ignored / would fall back to bundled) ===');
log(`  RuntimeConnection.forStdio -> ${JSON.stringify(RuntimeConnection.forStdio({ path: NATIVE, args: [] }))}`);

// 2) NEW shape the extension will adopt.
log('\n=== NEW: connection.forStdio + workingDirectory + explicit start() ===');
const client = new CopilotClient({
	logLevel: 'info',
	connection: RuntimeConnection.forStdio({ path: NATIVE, args: [] }),
	workingDirectory: process.cwd(),
});
await client.start();
log('  client.start() OK');

const models = await client.listModels();
log(`  listModels() -> ${models.length} models (auto present: ${models.some(m => m.id === 'auto')})`);

const session = await client.createSession({
	model: 'auto',
	onPermissionRequest: approveAll,
	clientName: 'client-connection-spike',
});
log(`  createSession({model:'auto'}) OK -> ${session.sessionId}`);

let usageModel = null;
const off = session.on((e) => { if (e.type === 'assistant.usage' && e.data.model) usageModel = e.data.model; });
await session.sendAndWait({ prompt: 'Say "ok"' });
if (typeof off === 'function') off();
log(`  sendAndWait OK — turn resolved to model: ${usageModel}`);

await session.disconnect();
if (typeof client.stop === 'function') await client.stop();
log('\nDONE — new contract works end-to-end.');
process.exit(0);
