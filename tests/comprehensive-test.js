/**
 * Comprehensive Test Suite Orchestrator
 * 
 * Phase 6: Integration of all test components
 * - Runs all test scenarios
 * - Captures tool executions and responses
 * - Evaluates outputs using judge skill
 * - Generates comprehensive reports
 * 
 * @module comprehensive-test
 */

const path = require('path');
const fs = require('fs').promises;

// Mock VS Code module BEFORE any extension imports
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function(id) {
  if (id === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (key, defaultValue) => {
            const config = {
              'cliPath': 'copilot',
              'yoloMode': true,
              'model': 'claude-3-5-sonnet-20241022'
            };
            return config[key] !== undefined ? config[key] : defaultValue;
          }
        })
      },
      EventEmitter: class EventEmitter {
        constructor() {
          this.listeners = [];
        }
        fire(data) {
          this.listeners.forEach(listener => listener(data));
        }
        event(listener) {
          this.listeners.push(listener);
        }
      },
      window: {
        showInformationMessage: () => {},
        showErrorMessage: () => {},
        showWarningMessage: () => {}
      },
      commands: {
        registerCommand: () => ({ dispose: () => {} })
      },
      version: '1.108.1'
    };
  }
  return originalRequire.apply(this, arguments);
};

// Test logger
class TestLogger {
  info(...args) { console.log('[INFO]', ...args); }
  debug(...args) { /* Silent in test mode */ }
  error(...args) { console.error('[ERROR]', ...args); }
}

// Import dependencies
const scenarios = require('./scenarios');
const { evaluatePipeline } = require('./evaluation');

/**
 * Event capture utility
 */
class EventCapture {
  constructor() {
    this.events = [];
    this.tools = [];
    this.messages = [];
    this.startTime = null;
    this.endTime = null;
  }

  reset() {
    this.events = [];
    this.tools = [];
    this.messages = [];
    this.startTime = Date.now();
    this.endTime = null;
  }

  captureEvent(event) {
    this.events.push(event);

    switch (event.type) {
      case 'tool_start':
        this.tools.push({
          name: event.data.toolName,
          status: 'running',
          startTime: event.data.startTime || Date.now(),
          arguments: event.data.arguments
        });
        break;

      case 'tool_complete':
        const toolIndex = this.tools.findIndex(
          t => t.name === event.data.toolName && t.status === 'running'
        );
        if (toolIndex >= 0) {
          this.tools[toolIndex].status = event.data.status || 'complete';
          this.tools[toolIndex].endTime = event.data.endTime || Date.now();
          this.tools[toolIndex].duration = 
            ((this.tools[toolIndex].endTime - this.tools[toolIndex].startTime) / 1000).toFixed(2);
        }
        break;

      case 'message':
        this.messages.push(event.data.content);
        break;

      case 'output':
        this.messages.push(event.data);
        break;
    }
  }

  finish() {
    this.endTime = Date.now();
  }

  getTotalDuration() {
    if (!this.startTime || !this.endTime) return 0;
    return ((this.endTime - this.startTime) / 1000).toFixed(2);
  }

  getOutput() {
    return {
      tools: this.tools,
      messages: this.messages,
      response: this.messages.join('\n'),
      executionTime: this.getTotalDuration(),
      eventCount: this.events.length
    };
  }
}

/**
 * Run a single test scenario
 */
