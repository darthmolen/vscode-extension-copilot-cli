# Plan Mode - ACE-FCA Methodology Implementation

## Overview

Plan Mode is a dedicated planning environment that embodies the **ACE-FCA (Advanced Context Engineering with Frequent Intentional Compaction)** methodology. It provides a sandboxed session for exploration and planning, completely separate from the work session where implementation happens.

### The ACE-FCA Philosophy

**Separate Planning from Implementation**  
- Planning requires broad exploration and analysis
- Implementation requires focused execution on specific tasks
- Mixing these contexts leads to confusion and wasted tokens
- Dedicated sessions ensure clean context boundaries

**Benefits:**
- 🎯 **Focused Context** - Plan mode sees only planning-relevant tools
- 🔒 **Safe Exploration** - Cannot accidentally modify code while planning
- 💰 **Token Efficiency** - Plan context stays separate from work context
- 📋 **Persistent Plans** - Plans saved to session workspace for later reference

---

## How Plan Mode Works

### Dual-Session Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Your Session                            │
├──────────────────────────────┬──────────────────────────────┤
│        WORK SESSION          │       PLAN SESSION           │
│   session-id: abc123         │   session-id: abc123-plan    │
├──────────────────────────────┼──────────────────────────────┤
│ Full tool access             │ Restricted tool access       │
│ • bash, create, edit, task   │ • plan_bash_explore          │
│ • view, grep, glob           │ • task_agent_type_explore    │
│ • web_fetch, etc.            │ • edit_plan_file             │
│                              │ • create_plan_file           │
│                              │ • update_work_plan           │
│                              │ • view, grep, glob           │
│                              │ • web_fetch, docs            │
├──────────────────────────────┼──────────────────────────────┤
│ Implements the plan          │ Explores and designs         │
│ Modifies code                │ Reads code only              │
│ Runs tests                   │ Analyzes structure           │
│ Commits changes              │ Documents approach           │
└──────────────────────────────┴──────────────────────────────┘
```

**Key Points:**
- Only **one session active** at a time (no 2x token cost)
- Sessions share the same workspace directory
- Plan stored at: `~/.copilot/session-state/{session-id}/plan.md`
- Switching sessions is instant and seamless

---

## Using Plan Mode

### Basic Workflow

1. **Enter Plan Mode** - Click the 📝 button or say "enter plan mode"
2. **Explore & Plan** - Analyze code, research, design solution
3. **Accept Plan** - Click ✅ to switch back to work mode with plan context
4. **Implement** - Execute the plan in work mode

### UI Controls

**Planning Button Group:**
- 📝 **Plan Mode** - Enter planning session
- ✅ **Accept Plan** - Keep plan and return to work mode
- ❌ **Reject Plan** - Discard plan and return to work mode
- 📋 **View Plan** - Open plan.md in editor

### Plan Mode Tools (11 Total)

#### Planning Tools (3)
- **`update_work_plan`** - PRIMARY: Create or update complete plan
- **`create_plan_file`** - Create plan.md (restricted to plan file only)
- **`edit_plan_file`** - Edit plan.md (restricted to plan file only)

#### Exploration Tools (4)
- **`plan_bash_explore`** - Read-only shell commands (git status, ls, cat, etc.)
- **`task_agent_type_explore`** - Dispatch exploration sub-agents (explore type only)
- **`view`** - Read any file
- **`grep`** - Search file contents

#### Discovery & Documentation (4)
- **`glob`** - Find files by pattern
- **`web_fetch`** - Fetch web pages and documentation
- **`fetch_copilot_cli_documentation`** - Get Copilot CLI docs
- **`report_intent`** - Report current intent to UI

---

## What Plan Mode Can and Cannot Do

### ✅ What You CAN Do in Plan Mode

**Exploration:**
- Read any file in the workspace
- Search code with grep/glob
- Run read-only shell commands (git status, ls, cat, pwd, etc.)
- Dispatch exploration agents to analyze code structure
- Fetch external documentation

**Planning:**
- Create implementation plans with task lists
- Document architecture and design decisions
- Research solutions and gather information
- Analyze code complexity and dependencies
- Design test strategies

### ❌ What You CANNOT Do in Plan Mode

**Code Modification:**
- Cannot create/edit/delete source code files
- Cannot modify package.json, configuration files
- Cannot run build commands or tests

**Environment Changes:**
- Cannot install packages (npm, pip, etc.)
- Cannot commit to git or push changes
- Cannot run deployment scripts

**Implementation:**
- Cannot dispatch implementation agents (code, fix, debug types)
- Cannot execute dangerous commands (rm, mv, chmod, etc.)

**Why These Restrictions?**
- Ensures planning stays focused on design, not implementation
- Prevents accidental code changes during exploration
- Maintains clean separation between planning and execution contexts

---

## Workflow Examples

### Example 1: Feature Implementation

```
User: "Add user authentication"

[Clicks 📝 to enter plan mode]

Agent in Plan Mode:
1. Uses view/grep to explore current auth code
2. Uses plan_bash_explore to check dependencies
3. Uses task_agent_type_explore to analyze security patterns
4. Uses update_work_plan to create detailed implementation plan

[User clicks ✅ to accept plan]

