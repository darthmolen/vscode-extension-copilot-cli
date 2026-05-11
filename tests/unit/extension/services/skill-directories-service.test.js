/**
 * Tests for SkillDirectoriesService
 * 
 * TDD RED PHASE: These tests will fail because SkillDirectoriesService doesn't exist yet
 */

const { describe, it, beforeEach, afterEach } = require('mocha');
const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const os = require('os');

// RED PHASE: This will fail - module doesn't exist yet
const { resolveSkillDirectories } = require('../../../../out/extension/services/SkillDirectoriesService');

describe('SkillDirectoriesService', () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-test-'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe('default skill directories', () => {
        it('includes ~/.claude/skills when it exists', () => {
            const claudeSkills = path.join(tempDir, '.claude', 'skills');
            fs.mkdirSync(claudeSkills, { recursive: true });

            const result = resolveSkillDirectories([], tempDir);

            expect(result).to.include(claudeSkills);
        });

        it('includes ~/.agents/skills when it exists', () => {
            const agentsSkills = path.join(tempDir, '.agents', 'skills');
            fs.mkdirSync(agentsSkills, { recursive: true });

            const result = resolveSkillDirectories([], tempDir);

            expect(result).to.include(agentsSkills);
        });

        it('excludes default directories that do not exist', () => {
            // tempDir is empty — no skills dirs created
            const result = resolveSkillDirectories([], tempDir);

            expect(result).to.be.empty;
        });

        it('includes both ~/.claude/skills and ~/.agents/skills when both exist', () => {
            const claudeSkills = path.join(tempDir, '.claude', 'skills');
            const agentsSkills = path.join(tempDir, '.agents', 'skills');
            fs.mkdirSync(claudeSkills, { recursive: true });
            fs.mkdirSync(agentsSkills, { recursive: true });

            const result = resolveSkillDirectories([], tempDir);

            expect(result).to.include(claudeSkills);
            expect(result).to.include(agentsSkills);
        });
    });

    describe('plugin cache discovery', () => {
        it('discovers skills dir inside a plugin cache entry', () => {
            const pluginSkills = path.join(
                tempDir, '.claude', 'plugins', 'cache',
                'my-marketplace', 'my-plugin', '1.0.0', 'skills'
            );
            fs.mkdirSync(pluginSkills, { recursive: true });

            const result = resolveSkillDirectories([], tempDir);

            expect(result).to.include(pluginSkills);
        });

        it('discovers multiple plugin skill dirs from different plugins', () => {
            const plugin1Skills = path.join(
                tempDir, '.claude', 'plugins', 'cache',
                'marketplace-a', 'plugin-one', '1.0.0', 'skills'
            );
            const plugin2Skills = path.join(
                tempDir, '.claude', 'plugins', 'cache',
                'marketplace-b', 'plugin-two', '2.3.1', 'skills'
            );
            fs.mkdirSync(plugin1Skills, { recursive: true });
            fs.mkdirSync(plugin2Skills, { recursive: true });

            const result = resolveSkillDirectories([], tempDir);

            expect(result).to.include(plugin1Skills);
            expect(result).to.include(plugin2Skills);
        });

        it('does not descend into plugin skills subdirectories', () => {
            // A skills dir should be included, but not dirs inside it
            const pluginSkills = path.join(
                tempDir, '.claude', 'plugins', 'cache',
                'my-marketplace', 'my-plugin', '1.0.0', 'skills'
            );
            const innerDir = path.join(pluginSkills, 'some-inner-dir');
            fs.mkdirSync(innerDir, { recursive: true });

            const result = resolveSkillDirectories([], tempDir);

            expect(result).to.include(pluginSkills);
            expect(result).to.not.include(innerDir);
        });

        it('handles empty plugin cache gracefully', () => {
            const cacheDir = path.join(tempDir, '.claude', 'plugins', 'cache');
            fs.mkdirSync(cacheDir, { recursive: true });

            const result = resolveSkillDirectories([], tempDir);

            expect(result).to.be.empty;
        });

        it('handles missing plugin cache directory gracefully', () => {
            // No cache dir created at all
            expect(() => resolveSkillDirectories([], tempDir)).to.not.throw();
            const result = resolveSkillDirectories([], tempDir);
            expect(result).to.be.empty;
        });
    });

    describe('user-configured additional directories', () => {
        it('includes user-provided directories that exist', () => {
            const customDir = path.join(tempDir, 'my-custom-skills');
            fs.mkdirSync(customDir, { recursive: true });

            const result = resolveSkillDirectories([customDir], tempDir);

            expect(result).to.include(customDir);
        });

        it('excludes user-provided directories that do not exist', () => {
            const nonExistent = path.join(tempDir, 'non-existent-skills');

            const result = resolveSkillDirectories([nonExistent], tempDir);

            expect(result).to.not.include(nonExistent);
        });

        it('handles empty additional dirs array', () => {
            expect(() => resolveSkillDirectories([], tempDir)).to.not.throw();
        });

        it('combines user dirs with default dirs', () => {
            const claudeSkills = path.join(tempDir, '.claude', 'skills');
            const customDir = path.join(tempDir, 'my-custom-skills');
            fs.mkdirSync(claudeSkills, { recursive: true });
            fs.mkdirSync(customDir, { recursive: true });

            const result = resolveSkillDirectories([customDir], tempDir);

            expect(result).to.include(claudeSkills);
            expect(result).to.include(customDir);
        });
    });

    describe('deduplication', () => {
        it('deduplicates directories that appear multiple times', () => {
            const claudeSkills = path.join(tempDir, '.claude', 'skills');
            fs.mkdirSync(claudeSkills, { recursive: true });

            // Pass ~/.claude/skills again as a user dir (same as default)
            const result = resolveSkillDirectories([claudeSkills], tempDir);

            const count = result.filter(d => d === claudeSkills).length;
            expect(count).to.equal(1);
        });

        it('deduplicates identical user-provided directories', () => {
            const customDir = path.join(tempDir, 'my-custom-skills');
            fs.mkdirSync(customDir, { recursive: true });

            const result = resolveSkillDirectories([customDir, customDir], tempDir);

            const count = result.filter(d => d === customDir).length;
            expect(count).to.equal(1);
        });
    });

    describe('uses real homedir by default', () => {
        it('accepts no homeDir argument (uses os.homedir())', () => {
            // Just verify it doesn't throw when called without homeDir
            expect(() => resolveSkillDirectories([])).to.not.throw();
            const result = resolveSkillDirectories([]);
            expect(result).to.be.an('array');
        });
    });
});