async function runScenario(manager, scenario, eventCapture) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📝 Running: ${scenario.name}`);
  console.log(`   ${scenario.description}`);
  console.log(`${'='.repeat(60)}`);

  // Reset event capture
  eventCapture.reset();

  try {
    // Send the prompt
    console.log(`📤 Prompt: "${scenario.prompt}"\n`);
    
    const startTime = Date.now();
    await manager.sendMessage(scenario.prompt);
    
    // Wait a bit for any remaining events
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    eventCapture.finish();

    const output = eventCapture.getOutput();
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`\n✅ Completed in ${duration}s`);
    console.log(`   Tools executed: ${output.tools.length}`);
    console.log(`   Events captured: ${output.eventCount}`);
    
    // Show tools that were executed
    if (output.tools.length > 0) {
      console.log('\n   🔧 Tools:');
      output.tools.forEach(tool => {
        const status = tool.status === 'complete' ? '✅' : '❌';
        console.log(`      ${status} ${tool.name} (${tool.duration || '?'}s)`);
      });
    }

    return {
      scenario,
      success: true,
      output: output.response,
      tools: output.tools,
      executionTime: duration,
      error: null
    };

  } catch (error) {
    console.error(`\n❌ Test failed:`, error.message);
    
    eventCapture.finish();
    const output = eventCapture.getOutput();

    return {
      scenario,
      success: false,
      output: output.response || `Error: ${error.message}`,
      tools: output.tools,
      executionTime: eventCapture.getTotalDuration(),
      error: error.message
    };
  }
}

/**
 * Main test orchestrator
 */
async function main() {
  console.log('\n');
  console.log('╔' + '═'.repeat(58) + '╗');
  console.log('║' + ' '.repeat(58) + '║');
  console.log('║' + '     COPILOT CLI EXTENSION V2 - COMPREHENSIVE TEST'.padEnd(58) + '║');
  console.log('║' + ' '.repeat(58) + '║');
  console.log('╚' + '═'.repeat(58) + '╝');
  console.log('');

  let manager = null;
  let mcpServer = null;
  const outputDir = path.join(__dirname, 'output');
  const testResults = [];

  try {
    // ========================================
    // SETUP PHASE
    // ========================================
    console.log('\n📦 SETUP PHASE\n');

    // Create output directory
    await fs.mkdir(outputDir, { recursive: true });
    console.log(`✅ Output directory: ${outputDir}`);

    // Initialize SDKSessionManager
    console.log('\n🔧 Initializing SDK Session Manager...');
    const { SDKSessionManager } = require('../dist/extension.js');
    
    const logger = new TestLogger();
    const config = {
      model: 'claude-3-5-sonnet-20241022',
      yoloMode: true,
      allowAllTools: true
    };

    manager = new SDKSessionManager(logger, config);
    console.log('✅ SDKSessionManager created');

    // Set up event capture
    const eventCapture = new EventCapture();
    
    manager.onMessage((event) => {
      eventCapture.captureEvent(event);
      
      // Log important events
      if (event.type === 'tool_start') {
        console.log(`   🔧 Tool started: ${event.data.toolName}`);
      } else if (event.type === 'tool_complete') {
        const duration = event.data.endTime && event.data.startTime 
          ? ((event.data.endTime - event.data.startTime) / 1000).toFixed(2)
          : '?';
        console.log(`   ✅ Tool completed: ${event.data.toolName} (${duration}s)`);
      }
    });

    // Start session
    console.log('\n🚀 Starting Copilot SDK session...');
    await manager.start();
    console.log('✅ Session started successfully\n');

    // ========================================
    // RUN SCENARIOS
    // ========================================
    console.log('\n🧪 TEST EXECUTION PHASE\n');
    console.log(`Running ${scenarios.length} test scenarios...\n`);

    for (let i = 0; i < scenarios.length; i++) {
      const scenario = scenarios[i];
      
      console.log(`\n[${i + 1}/${scenarios.length}] ${scenario.name}`);
      
      const result = await runScenario(manager, scenario, eventCapture);
      testResults.push(result);

      // Brief pause between tests
      if (i < scenarios.length - 1) {
        console.log('\n⏸️  Pausing 2s before next test...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    console.log('\n✅ All scenarios executed\n');

    // ========================================
    // EVALUATION PHASE
    // ========================================
    console.log('\n📊 EVALUATION PHASE\n');

    // Prepare test data for evaluation
    const testData = testResults.map(result => ({
      name: result.scenario.name,
      description: result.scenario.description,
      output: result.output,
      evaluationNotes: result.scenario.evaluationNotes,
      tools: result.tools,
      executionTime: result.executionTime,
      error: result.error
    }));

    // Run evaluation pipeline
    const evaluation = await evaluatePipeline(testData, {
      outputDir,
      showSummary: true,
      saveReports: true
    });

    // ========================================
    // REPORTING
    // ========================================
    console.log('\n📄 FINAL SUMMARY\n');
    console.log('─'.repeat(60));
    console.log(`Total Tests:      ${scenarios.length}`);
    console.log(`Passed:           ${evaluation.summary.passed} ✅`);
    console.log(`Failed:           ${evaluation.summary.failed} ❌`);
    console.log(`Errors:           ${evaluation.summary.errors} ⚠️`);
    console.log(`Pass Rate:        ${evaluation.summary.passRate}%`);
    
    const avgScore = evaluation.results.length > 0
      ? (evaluation.results.reduce((sum, r) => sum + (r.score || 0), 0) / evaluation.results.length).toFixed(2)
      : 'N/A';
    console.log(`Average Score:    ${avgScore}/10`);
    console.log('─'.repeat(60));

    if (evaluation.reportPaths) {
      console.log('\n📁 Reports saved to:');
      console.log(`   JSON:     ${evaluation.reportPaths.json}`);
      console.log(`   Markdown: ${evaluation.reportPaths.markdown}`);
    }

    // ========================================
    // CLEANUP
    // ========================================
    console.log('\n🧹 CLEANUP PHASE\n');

    if (manager) {
      console.log('Stopping SDK session...');
      await manager.stop();
      console.log('✅ Session stopped');
    }

    console.log('\n✅ Test suite completed successfully!\n');

    // Exit with appropriate code
    const exitCode = evaluation.summary.passRate >= 80 ? 0 : 1;
    process.exit(exitCode);

  } catch (error) {
    console.error('\n❌ CRITICAL ERROR\n');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);

    // Cleanup on error
    if (manager) {
      try {
        await manager.stop();
      } catch (cleanupError) {
        console.error('Cleanup error:', cleanupError.message);
      }
    }

    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = { main };
