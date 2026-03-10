const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('SDKSessionManager.enablePlanMode() – plan session name mirroring', function () {
    let sourceCode;

    before(function () {
        sourceCode = fs.readFileSync(
            path.join(__dirname, '../../../src/sdkSessionManager.ts'), 'utf-8'
        );
    });

    it('mirrors work session name to plan session after "Plan session created successfully"', function () {
        const landmarkIdx = sourceCode.indexOf('Plan session created successfully');
        assert.ok(landmarkIdx !== -1, 'Landmark "Plan session created successfully" must exist');

        // Find the next Step 7/7 marker — our code must be between these two
        const step7Idx = sourceCode.indexOf('Step 7/7', landmarkIdx);
        assert.ok(step7Idx !== -1, 'Step 7/7 must follow the landmark');

        const section = sourceCode.substring(landmarkIdx, step7Idx);
        assert.ok(
            section.includes('session-name.txt'),
            `Must write session-name.txt between "Plan session created" and "Step 7/7".\nSection:\n${section}`
        );
        assert.ok(
            section.includes('workSessionId') || section.includes('workName'),
            `Must read from work session.\nSection:\n${section}`
        );
    });

    it('prefixes the plan session name with "Plan: "', function () {
        // Look specifically in the enablePlanMode region
        const enableIdx = sourceCode.indexOf('enablePlanMode');
        const regionStart = sourceCode.indexOf('Plan session created successfully', enableIdx);
        const regionEnd = sourceCode.indexOf('Step 7/7', regionStart);
        const section = sourceCode.substring(regionStart, regionEnd);
        assert.ok(
            section.includes('Plan:'),
            `Plan session name must be prefixed with "Plan:".\nSection:\n${section}`
        );
    });

    it('wraps the mirroring logic in try/catch', function () {
        const landmarkIdx = sourceCode.indexOf('Plan session created successfully');
        const step7Idx = sourceCode.indexOf('Step 7/7', landmarkIdx);
        const section = sourceCode.substring(landmarkIdx, step7Idx);
        assert.ok(
            section.includes('try') && section.includes('catch'),
            `Name mirroring must be wrapped in try/catch.\nSection:\n${section}`
        );
    });
});
