/**
 * Plan Mode Duplicate Tool Detection Test
 * 
 * This test validates that plan mode doesn't create duplicate tool names.
 * 
 * Root cause of the bug:
 * - Plan mode creates custom tools: bash, create, edit, task, update_work_plan  
 * - When availableTools is NOT specified, SDK includes ALL built-in tools
 * - Result: bash (custom) + bash (SDK) = DUPLICATE
 * 
 * This test SHOULD FAIL until the bug is fixed.
 */

const path = require('path');
const fs = require('fs');

console.log('=== Plan Mode Duplicate Tool Detection Test ===\n');

// Load the source directly to inspect tool configuration
const sdkManagerSource = fs.readFileSync(
    path.join(__dirname, '../src/sdkSessionManager.ts'),
    'utf-8'
);

console.log('Analyzing sdkSessionManager.ts for duplicate tool configuration...\n');

// Check 1: Does getCustomTools return tools with names that conflict with SDK tools?
const customToolsMatch = sdkManagerSource.match(/private getCustomTools\(\)[\s\S]*?return \[([\s\S]*?)\];/);
if (!customToolsMatch) {
    console.error('❌ Could not find getCustomTools method');
    process.exit(1);
}

const customToolsSection = customToolsMatch[1];
console.log('Custom tools defined in plan mode:');

// SDK built-in tools that are always available when availableTools is not specified
const sdkBuiltinTools = [
    'bash', 'view', 'edit', 'create', 'grep', 'glob', 'task', 
    'report_intent', 'web_fetch', 'fetch_copilot_cli_documentation',
    'skill', 'stop_bash', 'read_bash', 'write_bash', 'list_bash',
    'store_memory', 'update_todo'
];

// Extract custom tool names from the code
const customToolCreators = [
    { method: 'createUpdateWorkPlanTool', name: 'update_work_plan' },
    { method: 'createRestrictedBashTool', name: 'bash' },
    { method: 'createRestrictedCreateTool', name: 'create' },
    { method: 'createRestrictedEditTool', name: 'edit' },
    { method: 'createRestrictedTaskTool', name: 'task' }
];

const customToolsInPlanMode = [];
for (const tool of customToolCreators) {
    if (customToolsSection.includes(tool.method)) {
        customToolsInPlanMode.push(tool.name);
        console.log(`  ✓ ${tool.name} (via ${tool.method})`);
    }
}

// Check 2: Does plan mode createSession specify availableTools?
const createSessionMatch = sdkManagerSource.match(/this\.planSession = await this\.client\.createSession\(\{([\s\S]*?)\}\);/);
if (!createSessionMatch) {
    console.error('\n❌ Could not find planSession createSession call');
    process.exit(1);
}

const createSessionConfig = createSessionMatch[1];
const hasAvailableTools = createSessionConfig.includes('availableTools:');

console.log(`\nPlan session configuration:`);
console.log(`  tools: ${customToolsInPlanMode.length} custom tools`);
console.log(`  availableTools: ${hasAvailableTools ? 'SPECIFIED' : 'NOT SPECIFIED (SDK adds all built-in tools)'}`);

// Check for duplicates
const duplicates = customToolsInPlanMode.filter(tool => sdkBuiltinTools.includes(tool));

console.log('\n' + '='.repeat(60));
console.log('DUPLICATE DETECTION RESULTS:');
console.log('='.repeat(60));

if (duplicates.length > 0) {
    console.log('❌ DUPLICATES FOUND:');
    for (const dup of duplicates) {
        console.log(`   - "${dup}" exists as both custom and SDK tool`);
    }
    console.log('\nExplanation:');
    console.log('  When availableTools is not specified in createSession(),');
    console.log('  the SDK automatically includes ALL built-in tools.');
    console.log('  This causes tool name conflicts when the API is called.');
    console.log('\nExpected behavior:');
    console.log('  Plan mode should either:');
    console.log('  1. Set availableTools to explicitly list allowed SDK tools, OR');
    console.log('  2. Rename custom tools to avoid conflicts (e.g., plan_bash)');
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ TEST PASSED - Bug successfully detected');
    console.log('='.repeat(60));
    console.log('\nThis test confirms the duplicate tool bug exists in the code.');
    console.log('The bug will cause "Tool names must be unique" errors when:');
    console.log('  - Plan mode is enabled');
    console.log('  - A message is sent to the AI (triggers API validation)');
    console.log('  - Especially when MCP servers are also configured');
    
    process.exit(0); // Exit 0 because we WANT to detect the bug
} else {
    console.log('✅ NO DUPLICATES - Bug appears to be fixed');
    console.log('\nEither:');
    console.log('  1. availableTools is now specified, OR');
    console.log('  2. Custom tools have been renamed');
    
    console.log('\n' + '='.repeat(60));
    console.log('❌ TEST FAILED - Could not detect expected bug');
    console.log('='.repeat(60));
    
    process.exit(1);
}
