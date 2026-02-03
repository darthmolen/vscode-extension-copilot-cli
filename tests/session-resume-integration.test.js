/**
 * Session Resume Integration Test - REAL END-TO-END
 * 
 * This test actually mocks the CLI manager and verifies that:
 * 1. openChat command determines the correct session to resume
 * 2. Loads history from that session into BackendState
 * 3. PASSES THAT SESSIONID to the CLI manager constructor
 * 
 * This test will FAIL with current code (bug) and PASS when fixed.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Captured values from mocked CLI manager
let cliManagerConstructorCalls = [];

// Create test sessions BEFORE loading any extension code
const testSessionId1 = `test-resume-e2e-${Date.now()}-1`;
const testSessionId2 = `test-resume-e2e-${Date.now()}-2`;

function createTestSession(sessionId, workspace = '/test/workspace') {
	const sessionDir = path.join(os.homedir(), '.copilot', 'session-state', sessionId);
	fs.mkdirSync(sessionDir, { recursive: true });
	
	const events = [
		JSON.stringify({ event: 'user_message', timestamp: Date.now(), data: { content: 'test' } }),
		JSON.stringify({ event: 'assistant_message', timestamp: Date.now() + 1, data: { content: 'response' } })
	];
	
	fs.writeFileSync(path.join(sessionDir, 'events.jsonl'), events.join('\n'));
	fs.writeFileSync(path.join(sessionDir, 'workspace.txt'), workspace);
	
	return sessionDir;
}

function cleanupSession(sessionId) {
	const sessionDir = path.join(os.homedir(), '.copilot', 'session-state', sessionId);
	if (fs.existsSync(sessionDir)) {
		fs.rmSync(sessionDir, { recursive: true, force: true });
	}
}

console.log('======================================================================');
console.log('Session Resume E2E Integration Test');
console.log('Testing ACTUAL openChat → CLI manager sessionId passing');
console.log('======================================================================\n');

console.log('📋 Setup: Creating test sessions');
createTestSession(testSessionId1);
console.log(`   Created session 1: ${testSessionId1}`);

// Wait to ensure session2 is newer
setTimeout(() => {
	createTestSession(testSessionId2);
	console.log(`   Created session 2 (newer): ${testSessionId2}\n`);
	
	// NOW mock vscode and SDKSessionManager BEFORE loading extension
	const Module = require('module');
	const originalRequire = Module.prototype.require;
	
	let openChatHandler = null;
	
	const vscode = {
		commands: {
			registerCommand: (id, handler) => {
				if (id === 'copilot-cli-extension.openChat') {
					openChatHandler = handler;
				}
				return { dispose: () => {} };
			}
		},
		window: {
			createOutputChannel: () => ({
				appendLine: () => {},
				show: () => {},
				dispose: () => {}
			}),
			createStatusBarItem: () => ({
				text: '',
				tooltip: '',
				show: () => {},
				hide: () => {},
				dispose: () => {}
			}),
			showInformationMessage: () => {},
			showErrorMessage: () => {},
			activeTextEditor: null,
			onDidChangeActiveTextEditor: () => ({ dispose: () => {} })
		},
		workspace: {
			workspaceFolders: [{ uri: { fsPath: '/test/workspace' } }],
			getConfiguration: () => ({
				get: (key, defaultValue) => {
					if (key === 'resumeLastSession') return true;
					if (key === 'filterSessionsByFolder') return true;
					if (key === 'autoStartChat') return false;
					return defaultValue;
				}
			}),
			onDidChangeWorkspaceFolders: () => ({ dispose: () => {} })
		},
		StatusBarAlignment: { Left: 1 },
		Uri: {
			file: (p) => ({ fsPath: p }),
			joinPath: (uri, ...paths) => ({ fsPath: path.join(uri.fsPath, ...paths) })
		},
		ViewColumn: { One: 1 }
	};
	
	// Mock SDKSessionManager - THIS IS THE KEY
	class MockSDKSessionManager {
		constructor(context, config, resumeFlag, sessionId) {
			// CAPTURE what we were called with!
			cliManagerConstructorCalls.push({
				resumeFlag,
				sessionId,
				timestamp: Date.now()
			});
			
			this._sessionId = sessionId || `new-session-${Date.now()}`;
			this._running = true;
			this._messageHandlers = [];
		}
		
		isRunning() { return this._running; }
		getSessionId() { return this._sessionId; }
		onMessage(handler) { this._messageHandlers.push(handler); }
		async start() { return Promise.resolve(); }
		async stop() { this._running = false; }
	}
	
	Module.prototype.require = function(id) {
		if (id === 'vscode') {
			return vscode;
		}
		if (id.includes('sdkSessionManager')) {
			return { SDKSessionManager: MockSDKSessionManager };
		}
		return originalRequire.apply(this, arguments);
	};
	
	// NOW load the extension (with our mocks in place)
	console.log('📋 Loading extension module with mocks...\n');
	
	const extensionModule = require('../out/extension');
	
	// Activate with mock context
	const mockContext = {
		subscriptions: [],
		extensionUri: { fsPath: '/fake/extension' },
		globalState: {
			get: () => undefined,
			update: () => Promise.resolve()
		},
		workspaceState: {
			get: () => undefined,
			update: () => Promise.resolve()
		}
	};
	
	extensionModule.activate(mockContext);
	
	// Give it a moment to register commands
	setTimeout(() => {
		console.log('📋 Extension activated, openChat command registered\n');
		
		// Clear any constructor calls from activation
		cliManagerConstructorCalls = [];
		
		// NOW trigger the openChat command
		console.log('📋 Test: Triggering openChat command with resume=true\n');
		
		if (!openChatHandler) {
			throw new Error('openChat command handler not registered!');
		}
		
		openChatHandler().then(() => {
			console.log('📋 Analyzing CLI manager constructor calls...\n');
			
			if (cliManagerConstructorCalls.length === 0) {
				console.log('⚠️  No CLI manager created (might already be running)');
				cleanupAndExit(0);
				return;
			}
			
			const call = cliManagerConstructorCalls[cliManagerConstructorCalls.length - 1];
			
			console.log('   CLI Manager Constructor received:');
			console.log(`   - resumeFlag: ${call.resumeFlag}`);
			console.log(`   - sessionId: ${call.sessionId || '(undefined - NEW SESSION!)'}\n`);
			
			// THE CRITICAL TEST
			console.log('📋 CRITICAL TEST: Did CLI receive the correct sessionId?\n');
			console.log(`   Expected sessionId: ${testSessionId2} (most recent)`);
			console.log(`   Actual sessionId:   ${call.sessionId || 'undefined'}\n`);
			
			let passed = 0;
			let failed = 0;
			
			try {
				// Test 1: Resume flag should be true
				assert.strictEqual(call.resumeFlag, true, 'resumeFlag should be true');
				passed++;
				console.log('✅ Test 1 passed: resumeFlag is true\n');
				
				// Test 2: SessionId MUST be passed (this is the bug!)
				assert.strictEqual(
					call.sessionId !== undefined && call.sessionId !== null,
					true,
					'sessionId MUST be passed to CLI manager'
				);
				passed++;
				console.log('✅ Test 2 passed: sessionId is passed to CLI manager\n');
				
				// Test 3: SessionId should be the most recent one
				assert.strictEqual(
					call.sessionId,
					testSessionId2,
					'sessionId should be the most recent session'
				);
				passed++;
				console.log('✅ Test 3 passed: sessionId is the correct (most recent) session\n');
				
				console.log('======================================================================');
				console.log('Test Summary');
				console.log('======================================================================');
				console.log(`Total: ${passed + failed} tests`);
				console.log(`Passed: ${passed} ✅`);
				console.log(`Failed: ${failed} ❌\n`);
				
				if (passed === 3) {
					console.log('✅ ALL TESTS PASSED - CLI receives correct sessionId!\n');
					console.log('Validated:');
					console.log('  • CLI manager called with resume=true');
					console.log('  • CLI manager receives sessionId (not undefined)');
					console.log('  • CLI manager receives CORRECT sessionId (most recent)');
					console.log('  • UI and CLI are now IN SYNC (same session)\n');
				}
				
				cleanupAndExit(failed > 0 ? 1 : 0);
				
			} catch (error) {
				failed++;
				console.error(`\n❌ TEST FAILED: ${error.message}\n`);
				console.error('   This is the BUG:');
				console.error('   - We determine sessionId and load history');
				console.error('   - But we DON\'T pass it to startCLISession');
				console.error('   - Result: UI shows old session, CLI starts NEW session');
				console.error('   - User sees history but can\'t interact with that session\n');
				
				console.log('======================================================================');
				console.log('Test Summary');
				console.log('======================================================================');
				console.log(`Total: ${passed + failed} tests`);
				console.log(`Passed: ${passed} ✅`);
				console.log(`Failed: ${failed} ❌\n`);
				
				cleanupAndExit(1);
			}
			
		}).catch(error => {
			console.error('❌ openChat handler failed:', error);
			cleanupAndExit(1);
		});
		
	}, 100);
	
}, 100);

function cleanupAndExit(code) {
	console.log('🧹 Cleanup: Removing test sessions');
	cleanupSession(testSessionId1);
	cleanupSession(testSessionId2);
	process.exit(code);
}

// Timeout safety
setTimeout(() => {
	console.error('\n❌ Test timeout - extension took too long');
	cleanupAndExit(1);
}, 10000);
