/**
 * Unit tests for ExtensionRpcRouter
 */

const assert = require('assert').strict;
const Module = require('module');

// Mock vscode
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
if (id === 'vscode') {
return {};
}
return originalRequire.apply(this, arguments);
};

async function runTests() {
console.log('='.repeat(70));
console.log('ExtensionRpcRouter Unit Tests');
console.log('='.repeat(70));

const testResults = [];

function recordTest(name, passed, details = '') {
testResults.push({ name, passed, details });
console.log(`${passed ? '✅' : '❌'} ${name}${details ? ': ' + details : ''}`);
}

try {
const extensionModule = require('../dist/extension.js');
const ExtensionRpcRouter = extensionModule.ExtensionRpcRouter;

if (!ExtensionRpcRouter) {
recordTest('Import ExtensionRpcRouter', false, 'Not exported');
return;
}
recordTest('Import ExtensionRpcRouter', true);

// Test: Instantiation
const mockWebview = createMockWebview();
const router = new ExtensionRpcRouter(mockWebview);
recordTest('Router instantiation', true);

// Test: Send init
router.sendInit({
sessionId: 'test',
sessionActive: true,
messages: [],
planModeStatus: null,
workspacePath: null,
activeFilePath: null
});

const sent = mockWebview._getSentMessages();
assert.equal(sent[0].type, 'init');
recordTest('Send init message', true);

// Test: Handler registration
let called = false;
router.onReady(() => { called = true; });
router.route({ type: 'ready' });
assert.ok(called);
recordTest('Handler registration', true);

} catch (error) {
recordTest('Test suite', false, error.message);
}

console.log('='.repeat(70));
const passed = testResults.filter(t => t.passed).length;
const failed = testResults.filter(t => !t.passed).length;
console.log(`Total: ${testResults.length} | Passed: ${passed} | Failed: ${failed}`);
console.log('='.repeat(70));

if (failed > 0) process.exit(1);
}

function createMockWebview() {
const sentMessages = [];
return {
postMessage(msg) { sentMessages.push(msg); },
onDidReceiveMessage(h) { return { dispose: () => {} }; },
_getSentMessages() { return sentMessages; }
};
}

runTests().catch(error => {
console.error('Fatal error:', error);
process.exit(1);
});
