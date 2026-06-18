#!/usr/bin/env node
/**
 * Spike 08: Fleet on current SDK 0.3.0 / CLI 1.0.44 — apples-to-apples with the
 * ad-hoc sub-agent spike (planning/spikes/adhoc-subagent/spike-adhoc.mjs).
 *
 * Goal: prove whether FLEET sub-agents emit the SAME attribution shape (envelope
 * `agentId`, `subagent.*` lifecycle, child tool/message tagging) as ad-hoc `task`-tool
 * sub-agents, OR something different. Also re-checks open issues empirically:
 *   #2262 does `session.task_complete` fire after fleet?
 *   #2264 are there any `fleet.*` events?
 *
 * Trigger: session.rpc.fleet.start({ prompt }) — fire-and-forget (prior finding: it
 * blocks until fleet completes, so we do NOT await it; we resolve on session.idle with
 * empty backgroundTasks per the #2263 fix).
 *
 * Usage: node planning/spikes/fleet-command/spike-08-fleet-1054.mjs
 */

import { mkdirSync, writeFileSync, createWriteStream } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const RESULTS_DIR = join(__dirname, 'results', '08');
const CLI_PATH = join(REPO_ROOT, 'node_modules/@github/copilot/index.js');

const PROMPT =
  'Independently analyze these three source files — they have ZERO interdependencies, so ' +
  'work on them in parallel. For each, write a 2-sentence summary of its purpose and name one ' +
  'architectural risk: src/extension.ts, src/sdkSessionManager.ts, src/chatViewProvider.ts.';

function snapshot(event) {
  const { data, ...envelope } = event;
  const d = data || {};
  return {
    type: event.type,
    agentId: event.agentId ?? null,
    envelope,
    toolCallId: d.toolCallId ?? null,
    parentToolCallId: d.parentToolCallId ?? null,
    toolName: d.toolName ?? null,
    args_agent_type: d.arguments?.agent_type ?? d.arguments?.agentType ?? null,
    args_mode: d.arguments?.mode ?? null,
  };
}

async function main() {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const t0 = Date.now();
  const ts = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  const { CopilotClient, approveAll } = await import('@github/copilot-sdk');

  const jsonl = createWriteStream(join(RESULTS_DIR, 'fleet-events.jsonl'), { flags: 'w' });
  const events = [];

  const client = new CopilotClient({
    cwd: REPO_ROOT,
    cliPath: CLI_PATH,
    autoStart: true,
    cliArgs: ['--no-auto-update'],
  });
  const session = await client.createSession({
    onPermissionRequest: approveAll,
    includeSubAgentStreamingEvents: true,
    clientName: 'spike-08-fleet',
  });
  console.log(`[${ts()}] session ${session.sessionId}`);

  let started = 0;
  let completed = 0;
  let idleResolve;
  const idleDone = new Promise((r) => (idleResolve = r));

  session.on((event) => {
    const snap = snapshot(event);
    snap.t = ts();
    events.push(snap);
    jsonl.write(JSON.stringify({ ...snap, data: event.data }) + '\n');

    if (event.type === 'subagent.started') {
      started++;
      console.log(`[${ts()}] subagent.started #${started} agentId=${snap.agentId} name=${event.data?.agentName}`);
    } else if (event.type === 'subagent.completed' || event.type === 'subagent.failed') {
      completed++;
      console.log(`[${ts()}] ${event.type} (${completed}) agentId=${snap.agentId}`);
    } else if (event.type === 'fleet' || event.type.startsWith('fleet.')) {
      console.log(`[${ts()}] *** FLEET EVENT: ${event.type} ***`);
    } else if (event.type === 'session.task_complete') {
      console.log(`[${ts()}] *** session.task_complete fired (issue #2262) ***`);
    } else if (event.type === 'session.idle') {
      const bg = event.data?.backgroundTasks?.agents?.length ?? 0;
      console.log(`[${ts()}] session.idle (bgAgents=${bg}, started=${started}, completed=${completed})`);
      if (bg === 0 && started > 0 && completed >= started) idleResolve();
    }
  });

  console.log(`[${ts()}] fleet.start (fire-and-forget)...`);
  const res = await session.rpc.fleet.start({ prompt: PROMPT }).catch((e) => {
    console.log(`[${ts()}] fleet.start threw: ${e.message}`);
    return null;
  });
  console.log(`[${ts()}] fleet.start returned: ${JSON.stringify(res)} (started=${started})`);

  // Wait for fleet to finish (idle w/ no bg agents) or a hard cap.
  const cap = new Promise((r) => setTimeout(r, 480_000));
  await Promise.race([idleDone, cap]);

  // ---- analysis ----
  const byType = {};
  const agentIdByType = {};
  const distinct = new Set();
  for (const e of events) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    if (e.agentId) {
      distinct.add(e.agentId);
      agentIdByType[e.type] = (agentIdByType[e.type] || 0) + 1;
    }
  }
  const summary = {
    sessionId: session.sessionId,
    fleetStartResult: res,
    totalEvents: events.length,
    subagentStarted: started,
    subagentCompleted: completed,
    distinctAgentIds: [...distinct],
    fleetWildcardEvents: events.filter((e) => e.type === 'fleet' || e.type.startsWith('fleet.')).map((e) => e.type),
    taskCompleteFired: events.some((e) => e.type === 'session.task_complete'),
    agentIdByType,
    byType,
    subagentLifecycle: events
      .filter((e) => e.type.startsWith('subagent.'))
      .map((e) => ({ t: e.t, type: e.type, agentId: e.agentId, toolCallId: e.toolCallId })),
    sampleChild: events.find((e) => e.type === 'tool.execution_start' && (e.agentId || e.parentToolCallId)) || null,
  };
  writeFileSync(join(RESULTS_DIR, 'fleet-summary.json'), JSON.stringify(summary, null, 2));

  console.log('\n========== FLEET SUMMARY ==========');
  console.log(`fleet.start result: ${JSON.stringify(res)}`);
  console.log(`subagents: started=${started} completed=${completed}`);
  console.log(`distinct envelope agentIds: ${JSON.stringify(summary.distinctAgentIds)}`);
  console.log(`fleet.* wildcard events: ${JSON.stringify(summary.fleetWildcardEvents)} (issue #2264)`);
  console.log(`session.task_complete fired: ${summary.taskCompleteFired} (issue #2262)`);
  console.log(`agentId carried by types: ${JSON.stringify(summary.agentIdByType)}`);
  console.log(`sample child event:`, JSON.stringify(summary.sampleChild));

  jsonl.end();
  await session.destroy();
  await client.stop();
  console.log(`[${ts()}] EXIT=0`);
  process.exit(0);
}

main().catch((e) => {
  console.error('spike failed:', e);
  process.exit(1);
});
