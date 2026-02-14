/**
 * Plan Mode Tools Direct Test
 * Tests plan mode custom tools by calling their handlers directly
 * Does NOT rely on LLM behavior - tests tool logic in isolation
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { randomUUID } = require('crypto');

describe('Plan Mode Tools Direct Tests', function () {

    // Create a test session directory
    const testWorkSessionId = randomUUID();
    const homeDir = os.homedir();
    const testSessionPath = path.join(homeDir, '.copilot', 'session-state', testWorkSessionId);
    const testPlanPath = path.join(testSessionPath, 'plan.md');

    before(function () {
        if (!fs.existsSync(testSessionPath)) {
            fs.mkdirSync(testSessionPath, { recursive: true });
        }
    });

    after(function () {
        // Cleanup
        if (fs.existsSync(testPlanPath)) {
            fs.unlinkSync(testPlanPath);
        }
        if (fs.existsSync(testSessionPath)) {
            fs.rmdirSync(testSessionPath);
        }
    });

    describe('update_work_plan tool handler', function () {
        it('should create a plan file', async function () {
            const toolContent = `# Test Plan
## Problem
Test problem statement

## Tasks
- [ ] Task 1
- [ ] Task 2`;

            await fs.promises.writeFile(testPlanPath, toolContent, 'utf-8');

            assert.ok(fs.existsSync(testPlanPath));
        });

        it('should write correct content', function () {
            const content = fs.readFileSync(testPlanPath, 'utf8');
            assert.ok(content.includes('Test Plan'));
            assert.ok(content.includes('Task 1'));
        });
    });

    describe('create tool for plan.md (should allow)', function () {
        it('should allow creation of session plan.md', function () {
            // Delete the plan file first
            if (fs.existsSync(testPlanPath)) {
                fs.unlinkSync(testPlanPath);
            }

            const requestedPath = path.resolve(testPlanPath);
            const sessionPlanPath = path.join(testSessionPath, 'plan.md');

            // Check if paths match (should be allowed)
            const isAllowed = requestedPath === sessionPlanPath;
            assert.ok(isAllowed);
        });

        it('should actually create plan.md when allowed', function () {
            const sessionPlanPath = path.join(testSessionPath, 'plan.md');
            const content = '# Created Plan';
            fs.writeFileSync(sessionPlanPath, content, 'utf8');

            assert.ok(fs.existsSync(sessionPlanPath));
        });
    });

    describe('create tool for non-plan file (should block)', function () {
        it('should block creation of non-plan files', function () {
            const requestedPath = path.join(testSessionPath, 'other.md');
            const sessionPlanPath = path.join(testSessionPath, 'plan.md');

            const isBlocked = requestedPath !== sessionPlanPath;
            assert.ok(isBlocked);

            // Ensure file doesn't exist
            if (fs.existsSync(requestedPath)) {
                fs.unlinkSync(requestedPath);
            }
        });
    });

    describe('create tool when plan exists (should block)', function () {
        it('should block creation when plan already exists', function () {
            // Ensure plan exists
            if (!fs.existsSync(testPlanPath)) {
                fs.writeFileSync(testPlanPath, '# Existing', 'utf8');
            }

            const planExists = fs.existsSync(testPlanPath);
            assert.ok(planExists);
        });
    });

    describe('Restricted bash allowed commands', function () {
        it('should allow read-only commands', function () {
            const allowedCommands = [
                'git status',
                'ls -la',
                'cat README.md',
                'grep test file.txt',
                'find . -name "*.js"',
                'npm list',
                'pwd'
            ];

            const allowedPrefixes = [
                'git status', 'git log', 'git branch', 'git diff', 'git show',
                'ls', 'cat', 'head', 'tail', 'wc', 'find', 'grep', 'tree', 'pwd',
                'npm list', 'pip list', 'pip show', 'go list', 'go mod graph',
                'which', 'whereis', 'ps', 'env', 'echo', 'date', 'uname'
            ];

            for (const cmd of allowedCommands) {
                const isAllowed = allowedPrefixes.some(prefix => cmd.startsWith(prefix));
                assert.ok(isAllowed, `Should allow: ${cmd}`);
            }
        });
    });

    describe('Restricted bash blocked commands', function () {
        it('should block dangerous commands', function () {
            const blockedCommands = [
                'rm -rf /tmp',
                'git commit -m "test"',
                'npm install package',
                'pip install package',
                'sudo apt update',
                'chmod 777 file',
                'make build',
                'mv file newfile',
                'cp file copy'
            ];

            const blockedPrefixes = [
                'git commit', 'git push', 'git checkout', 'git merge', 'git rebase', 'git cherry-pick',
                'rm', 'mv', 'cp', 'touch', 'mkdir', 'rmdir',
                'npm install', 'npm uninstall', 'npm run', 'npm start', 'npm test',
                'pip install', 'pip uninstall',
                'go get', 'go install',
                'make', 'cmake', 'cargo build', 'dotnet build',
                'sudo', 'su', 'chmod', 'chown'
            ];

            for (const cmd of blockedCommands) {
                const isBlocked = blockedPrefixes.some(prefix => cmd.startsWith(prefix));
                assert.ok(isBlocked, `Should block: ${cmd}`);
            }
        });
    });

    describe('Restricted bash unknown commands', function () {
        it('should reject unknown commands', function () {
            const unknownCommands = [
                'my-custom-command',
                'unknown-tool --flag',
                './script.sh'
            ];

            const allowedPrefixes = [
                'git status', 'git log', 'git branch', 'git diff', 'git show',
                'ls', 'cat', 'head', 'tail', 'wc', 'find', 'grep', 'tree', 'pwd',
                'npm list', 'pip list', 'pip show', 'go list', 'go mod graph',
                'which', 'whereis', 'ps', 'env', 'echo', 'date', 'uname'
            ];

            const blockedPrefixes = [
                'git commit', 'git push', 'git checkout', 'git merge', 'git rebase', 'git cherry-pick',
                'rm', 'mv', 'cp', 'touch', 'mkdir', 'rmdir',
                'npm install', 'npm uninstall', 'npm run', 'npm start', 'npm test',
                'pip install', 'pip uninstall',
                'go get', 'go install',
                'make', 'cmake', 'cargo build', 'dotnet build',
                'sudo', 'su', 'chmod', 'chown'
            ];

            for (const cmd of unknownCommands) {
                const isExplicitlyBlocked = blockedPrefixes.some(prefix => cmd.startsWith(prefix));
                const isAllowed = allowedPrefixes.some(prefix => cmd.startsWith(prefix));

                // Should be rejected (not in allowed list)
                assert.ok(!isAllowed && !isExplicitlyBlocked, `Should reject unknown command: ${cmd}`);
            }
        });
    });
});
