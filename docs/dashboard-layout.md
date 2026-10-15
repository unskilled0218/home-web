# Arrange dashboard widgets

Open **Settings → General → Widget layout**. Select **Desktop** or **Mobile**, then choose **Custom**. Mobile applies up to and including 600px; either profile can be edited on any screen. Until you save a custom profile, the existing **Automatic** arrangement stays unchanged.

## Position and size

Choose a widget from **Select widget**, including one hidden behind another widget. Drag its labeled box in the preview to move it, or drag the lower-right corner to resize it. Use the labeled X, Y, width, and height fields for exact pixel changes or keyboard editing. The preview contains labels, not live links, device actions, or private content.

Each widget normally has a minimum displayed size of 100 × 100 pixels. The maximum is the usable current window, excluding page tools, status, safe-area margins, and a filename strip when shown. If that area is smaller than 100 pixels, widgets temporarily fit the available space. When no space is available, enlarge the window before editing. Small widgets scroll internally so their content and actions remain reachable.

Saved positions and sizes are proportional to the usable window. Other browsers fit the same arrangement to their own windows. Resizing, rotating, entering fullscreen, and changing captions do not save or overwrite an arrangement. A minimum-clamped widget keeps its original saved size when moved; changing width or height explicitly is a separate operation. Existing font scales still apply inside widgets; the old Position option controls Automatic layout rather than custom positions.

## Overlap and layers

Widgets may overlap; moving one does not push another out of the way. Use **Bring forward**, **Send backward**, **Bring to front**, and **Send to back** to choose the visible order. Layer 6 is the front. The widget selector remains available even when a preview box is completely covered. Settings and page tools cannot be covered by widget layers. Existing visibility checkboxes and fullscreen bookmark hiding still apply without deleting a widget's saved geometry.

## Save, cancel, and reset

- **Save preferences** saves the arrangement together with other display preferences for all browsers. The live dashboard uses the last confirmed arrangement until that save succeeds.
- Escape during a drag cancels only that gesture. A canceled or zero-movement gesture does not change saved geometry.
- **Cancel layout edits** restores both layout profiles to the baseline loaded into the editor, leaving unrelated preference edits intact.
- **Reset selected layout** changes only that profile to Automatic. Save preferences to confirm the reset.
- Closing Settings discards unsaved edits. A failed save keeps the draft and does not present it as shared state.
- If another browser changed settings, the stale save reports a conflict. **Reload shared preferences** deliberately replaces preference/layout drafts with the newest server values before you reapply edits; integration credential drafts stay separate.

Reload already-open pages after upgrading to the expanded settings schema. Previous saved preferences and confirmed caches gain Automatic profiles without a database write on read. Integration credentials, selections, backgrounds, and the retired home-widget settings record are not migrated or replaced.

[Back to dashboard](dashboard.md)
