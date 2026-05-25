const assert = require('assert');
const { buildCopilotClientOptions } = require('../../../out/utilities/copilotClientOptions');

describe('buildCopilotClientOptions', () => {
    it('includes --yolo in cliArgs when useYolo=true', () => {
        const opts = buildCopilotClientOptions('/cli/path.js', '/cwd', { useYolo: true });
        assert.ok(opts.cliArgs.includes('--yolo'),
            'useYolo=true must surface as --yolo in cliArgs (CLI 1.0.52 still accepts it; ' +
            'config.yolo=true is the user opting in to broader bypass beyond approveAll)');
    });

    it('omits --yolo from cliArgs when useYolo=false', () => {
        const opts = buildCopilotClientOptions('/cli/path.js', '/cwd', { useYolo: false });
        assert.ok(!opts.cliArgs.includes('--yolo'),
            'useYolo=false must not pass --yolo (config.yolo=false or overridden by tool policy)');
    });

    it('omits --yolo when no options object provided (safe default)', () => {
        const opts = buildCopilotClientOptions('/cli/path.js', '/cwd');
        assert.ok(!opts.cliArgs.includes('--yolo'),
            'default behavior must not enable --yolo — caller must explicitly opt in');
    });

    it('passes through cliPath and cwd verbatim', () => {
        const opts = buildCopilotClientOptions('/some/path/index.js', '/work/dir', { useYolo: true });
        assert.strictEqual(opts.cliPath, '/some/path/index.js');
        assert.strictEqual(opts.cwd, '/work/dir');
    });

    it('sets logLevel to "info" and autoStart to true (current contract)', () => {
        const opts = buildCopilotClientOptions('/cli.js', '/cwd');
        assert.strictEqual(opts.logLevel, 'info');
        assert.strictEqual(opts.autoStart, true);
    });
});
