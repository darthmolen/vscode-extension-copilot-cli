# Image/Attachment Support - v2.2.1 Implementation Plan

## Problem Statement

Complete the remaining features from v2.2.0 that were deferred to maintain release momentum. These are polish and enhancement features that build on the solid foundation delivered in v2.2.0.

## What's Already Working (from v2.2.0)

✅ Users can attach images via file picker  
✅ Attachments validated (size, count, type)  
✅ Vision-capable models receive images  
✅ Non-vision models show error messages  
✅ Session remains stable after errors  
✅ E2E test validates critical path  

## Scope (v2.2.1)

Focus on UX polish and completing deferred features:
- **Tool-returned images**: Display images returned by AI/tools
- **History persistence**: Show attachment placeholders in history
- **Button disable**: Disable attach button for non-vision models
- **Plan mode**: Test attachments in plan mode
- **Documentation**: Update README and CHANGELOG

Future versions:
- v2.2.2: Clipboard paste support
- v2.2.3: Drag-and-drop support

## Workplan

### Phase 7: Frontend - Tool-Returned Image Display
**Goal**: Display images that AI/tools return in their responses

- [ ] **Detect image data** in tool results:
  - [ ] Check for base64 image data in tool outputs
  - [ ] Check for image URLs in tool outputs
  - [ ] Parse attachment metadata from SDK events
- [ ] **Render thumbnails** in tool output section:
  - [ ] Add image display to tool execution UI
  - [ ] Thumbnail max size (200px width)
  - [ ] Consistent styling with user attachments
- [ ] **Download functionality**:
  - [ ] Add download button below each image
  - [ ] Generate blob URL for base64 data
  - [ ] Handle URL-based images
- [ ] **Assistant message images**:
  - [ ] Detect images in assistant.message events
  - [ ] Render inline with text content
  - [ ] Same thumbnail + download pattern

**Success Criteria**:
- ✅ Tool returns image → thumbnail displays
- ✅ Click download → saves file locally
- ✅ Consistent styling with user attachments

### Phase 8: Frontend - History & Persistence
**Goal**: Show attachment metadata when resuming sessions

- [ ] **Attachment placeholders**:
  - [ ] Detect attachments in events.jsonl
  - [ ] Show "📎 N attachments" for historical messages
  - [ ] Style placeholder to match message aesthetics
  - [ ] No attempt to restore actual images (v2.2.1)
- [ ] **Session switching**:
  - [ ] Test attachment state when switching sessions
  - [ ] Verify events.jsonl preserves attachment metadata
  - [ ] Clear pending attachments when switching
- [ ] **Message history rendering**:
  - [ ] Parse attachment count from events
  - [ ] Display count badge on historical messages
  - [ ] Tooltip shows attachment names

**Success Criteria**:
- ✅ Resume session → see "📎 3 attachments"
- ✅ Switch sessions → pending attachments cleared
- ✅ Historical messages show attachment indicators

### Phase 9: UI Enhancement - Disable Button for Non-Vision Models
**Goal**: Prevent confusion by disabling attach button when model lacks vision

- [ ] **Backend: Send vision status to webview**:
  - [ ] Add `visionSupport` field to session status messages
  - [ ] Update on model change (if supported)
  - [ ] Send on session start
- [ ] **Frontend: Update button state**:
  - [ ] Listen for vision support status
  - [ ] Disable/enable button based on status
  - [ ] Update button styles for disabled state
- [ ] **Tooltip implementation**:
  - [ ] Show tooltip when button disabled
  - [ ] Message: "Current model doesn't support image attachments"
  - [ ] Clear tooltip when button enabled
- [ ] **Testing**:
  - [ ] Manual test with gpt-3.5-turbo (no vision)
  - [ ] Manual test with gpt-4o (has vision)
  - [ ] Test model switching (if supported)

**Success Criteria**:
- ✅ gpt-3.5-turbo → button disabled with tooltip
- ✅ gpt-4o → button enabled
- ✅ No way to click disabled button

### Phase 10: Plan Mode Integration
**Goal**: Verify attachments work in plan mode (should already work)

- [ ] **Enable attachments in plan mode**:
  - [ ] Verify file picker works in plan sessions
  - [ ] Test "analyze this diagram" workflow
  - [ ] Ensure no security concerns with image reading
- [ ] **Plan mode UI**:
  - [ ] Same attachment UI as work mode
  - [ ] Clear messaging that images are analysis aids
  - [ ] Button state respects vision support
- [ ] **Integration test**:
  - [ ] Create test for plan mode + attachments
  - [ ] Verify images sent to plan session
  - [ ] Verify plan.md updated appropriately

**Success Criteria**:
- ✅ Plan mode accepts image attachments
- ✅ AI can analyze diagrams in plan mode
- ✅ No security issues

### Phase 11: Testing & Validation
**Goal**: Comprehensive test coverage for all attachment scenarios

- [ ] **Integration tests**:
  - [ ] Size limit test (send 10MB image → error)
  - [ ] Count limit test (send 20 images → error)
  - [ ] Type validation test (send .pdf → error)
  - [ ] Tool-returned image test (verify display)
  - [ ] History persistence test (verify placeholders)
- [ ] **Manual testing checklist**:
  - [ ] Send single image
  - [ ] Send multiple images (up to 10)
  - [ ] Send image over size limit
  - [ ] Send too many images
  - [ ] Receive image from tool (download works)
  - [ ] Switch sessions with pending attachments
  - [ ] Resume session with historical attachments
  - [ ] Plan mode: analyze diagram
  - [ ] Model without vision: button disabled + tooltip
