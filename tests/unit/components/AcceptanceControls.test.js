const assert = require('assert');
const { JSDOM } = require('jsdom');

describe('AcceptanceControls Component', () => {
	let dom, document, container, acceptanceControls;

	beforeEach(() => {
		// Create fresh DOM for each test
		dom = new JSDOM('<!DOCTYPE html><html><body><div id="test-container"></div></body></html>');
		document = dom.window.document;
		global.document = document;
		global.window = dom.window;
		container = document.getElementById('test-container');
	});

	afterEach(() => {
		if (acceptanceControls && acceptanceControls.destroy) {
			acceptanceControls.destroy();
		}
		container.innerHTML = '';
		delete global.document;
		delete global.window;
	});

	describe('Component Creation', () => {
		it('should create AcceptanceControls instance', async () => {
			const { AcceptanceControls } = await import('../../../src/webview/app/components/AcceptanceControls/AcceptanceControls.js');

			acceptanceControls = new AcceptanceControls(container);

			assert.ok(acceptanceControls, 'AcceptanceControls should be created');
			assert.ok(container.querySelector('.acceptance-controls'), 'Should render controls container');
		});
	});

	describe('Rendering', () => {
		it('should render acceptance controls container', async () => {
			const { AcceptanceControls } = await import('../../../src/webview/app/components/AcceptanceControls/AcceptanceControls.js');

			acceptanceControls = new AcceptanceControls(container);

			assert.ok(container.querySelector('.acceptance-controls'), 'Should render controls container');
		});

		it('should render acceptance input field', async () => {
			const { AcceptanceControls } = await import('../../../src/webview/app/components/AcceptanceControls/AcceptanceControls.js');

			acceptanceControls = new AcceptanceControls(container);

			const input = container.querySelector('.acceptance-input');
			assert.ok(input, 'Should render input field');
			assert.strictEqual(input.tagName, 'TEXTAREA', 'Should be a textarea');
		});

		it('should render accept button', async () => {
			const { AcceptanceControls } = await import('../../../src/webview/app/components/AcceptanceControls/AcceptanceControls.js');

			acceptanceControls = new AcceptanceControls(container);

			const acceptBtn = container.querySelector('.accept-btn');
			assert.ok(acceptBtn, 'Should render accept button');
			assert.strictEqual(acceptBtn.textContent, 'Accept', 'Button should say Accept');
		});

		it('should render reject button', async () => {
			const { AcceptanceControls } = await import('../../../src/webview/app/components/AcceptanceControls/AcceptanceControls.js');

			acceptanceControls = new AcceptanceControls(container);

			const rejectBtn = container.querySelector('.reject-btn');
			assert.ok(rejectBtn, 'Should render reject button');
			assert.strictEqual(rejectBtn.textContent, 'Reject', 'Button should say Reject');
		});

		it('should render swap button', async () => {
			const { AcceptanceControls } = await import('../../../src/webview/app/components/AcceptanceControls/AcceptanceControls.js');

			acceptanceControls = new AcceptanceControls(container);

			const swapBtn = container.querySelector('.swap-btn');
			assert.ok(swapBtn, 'Should render swap button');
			assert.ok(swapBtn.textContent.includes('\u21C5'), 'Button should have swap icon');
		});

		it('should start with controls hidden', async () => {
			const { AcceptanceControls } = await import('../../../src/webview/app/components/AcceptanceControls/AcceptanceControls.js');

			acceptanceControls = new AcceptanceControls(container);

			const controls = container.querySelector('.acceptance-controls');
			assert.ok(controls.classList.contains('hidden') || controls.style.display === 'none',
				'Controls should be hidden initially');
		});
	});

	describe('Show/Hide Controls', () => {
		it('should show controls with show() method', async () => {
			const { AcceptanceControls } = await import('../../../src/webview/app/components/AcceptanceControls/AcceptanceControls.js');

			acceptanceControls = new AcceptanceControls(container);
			acceptanceControls.show();

			const controls = container.querySelector('.acceptance-controls');
			assert.ok(!controls.classList.contains('hidden'), 'Controls should be visible');
		});

		it('should hide controls with hide() method', async () => {
			const { AcceptanceControls } = await import('../../../src/webview/app/components/AcceptanceControls/AcceptanceControls.js');

			acceptanceControls = new AcceptanceControls(container);
			acceptanceControls.show();
			acceptanceControls.hide();

			const controls = container.querySelector('.acceptance-controls');
			assert.ok(controls.classList.contains('hidden'), 'Controls should be hidden');
		});
	});

	describe('Input Management', () => {
		it('should get input value with getValue()', async () => {
			const { AcceptanceControls } = await import('../../../src/webview/app/components/AcceptanceControls/AcceptanceControls.js');

			acceptanceControls = new AcceptanceControls(container);
			const input = container.querySelector('.acceptance-input');
			input.value = 'Test acceptance input';

			assert.strictEqual(acceptanceControls.getValue(), 'Test acceptance input');
		});

		it('should set input value with setValue()', async () => {
			const { AcceptanceControls } = await import('../../../src/webview/app/components/AcceptanceControls/AcceptanceControls.js');

			acceptanceControls = new AcceptanceControls(container);
			acceptanceControls.setValue('New value');

			const input = container.querySelector('.acceptance-input');
			assert.strictEqual(input.value, 'New value');
		});

		it('should clear input with clear()', async () => {
			const { AcceptanceControls } = await import('../../../src/webview/app/components/AcceptanceControls/AcceptanceControls.js');

			acceptanceControls = new AcceptanceControls(container);
			acceptanceControls.setValue('Some text');
			acceptanceControls.clear();

			const input = container.querySelector('.acceptance-input');
			assert.strictEqual(input.value, '');
		});

		it('should focus input with focus()', async () => {
			const { AcceptanceControls } = await import('../../../src/webview/app/components/AcceptanceControls/AcceptanceControls.js');

			acceptanceControls = new AcceptanceControls(container);
			acceptanceControls.focus();

			const input = container.querySelector('.acceptance-input');
			assert.strictEqual(document.activeElement, input, 'Input should be focused');
		});
	});

	describe('Button Events', () => {
		it('should emit accept event when accept button clicked', async () => {
			const { AcceptanceControls } = await import('../../../src/webview/app/components/AcceptanceControls/AcceptanceControls.js');

			let emittedValue = null;
			acceptanceControls = new AcceptanceControls(container);
			acceptanceControls.on('accept', (value) => {
				emittedValue = value;
			});

			acceptanceControls.setValue('Accept this');
			const acceptBtn = container.querySelector('.accept-btn');
			acceptBtn.click();

			assert.strictEqual(emittedValue, 'Accept this', 'Should emit input value on accept');
		});

		it('should emit reject event when reject button clicked', async () => {
			const { AcceptanceControls } = await import('../../../src/webview/app/components/AcceptanceControls/AcceptanceControls.js');

			let emittedValue = null;
			acceptanceControls = new AcceptanceControls(container);
			acceptanceControls.on('reject', (value) => {
				emittedValue = value;
			});

			acceptanceControls.setValue('Reject this');
			const rejectBtn = container.querySelector('.reject-btn');
			rejectBtn.click();

			assert.strictEqual(emittedValue, 'Reject this', 'Should emit input value on reject');
		});

		it('should emit swap event when swap button clicked', async () => {
			const { AcceptanceControls } = await import('../../../src/webview/app/components/AcceptanceControls/AcceptanceControls.js');

			let swapEmitted = false;
			acceptanceControls = new AcceptanceControls(container);
			acceptanceControls.on('swap', () => {
				swapEmitted = true;
			});

			const swapBtn = container.querySelector('.swap-btn');
			swapBtn.click();

			assert.ok(swapEmitted, 'Should emit swap event');
		});
	});

	describe('Button State Management', () => {
		it('should disable buttons with setButtonsDisabled(true)', async () => {
			const { AcceptanceControls } = await import('../../../src/webview/app/components/AcceptanceControls/AcceptanceControls.js');

			acceptanceControls = new AcceptanceControls(container);
			acceptanceControls.setButtonsDisabled(true);

			const acceptBtn = container.querySelector('.accept-btn');
			const rejectBtn = container.querySelector('.reject-btn');
			const swapBtn = container.querySelector('.swap-btn');

			assert.ok(acceptBtn.disabled, 'Accept button should be disabled');
			assert.ok(rejectBtn.disabled, 'Reject button should be disabled');
			assert.ok(swapBtn.disabled, 'Swap button should be disabled');
		});

		it('should enable buttons with setButtonsDisabled(false)', async () => {
			const { AcceptanceControls } = await import('../../../src/webview/app/components/AcceptanceControls/AcceptanceControls.js');

			acceptanceControls = new AcceptanceControls(container);
			acceptanceControls.setButtonsDisabled(true);
			acceptanceControls.setButtonsDisabled(false);

			const acceptBtn = container.querySelector('.accept-btn');
			const rejectBtn = container.querySelector('.reject-btn');
			const swapBtn = container.querySelector('.swap-btn');

			assert.ok(!acceptBtn.disabled, 'Accept button should be enabled');
			assert.ok(!rejectBtn.disabled, 'Reject button should be enabled');
			assert.ok(!swapBtn.disabled, 'Swap button should be enabled');
		});
	});

	describe('Event Emitter', () => {
		it('should support on() to add event listeners', async () => {
			const { AcceptanceControls } = await import('../../../src/webview/app/components/AcceptanceControls/AcceptanceControls.js');

			let called = false;
			acceptanceControls = new AcceptanceControls(container);
			acceptanceControls.on('test', () => {
				called = true;
			});
			acceptanceControls.emit('test');

			assert.ok(called, 'Should call event listener');
		});

		it('should support off() to remove event listeners', async () => {
			const { AcceptanceControls } = await import('../../../src/webview/app/components/AcceptanceControls/AcceptanceControls.js');

			let callCount = 0;
			const handler = () => { callCount++; };

			acceptanceControls = new AcceptanceControls(container);
			acceptanceControls.on('test', handler);
			acceptanceControls.emit('test');
			acceptanceControls.off('test', handler);
			acceptanceControls.emit('test');

			assert.strictEqual(callCount, 1, 'Should only call once before removal');
		});
	});

	describe('Cleanup', () => {
		it('should clean up with destroy()', async () => {
			const { AcceptanceControls } = await import('../../../src/webview/app/components/AcceptanceControls/AcceptanceControls.js');

			acceptanceControls = new AcceptanceControls(container);
			acceptanceControls.destroy();

			assert.strictEqual(container.innerHTML, '', 'Should remove all content');
		});
	});
});
