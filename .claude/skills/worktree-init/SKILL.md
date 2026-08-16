---
name: worktree-init
description: Use when starting parallel work that needs its own checkout - creates a git worktree for this repo and wires up the gitignored directories a fresh worktree does NOT get (research/, node_modules/), then verifies the tree builds. Triggers - "worktree", "git tree", "separate checkout", "work on this in parallel", "split the lanes".
---

# Worktree Init

## Why this needs a skill at all

`git worktree add` gets you a checkout. It does **not** get you a working checkout of *this*
repo, because two directories this project depends on are gitignored:

| Directory | Size | Why a missing copy hurts |
| --- | --- | --- |
| `research/` | ~300 MB | CLAUDE.md's **SDK-First rule** requires reading `research/copilot-sdk/nodejs/src/` *before* touching SDK behavior. Without it the rule is unfollowable, and the failure mode is silent — you guess at an API instead of reading it. |
| `node_modules/` | ~524 MB | No build, no tests, no type-check. |

Neither absence throws a clear error at setup time. `research/` in particular just isn't there,
and nothing complains until someone ships an assumption.

**This skill is repo-agnostic in shape but repo-specific in content.** The two directories above
are this project's facts. If a third gitignored-but-required directory appears, add it to
`SHARED_DIRS` in step 2 and to the table above.

## Arguments

- `$1` — **suffix** for the worktree directory (required). `lane-a` → `../<repo>-lane-a`.
- `$2` — **branch name** (required). Created if it doesn't exist, checked out if it does.
- `$3` — **base ref** (optional, default `main`). Only used when creating a new branch.

Never hardcode a branch or a suffix into this skill. It is for any parallel work, not one lane.

## Steps

### 1. Verify preconditions

```bash
SUFFIX="$1"; BRANCH="$2"; BASE="${3:-main}"
[ -n "$SUFFIX" ] && [ -n "$BRANCH" ] || { echo "usage: worktree-init <suffix> <branch> [base]"; exit 1; }

ROOT=$(git rev-parse --show-toplevel) || exit 1
REPO=$(basename "$ROOT")
DEST="$(dirname "$ROOT")/${REPO}-${SUFFIX}"

[ -e "$DEST" ] && { echo "$DEST already exists — pick another suffix"; exit 1; }
git worktree list    # show what already exists; do not create a duplicate of an existing branch
```

A branch can only be checked out in **one** worktree at a time. If `git worktree list` already
shows `$BRANCH`, stop and use that directory instead of creating a second one.

### 2. Create the worktree

```bash
git fetch -q origin
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
    git worktree add "$DEST" "$BRANCH"
else
    git worktree add -b "$BRANCH" "$DEST" "$BASE"
fi
```

Branch off the **base ref**, not off whatever the current worktree happens to have checked out —
parallel lanes routinely sit on unrelated branches.

### 3. Link the shared gitignored directories

```bash
SHARED_DIRS="research node_modules"
for d in $SHARED_DIRS; do
    if [ -e "$ROOT/$d" ]; then
        ln -s "$ROOT/$d" "$DEST/$d" && echo "  linked $d"
    else
        echo "  ** $d missing in the source tree — resolve before building"
    fi
done
```

**Symlink, not copy.** 824 MB of duplication buys nothing: `research/` is read-only reference
material, and `node_modules` is valid across worktrees because they share a platform and arch.

**The tradeoff to state out loud:** an `npm install` in *either* tree mutates *both*. That is
acceptable while no lane is changing dependencies, and this repo changes them rarely — 10 commits
touched the dependency block between Jan and Aug 2026, and 4 of those were `@github/copilot-sdk`
bumps. **The trigger to watch is an SDK upgrade**, which also drives the bundled CLI version, so
it is a loud coordinated event rather than a silent one. When it happens, break the symlink and
run a real `npm install` in each tree.

### 4. Verify the tree actually works

Do not report success from `git worktree add` alone — it succeeds even when nothing is linked.

```bash
cd "$DEST"
npm run check-types                                          # proves node_modules resolves
ls research/copilot-sdk/nodejs/src/ >/dev/null               # proves the SDK source is reachable
npx mocha tests/unit/extension/copilot-client-provider.test.js --timeout 10000
```

One fast unit file is enough; a full `npm test` here is wasted time and, given the suite flake,
not informative on a single run.

### 5. Report the constraint the worktree cannot solve

Print this. It is the part people forget:

> **VSIX collision.** `./test-extension.sh` runs
> `code --install-extension darthmolen.copilot-cli-extension --force`, which is **global to VS
> Code**. Only one build of this extension ID can be installed at a time, so whichever worktree
> ran it last wins — silently, with no error. Coordinate before installing from a second tree.

Work that only needs spikes, unit tests or type-checking is unaffected. Work that needs the
sidebar is not.

## Cleanup

```bash
git worktree remove <path>          # refuses if dirty; --force to override
git worktree prune                  # after a manual directory delete
```

Removing a worktree does **not** delete its branch — delete that separately if it is finished.
The symlinks live inside the worktree, so they go with it; the shared originals are untouched.

## Common mistakes

- **Reporting success on `git worktree add` alone.** It cannot fail for a missing `research/`.
  Step 4 is the actual gate.
- **Copying instead of linking**, then wondering why the disk filled up or why an `npm install`
  fixed one tree and not the other.
- **Branching off the current worktree's HEAD** instead of the intended base, silently inheriting
  another lane's in-flight commits.
- **Installing a VSIX from two trees** and concluding the extension is broken, when the other
  tree's build simply overwrote yours.
