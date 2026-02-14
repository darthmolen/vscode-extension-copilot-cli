# Sidebar View Refactor: Enable Secondary Sidebar Support

**Status:** Backlog  
**Priority:** High  
**Effort:** Medium (3-5 days)  
**Version Target:** 2.3.0 or 3.0  
**Created:** 2026-02-08

## Problem Statement

Our extension currently uses a **WebviewPanel** (`vscode.window.createWebviewPanel`) which creates an editor tab. This prevents users from dragging our chat interface into the **Secondary Sidebar** (auxiliary bar) where AI tools like Claude Code and GitHub Copilot naturally belong.

**User Pain Point:**
- Chat panel opens as an editor tab, competing with code files
- Cannot be moved to the secondary sidebar (designed for AI interfaces)
- Feels less native compared to other AI assistant extensions

**Current Architecture:**
```typescript
// chatViewProvider.ts:35
ChatPanelProvider.panel = vscode.window.createWebviewPanel(
  'copilotCLIChat',
  'Copilot CLI',
  vscode.ViewColumn.Two,  // Opens in editor area
  { enableScripts: true, ... }
);
```

## Discovery: How Claude Code Does It

Claude Code and other sidebar-based extensions don't use billions of dollars—they use the **correct API**!

They use:
- ✅ `vscode.window.registerWebviewViewProvider()` - Creates sidebar views
- ❌ NOT `vscode.window.createWebviewPanel()` - Creates editor tabs

**Key Insight:** WebviewPanel vs WebviewViewProvider

| Feature | WebviewPanel (Current) | WebviewViewProvider (Target) |
|---------|------------------------|------------------------------|
| Location | Editor area (tabs) | Sidebar/Panel areas |
| Draggable to secondary sidebar | ❌ No | ✅ Yes |
| Use case | Document-like interfaces | Tool windows, sidebars |
| Lifecycle | Created on command | Created when view shown |
| Native feel | Medium | High |

## Proposed Solution

Refactor our extension from **WebviewPanel** architecture to **WebviewViewProvider** architecture.

### Architecture Changes

**1. package.json Contributions**

Add viewsContainers and views:

```json
{
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        {
          "id": "copilot-cli-sidebar",
          "title": "Copilot CLI",
          "icon": "images/sidebar-icon.svg"
        }
      ]
    },
    "views": {
      "copilot-cli-sidebar": [
        {
          "type": "webview",
          "id": "copilot-cli.chatView",
          "name": "Chat",
          "icon": "$(comment-discussion)",
          "contextualTitle": "Copilot CLI"
        }
      ]
    }
  }
}
```

**2. Code Refactoring**

Create new `ChatViewProvider` implementing `vscode.WebviewViewProvider`:

```typescript
// chatViewProvider.ts (refactored)
export class ChatViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private extensionUri: vscode.Uri;
  
  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }
  
  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken
  ) {
    this.view = webviewView;
    
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };
    
    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
    
    // Setup message handlers (same as current implementation)
    this.setupMessageHandlers(webviewView.webview);
  }
  
  // Migrate existing methods...
}
```

**3. Registration in extension.ts**

```typescript
// extension.ts
const chatProvider = new ChatViewProvider(context.extensionUri);
context.subscriptions.push(
  vscode.window.registerWebviewViewProvider(
    'copilot-cli.chatView',
    chatProvider
  )
);
```

## Implementation Plan

### Phase 1: Research & Prototyping

- [ ] Study VS Code WebviewViewProvider API documentation
- [ ] Review example implementations (GitHub Copilot, Claude Code architecture)
- [ ] Create proof-of-concept in separate branch
- [ ] Test basic webview rendering in sidebar

### Phase 2: Core Refactoring

- [ ] Create new `ChatViewProvider` class implementing `WebviewViewProvider`
- [ ] Migrate HTML/CSS/JavaScript from current panel implementation
- [ ] Update message passing handlers (mostly unchanged)
- [ ] Migrate state management (backendState integration)
- [ ] Handle view lifecycle events (onDidChangeVisibility, onDidDispose)

### Phase 3: package.json Configuration

- [ ] Add viewsContainers contribution (activity bar icon)
- [ ] Add views contribution (chat view definition)
- [ ] Create/update sidebar icon asset
- [ ] Update command contributions if needed

### Phase 4: Integration & Testing

