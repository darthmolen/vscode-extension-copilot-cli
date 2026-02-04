/**
 * Session Filtering Bug Verification Test
 * 
 * This test verifies that the bug exists: updateSessionsList() does NOT
 * call filterSessionsByFolder() even when the config setting is enabled.
 * 
 * After applying the fix, this test should FAIL (which is expected).
 */

const fs = require('fs');
const path = require('path');

console.log('======================================================================');
console.log('Session Filtering Bug Verification');
console.log('======================================================================\n');

// Read extension.ts source
const extensionPath = path.join(__dirname, '..', 'src', 'extension.ts');
const source = fs.readFileSync(extensionPath, 'utf-8');

// Extract updateSessionsList function
const updateSessionsListMatch = source.match(/function updateSessionsList\(\)\s*\{[^]*?\n\}/);

if (!updateSessionsListMatch) {
    console.log('❌ FAILED: Could not find updateSessionsList function');
    process.exit(1);
}

const functionCode = updateSessionsListMatch[0];

// Check 1: Does it import filterSessionsByFolder?
const hasImport = source.includes('filterSessionsByFolder') && 
                  (source.includes('from \'./sessionUtils\'') || source.includes('from "./sessionUtils"'));

// Check 2: Does the function use filterSessionsByFolder?
const usesFilter = functionCode.includes('filterSessionsByFolder');

// Check 3: Does it check the config setting?
const checksConfig = functionCode.includes('filterSessionsByFolder') || 
                     functionCode.includes('getConfiguration');

console.log('📋 Analysis of updateSessionsList():');
console.log(`   1. Imports filterSessionsByFolder from sessionUtils: ${hasImport ? 'YES ✓' : 'NO ✗'}`);
console.log(`   2. Calls filterSessionsByFolder(): ${usesFilter ? 'YES ✓' : 'NO ✗'}`);
console.log(`   3. Reads filterSessionsByFolder config: ${checksConfig ? 'YES ✓' : 'NO ✗'}`);

console.log('\n📋 Bug Status:');
if (!hasImport && !usesFilter) {
    console.log('   ✅ BUG CONFIRMED: updateSessionsList() does NOT filter sessions');
    console.log('   The function shows ALL sessions regardless of workspace');
    console.log('   This matches the reported bug behavior\n');
    console.log('Expected fix:');
    console.log('   1. Import filterSessionsByFolder and getAllSessions from sessionUtils');
    console.log('   2. Read the filterSessionsByFolder config setting');
    console.log('   3. Get current workspace folder');
    console.log('   4. Call filterSessionsByFolder() before sorting (when enabled)');
    process.exit(0); // Success - bug exists as expected
} else if (hasImport && usesFilter) {
    console.log('   ❌ BUG FIXED: updateSessionsList() DOES filter sessions');
    console.log('   The fix has been applied!');
    process.exit(1); // Fail - bug was supposed to exist for RED phase
} else {
    console.log('   ⚠️  PARTIAL: Some filtering logic exists but may be incomplete');
    console.log('   Review the implementation');
    process.exit(1);
}
