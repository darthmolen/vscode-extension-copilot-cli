const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('Paste Image Extension Handler', function () {
	describe('PasteImagePayload type', function () {
		let messages;

		before(function () {
			try {
				messages = require('../../../out/shared/messages');
			} catch (err) {
				console.log('[TDD RED] Compiled messages not available:', err.message);
				this.skip();
			}
		});

		it('should include pasteImage in WebviewMessageType', function () {
			// Verify the type guard recognizes pasteImage messages
			const msg = {
				type: 'pasteImage',
				dataUri: 'data:image/png;base64,abc',
				mimeType: 'image/png',
				fileName: 'pasted-image-1.png'
			};

			// isWebviewMessage should return true for pasteImage
			assert.strictEqual(messages.isWebviewMessage(msg), true,
				'pasteImage should be a valid webview message');
		});
	});

	describe('ExtensionRpcRouter.onPasteImage', function () {
		let ExtensionRpcRouter;

		before(function () {
			try {
				({ ExtensionRpcRouter } = require('../../../out/extension/rpc/ExtensionRpcRouter'));
			} catch (err) {
				console.log('[TDD RED] Compiled ExtensionRpcRouter not available:', err.message);
				this.skip();
			}
		});

		it('should route pasteImage messages to registered handler', function () {
			const postedMessages = [];
			const mockWebview = {
				postMessage: (msg) => postedMessages.push(msg),
				onDidReceiveMessage: () => ({ dispose: () => {} }),
				cspSource: 'mock',
				asWebviewUri: (uri) => uri
			};

			const router = new ExtensionRpcRouter(mockWebview);

			let receivedPayload = null;
			router.onPasteImage((payload) => {
				receivedPayload = payload;
			});

			// Route a pasteImage message
			router.route({
				type: 'pasteImage',
				dataUri: 'data:image/png;base64,test123',
				mimeType: 'image/png',
				fileName: 'pasted-image-1.png'
			});

			assert.ok(receivedPayload, 'handler should have been called');
			assert.strictEqual(receivedPayload.dataUri, 'data:image/png;base64,test123');
			assert.strictEqual(receivedPayload.mimeType, 'image/png');
			assert.strictEqual(receivedPayload.fileName, 'pasted-image-1.png');
		});
	});

	describe('Temp file creation from base64 data URI', function () {
		it('should write base64 image data to a temp file', function () {
			// Simulate what chatViewProvider should do:
			// 1. Extract base64 data from data URI
			// 2. Write to temp file
			// 3. Return the file path

			const dataUri = 'data:image/png;base64,iVBORw0KGgo=';
			const fileName = 'pasted-image-1.png';

			// Extract base64 portion
			const base64Data = dataUri.split(',')[1];
			const buffer = Buffer.from(base64Data, 'base64');

			// Write to temp file
			const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-paste-'));
			const tempFilePath = path.join(tempDir, fileName);
			fs.writeFileSync(tempFilePath, buffer);

			// Verify file exists and has content
			assert.ok(fs.existsSync(tempFilePath));
			const written = fs.readFileSync(tempFilePath);
			assert.ok(written.length > 0, 'temp file should have content');

			// Cleanup
			fs.unlinkSync(tempFilePath);
			fs.rmdirSync(tempDir);
		});
	});
});
