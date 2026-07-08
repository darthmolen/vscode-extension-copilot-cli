const assert = require('assert');
const { buildCopilotClientOptions } = require('../../../out/utilities/copilotClientOptions');

describe('buildCopilotClientOptions (SDK 1.0.x connection contract)', () => {
    it('includes --yolo in connection.args when useYolo=true', () => {
        const opts = buildCopilotClientOptions('/cli/path', '/cwd', { useYolo: true });
        assert.ok(opts.connection.args.includes('--yolo'),
            'useYolo=true must surface as --yolo in connection.args (CLI still accepts it; ' +
            'config.yolo=true is the user opting in to broader bypass beyond approveAll)');
    });

    it('omits --yolo from connection.args when useYolo=false', () => {
        const opts = buildCopilotClientOptions('/cli/path', '/cwd', { useYolo: false });
        assert.ok(!opts.connection.args.includes('--yolo'),
            'useYolo=false must not pass --yolo (config.yolo=false or overridden by tool policy)');
    });

    it('omits --yolo when no options object provided (safe default)', () => {
        const opts = buildCopilotClientOptions('/cli/path', '/cwd');
        assert.ok(!opts.connection.args.includes('--yolo'),
            'default behavior must not enable --yolo — caller must explicitly opt in');
    });

    it('routes the CLI path through connection.forStdio (kind:stdio, path) — NOT the dead cliPath option', () => {
        const opts = buildCopilotClientOptions('/some/path/copilot', '/work/dir', { useYolo: true });
        assert.strictEqual(opts.connection.kind, 'stdio');
        assert.strictEqual(opts.connection.path, '/some/path/copilot',
            'SDK 1.0.x reads the CLI path from connection.path; top-level cliPath is ignored');
        assert.strictEqual(opts.cliPath, undefined,
            'must NOT emit a top-level cliPath — it is silently ignored and causes bundled-package fallback');
    });

    it('uses workingDirectory (not cwd) for the runtime process', () => {
        const opts = buildCopilotClientOptions('/cli', '/work/dir');
        assert.strictEqual(opts.workingDirectory, '/work/dir');
        assert.strictEqual(opts.cwd, undefined,
            'SDK 1.0.x renamed cwd -> workingDirectory; a stray cwd is ignored');
    });

    it('sets logLevel to "info" and does NOT set the removed autoStart option', () => {
        const opts = buildCopilotClientOptions('/cli', '/cwd');
        assert.strictEqual(opts.logLevel, 'info');
        assert.strictEqual(opts.autoStart, undefined,
            'autoStart was removed in SDK 1.0.x — the caller must call client.start() explicitly');
    });
});
