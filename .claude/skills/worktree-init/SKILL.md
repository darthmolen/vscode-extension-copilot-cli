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
`SHARED_DIRS` in step 3 and to the table above.

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
    git worktree add "$DEST" "$BRANCH"                                   # local branch exists
elif git show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
    git worktree add --track -b "$BRANCH" "$DEST" "origin/$BRANCH"       # remote-only: track it
else
    git worktree add -b "$BRANCH" "$DEST" "$BASE"                        # genuinely new
fi
```

Branch off the **base ref**, not off whatever the current worktree happens to have checked out —
parallel lanes routinely sit on unrelated branches.

**The remote-only case is not an edge case.** Checking `refs/heads` alone would create a *new*
branch off `$BASE` that shares a name with an existing `origin/` branch, then silently diverge from
it — the push fails, or worse, succeeds after a force. This is the normal state after any
`gh pr merge --delete-branch`, and after cloning: at the time this skill was written, nine of this
repo's branches existed on `origin` with no local ref, including one merged the same day. Check
`refs/remotes/origin` before concluding a branch is new.

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

**The symlinks must be gitignored as symlinks, not as directories.** `.gitignore` entries written
with a trailing slash (`research/`) match a *directory* — a symlink pointing at one is a symlink, so
the pattern misses it and the links show up untracked, ready for the next `git add -A` to commit a
broken absolute path into the repo. This project's `.gitignore` lists them without the slash for
exactly that reason; keep it that way, and check `git status --short` is clean after linking.

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
git status --short                                           # must be clean — see the symlink note above
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

## What a symlinked worktree cannot do

**`npx vsce package` fails here.** Its **secret scanner** walks the tree and tries to read the
symlinked `research` / `node_modules` as files:

```text
ERROR  Error occurred while scanning secrets (files):
Error: EISDIR: illegal operation on a directory, read
errno: -21, code: 'EISDIR', syscall: 'read'
```

`.vscodeignore` does not save you: it excludes `research/**` and `node_modules/**`, which are globs
over a *directory's contents* and do not match a **symlink of that name** — the same trailing-slash
trap as the `.gitignore` note above, in a different file. Moving the links aside does not help
either, since `vsce` still needs `node_modules` present to resolve dependencies.

**This does not affect releases.** `release.yml` packages with `actions/checkout@v4` — a clean tree
with no symlinks — so the published VSIX is built correctly regardless.

What it means in practice: **do not try to complete a release's local packaging check from a
worktree.** Either run it from the primary checkout, or skip it and say plainly that you did. See
the `publish-release` skill, step 3.

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
- **Treating a remote-only branch as new** because only `refs/heads` was checked, producing a
  same-named branch that diverges from `origin/`.
- **Installing a VSIX from two trees** and concluding the extension is broken, when the other
  tree's build simply overwrote yours.
- **Trying to `vsce package` from a worktree** and reading the `EISDIR` as a repo problem. It is the
  symlinks; CI is unaffected.
