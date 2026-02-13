import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { InputArea } from '../../../src/webview/app/components/InputArea/InputArea.js';
import { EventBus } from '../../../src/webview/app/state/EventBus.js';

describe('InputArea - Slash Command Detection - TDD RED Phase', () => {
  let dom, container, eventBus;

  beforeEach(() => {
    dom = new JSDOM(`<!DOCTYPE html><div id="container"></div>`);
    global.document = dom.window.document;
    global.window = dom.window;
    container = document.getElementById('container');
    eventBus = new EventBus();
  });

  describe('parseCommand()', () => {
    it('should detect /plan command', () => {
      const inputArea = new InputArea(container, eventBus);
      const result = inputArea.parseCommand('/plan');
      
      expect(result).to.deep.equal({ command: 'plan', args: [] });
    });

    it('should detect /exit command', () => {
      const inputArea = new InputArea(container, eventBus);
      const result = inputArea.parseCommand('/exit');
      
      expect(result).to.deep.equal({ command: 'exit', args: [] });
    });

    it('should detect /accept command', () => {
      const inputArea = new InputArea(container, eventBus);
      const result = inputArea.parseCommand('/accept');
      
      expect(result).to.deep.equal({ command: 'accept', args: [] });
    });

    it('should detect /reject command', () => {
      const inputArea = new InputArea(container, eventBus);
      const result = inputArea.parseCommand('/reject');
      
      expect(result).to.deep.equal({ command: 'reject', args: [] });
    });

    it('should return null for non-command text', () => {
      const inputArea = new InputArea(container, eventBus);
      const result = inputArea.parseCommand('hello world');
      
      expect(result).to.be.null;
    });

    it('should return null for slash in middle of text', () => {
      const inputArea = new InputArea(container, eventBus);
      const result = inputArea.parseCommand('hello /plan world');
      
      expect(result).to.be.null;
    });
  });

  describe('Slash Command Execution', () => {
    it('should emit enterPlanMode event for /plan command', (done) => {
      const inputArea = new InputArea(container, eventBus);
      
      eventBus.on('enterPlanMode', () => {
        done();
      });
      
      const messageInput = container.querySelector('#messageInput');
      messageInput.value = '/plan';
      
      const sendButton = container.querySelector('#sendButton');
      sendButton.click();
    });

    it('should emit exitPlanMode event for /exit command', (done) => {
      const inputArea = new InputArea(container, eventBus);
      
      // Set plan mode state for /exit to be valid
      inputArea.setPlanMode(true, false);
      
      eventBus.on('exitPlanMode', () => {
        done();
      });
      
      const messageInput = container.querySelector('#messageInput');
      messageInput.value = '/exit';
      
      const sendButton = container.querySelector('#sendButton');
      sendButton.click();
    });

    it('should emit acceptPlan event for /accept command', (done) => {
      const inputArea = new InputArea(container, eventBus);
      
      // Set plan mode state for /accept to be valid
      inputArea.setPlanMode(true, true);
      
      eventBus.on('acceptPlan', () => {
        done();
      });
      
      const messageInput = container.querySelector('#messageInput');
      messageInput.value = '/accept';
      
      const sendButton = container.querySelector('#sendButton');
      sendButton.click();
    });

    it('should emit rejectPlan event for /reject command', (done) => {
      const inputArea = new InputArea(container, eventBus);
      
      // Set plan mode state for /reject to be valid
      inputArea.setPlanMode(true, true);
      
      eventBus.on('rejectPlan', () => {
        done();
      });
      
      const messageInput = container.querySelector('#messageInput');
      messageInput.value = '/reject';
      
      const sendButton = container.querySelector('#sendButton');
      sendButton.click();
    });

    it('should NOT send slash command as chat message', (done) => {
      const inputArea = new InputArea(container, eventBus);
      let messageSent = false;
      
      eventBus.on('input:sendMessage', () => {
        messageSent = true;
      });
      
      eventBus.on('enterPlanMode', () => {
        // Verify message was not sent
        expect(messageSent).to.be.false;
        done();
      });
      
      const messageInput = container.querySelector('#messageInput');
      messageInput.value = '/plan';
      
      const sendButton = container.querySelector('#sendButton');
      sendButton.click();
    });

    it('should clear input after processing slash command', () => {
      const inputArea = new InputArea(container, eventBus);
      
      const messageInput = container.querySelector('#messageInput');
      messageInput.value = '/plan';
      
      const sendButton = container.querySelector('#sendButton');
      sendButton.click();
      
      // Input should be cleared immediately (synchronous)
      expect(messageInput.value).to.equal('');
    });
  });
});
