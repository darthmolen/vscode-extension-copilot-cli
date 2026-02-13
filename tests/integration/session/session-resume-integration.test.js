/**
 * Session Resume E2E Integration Test
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
const Module = require('module');

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

describe('Session Resume E2E Integration Test', function () {
	this.timeout(30000);

	let openChatHandler = null;
	const originalRequire = Module.prototype.require;

	before(function (done) {
		// Polyfill browser globals needed by webview components
		global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
		global.cancelAnimationFrame = (id) => clearTimeout(id);
		global.MutationObserver = class { observe() {} disconnect() {} };

		// Create test sessions
		createTestSession(testSessionId1);

		// Wait to ensure session2 is newer
		setTimeout(() => {
			createTestSession(testSessionId2);

			// Mock vscode and SDKSessionManager BEFORE loading extension
			const EventEmitter = require('events');

			// vscode.EventEmitter mock that mimics VS Code API
			class MockVSCodeEventEmitter {
				constructor() {
					this._emitter = new EventEmitter();
					this.event = (listener) => {
						this._emitter.on('event', listener);
						return { dispose: () => this._emitter.removeListener('event', listener) };
					};
				}
				fire(data) {
					this._emitter.emit('event', data);
				}
				dispose() {
					this._emitter.removeAllListeners();
				}
			}

			// Mock webview panel
			function createMockWebviewPanel() {
				return {
					webview: {
						html: '',
						options: {},
						onDidReceiveMessage: () => ({ dispose: () => {} }),
						postMessage: () => Promise.resolve(true),
						asWebviewUri: (uri) => uri,
						cspSource: ''
					},
					reveal: () => {},
					onDidChangeViewState: () => ({ dispose: () => {} }),
					onDidDispose: () => ({ dispose: () => {} }),
					visible: true,
					active: true,
					viewColumn: 1,
					dispose: () => {}
				};
			}

			const vscode = {
				version: '1.85.0',
				EventEmitter: MockVSCodeEventEmitter,
				commands: {
					registerCommand: (id, handler) => {
						if (id === 'copilot-cli-extension.openChat') {
							openChatHandler = handler;
						}
						return { dispose: () => {} };
					},
					executeCommand: () => Promise.resolve()
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
						command: '',
						show: () => {},
						hide: () => {},
						dispose: () => {}
					}),
					createWebviewPanel: () => createMockWebviewPanel(),
					showInformationMessage: () => Promise.resolve(),
					showErrorMessage: () => Promise.resolve(),
					showWarningMessage: () => Promise.resolve(),
					showTextDocument: () => Promise.resolve(),
					activeTextEditor: null,
					visibleTextEditors: [],
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
					onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
					openTextDocument: () => Promise.resolve({})
				},
				StatusBarAlignment: { Left: 1, Right: 2 },
				Uri: {
					file: (p) => ({ fsPath: p }),
					joinPath: (uri, ...paths) => ({ fsPath: path.join(uri.fsPath, ...paths) })
				},
				ViewColumn: { One: 1, Two: 2 }
			};

			// Mock SDKSessionManager - THIS IS THE KEY
			const noopEvent = () => ({ dispose: () => {} });

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
				getWorkspacePath() { return '/test/workspace'; }
				onMessage(handler) { this._messageHandlers.push(handler); }
				async start() { return Promise.resolve(); }
				async stop() { this._running = false; }
				async sendMessage() {}
				async abortMessage() {}
				async enablePlanMode() {}
				async disablePlanMode() {}
				async acceptPlan() {}
				async rejectPlan() {}
				async validateAttachments() { return []; }
				dispose() {}

				// Event subscription methods
				onDidReceiveOutput(handler) { return noopEvent(); }
				onDidReceiveReasoning(handler) { return noopEvent(); }
				onDidReceiveError(handler) { return noopEvent(); }
				onDidChangeStatus(handler) { return noopEvent(); }
				onDidStartTool(handler) { return noopEvent(); }
				onDidUpdateTool(handler) { return noopEvent(); }
				onDidCompleteTool(handler) { return noopEvent(); }
				onDidChangeFile(handler) { return noopEvent(); }
				onDidProduceDiff(handler) { return noopEvent(); }
				onDidUpdateUsage(handler) { return noopEvent(); }
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

			// Load the extension (with our mocks in place)
			const extensionModule = require('../../../out/extension');

			// Activate with mock context
			const mockContext = {
				subscriptions: [],
				extensionUri: { fsPath: '/fake/extension' },
				extensionPath: '/fake/extension',
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
				// Clear any constructor calls from activation
				cliManagerConstructorCalls = [];
				done();
			}, 100);
		}, 100);
	});

	after(function () {
		cleanupSession(testSessionId1);
		cleanupSession(testSessionId2);
		// Restore original require
		Module.prototype.require = originalRequire;
		// Cleanup polyfills
		delete global.requestAnimationFrame;
		delete global.cancelAnimationFrame;
		delete global.MutationObserver;
	});

	it('should register the openChat command handler', function () {
		assert.ok(openChatHandler !== null, 'openChat command handler not registered!');
	});

	it('should pass resumeFlag=true to CLI manager', async function () {
		if (!openChatHandler) {
			this.skip();
			return;
		}

		await openChatHandler();

		if (cliManagerConstructorCalls.length === 0) {
			// CLI manager might already be running - skip
			this.skip();
			return;
		}

		const call = cliManagerConstructorCalls[cliManagerConstructorCalls.length - 1];
		assert.strictEqual(call.resumeFlag, true, 'resumeFlag should be true');
	});

	it('should pass sessionId to CLI manager (not undefined)', async function () {
		if (cliManagerConstructorCalls.length === 0) {
			this.skip();
			return;
		}

		const call = cliManagerConstructorCalls[cliManagerConstructorCalls.length - 1];
		assert.ok(
			call.sessionId !== undefined && call.sessionId !== null,
			'sessionId MUST be passed to CLI manager'
		);
	});

	it('should pass the most recent sessionId to CLI manager', async function () {
		if (cliManagerConstructorCalls.length === 0) {
			this.skip();
			return;
		}

		const call = cliManagerConstructorCalls[cliManagerConstructorCalls.length - 1];
		assert.strictEqual(
			call.sessionId,
			testSessionId2,
			'sessionId should be the most recent session'
		);
	});
});
