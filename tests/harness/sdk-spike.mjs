#!/usr/bin/env node

/**
 * SDK Spike Tool
 *
 * General-purpose Copilot SDK experimentation tool.
 * Run prompts, inspect events, analyze streaming, spike ideas.
 *
 * Usage:
 *   node tests/harness/sdk-spike.mjs run <path>          Run prompt file(s)
 *   node tests/harness/sdk-spike.mjs run --events all    With event capture
 *   node tests/harness/sdk-spike.mjs run --analyze-streaming  With streaming analysis
 *   node tests/harness/sdk-spike.mjs interactive         Ad-hoc prompt entry
 *   node tests/harness/sdk-spike.mjs --help              Show help
 */

import * as path from 'path';
import * as readline from 'readline';
import { fileURLToPath } from 'url';

import { loadPrompts, loadPrompt } from './prompt-loader.mjs';
import { createInspector } from './event-inspector.mjs';
import { createSessionManager, getSDKVersion } from './session-manager.mjs';
import * as console_reporter from './reporters/console-reporter.mjs';
import { buildReport, saveReport } from './reporters/json-reporter.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_OUTPUT_DIR = path.join(__dirname, '../../tests/logs/harness');

// ─── CLI Parsing ───────────────────────────────────────────────

function parseArgs(argv) {
    const args = argv.slice(2);
    const command = args[0] || 'help';

    const opts = {
        command,
        verbose: args.includes('--verbose') || args.includes('-v'),
        analyzeStreaming: args.includes('--analyze-streaming'),
        events: null,
        category: null,
        id: null,
        pause: 0,
        resume: null,
        model: null,
        json: args.includes('--json'),
        target: null,
    };

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--events' && args[i + 1]) opts.events = args[++i].split(',');
        if (args[i] === '--category' && args[i + 1]) opts.category = args[++i];
        if (args[i] === '--id' && args[i + 1]) opts.id = args[++i];
        if (args[i] === '--pause' && args[i + 1]) opts.pause = parseInt(args[++i], 10);
        if (args[i] === '--resume' && args[i + 1]) opts.resume = args[++i];
        if (args[i] === '--model' && args[i + 1]) opts.model = args[++i];
    }

    // Target is the last non-flag argument after the command
    const nonFlags = args.filter((a, i) => {
        if (i === 0) return false; // command
        if (a.startsWith('--') || a.startsWith('-')) return false;
        // Check if previous arg was a flag that takes a value
        const prev = args[i - 1];
        if (['--events', '--category', '--id', '--pause', '--resume', '--model'].includes(prev)) return false;
        return true;
    });
    opts.target = nonFlags[0] || null;

    return opts;
}

function printHelp() {
    console.log(`
SDK Spike Tool — Copilot SDK experimentation

COMMANDS:
  run <path>         Run prompt file(s) against the SDK
  interactive        Interactive mode for ad-hoc prompts
  help               Show this help

RUN OPTIONS:
  --events <types>       Capture events (all, tool, assistant, session)
  --analyze-streaming    Analyze chunk timing for batching detection
  --category <name>      Filter prompts by category
  --id <name>            Filter prompts by id
  --pause <ms>           Pause between tests (default: 0)
  --model <name>         Model to use (default: gpt-5)
  --verbose, -v          Verbose output (show chunk content, reasoning)
  --json                 Save JSON report

EXAMPLES:
  # Run all sub-agent streaming tests
  node tests/harness/sdk-spike.mjs run tests/prompts/sub-agent-streaming/

  # Run a single prompt with event inspection
  node tests/harness/sdk-spike.mjs run --events all tests/prompts/sub-agent-streaming/explore-authentication.md

  # Run with streaming analysis and save JSON report
  node tests/harness/sdk-spike.mjs run --analyze-streaming --json tests/prompts/sub-agent-streaming/

  # Interactive mode
  node tests/harness/sdk-spike.mjs interactive

  # Filter by category
  node tests/harness/sdk-spike.mjs run --category explore-agent tests/prompts/sub-agent-streaming/
`);
}

// ─── Commands ──────────────────────────────────────────────────

