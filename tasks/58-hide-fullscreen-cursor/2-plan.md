# plan

- [plan](#plan)
  - [scope](#scope)
  - [Implementation Plan](#implementation-plan)
    - [1. Apply fullscreen cursor styling](#1-apply-fullscreen-cursor-styling)
    - [2. Verify cursor behavior in the browser](#2-verify-cursor-behavior-in-the-browser)
    - [3. Run existing regression checks](#3-run-existing-regression-checks)
  - [Acceptance Criteria](#acceptance-criteria)
  - [Risks And Decisions](#risks-and-decisions)

## scope

Hide the mouse cursor immediately throughout the fullscreen dashboard and restore existing cursor styles on exit. The implementation change belongs in `public/dashboard.css`.

## Implementation Plan

### 1. Apply fullscreen cursor styling

- Add `:fullscreen, :fullscreen * { cursor: none !important; }` beside the existing fullscreen rules in `public/dashboard.css`.
- Target both the fullscreen element and its descendants. Setting only the root cursor would leave explicit descendant cursors visible.
- Use a fullscreen-scoped `!important` declaration to override existing button, link, summary, disabled-button, move, and resize cursor rules, including selectors later in the stylesheet.
- Let the browser remove the rule's effect automatically when fullscreen ends. `public/dashboard.js` already enters fullscreen through `document.documentElement.requestFullscreen()` and exits through `document.exitFullscreen()`.

### 2. Verify cursor behavior in the browser

- Before fullscreen, record computed cursor styles for the document root, body, a visible button, a bookmark link or summary, and layout move/resize handles when editing is active.
- Enter actual Fullscreen API mode using the dashboard control. Check `document.fullscreenElement` and computed `cursor: none` on the root, body, visible content, and interactive descendants.
- Move the mouse over content and controls; confirm movement does not reveal the cursor.
- Check background-only fullscreen, where `.background-only .page-tools` remains visible. Confirm Settings and Exit fullscreen remain clickable while their cursor stays hidden.
- Enter fullscreen from layout editing and verify move/resize handles also resolve to `cursor: none`, with existing controls and keyboard navigation still working.
- Exit through a visible exit control where available and through the browser's Escape key. Confirm the fullscreen state clears and each sampled element regains its prior cursor style. Use `document.exitFullscreen()` for automated browser inspection because headless synthetic Escape does not trigger browser-level fullscreen exit.
- Repeat entry and exit once to check restoration across transitions. Outside fullscreen, check a text input retains its normal text cursor.

### 3. Run existing regression checks

- Run `npm run test:browser -- e2e/dashboard-home.spec.js -g 'fullscreen enters and exits'` for existing fullscreen entry, tool visibility, and exit behavior.
- Run `npm run test:browser -- e2e/background-display-options.spec.js -g 'background-only fullscreen tools remain reachable'` for retained fullscreen exit controls.
- Run `node --test test/dashboard.test.js` and `git diff --check`.
- Record browser inspection and regression results in the implementation report. If Chromium or required system libraries are absent, report the missing prerequisite to the operator and mark browser verification blocked.

## Acceptance Criteria

- The cursor disappears immediately on entering dashboard fullscreen, including over descendants with explicit cursor declarations.
- Mouse movement does not reveal the cursor while fullscreen remains active.
- Background-only tools and layout controls remain functional; keyboard focus indicators remain visible.
- Leaving fullscreen restores preexisting cursor behavior without reload, including pointer, text, move, and resize cursors where applicable.
- Repeated fullscreen transitions restore cursor behavior consistently.
- Existing focused regression checks pass, and browser inspection confirms the cursor-specific behavior.

## Risks And Decisions

- Interpret fullscreen as the existing Fullscreen API mode, consistent with current `:fullscreen` styling. Browser-window F11 mode does not reliably expose this state.
- Apply hiding immediately and continuously, including during layout editing. The request does not specify an idle delay or movement-based reveal.
- The scoped `!important` override is deliberate because descendant cursor declarations override inherited values and some existing selectors have higher specificity.
- CSS cursor styling affects dashboard content, not browser-owned fullscreen notices or browser chrome.
