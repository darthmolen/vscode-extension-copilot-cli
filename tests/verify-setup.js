#!/usr/bin/env node

/**
 * Quick verification that comprehensive test can initialize
 * Checks dependencies, imports, and basic setup without running full tests
 */

// Mock vscode module BEFORE any imports
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function(id) {
  if (id === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (key, defaultValue) => defaultValue
        })
      },
      EventEmitter: class EventEmitter {
        constructor() { this.listeners = []; }
        fire(data) { this.listeners.forEach(l => l(data)); }
        event(listener) { this.listeners.push(listener); }
      },
      window: {},
      commands: {},
      version: '1.108.1'
    };
  }
  return originalRequire.apply(this, arguments);
};

console.log('🔍 Verifying comprehensive test setup...\n');

const checks = [];

// Check 1: Can load scenarios
try {
  const scenarios = require('./scenarios');
  console.log(`✅ Scenarios loaded: ${scenarios.length} tests`);
  checks.push(true);
} catch (error) {
  console.error('❌ Failed to load scenarios:', error.message);
  checks.push(false);
}

// Check 2: Can load evaluation framework
try {
  const { evaluatePipeline } = require('./evaluation');
  console.log('✅ Evaluation framework loaded');
  checks.push(true);
} catch (error) {
  console.error('❌ Failed to load evaluation framework:', error.message);
  checks.push(false);
}

// Check 3: Can load extension
try {
  const { SDKSessionManager } = require('../dist/extension.js');
  console.log('✅ SDKSessionManager loaded');
  checks.push(true);
} catch (error) {
  console.error('❌ Failed to load SDKSessionManager:', error.message);
  console.error('   Run: npm run compile');
  checks.push(false);
}

// Check 4: Verify output directory exists or can be created
try {
  const fs = require('fs');
  const path = require('path');
  const outputDir = path.join(__dirname, 'output');
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log('✅ Output directory created');
  } else {
    console.log('✅ Output directory exists');
  }
  checks.push(true);
} catch (error) {
  console.error('❌ Failed to create output directory:', error.message);
  checks.push(false);
}

// Check 5: Can load comprehensive test module
try {
  const { main } = require('./comprehensive-test');
  console.log('✅ Comprehensive test module loaded');
  checks.push(true);
} catch (error) {
  console.error('❌ Failed to load comprehensive test:', error.message);
  checks.push(false);
}

// Summary
const passed = checks.filter(c => c).length;
const total = checks.length;

console.log('\n' + '─'.repeat(50));
console.log(`Checks: ${passed}/${total} passed`);
console.log('─'.repeat(50));

if (passed === total) {
  console.log('\n✅ All checks passed! Ready to run comprehensive test.');
  console.log('\nRun: npm run test:comprehensive\n');
  process.exit(0);
} else {
  console.log('\n❌ Some checks failed. Fix issues above before running tests.\n');
  process.exit(1);
}
