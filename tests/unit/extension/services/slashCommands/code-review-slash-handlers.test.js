/**
 * Tests for CodeReviewSlashHandlers
 * Testing: /review command
 * 
 * TDD RED PHASE: These tests will fail because CodeReviewSlashHandlers doesn't exist yet
 */

const { describe, it, beforeEach, afterEach } = require('mocha');
const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const os = require('os');

// RED PHASE: This will fail - module doesn't exist
const { CodeReviewSlashHandlers } = require('../../../../../out/extension/services/slashCommands/CodeReviewSlashHandlers');

describe('CodeReviewSlashHandlers - /review command', () => {
    let handlers;
    let testSessionId;
    let testSessionDir;
    let testPlanPath;

    beforeEach(() => {
        // Create temp session directory
        testSessionId = 'test-session-123';
        testSessionDir = path.join(os.tmpdir(), '.copilot', 'session-state', testSessionId);
        testPlanPath = path.join(testSessionDir, 'plan.md');
        
        fs.mkdirSync(testSessionDir, { recursive: true });
        
        // Create mock SessionService
        const mockSessionService = {
            getCurrentSession: () => ({ id: testSessionId }),
            getPlanPath: (sessionId) => path.join(os.tmpdir(), '.copilot', 'session-state', sessionId, 'plan.md')
        };
        
        handlers = new CodeReviewSlashHandlers(mockSessionService);
    });

    afterEach(() => {
        // Cleanup
        if (fs.existsSync(testSessionDir)) {
            fs.rmSync(testSessionDir, { recursive: true, force: true });
        }
    });

    it('returns plan content when plan.md exists', async () => {
        // Arrange
        const planContent = '# Implementation Plan\n\nThis is a test plan.';
        fs.writeFileSync(testPlanPath, planContent, 'utf-8');

        // Act
        const result = await handlers.handleReview();

        // Assert
        expect(result.success).to.be.true;
        expect(result.content).to.equal(planContent);
        expect(result.error).to.be.undefined;
    });

    it('returns friendly message when plan.md does not exist', async () => {
        // Arrange - no plan.md file created

        // Act
        const result = await handlers.handleReview();

        // Assert
        expect(result.success).to.be.true;
        expect(result.content).to.include('No plan.md file exists yet');
        expect(result.content).to.include('/plan');
        expect(result.error).to.be.undefined;
    });

    it('returns friendly message when plan.md is empty', async () => {
        // Arrange
        fs.writeFileSync(testPlanPath, '', 'utf-8');

        // Act
        const result = await handlers.handleReview();

        // Assert
        expect(result.success).to.be.true;
        expect(result.content).to.include('plan.md file is empty');
        expect(result.content).to.include('/plan');
        expect(result.error).to.be.undefined;
    });

    it('returns error when no active session', async () => {
        // Arrange
        const mockSessionService = {
            getCurrentSession: () => null,
            getPlanPath: (sessionId) => path.join(os.tmpdir(), '.copilot', 'session-state', sessionId, 'plan.md')
        };
        handlers = new CodeReviewSlashHandlers(mockSessionService);

        // Act
        const result = await handlers.handleReview();

        // Assert
        expect(result.success).to.be.false;
        expect(result.error).to.include('No active session');
    });
});

describe('CodeReviewSlashHandlers - /diff command', () => {
    let handlers;
    let testWorkspaceDir;
    let file1Path;
    let file2Path;

    beforeEach(() => {
        // Create temp workspace directory
        testWorkspaceDir = path.join(os.tmpdir(), 'test-workspace-diff');
        fs.mkdirSync(testWorkspaceDir, { recursive: true });
        
        file1Path = path.join(testWorkspaceDir, 'file1.txt');
        file2Path = path.join(testWorkspaceDir, 'file2.txt');
        
        // Create mock SessionService
        const mockSessionService = {
            getCurrentSession: () => ({ id: 'test-123' }),
            getPlanPath: (sessionId) => path.join(os.tmpdir(), '.copilot', 'session-state', sessionId, 'plan.md')
        };
        
        handlers = new CodeReviewSlashHandlers(mockSessionService);
    });

    afterEach(() => {
        // Cleanup
        if (fs.existsSync(testWorkspaceDir)) {
            fs.rmSync(testWorkspaceDir, { recursive: true, force: true });
        }
    });

    it('opens diff viewer when both files exist (absolute paths)', async () => {
        // Arrange
        fs.writeFileSync(file1Path, 'content 1', 'utf-8');
        fs.writeFileSync(file2Path, 'content 2', 'utf-8');

        // Act
        const result = await handlers.handleDiff(file1Path, file2Path);

        // Assert
        expect(result.success).to.be.true;
        expect(result.error).to.be.undefined;
    });

    it('opens diff viewer when both files exist (relative paths)', async () => {
        // Arrange
        fs.writeFileSync(file1Path, 'content 1', 'utf-8');
        fs.writeFileSync(file2Path, 'content 2', 'utf-8');

        // Act - use relative paths
        const result = await handlers.handleDiff('file1.txt', 'file2.txt', testWorkspaceDir);

        // Assert
        expect(result.success).to.be.true;
        expect(result.error).to.be.undefined;
    });

    it('returns error when file1 does not exist', async () => {
        // Arrange
        fs.writeFileSync(file2Path, 'content 2', 'utf-8');
        // file1 not created

        // Act
        const result = await handlers.handleDiff(file1Path, file2Path);

        // Assert
        expect(result.success).to.be.false;
        expect(result.error).to.include('File not found');
        expect(result.error).to.include('file1.txt');
    });

    it('returns error when file2 does not exist', async () => {
        // Arrange
        fs.writeFileSync(file1Path, 'content 1', 'utf-8');
        // file2 not created

        // Act
        const result = await handlers.handleDiff(file1Path, file2Path);

        // Assert
        expect(result.success).to.be.false;
        expect(result.error).to.include('File not found');
        expect(result.error).to.include('file2.txt');
    });

    it('returns error when no arguments provided', async () => {
        // Act
        const result = await handlers.handleDiff('', '');

        // Assert
        expect(result.success).to.be.false;
        expect(result.error).to.include('Usage: /diff <file1> <file2>');
    });

    it('returns error when only one file provided', async () => {
        // Act
        const result = await handlers.handleDiff('file1.txt', '');

        // Assert
        expect(result.success).to.be.false;
        expect(result.error).to.include('Usage: /diff <file1> <file2>');
    });
});
