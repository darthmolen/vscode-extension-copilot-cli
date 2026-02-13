/**
 * TDD RED Phase: InlineDiffService.computeInlineDiff()
 *
 * Module under test: src/extension/services/InlineDiffService.ts
 * Compiled output:   out/extension/services/InlineDiffService.js
 *
 * The module does NOT exist yet. All tests should show as "pending" because
 * the before() hook skips them when the require fails (Cannot find module).
 *
 * Function signature:
 *   computeInlineDiff(beforeContent: string, afterContent: string, maxLines?: number): InlineDiff
 *
 * Where:
 *   DiffLine  = { type: 'add' | 'remove' | 'context', text: string }
 *   InlineDiff = { lines: DiffLine[], truncated: boolean, totalLines: number }
 */

const assert = require('assert');

let computeInlineDiff;

describe('InlineDiffService', function () {

    before(function () {
        try {
            const mod = require('../../../out/extension/services/InlineDiffService');
            computeInlineDiff = mod.computeInlineDiff;
        } catch (e) {
            // Module not found -- RED phase expected
        }
    });

    beforeEach(function () {
        if (!computeInlineDiff) {
            this.skip(); // Skip if module not built yet (RED phase shows pending)
        }
    });

    // ---------------------------------------------------------------
    // 1. Identical content returns empty diff
    // ---------------------------------------------------------------
    it('should return an empty diff when before and after are identical', function () {
        const before = 'line one\nline two\nline three\n';
        const after = 'line one\nline two\nline three\n';

        const result = computeInlineDiff(before, after);

        assert.deepStrictEqual(result.lines, []);
        assert.strictEqual(result.truncated, false);
        assert.strictEqual(result.totalLines, 0);
    });

    // ---------------------------------------------------------------
    // 2. Single line added
    // ---------------------------------------------------------------
    it('should detect a single added line', function () {
        const before = '';
        const after = 'hello\n';

        const result = computeInlineDiff(before, after);

        assert.strictEqual(result.lines.length, 1);
        assert.deepStrictEqual(result.lines[0], { type: 'add', text: 'hello' });
        assert.strictEqual(result.truncated, false);
        assert.strictEqual(result.totalLines, 1);
    });

    // ---------------------------------------------------------------
    // 3. Single line removed
    // ---------------------------------------------------------------
    it('should detect a single removed line', function () {
        const before = 'hello\n';
        const after = '';

        const result = computeInlineDiff(before, after);

        assert.strictEqual(result.lines.length, 1);
        assert.deepStrictEqual(result.lines[0], { type: 'remove', text: 'hello' });
        assert.strictEqual(result.truncated, false);
        assert.strictEqual(result.totalLines, 1);
    });

    // ---------------------------------------------------------------
    // 4. Line modified (remove + add)
    // ---------------------------------------------------------------
    it('should show a remove and an add when a line is modified', function () {
        const before = 'hello\n';
        const after = 'world\n';

        const result = computeInlineDiff(before, after);

        assert.strictEqual(result.lines.length, 2);

        const removeLines = result.lines.filter(l => l.type === 'remove');
        const addLines = result.lines.filter(l => l.type === 'add');

        assert.strictEqual(removeLines.length, 1);
        assert.strictEqual(removeLines[0].text, 'hello');
        assert.strictEqual(addLines.length, 1);
        assert.strictEqual(addLines[0].text, 'world');
        assert.strictEqual(result.totalLines, 2);
    });

    // ---------------------------------------------------------------
    // 5. Context lines around changes
    // ---------------------------------------------------------------
    it('should include context lines around a change', function () {
        const before = 'line1\nline2\nline3\nline4\nline5\n';
        const after  = 'line1\nline2\nCHANGED\nline4\nline5\n';

        const result = computeInlineDiff(before, after);

        // Expect at least: context(line2), remove(line3), add(CHANGED), context(line4)
        const types = result.lines.map(l => l.type);
        const texts = result.lines.map(l => l.text);

        // line2 should appear as context before the change
        const line2Index = texts.indexOf('line2');
        assert.ok(line2Index !== -1, 'line2 should be present as context');
        assert.strictEqual(result.lines[line2Index].type, 'context');

        // line4 should appear as context after the change
        const line4Index = texts.indexOf('line4');
        assert.ok(line4Index !== -1, 'line4 should be present as context');
        assert.strictEqual(result.lines[line4Index].type, 'context');

        // The change itself
        assert.ok(types.includes('remove'), 'should include a remove line');
        assert.ok(types.includes('add'), 'should include an add line');
        assert.ok(texts.includes('line3'), 'removed text should be line3');
        assert.ok(texts.includes('CHANGED'), 'added text should be CHANGED');
    });

    // ---------------------------------------------------------------
    // 6. Multiple separate changes
    // ---------------------------------------------------------------
    it('should handle multiple separate changes with their own context', function () {
        const lines = [];
        for (let i = 1; i <= 10; i++) {
            lines.push('line' + i);
        }

        const before = lines.join('\n') + '\n';

        // Change line 2 and line 8
        const afterLines = [...lines];
        afterLines[1] = 'CHANGED2';
        afterLines[7] = 'CHANGED8';
        const after = afterLines.join('\n') + '\n';

        const result = computeInlineDiff(before, after);

        const removeTexts = result.lines.filter(l => l.type === 'remove').map(l => l.text);
        const addTexts = result.lines.filter(l => l.type === 'add').map(l => l.text);

        assert.ok(removeTexts.includes('line2'), 'should remove line2');
        assert.ok(removeTexts.includes('line8'), 'should remove line8');
        assert.ok(addTexts.includes('CHANGED2'), 'should add CHANGED2');
        assert.ok(addTexts.includes('CHANGED8'), 'should add CHANGED8');

        // Both changes should have context lines around them
        const contextTexts = result.lines.filter(l => l.type === 'context').map(l => l.text);
        assert.ok(contextTexts.includes('line1'), 'line1 should be context for first change');
        assert.ok(contextTexts.includes('line3'), 'line3 should be context for first change');
        assert.ok(contextTexts.includes('line7'), 'line7 should be context for second change');
        assert.ok(contextTexts.includes('line9'), 'line9 should be context for second change');
    });

    // ---------------------------------------------------------------
    // 7. maxLines default is 10
    // ---------------------------------------------------------------
    it('should default maxLines to 10 and truncate larger diffs', function () {
        // Create a diff that produces exactly 15 changed lines (all adds)
        const before = '';
        const afterLines = [];
        for (let i = 1; i <= 15; i++) {
            afterLines.push('new-line-' + i);
        }
        const after = afterLines.join('\n') + '\n';

        const result = computeInlineDiff(before, after);

        assert.strictEqual(result.lines.length, 10, 'should return exactly 10 lines');
        assert.strictEqual(result.truncated, true, 'should be truncated');
        assert.strictEqual(result.totalLines, 15, 'totalLines should be 15');
    });

    // ---------------------------------------------------------------
    // 8. maxLines custom value
    // ---------------------------------------------------------------
    it('should respect a custom maxLines value', function () {
        const before = '';
        const afterLines = [];
        for (let i = 1; i <= 20; i++) {
            afterLines.push('added-' + i);
        }
        const after = afterLines.join('\n') + '\n';

        const result = computeInlineDiff(before, after, 5);

        assert.ok(result.lines.length <= 5, 'should return at most 5 lines');
        assert.strictEqual(result.truncated, true, 'should be truncated');
    });

    // ---------------------------------------------------------------
    // 9. truncated is false when under limit
    // ---------------------------------------------------------------
    it('should set truncated to false when diff is under the limit', function () {
        const before = 'aaa\n';
        const after = 'bbb\n';

        // This produces a 2-line diff (remove + add), well under default 10
        const result = computeInlineDiff(before, after);

        assert.strictEqual(result.truncated, false);
        assert.ok(result.lines.length <= 10, 'should be within default limit');
    });

    // ---------------------------------------------------------------
    // 10. totalLines reflects actual diff size even when truncated
    // ---------------------------------------------------------------
    it('should report totalLines as the full diff size even when truncated', function () {
        const before = '';
        const afterLines = [];
        for (let i = 1; i <= 25; i++) {
            afterLines.push('line-' + i);
        }
        const after = afterLines.join('\n') + '\n';

        const result = computeInlineDiff(before, after, 5);

        assert.strictEqual(result.totalLines, 25, 'totalLines should reflect full diff');
        assert.strictEqual(result.lines.length, 5, 'returned lines should match maxLines');
        assert.strictEqual(result.truncated, true);
    });

    // ---------------------------------------------------------------
    // 11. Handles empty files
    // ---------------------------------------------------------------
    it('should handle both files being empty', function () {
        const result = computeInlineDiff('', '');

        assert.deepStrictEqual(result.lines, []);
        assert.strictEqual(result.truncated, false);
        assert.strictEqual(result.totalLines, 0);
    });

    // ---------------------------------------------------------------
    // 12. Handles file creation (empty before, content after)
    // ---------------------------------------------------------------
    it('should treat all lines as adds for file creation', function () {
        const before = '';
        const after = 'first\nsecond\nthird\n';

        const result = computeInlineDiff(before, after);

        assert.strictEqual(result.lines.length, 3);
        result.lines.forEach(function (line) {
            assert.strictEqual(line.type, 'add', 'all lines should be type add');
        });

        const texts = result.lines.map(l => l.text);
        assert.deepStrictEqual(texts, ['first', 'second', 'third']);
    });

    // ---------------------------------------------------------------
    // 13. Handles file deletion (content before, empty after)
    // ---------------------------------------------------------------
    it('should treat all lines as removes for file deletion', function () {
        const before = 'first\nsecond\nthird\n';
        const after = '';

        const result = computeInlineDiff(before, after);

        assert.strictEqual(result.lines.length, 3);
        result.lines.forEach(function (line) {
            assert.strictEqual(line.type, 'remove', 'all lines should be type remove');
        });

        const texts = result.lines.map(l => l.text);
        assert.deepStrictEqual(texts, ['first', 'second', 'third']);
    });

    // ---------------------------------------------------------------
    // 14. Preserves indentation in text
    // ---------------------------------------------------------------
    it('should preserve leading whitespace in diff text', function () {
        const before = 'function foo() {\n    return 1;\n}\n';
        const after  = 'function foo() {\n\treturn 2;\n}\n';

        const result = computeInlineDiff(before, after);

        const removeLine = result.lines.find(l => l.type === 'remove');
        const addLine = result.lines.find(l => l.type === 'add');

        assert.ok(removeLine, 'should have a remove line');
        assert.ok(addLine, 'should have an add line');
        assert.strictEqual(removeLine.text, '    return 1;', 'should preserve spaces');
        assert.strictEqual(addLine.text, '\treturn 2;', 'should preserve tabs');
    });

    // ---------------------------------------------------------------
    // 15. Handles no trailing newline
    // ---------------------------------------------------------------
    it('should diff correctly when files have no trailing newline', function () {
        const before = 'alpha\nbeta';
        const after  = 'alpha\ngamma';

        const result = computeInlineDiff(before, after);

        const removeLine = result.lines.find(l => l.type === 'remove');
        const addLine = result.lines.find(l => l.type === 'add');

        assert.ok(removeLine, 'should have a remove line');
        assert.ok(addLine, 'should have an add line');
        assert.strictEqual(removeLine.text, 'beta', 'should remove beta');
        assert.strictEqual(addLine.text, 'gamma', 'should add gamma');
        assert.strictEqual(result.truncated, false);
    });
});
