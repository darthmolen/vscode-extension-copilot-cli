import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { PlanModeControls } from '../src/webview/app/components/PlanModeControls/PlanModeControls.js';
import { EventBus } from '../src/webview/app/state/EventBus.js';

describe('PlanModeControls Component - TDD RED Phase', () => {
  let dom, container, eventBus;

  beforeEach(() => {
    dom = new JSDOM(`<!DOCTYPE html><div id="container"></div>`);
    global.document = dom.window.document;
    global.window = dom.window;
    container = document.getElementById('container');
    eventBus = new EventBus();
  });

  describe('Button Visibility States', () => {
    it('should show Enter Plan Mode button in work mode', () => {
      const controls = new PlanModeControls(container, eventBus);
      controls.setPlanMode(false, false);
      
      const enterBtn = container.querySelector('#enterPlanModeBtn');
      const exitBtn = container.querySelector('#exitPlanModeBtn');
      const acceptBtn = container.querySelector('#acceptPlanBtn');
      const rejectBtn = container.querySelector('#rejectPlanBtn');
      
      expect(enterBtn.style.display).to.not.equal('none');
      expect(exitBtn.style.display).to.equal('none');
      expect(acceptBtn.style.display).to.equal('none');
      expect(rejectBtn.style.display).to.equal('none');
    });

    it('should show Exit Plan Mode button when plan active but not ready', () => {
      const controls = new PlanModeControls(container, eventBus);
      controls.setPlanMode(true, false);
      
      const enterBtn = container.querySelector('#enterPlanModeBtn');
      const exitBtn = container.querySelector('#exitPlanModeBtn');
      const acceptBtn = container.querySelector('#acceptPlanBtn');
      const rejectBtn = container.querySelector('#rejectPlanBtn');
      
      expect(enterBtn.style.display).to.equal('none');
      expect(exitBtn.style.display).to.not.equal('none');
      expect(acceptBtn.style.display).to.equal('none');
      expect(rejectBtn.style.display).to.equal('none');
    });

    it('should show Accept/Reject buttons when plan ready', () => {
      const controls = new PlanModeControls(container, eventBus);
      controls.setPlanMode(true, true);
      
      const enterBtn = container.querySelector('#enterPlanModeBtn');
      const exitBtn = container.querySelector('#exitPlanModeBtn');
      const acceptBtn = container.querySelector('#acceptPlanBtn');
      const rejectBtn = container.querySelector('#rejectPlanBtn');
      
      expect(enterBtn.style.display).to.equal('none');
      expect(exitBtn.style.display).to.equal('none');
      expect(acceptBtn.style.display).to.not.equal('none');
      expect(rejectBtn.style.display).to.not.equal('none');
    });
  });

  describe('Event Emission', () => {
    it('should emit enterPlanMode when Enter button clicked', (done) => {
      const controls = new PlanModeControls(container, eventBus);
      controls.setPlanMode(false, false);
      
      eventBus.on('enterPlanMode', () => {
        done();
      });
      
      const enterBtn = container.querySelector('#enterPlanModeBtn');
      enterBtn.click();
    });

    it('should emit exitPlanMode when Exit button clicked', (done) => {
      const controls = new PlanModeControls(container, eventBus);
      controls.setPlanMode(true, false);
      
      eventBus.on('exitPlanMode', () => {
        done();
      });
      
      const exitBtn = container.querySelector('#exitPlanModeBtn');
      exitBtn.click();
    });

    it('should emit acceptPlan when Accept button clicked', (done) => {
      const controls = new PlanModeControls(container, eventBus);
      controls.setPlanMode(true, true);
      
      eventBus.on('acceptPlan', () => {
        done();
      });
      
      const acceptBtn = container.querySelector('#acceptPlanBtn');
      acceptBtn.click();
    });

    it('should emit rejectPlan when Reject button clicked', (done) => {
      const controls = new PlanModeControls(container, eventBus);
      controls.setPlanMode(true, true);
      
      eventBus.on('rejectPlan', () => {
        done();
      });
      
      const rejectBtn = container.querySelector('#rejectPlanBtn');
      rejectBtn.click();
    });
  });
});
