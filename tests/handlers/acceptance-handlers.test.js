/**
 * Tests for Acceptance Control Handlers
 * 
 * These handlers manage the acceptance control surface shown when AI presents a plan.
 */

import { expect } from 'chai';
import { createMockRpc } from '../helpers/jsdom-setup.js';
import {
	handleAcceptAndWork,
	handleKeepPlanning,
	handleAcceptanceKeydown
} from '../../src/webview/app/handlers/acceptance-handlers.js';

describe('Acceptance Control Handlers', () => {
	describe('handleAcceptAndWork', () => {
		it('should call acceptPlan and swap controls', () => {
			const rpc = createMockRpc();
			let controlsSwapped = false;
			const swapControls = () => { controlsSwapped = true; };
			
			handleAcceptAndWork(rpc, swapControls);
			
			// Verify RPC call
			const calls = rpc.getCalls();
			expect(calls).to.have.length(1);
			expect(calls[0].method).to.equal('acceptPlan');
			
			// Verify controls were swapped
			expect(controlsSwapped).to.equal(true);
		});
	});
	
	describe('handleKeepPlanning', () => {
		it('should swap controls without calling RPC', () => {
			const rpc = createMockRpc();
			let controlsSwapped = false;
			const swapControls = () => { controlsSwapped = true; };
			
			handleKeepPlanning(swapControls);
			
			// Verify NO RPC call
			expect(rpc.getCalls()).to.have.length(0);
			
			// Verify controls were swapped
			expect(controlsSwapped).to.equal(true);
		});
	});
	
	describe('handleAcceptanceKeydown', () => {
		it('should send message on Enter with non-empty input', () => {
			const rpc = createMockRpc();
			let inputCleared = false;
			let controlsSwapped = false;
			
			const event = {
				key: 'Enter',
				shiftKey: false,
				preventDefault: () => {}
			};
			
			const callbacks = {
				clearInput: () => { inputCleared = true; },
				swapControls: () => { controlsSwapped = true; }
			};
			
			handleAcceptanceKeydown(event, 'alternative instructions', rpc, callbacks);
			
			// Verify message sent
			const calls = rpc.getCalls();
			expect(calls).to.have.length(1);
			expect(calls[0].method).to.equal('sendMessage');
			expect(calls[0].msg).to.equal('alternative instructions');
			
			// Verify input cleared and controls swapped
			expect(inputCleared).to.equal(true);
			expect(controlsSwapped).to.equal(true);
		});
		
		it('should NOT send message on Enter with empty input', () => {
			const rpc = createMockRpc();
			let inputCleared = false;
			let controlsSwapped = false;
			
			const event = {
				key: 'Enter',
				shiftKey: false,
				preventDefault: () => {}
			};
			
			const callbacks = {
				clearInput: () => { inputCleared = true; },
				swapControls: () => { controlsSwapped = true; }
			};
			
			handleAcceptanceKeydown(event, '   ', rpc, callbacks);
			
			// Verify NO message sent
			expect(rpc.getCalls()).to.have.length(0);
			
			// Verify nothing happened
			expect(inputCleared).to.equal(false);
			expect(controlsSwapped).to.equal(false);
		});
		
		it('should NOT send message on Shift+Enter', () => {
			const rpc = createMockRpc();
			let inputCleared = false;
			let controlsSwapped = false;
			
			const event = {
				key: 'Enter',
				shiftKey: true,
				preventDefault: () => {}
			};
			
			const callbacks = {
				clearInput: () => { inputCleared = true; },
				swapControls: () => { controlsSwapped = true; }
			};
			
			handleAcceptanceKeydown(event, 'some text', rpc, callbacks);
			
			// Verify NO message sent (Shift+Enter is for newline)
			expect(rpc.getCalls()).to.have.length(0);
			expect(inputCleared).to.equal(false);
			expect(controlsSwapped).to.equal(false);
		});
		
		it('should swap controls on Escape without sending message', () => {
			const rpc = createMockRpc();
			let inputCleared = false;
			let controlsSwapped = false;
			
			const event = {
				key: 'Escape',
				shiftKey: false,
				preventDefault: () => {}
			};
			
			const callbacks = {
				clearInput: () => { inputCleared = true; },
				swapControls: () => { controlsSwapped = true; }
			};
			
			handleAcceptanceKeydown(event, 'some text', rpc, callbacks);
			
			// Verify NO message sent
			expect(rpc.getCalls()).to.have.length(0);
			
			// Verify controls swapped but input NOT cleared
			expect(inputCleared).to.equal(false);
			expect(controlsSwapped).to.equal(true);
		});
		
		it('should do nothing on other keys', () => {
			const rpc = createMockRpc();
			let inputCleared = false;
			let controlsSwapped = false;
			
			const event = {
				key: 'a',
				shiftKey: false,
				preventDefault: () => {}
			};
			
			const callbacks = {
				clearInput: () => { inputCleared = true; },
				swapControls: () => { controlsSwapped = true; }
			};
			
			handleAcceptanceKeydown(event, 'some text', rpc, callbacks);
			
			// Verify nothing happened
			expect(rpc.getCalls()).to.have.length(0);
			expect(inputCleared).to.equal(false);
			expect(controlsSwapped).to.equal(false);
		});
	});
});
