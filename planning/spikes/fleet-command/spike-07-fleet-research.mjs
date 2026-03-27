#!/usr/bin/env node

/**
 * Spike 07: Can fleet do useful heavy parallel research?
 *
 * Purpose: A real-world test of fleet as a research tool. Rather than asking
 * "does fleet work?", this spike asks "can fleet actually deliver value?" —
 * dispatching agents on meaningful parallel research tasks and saving results.
 *
 * Tasks dispatched to fleet (in parallel):
 *   1. Pull GitHub issues for copilot-cli / fleet concerns → community-issues-about-fleet-in-copilot-cli.md
 *   2. Mermaid diagrams:
 *      a. /agent slash command flow from webview through to CLI → agent-slash-command-workflow.md
 *      b. rpc.fleet.start() call flow from extension through SDK to CLI → fleet-rpc-workflow.md
 *   3. Web search: what is the community saying about fleet? → community-speaks-about-fleet-in-copilot-cli.md
 *
 * All output files saved by subagents to: planning/spikes/fleet-command/results/07/
 * Spike session events saved to: planning/spikes/fleet-command/results/07/spike-07-output.json
 *
 * Run: node planning/spikes/fleet-command/spike-07-fleet-research.mjs
 */

import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, 'results', '07');

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

function collectUntilIdle(session, timeoutMs = 600_000) {
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

			if (
				event.type.startsWith('subagent.') ||
				event.type === 'session.idle' ||
				event.type === 'session.task_complete'
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

// The fleet prompt — comprehensive, parallel, concrete output instructions
const FLEET_PROMPT = `
You are orchestrating parallel research on the GitHub Copilot CLI "fleet" command.
Dispatch multiple subagents to work in PARALLEL. Each subagent must save its output
to the directory: planning/spikes/fleet-command/results/07/

All output files must be created using the bash tool with heredoc or write commands.
DO NOT skip file creation — each subagent's deliverable is a saved file.

---

TASK 1 — GitHub Issues Research (save as: community-issues-about-fleet-in-copilot-cli.md)
Use the gh CLI to pull GitHub issues mentioning "fleet" from the copilot-related repos.
Try these commands:
  gh search issues "fleet" --repo github/copilot-cli --json number,title,body,comments --limit 50
  gh search issues "fleet subagent" --json number,title,body --limit 30
  gh issue list --repo github/copilot-cli --search "fleet" --json number,title,state,body --limit 50
  gh search issues "copilot fleet command" --json number,title,body --limit 30

Summarize: What concerns, requests, or bugs has the community filed about fleet?
If no issues found, report that explicitly. Include issue numbers and titles.
Save the full findings as a markdown file.

---

TASK 2a — Mermaid Workflow: /agent slash command (save as: agent-slash-command-workflow.md)
Read these source files to understand the actual code flow:
  src/webview/app/components/InputArea/InputArea.js
  src/webview/app/components/CommandParser/CommandParser.js (or wherever CommandParser lives)
  src/webview/app/rpc/WebviewRpcClient.js
  src/webview/main.js
  src/extension/rpc/ExtensionRpcRouter.ts
  src/chatViewProvider.ts
  src/sdkSessionManager.ts

Trace the full flow when a user types /agent and hits enter in the webview sidebar.
Write a markdown file with:
  - A brief explanation of the flow
  - A mermaid sequence diagram (wrapped in \`\`\`mermaid fences) showing the complete path
    from user keypress → InputArea → EventBus → WebviewRpcClient → postMessage →
    ExtensionRpcRouter → chatViewProvider → SDKSessionManager → SDK → CLI response → back to webview

---

TASK 2b — Mermaid Workflow: fleet.start() call path (save as: fleet-rpc-workflow.md)
Read these files:
  src/sdkSessionManager.ts  (look for fleet/subagent event handling, lines ~850-890)
  src/extension/rpc/ExtensionRpcRouter.ts
  src/chatViewProvider.ts
  research/copilot-sdk/nodejs/src/client.ts
  research/copilot-sdk/nodejs/src/session.ts
  research/copilot-sdk/nodejs/src/generated/rpc.ts  (look for fleet namespace)

Trace the full flow when fleet.start() is called.
Write a markdown file with:
  - A brief explanation
  - A mermaid sequence diagram showing: extension calls startFleet() →
    SDKSessionManager → session.rpc.fleet.start() → SDK internals → CLI subprocess →
    subagent.started events fire back → SDKSessionManager emits → chatViewProvider → webview

---

TASK 3 — Community Web Research (save as: community-speaks-about-fleet-in-copilot-cli.md)
Use web search and gh CLI to find community discussion about fleet:
  - Search: "github copilot cli fleet command" to find blog posts, tweets, discussions
  - Search: "copilot fleet subagents parallel" to find comparisons to other tools
  - Check GitHub Discussions if available: gh api repos/github/copilot-cli/discussions
  - Look for: comparisons to Claude Code parallel agents, excitement, skepticism, use cases

Compile findings as markdown. Include: what people think fleet is for, how it compares
to alternatives (Claude Code, Cursor), any known limitations people have discovered.
If no community discussion exists yet, report that — it's a valid finding.

---

SAVE ALL FILES. Each task must produce a file in planning/spikes/fleet-command/results/07/
Confirm each file was written at the end of your response.
`.trim();

async function main() {
	await loadSDK();
	mkdirSync(RESULTS_DIR, { recursive: true });

	separator('Spike 07: Fleet as a parallel research tool');
	log(`Results directory: ${RESULTS_DIR}`);
	log(`Fleet prompt length: ${FLEET_PROMPT.length} chars`);

	const findings = {
		fleetStartResult: null,
		fleetStartError: null,
		fleetStartElapsedMs: null,
		subagentsStarted: [],
		subagentsCompleted: [],
		subagentsFailed: [],
		sessionIdleAt: null,
		totalEvents: 0,
		eventTypeCounts: {},
	};

	const client = new CopilotClient({
		cwd: process.cwd(),
		autoStart: true,
		cliArgs: ['--no-auto-update'],
	});

	const session = await client.createSession({
		onPermissionRequest: approveAll,
		clientName: 'spike-07-fleet-research',
	});
	log(`Session created: ${session.sessionId}`);

	// Start collecting events BEFORE fleet.start (fire-and-forget)
	const collectPromise = collectUntilIdle(session, 600_000); // 10 min — research takes time
	const startTime = Date.now();

	log('Firing rpc.fleet.start() with research prompt...');
	session.rpc.fleet
		.start({ prompt: FLEET_PROMPT })
		.then((result) => {
			findings.fleetStartResult = result;
			findings.fleetStartElapsedMs = Date.now() - startTime;
			log(`fleet.start() resolved at +${findings.fleetStartElapsedMs}ms: ${JSON.stringify(result)}`);
		})
		.catch((err) => {
			findings.fleetStartError = err.message;
			log(`fleet.start() rejected: ${err.message}`);
		});

	log('Waiting for fleet to complete (up to 10 minutes)...');
	const events = await collectPromise;

	// Extract key data
	for (const e of events) {
		findings.eventTypeCounts[e.type] = (findings.eventTypeCounts[e.type] ?? 0) + 1;

		if (e.type === 'subagent.started') {
			findings.subagentsStarted.push({
				toolCallId: e.data?.toolCallId,
				agentName: e.data?.agentName,
				agentDisplayName: e.data?.agentDisplayName,
				agentDescription: e.data?.agentDescription,
				elapsedMs: e.elapsedMs,
			});
		}
		if (e.type === 'subagent.completed') {
			findings.subagentsCompleted.push({
				toolCallId: e.data?.toolCallId,
				agentName: e.data?.agentName,
				elapsedMs: e.elapsedMs,
			});
		}
		if (e.type === 'subagent.failed') {
			findings.subagentsFailed.push({
				toolCallId: e.data?.toolCallId,
				agentName: e.data?.agentName,
				error: e.data?.error,
				elapsedMs: e.elapsedMs,
			});
		}
		if (e.type === 'session.idle') {
			findings.sessionIdleAt = e.elapsedMs;
		}
	}

	findings.totalEvents = events.length;

	// Summary
	separator('RESULTS');
	log(`Total events: ${findings.totalEvents}`);
	log(`Subagents started: ${findings.subagentsStarted.length}`);
	log(`Subagents completed: ${findings.subagentsCompleted.length}`);
	log(`Subagents failed: ${findings.subagentsFailed.length}`);
	log(`Session idle at: ${findings.sessionIdleAt}ms`);
	log(`Fleet resolved at: ${findings.fleetStartElapsedMs}ms`);

	for (const a of findings.subagentsStarted) {
		log(`  Agent: ${a.agentDisplayName} (${a.agentName}) @ +${a.elapsedMs}ms`);
	}

	// Check what files were produced
	log('\nChecking output files...');
	const expectedFiles = [
		'community-issues-about-fleet-in-copilot-cli.md',
		'community-speaks-about-fleet-in-copilot-cli.md',
		'agent-slash-command-workflow.md',
		'fleet-rpc-workflow.md',
	];
	for (const f of expectedFiles) {
		const { existsSync, statSync } = await import('fs');
		const p = join(RESULTS_DIR, f);
		if (existsSync(p)) {
			const size = statSync(p).size;
			log(`  ✅ ${f} (${size} bytes)`);
			findings[`file_${f.replace(/[^a-z]/gi, '_')}`] = { exists: true, sizeBytes: size };
		} else {
			log(`  ❌ ${f} — NOT FOUND`);
			findings[`file_${f.replace(/[^a-z]/gi, '_')}`] = { exists: false };
		}
	}

	// Save spike output
	const output = {
		timestamp: new Date().toISOString(),
		sessionId: session.sessionId,
		findings,
		fleetPromptLength: FLEET_PROMPT.length,
		allEvents: events,
	};

	const outPath = join(RESULTS_DIR, 'spike-07-output.json');
	writeFileSync(outPath, JSON.stringify(output, null, 2));
	log(`\nSpike results saved to: ${outPath}`);

	await session.destroy();
}

main().catch((err) => {
	console.error('Spike-07 failed:', err);
	process.exit(1);
});