- [ ] **Model capabilities test**:
  - [ ] GPT-4o (vision): button enabled
  - [ ] gpt-3.5-turbo (no vision): button disabled
  - [ ] Verify detection across all models
- [ ] **Custom tool for testing**:
  - [ ] Create test tool that returns images
  - [ ] Verify thumbnail + download button rendering
  - [ ] Test base64 and URL formats
- [ ] **Regression testing**:
  - [ ] Run full test suite
  - [ ] Verify no existing tests broken
  - [ ] Check plan mode tests still pass

**Success Criteria**:
- ✅ All integration tests passing
- ✅ Manual test checklist 100% complete
- ✅ No regressions

### Phase 12: Documentation & Release
**Goal**: Update documentation and prepare for release

- [ ] **Update README.md**:
  - [ ] Add v2.2.1 section with new features
  - [ ] Document attachment workflow
  - [ ] Screenshot of attach button (optional)
  - [ ] Note limitations (no drag-drop/paste yet)
- [ ] **Update CHANGELOG.md**:
  - [ ] Add ## [2.2.1] section
  - [ ] List new features:
    - Tool-returned image display
    - Attachment history placeholders
    - Disabled button for non-vision models
    - Plan mode attachment support
  - [ ] List bug fixes (if any)
  - [ ] Note future plans (v2.2.2, v2.2.3)
- [ ] **Version management**:
  - [ ] Run `npm version minor` (2.2.0 → 2.2.1)
  - [ ] Verify package.json updated
  - [ ] Build and test: `./test-extension.sh`
- [ ] **Git workflow**:
  - [ ] Commit: `git commit -m "v2.2.1: Attachment feature polish"`
  - [ ] Tag: `git tag v2.2.1`
  - [ ] Push: `git push && git push --tags`
- [ ] **Release notes**:
  - [ ] Create RELEASE-NOTES-2.2.1.md
  - [ ] Highlight UX improvements
  - [ ] Note what's still coming (v2.2.2, v2.2.3)

**Success Criteria**:
- ✅ README and CHANGELOG updated
- ✅ Version bumped correctly
- ✅ All tests passing
- ✅ Git tagged and pushed

## Technical Considerations

### Tool-Returned Images
**Questions**:
- How does SDK return images in tool results?
- Base64 in result string or separate attachment metadata?
- Need to test with actual tool that returns images

**Research needed**: Create test tool or use existing tool (screenshot, diagram generator)

### History Persistence
**Approach**:
- Parse events.jsonl for attachment metadata
- Don't attempt to restore actual image files
- Show count only: "📎 3 attachments"
- Future: Consider thumbnail caching

### Button State Management
**Implementation**:
```typescript
// Backend (extension.ts)
cliManager.onMessage((message) => {
    if (message.type === 'modelChanged') {
        const visionSupport = await cliManager.supportsVision();
        ChatPanelProvider.postMessage({
            type: 'visionSupport',
            supported: visionSupport
        });
    }
});

// Frontend (webview)
window.addEventListener('message', event => {
    if (event.data.type === 'visionSupport') {
        attachButton.disabled = !event.data.supported;
        attachButton.title = event.data.supported 
            ? 'Attach images'
            : 'Current model doesn\'t support image attachments';
    }
});
```

## Future Enhancements (Post-2.2.1)

- **v2.2.2**: Clipboard paste support
  - Paste images directly into input
  - Ctrl+V to attach from clipboard
  
- **v2.2.3**: Drag-and-drop support
  - Drag images from file explorer
  - Drop zone highlighting
  
- **v2.3.x**: PDF attachments (if model supports)
  - Extend to non-image formats
  - Document analysis
  
- **v2.3.x**: Full-size image modal/lightbox
  - Click thumbnail → full-size view
  - Gallery navigation
  
- **v2.4.x**: Thumbnail caching for history
  - Cache thumbnails on disk
  - Restore in session resume

## Success Criteria (v2.2.1)

✅ Tool-returned images display with download button  
✅ Historical messages show "📎 N attachments"  
✅ Attachment button disabled for non-vision models  
✅ Clear tooltip explains why button disabled  
✅ Plan mode fully supports attachments  
✅ All integration tests passing  
✅ Documentation updated  
✅ No regressions  

## Metrics Target

- **Test Coverage**: Add 5+ integration tests
- **User Experience**: Reduce confusion (disabled button vs error after selection)
- **Feature Completeness**: 90% of original vision (defer drag-drop/paste)
- **Code Quality**: Maintain test-driven approach

## Timeline Estimate

- Phase 7: 2-3 hours (tool image display)
- Phase 8: 1-2 hours (history placeholders)
- Phase 9: 1 hour (button disable)
- Phase 10: 1 hour (plan mode testing)
- Phase 11: 2-3 hours (comprehensive testing)
- Phase 12: 1 hour (documentation)

**Total**: 8-11 hours of focused work

## Notes

- **Philosophy**: Ship incrementally - v2.2.0 provided core functionality, v2.2.1 adds polish
- **Testing Priority**: Focus on integration tests over unit tests (core logic already tested)
- **User Education**: Clear tooltips and error messages prevent confusion
- **Logging**: Maintain comprehensive logging for debugging
