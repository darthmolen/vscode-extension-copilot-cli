#!/usr/bin/env node
/**
 * Spike: ad-hoc sub-agent event emissions (SDK 0.3.0)
 *
 * Drives a REAL ad-hoc sub-agent via the `task` tool (the same mechanism the
 * plan-intake-review skill uses) and captures the FULL event envelope — most
 * importantly the top-level `agentId` field — to prove how sub-agent traffic is
 * attributed on the current SDK/CLI.
 *
 * Usage:
 *   node planning/spikes/adhoc-subagent/spike-adhoc.mjs a1   # skill-driven, 1 sub-agent
 *   node planning/spikes/adhoc-subagent/spike-adhoc.mjs a2   # 3 concurrent sub-agents
 *
 * Requires: live Copilot auth (~/.copilot), Node 24+, local @github/copilot 1.0.44.
 */

import { mkdirSync, writeFileSync, createWriteStream } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const RESULTS_DIR = join(__dirname, 'results');
const CLI_PATH = join(REPO_ROOT, 'node_modules/@github/copilot/index.js');

const label = process.argv[2] || 'a1';

const PROMPTS = {
  a1:
    'Use the plan-intake-review skill to review the single plan at ' +
    'planning/needs-review/spike-fixture-1-cache-layer.md. Follow the skill: move it to ' +
    'in-progress, dispatch the reviewer sub-agent to review it, append the review, and move ' +
    'it to reviewed/. Dispatch the sub-agent as a background task as the skill instructs.',
  a2:
    'There are three plans in planning/needs-review/: spike-fixture-1-cache-layer.md, ' +
    'spike-fixture-2-status-debounce.md, and spike-fixture-3-retry-cli-install.md. Review ALL ' +
    'THREE CONCURRENTLY: for each plan, dispatch a SEPARATE background sub-agent using the ' +
    'task tool (agent_type: general-purpose, mode: background) that reads the plan and writes a ' +
    'short implementability review. Launch all three sub-agents BEFORE waiting on any of them, ' +
    'then collect and summarize all three reviews. Do not review them yourself inline.',
};

function snapshot(event) {
  // Capture the full envelope (everything except the potentially-large data blob),
  // plus selected data fields that matter for attribution.
  const { data, ...envelope } = event;
  const d = data || {};
  return {
    type: event.type,
    agentId: event.agentId ?? null, // <-- the key under test
    envelope,
    data_keys: Object.keys(d),
    toolCallId: d.toolCallId ?? null,
    parentToolCallId: d.parentToolCallId ?? null,
    toolName: d.toolName ?? null,
    turnId: d.turnId ?? null,
    messageId: d.messageId ?? null,
    reasoningId: d.reasoningId ?? null,
    args_name: d.arguments?.name ?? null,
    args_agent_type: d.arguments?.agent_type ?? d.arguments?.agentType ?? null,
    args_mode: d.arguments?.mode ?? null,
    agent_id_result: typeof d.result?.content === 'string' ? d.result.content.slice(0, 120) : null,
  };
}