async function runCommand(opts) {
    if (!opts.target) {
        console.error('Error: specify a prompt file or directory');
        console.error('Usage: sdk-spike.mjs run <path-to-prompts>');
        process.exit(1);
    }

    const prompts = loadPrompts(opts.target, {
        category: opts.category,
        id: opts.id,
    });

    if (prompts.length === 0) {
        console.error('No prompts matched the filter criteria.');
        process.exit(1);
    }

    console_reporter.header(`SDK Spike — ${prompts.length} prompt(s)`);
    console_reporter.log(`SDK Version: ${getSDKVersion()}`);
    console_reporter.log(`Model: ${opts.model || 'gpt-5'}`);

    const mgr = await createSessionManager({ model: opts.model });
    console_reporter.log(`Session: ${mgr.sessionId}`, 'success');

    const results = [];

    try {
        for (let i = 0; i < prompts.length; i++) {
            const prompt = prompts[i];

            // Create fresh inspector for each test
            const inspector = createInspector(mgr.session, {
                verbose: opts.verbose,
                events: opts.events || (opts.analyzeStreaming ? ['assistant'] : undefined),
            });

            console_reporter.printTestStart(prompt);

            const result = {
                id: prompt.id,
                category: prompt.category,
                status: 'running',
                startTime: Date.now(),
            };

            try {
                await mgr.sendAndWait(prompt.prompt, prompt.timeout);

                result.status = 'completed';
                result.endTime = Date.now();
                result.durationMs = result.endTime - result.startTime;
                result.responseLength = inspector.response?.length || 0;

                console_reporter.printTestResult(result);
            } catch (error) {
                result.status = 'failed';
                result.endTime = Date.now();
                result.durationMs = result.endTime - result.startTime;
                result.error = error.message;

                console_reporter.printTestResult(result);
            }

            // Capture analysis
            if (opts.analyzeStreaming) {
                result.streamingAnalysis = inspector.analyzeStreaming();
                console_reporter.printStreamingAnalysis(result.streamingAnalysis);
            }

            if (opts.events) {
                result.eventSummary = inspector.summary();
                console_reporter.printEventSummary(result.eventSummary);
            }

            results.push(result);

            // Pause between tests
            if (opts.pause > 0 && i < prompts.length - 1) {
                console_reporter.log(`Pausing ${opts.pause}ms...`);
                await new Promise(r => setTimeout(r, opts.pause));
            }

            inspector.reset();
        }
    } finally {
        await mgr.destroy();
    }

    // Report
    const report = buildReport(results, { sdkVersion: getSDKVersion() });
    console_reporter.printReport(report);

    if (opts.json) {
        const reportPath = saveReport(report, DEFAULT_OUTPUT_DIR);
        console_reporter.log(`JSON report saved: ${reportPath}`, 'success');
    }

    // Exit with error if failures or batching detected
    const exitCode = report.failed > 0 || report.batchedStreaming > 0 ? 1 : 0;
    process.exit(exitCode);
}

async function interactiveCommand(opts) {
    console_reporter.header('SDK Spike — Interactive Mode');
    console_reporter.log(`SDK Version: ${getSDKVersion()}`);

    const mgr = await createSessionManager({ model: opts.model });
    console_reporter.log(`Session: ${mgr.sessionId}`, 'success');

    const inspector = createInspector(mgr.session, {
        verbose: opts.verbose,
        events: opts.events || ['all'],
    });

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    console.log('\nType a prompt and press Enter. Type "quit" to exit.');
    console.log('Commands: /events, /streaming, /summary, /quit\n');

    const askPrompt = () => {
        rl.question('> ', async (input) => {
            const trimmed = input.trim();

            if (trimmed === 'quit' || trimmed === '/quit' || trimmed === 'exit') {
                await mgr.destroy();
                rl.close();
                process.exit(0);
            }

            if (trimmed === '/events') {
                console.log(JSON.stringify(inspector.captured.slice(-20), null, 2));
                return askPrompt();
            }

            if (trimmed === '/streaming') {
                console_reporter.printStreamingAnalysis(inspector.analyzeStreaming());
                return askPrompt();
            }

            if (trimmed === '/summary') {
                console_reporter.printEventSummary(inspector.summary());
                return askPrompt();
            }

            if (!trimmed) {
                return askPrompt();
            }

            inspector.reset();
            console_reporter.log('Sending...');

            try {
                await mgr.sendAndWait(trimmed);
                console.log(`\n${inspector.response}\n`);
            } catch (error) {
                console_reporter.log(`Error: ${error.message}`, 'error');
            }

            askPrompt();
        });
    };

    askPrompt();
}

// ─── Main ──────────────────────────────────────────────────────

async function main() {
    const opts = parseArgs(process.argv);

    switch (opts.command) {
        case 'run':
            await runCommand(opts);
            break;
        case 'interactive':
            await interactiveCommand(opts);
            break;
        case 'help':
        case '--help':
        case '-h':
            printHelp();
            break;
        default:
            console.error(`Unknown command: ${opts.command}`);
            printHelp();
            process.exit(1);
    }
}

main().catch((error) => {
    console.error(`Fatal: ${error.message}`);
    process.exit(1);
});
