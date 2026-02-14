import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { CommandParser } from '../../../src/webview/app/services/CommandParser.js';
import { EventBus } from '../../../src/webview/app/state/EventBus.js';

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
      ['enterPlanMode', 'exitPlanMode', 'acceptPlan', 'rejectPlan', 'openInCLI', 'showNotSupported'].forEach(eventName => {
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

    // Passthrough command routing
    it('should emit openInCLI for passthrough /delegate command', () => {
      const cmd = { command: 'delegate', args: [] };

      parser.execute(cmd, eventBus);

      expect(emittedEvents).to.have.length(1);
      expect(emittedEvents[0].event).to.equal('openInCLI');
      expect(emittedEvents[0].args).to.deep.equal([['delegate']]);
    });

    it('should emit openInCLI with command name and args for passthrough command', () => {
      const cmd = { command: 'agent', args: ['refactoring'] };

      parser.execute(cmd, eventBus);

      expect(emittedEvents).to.have.length(1);
      expect(emittedEvents[0].event).to.equal('openInCLI');
      expect(emittedEvents[0].args).to.deep.equal([['agent', 'refactoring']]);
    });

    // Not-supported command routing
    it('should emit showNotSupported for not-supported /clear command', () => {
      const cmd = { command: 'clear', args: [] };

      parser.execute(cmd, eventBus);

      expect(emittedEvents).to.have.length(1);
      expect(emittedEvents[0].event).to.equal('showNotSupported');
      expect(emittedEvents[0].args).to.deep.equal([['clear']]);
    });

    it('should emit showNotSupported for not-supported /compact command', () => {
      const cmd = { command: 'compact', args: [] };

      parser.execute(cmd, eventBus);

      expect(emittedEvents).to.have.length(1);
      expect(emittedEvents[0].event).to.equal('showNotSupported');
      expect(emittedEvents[0].args).to.deep.equal([['compact']]);
    });

    it('should not emit undefined event for passthrough commands', () => {
      let undefinedEmitted = false;
      const originalEmit = eventBus.emit.bind(eventBus);
      eventBus.emit = (event, data) => {
        if (event === undefined) undefinedEmitted = true;
        return originalEmit(event, data);
      };

      const cmd = { command: 'delegate', args: [] };
      parser.execute(cmd, eventBus);

      expect(undefinedEmitted).to.be.false;
    });

    it('should not emit undefined event for not-supported commands', () => {
      let undefinedEmitted = false;
      const originalEmit = eventBus.emit.bind(eventBus);
      eventBus.emit = (event, data) => {
        if (event === undefined) undefinedEmitted = true;
        return originalEmit(event, data);
      };

      const cmd = { command: 'clear', args: [] };
      parser.execute(cmd, eventBus);

      expect(undefinedEmitted).to.be.false;
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

  describe('getVisibleCommands()', () => {
    it('should return only extension and passthrough commands', () => {
      const commands = parser.getVisibleCommands();

      // 10 extension + 6 passthrough = 16
      expect(commands).to.have.length(16);
    });

    it('should not include not-supported commands', () => {
      const commands = parser.getVisibleCommands();
      const names = commands.map(c => c.name);

      // These are not-supported and should be excluded
      expect(names).to.not.include('clear');
      expect(names).to.not.include('compact');
      expect(names).to.not.include('quit');
    });

    it('should include all extension commands', () => {
      const commands = parser.getVisibleCommands();
      const names = commands.map(c => c.name);

      expect(names).to.include('plan');
      expect(names).to.include('exit');
      expect(names).to.include('accept');
      expect(names).to.include('reject');
      expect(names).to.include('review');
      expect(names).to.include('diff');
      expect(names).to.include('mcp');
      expect(names).to.include('usage');
      expect(names).to.include('help');
      expect(names).to.include('model');
    });

    it('should include all passthrough commands', () => {
      const commands = parser.getVisibleCommands();
      const names = commands.map(c => c.name);

      expect(names).to.include('delegate');
      expect(names).to.include('agent');
      expect(names).to.include('skills');
      expect(names).to.include('plugin');
      expect(names).to.include('login');
      expect(names).to.include('logout');
    });

    it('should have name, description, and category on each command', () => {
      const commands = parser.getVisibleCommands();

      commands.forEach(cmd => {
        expect(cmd).to.have.property('name').that.is.a('string');
        expect(cmd).to.have.property('description').that.is.a('string').and.not.empty;
        expect(cmd).to.have.property('category').that.is.a('string');
      });
    });

    it('should use correct categories', () => {
      const commands = parser.getVisibleCommands();
      const categories = [...new Set(commands.map(c => c.category))];

      expect(categories).to.include('plan');
      expect(categories).to.include('code');
      expect(categories).to.include('config');
      expect(categories).to.include('cli');
    });

    it('should assign plan mode commands to plan category', () => {
      const commands = parser.getVisibleCommands();
      const planCommands = commands.filter(c => c.category === 'plan');
      const planNames = planCommands.map(c => c.name);

      expect(planNames).to.deep.equal(['plan', 'exit', 'accept', 'reject']);
    });
  });
});
