import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { CommandParser } from '../src/webview/app/services/CommandParser.js';
import { EventBus } from '../src/webview/app/state/EventBus.js';

describe('CommandParser Service - TDD RED Phase', () => {
  let parser;

  beforeEach(() => {
    parser = new CommandParser();
  });

  describe('parse()', () => {
    it('should parse /plan command', () => {
      const result = parser.parse('/plan');
      
      expect(result).to.deep.equal({
        command: 'plan',
        args: []
      });
    });

    it('should parse /exit command', () => {
      const result = parser.parse('/exit');
      
      expect(result).to.deep.equal({
        command: 'exit',
        args: []
      });
    });

    it('should parse /accept command', () => {
      const result = parser.parse('/accept');
      
      expect(result).to.deep.equal({
        command: 'accept',
        args: []
      });
    });

    it('should parse /reject command', () => {
      const result = parser.parse('/reject');
      
      expect(result).to.deep.equal({
        command: 'reject',
        args: []
      });
    });

    it('should parse command with arguments', () => {
      const result = parser.parse('/login username password');
      
      expect(result).to.deep.equal({
        command: 'login',
        args: ['username', 'password']
      });
    });

    it('should return null for non-command text', () => {
      const result = parser.parse('hello world');
      
      expect(result).to.be.null;
    });

    it('should return null for empty string', () => {
      const result = parser.parse('');
      
      expect(result).to.be.null;
    });

    it('should return null for null input', () => {
      const result = parser.parse(null);
      
      expect(result).to.be.null;
    });

    it('should return null for slash in middle of text', () => {
      const result = parser.parse('hello /plan world');
      
      expect(result).to.be.null;
    });

    it('should handle unknown command as valid parse', () => {
      const result = parser.parse('/unknown');
      
      // Parse succeeds but isValid() would return false
      expect(result).to.deep.equal({
        command: 'unknown',
        args: []
      });
    });
  });

  describe('isRegistered()', () => {
    it('should return true for registered /plan command', () => {
      expect(parser.isRegistered('plan')).to.be.true;
    });

    it('should return true for registered /exit command', () => {
      expect(parser.isRegistered('exit')).to.be.true;
    });

    it('should return true for registered /accept command', () => {
      expect(parser.isRegistered('accept')).to.be.true;
    });

    it('should return true for registered /reject command', () => {
      expect(parser.isRegistered('reject')).to.be.true;
    });

    it('should return false for unregistered command', () => {
      expect(parser.isRegistered('unknown')).to.be.false;
    });
  });

  describe('isValid() - Context Validation', () => {
    it('should allow /plan only when NOT in plan mode', () => {
      const cmd = { command: 'plan', args: [] };
      
      expect(parser.isValid(cmd, { planMode: false })).to.be.true;
      expect(parser.isValid(cmd, { planMode: true })).to.be.false;
    });

    it('should allow /exit only when IN plan mode', () => {
      const cmd = { command: 'exit', args: [] };
      
      expect(parser.isValid(cmd, { planMode: true })).to.be.true;
      expect(parser.isValid(cmd, { planMode: false })).to.be.false;
    });

    it('should allow /accept only when plan is ready', () => {
      const cmd = { command: 'accept', args: [] };
      
      expect(parser.isValid(cmd, { planMode: true, planReady: true })).to.be.true;
      expect(parser.isValid(cmd, { planMode: true, planReady: false })).to.be.false;
      expect(parser.isValid(cmd, { planMode: false, planReady: true })).to.be.false;
    });

    it('should allow /reject only when plan is ready', () => {
      const cmd = { command: 'reject', args: [] };
      
      expect(parser.isValid(cmd, { planMode: true, planReady: true })).to.be.true;
      expect(parser.isValid(cmd, { planMode: true, planReady: false })).to.be.false;
      expect(parser.isValid(cmd, { planMode: false, planReady: true })).to.be.false;
    });

    it('should return false for unknown/unregistered command', () => {
      // Unknown commands are not valid - must be registered first
      const cmd = { command: 'unknown', args: [] };
      
      expect(parser.isValid(cmd, {})).to.be.false;
    });

    it('should return true for command with no context requirements', () => {
      // Register a command with no context requirements
      parser.register('help', 'showHelp', null);
      
      const cmd = { command: 'help', args: [] };
      
      expect(parser.isValid(cmd, {})).to.be.true;
    });
  });

  describe('execute()', () => {
    let eventBus, emittedEvents;

    beforeEach(() => {
      eventBus = new EventBus();
      emittedEvents = [];
      
      // Track all events
      ['enterPlanMode', 'exitPlanMode', 'acceptPlan', 'rejectPlan'].forEach(eventName => {
        eventBus.on(eventName, (...args) => {
          emittedEvents.push({ event: eventName, args });
        });
      });
    });

    it('should emit enterPlanMode for /plan command', () => {
      const cmd = { command: 'plan', args: [] };
      
      parser.execute(cmd, eventBus);
      
      expect(emittedEvents).to.have.length(1);
      expect(emittedEvents[0].event).to.equal('enterPlanMode');
    });

    it('should emit exitPlanMode for /exit command', () => {
      const cmd = { command: 'exit', args: [] };
      
      parser.execute(cmd, eventBus);
      
      expect(emittedEvents).to.have.length(1);
      expect(emittedEvents[0].event).to.equal('exitPlanMode');
    });

    it('should emit acceptPlan for /accept command', () => {
      const cmd = { command: 'accept', args: [] };
      
      parser.execute(cmd, eventBus);
      
      expect(emittedEvents).to.have.length(1);
      expect(emittedEvents[0].event).to.equal('acceptPlan');
    });

    it('should emit rejectPlan for /reject command', () => {
      const cmd = { command: 'reject', args: [] };
      
      parser.execute(cmd, eventBus);
      
      expect(emittedEvents).to.have.length(1);
      expect(emittedEvents[0].event).to.equal('rejectPlan');
    });

    it('should pass arguments to event handlers', () => {
      const cmd = { command: 'plan', args: ['arg1', 'arg2'] };
      
      parser.execute(cmd, eventBus);
      
      expect(emittedEvents[0].args).to.deep.equal([['arg1', 'arg2']]);
    });

    it('should do nothing for unknown command', () => {
      const cmd = { command: 'unknown', args: [] };
      
      parser.execute(cmd, eventBus);
      
      expect(emittedEvents).to.have.length(0);
    });
  });

  describe('getEvent()', () => {
    it('should return event name for registered command', () => {
      expect(parser.getEvent('plan')).to.equal('enterPlanMode');
      expect(parser.getEvent('exit')).to.equal('exitPlanMode');
      expect(parser.getEvent('accept')).to.equal('acceptPlan');
      expect(parser.getEvent('reject')).to.equal('rejectPlan');
    });

    it('should return null for unregistered command', () => {
      expect(parser.getEvent('unknown')).to.be.null;
    });
  });

  describe('Integration: parse → validate → execute', () => {
    it('should handle full workflow for valid command', () => {
      const eventBus = new EventBus();
      let eventFired = false;
      
      eventBus.on('enterPlanMode', () => {
        eventFired = true;
      });
      
      const parsed = parser.parse('/plan');
      const isValid = parser.isValid(parsed, { planMode: false });
      
      expect(isValid).to.be.true;
      
      parser.execute(parsed, eventBus);
      
      expect(eventFired).to.be.true;
    });

    it('should reject invalid command in context', () => {
      const eventBus = new EventBus();
      let eventFired = false;
      
      eventBus.on('enterPlanMode', () => {
        eventFired = true;
      });
      
      const parsed = parser.parse('/plan');
      const isValid = parser.isValid(parsed, { planMode: true }); // Already in plan mode!
      
      expect(isValid).to.be.false;
      
      // Caller should not execute if invalid
      if (!isValid) {
        expect(eventFired).to.be.false;
      }
    });
  });
});
