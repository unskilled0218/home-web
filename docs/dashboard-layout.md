# Arrange dashboard widgets

Open **Settings → General → Widget layout**. Select **Desktop** or **Mobile**, then choose **Custom**. Mobile applies up to and including 600px; either profile can be edited on any screen. Until you save a custom profile, the existing **Automatic** arrangement stays unchanged.

## Position and size

Choose a widget from **Select widget**, including one hidden behind another widget. Drag its labeled box in the preview to move it, or drag the upper-right corner to resize it. Use the labeled X, Y, width, and height fields for exact reference-pixel changes or keyboard editing. Reference pixels are CSS pixels on the fullscreen-oriented canvas, not physical display pixels or the fitted window size. The preview contains labels, not live links, device actions, or private content.

The origin is **bottom-left of the reference canvas**. X increases rightward; Y increases upward. X = 0 and Y = 0 place a widget against that canvas's lower-left corner. Increasing height grows the widget upward and normally preserves its bottom offset. Increasing Y lifts the entire widget. Bounds may adjust the offset when a larger widget would otherwise extend beyond the reference.

Each widget normally has a minimum size of 100 × 100 reference pixels and a maximum of the reference canvas. If the reference itself is smaller, the minimum temporarily fits that axis. The complete canvas, including text, padding, and controls, uniformly shrinks into the actual usable window without upscaling above 1. The fitted canvas stays bottom-left; unused space remains above or to its right when aspect ratios differ. Windowed widgets and control targets can be smaller than 100px, so enlarge the window or use fullscreen for readability. Card content scrolls internally. Zero reference/destination space hides the canvas and disables direct geometry editing safely.

On extremely small surfaces, decorative padding contracts independently on each axis so it cannot enlarge a widget beyond its rectangle. Ordinary widgets retain their normal spacing. Preview outlines do not add to the scaled rectangle size. A one-pixel rectangle preserves containment, not readable content; enlarge the window to use its contents.

Saved positions and sizes remain normalized proportions. Other browsers project them into their own screen-local reference and fit that whole canvas uniformly, so identical physical pixel sizes across screens are not promised. Resizing, rotating, entering fullscreen, and changing captions do not save or overwrite an arrangement. A minimum-clamped widget keeps its original saved size when moved; changing width or height explicitly is a separate operation. Existing font scales still apply inside widgets; the old Position option controls Automatic layout rather than custom positions.

## Fullscreen reference sizing

Before fullscreen entry, `screen.width` and `screen.height` estimate the display in CSS pixels; available-workspace dimensions and device pixel ratio are not used. Browsers do not guarantee the future fullscreen viewport beforehand. Invalid screen data falls back to the first valid layout viewport, held stable across ordinary resizes. Missing dimensions defer measurement. The first fullscreen entry confirms the reference using settled layout viewport dimensions and may correct the estimate once; exiting retains that confirmation. Confirmation is local memory, not a preference/cache write, so reload starts an estimate again.

Both profiles use the same raw screen context with margins of 16px for desktop and 8px for mobile. References always reserve their captured safe insets, a 32px status band plus an 8px gap, and a 48px caption band, even when empty. Actual tools, status wrapping, safe insets, and visible caption reduce the destination instead; they change fitting scale, not accepted reference geometry. This can leave unused space in fullscreen. Bookmark hiding does not change custom weather flex or forecast wrapping.

Settings freezes both accepted profile references before loading its draft. Display/orientation changes and fullscreen confirmation queue until Settings closes, so pixel controls and preview gestures keep one coordinate system. Closing applies the latest queued reference without saving. A changed reported screen size/orientation starts a new estimate; an ordinary window resize does not. Identical-sized monitors without distinguishing metadata may be indistinguishable; no additional screen permission is requested. Crossing 600px may intentionally select the other saved profile, whose arrangement can differ.

Existing version-2 records need no migration: bottom-left normalized coordinates and layers are unchanged. Their presentation now uses fullscreen reference projection rather than separate current-window axis scaling, so displayed pixels can change after upgrade. This does not rewrite saved layouts or their revisions. Reload older open pages to use the new editor pixel contract consistently.

## Overlap and layers

Widgets may overlap; moving one does not push another out of the way. Use **Bring forward**, **Send backward**, **Bring to front**, and **Send to back** to choose the visible order. Layer 6 is the front. The widget selector remains available even when a preview box is completely covered. Settings and page tools cannot be covered by widget layers. Existing visibility checkboxes and fullscreen bookmark hiding still apply without deleting a widget's saved geometry.

## Save, cancel, and reset

- **Save preferences** saves the arrangement together with other display preferences for all browsers. The live dashboard uses the last confirmed arrangement until that save succeeds.
- Escape during a drag cancels only that gesture. A canceled or zero-movement gesture does not change saved geometry.
- **Cancel layout edits** restores both layout profiles to the baseline loaded into the editor, leaving unrelated preference edits intact.
- **Reset selected layout** changes only that profile to Automatic. Save preferences to confirm the reset.
- Closing Settings discards unsaved edits. A failed save keeps the draft and does not present it as shared state.
- If another browser changed settings, the stale save reports a conflict. **Reload shared preferences** deliberately replaces preference/layout drafts with the newest server values before you reapply edits; integration credential drafts stay separate.

Reload already-open pages after upgrading to the expanded settings schema. Previous saved preferences and confirmed caches gain Automatic profiles without a database write on read. Version-1 custom layouts used a top origin; they decode once into version-2 bottom offsets (`newY = 1,000,000 - oldY - height`) without rewriting SQLite or changing the revision on read. This preserves normalized placement and layers; minimum-size clamping now keeps the bottom anchor. An older page cannot save top-origin coordinates against the new contract and must reload. Integration credentials, selections, backgrounds, and the retired home-widget settings record are not migrated or replaced.

[Back to dashboard](dashboard.md)