Agent in Work Mode (auto-receives plan context):
"I have the plan at ~/.copilot/.../plan.md. Let me implement it..."
1. Reads plan file
2. Creates auth components
3. Writes tests
4. Updates configuration
```

### Example 2: Bug Investigation

```
User: "Plan how to fix the memory leak"

[Plan mode activates]

Agent in Plan Mode:
1. Uses view to examine suspect code files
2. Uses grep to find memory allocation patterns
3. Uses plan_bash_explore to check process stats
4. Documents findings and solution approach in plan

[User accepts plan]

Agent in Work Mode:
Implements the documented fix with full tool access
```

---

## Plan File Format

Plans are stored as Markdown with recommended structure:

```markdown
# Feature/Fix Name

## Problem Statement
Clear description of what needs to be done and why.

## Analysis
- Current state findings
- Dependencies identified
- Constraints and considerations

## Approach
High-level solution design and architecture.

## Tasks
- [ ] Task 1: Description
- [ ] Task 2: Description
- [ ] Task 3: Description

## Testing Strategy
How to verify the implementation.

## Technical Notes
Implementation details, gotchas, references.
```

---

## Security & Sandboxing

### Tool Restriction Implementation

Plan mode uses **renamed tools + availableTools whitelist** for security:

1. **Renamed Custom Tools** - Unique names prevent SDK conflicts
   - `plan_bash_explore` vs `bash` (SDK)
   - `task_agent_type_explore` vs `task` (SDK)
   - `edit_plan_file` vs `edit` (SDK)
   - `create_plan_file` vs `create` (SDK)

2. **availableTools Whitelist** - Explicit allow-list enforced by SDK
   - Only 11 tools available in plan mode
   - SDK's bash, create, edit, task are excluded
   - Cannot access tools not in whitelist

3. **Defense in Depth** - Tool handlers validate restrictions
   - bash: Blocks non-whitelisted commands
   - task: Blocks non-explore agent types
   - edit/create: Blocks non-plan file paths

### Allowed Commands (plan_bash_explore)

**Read-Only Commands:**
- `git status`, `git log`, `git branch`, `git diff`, `git show`
- `ls`, `cat`, `head`, `tail`, `wc`, `find`, `grep`, `tree`, `pwd`
- `npm list`, `pip list`, `pip show`, `go list`, `go mod graph`
- `which`, `whereis`, `ps`, `env`, `echo`, `date`, `uname`

**Blocked Commands:**
- `git commit`, `git push`, `git checkout`, `git merge`
- `rm`, `mv`, `cp`, `touch`, `mkdir`, `rmdir`
- `npm install`, `npm run`, `pip install`, `go get`
- `make`, `cmake`, `cargo build`, `dotnet build`
- `sudo`, `su`, `chmod`, `chown`

---

## Advanced Usage

### Using with MCP Servers

Plan mode works with Model Context Protocol (MCP) servers for additional context:

```json
{
  "copilotCLI.mcpServers": {
    "docs-server": {
      "command": "node",
      "args": ["./mcp-servers/docs/index.js"],
      "enabled": true
    }
  }
}
```

MCP tools remain available in plan mode if configured.

### Resuming Sessions

Plan mode integrates with session persistence:
- Plans are saved per work session
- Switching sessions loads the appropriate plan
- "View Plan" button shows current session's plan
- Plans persist across VS Code restarts

### Integration with ACE-FCA Skills

Plan mode is designed to work with ACE-FCA workflow skills:
- Use plan mode for the **Research** phase
- Accept plan to transition to **Plan** phase (documented)
- Work mode for **Implement** phase
- Frequent checkpoints prevent context overflow

---

## Troubleshooting

### "Cannot create file" in Plan Mode
**Issue:** Trying to create source code files  
**Solution:** Use `update_work_plan` to document what needs creation, then accept plan and create in work mode

### "Command blocked" Messages
**Issue:** Trying to run installation or modification commands  
**Solution:** These are read-only restrictions. Document the need in plan, execute in work mode

### Plan Not Loading
**Issue:** "View Plan" shows empty or old plan  
**Solution:** Check `~/.copilot/session-state/{session-id}/plan.md` exists. Session ID shown in output logs.

### Agent Confused After Accepting Plan
**Issue (Fixed in 2.0.6):** Agent doesn't know plan exists  
**Solution:** Auto-inject feature now sends plan path automatically when accepting

---

## Technical Implementation

### File Locations
- **Work Session:** `~/.copilot/session-state/{session-id}/`
- **Plan Session:** `~/.copilot/session-state/{session-id}-plan/`
- **Plan File:** `~/.copilot/session-state/{session-id}/plan.md`

### Session Lifecycle
1. Work session starts normally
2. Enter plan mode → Creates `{session-id}-plan` session
3. Plan session has restricted tools
4. Accept plan → Destroys plan session, resumes work session
5. Work session receives auto-injected message with plan path

### Code References
- **Session Manager:** `src/sdkSessionManager.ts`
- **Custom Tools:** Lines 558-903
- **Tool Whitelist:** Lines 1295-1309
- **System Message:** Lines 1311-1380
- **Tests:** `tests/plan-mode-*.test.mjs`

---

## Version History

- **v2.0.2** - Initial dual-session plan mode
- **v2.0.5** - Renamed tools + availableTools whitelist
- **v2.0.6** - Auto-inject plan context on accept, UI improvements

See [CHANGELOG.md](./CHANGELOG.md) for detailed changes.
