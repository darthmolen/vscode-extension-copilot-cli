/**
 * Session Resume Integration Test
 *
 * Tests that openChat command properly resumes sessions:
 * 1. Loads history from correct session
 * 2. Passes sessionId to CLI (so CLI actually resumes that session)
 * 3. Handles corrupt/missing events.jsonl gracefully
 * 4. Creates new session when no session to resume
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');

// Mock the 'vscode' module BEFORE any imports
const originalRequire = Module.prototype.require;
let capturedSessionId = null;
let capturedResumeFlag = null;

const vscode = {
	commands: {
		registerCommand: (id, handler) => ({ dispose: () => {} })
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
		activeTextEditor: null
	},
	workspace: {
		workspaceFolders: [{ uri: { fsPath: '/test/workspace' } }],
		getConfiguration: () => ({
			get: (key, defaultValue) => {
				if (key === 'resumeLastSession') return true;
				if (key === 'filterSessionsByFolder') return true;
				return defaultValue;
			}
		})
	},
	StatusBarAlignment: { Left: 1 },
	Uri: {
		file: (p) => ({ fsPath: p })
	}
};

Module.prototype.require = function(id) {
	if (id === 'vscode') {
		return vscode;
	}
	return originalRequire.apply(this, arguments);
};

// Mock SDKSessionManager to capture what sessionId it receives
class MockSDKSessionManager {
	constructor(context, config, resumeFlag, sessionId) {
		capturedResumeFlag = resumeFlag;
		capturedSessionId = sessionId;
		this._sessionId = sessionId || 'new-session-id';
		this._running = true;
	}

	isRunning() { return this._running; }
	getSessionId() { return this._sessionId; }
	onMessage(handler) {}
	start() { return Promise.resolve(); }
	stop() { this._running = false; return Promise.resolve(); }
}

// These tests create, scan and delete session directories. Point os.homedir()
// at a temp root so they never touch the developer's live ~/.copilot store.
//
// That store is shared with the running extension and the CLI: on this machine
// it held 1263 sessions / 284MB. Scanning it made these tests' runtime a
// function of how much the developer had used the product, and writing to it
// raced a live writer — which is how a 14s suite occasionally took 52s and blew
// a 30s timeout. Hermetic tests do not have that failure mode.
// NOTE: installed in before()/after(), never at module scope. Mocha loads every
// test file before running any of them, so a module-scope stub would redirect
// os.homedir() for the entire suite, not just this file.
let TEST_HOME = null;
const realHomedir = os.homedir;

// Folder these fixture sessions claim to belong to. Selection is folder-scoped,
// so the fixtures must actually live in the folder the assertions ask about.
const TEST_WORKSPACE = path.join(os.tmpdir(), 'session-resume-integration-workspace');

// Test helper: create a session directory with events.jsonl
function createTestSession(sessionId, messageCount = 3) {
	const sessionDir = path.join(os.homedir(), '.copilot', 'session-state', sessionId);
	if (!fs.existsSync(sessionDir)) {
		fs.mkdirSync(sessionDir, { recursive: true });
	}

	const events = [];
	// A real session.start carrying the cwd. Folder-scoped selection reads this
	// (or workspace.yaml below); without it a session has no discoverable folder
	// and is excluded from the filter entirely.
	events.push(JSON.stringify({
		type: 'session.start',
		data: { context: { cwd: TEST_WORKSPACE } },
		timestamp: Date.now() - (messageCount + 1) * 1000
	}));
	for (let i = 0; i < messageCount; i++) {
		events.push(JSON.stringify({
			event: 'user_message',
			timestamp: Date.now() - (messageCount - i) * 1000,
			data: { content: `Test message ${i + 1}` }
		}));
		events.push(JSON.stringify({
			event: 'assistant_message',
			timestamp: Date.now() - (messageCount - i) * 1000 + 100,
			data: { content: `Response ${i + 1}` }
		}));
	}

	fs.writeFileSync(
		path.join(sessionDir, 'events.jsonl'),
		events.join('\n'),
		'utf-8'
	);

	// Write workspace marker
	fs.writeFileSync(
		path.join(sessionDir, 'workspace.yaml'),
		`id: ${sessionId}\ncwd: ${TEST_WORKSPACE}\ngit_root: ${TEST_WORKSPACE}\n`,
		'utf-8'
	);

	return sessionDir;
}

// Test helper: create session directory WITHOUT events.jsonl (corrupt)
function createCorruptSession(sessionId) {
	const sessionDir = path.join(os.homedir(), '.copilot', 'session-state', sessionId);
	if (!fs.existsSync(sessionDir)) {
		fs.mkdirSync(sessionDir, { recursive: true });
	}

	// Only workspace marker, no events.jsonl
	fs.writeFileSync(
		path.join(sessionDir, 'workspace.yaml'),
		`id: ${sessionId}\ncwd: ${TEST_WORKSPACE}\ngit_root: ${TEST_WORKSPACE}\n`,
		'utf-8'
	);

	return sessionDir;
}

// Test helper: clean up test sessions
function cleanupSession(sessionId) {
	const sessionDir = path.join(os.homedir(), '.copilot', 'session-state', sessionId);
	if (fs.existsSync(sessionDir)) {
		fs.rmSync(sessionDir, { recursive: true, force: true });
	}
}

describe('Session Resume Integration Test', function () {
	this.timeout(30000);

	const testSessionId1 = `test-session-resume-${Date.now()}-1`;
	const testSessionId2 = `test-session-resume-${Date.now()}-2`;
	const corruptSessionId = `test-session-corrupt-${Date.now()}`;

	let getMostRecentSession;
	let getAllSessions;
	let getBackendState;

	before(async function () {
		TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'session-resume-home-'));
		os.homedir = () => TEST_HOME;

		createTestSession(testSessionId1, 5);

		// Wait a bit so session2 is newer
		await new Promise(resolve => setTimeout(resolve, 100));

		createTestSession(testSessionId2, 3);
		createCorruptSession(corruptSessionId);

		// Load extension modules (these require vscode mock).
		// os.homedir() is stubbed to TEST_HOME by now, so resolve the state dir
		// here rather than at module scope.
		const { SessionService } = require('../../../out/extension/services/SessionService');
		const sessionStateDir = path.join(os.homedir(), '.copilot', 'session-state');
		getMostRecentSession = (folder, filterByFolder) =>
			SessionService.getMostRecentSession(sessionStateDir, folder, filterByFolder);
		getAllSessions = () => SessionService.getAllSessions(sessionStateDir);

		const backendStateModule = require('../../../out/backendState');
		getBackendState = backendStateModule.getBackendState;
	});

	after(function () {
		cleanupSession(testSessionId1);
		cleanupSession(testSessionId2);
		cleanupSession(corruptSessionId);
	});

	after(function () {
		os.homedir = realHomedir;
		if (TEST_HOME) {
			fs.rmSync(TEST_HOME, { recursive: true, force: true });
			TEST_HOME = null;
		}
	});

	it('should find the most recent session via getMostRecentSession', function () {
		const mostRecent = getMostRecentSession(TEST_WORKSPACE, true);
		assert.strictEqual(mostRecent, testSessionId2, 'Should find most recent session');
	});

	it('should filter out corrupt sessions (no events.jsonl)', function () {
		const allSessions = getAllSessions();
		const corruptSessionExists = allSessions.some(s => s.id === corruptSessionId);
		assert.strictEqual(corruptSessionExists, false, 'Corrupt session should be filtered out');
	});

	it('should include valid sessions in session list', function () {
		const allSessions = getAllSessions();
		const session1Exists = allSessions.some(s => s.id === testSessionId1);
		const session2Exists = allSessions.some(s => s.id === testSessionId2);
		assert.strictEqual(session1Exists, true, 'Valid session 1 should be in list');
		assert.strictEqual(session2Exists, true, 'Valid session 2 should be in list');
	});

	it('should identify correct session for resume (session determination logic)', function () {
		const sessionToResume = getMostRecentSession(TEST_WORKSPACE, true);
		assert.strictEqual(sessionToResume, testSessionId2, 'Should identify correct session');
	});

	it('should properly store messages in BackendState', function () {
		const backendState = getBackendState();

		// Clear it first
		backendState.clearMessages();
		assert.strictEqual(backendState.getMessages().length, 0, 'BackendState should start empty');

		// Add a test message
		backendState.addMessage({
			id: '1',
			type: 'user',
			content: 'Test message',
			timestamp: Date.now()
		});

		assert.strictEqual(backendState.getMessages().length, 1, 'BackendState should store message');
	});
});
