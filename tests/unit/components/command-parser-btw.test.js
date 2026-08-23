/**
 * `/btw <question>` — a side question in a new tab (v3.13.0 Task 8)
 *
 * Three entry points, one mechanism each, and keeping them distinct is what makes
 * them teachable:
 *
 *   New Tab   → an empty new session in a tab, seeded with the active file
 *   /btw      → New Tab **plus one send**
 *   Fork      → a *copy* of this session in a tab
 *
 * `/btw` deliberately does **not** inherit history. That is what fork is for. The
 * point of asking "by the way" is that it is *not* part of the conversation you
 * are in — carrying the transcript across would defeat the reason to open it
 * somewhere else, and would spend the context you were trying to protect.
 */

import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { CommandParser } from '../../../src/webview/app/services/CommandParser.js';

describe('CommandParser - /btw', () => {
    let parser;

    beforeEach(() => {
        parser = new CommandParser();
    });

    it('is a registered command, not an unknown one', () => {
        expect(parser.isRegistered('btw')).to.equal(true);
    });

    it('is an extension command — it opens a tab, it is not passed to the CLI', () => {
        expect(parser.getCommandType('btw')).to.equal('extension');
    });

    it('emits askInNewTab', () => {
        expect(parser.getEvent('btw')).to.equal('askInNewTab');
    });

    it('carries the whole question through as args', () => {
        const parsed = parser.parse('/btw what does esbuild.js copy');
        expect(parsed.command).to.equal('btw');
        expect(parsed.args).to.deep.equal(['what', 'does', 'esbuild.js', 'copy']);
    });

    it('is valid with no question at all — that is just New Tab', () => {
        const parsed = parser.parse('/btw');
        expect(parser.isValid(parsed, { planMode: false })).to.equal(true);
    });

    it('is valid in plan mode too — a side question is not a plan-mode action', () => {
        const parsed = parser.parse('/btw is this right');
        expect(parser.isValid(parsed, { planMode: true, planReady: true })).to.equal(true);
    });

    it('executing it emits askInNewTab with the question', () => {
        const emitted = [];
        const bus = { emit: (event, args) => emitted.push([event, args]) };

        parser.execute(parser.parse('/btw why is this slow'), bus);

        expect(emitted).to.deep.equal([['askInNewTab', ['why', 'is', 'this', 'slow']]]);
    });

    it('appears in the command list, so the slash panel can offer it', () => {
        expect(parser.getCommandNames()).to.include('btw');
    });
});
