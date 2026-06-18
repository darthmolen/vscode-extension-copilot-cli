#!/usr/bin/env node
/**
 * Spike 09: Does fleet (and the ad-hoc `task` tool) dispatch USER-DEFINED custom agents,
 * or is it still hardcoded to built-in explore/general-purpose? (issue #2261)
 *
 * Registers two distinctively-named customAgents, confirms registration via
 * rpc.agent.list(), then:
 *   PART 1 (fleet): rpc.fleet.start({prompt}) with a prompt that maps to those agents.
 *   PART 2 (ad-hoc): a prompt that explicitly tells the model to use the task tool with
 *                    agent_type set to a custom agent name.
 * In both, records the agentName/agentType of every subagent.started — if it equals a
 * custom name, custom dispatch works; if it's "explore"/"general-purpose", #2261 reproduces.
 *
 * Usage: node planning/spikes/fleet-command/spike-09-custom-agent-dispatch.mjs
 */

import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const RESULTS_DIR = join(__dirname, 'results', '09');
const CLI_PATH = join(REPO_ROOT, 'node_modules/@github/copilot/index.js');

const CUSTOM_AGENTS = [
  {
    name: 'spike-researcher',
    displayName: 'Spike Researcher',
    description: 'Reads source files and summarizes their purpose. Read-only research agent.',
    tools: ['view', 'grep', 'glob'],
    prompt: 'You are a read-only research agent. Summarize code; never modify files.',
    infer: true,
  },
  {
    name: 'spike-auditor',
    displayName: 'Spike Auditor',
    description: 'Audits a source file for one architectural risk. Read-only.',
    tools: ['view', 'grep', 'glob'],
    prompt: 'You are a read-only auditor. Identify a single architectural risk per file.',
    infer: true,
  },
];
const CUSTOM_NAMES = new Set(CUSTOM_AGENTS.map((a) => a.name));

async function main() {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const t0 = Date.now();
  const ts = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  const { CopilotClient, approveAll } = await import('@github/copilot-sdk');

  const client = new CopilotClient({
    cwd: REPO_ROOT,
    cliPath: CLI_PATH,
    autoStart: true,
    cliArgs: ['--no-auto-update'],
  });
  const session = await client.createSession({
    onPermissionRequest: approveAll,
    includeSubAgentStreamingEvents: true,
    customAgents: CUSTOM_AGENTS,
    clientName: 'spike-09-custom',
  });
  console.log(`[${ts()}] session ${session.sessionId}`);

  const dispatched = []; // {phase, agentName, agentDisplayName, agentId}
  let phase = 'init';
  session.on((event) => {
    if (event.type === 'subagent.started') {
      const rec = {
        phase,
        agentName: event.data?.agentName,
        agentDisplayName: event.data?.agentDisplayName,
        agentId: event.agentId ?? event.data?.toolCallId,
        custom: CUSTOM_NAMES.has(event.data?.agentName),
      };
      dispatched.push(rec);
      console.log(`[${ts()}] [${phase}] subagent.started name=${rec.agentName} custom=${rec.custom}`);
    }
    if (event.type === 'tool.execution_start' && event.data?.toolName === 'task') {
      console.log(`[${ts()}] [${phase}] task tool: agent_type=${event.data?.arguments?.agent_type} name=${event.data?.arguments?.name}`);
    }
  });

  // Confirm the custom agents registered.
  let agentList = null;
  try {
    agentList = await session.rpc.agent.list();
    console.log(`[${ts()}] rpc.agent.list:`, JSON.stringify(agentList));
  } catch (e) {
    console.log(`[${ts()}] rpc.agent.list failed: ${e.message}`);
  }

  // ---- PART 1: fleet ----
  phase = 'fleet';
  console.log(`\n[${ts()}] PART 1: fleet.start with custom agents registered...`);
  const fleetPrompt =
    'Use your specialized sub-agents to do this in parallel: have the researcher summarize ' +
    'src/extension.ts and src/sdkSessionManager.ts, and have the auditor find one risk in ' +
    'src/chatViewProvider.ts. Delegate to the appropriate sub-agents.';
  const fleetRes = await session.rpc.fleet.start({ prompt: fleetPrompt }).catch((e) => ({ error: e.message }));
  console.log(`[${ts()}] fleet.start returned: ${JSON.stringify(fleetRes)}`);
  await new Promise((r) => setTimeout(r, 8000)); // let any post-fleet events settle

  // ---- PART 2: ad-hoc task tool targeting a custom agent name ----
  phase = 'adhoc';
  console.log(`\n[${ts()}] PART 2: ad-hoc task tool targeting custom agent_type...`);
  const adhocPrompt =
    'Use the task tool to launch a background sub-agent with agent_type set to ' +
    '"spike-researcher" (one of the available custom agents) to summarize README.md. ' +
    'Then wait for it and report the result.';
  await session.sendAndWait({ prompt: adhocPrompt }, 300_000).catch((e) => console.log(`[${ts()}] adhoc ended: ${e.message}`));

  const summary = {
    sessionId: session.sessionId,
    registeredAgents: agentList,
    customAgentNames: [...CUSTOM_NAMES],
    dispatched,
    fleetDispatchedCustom: dispatched.filter((d) => d.phase === 'fleet' && d.custom).length,
    fleetDispatchedBuiltin: dispatched.filter((d) => d.phase === 'fleet' && !d.custom).map((d) => d.agentName),
    adhocDispatchedCustom: dispatched.filter((d) => d.phase === 'adhoc' && d.custom).length,
    adhocDispatchedBuiltin: dispatched.filter((d) => d.phase === 'adhoc' && !d.custom).map((d) => d.agentName),
  };
  writeFileSync(join(RESULTS_DIR, 'custom-agent-summary.json'), JSON.stringify(summary, null, 2));

  console.log('\n========== CUSTOM-AGENT DISPATCH SUMMARY ==========');
  console.log('registered agents:', JSON.stringify(agentList));
  console.log('all subagent.started:', JSON.stringify(dispatched, null, 2));
  console.log(`FLEET dispatched custom agents: ${summary.fleetDispatchedCustom} (built-in seen: ${JSON.stringify(summary.fleetDispatchedBuiltin)})`);
  console.log(`AD-HOC dispatched custom agents: ${summary.adhocDispatchedCustom} (built-in seen: ${JSON.stringify(summary.adhocDispatchedBuiltin)})`);
  console.log(summary.fleetDispatchedCustom > 0 ? '>>> #2261 FIXED for fleet (custom agents dispatched)' : '>>> #2261 REPRODUCES for fleet (only built-in)');

  await session.destroy();
  await client.stop();
  console.log(`[${ts()}] EXIT=0`);
  process.exit(0);
}

main().catch((e) => {
  console.error('spike failed:', e);
  process.exit(1);
});