async function main() {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const t0 = Date.now();
  const ts = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

  const { CopilotClient, approveAll } = await import('@github/copilot-sdk');

  const jsonlPath = join(RESULTS_DIR, `${label}-events.jsonl`);
  const jsonl = createWriteStream(jsonlPath, { flags: 'w' });
  const events = [];

  const client = new CopilotClient({
    cwd: REPO_ROOT,
    cliPath: CLI_PATH,
    autoStart: true,
    cliArgs: ['--no-auto-update'],
  });

  console.log(`[${ts()}] creating session (cli=${CLI_PATH})`);
  const session = await client.createSession({
    onPermissionRequest: approveAll,
    includeSubAgentStreamingEvents: true,
    clientName: `spike-adhoc-${label}`,
  });
  console.log(`[${ts()}] session ${session.sessionId}`);

  session.on((event) => {
    const snap = snapshot(event);
    snap.t = ts();
    events.push(snap);
    jsonl.write(JSON.stringify({ ...snap, data: event.data }) + '\n');
    // Live one-liner for the interesting events
    if (
      event.type.startsWith('subagent.') ||
      event.type === 'tool.execution_start' ||
      event.type === 'tool.execution_complete' ||
      event.type === 'session.background_tasks_changed' ||
      event.type === 'system.notification'
    ) {
      const tag = snap.agentId ? `agentId=${snap.agentId}` : 'agentId=∅';
      const extra = snap.toolName ? ` tool=${snap.toolName}` : '';
      const par = snap.parentToolCallId ? ` parent=${snap.parentToolCallId.slice(-8)}` : '';
      console.log(`[${ts()}] ${event.type} ${tag}${extra}${par}`);
    }
  });

  const prompt = PROMPTS[label];
  console.log(`[${ts()}] sending prompt (${label})...`);
  try {
    await session.sendAndWait({ prompt }, 420_000);
    console.log(`[${ts()}] turn complete`);
  } catch (err) {
    console.log(`[${ts()}] sendAndWait ended: ${err.message}`);
  }

  // ---- analysis ----
  const byType = {};
  const agentIdByType = {};
  const distinctAgentIds = new Set();
  for (const e of events) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    if (e.agentId) {
      distinctAgentIds.add(e.agentId);
      agentIdByType[e.type] = (agentIdByType[e.type] || 0) + 1;
    }
  }
  const lifecycle = events.filter(
    (e) =>
      e.type.startsWith('subagent.') ||
      (e.type === 'tool.execution_start' && (e.toolName === 'task' || e.toolName === 'read_agent'))
  );
  const sampleChild = events.find(
    (e) => e.type === 'tool.execution_start' && (e.parentToolCallId || e.agentId)
  );
  const streamingWithAgent = events.filter(
    (e) =>
      ['assistant.message_delta', 'assistant.reasoning_delta', 'assistant.streaming_delta', 'assistant.message'].includes(
        e.type
      ) && e.agentId
  );

  const summary = {
    label,
    sessionId: session.sessionId,
    totalEvents: events.length,
    distinctAgentIds: [...distinctAgentIds],
    byType,
    agentIdByType, // how many of each type carried envelope agentId
    streamingEventsWithAgentId: streamingWithAgent.length,
    subagentLifecycle: events
      .filter((e) => e.type.startsWith('subagent.'))
      .map((e) => ({ t: e.t, type: e.type, agentId: e.agentId, toolCallId: e.toolCallId, env: e.envelope })),
    taskDispatches: events
      .filter((e) => e.type === 'tool.execution_start' && e.toolName === 'task')
      .map((e) => ({ t: e.t, toolCallId: e.toolCallId, name: e.args_name, agent_type: e.args_agent_type, mode: e.args_mode })),
    sampleChildEvent: sampleChild || null,
    lifecycleSequence: lifecycle.map((e) => ({ t: e.t, type: e.type, toolName: e.toolName, agentId: e.agentId, toolCallId: e.toolCallId, parentToolCallId: e.parentToolCallId })),
  };

  const summaryPath = join(RESULTS_DIR, `${label}-summary.json`);
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  console.log('\n========== SUMMARY ==========');
  console.log(`total events: ${summary.totalEvents}`);
  console.log(`distinct envelope agentIds: ${JSON.stringify(summary.distinctAgentIds)}`);
  console.log(`streaming/message events WITH agentId: ${summary.streamingEventsWithAgentId}`);
  console.log('event types carrying envelope agentId:', JSON.stringify(summary.agentIdByType, null, 2));
  console.log('task dispatches:', JSON.stringify(summary.taskDispatches, null, 2));
  console.log('subagent lifecycle:', JSON.stringify(summary.subagentLifecycle, null, 2));
  console.log('sample child event:', JSON.stringify(summary.sampleChildEvent, null, 2));
  console.log(`\nwrote ${jsonlPath}`);
  console.log(`wrote ${summaryPath}`);

  jsonl.end();
  await session.destroy();
  await client.stop();
  console.log(`[${ts()}] done`);
  process.exit(0);
}

main().catch((err) => {
  console.error('spike failed:', err);
  process.exit(1);
});
