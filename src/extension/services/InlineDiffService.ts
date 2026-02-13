export interface DiffLine {
    type: 'add' | 'remove' | 'context';
    text: string;
}

export interface InlineDiff {
    lines: DiffLine[];
    truncated: boolean;
    totalLines: number;
}

/**
 * Split content into lines. An empty string yields an empty array.
 * A trailing newline does NOT produce an extra empty-string element.
 */
function splitLines(content: string): string[] {
    if (content === '') {
        return [];
    }
    // Remove a single trailing newline to avoid a phantom empty line
    const trimmed = content.endsWith('\n') ? content.slice(0, -1) : content;
    return trimmed.split('\n');
}

/**
 * Classic DP-based Longest Common Subsequence returning the list of
 * matching index pairs (i from `a`, j from `b`).
 */
function lcs(a: string[], b: string[]): Array<[number, number]> {
    const m = a.length;
    const n = b.length;

    // Build the DP table
    const dp: number[][] = [];
    for (let i = 0; i <= m; i++) {
        dp[i] = new Array(n + 1).fill(0);
    }
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (a[i - 1] === b[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    // Backtrack to recover the matching pairs
    const result: Array<[number, number]> = [];
    let i = m;
    let j = n;
    while (i > 0 && j > 0) {
        if (a[i - 1] === b[j - 1]) {
            result.push([i - 1, j - 1]);
            i--;
            j--;
        } else if (dp[i - 1][j] >= dp[i][j - 1]) {
            i--;
        } else {
            j--;
        }
    }
    result.reverse();
    return result;
}

/**
 * Compute an inline diff between two strings with context lines and truncation.
 *
 * @param beforeContent - The original content
 * @param afterContent  - The modified content
 * @param maxLines      - Maximum number of diff lines to return (default 10)
 */
export function computeInlineDiff(
    beforeContent: string,
    afterContent: string,
    maxLines: number = 10
): InlineDiff {
    const beforeLines = splitLines(beforeContent);
    const afterLines = splitLines(afterContent);

    // Compute LCS to determine equal/remove/add operations
    const matches = lcs(beforeLines, afterLines);

    // Build a raw diff (without context filtering) as operations:
    // 'equal', 'remove', 'add' with their text and original indices.
    interface RawLine {
        op: 'equal' | 'remove' | 'add';
        text: string;
    }

    const rawDiff: RawLine[] = [];
    let bi = 0; // index into beforeLines
    let ai = 0; // index into afterLines

    for (const [mi, mj] of matches) {
        // Everything in before[bi..mi-1] is removed
        while (bi < mi) {
            rawDiff.push({ op: 'remove', text: beforeLines[bi] });
            bi++;
        }
        // Everything in after[ai..mj-1] is added
        while (ai < mj) {
            rawDiff.push({ op: 'add', text: afterLines[ai] });
            ai++;
        }
        // The matched line is equal
        rawDiff.push({ op: 'equal', text: beforeLines[bi] });
        bi++;
        ai++;
    }
    // Remaining lines after last match
    while (bi < beforeLines.length) {
        rawDiff.push({ op: 'remove', text: beforeLines[bi] });
        bi++;
    }
    while (ai < afterLines.length) {
        rawDiff.push({ op: 'add', text: afterLines[ai] });
        ai++;
    }

    // Now determine which lines to include: all changed lines plus
    // 1 line of context (equal lines) before and after each change hunk.
    const includeSet = new Set<number>();

    for (let idx = 0; idx < rawDiff.length; idx++) {
        if (rawDiff[idx].op !== 'equal') {
            includeSet.add(idx);
            // 1-line context before
            for (let c = idx - 1; c >= 0 && c >= idx - 1; c--) {
                if (rawDiff[c].op === 'equal') {
                    includeSet.add(c);
                    break;
                }
            }
            // 1-line context after
            for (let c = idx + 1; c < rawDiff.length && c <= idx + 1; c++) {
                if (rawDiff[c].op === 'equal') {
                    includeSet.add(c);
                    break;
                }
            }
        }
    }

    // Build the filtered diff lines in order
    const allDiffLines: DiffLine[] = [];
    for (let idx = 0; idx < rawDiff.length; idx++) {
        if (includeSet.has(idx)) {
            const entry = rawDiff[idx];
            const type: DiffLine['type'] = entry.op === 'equal' ? 'context' : entry.op;
            allDiffLines.push({ type, text: entry.text });
        }
    }

    const totalLines = allDiffLines.length;
    const truncated = totalLines > maxLines;
    const lines = truncated ? allDiffLines.slice(0, maxLines) : allDiffLines;

    return { lines, truncated, totalLines };
}
