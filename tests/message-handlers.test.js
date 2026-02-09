/**
 * Unit tests for webview message handlers
 * Testing individual handler functions extracted from switch statement
 */

const assert = require('assert').strict;
const { JSDOM } = require('jsdom');

async function runTests() {
	console.log('='.repeat(70));
	console.log('Webview Message Handler Tests');
	console.log('='.repeat(70));
	
	const testResults = [];
	
	function recordTest(name, passed, details = '') {
		testResults.push({ name, passed, details });
		const icon = passed ? '✅' : '❌';
		console.log(`${icon} ${name}${details ? ': ' + details : ''}`);
	}
	
	// Set up JSDOM environment with all required elements
	const dom = new JSDOM(`
		<!DOCTYPE html>
		<html>
		<body>
			<div id="messages"></div>
			<div id="emptyState"></div>
			<div id="thinking" style="display: none;"></div>
			<input id="messageInput" />
			<button id="sendButton"></button>
			<div id="statusIndicator"></div>
			<select id="sessionSelect"></select>
			<button id="newSessionBtn"></button>
			<button id="viewPlanBtn"></button>
			<input type="checkbox" id="showReasoningCheckbox" />
			<button id="enterPlanModeBtn"></button>
			<button id="acceptPlanBtn"></button>
			<button id="rejectPlanBtn"></button>
			<div id="reasoningIndicator"></div>
			<div id="usageWindow"></div>
			<div id="usageUsed"></div>
			<div id="usageRemaining"></div>
			<div id="focusFileInfo"></div>
			<div id="acceptanceControls"></div>
			<input id="acceptanceInput" />
			<button id="keepPlanningBtn"></button>
			<button id="acceptAndWorkBtn"></button>
			<button id="attachButton"></button>
			<div id="attachmentsPreview"></div>
			<span id="attachCount"></span>
		</body>
		</html>
	`, {
		url: 'http://localhost',
		pretendToBeVisual: true
	});
	
	// Make DOM globals available
	global.window = dom.window;
	global.document = dom.window.document;
	
	// Mock acquireVsCodeApi (needed by main.js)
	global.acquireVsCodeApi = () => ({
		postMessage: () => {},
		setState: () => {},
		getState: () => ({})
	});
	
	try {
		// Import main.js to get handler functions
		const mainPath = '../src/webview/main.js';
		const mainModule = await import(mainPath);
		
		// Test 1: handleThinkingMessage - show thinking indicator
		try {
			const thinking = document.getElementById('thinking');
			
			if (!mainModule.handleThinkingMessage) {
				throw new Error('handleThinkingMessage not exported');
			}
			
			// Test showing thinking
			mainModule.handleThinkingMessage({ isThinking: true });
			assert.ok(thinking.classList.contains('active'), 'Should add active class when thinking');
			assert.equal(thinking.getAttribute('aria-busy'), 'true', 'Should set aria-busy to true');
			
			// Test hiding thinking
			mainModule.handleThinkingMessage({ isThinking: false });
			assert.ok(!thinking.classList.contains('active'), 'Should remove active class when not thinking');
			assert.equal(thinking.getAttribute('aria-busy'), 'false', 'Should set aria-busy to false');
			
			recordTest('handleThinkingMessage works', true);
		} catch (error) {
			recordTest('handleThinkingMessage works', false, error.message);
		}
		
	} catch (error) {
		recordTest('Test setup', false, error.message);
		console.error(error);
	} finally {
		// Clean up globals
		delete global.window;
		delete global.document;
	}
	
	// Summary
	console.log('='.repeat(70));
	console.log('Test Results Summary');
	console.log('='.repeat(70));
	console.log('');
	const passed = testResults.filter(r => r.passed).length;
	const failed = testResults.filter(r => !r.passed).length;
	console.log(`Total: ${testResults.length} | Passed: ${passed} | Failed: ${failed}`);
	console.log('');
	console.log('='.repeat(70));
	
	process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(error => {
	console.error('Test runner error:', error);
	process.exit(1);
});
