/**
 * main.js Full Integration Tests (Phase 4.7 - All Components)
 *
 * RED-GREEN-REFACTOR Integration Tests
 *
 * These tests verify main.js properly integrates ALL 7 components:
 * 1. EventBus - State management
 * 2. MessageDisplay - Message rendering
 * 3. ToolExecution - Tool call display
 * 4. InputArea - User input
 * 5. SessionToolbar - Session management
 * 6. AcceptanceControls - Accept/reject/swap
 * 7. StatusBar - Status and usage display
 *
 * RED PHASE: These tests should FAIL because main.js doesn't use components yet
 * GREEN PHASE: Wire components in main.js, tests should PASS
 * REFACTOR PHASE: Clean up, tests stay green
 */

const assert = require('assert');
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

describe('main.js Full Component Integration (RED Phase)', () => {
	let dom, window, document;
	let mainModule;

	beforeEach(async () => {
		// Create comprehensive DOM matching chatViewProvider.ts structure
		dom = new JSDOM(`
			<!DOCTYPE html>
			<html>
			<head></head>
			<body>
				<!-- Session Toolbar -->
				<div class="session-toolbar">
					<div class="status-indicator"></div>
					<h2>Copilot CLI</h2>
					<div class="session-selector">
						<select id="sessionSelect"></select>
						<button id="newSessionBtn">+</button>
					</div>
					<button id="viewPlanBtn">View Plan</button>
					<div id="planModeControls">
						<button id="enterPlanModeBtn">Enter Plan Mode</button>
						<button id="acceptPlanBtn" style="display:none">Accept Plan</button>
						<button id="rejectPlanBtn" style="display:none">Reject Plan</button>
					</div>
				</div>

				<!-- Messages Container -->
				<div id="messages"></div>

				<!-- Status Bar -->
				<div class="input-controls">
					<div class="usage-group">
						<span class="usage-info">
							<span id="usageWindow">Window: 0%</span>
							<span id="usageUsed">Used: 0</span>
							<span id="usageRemaining">Remaining: --</span>
						</span>
					</div>
					<span id="reasoningIndicator" style="display: none;">
						<span id="reasoningText">Reasoning...</span>
					</span>
					<label class="reasoning-toggle">
						<input type="checkbox" id="showReasoningCheckbox" />
						<span>Show Reasoning</span>
					</label>
				</div>

				<!-- Input Area -->
				<div class="input-area">
					<textarea id="messageInput" placeholder="Ask Copilot CLI..."></textarea>
					<button id="sendBtn">Send</button>
					<button id="stopBtn" style="display:none">Stop</button>
				</div>

				<!-- Acceptance Controls -->
				<div class="acceptance-controls" style="display:none;">
					<textarea class="acceptance-input"></textarea>
					<div class="acceptance-buttons">
						<button class="accept-btn">Accept</button>
						<button class="reject-btn">Reject</button>
						<button class="swap-btn">Swap</button>
					</div>
				</div>

				<!-- RPC Script (mock) -->
				<script>
					window.rpc = {
						sendMessage: () => {},
						stopSession: () => {},
						viewDiff: () => {},
						switchSession: () => {},
						newSession: () => {},
						viewPlan: () => {},
						togglePlanMode: () => {},
						acceptPlan: () => {},
						rejectPlan: () => {}
					};
				</script>
			</body>
			</html>
		`, {
			url: 'http://localhost',
			runScripts: 'dangerously',
			resources: 'usable'
		});

		window = dom.window;
		document = window.document;

		// Setup globals
		global.window = window;
		global.document = document;
		global.marked = { parse: (text) => `<p>${text}</p>` };

		// Mock VSCode API
		global.acquireVsCodeApi = () => ({
			postMessage: () => {},
			setState: () => {},
			getState: () => null
		});
	});

	afterEach(() => {
		delete global.window;
		delete global.document;
		delete global.marked;
		delete global.acquireVsCodeApi;
	});

	describe('Component Initialization', () => {
		it('should create EventBus instance', async () => {
			// This will FAIL until main.js imports and creates EventBus
			const mainJS = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'webview', 'main.js'), 'utf-8');

			assert.ok(mainJS.includes('import { EventBus }'), 'main.js should import EventBus');
			assert.ok(mainJS.includes('new EventBus()'), 'main.js should create EventBus instance');
		});

		it('should create MessageDisplay component', async () => {
			const mainJS = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'webview', 'main.js'), 'utf-8');

			assert.ok(mainJS.includes('import { MessageDisplay }'), 'main.js should import MessageDisplay');
			assert.ok(mainJS.includes('new MessageDisplay('), 'main.js should create MessageDisplay instance');
		});

		it('should create ToolExecution via MessageDisplay (component hierarchy)', async () => {
			// ToolExecution is created internally by MessageDisplay, not by main.js directly
			const messageDisplayJS = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'webview', 'app', 'components', 'MessageDisplay', 'MessageDisplay.js'), 'utf-8');

			assert.ok(messageDisplayJS.includes('import { ToolExecution }'), 'MessageDisplay should import ToolExecution');
			assert.ok(messageDisplayJS.includes('new ToolExecution('), 'MessageDisplay should create ToolExecution instance');
		});

		it('should create InputArea component', async () => {
			const mainJS = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'webview', 'main.js'), 'utf-8');

			assert.ok(mainJS.includes('import { InputArea }'), 'main.js should import InputArea');
			assert.ok(mainJS.includes('new InputArea('), 'main.js should create InputArea instance');
		});

		it('should create SessionToolbar component', async () => {
			const mainJS = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'webview', 'main.js'), 'utf-8');

			assert.ok(mainJS.includes('import { SessionToolbar }'), 'main.js should import SessionToolbar');
			assert.ok(mainJS.includes('new SessionToolbar('), 'main.js should create SessionToolbar instance');
		});

		it('should create AcceptanceControls component', async () => {
			const mainJS = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'webview', 'main.js'), 'utf-8');

			assert.ok(mainJS.includes('import { AcceptanceControls }'), 'main.js should import AcceptanceControls');
			assert.ok(mainJS.includes('new AcceptanceControls('), 'main.js should create AcceptanceControls instance');
		});

		it('should create StatusBar component', async () => {
			const mainJS = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'webview', 'main.js'), 'utf-8');

			assert.ok(mainJS.includes('import { StatusBar }'), 'main.js should import StatusBar');
			assert.ok(mainJS.includes('new StatusBar('), 'main.js should create StatusBar instance');
		});
	});

	describe('Component Wiring', () => {
		it('should NOT have direct DOM manipulation for messages', async () => {
			// After integration, main.js should use MessageDisplay component, not direct DOM
			const mainJS = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'webview', 'main.js'), 'utf-8');

			// Should NOT directly manipulate #messages (but can reference it for components)
			const hasDirectMessageDOM = mainJS.includes('messages.appendChild') ||
			                           mainJS.includes('messages.innerHTML =');

			assert.ok(!hasDirectMessageDOM, 'main.js should use MessageDisplay component, not direct DOM manipulation');
		});

		it('should NOT have direct DOM manipulation for tool execution', async () => {
			const mainJS = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'webview', 'main.js'), 'utf-8');

			// Should NOT have inline tool execution rendering
			const hasDirectToolDOM = mainJS.includes('tool-execution-item') ||
			                        mainJS.includes('createToolExecutionElement');

			assert.ok(!hasDirectToolDOM, 'main.js should use ToolExecution component, not inline rendering');
		});

		it('should NOT have direct input event handlers', async () => {
			const mainJS = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'webview', 'main.js'), 'utf-8');

			// Should NOT directly attach to sendBtn, stopBtn
			const hasDirectInputHandlers = mainJS.includes('sendBtn.addEventListener') ||
			                              mainJS.includes('stopBtn.addEventListener');

			assert.ok(!hasDirectInputHandlers, 'main.js should use InputArea component events, not direct handlers');
		});

		it('should NOT have direct session toolbar handlers', async () => {
			const mainJS = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'webview', 'main.js'), 'utf-8');

			// Should NOT directly attach to session controls
			const hasDirectSessionHandlers = mainJS.includes('sessionSelect.addEventListener') ||
			                                 mainJS.includes('newSessionBtn.addEventListener');

			assert.ok(!hasDirectSessionHandlers, 'main.js should use SessionToolbar component events');
		});

		it('should NOT have direct status bar updates', async () => {
			const mainJS = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'webview', 'main.js'), 'utf-8');

			// Should NOT directly update usage elements
			const hasDirectStatusUpdates = mainJS.includes('usageWindow.textContent =') ||
			                               mainJS.includes('usageUsed.textContent =') ||
			                               mainJS.includes('reasoningIndicator.style');

			assert.ok(!hasDirectStatusUpdates, 'main.js should use StatusBar component methods');
		});
	});

	describe('Code Size Reduction', () => {
		it('should have reduced main.js significantly', async () => {
			const mainJS = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'webview', 'main.js'), 'utf-8');
			const lineCount = mainJS.split('\n').length;

			// Original: 952 lines
			// After componentization: ~530 lines (44% reduction!)
			// Allow buffer: 550 lines max
			assert.ok(lineCount <= 550, `main.js should be <= 550 lines (was 952), got ${lineCount}`);
		});
	});
});
