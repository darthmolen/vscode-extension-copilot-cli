/**
 * Tests for CLI version check (v3.1.2)
 *
 * Verifies that checkCliVersion() detects incompatible CLI versions
 * and throws with actionable error messages before attempting connection.
 */

const Module = require('module');
const originalRequire = Module.prototype.require;

// Mock vscode module BEFORE anything else loads
Module.prototype.require = function (id) {
    if (id === 'vscode') {
        return require('../../helpers/vscode-mock');
    }
    return originalRequire.apply(this, arguments);
};

const assert = require('assert');
const path = require('path');

describe('CLI Version Check', function () {
    this.timeout(10000);

    let sdkSessionManagerModule;

    before(function () {
        // Load the compiled module
        const modulePath = path.join(__dirname, '../../../out/sdkSessionManager.js');
        try {
            sdkSessionManagerModule = require(modulePath);
        } catch (e) {
            this.skip();
        }
    });

    describe('parseCliVersion', function () {
        it('should parse "copilot version 0.0.403" format', function () {
            const version = sdkSessionManagerModule.parseCliVersion('copilot version 0.0.403');
            assert.strictEqual(version, '0.0.403');
        });

        it('should parse bare "0.0.403" format', function () {
            const version = sdkSessionManagerModule.parseCliVersion('0.0.403');
            assert.strictEqual(version, '0.0.403');
        });

        it('should parse version with trailing newline', function () {
            const version = sdkSessionManagerModule.parseCliVersion('copilot version 0.0.414\n');
            assert.strictEqual(version, '0.0.414');
        });

        it('should return null for unparseable output', function () {
            const version = sdkSessionManagerModule.parseCliVersion('not a version string');
            assert.strictEqual(version, null);
        });

        it('should return null for empty string', function () {
            const version = sdkSessionManagerModule.parseCliVersion('');
            assert.strictEqual(version, null);
        });
    });

    describe('isCliVersionIncompatible', function () {
        it('should flag 0.0.410 as incompatible', function () {
            assert.strictEqual(sdkSessionManagerModule.isCliVersionIncompatible('0.0.410'), true);
        });

        it('should flag 0.0.414 as incompatible', function () {
            assert.strictEqual(sdkSessionManagerModule.isCliVersionIncompatible('0.0.414'), true);
        });

        it('should flag 0.0.999 as incompatible', function () {
            assert.strictEqual(sdkSessionManagerModule.isCliVersionIncompatible('0.0.999'), true);
        });

        it('should allow 0.0.403', function () {
            assert.strictEqual(sdkSessionManagerModule.isCliVersionIncompatible('0.0.403'), false);
        });

        it('should allow 0.0.409', function () {
            assert.strictEqual(sdkSessionManagerModule.isCliVersionIncompatible('0.0.409'), false);
        });

        it('should allow 0.0.1', function () {
            assert.strictEqual(sdkSessionManagerModule.isCliVersionIncompatible('0.0.1'), false);
        });
    });
});