- [ ] Update all commands to work with sidebar view
- [ ] Update `openChat` command to reveal sidebar view
- [ ] Test session management across view hide/show
- [ ] Test all existing features:
  - [ ] Message sending/receiving
  - [ ] Tool execution visualization
  - [ ] Plan mode toggle
  - [ ] Session switching
  - [ ] Attachment handling
  - [ ] Markdown rendering
- [ ] **Critical test:** Verify drag to secondary sidebar works!

### Phase 5: Migration Strategy

- [ ] Decide: Clean migration or support both?
- [ ] Add configuration option to choose panel vs. sidebar (optional)
- [ ] Update documentation
- [ ] Create migration guide for existing users

### Phase 6: Documentation & Release

- [ ] Update README with sidebar feature
- [ ] Add screenshots showing secondary sidebar usage
- [ ] Create release notes
- [ ] Update user guide
- [ ] Celebrate! 🎉

## Technical Considerations

### State Management

- BackendState must persist across view visibility changes
- WebviewViewProvider uses `retainContextWhenHidden` automatically
- Test that sessions survive view being hidden/shown

### UI/UX Implications

- Sidebar views have different sizing constraints than panels
- May need CSS adjustments for narrower width
- Consider responsive design for various sidebar widths
- Test resize behavior

### Command Behavior

- `openChat` should reveal the sidebar view
- Consider adding command to toggle sidebar visibility
- Update keyboard shortcuts if needed

### Backward Compatibility

- Should we deprecate panel mode or keep both?
- Option 1: Clean cut (sidebar only)
- Option 2: Configuration setting to choose
- Recommendation: **Clean cut** - sidebar is objectively better

## Benefits

### For Users

- ✅ **Native sidebar experience** like Claude Code, GitHub Copilot
- ✅ **Draggable to secondary sidebar** - proper AI tool real estate!
- ✅ **Less intrusive** - doesn't compete with editor tabs
- ✅ **Better workspace layout** - dedicated AI assistant area
- ✅ **Persistent visibility** - can stay open while working

### For Development

- ✅ **Aligns with VS Code best practices** for AI tools
- ✅ **Better UX paradigm** for chat-based interfaces
- ✅ **Future-proof** - follows platform conventions
- ✅ **Easier to discover** - activity bar icon

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing user workflows | Medium | Clear migration guide, announce in release notes |
| UI sizing issues in narrow sidebar | Low | Responsive CSS, test various widths |
| State management bugs on view lifecycle | Medium | Comprehensive testing, leverage existing backendState |
| Users miss the old panel mode | Low | Panel mode had no advantages over sidebar |
| Development time estimation | Medium | Start with prototype, iterate incrementally |

## Success Criteria

- [ ] Extension appears in VS Code activity bar with custom icon
- [ ] Chat view opens in primary sidebar by default
- [ ] **Users can drag chat view to secondary sidebar** ✨
- [ ] All existing features work identically
- [ ] No regressions in session management
- [ ] Passes all existing tests
- [ ] UI looks good at various sidebar widths
- [ ] Documentation updated
- [ ] At least 3 users confirm they love the new sidebar! 😄

## References

### VS Code API Documentation
- [WebviewViewProvider API](https://code.visualstudio.com/api/references/vscode-api#WebviewViewProvider)
- [Sidebars UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/sidebars)
- [Views API](https://code.visualstudio.com/api/ux-guidelines/views)
- [Custom Layout Guide](https://code.visualstudio.com/docs/configure/custom-layout)

### GitHub Issues
- [Allow extensions to contribute to secondary sidebar #251757](https://github.com/microsoft/vscode/issues/251757)
- [Allow extensions to contribute views to secondary sidebar #198087](https://github.com/microsoft/vscode/issues/198087)

### Example Implementations
- GitHub Copilot extension (sidebar view)
- Claude Code extension (secondary sidebar)
- VS Code extension samples: [webview-view-sample](https://github.com/microsoft/vscode-extension-samples/tree/main/webview-view-sample)

## Notes

- This refactor aligns with our goal of making Copilot CLI feel like a first-class VS Code AI assistant
- Secondary sidebar support was introduced in VS Code 1.64 (Feb 2022) - well-established feature
- **Your 60 users absolutely deserve this real estate!** 🚀
- No need for billions of dollars - just the right API choice!

## Next Steps

1. Review and prioritize this backlog item
2. Assign to version milestone (suggest 2.3.0)
3. Create feature branch: `feature/sidebar-view-refactor`
4. Begin Phase 1: Research & Prototyping
