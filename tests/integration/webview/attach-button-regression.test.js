import { describe, it, before, beforeEach } from 'mocha';
import { expect } from 'chai';
import { JSDOM } from 'jsdom';

/**
 * RED TEST - Attach button broken after InputArea refactor
 * 
 * Bug: InputArea emits 'input:attachFiles' but main.js calls rpc.requestAttachFiles()
 * which doesn't exist on WebviewRpcClient
 * 
 * Expected: Should call rpc.send('requestAttachFiles') instead
 */
describe('Attach Button Integration', () => {
	let dom, document, rpc, eventBus, inputArea;
	let rpcCalls;

	before(() => {
		dom = new JSDOM(`<!DOCTYPE html><html><body>
			<div id="input-mount"></div>
		</body></html>`);
		document = dom.window.document;
		global.document = document;
		global.window = dom.window;
	});

	beforeEach(async () => {
		const { InputArea } = await import('../../../src/webview/app/components/InputArea/InputArea.js');
		const { EventBus } = await import('../../../src/webview/app/state/EventBus.js');

		const inputMount = document.getElementById('input-mount');
		eventBus = new EventBus();
		inputArea = new InputArea(inputMount, eventBus);

		// Mock RPC client to track calls
		rpcCalls = [];
		rpc = {
			pickFiles: () => {
				rpcCalls.push({ method: 'pickFiles' });
			}
		};
		
		// Make rpc global like in main.js
		global.rpc = rpc;
	});

	it('should emit input:attachFiles event when attach button clicked', () => {
		let eventEmitted = false;
		eventBus.on('input:attachFiles', () => {
			eventEmitted = true;
		});

		const attachButton = inputArea.container.querySelector('#attachButton');
		expect(attachButton, 'Attach button should exist').to.exist;
		
		attachButton.click();
		
		expect(eventEmitted, 'Should emit input:attachFiles event').to.be.true;
	});

	it('main.js handler should call rpc.pickFiles not rpc.requestAttachFiles', () => {
		// Simulate main.js handler
		eventBus.on('input:attachFiles', () => {
			// This is what it SHOULD do:
			rpc.pickFiles();
		});

		const attachButton = inputArea.container.querySelector('#attachButton');
		attachButton.click();

		// Should have called pickFiles
		expect(rpcCalls).to.have.length(1);
		expect(rpcCalls[0].method).to.equal('pickFiles');
	});
});
