const assert = require('assert');
const { buildCliSpawnCommand } = require('../../../out/utilities/cliSpawn');

describe('buildCliSpawnCommand', () => {
    it('returns node + cliPath when cliPath ends with .js (Windows-safe)', () => {
        const result = buildCliSpawnCommand('/path/to/index.js');
        assert.strictEqual(result.command, process.execPath,
            'must invoke the current node so .js files run on Windows (avoid EFTYPE)');
        assert.deepStrictEqual(result.args, ['/path/to/index.js']);
    });

    it('returns cliPath directly when it is a native executable', () => {
        const result = buildCliSpawnCommand('/usr/local/bin/copilot');
        assert.strictEqual(result.command, '/usr/local/bin/copilot');
        assert.deepStrictEqual(result.args, []);
    });

    it('handles Windows .js paths the same way (case-sensitive .js suffix)', () => {
        const result = buildCliSpawnCommand('C:\\Users\\me\\copilot\\npm-loader.js');
        assert.strictEqual(result.command, process.execPath);
        assert.deepStrictEqual(result.args, ['C:\\Users\\me\\copilot\\npm-loader.js']);
    });

    it('treats .exe as a native executable, not a script', () => {
        const result = buildCliSpawnCommand('C:\\bin\\copilot.exe');
        assert.strictEqual(result.command, 'C:\\bin\\copilot.exe');
        assert.deepStrictEqual(result.args, []);
    });
});
