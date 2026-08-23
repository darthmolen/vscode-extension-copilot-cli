/**
 * A session remembers the model you chose for it (v3.13.0 P3 §4.6)
 *
 * Row one of CLAUDE.md's "intentional actions are treated intentionally" table.
 * Switching model mid-session is a *gesture*; `copilotCLI.model` is a standing
 * *default*. Today the gesture is honoured and never recorded, so the default
 * silently wins back on the next resume — and the user's own choice is the thing
 * that disappears.
 *
 * Storage is `session-model.txt` beside `session-name.txt`: plain text, one value,
 * single purpose, matching the precedent already in that directory and with no
 * read-modify-write to race. Deliberately *not* merged with P4's
 * `session-pairing.json` — that is written once at plan-session creation and never
 * edited, this is rewritten on every switch, and coupling two lifetimes into one
 * file buys nothing but a lost-update window.
 */

const { describe, it, beforeEach, afterEach } = require('mocha');
const { expect } = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { SessionService } = require(
    path.join(__dirname, '../../..', 'out', 'extension', 'services', 'SessionService.js')
);
const { chooseStartupModel } = require(
    path.join(__dirname, '../../..', 'out', 'extension', 'session', 'sessionModel.js')
);

describe('session-model.txt', () => {
    let dir;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-model-'));
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('round-trips the model the user switched to', () => {
        SessionService.writeSessionModel(dir, 'claude-opus-5');
        expect(SessionService.readSessionModel(dir)).to.equal('claude-opus-5');
    });

    it('is a separate file from the session name — neither clobbers the other', () => {
        SessionService.writeSessionName(dir, 'A conversation');
        SessionService.writeSessionModel(dir, 'claude-opus-5');

        expect(SessionService.readSessionModel(dir)).to.equal('claude-opus-5');
        expect(fs.readFileSync(path.join(dir, 'session-name.txt'), 'utf-8')).to.equal('A conversation');
    });

    it('reads null rather than throwing when nothing was ever written', () => {
        expect(SessionService.readSessionModel(dir)).to.equal(null);
    });

    it('reads null rather than throwing when the directory does not exist', () => {
        expect(SessionService.readSessionModel(path.join(dir, 'no-such-session'))).to.equal(null);
    });

    it('reads null rather than throwing on an empty or whitespace-only file', () => {
        fs.writeFileSync(path.join(dir, 'session-model.txt'), '   \n', 'utf-8');
        expect(SessionService.readSessionModel(dir)).to.equal(null);
    });

    it('trims what it reads — a trailing newline is not part of a model id', () => {
        fs.writeFileSync(path.join(dir, 'session-model.txt'), 'claude-opus-5\n', 'utf-8');
        expect(SessionService.readSessionModel(dir)).to.equal('claude-opus-5');
    });

    it('never throws when the write cannot happen', () => {
        // A session directory the CLI has not created yet. The switch already
        // succeeded; failing to record it must not surface as an error.
        SessionService.writeSessionModel(path.join(dir, 'no-such-session'), 'claude-opus-5');
    });

    it('keeps two sessions apart', () => {
        const other = fs.mkdtempSync(path.join(os.tmpdir(), 'session-model-b-'));
        try {
            SessionService.writeSessionModel(dir, 'claude-opus-5');
            SessionService.writeSessionModel(other, 'gpt-5');
            expect(SessionService.readSessionModel(dir)).to.equal('claude-opus-5');
            expect(SessionService.readSessionModel(other)).to.equal('gpt-5');
        } finally {
            fs.rmSync(other, { recursive: true, force: true });
        }
    });
});

describe('chooseStartupModel', () => {
    it('prefers what this session recorded over the configured default', () => {
        // The gesture beats the standing default. This is the whole bug.
        expect(chooseStartupModel({ persisted: 'claude-opus-5', configured: 'gpt-5', fallback: 'auto' }))
            .to.equal('claude-opus-5');
    });

    it('takes the configured default for a session that recorded nothing', () => {
        expect(chooseStartupModel({ persisted: null, configured: 'gpt-5', fallback: 'auto' }))
            .to.equal('gpt-5');
    });

    it('falls back when neither is set', () => {
        expect(chooseStartupModel({ persisted: null, configured: '', fallback: 'auto' }))
            .to.equal('auto');
    });

    it('treats an empty configured value as unset, not as a model id', () => {
        expect(chooseStartupModel({ persisted: null, configured: '   ', fallback: 'auto' }))
            .to.equal('auto');
    });

    it('applies the configured default to a NEW session, which has nothing persisted', () => {
        // What the backlog asks for: the setting governs new conversations only.
        expect(chooseStartupModel({ persisted: null, configured: 'gpt-5', fallback: 'auto' }))
            .to.equal('gpt-5');
    });
});
