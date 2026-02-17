const assert = require('assert');
const { createComponentDOM, cleanupComponentDOM } = require('../../helpers/jsdom-component-setup');

/**
 * Create a JSDOM-compatible paste event with mock clipboard data
 * JSDOM requires events created from its own document context
 */
function createPasteEvent(items) {
	const event = document.createEvent('Event');
	event.initEvent('paste', true, true);
	Object.defineProperty(event, 'clipboardData', {
		value: {
			items: items,
			types: items.length > 0 ? ['Files'] : []
		}
	});
	return event;
}

function createImageItem(mimeType, content = 'fake-image-data') {
	// Use JSDOM's Blob/File constructors — Node's built-in Blob is incompatible
	// with JSDOM's FileReader
	const JBlob = global.window.Blob;
	const JFile = global.window.File;
	const blob = new JBlob([content], { type: mimeType });
	const ext = mimeType.split('/')[1];
	const file = new JFile([blob], `test.${ext}`, { type: mimeType });
	return {
		kind: 'file',
		type: mimeType,
		getAsFile: () => file
	};
}

describe('InputArea Paste Image', function () {
	let dom;
	let eventBus;
	let inputArea;
	let InputArea;

	before(function () {
		try {
			({ InputArea } = require('../../../src/webview/app/components/InputArea/InputArea.js'));
		} catch (err) {
			console.log('[TDD RED] InputArea not yet updated for paste:', err.message);
			this.skip();
		}
	});

	beforeEach(function () {
		dom = createComponentDOM();

		// JSDOM has FileReader on dom.window but createComponentDOM only promotes
		// window and document to global. Promote FileReader for paste handling.
		if (!global.FileReader && dom.window.FileReader) {
			global.FileReader = dom.window.FileReader;
		}

		const { EventBus } = require('../../../src/webview/app/state/EventBus.js');
		eventBus = new EventBus();

		const container = document.getElementById('input-mount');
		inputArea = new InputArea(container, eventBus);
	});

	afterEach(function () {
		delete global.FileReader;
		cleanupComponentDOM(dom);
	});

	describe('paste event listener', function () {
		it('should emit input:pasteImage when pasting an image', function (done) {
			this.timeout(5000);

			eventBus.on('input:pasteImage', (data) => {
				assert.ok(data.dataUri, 'should have dataUri');
				assert.strictEqual(data.mimeType, 'image/png');
				assert.ok(data.fileName, 'should have fileName');
				assert.ok(data.fileName.startsWith('pasted-image-'), `expected "pasted-image-" prefix, got "${data.fileName}"`);
				assert.ok(data.fileName.endsWith('.png'), `expected .png suffix, got "${data.fileName}"`);
				done();
			});

			const event = createPasteEvent([createImageItem('image/png')]);
			inputArea.messageInput.dispatchEvent(event);
		});

		it('should not emit input:pasteImage for text-only paste', function () {
			let emitted = false;
			eventBus.on('input:pasteImage', () => { emitted = true; });

			const event = document.createEvent('Event');
			event.initEvent('paste', true, true);
			Object.defineProperty(event, 'clipboardData', {
				value: {
					items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }],
					types: ['text/plain']
				}
			});

			inputArea.messageInput.dispatchEvent(event);
			assert.strictEqual(emitted, false, 'should not emit for text paste');
		});

		it('should not emit input:pasteImage when clipboardData has no items', function () {
			let emitted = false;
			eventBus.on('input:pasteImage', () => { emitted = true; });

			const event = createPasteEvent([]);
			inputArea.messageInput.dispatchEvent(event);
			assert.strictEqual(emitted, false, 'should not emit for empty paste');
		});

		it('should handle multiple image items in one paste', function (done) {
			this.timeout(5000);
			const emitted = [];

			eventBus.on('input:pasteImage', (data) => {
				emitted.push(data);
				if (emitted.length === 2) {
					assert.strictEqual(emitted[0].mimeType, 'image/png');
					assert.strictEqual(emitted[1].mimeType, 'image/jpeg');
					done();
				}
			});

			const event = createPasteEvent([
				createImageItem('image/png'),
				createImageItem('image/jpeg')
			]);
			inputArea.messageInput.dispatchEvent(event);
		});

		it('should generate unique filenames for each pasted image', function (done) {
			this.timeout(5000);
			const fileNames = [];

			eventBus.on('input:pasteImage', (data) => {
				fileNames.push(data.fileName);
				if (fileNames.length === 2) {
					assert.notStrictEqual(fileNames[0], fileNames[1], 'filenames should be unique');
					done();
				}
			});

			// Paste two separate events
			const event1 = createPasteEvent([createImageItem('image/png')]);
			inputArea.messageInput.dispatchEvent(event1);

			const event2 = createPasteEvent([createImageItem('image/png')]);
			inputArea.messageInput.dispatchEvent(event2);
		});

		it('should support common image MIME types', function (done) {
			this.timeout(5000);
			const types = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
			let received = 0;

			eventBus.on('input:pasteImage', (data) => {
				assert.ok(types.includes(data.mimeType), `should handle ${data.mimeType}`);
				received++;
				if (received === types.length) {
					done();
				}
			});

			for (const mimeType of types) {
				const event = createPasteEvent([createImageItem(mimeType)]);
				inputArea.messageInput.dispatchEvent(event);
			}
		});

		it('should prevent default when pasting images', function () {
			const event = createPasteEvent([createImageItem('image/png')]);

			let defaultPrevented = false;
			const origPreventDefault = event.preventDefault.bind(event);
			event.preventDefault = function () {
				defaultPrevented = true;
				origPreventDefault();
			};

			inputArea.messageInput.dispatchEvent(event);
			assert.strictEqual(defaultPrevented, true, 'should preventDefault for image paste');
		});
	});
});
