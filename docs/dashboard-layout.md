# Arrange dashboard widgets

## Table of Contents

- [Enter editing](#enter-editing)
- [Position and size](#position-and-size)
- [Fullscreen reference sizing](#fullscreen-reference-sizing)
- [Overlap and profiles](#overlap-and-profiles)
- [Save, cancel, and recovery](#save-cancel-and-recovery)
- [Stored layouts](#stored-layouts)

## Enter editing

Hold a visible widget's non-interactive background for 600ms, or choose **Edit layout** with mouse or keyboard. Long press selects that widget; button entry selects Time. Moving at least 8 screen pixels, releasing early, scrolling, a second pointer, hiding the page, or changing windows cancels the hold. Links, buttons, inputs, editable content, and other interactive descendants keep their ordinary behavior. Existing text selections are not taken over. Browser touch callouts vary; use Edit layout if your browser intercepts a hold.

Editing happens directly on the dashboard at its normal fitted size. **Save**, **Toolbar**, and **Cancel** stay at the top right. Detailed controls start closed; Toolbar opens an overlay with profile/widget selectors, geometry, layers, and recovery controls. Neither entry nor opening/closing the panel shrinks the canvas to make room for chrome. Automatic entry still uses its temporary template, and actual viewport/reference/profile changes can legitimately refit the dashboard.

Real widgets remain inert whether the panel is open or closed: bookmarks cannot navigate and device actions cannot run by pointer or keyboard. An already pending Wake may finish normally. Editing frames contain only labels, move/resize handles, and layer buttons, never copied actions or private content. Settings and direct editing cannot overlap; Save or Cancel before opening Settings. No layout editor remains in Settings.

An **Automatic** profile shows a temporary deterministic editing template. Entry, selection, a no-op gesture, or no-op Save does not turn it into Custom. Moving/resizing or changing layers creates a local Custom draft only if geometry/order actually changes. Explicitly selecting **Custom** also creates a draft. The live dashboard previews unsaved changes locally; other browsers do not see them until a successful Save.

## Position and size

The current direct gestures are unchanged: drag a labeled frame to move it, or the selected frame's upper-right Resize handle to resize. These work with the panel closed. Open **Toolbar** to choose a covered/hidden widget or use labeled numeric X, Y, width, and height fields. Tab and numeric arrow keys support keyboard editing; Enter submits Save layout, not unrelated preferences. Invalid Save opens the panel and focuses the relevant field.

**Close toolbar**, the Toolbar toggle, or Escape closes the panel without discarding or committing raw numeric entries. Reopening retains values and selection. Escape during a drag cancels only that gesture first; otherwise it closes an open panel, not the edit session. Pure panel toggles do not cancel capture or change its fit. Lost capture, window blur, page hiding, fullscreen/viewport changes, or changed fitting still cancel the active gesture without discarding earlier completed edits. The overlay can cover some cards; close it to use those handles or use its selectors/numeric controls.

The origin is **bottom-left of the reference canvas**. X increases rightward; Y increases upward. X = 0 and Y = 0 place the widget against its lower-left corner. Height grows upward while normally retaining the bottom offset. Bounds can adjust offsets when enlarging a widget would exceed the reference. Reference pixels are CSS pixels on the fullscreen-oriented canvas, not physical display pixels or fitted-window pixels.

Widgets normally have a minimum of 100 × 100 reference pixels. A smaller reference temporarily bounds that axis's minimum. The canvas uses the full viewport inside device safe areas, with no reserved band for buttons, status, captions, or decorative margins. Widgets may move underneath these overlays. Save/Toolbar/Cancel stay fixed above both live widgets and editing frames; release the drag and click Save normally.

The entire canvas, including text and padding, still shrinks uniformly without upscaling above 1. Different window/reference aspect ratios can leave unused space above or right; fullscreen confirmation matches its reference to the actual fullscreen viewport, allowing widgets to reach its safe top edge. Card content scrolls internally outside editing. Small windows may make cards smaller than 100 screen pixels; enlarge the window or use fullscreen for readability. Tiny editing frames disable pointer handles in favor of numeric controls. Zero destination/reference space hides frames/content and disables geometry while keeping exit controls available where viewport space permits.

Decorative padding contracts independently per axis so it cannot enlarge tiny widgets. Frame outlines add no size to the canonical rectangle. Saved proportions, not fitted pixels, remain authoritative; a minimum-clamped move does not rewrite a widget's saved width or height. Existing font preferences still apply. Settings Position controls Automatic flow, not Custom coordinates.

## Fullscreen reference sizing

Before fullscreen entry, `screen.width` and `screen.height` estimate the display in CSS pixels; available workspace and device pixel ratio are not used. Invalid screen data falls back to the first valid layout viewport. The first settled fullscreen entry confirms the reference once; exiting retains it. Reload begins another local estimate. No reference confirmation writes preferences or cache.

Both profiles share the raw screen context and subtract only captured device safe insets. There are no fixed status/caption reservations or desktop/mobile canvas margins. The destination uses the actual visual viewport and current safe insets; tools, status messages, captions, and editing controls are overlays, not layout boundaries. The panel scrolls internally on short screens while compact Save/Toolbar/Cancel remain separate and above all widget layers. **Edit layout** is hidden in fullscreen, including background-only pages. Long press can still enter editing on a visible widget; keyboard users can enter editing before fullscreen. The details panel retains its fullscreen toggle. Other page tools retain immersive hiding unless all dashboard sections are hidden.

Direct editing freezes both profile references until exit. Screen/orientation changes and fullscreen confirmation queue behind that lock. Exiting applies the latest queued reference without saving. Settings no longer owns this lock. Ordinary window resizing never rebases reference dimensions. Identical-sized monitors may be indistinguishable without metadata; no extra screen permission is requested. Fullscreen bookmark hiding does not alter Custom weather wrapping or flex.

## Overlap and profiles

Widgets can overlap without moving neighbors. Each widget has **Up** and **Down** buttons: Up raises it one layer, Down lowers it one layer. Up is disabled at the front; Down at the back. These change ordering only, not position or size, and require Save to publish. Layer 6 is front. Compact pairs appear inside sufficiently large frames; tiny/covered/hidden widgets remain reachable through six individually labeled rows in Toolbar. The existing selected-widget **Bring forward**, **Send backward**, **Bring to front**, and **Send to back** controls remain available. All variants share the same canonical ordering. Unscaled editing chrome stays above widget layers.

Mobile applies up to and including 600px. Entry selects the actual viewport profile, then pins it until you change the selector, even across viewport breakpoints. Both profiles can be edited on any screen; inactive-profile status is explicit. Geometry selection does not enable hidden content or provider requests. Hidden widgets have labeled placeholders; confirmed visibility, content selections, and font preferences remain independent.

## Save, cancel, and recovery

- **Save layout** persists a changed canonical layout to the captured settings scope: the browser-local record in Local, or the shared SQLite preference transaction in Global. Complete entry preferences, source identity, and revision are retained. No-op Save exits without a write. No autosave occurs on entry, gestures, resizing, fullscreen, or exit.
- While a write is pending, editing, Save, Cancel, Toolbar/Close, Reload, and competing entry are disabled until it settles. Saving and failure/offline/conflict feedback stay visible even with details closed. An uncertain request cannot safely be treated as uncommitted merely because a client aborted it.
- A successful Save exits. A failed or stale save retains the local draft and action blocking. Remote polls do not reset raw numeric input, cancel held gestures, or silently advance the captured revision.
- **Cancel** discards both local profile drafts and restores the latest confirmed layout, including updates accepted from other browsers during editing. Focus returns to the original visible focusable entry/target, otherwise Edit layout. Non-focusable widget anchors are removed immediately; focus uses Edit layout because engines can drop focus after anchor removal.
- **Reset selected profile**, or selecting Automatic, changes only that draft profile to Automatic. Save to publish the reset.
- **Reload local/shared layout (discard edits)** discards both profile drafts/raw inputs and adopts the current source baseline. A mode change in another tab blocks old-source Save until reload/discard. It does not publish anything. Reapply changes explicitly rather than merging unrelated preferences.
- Local layouts can save without a server when browser storage is writable. Global offline caches cannot supply a writable server revision; explicit Reload after confirmation is required before saving. Background confirmation never rebases a draft.
- Unsaved changed drafts use the browser's supported unload warning. Persisted-page suspension retains completed local edits and blocking; it never autosaves. Browser/OS navigation policies cannot guarantee recovery after closing a tab.

Unrelated Settings saves retain the complete layout from their own matching baseline and revision. Dirty Settings sessions conflict rather than overwriting newer layouts. Integration credential drafts and providers remain separately owned.

## Stored layouts

Version-2 bottom-left normalized records and layer order remain unchanged; no schema or read-time rewrite is needed. Removing reserved bands expands the projected canvas, so existing normalized layouts can display larger or closer to the edges without a preference write. Reload already-open pages to adopt the new canvas dimensions. Old records/caches without layout gain Automatic profiles. Version-1 top-origin coordinates decode as `newY = 1,000,000 - oldY - height` without changing SQLite revisions on read. Retained legacy home-widget settings, integration credentials, backgrounds, and content selections are not replaced.

[Back to dashboard](dashboard.md)
