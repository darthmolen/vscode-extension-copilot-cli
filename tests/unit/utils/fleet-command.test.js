import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { CommandParser } from '../../../src/webview/app/services/CommandParser.js';
import { EventBus } from '../../../src/webview/app/state/EventBus.js';

describe('CommandParser - /fleet command', () => {
    let parser;
    let eventBus;

    beforeEach(() => {
        parser = new CommandParser();
        eventBus = new EventBus();
    });

    describe('registration', () => {
        it('should have fleet registered as an extension command', () => {
            expect(parser.isRegistered('fleet')).to.be.true;
        });

        it('should have fleet as an extension type', () => {
            expect(parser.getCommandType('fleet')).to.equal('extension');
        });

        it('should emit enableFleetMode event for fleet command', () => {
            expect(parser.getEvent('fleet')).to.equal('enableFleetMode');
        });

        it('should have cli category', () => {
            const commandDef = parser.commands.get('fleet');
            expect(commandDef).to.exist;
            expect(commandDef.category).to.equal('cli');
        });

        it('should appear in visible commands', () => {
            const visible = parser.getVisibleCommands();
            const fleetCmd = visible.find(cmd => cmd.name === 'fleet');
            expect(fleetCmd).to.exist;
            expect(fleetCmd.category).to.equal('cli');
        });
    });

    describe('parsing', () => {
        it('should parse /fleet command', () => {
            const result = parser.parse('/fleet');
            expect(result).to.exist;
            expect(result.command).to.equal('fleet');
            expect(result.args).to.deep.equal([]);
        });

        it('should parse /fleet with arguments', () => {
            const result = parser.parse('/fleet some task');
            expect(result).to.exist;
            expect(result.command).to.equal('fleet');
            expect(result.args).to.deep.equal(['some', 'task']);
        });
    });

    describe('validation', () => {
        it('should be valid with no context requirements', () => {
            const cmd = parser.parse('/fleet');
            expect(parser.isValid(cmd, {})).to.be.true;
        });

        it('should be valid in plan mode', () => {
            const cmd = parser.parse('/fleet');
            expect(parser.isValid(cmd, { planMode: true, planReady: true })).to.be.true;
        });
    });

    describe('execution', () => {
        it('should emit enableFleetMode event when executed', () => {
            let emittedEvent = null;

            eventBus.on('enableFleetMode', () => {
                emittedEvent = 'enableFleetMode';
            });

            const cmd = parser.parse('/fleet');
            parser.execute(cmd, eventBus);

            expect(emittedEvent).to.equal('enableFleetMode');
        });

        it('should pass args to enableFleetMode event', () => {
            let receivedArgs = null;

            eventBus.on('enableFleetMode', (args) => {
                receivedArgs = args;
            });

            const cmd = parser.parse('/fleet task1 task2');
            parser.execute(cmd, eventBus);

            expect(receivedArgs).to.deep.equal(['task1', 'task2']);
        });
    });
});
