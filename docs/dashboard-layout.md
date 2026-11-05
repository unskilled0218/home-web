# Widget layout

- [Widget layout](#widget-layout)
  - [Start editing](#start-editing)
  - [Move and resize](#move-and-resize)
  - [Profiles and fullscreen](#profiles-and-fullscreen)
  - [Save and recover](#save-and-recover)

## Start editing

Choose **Edit layout**, or hold a widget's non-interactive background for 600ms. Moving, scrolling, or releasing early cancels the hold. Use the button if your browser intercepts long presses.

**Save**, **Toolbar**, and **Cancel** stay above widgets. Toolbar opens detailed controls without shrinking the canvas. Links and device actions cannot run while editing. Save or cancel before opening Settings.

Automatic layout keeps its live arrangement until a real edit or an explicit switch to Custom. Opening the editor or saving without changes does not create a Custom layout.

## Move and resize

- Drag a labeled frame to move a widget.
- Drag its upper-right Resize handle to resize it.
- Open Toolbar for widget selection and numeric X, Y, width, and height fields.
- Use **Up/Down** to change overlap order without moving other widgets.

Coordinates start at the reference canvas's bottom-left: X increases rightward and Y upward. Numeric edits use whole reference CSS pixels. Custom widgets normally require at least 100 × 100 reference pixels; smaller canvases reduce that minimum.

Unchanged Automatic measurements may be smaller or outside Custom bounds. Keeping them unchanged is allowed; real edits must satisfy Custom bounds.

Escape cancels an active drag first, then closes an open toolbar. It does not exit editing. Toolbar entries survive closing and reopening it. Covered or tiny enabled widgets remain selectable there.

Widgets disabled in Settings have no editing frame, selector option, or layer row. Their saved rectangles and hidden layer slots remain intact. Re-enable them in Settings after leaving Edit layout to edit them again. Up/Down and front/back reorder only enabled widgets through their existing layer slots.

If no widgets are enabled for the selected profile, widget controls are disabled. Profile choice, Cancel, and valid layout-level actions remain available. A widget becoming hidden cancels its drag and discards uncommitted numeric text without discarding completed drafts; remote changes can still require an explicit Reload before saving.

Widget scales in Settings change content size, not Custom rectangles or layer order.

## Profiles and fullscreen

Desktop and Mobile have separate layouts. Mobile applies up to 600px. Edit either profile on any screen; the selected profile stays pinned during editing. Editor eligibility follows that selected profile's visibility settings, not the current viewport. Fullscreen hide preferences override either profile until fullscreen ends.

Custom layouts use the full viewport inside device safe areas. Controls and captions overlay the canvas; widgets can move underneath them. The canvas shrinks uniformly to fit smaller windows without enlarging above its reference size.

The screen size estimates the reference before fullscreen; the first settled fullscreen entry confirms it. References stay fixed during editing. Window resizing and fullscreen changes do not save preferences.

**Edit layout** is hidden in fullscreen. Enter editing first, or long-press a visible widget. The toolbar also has a fullscreen toggle.

## Save and recover

- **Save layout:** Saves both profile drafts to the captured layout store, then exits. It changes geometry and layers only.
- **Cancel:** Discards both drafts and restores the latest confirmed layout.
- **Reset selected profile** or **Automatic:** Resets only that draft profile. Save to apply it.
- **Reload local/shared layout (discard edits):** Discards both drafts and loads a fresh baseline without saving.

Fresh profiles store layouts locally. Existing Global layouts remain Global; General has no ownership selector. Other category saves preserve layouts.

Failed or conflicting saves retain the draft. Reload explicitly before retrying a stale draft. Local layouts can save offline when browser storage works; Global layouts require confirmed server state. A timeout may have committed, so check before retrying.

Nothing autosaves. Unsaved edits may be lost when a tab closes, even when the browser supports an unload warning. Older stored layouts remain readable without read-time rewrites.

[Back to dashboard](dashboard.md)
