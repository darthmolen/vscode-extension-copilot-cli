#!/usr/bin/env node
/**
 * CLI-path spike: prove which cliPath into the managed _1.0.67 install actually
 * starts an SDK session under Node 24, so we can fix pickCliPath correctly.
 *
 * Candidates (new 1.0.68 layout — entrypoints moved into the platform package):
 *   A) @github/copilot-linux-x64/copilot   (native binary; SDK execs directly)
 *   B) @github/copilot-linux-x64/index.js  (pure-Node entry; SDK runs `node index.js`)
 *
 * Run: node planning/spikes/auto-model/cli-path-spike.mjs
 */
import { CopilotClient } from '@github/copilot-sdk';
import * as os from 'node:os';
import * as path from 'node:path';

const MANAGED = path.join(
	os.homedir(),
	'.vscode-server/data/User/globalStorage/darthmolen.copilot-cli-extension/cli/_1.0.67/node_modules/@github'
);

const candidates = {
	'A: native binary': path.join(MANAGED, 'copilot-linux-x64', 'copilot'),
	'B: platform index.js': path.join(MANAGED, 'copilot-linux-x64', 'index.js'),
};

for (const [label, cliPath] of Object.entries(candidates)) {
	process.stdout.write(`\n=== ${label} ===\n  cliPath=${cliPath}\n`);
	try {
		const client = new CopilotClient({ cwd: process.cwd(), autoStart: true, cliPath });
		if (typeof client.start === 'function') await client.start();
		const models = await client.listModels();
		process.stdout.write(`  OK — listModels() returned ${models.length} models (auto present: ${models.some(m => m.id === 'auto')})\n`);
		if (typeof client.stop === 'function') await client.stop();
	} catch (err) {
		process.stdout.write(`  FAILED: ${err.message}\n`);
	}
}
process.exit(0);
