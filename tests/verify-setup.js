#!/usr/bin/env node

/**
 * Quick verification that test infrastructure is working
 * Checks dependencies, imports, and basic setup
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

console.log('🔍 Verifying test setup...\n');

const checks = [];

// Check 1: Can load scenarios (used by some tests)
try {
  const scenarios = require('./scenarios');
  console.log(`✅ Scenarios loaded: ${scenarios.length} scenarios available`);
  checks.push(true);
} catch (error) {
  console.error('❌ Failed to load scenarios:', error.message);
  checks.push(false);
}

// Check 2: Extension build exists
try {
  const fs = require('fs');
  const path = require('path');
  const extensionPath = path.join(__dirname, '../dist/extension.js');
  
  if (fs.existsSync(extensionPath)) {
    console.log('✅ Extension build exists (dist/extension.js)');
    checks.push(true);
  } else {
    console.error('❌ Extension build not found');
    console.error('   Run: npm run compile');
    checks.push(false);
  }
} catch (error) {
  console.error('❌ Failed to check extension build:', error.message);
  checks.push(false);
}

// Check 3: SDKSessionManager can be loaded
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

// Check 5: Verify test files exist
try {
  const fs = require('fs');
  const path = require('path');
  const testFiles = [
    'plan-mode-tools.test.js',
    'mcp-integration.test.js',
    'scenarios.js'
  ];
  
  const existing = testFiles.filter(f => 
    fs.existsSync(path.join(__dirname, f))
  );
  
  if (existing.length === testFiles.length) {
    console.log(`✅ Test files found (${existing.length}/${testFiles.length})`);
    checks.push(true);
  } else {
    console.error(`❌ Some test files missing (${existing.length}/${testFiles.length})`);
    checks.push(false);
  }
} catch (error) {
  console.error('❌ Failed to check test files:', error.message);
  checks.push(false);
}

// Summary
const passed = checks.filter(c => c).length;
const total = checks.length;

console.log('\n' + '─'.repeat(50));
console.log(`Checks: ${passed}/${total} passed`);
console.log('─'.repeat(50));

if (passed === total) {
  console.log('\n✅ All checks passed! Test infrastructure is ready.');
  console.log('\nAvailable test commands:');
  console.log('  npm run test              # Run default tests');
  console.log('  npm run test:plan-mode    # Plan mode tests');
  console.log('  npm run test:mcp          # MCP integration tests');
  console.log('  npm run test:integration  # SDK integration tests\n');
  process.exit(0);
} else {
  console.log('\n❌ Some checks failed. Fix issues above before running tests.\n');
  process.exit(1);
}
