# Spike: why can't the agent see plugin skills?

**Date:** 2026-09-01
**Scripts:** `spike-skill-directories.mjs`, `spike-skills-on-resume.mjs`, `probe-cli-version.mjs`

## Reported symptom

Asked about a skill, the agent in the extension could not find it until it fell back to a glob search.

## The premise was wrong

**The plugin cache is scanned.** `SkillDirectoriesService` walks `~/.claude/plugins/cache/**` to depth 5, and the skill directories sit at depth 3. Running the resolver's exact algorithm against this machine returns **13 directories**, all plugin-cache paths. `~/.claude/skills` is not among them because it does not exist here — so "it only looked in claude skills directly" cannot describe what the loader did.

## Two real defects, found by inspection

Comparing the 13 directories against `~/.claude/plugins/installed_plugins.json`:

| Directory | Problem |
|---|---|
| `…/ai-plugins-and-skills/1.0.0/skills` | **stale** — only 1.1.0 is installed; the two collide on **17 skill names** |
| `…/curriculum/1.0.0/skills` | **uninstalled** — no manifest entry at all |

The cache retains every version ever fetched, so a blind walk cannot tell installed from stale.

## But neither defect explains the symptom

Four hypotheses, all tested, all disproven.

### 1. The name collision (`spike-skill-directories.mjs`)

Loaded two skills by name — one unique (`brainstorming`), one colliding across the stale and installed versions (`plan-intake-review`):

| Phase | directories | non-colliding | colliding |
|---|---|---|---|
| CURRENT | 13 (today's list) | FOUND | FOUND |
| MANIFEST | 11 (manifest-derived) | FOUND | FOUND |
| SINGLE | 1 (unrelated plugin) | MISS | MISS |
| ENABLE | 11 + `enableSkills: true` | FOUND | FOUND |

The `SINGLE` baseline missing both is what makes this readable — the probe can tell the difference, so the FOUNDs are real. **Skills resolve fine with the current list, collision included.**

### 2. `enableSkills` defaulting off

`types.d.ts:2084` warns that when false, "no skills are loaded regardless of `skillDirectories`", and the extension never sets it. The `ENABLE` row above sets it explicitly and changes nothing — the runtime default is already permissive.

### 3. Skills lost on the resume path (`spike-skills-on-resume.mjs`)

The extension resumes by default (`copilotCLI.resumeLastSession`), so in normal use the session is resumed, not created. This session had already found one create/resume asymmetry the types did not hint at, so "forwarded on the wire" was not treated as evidence.

| API | skill loaded |
|---|---|
| `createSession({ skillDirectories })` | FOUND |
| `resumeSession(id, { skillDirectories })` | FOUND |

Both work.

### 4. CLI version skew (`probe-cli-version.mjs`)

The spikes above ran CLI **1.0.80** from globalStorage. The extension resolves **local first**, and SDK 0.3.0 depends on `@github/copilot: ^1.0.36-0`, which npm resolved to **1.0.44** in `node_modules` — a 36-version gap, and 3.8.0's changelog notes that CLI 1.0.36 removed `~/.claude` auto-discovery. Re-running the create/resume probe against the local 1.0.44 binary: **FOUND on both paths.**

## Conclusion

At the SDK level, skill discovery works on every axis available to a spike: current directory list, manifest list, create path, resume path, both CLI versions. **The reported symptom is not reproducible outside the extension host.**

The two resolver defects are worth fixing on correctness grounds — passing a stale duplicate and an uninstalled leftover is wrong regardless — but that fix will not, on this evidence, resolve what was reported.

## What to do next

Skill resolution was entirely silent, which is why a wrong list could go unnoticed. `SDKSessionManager.resolveSkillDirectories()` now logs the resolved count at INFO and each directory at DEBUG, once per session.

Reproduce the symptom in the extension, then read the "Copilot CLI" Output Channel:

- If the log shows **11 manifest-sourced directories** and the agent still cannot find a skill, the cause is inside the extension host — most likely `copilotCLI.additionalSkillDirectories` or the per-manager cache holding a stale list across a config change.
- If the log shows **0 directories**, `os.homedir()` differs in the extension host from what these spikes saw.
- If no `[Skills]` line appears at all, `resolveSkillDirectories()` is not being reached on the path that actually started the session.

Save the log to `tests/logs/server/` per CLAUDE.md and compare against the 11 directories the manifest resolver returns.

## Reproducing

```bash
node planning/spikes/skill-discovery/spike-skill-directories.mjs   # 4 phases, 8 model calls
node planning/spikes/skill-discovery/spike-skills-on-resume.mjs    # create vs resume
node planning/spikes/skill-discovery/probe-cli-version.mjs         # against local CLI 1.0.44
```

The first two clean up after themselves. `probe-cli-version.mjs` may leave its session directory behind if the CLI still holds a lock — remove `~/.copilot/session-state/probe144-*` if they accumulate.
