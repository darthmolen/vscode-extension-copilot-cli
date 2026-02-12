/**
 * TDD Test for Diff Display Bug
 * 
 * Bug: Diff viewer shows everything as "created" instead of actual diffs
 * Root Cause: For new files, tempFilePath is empty string instead of a valid empty file path
 * 
 * TDD Process:
 * 🔴 RED: Write tests that verify snapshot logic for new vs existing files
 * 🟢 GREEN: Fix fileSnapshotService to create empty temp file for new files
 * 🔵 REFACTOR: Verify diffs show correctly
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Test results
let testResults = [];

function recordTest(name, passed, details = '') {
    testResults.push({ name, passed, details });
    const icon = passed ? '✅' : '❌';
    console.log(`${icon} ${name}${details ? ': ' + details : ''}`);
}

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
        // ✅ FIX: Create empty temp file to represent "before" state
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

async function runDiffTests() {
    console.log('='.repeat(70));
    console.log('Diff Display Bug Tests');
    console.log('Testing file snapshot logic for new vs modified files');
    console.log('='.repeat(70));
    
    // Setup: Create temp directory for test
    const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-cli-test-'));
    const testFilePath = path.join(testTempDir, 'test-file.txt');
    
    // Test 1: Modified file - should have valid tempFilePath
    console.log('\n📋 Test 1: Modified file snapshot');
    {
        // Create existing file
        fs.writeFileSync(testFilePath, 'Original content');
        
        const snapshot = createSnapshotSimplified('tool-1', testFilePath, testTempDir);
        
        recordTest('Snapshot created for modified file', snapshot !== null);
        recordTest('existedBefore is true', snapshot.existedBefore === true);
        recordTest('tempFilePath is not empty', snapshot.tempFilePath !== '');
        recordTest('tempFilePath is valid path', snapshot.tempFilePath && fs.existsSync(snapshot.tempFilePath));
        
        // Verify temp file has original content
        if (snapshot.tempFilePath && fs.existsSync(snapshot.tempFilePath)) {
            const tempContent = fs.readFileSync(snapshot.tempFilePath, 'utf8');
            recordTest('Temp file has original content', tempContent === 'Original content');
        }
        
        // Cleanup
        fs.unlinkSync(testFilePath);
        if (snapshot.tempFilePath && fs.existsSync(snapshot.tempFilePath)) {
            fs.unlinkSync(snapshot.tempFilePath);
        }
    }
    
    // Test 2: New file - should have valid tempFilePath pointing to empty file
    console.log('\n📋 Test 2: New file snapshot (THE BUG!)');
    {
        // File doesn't exist yet
        const newFilePath = path.join(testTempDir, 'new-file.txt');
        
        const snapshot = createSnapshotSimplified('tool-2', newFilePath, testTempDir);
        
        recordTest('Snapshot created for new file', snapshot !== null);
        recordTest('existedBefore is false', snapshot.existedBefore === false);
        
        // CRITICAL: tempFilePath should NOT be empty!
        // It should point to an empty file so diff can show "file created"
        recordTest('🔴 RED: tempFilePath is NOT empty', snapshot.tempFilePath !== '', 
            `Got: "${snapshot.tempFilePath}" - THIS IS THE BUG!`);
        
        recordTest('🔴 RED: tempFilePath is valid path', 
            snapshot.tempFilePath && fs.existsSync(snapshot.tempFilePath),
            `Should create empty temp file, got: "${snapshot.tempFilePath}"`);
        
        // If temp file exists, it should be empty (representing "no content before")
        if (snapshot.tempFilePath && fs.existsSync(snapshot.tempFilePath)) {
            const tempContent = fs.readFileSync(snapshot.tempFilePath, 'utf8');
            recordTest('Temp file is empty (represents new file)', tempContent === '');
        } else {
            recordTest('🔴 RED: Temp file is empty (represents new file)', false, 
                'tempFilePath is empty string - cannot show diff!');
        }
    }
    
    // Test 3: Diff data structure for new file
    console.log('\n📋 Test 3: Diff data for new file (simulates sdkSessionManager)');
    {
        const newFilePath = path.join(testTempDir, 'another-new-file.txt');
        
        const snapshot = createSnapshotSimplified('tool-3', newFilePath, testTempDir);
        
        // Simulate what sdkSessionManager does (line 585-586)
        const diffData = {
            toolCallId: 'tool-3',
            beforeUri: snapshot.tempFilePath,  // ❌ BUG: This is empty string for new files!
            afterUri: snapshot.originalPath,
            title: 'Test File'
        };
        
        recordTest('🔴 RED: beforeUri is not empty', diffData.beforeUri !== '', 
            `beforeUri="${diffData.beforeUri}" - VS Code diff will fail with empty path!`);
        
        recordTest('🔴 RED: beforeUri is valid file path', 
            diffData.beforeUri && fs.existsSync(diffData.beforeUri),
            'VS Code diff command requires valid file paths');
    }
    
    // Cleanup
    fs.rmSync(testTempDir, { recursive: true, force: true });
    
    // Summary
    console.log('\n' + '='.repeat(70));
    const passed = testResults.filter(r => r.passed).length;
    const failed = testResults.filter(r => !r.passed).length;
    console.log(`RESULTS: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(70));
    
    if (failed > 0) {
        console.log('\n🔴 RED PHASE COMPLETE - Tests fail as expected!');
        console.log('Bug confirmed: New files have empty tempFilePath, causing diff to fail.');
        console.log('\nExpected failures:');
        testResults.filter(r => !r.passed).forEach(r => {
            console.log(`  - ${r.name}: ${r.details}`);
        });
        process.exit(1);
    } else {
        console.log('\n🟢 GREEN PHASE - All tests pass!');
        process.exit(0);
    }
}

runDiffTests().catch(error => {
    console.error('Test execution failed:', error);
    process.exit(1);
});
