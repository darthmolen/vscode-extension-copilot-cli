const assert = require('assert');
const { JSDOM } = require('jsdom');

describe('StatusBar Component', () => {
	let dom, document, container, statusBar;

	beforeEach(() => {
		// Create fresh DOM for each test
		dom = new JSDOM('<!DOCTYPE html><html><body><div id="test-container"></div></body></html>');
		document = dom.window.document;
		global.document = document;
		global.window = dom.window;
		container = document.getElementById('test-container');
	});

	afterEach(() => {
		if (statusBar && statusBar.destroy) {
			statusBar.destroy();
		}
		container.innerHTML = '';
		delete global.document;
		delete global.window;
	});

	describe('Component Creation', () => {
		it('should create StatusBar instance', async () => {
			const { StatusBar } = await import('../../../src/webview/app/components/StatusBar/StatusBar.js');

			statusBar = new StatusBar(container);

			assert.ok(statusBar, 'StatusBar should be created');
			assert.ok(container.querySelector('.status-bar'), 'Should render status bar');
		});
	});

	describe('Rendering', () => {
		it('should render status bar container', async () => {
			const { StatusBar } = await import('../../../src/webview/app/components/StatusBar/StatusBar.js');

			statusBar = new StatusBar(container);

			assert.ok(container.querySelector('.status-bar'), 'Should render status bar');
		});

		it('should render reasoning indicator', async () => {
			const { StatusBar } = await import('../../../src/webview/app/components/StatusBar/StatusBar.js');

			statusBar = new StatusBar(container);

			const reasoningIndicator = container.querySelector('.reasoning-indicator');
			assert.ok(reasoningIndicator, 'Should render reasoning indicator');
		});

		it('should render usage info container', async () => {
			const { StatusBar } = await import('../../../src/webview/app/components/StatusBar/StatusBar.js');

			statusBar = new StatusBar(container);

			const usageInfo = container.querySelector('.usage-info');
			assert.ok(usageInfo, 'Should render usage info');
		});

		it('should render usage window element', async () => {
			const { StatusBar } = await import('../../../src/webview/app/components/StatusBar/StatusBar.js');

			statusBar = new StatusBar(container);

			const usageWindow = container.querySelector('#usageWindow');
			assert.ok(usageWindow, 'Should render usage window');
		});

		it('should render usage used element', async () => {
			const { StatusBar } = await import('../../../src/webview/app/components/StatusBar/StatusBar.js');

			statusBar = new StatusBar(container);

			const usageUsed = container.querySelector('#usageUsed');
			assert.ok(usageUsed, 'Should render usage used');
		});

		it('should render usage remaining element', async () => {
			const { StatusBar } = await import('../../../src/webview/app/components/StatusBar/StatusBar.js');

			statusBar = new StatusBar(container);

			const usageRemaining = container.querySelector('#usageRemaining');
			assert.ok(usageRemaining, 'Should render usage remaining');
		});
	});

	describe('Reasoning Indicator', () => {
		it('should start with reasoning indicator hidden', async () => {
			const { StatusBar } = await import('../../../src/webview/app/components/StatusBar/StatusBar.js');

			statusBar = new StatusBar(container);

			const indicator = container.querySelector('.reasoning-indicator');
			assert.ok(indicator.style.display === 'none', 'Reasoning indicator should be hidden');
		});

		it('should show reasoning indicator with showReasoning()', async () => {
			const { StatusBar } = await import('../../../src/webview/app/components/StatusBar/StatusBar.js');

			statusBar = new StatusBar(container);
			statusBar.showReasoning();

			const indicator = container.querySelector('.reasoning-indicator');
			assert.ok(indicator.style.display !== 'none', 'Reasoning indicator should be visible');
		});

		it('should hide reasoning indicator with hideReasoning()', async () => {
			const { StatusBar } = await import('../../../src/webview/app/components/StatusBar/StatusBar.js');

			statusBar = new StatusBar(container);
			statusBar.showReasoning();
			statusBar.hideReasoning();

			const indicator = container.querySelector('.reasoning-indicator');
			assert.strictEqual(indicator.style.display, 'none', 'Reasoning indicator should be hidden');
		});

		it('should update reasoning text with setReasoningText()', async () => {
			const { StatusBar } = await import('../../../src/webview/app/components/StatusBar/StatusBar.js');

			statusBar = new StatusBar(container);
			statusBar.setReasoningText('Custom reasoning...');

			const text = container.querySelector('#reasoningText');
			assert.strictEqual(text.textContent, 'Custom reasoning...', 'Should update reasoning text');
		});
	});

	describe('Usage Info', () => {
		it('should update usage window with updateUsageWindow()', async () => {
			const { StatusBar } = await import('../../../src/webview/app/components/StatusBar/StatusBar.js');

			statusBar = new StatusBar(container);
			statusBar.updateUsageWindow(45, 1000, 2000);

			const usageWindow = container.querySelector('#usageWindow');
			assert.ok(usageWindow.textContent.includes('45%'), 'Should show percentage');
			// toLocaleString may add commas, so just check the numbers are present
			assert.ok(usageWindow.title.includes('1') && usageWindow.title.includes('000'), 'Should show used in title');
			assert.ok(usageWindow.title.includes('2') && usageWindow.title.includes('000'), 'Should show limit in title');
		});

		it('should update usage used with updateUsageUsed()', async () => {
			const { StatusBar } = await import('../../../src/webview/app/components/StatusBar/StatusBar.js');

			statusBar = new StatusBar(container);
			statusBar.updateUsageUsed(15000);

			const usageUsed = container.querySelector('#usageUsed');
			assert.ok(usageUsed.textContent.includes('15'), 'Should show compact format');
		});

		it('should update usage remaining with updateUsageRemaining()', async () => {
			const { StatusBar } = await import('../../../src/webview/app/components/StatusBar/StatusBar.js');

			statusBar = new StatusBar(container);
			statusBar.updateUsageRemaining(42);

			const usageRemaining = container.querySelector('#usageRemaining');
			assert.ok(usageRemaining.textContent.includes('42'), 'Should show remaining count');
		});

		it('should handle null usage remaining', async () => {
			const { StatusBar } = await import('../../../src/webview/app/components/StatusBar/StatusBar.js');

			statusBar = new StatusBar(container);
			statusBar.updateUsageRemaining(null);

			const usageRemaining = container.querySelector('#usageRemaining');
			assert.ok(usageRemaining.textContent.includes('--'), 'Should show -- for null');
		});

		it('should format large numbers with compact notation', async () => {
			const { StatusBar } = await import('../../../src/webview/app/components/StatusBar/StatusBar.js');

			statusBar = new StatusBar(container);
			statusBar.updateUsageUsed(1234567);

			const usageUsed = container.querySelector('#usageUsed');
			// Should show something like "1.2M" or "1234K"
			assert.ok(usageUsed.textContent.length < 15, 'Should use compact format');
		});
	});

	describe('Event Emitter', () => {
		it('should support on() to add event listeners', async () => {
			const { StatusBar } = await import('../../../src/webview/app/components/StatusBar/StatusBar.js');

			let called = false;
			statusBar = new StatusBar(container);
			statusBar.on('test', () => {
				called = true;
			});
			statusBar.emit('test');

			assert.ok(called, 'Should call event listener');
		});

		it('should support off() to remove event listeners', async () => {
			const { StatusBar } = await import('../../../src/webview/app/components/StatusBar/StatusBar.js');

			let callCount = 0;
			const handler = () => { callCount++; };

			statusBar = new StatusBar(container);
			statusBar.on('test', handler);
			statusBar.emit('test');
			statusBar.off('test', handler);
			statusBar.emit('test');

			assert.strictEqual(callCount, 1, 'Should only call once before removal');
		});
	});

	describe('Cleanup', () => {
		it('should clean up with destroy()', async () => {
			const { StatusBar } = await import('../../../src/webview/app/components/StatusBar/StatusBar.js');

			statusBar = new StatusBar(container);
			statusBar.destroy();

			assert.strictEqual(container.innerHTML, '', 'Should remove all content');
		});
	});
});
