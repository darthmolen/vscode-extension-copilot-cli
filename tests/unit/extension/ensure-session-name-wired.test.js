const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('SDKSessionManager.start() – ensureSessionName wiring', function () {
    let sourceCode;

    before(function () {
        sourceCode = fs.readFileSync(
            path.join(__dirname, '../../../src/sdkSessionManager.ts'), 'utf-8'
        );
    });

    it('calls ensureSessionName() after session ID is established in start()', function () {
        const afterIdIdx = sourceCode.indexOf('Session active:');
        assert.ok(afterIdIdx !== -1, 'Landmark "Session active:" must exist in sdkSessionManager.ts');
        const setActiveIdx = sourceCode.indexOf('this.setActiveSession', afterIdIdx);
        assert.ok(setActiveIdx !== -1, 'setActiveSession call must follow the "Session active:" log');
        const section = sourceCode.substring(afterIdIdx, setActiveIdx);
        assert.ok(
            section.includes('ensureSessionName'),
            `ensureSessionName() must be called between "Session active:" and setActiveSession().\nSection:\n${section}`
        );
    });

    it('passes a full session path (not just the session ID) to ensureSessionName()', function () {
        const callIdx = sourceCode.indexOf('ensureSessionName(');
        assert.ok(callIdx !== -1, 'ensureSessionName must be called in sdkSessionManager.ts');
        const callLine = sourceCode.substring(callIdx, callIdx + 200);
        assert.ok(
            callLine.includes('path.join') || callLine.includes('session-state'),
            `ensureSessionName() must receive a full path.\nCall:\n${callLine}`
        );
    });
});
