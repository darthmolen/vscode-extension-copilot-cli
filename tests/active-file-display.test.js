import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { ActiveFileDisplay } from '../src/webview/app/components/ActiveFileDisplay/ActiveFileDisplay.js';
import { EventBus } from '../src/webview/app/state/EventBus.js';

describe('ActiveFileDisplay Component - TDD RED Phase', () => {
  let dom, container, eventBus;

  beforeEach(() => {
    dom = new JSDOM(`<!DOCTYPE html><div id="container"></div>`);
    global.document = dom.window.document;
    global.window = dom.window;
    container = document.getElementById('container');
    eventBus = new EventBus();
  });

  describe('Initial State', () => {
    it('should hide when no file set', () => {
      const display = new ActiveFileDisplay(container, eventBus);
      const displayEl = container.querySelector('.active-file-display');
      
      expect(displayEl).to.exist;
      expect(displayEl.style.display).to.equal('none');
    });
  });

  describe('setFile()', () => {
    it('should show file path when set', () => {
      const display = new ActiveFileDisplay(container, eventBus);
      display.setFile('/workspace/src/app.ts');
      
      const displayEl = container.querySelector('.active-file-display');
      const pathEl = container.querySelector('.file-path');
      
      expect(pathEl.textContent).to.equal('/workspace/src/app.ts');
      expect(displayEl.style.display).to.not.equal('none');
    });

    it('should hide when set to null', () => {
      const display = new ActiveFileDisplay(container, eventBus);
      display.setFile('/workspace/src/app.ts');
      display.setFile(null);
      
      const displayEl = container.querySelector('.active-file-display');
      expect(displayEl.style.display).to.equal('none');
    });

    it('should hide when set to empty string', () => {
      const display = new ActiveFileDisplay(container, eventBus);
      display.setFile('/workspace/src/app.ts');
      display.setFile('');
      
      const displayEl = container.querySelector('.active-file-display');
      expect(displayEl.style.display).to.equal('none');
    });
  });

  describe('clear()', () => {
    it('should hide display when cleared', () => {
      const display = new ActiveFileDisplay(container, eventBus);
      display.setFile('/workspace/src/app.ts');
      display.clear();
      
      const displayEl = container.querySelector('.active-file-display');
      expect(displayEl.style.display).to.equal('none');
    });

    it('should clear path text when cleared', () => {
      const display = new ActiveFileDisplay(container, eventBus);
      display.setFile('/workspace/src/app.ts');
      display.clear();
      
      const pathEl = container.querySelector('.file-path');
      expect(pathEl.textContent).to.equal('');
    });
  });
});
