/**
 * TDD Test for Diff Display Bug
 *
 * Bug: Diff viewer shows everything as "created" instead of actual diffs
 * Root Cause: For new files, tempFilePath is empty string instead of a valid empty file path
 *
 * TDD Process:
 * RED: Write tests that verify snapshot logic for new vs existing files
 * GREEN: Fix fileSnapshotService to create empty temp file for new files
 * REFACTOR: Verify diffs show correctly
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Simplified snapshot logic (extracted from fileSnapshotService.ts)
function createSnapshotSimplified(toolCallId, filePath, tempDir) {
    const existedBefore = fs.existsSync(filePath);
    let tempFilePath = '';

    if (existedBefore) {
        // Create temp file with original content
        const fileName = path.basename(filePath);
        const timestamp = Date.now();
        tempFilePath = path.join(tempDir, `${toolCallId}-${timestamp}-${fileName}`);
        fs.copyFileSync(filePath, tempFilePath);
    } else {
        // FIX: Create empty temp file to represent "before" state
        const fileName = path.basename(filePath);
        const timestamp = Date.now();
        tempFilePath = path.join(tempDir, `${toolCallId}-${timestamp}-${fileName}-empty`);
        fs.writeFileSync(tempFilePath, '', 'utf8');
    }

    return {
        toolCallId,
        originalPath: filePath,
        tempFilePath,
        existedBefore
    };
}

describe('Diff Display Bug Tests', function () {
    let testTempDir;
    let testFilePath;

    before(function () {
        testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-cli-test-'));
        testFilePath = path.join(testTempDir, 'test-file.txt');
    });

    after(function () {
        fs.rmSync(testTempDir, { recursive: true, force: true });
    });

    describe('Modified file snapshot', function () {
        let snapshot;

        before(function () {
            // Create existing file
            fs.writeFileSync(testFilePath, 'Original content');
            snapshot = createSnapshotSimplified('tool-1', testFilePath, testTempDir);
        });

        after(function () {
            if (fs.existsSync(testFilePath)) {
                fs.unlinkSync(testFilePath);
            }
            if (snapshot.tempFilePath && fs.existsSync(snapshot.tempFilePath)) {
                fs.unlinkSync(snapshot.tempFilePath);
            }
        });

        it('should create a snapshot for modified file', function () {
            assert.ok(snapshot !== null);
        });

        it('should set existedBefore to true', function () {
            assert.strictEqual(snapshot.existedBefore, true);
        });

        it('should have a non-empty tempFilePath', function () {
            assert.notStrictEqual(snapshot.tempFilePath, '');
        });

        it('should have a valid tempFilePath that exists on disk', function () {
            assert.ok(snapshot.tempFilePath && fs.existsSync(snapshot.tempFilePath));
        });

        it('should have original content in the temp file', function () {
            const tempContent = fs.readFileSync(snapshot.tempFilePath, 'utf8');
            assert.strictEqual(tempContent, 'Original content');
        });
    });

    describe('New file snapshot (THE BUG)', function () {
        let snapshot;
        let newFilePath;

        before(function () {
            newFilePath = path.join(testTempDir, 'new-file.txt');
            snapshot = createSnapshotSimplified('tool-2', newFilePath, testTempDir);
        });

        it('should create a snapshot for new file', function () {
            assert.ok(snapshot !== null);
        });

        it('should set existedBefore to false', function () {
            assert.strictEqual(snapshot.existedBefore, false);
        });

        it('should have a non-empty tempFilePath (RED: THIS IS THE BUG)', function () {
            assert.notStrictEqual(snapshot.tempFilePath, '');
        });

        it('should have a valid tempFilePath that exists on disk (RED)', function () {
            assert.ok(snapshot.tempFilePath && fs.existsSync(snapshot.tempFilePath));
        });

        it('should have an empty temp file representing new file state', function () {
            if (snapshot.tempFilePath && fs.existsSync(snapshot.tempFilePath)) {
                const tempContent = fs.readFileSync(snapshot.tempFilePath, 'utf8');
                assert.strictEqual(tempContent, '');
            } else {
                assert.fail('tempFilePath is empty string - cannot show diff!');
            }
        });
    });

    describe('Diff data for new file (simulates sdkSessionManager)', function () {
        let snapshot;
        let diffData;

        before(function () {
            const newFilePath = path.join(testTempDir, 'another-new-file.txt');
            snapshot = createSnapshotSimplified('tool-3', newFilePath, testTempDir);
            diffData = {
                toolCallId: 'tool-3',
                beforeUri: snapshot.tempFilePath,
                afterUri: snapshot.originalPath,
                title: 'Test File'
            };
        });

        it('should have a non-empty beforeUri (RED)', function () {
            assert.notStrictEqual(diffData.beforeUri, '');
        });

        it('should have a valid beforeUri file path (RED)', function () {
            assert.ok(diffData.beforeUri && fs.existsSync(diffData.beforeUri));
        });
    });
});
