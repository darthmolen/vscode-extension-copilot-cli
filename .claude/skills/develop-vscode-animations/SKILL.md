---
name: develop-vscode-animations
description: Use when developing, testing, or iterating on CSS animations for the VS Code webview sidebar - provides test panel workflow, animation patterns, and gotchas for emoji/text animations in both light and dark themes
---

# Developing VS Code Webview Animations

## Overview

Iterating on CSS animations inside a VS Code sidebar webview is painful — small fonts, no hot reload, theme-dependent rendering. This skill uses disposable test panels (full editor tabs) to preview animations at large scale in forced light/dark themes.

## When to Use

- Adding or modifying CSS animations in the webview (thinking indicators, loading states, transitions)
- Debugging animation jerkiness, flickering, or theme-dependent rendering issues
- Need to compare animation behavior across light and dark themes side by side

## Test Panel Workflow

The project includes `src/animationTestPanel.ts` — a factory that creates `vscode.WebviewPanel` tabs with inline HTML/CSS. Two commands are registered:

- `Copilot CLI: Animation Test (Light)` — white background, dark text
- `Copilot CLI: Animation Test (Dark)` — `#1e1e1e` background, light text

**Usage:** Open command palette (`Ctrl+Shift+P`) and run either command. Both panels can be open side-by-side.

**Workflow:**
1. Edit `src/animationTestPanel.ts` with the animation you want to test
2. Include both a large-scale preview (48px+) and an actual-size preview (12px)
3. Run `./test-extension.sh` to build and install the updated extension, then reload the VS Code window (Command Palette → "Developer: Reload Window")
4. Open both light and dark panels to compare

The panels are self-contained — all CSS is inline, no dependency on `styles.css`. This lets you tweak animations in isolation before porting to production CSS.

## Animation Patterns That Work

### Smooth text fade (thinking indicator)

```css
@keyframes thinking-pulse {
    0%, 100% { opacity: 1; color: var(--vscode-foreground); }
    50% { opacity: 0.5; color: var(--vscode-descriptionForeground); }
}
.thinking-text { animation: thinking-pulse 3s ease-in-out infinite; }
```

### Rainbow emoji (hue rotation)

```css
@keyframes rainbow-cycle {
    0%   { filter: hue-rotate(0deg) saturate(2); }
    100% { filter: hue-rotate(360deg) saturate(2); }
}
.brain-icon { animation: rainbow-cycle 3s linear infinite alternate; }
```

`alternate` direction makes the hue ping-pong smoothly instead of snapping back to start.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Animating `font-weight` | Causes layout shift/jerkiness. Use only `opacity` and `color` for text pulse. |
| Opacity range too wide (1.0 to 0.0) | Text disappears. Use 1.0 to 0.5 for subtle pulse. |
| Animation too fast (< 2s) | Feels frantic. 3s with `ease-in-out` reads as calm/thoughtful. |
| `infinite` without `alternate` on hue-rotate | Hue snaps from 360 back to 0. Use `alternate` for smooth bounce. |
| Testing only in dark theme | Light theme renders emoji filters differently. Always test both. |
| Using `var(--vscode-*)` in test panels | Test panels don't have VS Code theme vars. Use hardcoded colors matching light (`#1e1e1e`) and dark (`#d4d4d4`). |

## Input Area Card Styling

The input area (`#input-mount`) uses an always-on card look:

```css
#input-mount {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 10px;
    margin: 0 6px 6px 6px;
    padding: 0 3px 3px 3px;
    overflow: hidden;
}
```

- `overflow: hidden` ensures child backgrounds respect `border-radius`
- `margin-bottom: 6px` separates from VS Code toolbar
- Plan mode swaps to `border: 2px solid var(--vscode-focusBorder)`
- The actual children inside `#input-mount` are `.input-controls` (grid with file row, model selector, metrics) and `.input-area` (textarea + send button)
